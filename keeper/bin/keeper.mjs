#!/usr/bin/env node
// keeper: Pupate's off-chain loop. It calls the public functions that keep the protocol moving and
// holds no privileged key; if it stops, anyone can make the same calls.
//
//   node bin/keeper.mjs --once             one tick, then exit (cron)
//   node bin/keeper.mjs --loop             a tick every LOOP_EVERY seconds (pm2 / systemd)
//   node bin/keeper.mjs --status           print the state and exit
//   flags: --force-report (report now, whatever the age), --dry-run (simulate, never send)
//
// Each tick: read the state in one multicall, then in order
//   a. report  FloorFeed.report when the stored report is missing, stale, or goes stale within REPORT_LEAD
//   b. flush   PupateHook.flush when the hook holds at least MIN_FLUSH_WEI of tax
//   c. settle  Cocoon.settleSeat for every held seat whose listing filled (owner changed or order filled)
//   d. buy     Cocoon.buySeat with the cheapest valid listing under floor * (1 + tolerance) the pot covers
//   e. burn    Cocoon.burn when the burn pot is at least MIN_BURN_WEI and burnSpacing blocks have passed
//   f. auctions Cocoon.startAuction for each HARVEST_TOKENS balance, Cocoon.startImdAuction for the IMD-burn ETH
// Every step is simulated with eth_call first; a revert is logged by its custom error name and skipped.
// Environment: see keeper/README.md. Keys, RPC URLs and API keys are never printed.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { auctions, burn, buy, flush, report, settle } from '../lib/actions.mjs';
import { createClients, createTx, revertReason } from '../lib/chain.mjs';
import { describeConfig, loadConfig } from '../lib/config.mjs';
import { log, setTick, warn } from '../lib/log.mjs';
import { loadCache, readState, saveCache, statusLine, statusReport, syncSeats } from '../lib/state.mjs';

function usage() {
  const src = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n');
  console.log(src.slice(1, 20).join('\n').replace(/^\/\/ ?/gm, ''));
}

const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) {
  usage();
  process.exit(0);
}

let stopping = false;
main().catch((e) => {
  console.error(`${new Date().toISOString()} keeper failed: ${e.shortMessage || e.message}`);
  process.exitCode = 1;
});

async function main() {
  const cfg = loadConfig(argv);
  const { pub, wallet, account } = createClients(cfg);
  const chainId = await pub.getChainId();
  if (chainId !== cfg.chainId) throw new Error(`the RPC answers for chain ${chainId}, the configuration is for chain ${cfg.chainId}`);

  for (const line of describeConfig(cfg)) log(line);
  let dryRun = cfg.flags.dryRun;
  if (account) log(`keeper account ${account.address}${dryRun ? ' (dry run: nothing is sent)' : ''}`);
  else if (!cfg.flags.status && !dryRun) {
    warn('no KEEPER_PRIVATE_KEY: simulating only, as if DRY_RUN=1');
    dryRun = true;
  }
  if (cfg.attestationSource === 'local' && cfg.chainId !== 31337 && !cfg.allowLocalAttesterAnywhere) {
    throw new Error('ATTESTATION_SOURCE=local is for the local fork (chain 31337); set ALLOW_LOCAL_ATTESTER=1 to use it elsewhere');
  }
  if (cfg.attestationSource === 'imd' && !dryRun) log('ATTESTATION_SOURCE=imd: a due report costs 0.5 IMD from the keeper wallet (Permit2)');
  if (cfg.listingSource === 'opensea') log('LISTING_SOURCE=opensea: this source is untested; watch the first purchases');

  const tx = createTx({ pub, wallet, account, dryRun, gasCapWei: cfg.gasPriceCapWei, txTimeoutSec: cfg.txTimeoutSec });
  const cache = loadCache(cfg.stateFile, cfg.chainId, cfg.addresses.cocoon, cfg.fromBlock);
  const ctx = {
    cfg,
    a: cfg.addresses,
    pub,
    wallet,
    account,
    tx,
    cache,
    dryRun,
    forceReport: cfg.flags.forceReport,
    persist: () => saveCache(cfg.stateFile, cache),
    refresh: () => readState({ pub, cfg, cache, keeperAddress: account?.address }),
  };

  if (cfg.flags.status) {
    const s = await load(ctx);
    for (const line of statusReport(s, cfg)) console.log(line);
    return;
  }

  if (!cfg.flags.loop) {
    if (!cfg.flags.once) log('no --once/--loop/--status given: running one tick');
    await tick(ctx, 1);
    return;
  }

  const stop = (sig) => {
    if (!stopping) log(`${sig}: finishing the current tick, then stopping`);
    stopping = true;
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
  let n = 0;
  while (!stopping) {
    n += 1;
    await tick(ctx, n);
    for (let waited = 0; waited < cfg.loopEverySec * 1000 && !stopping; waited += 500) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  log('stopped');
}

/** Sync the seat cache to the chain head and read the state. */
async function load(ctx) {
  const latest = await ctx.pub.getBlockNumber();
  await syncSeats({ pub: ctx.pub, cocoon: ctx.a.cocoon, fromBlock: ctx.cfg.fromBlock, toBlock: latest, cache: ctx.cache, chunk: ctx.cfg.logChunk });
  ctx.persist();
  return ctx.refresh();
}

async function tick(ctx, n) {
  setTick(n);
  const notes = [];
  try {
    await ctx.tx.syncNonce();
    let s = await load(ctx);
    log(statusLine(s));
    if (s.keeperBalance !== null && s.keeperBalance < 10n ** 16n && !ctx.dryRun) warn(`keeper balance is under 0.01 ETH`);

    const steps = [
      ['report', report],
      ['flush', flush],
      ['settle', settle],
      ['buy', buy],
      ['burn', burn],
      ['auctions', auctions],
    ];
    for (const [name, fn] of steps) {
      let r = null;
      try {
        r = await fn(ctx, s);
      } catch (e) {
        warn(`${name} failed: ${revertReason(e)}`);
      }
      if (name === 'report') ctx.forceReport = false;
      if (r?.note) notes.push(r.note);
      if (r?.acted && !ctx.dryRun) s = await ctx.refresh(); // the pots, the seats and the feed may have changed
    }
    if (notes.length) log(`idle: ${notes.join('; ')}`);
  } catch (e) {
    warn(`tick failed: ${revertReason(e)}`);
  } finally {
    try {
      ctx.persist();
    } catch (e) {
      warn(`could not write ${ctx.cfg.stateFile}: ${e.message}`);
    }
    setTick(null);
  }
}
