#!/usr/bin/env node
// Pupate's local launch harness: an anvil fork of Ethereum mainnet (chain id 31337) with the whole
// stack deployed the way the IMD launch factory deploys it, so the site's live-data layer and real
// swaps can be tried end to end without IMD or testnet funds; then Metamorph MD at one bit, with one
// seat in the vault, so the mine runs live too. See README.md in this directory.
//
//   node script/local/up.mjs            start anvil, deploy everything, write site/public/addresses.local.json
//   node script/local/up.mjs status     is the fork up, which block, which addresses
//   node script/local/up.mjs down       stop anvil and remove the addresses file (--keep keeps it)
//   node script/local/smoke.mjs         buy and sell through the Universal Router, flush, read the feed
//
// Environment: MAINNET_RPC_URL (from .env or the environment; used only as a value, never printed),
// FORK_BLOCK (optional: pin the fork to a block), FLOOR_WEI (default 2.8 ether), ANVIL_PORT (default 8545),
// SEAT (optional: the seat the vault is given; default the first one from id 1 held by a plain EOA).
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import {
  ACCOUNTS,
  ADDRESSES_FILE,
  CHAIN_ID,
  ETH,
  LOG_FILE,
  MAINNET,
  PID_FILE,
  POOL_KEY,
  PORT,
  ROOT,
  RPC_URL,
  RUN_DIR,
  anvilUp,
  call,
  callUint,
  fmtEth,
  fmtGwei,
  fmtPupate,
  forkUrl,
  hasCode,
  latestBlock,
  localQuestionHash,
  redact,
  rpc,
  run,
  send,
  stripDelegations,
} from './common.mjs';

const LAUNCH_GAS_CEILING_WEI = 5n * 10n ** 16n; // IMD pays the launch transaction up to 0.05 ETH (policy v34)
/// Metamorph MD's difficulty floor on the fork: one bit, so a mint is found at once (mainnet takes 20).
const METAMORPH_MIN_BITS = 1;
/// keeper/test/fork.mjs lists, buys and sells this seat, so the vault is not given it here.
const KEEPER_TEST_SEAT = 1376;

const commands = { up, down, status };
const cmd = process.argv[2] || 'up';
if (!commands[cmd]) {
  console.error(`unknown command ${cmd}; one of: ${Object.keys(commands).join(', ')}`);
  process.exit(2);
}
commands[cmd]().catch((e) => {
  console.error(`\n${cmd} failed: ${redact(e.message, safeForkUrl())}`);
  process.exitCode = 1;
});

function safeForkUrl() {
  try {
    return forkUrl();
  } catch {
    return '';
  }
}

// ------------------------------------------------------------------ up

async function up() {
  const url = forkUrl();
  if (await anvilUp()) {
    throw new Error(`something already answers on ${RPC_URL} with chain id ${CHAIN_ID}; run \`down\` first`);
  }

  step('1/8 anvil: forking mainnet');
  const pid = await startAnvil(url);
  const fork = await latestBlock();
  console.log(`  pid ${pid}, log ${LOG_FILE}`);
  console.log(`  fork head block ${fork.number}, base fee ${fmtGwei(fork.baseFee)}`);
  const stripped = await stripDelegations();
  if (stripped.length) {
    const targets = [...new Set(stripped.map((s) => '0x' + s.code.slice(8)))];
    console.log(
      `  cleared the EIP-7702 delegation (-> ${targets.join(', ')}) that ${stripped.length} of anvil's default` +
        ' accounts carry on mainnet, so ETH paid to them stays with them',
    );
  }

  step('2/8 the mainnet contracts the launch leans on');
  for (const [name, address] of Object.entries(MAINNET)) {
    const code = await rpc('eth_getCode', [address, 'latest']);
    if (!code || code === '0x') throw new Error(`${name} has no code at ${address} on the fork`);
    console.log(`  ${name.padEnd(16)} ${address}  code ${(code.length - 2) / 2} bytes`);
  }

  step('3/8 DeployPreLaunch (timelock, FloorFeed, Cocoon)');
  const pre = forgeScript('script/DeployPreLaunch.s.sol:DeployPreLaunch', {
    DEVELOPER: ACCOUNTS.deployer.address,
    OPERATOR: ACCOUNTS.deployer.address,
    ORACLE_ATTESTER: ACCOUNTS.attester.address,
    COLLECTION: MAINNET.collection,
    POOL_MANAGER: MAINNET.poolManager,
    IMD: MAINNET.imd,
    EVIDENCE_CHAIN_ID: '1',
  });
  const timelock = grab(pre, 'TimelockController');
  const feed = grab(pre, 'FloorFeed');
  const cocoon = grab(pre, 'Cocoon');
  const preTxs = await broadcast('DeployPreLaunch.s.sol');
  const fromBlock = Math.min(...preTxs.map((t) => t.block));

  step('4/8 LaunchLocal (token, hook at a 0x18CC address, pool opened and seeded in one transaction)');
  const launch = forgeScript('script/local/LaunchLocal.s.sol:LaunchLocal', {
    POOL_MANAGER: MAINNET.poolManager,
    COCOON: cocoon,
    TIMELOCK: timelock,
    POOL_FEE: String(POOL_KEY.fee),
    TICK_SPACING: String(POOL_KEY.tickSpacing),
    SWARM_SHARE_TO: ACCOUNTS.swarm.address,
  });
  const token = grab(launch, 'PupateToken');
  const hook = grab(launch, 'PupateHook');
  const launchTxs = await broadcast('LaunchLocal.s.sol');

  step('5/8 PostLaunch (wire Cocoon, vest the developer share, pin the question, hand over to the timelock)');
  const questionHash = localQuestionHash();
  console.log(`  QUESTION_HASH (keccak256 of keeper/questions/floor.question.txt) ${questionHash}`);
  const post = forgeScript('script/PostLaunch.s.sol:PostLaunch', {
    COCOON: cocoon,
    FEED: feed,
    TIMELOCK: timelock,
    TOKEN: token,
    HOOK: hook,
    DEVELOPER: ACCOUNTS.deployer.address,
    QUESTION_HASH: questionHash,
    POOL_FEE: String(POOL_KEY.fee),
    TICK_SPACING: String(POOL_KEY.tickSpacing),
  });
  const vesting = grab(post, 'PupateVesting');
  const postTxs = await broadcast('PostLaunch.s.sol');

  step('6/8 ReportLocal (the first floor report, signed by the local attester)');
  const reportEnv = { FEED: feed, ATTESTER_KEY: ACCOUNTS.attester.key };
  if (process.env.FLOOR_WEI) reportEnv.FLOOR_WEI = process.env.FLOOR_WEI;
  forgeScript('script/local/ReportLocal.s.sol:ReportLocal', reportEnv);
  const reportTxs = await broadcast('ReportLocal.s.sol');

  step('7/8 checks');
  const bad = verify([
    ['hook.sink() is Cocoon', call(hook, 'sink()(address)')[0], cocoon],
    ['hook.owner() is the timelock', call(hook, 'owner()(address)')[0], timelock],
    ['cocoon.wired()', String(call(cocoon, 'wired()(bool)')[0]), 'true'],
    ['cocoon.owner() is the timelock', call(cocoon, 'owner()(address)')[0], timelock],
    ['feed.owner() is the timelock', call(feed, 'owner()(address)')[0], timelock],
    ['feed.attester() is account #9', call(feed, 'attester()(address)')[0], ACCOUNTS.attester.address],
    ['feed.questionHash()', call(feed, 'questionHash()(bytes32)')[0], questionHash],
    ['feed.latest() fresh', String(call(feed, 'latest()(uint256,bool)')[1]), 'true'],
  ]);
  const supply = callUint(token, 'totalSupply()(uint256)');
  const held = {
    'PoolManager (the pool)': callUint(token, 'balanceOf(address)(uint256)', MAINNET.poolManager),
    'PupateVesting (developer, 12 months)': callUint(token, 'balanceOf(address)(uint256)', vesting),
    'swarm share stand-in (account #8)': callUint(token, 'balanceOf(address)(uint256)', ACCOUNTS.swarm.address),
    'deployer': callUint(token, 'balanceOf(address)(uint256)', ACCOUNTS.deployer.address),
  };
  for (const [who, bal] of Object.entries(held)) {
    console.log(`  ${who.padEnd(38)} ${fmtPupate(bal).padStart(28)}  ${((Number((bal * 10000n) / supply)) / 100).toFixed(2)}%`);
  }
  console.log(`  feed.latest() = ${call(feed, 'latest()(uint256,bool)').join(', ')}`);
  console.log(`  hook.buyTaxBps() = ${call(hook, 'buyTaxBps()(uint256)')[0]} (99% at the open, -1 point a minute, 6% after 93 minutes)`);
  console.log(`  hook.openedAtBlock() = ${call(hook, 'openedAtBlock()(uint40)')[0]}`);
  if (bad) throw new Error(`${bad} post-deploy check(s) failed`);

  step(`8/8 Metamorph MD (the art, the token at ${METAMORPH_MIN_BITS} bit, a seat for the vault, noted) and the addresses file`);
  const { seat, holder } = await pickSeat();
  console.log(`  seat #${seat}: its mainnet holder ${holder} hands it to Cocoon (impersonated on the fork)`);
  await handOver(seat, holder, cocoon);
  const mm = forgeScript('script/local/DeployMetamorphLocal.s.sol:DeployMetamorphLocal', {
    COCOON: cocoon,
    HOOK: hook,
    PUPATE: token,
    IMD: MAINNET.imd,
    COLLECTION: MAINNET.collection,
    POOL_MANAGER: MAINNET.poolManager,
    SEAT: String(seat),
    MIN_BITS: String(METAMORPH_MIN_BITS),
    POOL_FEE: String(POOL_KEY.fee),
    TICK_SPACING: String(POOL_KEY.tickSpacing),
  });
  const metamorph = grab(mm, 'METAMORPH');
  const metamorphArt = grab(mm, 'METAMORPH_ART');
  const metamorphTxs = await broadcast('DeployMetamorphLocal.s.sol');
  const badMetamorph = verify([
    ['collection.ownerOf(seat) is Cocoon', call(MAINNET.collection, 'ownerOf(uint256)(address)', seat)[0], cocoon],
    ['cocoon.seats(seat).held', call(cocoon, 'seats(uint256)(uint128,uint40,uint16,uint16,uint32,bool,uint16)', seat)[5], 'true'],
    ['metamorph.ART() is the router', call(metamorph, 'ART()(address)')[0], metamorphArt],
    ['metamorph.COCOON() is Cocoon', call(metamorph, 'COCOON()(address)')[0], cocoon],
    [`metamorph.bits() is ${METAMORPH_MIN_BITS}`, call(metamorph, 'bits()(uint8)')[0], String(METAMORPH_MIN_BITS)],
    ['metamorph.notedSeats() is the seat', call(metamorph, 'notedSeats()(uint256[])')[0], `[${seat}]`],
    ['metamorph.mineableSeats() is the seat', call(metamorph, 'mineableSeats()(uint256[])')[0], `[${seat}]`],
  ]);
  console.log(
    `  metamorph.mintPrice() = ${fmtPupate(callUint(metamorph, 'mintPrice()(uint256)'))}, epoch() = ${call(metamorph, 'epoch()(uint16)')[0]},` +
      ` totalMinted() = ${call(metamorph, 'totalMinted()(uint16)')[0]}`,
  );
  if (badMetamorph) throw new Error(`${badMetamorph} Metamorph check(s) failed`);

  gasReport({ pre: preTxs, launch: launchTxs, post: postTxs, report: reportTxs, metamorph: metamorphTxs }, fork.baseFee);

  const addresses = {
    chainId: CHAIN_ID,
    fromBlock,
    token,
    hook,
    cocoon,
    feed,
    timelock,
    vesting,
    poolManager: MAINNET.poolManager,
    universalRouter: MAINNET.universalRouter,
    quoter: MAINNET.quoter,
    permit2: MAINNET.permit2,
    collection: MAINNET.collection,
    imd: MAINNET.imd,
    seaport: MAINNET.seaport,
    poolKey: { fee: POOL_KEY.fee, tickSpacing: POOL_KEY.tickSpacing },
    attester: ACCOUNTS.attester.address,
    metamorph,
    metamorphArt,
  };
  writeFileSync(ADDRESSES_FILE, JSON.stringify(addresses, null, 2) + '\n');
  console.log(`\n  wrote ${ADDRESSES_FILE}`);
  console.log(JSON.stringify(addresses, null, 2).replace(/^/gm, '  '));

  console.log(`\nThe fork is up on ${RPC_URL} (anvil pid ${pid}).`);
  console.log('  smoke test:  node script/local/smoke.mjs');
  console.log('  stop it:     node script/local/up.mjs down');
}

// ------------------------------------------------------------------ down, status

async function down() {
  const keep = process.argv.includes('--keep');
  let pid = existsSync(PID_FILE) ? Number(readFileSync(PID_FILE, 'utf8').trim()) : 0;
  if (!pid && (await anvilUp())) pid = pidOnPort(PORT);
  if (pid) {
    console.log(`stopping anvil (pid ${pid})`);
    kill(pid);
    for (let i = 0; i < 40 && (await anvilUp()); i++) await sleep(250);
  } else {
    console.log('no anvil pid on record' + ((await anvilUp()) ? `, but something answers on ${RPC_URL}` : ''));
  }
  if (existsSync(PID_FILE)) rmSync(PID_FILE);
  if (!keep && existsSync(ADDRESSES_FILE)) {
    rmSync(ADDRESSES_FILE);
    console.log(`removed ${ADDRESSES_FILE}`);
  }
  console.log((await anvilUp()) ? `WARNING: ${RPC_URL} still answers` : 'the fork is down');
}

async function status() {
  if (!(await anvilUp())) {
    console.log(`down: nothing answers on ${RPC_URL} with chain id ${CHAIN_ID}`);
    return;
  }
  const b = await latestBlock();
  const pid = existsSync(PID_FILE) ? readFileSync(PID_FILE, 'utf8').trim() : '?';
  console.log(`up: ${RPC_URL}, anvil pid ${pid}, block ${b.number}, timestamp ${b.timestamp} (${new Date(b.timestamp * 1000).toISOString()})`);
  if (existsSync(ADDRESSES_FILE)) {
    const a = JSON.parse(readFileSync(ADDRESSES_FILE, 'utf8'));
    console.log(`addresses: ${ADDRESSES_FILE}`);
    for (const [k, v] of Object.entries(a)) console.log(`  ${k.padEnd(16)} ${typeof v === 'object' ? JSON.stringify(v) : v}`);
    console.log(`hook.buyTaxBps() = ${call(a.hook, 'buyTaxBps()(uint256)')[0]}, feed.latest() = ${call(a.feed, 'latest()(uint256,bool)').join(', ')}`);
    if (a.metamorph) {
      console.log(
        `metamorph.bits() = ${call(a.metamorph, 'bits()(uint8)')[0]}, mineableSeats() = ${call(a.metamorph, 'mineableSeats()(uint256[])')[0]},` +
          ` totalMinted() = ${call(a.metamorph, 'totalMinted()(uint16)')[0]}`,
      );
    }
  } else {
    console.log('no addresses file: the fork is up but nothing is deployed on it (run `up` after `down`)');
  }
}

// ------------------------------------------------------------------ anvil

async function startAnvil(url) {
  mkdirSync(RUN_DIR, { recursive: true });
  const log = openSync(LOG_FILE, 'w');
  const args = ['--fork-url', url, '--chain-id', String(CHAIN_ID), '--port', String(PORT), '--host', '127.0.0.1'];
  if (process.env.FORK_BLOCK) args.push('--fork-block-number', process.env.FORK_BLOCK);
  const child = spawn('anvil', args, { detached: true, stdio: ['ignore', log, log], windowsHide: true });
  let exited = null;
  child.on('exit', (code) => (exited = code ?? -1));
  child.on('error', (e) => (exited = e.message));
  child.unref();
  writeFileSync(PID_FILE, String(child.pid));

  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (exited !== null) {
      throw new Error(`anvil exited (${exited}). Log tail:\n${redact(tail(LOG_FILE), url)}`);
    }
    if (await anvilUp()) return child.pid;
    await sleep(500);
  }
  throw new Error(`anvil did not answer on ${RPC_URL} within 180 s. Log tail:\n${redact(tail(LOG_FILE), url)}`);
}

function kill(pid) {
  if (process.platform === 'win32') {
    run('taskkill', ['/PID', String(pid), '/T', '/F'], { quiet: true });
  } else {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // already gone
    }
  }
}

function pidOnPort(port) {
  if (process.platform === 'win32') {
    const out = run('netstat', ['-ano', '-p', 'tcp'], { quiet: true }).stdout;
    const line = out.split(/\r?\n/).find((l) => l.includes(`:${port} `) && l.includes('LISTENING'));
    return line ? Number(line.trim().split(/\s+/).pop()) : 0;
  }
  const out = run('lsof', ['-t', `-iTCP:${port}`, '-sTCP:LISTEN'], { quiet: true }).stdout;
  return Number(out.trim().split(/\s+/)[0]) || 0;
}

// ------------------------------------------------------------------ the vault's seat

/**
 * The seat the vault is given: SEAT from the environment, or else the first token id from 1 whose
 * mainnet holder is a plain EOA, as test/fork/Metamorph.fork.t.sol picks one, passing over the keeper
 * fork test's seat.
 */
async function pickSeat() {
  const chosen = process.env.SEAT;
  if (chosen && !/^\d+$/.test(chosen)) throw new Error(`SEAT must be a token id, got ${chosen}`);
  const ids = chosen ? [Number(chosen)] : Array.from({ length: 399 }, (_, i) => i + 1).filter((id) => id !== KEEPER_TEST_SEAT);
  for (const id of ids) {
    let holder;
    try {
      [holder] = call(MAINNET.collection, 'ownerOf(uint256)(address)', id);
    } catch {
      continue; // not minted
    }
    if (chosen || !(await hasCode(holder))) return { seat: id, holder };
  }
  throw new Error(chosen ? `seat ${chosen} has no holder on the fork` : 'no seat among ids 1 to 399 is held by a plain EOA');
}

/**
 * Hands a seat to Cocoon as the fork test does with `vm.prank`: the holder, impersonated on the fork,
 * calls transferFrom (Cocoon takes a seat by safeTransferFrom only during a purchase), with 0.01 ETH
 * added for the gas when it holds less. DeployMetamorphLocal then adopts it at the fresh floor.
 */
async function handOver(seat, holder, vault) {
  if (holder.toLowerCase() === vault.toLowerCase()) return;
  await rpc('anvil_impersonateAccount', [holder]);
  try {
    const balance = BigInt(await rpc('eth_getBalance', [holder, 'latest']));
    if (balance < ETH / 100n) await rpc('anvil_setBalance', [holder, `0x${(balance + ETH / 100n).toString(16)}`]);
    send(holder, MAINNET.collection, 'transferFrom(address,address,uint256)', [holder, vault, seat]);
  } finally {
    await rpc('anvil_stopImpersonatingAccount', [holder]);
  }
}

// ------------------------------------------------------------------ forge

/** Runs a forge script against the fork from anvil's unlocked deployer and returns its stdout. */
function forgeScript(target, env) {
  const args = [
    'script',
    target,
    '--rpc-url',
    RPC_URL,
    '--broadcast',
    '--unlocked',
    '--sender',
    ACCOUNTS.deployer.address,
    '--non-interactive',
  ];
  const r = run('forge', args, { env, quiet: true });
  const out = `${r.stdout}\n${r.stderr}`;
  if (r.status !== 0) throw new Error(`forge ${target} failed (exit ${r.status})\n${out}`);
  const logs = out.match(/== Logs ==\s*([\s\S]*?)(?:\n\s*\n## |\n\s*\n==|\nSIMULATION|$)/);
  console.log((logs ? logs[1] : out).trimEnd().replace(/^/gm, '  '));
  return out;
}

function grab(out, label) {
  const m = out.match(new RegExp(`^\\s*${label}\\s+(0x[0-9a-fA-F]{40})\\s*$`, 'm'));
  if (!m) throw new Error(`could not find "${label} 0x..." in the script output`);
  return m[1];
}

/**
 * The transactions of a script's last broadcast with their gas used and block, as the node reports
 * them. With `--unlocked` the node signs, so the hashes forge pre-computes do not line up with the
 * receipts it stores; the nonce is what ties a receipt to the transaction forge described.
 */
async function broadcast(scriptFile) {
  const file = join(ROOT, 'broadcast', basename(scriptFile), String(CHAIN_ID), 'run-latest.json');
  const json = JSON.parse(readFileSync(file, 'utf8'));
  const byNonce = new Map();
  for (const t of json.transactions) {
    const tx = await rpc('eth_getTransactionByHash', [t.hash]);
    const receipt = tx && (await rpc('eth_getTransactionReceipt', [t.hash]));
    if (!tx || !receipt) throw new Error(`the node has no receipt for ${t.hash} (${scriptFile})`);
    byNonce.set(Number(tx.nonce), { gas: Number(receipt.gasUsed), block: Number(receipt.blockNumber) });
  }
  return json.transactions.map((t) => {
    const r = byNonce.get(Number(t.transaction.nonce)) || { gas: NaN, block: NaN };
    return {
      type: t.transactionType,
      name: t.contractName || '',
      fn: t.function || '',
      address: t.contractAddress || '',
      gas: r.gas,
      block: r.block,
    };
  });
}

function gasReport(all, baseFee) {
  console.log('\n  gas used (from the anvil receipts):');
  for (const [script, txs] of Object.entries(all)) {
    for (const t of txs) {
      const what = `${t.type} ${t.name}${t.fn ? ' ' + t.fn.replace(/\(.*$/, '()') : ''}`;
      console.log(`  ${script.padEnd(9)} ${what.padEnd(44)} ${String(t.gas).padStart(10)}  block ${t.block}`);
    }
  }
  const launch = all.launch;
  const tokenTx = launch.find((t) => t.type === 'CREATE' && t.name === 'PupateToken');
  const hookTx = launch.find((t) => t.name === 'PupateHook' && t.type !== 'CALL');
  const openTx = launch.find((t) => t.fn.startsWith('open('));
  const figures = { 'PupateToken deploy': tokenTx, 'PupateHook deploy (CREATE2)': hookTx, 'pool open + seed': openTx };
  console.log("\n  the launch transaction IMD pays for (its factory does these three in one):");
  let total = 0;
  for (const [name, t] of Object.entries(figures)) {
    const g = t ? t.gas : NaN;
    total += g || 0;
    console.log(`  ${name.padEnd(30)} ${String(g).padStart(10)}`);
  }
  console.log(`  ${'sum'.padEnd(30)} ${String(total).padStart(10)}  (docs/deployment.md estimates about 3.5M)`);
  const feeCeiling = total ? LAUNCH_GAS_CEILING_WEI / BigInt(total) : 0n;
  console.log(`  0.05 ETH ceiling / sum = ${fmtGwei(feeCeiling)} per gas; fork head base fee ${fmtGwei(baseFee)}` +
    ` -> at that fee the launch would cost ${fmtEth(baseFee * BigInt(total))}`);
}

// ------------------------------------------------------------------ small things

function step(title) {
  console.log(`\n== ${title}`);
}

/** Prints each [name, got, want] as ok or FAIL (compared as lower-case strings); returns the failures. */
function verify(checks) {
  let bad = 0;
  for (const [name, got, want] of checks) {
    const ok = String(got).toLowerCase() === String(want).toLowerCase();
    if (!ok) bad++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `: got ${got}, want ${want}`}`);
  }
  return bad;
}

function tail(file, lines = 25) {
  try {
    return readFileSync(file, 'utf8').split(/\r?\n/).slice(-lines).join('\n');
  } catch {
    return '(no log)';
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
