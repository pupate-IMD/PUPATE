#!/usr/bin/env node
// Pupate's Sepolia rehearsal: the mainnet deployment sequence on a public testnet, signed by our own
// wallet, against Uniswap v4's Sepolia PoolManager and Seaport 1.6, with two mocks for what Sepolia
// lacks (the identity.md collection and the IMD token). The pool is opened by the local launch factory,
// because IMD's paid launch is not part of this rehearsal. See README.md in this directory.
//
//   node script/sepolia/up.mjs           deploy everything, write keeper/addresses.sepolia.json
//   node script/sepolia/up.mjs resume    continue a run that stopped, from its first incomplete step
//   node script/sepolia/up.mjs status    the deployer's balances and the addresses on record
//
// Environment, from .env or the environment: SEPOLIA_RPC_URL, KEEPER_PRIVATE_KEY (the deployer, who is
// also DEVELOPER and OPERATOR here), SEPOLIA_ATTESTER_KEY (a throwaway key for the feed's attester,
// generated and appended to .env on the first run). None of them is ever printed.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { POOL_KEY, ROOT, castLocal, fmtEth, fmtGwei, localQuestionHash, readDotEnv, run } from '../local/common.mjs';

const CHAIN_ID = 11155111;
/** Sepolia contracts from developers.uniswap.org/docs/protocols/v4/deployments and Seaport's deployments. */
const SEPOLIA = {
  poolManager: '0xE03A1074c86CFeDd5C142C4F04F1a1536e203543',
  universalRouter: '0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b',
  quoter: '0x61b3f2011a92d183c7dbadbda940a7555ccf9227',
  permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
  seaport: '0x0000000000000068F116a894984e2DB1123eB395',
  create2Factory: '0x4e59b44847b379578588920cA78FbF26c0B4956C',
};
const ADDRESSES_FILE = join(ROOT, 'keeper', 'addresses.sepolia.json');
const ENV_FILE = join(ROOT, '.env');
/** Where a run records what it has deployed, so `resume` can pick up after a failed step: inside the project, not the shared temp directory. */
const PROGRESS_FILE = join(ROOT, 'keeper', '.launch', 'sepolia-progress.json');
const MIN_BALANCE_WEI = 5n * 10n ** 15n; // 0.005 ETH: the whole sequence costs a fraction of that at Sepolia's usual fees
const DEVELOPER_SHARE_WEI = 50_000_000n * 10n ** 18n; // 5% of supply, what PostLaunch must find with the deployer
const SEL = { balanceOf: '0x70a08231', openedAt: '0x38930203' };

const dotenv = readDotEnv();
const env = (k) => process.env[k] || dotenv[k] || '';
const RPC = env('SEPOLIA_RPC_URL');
const KEY = env('KEEPER_PRIVATE_KEY');
if (!RPC) fail('SEPOLIA_RPC_URL is not set');
if (!/^0x[0-9a-fA-F]{64}$/.test(KEY)) fail('KEEPER_PRIVATE_KEY is not set or not a 0x-prefixed 32-byte key');

const commands = { up, resume, status };
const cmd = process.argv[2] || 'up';
if (!commands[cmd]) fail(`unknown command ${cmd}; one of: ${Object.keys(commands).join(', ')}`);
commands[cmd]().catch((e) => {
  console.error(`\n${cmd} failed: ${scrub(e.message)}`);
  console.error(`progress is kept in ${PROGRESS_FILE}; \`node script/sepolia/up.mjs resume\` continues from the first incomplete step`);
  process.exitCode = 1;
});

// ------------------------------------------------------------------ up, resume

async function up() {
  if (existsSync(PROGRESS_FILE)) {
    const old = loadProgress();
    if (old.cocoon && !old.reported) {
      throw new Error(`a run is in progress (Cocoon ${old.cocoon}); use \`resume\` to continue it, or delete ${PROGRESS_FILE} to start over`);
    }
  }
  return runSteps({});
}

async function resume() {
  if (!existsSync(PROGRESS_FILE)) throw new Error(`nothing to resume: ${PROGRESS_FILE} does not exist`);
  return runSteps(loadProgress());
}

async function runSteps(p) {
  step('0/6 the wallet and the network');
  const chainId = Number(await rpc('eth_chainId'));
  if (chainId !== CHAIN_ID) throw new Error(`SEPOLIA_RPC_URL answers with chain id ${chainId}, not ${CHAIN_ID}`);
  const deployer = castLocal('wallet', 'address', '--private-key', KEY);
  const balance = BigInt(await rpc('eth_getBalance', [deployer, 'latest']));
  const head = await rpc('eth_getBlockByNumber', ['latest', false]);
  console.log(`  deployer ${deployer}: ${fmtEth(balance)} on Sepolia, block ${Number(head.number)}, base fee ${fmtGwei(BigInt(head.baseFeePerGas ?? 0))}`);
  if (balance < MIN_BALANCE_WEI) throw new Error(`the deployer needs at least ${fmtEth(MIN_BALANCE_WEI)} on Sepolia`);
  for (const [name, address] of Object.entries(SEPOLIA)) {
    const code = await rpc('eth_getCode', [address, 'latest']);
    if (!code || code === '0x') throw new Error(`${name} has no code at ${address} on Sepolia`);
    console.log(`  ${name.padEnd(16)} ${address}  code ${(code.length - 2) / 2} bytes`);
  }
  const attester = attesterKey();
  const attesterAddress = castLocal('wallet', 'address', '--private-key', attester);
  console.log(`  attester (local key, Sepolia only) ${attesterAddress}`);
  if (Object.keys(p).length) console.log(`  resuming: ${Object.keys(p).join(', ')} already done`);

  if (!p.collection) {
    step('1/6 Mocks (a stand-in collection and a stand-in IMD)');
    const mocks = forgeScript('script/sepolia/Mocks.s.sol:Mocks', {});
    p.collection = grab(mocks, 'MockERC721');
    p.imd = grab(mocks, 'MockERC20');
    saveProgress(p);
  }

  if (!p.cocoon) {
    step('2/6 DeployPreLaunch (timelock, FloorFeed, Cocoon)');
    await settled('the mocks', async () => (await hasCode(p.collection)) && (await hasCode(p.imd)));
    const pre = forgeScript('script/DeployPreLaunch.s.sol:DeployPreLaunch', {
      DEVELOPER: deployer,
      OPERATOR: deployer,
      ORACLE_ATTESTER: attesterAddress,
      COLLECTION: p.collection,
      POOL_MANAGER: SEPOLIA.poolManager,
      IMD: p.imd,
      SEAPORT: SEPOLIA.seaport,
      EVIDENCE_CHAIN_ID: '1',
    });
    p.timelock = grab(pre, 'TimelockController');
    p.feed = grab(pre, 'FloorFeed');
    p.cocoon = grab(pre, 'Cocoon');
    p.fromBlock = Math.min(...broadcastReceipts('DeployPreLaunch.s.sol').map((r) => r.block));
    saveProgress(p);
  }

  if (!p.token) {
    step('3/6 LaunchLocal (token, hook at a 0x18CC address, pool opened and seeded in one transaction)');
    await settled('the pre-launch contracts', async () => (await hasCode(p.cocoon)) && (await hasCode(p.feed)) && (await hasCode(p.timelock)));
    const launch = forgeScript('script/local/LaunchLocal.s.sol:LaunchLocal', {
      POOL_MANAGER: SEPOLIA.poolManager,
      COCOON: p.cocoon,
      TIMELOCK: p.timelock,
      POOL_FEE: String(POOL_KEY.fee),
      TICK_SPACING: String(POOL_KEY.tickSpacing),
    });
    p.token = grab(launch, 'PupateToken');
    p.hook = grab(launch, 'PupateHook');
    saveProgress(p);
  }

  if (!p.vesting) {
    step('4/6 PostLaunch (wire Cocoon, vest the developer share, pin the question, hand over to the timelock)');
    // The node must show the launch as final before PostLaunch runs: it vests whatever the deployer
    // holds, so a stale view of the swarm transfer would vest 15% instead of 5%.
    await settled('the launch', async () => {
      const bal = BigInt(await rpc('eth_call', [{ to: p.token, data: SEL.balanceOf + deployer.slice(2).toLowerCase().padStart(64, '0') }, 'latest']));
      const opened = BigInt(await rpc('eth_call', [{ to: p.hook, data: SEL.openedAt }, 'latest']).catch(() => '0x0'));
      return near(bal, DEVELOPER_SHARE_WEI) && opened !== 0n;
    });
    const questionHash = localQuestionHash();
    console.log(`  QUESTION_HASH (keccak256 of keeper/questions/floor.question.txt) ${questionHash}`);
    const post = forgeScript('script/PostLaunch.s.sol:PostLaunch', {
      COCOON: p.cocoon,
      FEED: p.feed,
      TIMELOCK: p.timelock,
      TOKEN: p.token,
      HOOK: p.hook,
      DEVELOPER: deployer,
      QUESTION_HASH: questionHash,
      POOL_FEE: String(POOL_KEY.fee),
      TICK_SPACING: String(POOL_KEY.tickSpacing),
      // an interrupted attempt may already have deployed the vesting contract; reuse it
      ...(process.env.VESTING ? { VESTING: process.env.VESTING } : {}),
    });
    p.vesting = grab(post, 'PupateVesting');
    p.questionHash = questionHash;
    saveProgress(p);
  }

  if (!p.reported) {
    step('5/6 ReportLocal (the first floor report, signed by the local attester)');
    await settled('the post-launch wiring', () => hasCode(p.vesting));
    const reportEnv = { FEED: p.feed, ATTESTER_KEY: attester };
    if (process.env.FLOOR_WEI) reportEnv.FLOOR_WEI = process.env.FLOOR_WEI;
    forgeScript('script/local/ReportLocal.s.sol:ReportLocal', reportEnv);
    p.reported = true;
    saveProgress(p);
  }

  step('6/6 checks, gas, and the addresses file');
  await settled('the first report', async () => String(call(p.feed, 'latest()(uint256,bool)')[1]) === 'true');
  const checks = [
    ['hook.sink() is Cocoon', call(p.hook, 'sink()(address)')[0], p.cocoon],
    ['hook.owner() is the timelock', call(p.hook, 'owner()(address)')[0], p.timelock],
    ['cocoon.wired()', String(call(p.cocoon, 'wired()(bool)')[0]), 'true'],
    ['cocoon.owner() is the timelock', call(p.cocoon, 'owner()(address)')[0], p.timelock],
    ['feed.owner() is the timelock', call(p.feed, 'owner()(address)')[0], p.timelock],
    ['feed.attester() is the local attester', call(p.feed, 'attester()(address)')[0], attesterAddress],
    ['feed.questionHash()', call(p.feed, 'questionHash()(bytes32)')[0], p.questionHash],
    ['feed.latest() fresh', String(call(p.feed, 'latest()(uint256,bool)')[1]), 'true'],
    ['vesting holds 5% of supply', call(p.token, 'balanceOf(address)(uint256)', p.vesting)[0], String(DEVELOPER_SHARE_WEI)],
  ];
  let bad = 0;
  for (const [name, got, want] of checks) {
    const ok = String(got).toLowerCase() === String(want).toLowerCase() || (name.startsWith('vesting') && near(got, want));
    if (!ok) bad++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `: got ${got}, want ${want}`}`);
  }
  console.log(`  hook.buyTaxBps() = ${call(p.hook, 'buyTaxBps()(uint256)')[0]}, hook.openedAtBlock() = ${call(p.hook, 'openedAtBlock()(uint40)')[0]}`);
  if (bad) throw new Error(`${bad} post-deploy check(s) failed`);

  let totalGas = 0n;
  let totalCost = 0n;
  console.log('\n  gas used, from the broadcast receipts:');
  for (const script of ['Mocks.s.sol', 'DeployPreLaunch.s.sol', 'LaunchLocal.s.sol', 'PostLaunch.s.sol', 'ReportLocal.s.sol']) {
    for (const r of broadcastReceipts(script)) {
      totalGas += r.gas;
      totalCost += r.gas * r.price;
      console.log(`  ${script.padEnd(22)} ${r.what.padEnd(40)} ${String(r.gas).padStart(10)}  block ${r.block}`);
    }
  }
  console.log(`  total ${totalGas} gas, ${fmtEth(totalCost)} paid`);

  const addresses = {
    chainId: CHAIN_ID,
    fromBlock: p.fromBlock,
    token: p.token,
    hook: p.hook,
    cocoon: p.cocoon,
    feed: p.feed,
    timelock: p.timelock,
    vesting: p.vesting,
    poolManager: SEPOLIA.poolManager,
    universalRouter: SEPOLIA.universalRouter,
    quoter: SEPOLIA.quoter,
    permit2: SEPOLIA.permit2,
    collection: p.collection,
    imd: p.imd,
    seaport: SEPOLIA.seaport,
    poolKey: { fee: POOL_KEY.fee, tickSpacing: POOL_KEY.tickSpacing },
    attester: attesterAddress,
  };
  writeFileSync(ADDRESSES_FILE, JSON.stringify(addresses, null, 2) + '\n');
  console.log(`\n  wrote ${ADDRESSES_FILE}`);
  console.log(JSON.stringify(addresses, null, 2).replace(/^/gm, '  '));
  console.log('\nNext: the keeper against Sepolia (keeper/README.md, ADDRESSES=keeper/addresses.sepolia.json,');
  console.log('ATTESTATION_SOURCE=local ALLOW_LOCAL_ATTESTER=1 LOCAL_ATTESTER_KEY=$SEPOLIA_ATTESTER_KEY), and the site');
  console.log('with NEXT_PUBLIC_CHAIN=sepolia once SEPOLIA in site/lib/addresses.ts carries these addresses.');
}

// ------------------------------------------------------------------ status

async function status() {
  const deployer = castLocal('wallet', 'address', '--private-key', KEY);
  const balance = BigInt(await rpc('eth_getBalance', [deployer, 'latest']));
  console.log(`deployer ${deployer}: ${fmtEth(balance)} on Sepolia`);
  if (existsSync(PROGRESS_FILE)) console.log(`progress file: ${PROGRESS_FILE} (${Object.keys(loadProgress()).join(', ')})`);
  if (!existsSync(ADDRESSES_FILE)) {
    console.log(`no ${ADDRESSES_FILE} yet: run \`node script/sepolia/up.mjs\``);
    return;
  }
  const a = JSON.parse(readFileSync(ADDRESSES_FILE, 'utf8'));
  for (const [k, v] of Object.entries(a)) console.log(`  ${k.padEnd(16)} ${typeof v === 'object' ? JSON.stringify(v) : v}`);
  console.log(`hook.buyTaxBps() = ${call(a.hook, 'buyTaxBps()(uint256)')[0]}, feed.latest() = ${call(a.feed, 'latest()(uint256,bool)').join(', ')}`);
}

// ------------------------------------------------------------------ progress, settling

function loadProgress() {
  return JSON.parse(readFileSync(PROGRESS_FILE, 'utf8'));
}

function saveProgress(p) {
  mkdirSync(join(ROOT, 'keeper', '.launch'), { recursive: true });
  writeFileSync(PROGRESS_FILE, JSON.stringify(p, null, 2));
}

/**
 * Waits until the node agrees, three polls in a row, that `what` has landed. The RPC provider answers
 * from several nodes, and right after a broadcast one of them may still be a block behind, which is
 * enough to make the next script read a stale balance or estimate gas against a state that does not
 * exist yet.
 */
async function settled(what, predicate, { timeoutMs = 180_000, everyMs = 5_000 } = {}) {
  const started = Date.now();
  let agree = 0;
  while (Date.now() - started < timeoutMs) {
    let ok = false;
    try {
      ok = await predicate();
    } catch {
      ok = false;
    }
    agree = ok ? agree + 1 : 0;
    if (agree >= 3) {
      console.log(`  ${what}: final (${Math.round((Date.now() - started) / 1000)} s)`);
      return;
    }
    await sleep(everyMs);
  }
  throw new Error(`${what} did not settle within ${timeoutMs / 1000} s`);
}

async function hasCode(address) {
  const code = await rpc('eth_getCode', [address, 'latest']);
  return Boolean(code) && code !== '0x';
}

// ------------------------------------------------------------------ the attester key

/** The feed's attester on Sepolia is a throwaway key of ours; made once and kept in .env. */
function attesterKey() {
  const existing = env('SEPOLIA_ATTESTER_KEY');
  if (/^0x[0-9a-fA-F]{64}$/.test(existing)) return existing;
  const made = JSON.parse(castLocal('wallet', 'new', '--json'))[0];
  appendFileSync(
    ENV_FILE,
    `\n# Sepolia rehearsal only: the FloorFeed attester's key, generated by script/sepolia/up.mjs. Worthless elsewhere.\nSEPOLIA_ATTESTER_KEY=${made.private_key}\n`,
  );
  console.log('  generated SEPOLIA_ATTESTER_KEY and appended it to .env');
  return made.private_key;
}

// ------------------------------------------------------------------ forge, cast, rpc

/**
 * Runs a forge script on Sepolia, signed by the deployer, one transaction at a time. Gas limits are
 * forge's simulated figures times nine: Sepolia runs a newer gas schedule than the project's cancun
 * EVM and prices contract creation about seven times higher (measured: Cocoon 38.4M gas against 5.5M
 * on mainnet). Unused gas is refunded, so the margin costs nothing. Asking the node per transaction
 * instead (--skip-simulation) failed: the provider's nodes disagree on the nonce for a block or two.
 */
function forgeScript(target, scriptEnv) {
  const args = [
    'script', target, '--rpc-url', RPC, '--broadcast', '--private-key', KEY,
    '--slow', '--non-interactive', '--gas-estimate-multiplier', '900',
    // The provider's nodes lag each other by a block now and then; give a sent transaction time to
    // show up everywhere before the next one is built, instead of failing on a stale nonce.
    '--retries', '10', '--delay', '8',
  ];
  const r = run('forge', args, { env: scriptEnv, quiet: true });
  const out = `${r.stdout}\n${r.stderr}`;
  if (r.status !== 0) throw new Error(`forge ${target} failed (exit ${r.status})\n${scrub(out)}`);
  const logs = out.match(/== Logs ==\s*([\s\S]*?)(?:\n\s*\n## |\n\s*\n==|\nSIMULATION|\nSKIPPING|$)/);
  console.log(scrub(logs ? logs[1] : out).trimEnd().replace(/^/gm, '  '));
  return out;
}

function grab(out, label) {
  const m = out.match(new RegExp(`^\\s*${label}\\s+(0x[0-9a-fA-F]{40})\\s*$`, 'm'));
  if (!m) throw new Error(`could not find "${label} 0x..." in the script output`);
  return m[1];
}

/** The last broadcast of a script on Sepolia: one row per transaction, from forge's own receipts. */
function broadcastReceipts(scriptFile) {
  const file = join(ROOT, 'broadcast', basename(scriptFile), String(CHAIN_ID), 'run-latest.json');
  const json = JSON.parse(readFileSync(file, 'utf8'));
  const byHash = new Map((json.receipts || []).map((r) => [r.transactionHash.toLowerCase(), r]));
  return json.transactions.map((t) => {
    const r = t.hash ? byHash.get(String(t.hash).toLowerCase()) : null;
    return {
      what: `${t.transactionType} ${t.contractName || ''}${t.function ? ' ' + t.function.replace(/\(.*$/, '()') : ''}`.trim(),
      gas: r ? BigInt(r.gasUsed) : 0n,
      price: r ? BigInt(r.effectiveGasPrice || 0) : 0n,
      block: r ? Number(r.blockNumber) : NaN,
    };
  });
}

function call(to, sig, ...args) {
  const out = run('cast', ['call', to, sig, ...args.map(String), '--rpc-url', RPC]).stdout.trim();
  return out
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+\[[^\]]*\]\s*$/, '').trim())
    .filter((line) => line.length);
}

async function rpc(method, params = []) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result;
}

// ------------------------------------------------------------------ small things

/** Within 1 PUPATE of the target (the pool seeding leaves a few wei of rounding with the deployer). */
function near(got, want) {
  try {
    const d = BigInt(got) - BigInt(want);
    return (d < 0n ? -d : d) <= 10n ** 18n;
  } catch {
    return false;
  }
}

/** Never let the RPC URL (it carries a key) or a private key reach the terminal. */
function scrub(text) {
  let out = String(text);
  for (const secret of [RPC, KEY, env('SEPOLIA_ATTESTER_KEY')]) {
    if (secret) out = out.split(secret).join('<redacted>');
  }
  try {
    out = out.split(new URL(RPC).host).join('<rpc-host>');
  } catch {
    // not a URL
  }
  return out;
}

function step(title) {
  console.log(`\n== ${title}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function fail(msg) {
  console.error(msg);
  process.exit(2);
}
