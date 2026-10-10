#!/usr/bin/env node
// Pupate's mainnet launch, step by step. Each step reads the chain first and refuses to repeat what
// is done, so the whole thing can be run again after any interruption. Steps that spend IMD say so
// and are run one at a time, on an explicit go. See README.md in this directory and docs/deployment.md.
//
//   node script/mainnet/launch.mjs status     balances, gas, what is done
//   node script/mainnet/launch.mjs pre        DeployPreLaunch: timelock, FloorFeed, Cocoon        (gas only)
//   node script/mainnet/launch.mjs question   Permit2 approval if needed, the oracle request, wait for
//                                             the attestation, keep questionHash                  (0.5 IMD)
//   node script/mainnet/launch.mjs manifest   fill launch.json, commit and push, free launch check (nothing)
//   node script/mainnet/launch.mjs open       launch.open, wait until the launch is live, verify   (0.5 IMD)
//   node script/mainnet/launch.mjs post       PostLaunch: wire, vest, pin the question, hand over  (gas only)
//   node script/mainnet/launch.mjs report     the first floor report, from the kept attestation    (gas only)
//   node script/mainnet/launch.mjs finish     keeper/addresses.mainnet.json, the site snippet, the links
//
// Environment, from .env or the environment: MAINNET_RPC_URL, KEEPER_PRIVATE_KEY (deployer, DEVELOPER,
// OPERATOR, the wallet that pays IMD), optional ETHERSCAN_API_KEY (source verification),
// MAX_BASE_FEE_GWEI (default 1: no transaction is sent above it). Nothing secret is ever printed.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { POOL_KEY, ROOT, castLocal, fmtEth, fmtGwei, readDotEnv, run } from '../local/common.mjs';
import { createImd } from '../../keeper/lib/imd.mjs';
import { findRequestId, mapApiAttestation, verifyAttestation } from '../../keeper/lib/oracle.mjs';

const CHAIN_ID = 1;
const MAINNET = {
  poolManager: '0x000000000004444c5dc75cB358380D2e3dE08A90',
  universalRouter: '0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af',
  quoter: '0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203',
  permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
  collection: '0x0000eC93127BAA929E58E97dd0095A2BFb38ec1D',
  imd: '0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7',
  seaport: '0x0000000000000068F116a894984e2DB1123eB395',
  attester: '0x5598Aa9146215Bc13eb26f2c692Ad1461Fd32982',
};
const REPO_URL = 'https://github.com/pupate-IMD/PUPATE';
const IMD_API = process.env.IMD_API || 'https://api.imd.fun';
const PROGRESS_FILE = join(tmpdir(), 'pupate-mainnet', 'progress.json');
const LAUNCH_DIR = join(ROOT, 'keeper', '.launch');
const ATTESTATION_FILE = join(LAUNCH_DIR, 'first-attestation.json');
const ADDRESSES_FILE = join(ROOT, 'keeper', 'addresses.mainnet.json');
const LAUNCH_JSON = join(ROOT, 'launch.json');
const CHECK_BODY = join(ROOT, 'keeper', 'questions', 'launch.check.json');
const QUOTE_BODY = join(ROOT, 'keeper', 'questions', 'floor.quote.json');
const DEVELOPER_SHARE_WEI = 50_000_000n * 10n ** 18n;
const HALF_IMD = 5n * 10n ** 17n;
const SEL = { balanceOf: '0x70a08231', openedAt: '0x38930203', totalSupply: '0x18160ddd' };

const dotenv = readDotEnv();
const env = (k) => process.env[k] || dotenv[k] || '';
const RPC = env('MAINNET_RPC_URL');
const KEY = env('KEEPER_PRIVATE_KEY');
const MAX_BASE_FEE_GWEI = Number(env('MAX_BASE_FEE_GWEI') || 1);
if (!RPC) fail('MAINNET_RPC_URL is not set');
if (!/^0x[0-9a-fA-F]{64}$/.test(KEY)) fail('KEEPER_PRIVATE_KEY is not set or not a 0x-prefixed 32-byte key');

const steps = { status, pre, question, manifest, open, post, report, finish };
const cmd = process.argv[2] || 'status';
if (!steps[cmd]) fail(`unknown step ${cmd}; one of: ${Object.keys(steps).join(', ')}`);
steps[cmd]().catch((e) => {
  console.error(`\n${cmd} failed: ${scrub(e.stack || e.message)}`);
  console.error(`progress: ${PROGRESS_FILE}`);
  process.exitCode = 1;
});

// ------------------------------------------------------------------ status

async function status() {
  const p = loadProgress();
  const deployer = castLocal('wallet', 'address', '--private-key', KEY);
  const balance = BigInt(await rpc('eth_getBalance', [deployer, 'latest']));
  const imd = BigInt(await rpc('eth_call', [{ to: MAINNET.imd, data: SEL.balanceOf + pad(deployer) }, 'latest']));
  const head = await rpc('eth_getBlockByNumber', ['latest', false]);
  console.log(`deployer ${deployer}: ${fmtEth(balance)}, ${fmtIMD(imd)} | block ${Number(head.number)}, base fee ${fmtGwei(BigInt(head.baseFeePerGas))} (cap ${MAX_BASE_FEE_GWEI} gwei)`);
  const done = ['cocoon', 'questionHash', 'baseCommit', 'token', 'vesting', 'reported', 'finished'].map((k) => `${k}:${p[k] ? 'done' : '-'}`);
  console.log(`steps: ${done.join('  ')}`);
  for (const [k, v] of Object.entries(p)) if (typeof v !== 'object') console.log(`  ${k.padEnd(14)} ${v}`);
}

// ------------------------------------------------------------------ pre

async function pre() {
  const p = loadProgress();
  const deployer = await ready(p);
  if (p.cocoon) {
    console.log(`already done: Cocoon ${p.cocoon}, FloorFeed ${p.feed}, timelock ${p.timelock}`);
    return;
  }
  step('DeployPreLaunch on mainnet (timelock, FloorFeed, Cocoon)');
  const out = forgeScript('script/DeployPreLaunch.s.sol:DeployPreLaunch', {
    DEVELOPER: deployer,
    OPERATOR: deployer,
    ORACLE_ATTESTER: MAINNET.attester,
    COLLECTION: MAINNET.collection,
    POOL_MANAGER: MAINNET.poolManager,
    IMD: MAINNET.imd,
    SEAPORT: MAINNET.seaport,
    EVIDENCE_CHAIN_ID: '1',
  });
  p.timelock = grab(out, 'TimelockController');
  p.feed = grab(out, 'FloorFeed');
  p.cocoon = grab(out, 'Cocoon');
  p.fromBlock = Math.min(...broadcastReceipts('DeployPreLaunch.s.sol').map((r) => r.block));
  p.deployer = deployer;
  saveProgress(p);
  await settled('the pre-launch contracts', async () => (await hasCode(p.cocoon)) && (await hasCode(p.feed)) && (await hasCode(p.timelock)));
  console.log(`Cocoon ${p.cocoon}\nFloorFeed ${p.feed}\nTimelock ${p.timelock}\nfrom block ${p.fromBlock}`);
}

// ------------------------------------------------------------------ question (0.5 IMD)

async function question() {
  const p = loadProgress();
  const deployer = await ready(p);
  if (!p.feed) throw new Error('run `pre` first');
  if (p.questionHash) {
    console.log(`already done: oracle request ${p.requestId}, questionHash ${p.questionHash}`);
    return;
  }

  step('Permit2 allowance for IMD (one-time)');
  const allowance = BigInt(await rpc('eth_call', [{ to: MAINNET.imd, data: '0xdd62ed3e' + pad(deployer) + pad(MAINNET.permit2) }, 'latest']));
  if (allowance < HALF_IMD) {
    const r = run('cast', ['send', MAINNET.imd, 'approve(address,uint256)', MAINNET.permit2, '5000000000000000000', '--rpc-url', RPC, '--private-key', KEY, '--json'], { quiet: true });
    if (r.status !== 0) throw new Error(`approve failed: ${scrub(r.stdout + r.stderr)}`);
    console.log('  approved 5 IMD to Permit2');
  } else {
    console.log(`  allowance already ${fmtIMD(allowance)}`);
  }

  step('the floor question, with FloorFeed as its consumer');
  imdCli(['floor-body', p.feed, '1']);
  const check = imdCli(['check', 'oracle.request', QUOTE_BODY], { json: true, allowExit: [0, 2] });
  if (check.blockers?.length) throw new Error(`IMD check has blockers: ${JSON.stringify(check.blockers).slice(0, 600)}`);
  console.log(`  free check passed (${check.quote?.amount ?? check.price ?? '0.5 IMD'})`);

  if (!p.requestId) {
    step('paying for the oracle request (0.5 IMD)');
    const order = imdCli(['request', 'oracle.request', QUOTE_BODY], { json: true, pay: true });
    p.orderId = order.id ?? order.orderId ?? null;
    p.requestId = findRequestId(order);
    saveProgress(p);
    if (!p.requestId) throw new Error(`cannot find the oracle request id in the admitted order (keys ${Object.keys(order).join(',')}); the order is ${p.orderId}`);
    console.log(`  admitted; oracle request ${p.requestId}`);
  }

  step('waiting for the panel and the attestation');
  const imd = createImd({ api: IMD_API });
  const until = Date.now() + 90 * 60_000;
  let json = null;
  while (Date.now() < until) {
    try {
      const j = await imd.oracleAttestation(p.requestId);
      if (j && (j.signature || j.sig || j.attestation?.signature)) {
        json = j;
        break;
      }
    } catch (e) {
      if (!(e.status && [202, 404, 409, 423, 425].includes(e.status))) throw e;
    }
    process.stdout.write('.');
    await sleep(20_000);
  }
  console.log('');
  if (!json) throw new Error('no attestation after 90 minutes; run `question` again later, it resumes with the same request');
  const signed = mapApiAttestation(json);
  const check2 = await verifyAttestation({ chainId: CHAIN_ID, feed: p.feed, attestation: signed.attestation, signature: signed.signature, attester: MAINNET.attester });
  if (check2 && check2.ok === false) throw new Error(`the attestation does not verify: ${JSON.stringify(check2).slice(0, 300)}`);
  mkdirSync(LAUNCH_DIR, { recursive: true });
  writeFileSync(ATTESTATION_FILE, JSON.stringify(json, null, 2));
  p.questionHash = signed.attestation.questionHash;
  p.floorWei = answerWei(signed.attestation.answer);
  saveProgress(p);
  console.log(`  questionHash ${p.questionHash}\n  floor ${fmtEth(p.floorWei)} (answer), issued ${new Date(Number(signed.attestation.issuedAt) * 1000).toISOString()}\n  kept in ${ATTESTATION_FILE}`);
}

// ------------------------------------------------------------------ manifest (free)

async function manifest() {
  const p = loadProgress();
  if (!p.cocoon) throw new Error('run `pre` first');
  step('launch.json with the Cocoon and timelock addresses');
  let text = readFileSync(LAUNCH_JSON, 'utf8');
  const filled = text.replace('<COCOON_ADDRESS>', p.cocoon).replace('<TIMELOCK_ADDRESS>', p.timelock);
  if (filled !== text) {
    writeFileSync(LAUNCH_JSON, filled);
    text = filled;
    git(['add', 'launch.json']);
    git(['commit', '-q', '-m', 'launch manifest: the Cocoon and timelock addresses on mainnet']);
    console.log('  committed');
  }
  if (!text.includes(p.cocoon) || !text.includes(p.timelock)) throw new Error('launch.json does not carry the addresses');
  git(['push']);
  const head = git(['rev-parse', 'HEAD']).trim();
  const remote = git(['ls-remote', 'origin', 'HEAD']).split(/\s+/)[0];
  if (remote !== head) throw new Error(`origin HEAD ${remote} is not local HEAD ${head}; push first`);

  step(`launch request body with baseCommit ${head.slice(0, 10)}`);
  const body = JSON.parse(readFileSync(CHECK_BODY, 'utf8'));
  body.input.repoUrl = REPO_URL;
  body.input.baseCommit = head;
  writeFileSync(CHECK_BODY, JSON.stringify(body, null, 2) + '\n');
  p.baseCommit = head;
  saveProgress(p);

  step('the free launch check');
  const check = imdCli(['check', 'launch.open', CHECK_BODY], { json: true, allowExit: [0, 2] });
  if (check.blockers?.length) throw new Error(`the launch check has blockers:\n${JSON.stringify(check.blockers, null, 2).slice(0, 1500)}`);
  console.log(`  no blockers (${check.quote?.amount ?? check.price ?? '0.5 IMD'})`);
  if (check.warnings?.length) console.log(`  warnings: ${JSON.stringify(check.warnings).slice(0, 600)}`);
}

// ------------------------------------------------------------------ open (0.5 IMD)

async function open() {
  const p = loadProgress();
  const deployer = await ready(p, { gasGuard: false });
  if (!p.baseCommit) throw new Error('run `manifest` first');
  if (p.token) {
    console.log(`already done: token ${p.token}, hook ${p.hook}, launch ${p.launchNumber ?? p.launchId}`);
    return;
  }
  if (!p.launchOrderId) {
    step('paying for the launch (0.5 IMD)');
    const order = imdCli(['request', 'launch.open', CHECK_BODY], { json: true, pay: true });
    p.launchOrderId = order.id ?? order.orderId ?? null;
    p.launchOrder = order;
    saveProgress(p);
    console.log(`  admitted: order ${p.launchOrderId}`);
  }

  step('waiting for the swarm: review, deploy, open the pool');
  const until = Date.now() + 6 * 3600_000;
  let last = '';
  let launch = null;
  while (Date.now() < until) {
    const found = await findLaunch(p.baseCommit);
    if (found) {
      const line = `${found.status}${found.parkedReason ? ` (${found.parkedReason})` : ''} · launch #${found.launchNumber} ${found.id}`;
      if (line !== last) {
        console.log(`  ${new Date().toISOString()} ${line}`);
        last = line;
      }
      if (found.status === 'parked') throw new Error(`IMD parked the launch: ${found.parkedReason}. Fix what it names, commit, run manifest and open again.`);
      if (found.status === 'live' && (found.artifacts || []).some((a) => a.role === 'hook')) {
        launch = found;
        break;
      }
    } else if (last !== 'not listed yet') {
      console.log(`  ${new Date().toISOString()} not listed yet`);
      last = 'not listed yet';
    }
    await sleep(30_000);
  }
  if (!launch) throw new Error('the launch is not live after 6 hours; run `open` again, it resumes');
  const token = launch.artifacts.find((a) => a.role === 'token')?.address;
  const hook = launch.artifacts.find((a) => a.role === 'hook')?.address;
  if (!token || !hook) throw new Error(`the launch record has no token or hook artifact: ${JSON.stringify(launch.artifacts)}`);

  step('checking the launch on-chain');
  const checks = [
    ['hook.sink() is Cocoon', call(hook, 'sink()(address)')[0], p.cocoon],
    ['hook.owner() is the timelock', call(hook, 'owner()(address)')[0], p.timelock],
    ['token.totalSupply() is 1e27', call(token, 'totalSupply()(uint256)')[0], String(10n ** 27n)],
  ];
  let bad = 0;
  for (const [name, got, want] of checks) {
    const ok = String(got).toLowerCase() === String(want).toLowerCase();
    if (!ok) bad++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `: got ${got}, want ${want}`}`);
  }
  const opened = BigInt(await rpc('eth_call', [{ to: hook, data: SEL.openedAt }, 'latest']));
  console.log(`  ${opened !== 0n ? 'ok  ' : 'FAIL'} hook.openedAt() ${opened}`);
  if (opened === 0n) bad++;
  const mine = BigInt(await rpc('eth_call', [{ to: token, data: SEL.balanceOf + pad(deployer) }, 'latest']));
  console.log(`  deployer holds ${fmtPupate(mine)} (5% expected for PostLaunch to vest)`);
  if (bad) throw new Error(`${bad} launch check(s) failed; nothing recorded`);
  p.token = token;
  p.hook = hook;
  p.launchId = launch.id;
  p.launchNumber = launch.launchNumber;
  p.artifacts = launch.artifacts;
  saveProgress(p);
  console.log(`token ${token}\nhook ${hook}\nlaunch #${launch.launchNumber} ${launch.id}`);
}

// ------------------------------------------------------------------ post

async function post() {
  const p = loadProgress();
  const deployer = await ready(p);
  if (!p.token || !p.questionHash) throw new Error('run `open` and `question` first');
  if (p.vesting) {
    console.log(`already done: vesting ${p.vesting}`);
    return;
  }
  step('waiting for the launch to be final and the 5% to be with the deployer');
  await settled('the launch', async () => {
    const bal = BigInt(await rpc('eth_call', [{ to: p.token, data: SEL.balanceOf + pad(deployer) }, 'latest']));
    const opened = BigInt(await rpc('eth_call', [{ to: p.hook, data: SEL.openedAt }, 'latest']));
    return near(bal, DEVELOPER_SHARE_WEI) && opened !== 0n;
  });
  step('PostLaunch (wire, vest, pin the question, hand over to the timelock)');
  const out = forgeScript('script/PostLaunch.s.sol:PostLaunch', {
    COCOON: p.cocoon,
    FEED: p.feed,
    TIMELOCK: p.timelock,
    TOKEN: p.token,
    HOOK: p.hook,
    DEVELOPER: deployer,
    QUESTION_HASH: p.questionHash,
    POOL_FEE: String(POOL_KEY.fee),
    TICK_SPACING: String(POOL_KEY.tickSpacing),
    ...(process.env.VESTING ? { VESTING: process.env.VESTING } : {}),
  });
  p.vesting = grab(out, 'PupateVesting');
  saveProgress(p);
  await settled('the post-launch wiring', async () => String(call(p.cocoon, 'wired()(bool)')[0]) === 'true' && (await hasCode(p.vesting)));
  console.log(`vesting ${p.vesting}`);
}

// ------------------------------------------------------------------ report

async function report() {
  const p = loadProgress();
  await ready(p);
  if (!p.vesting) throw new Error('run `post` first');
  if (p.reported) {
    console.log('already done');
    return;
  }
  const fresh = String(call(p.feed, 'latest()(uint256,bool)')[1]) === 'true';
  if (fresh) {
    console.log('the feed already has a fresh report');
    p.reported = true;
    saveProgress(p);
    return;
  }
  step('the first floor report, from the attestation the oracle request produced');
  const json = JSON.parse(readFileSync(ATTESTATION_FILE, 'utf8'));
  const signed = mapApiAttestation(json);
  const a = signed.attestation;
  const tuple = `(${a.requestId},${a.chainId},${a.questionHash},${a.answerType},${a.answer},${a.figure},${a.fromBlock},${a.toBlock},${a.blockHash},${a.panelJobId},${a.panelSize},${a.quorum},${a.agreed},${a.issuedAt},${a.expiresAt})`;
  const sig = 'report((bytes32,uint256,bytes32,uint8,bytes,uint256,uint64,uint64,bytes32,bytes32,uint8,uint8,uint8,uint64,uint64),bytes)';
  const r = run('cast', ['send', p.feed, sig, tuple, signed.signature, '--rpc-url', RPC, '--private-key', KEY, '--json'], { quiet: true });
  if (r.status !== 0) throw new Error(`report failed: ${scrub(r.stdout + r.stderr)}`);
  const receipt = JSON.parse(r.stdout);
  console.log(`  ${receipt.transactionHash} status ${receipt.status} gas ${Number(receipt.gasUsed)}`);
  await settled('the first report', async () => String(call(p.feed, 'latest()(uint256,bool)')[1]) === 'true');
  p.reported = true;
  saveProgress(p);
  console.log(`  feed.latest() = ${call(p.feed, 'latest()(uint256,bool)').join(', ')}`);
}

// ------------------------------------------------------------------ finish

async function finish() {
  const p = loadProgress();
  if (!p.reported) throw new Error('run `report` first');
  const addresses = {
    chainId: CHAIN_ID,
    fromBlock: p.fromBlock,
    token: p.token,
    hook: p.hook,
    cocoon: p.cocoon,
    feed: p.feed,
    timelock: p.timelock,
    vesting: p.vesting,
    poolManager: MAINNET.poolManager,
    universalRouter: MAINNET.universalRouter,
    quoter: MAINNET.quoter,
    permit2: MAINNET.permit2,
    collection: MAINNET.collection,
    imd: MAINNET.imd,
    seaport: MAINNET.seaport,
    poolKey: { fee: POOL_KEY.fee, tickSpacing: POOL_KEY.tickSpacing },
    attester: MAINNET.attester,
    launchId: p.launchId,
    launchNumber: p.launchNumber,
    oracleRequestId: p.requestId,
  };
  writeFileSync(ADDRESSES_FILE, JSON.stringify(addresses, null, 2) + '\n');
  p.finished = true;
  saveProgress(p);
  console.log(`wrote ${ADDRESSES_FILE}\n`);
  console.log('site/lib/addresses.ts, MAINNET:');
  console.log(`export const MAINNET: Addresses | null = {
  chainId: 1,
  fromBlock: ${p.fromBlock},
  token: "${p.token}",
  hook: "${p.hook}",
  cocoon: "${p.cocoon}",
  feed: "${p.feed}",
  timelock: "${p.timelock}",
  vesting: "${p.vesting}",
  poolManager: UNISWAP[1].poolManager,
  universalRouter: UNISWAP[1].universalRouter,
  quoter: UNISWAP[1].quoter,
  permit2: PERMIT2,
  collection: COLLECTION,
  imd: IMD,
  seaport: SEAPORT,
  poolKey: { fee: 12500, tickSpacing: 60 },
};`);
  console.log(`\nlinks:
  token      https://etherscan.io/token/${p.token}
  hook       https://etherscan.io/address/${p.hook}
  Cocoon     https://etherscan.io/address/${p.cocoon}
  FloorFeed  https://etherscan.io/address/${p.feed}
  launch     https://explorer.imd.fun/launches (launch #${p.launchNumber}, id ${p.launchId})
  Uniswap    https://app.uniswap.org/explore/tokens/ethereum/${p.token}
  buy        https://pupate.fun/buy/`);
}

// ------------------------------------------------------------------ shared

/** The deployer address, after the chain id, the balance and (unless told otherwise) the base fee pass. */
async function ready(p, { gasGuard = true } = {}) {
  const chainId = Number(await rpc('eth_chainId'));
  if (chainId !== CHAIN_ID) throw new Error(`MAINNET_RPC_URL answers with chain id ${chainId}`);
  const deployer = castLocal('wallet', 'address', '--private-key', KEY);
  if (p.deployer && p.deployer.toLowerCase() !== deployer.toLowerCase()) throw new Error(`the key in .env is ${deployer}, but this launch was started by ${p.deployer}`);
  const head = await rpc('eth_getBlockByNumber', ['latest', false]);
  const baseFee = BigInt(head.baseFeePerGas);
  const balance = BigInt(await rpc('eth_getBalance', [deployer, 'latest']));
  console.log(`mainnet block ${Number(head.number)}, base fee ${fmtGwei(baseFee)}; ${deployer} holds ${fmtEth(balance)}`);
  if (gasGuard && baseFee > BigInt(Math.round(MAX_BASE_FEE_GWEI * 1e9))) {
    throw new Error(`base fee ${fmtGwei(baseFee)} is above the ${MAX_BASE_FEE_GWEI} gwei cap; wait, or raise MAX_BASE_FEE_GWEI knowingly`);
  }
  if (balance < 2n * 10n ** 15n) throw new Error(`the deployer holds ${fmtEth(balance)}; keep at least 0.002 ETH for gas`);
  return deployer;
}

async function findLaunch(commit) {
  const res = await fetch(`${IMD_API}/launches?limit=100`);
  if (!res.ok) return null;
  const j = await res.json();
  const list = j.launches || j;
  return list.find((l) => String(l.sourceRepoUrl || '').toLowerCase().replace(/\.git$/, '') === REPO_URL.toLowerCase() && String(l.sourceCommit || '').toLowerCase() === commit.toLowerCase()) || null;
}

/** keeper/bin/imd.mjs as a child, with the key in its environment only when it has to pay. */
function imdCli(args, { json = false, pay = false, allowExit = [0] } = {}) {
  const r = run(process.execPath, [join(ROOT, 'keeper', 'bin', 'imd.mjs'), ...args], {
    cwd: join(ROOT, 'keeper'),
    env: pay ? { KEEPER_PRIVATE_KEY: KEY, PAYMENT_CHAIN_ID: '1', IMD_API } : { IMD_API },
    quiet: true,
  });
  if (r.stderr.trim()) console.log(scrub(r.stderr).trimEnd().replace(/^/gm, '  '));
  if (!allowExit.includes(r.status)) throw new Error(`imd ${args.slice(0, 2).join(' ')} failed (exit ${r.status})\n${scrub(r.stdout + r.stderr).slice(0, 2000)}`);
  if (!json) return r.stdout;
  const start = r.stdout.indexOf('{');
  return JSON.parse(r.stdout.slice(start));
}

function forgeScript(target, scriptEnv) {
  const args = ['script', target, '--rpc-url', RPC, '--broadcast', '--private-key', KEY, '--slow', '--non-interactive', '--gas-estimate-multiplier', '130', '--retries', '10', '--delay', '8'];
  if (env('ETHERSCAN_API_KEY')) args.push('--verify', '--etherscan-api-key', env('ETHERSCAN_API_KEY'));
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

function broadcastReceipts(scriptFile) {
  const file = join(ROOT, 'broadcast', basename(scriptFile), String(CHAIN_ID), 'run-latest.json');
  const json = JSON.parse(readFileSync(file, 'utf8'));
  const byHash = new Map((json.receipts || []).map((r) => [r.transactionHash.toLowerCase(), r]));
  return json.transactions.map((t) => {
    const r = t.hash ? byHash.get(String(t.hash).toLowerCase()) : null;
    return { block: r ? Number(r.blockNumber) : NaN, gas: r ? BigInt(r.gasUsed) : 0n };
  });
}

function git(args) {
  const r = run('git', args, { quiet: true });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stdout}${r.stderr}`);
  return r.stdout;
}

function call(to, sig, ...args) {
  const out = run('cast', ['call', to, sig, ...args.map(String), '--rpc-url', RPC]).stdout.trim();
  return out.split(/\r?\n/).map((line) => line.replace(/\s+\[[^\]]*\]\s*$/, '').trim()).filter((line) => line.length);
}

async function rpc(method, params = []) {
  const res = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const json = await res.json();
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result;
}

async function hasCode(address) {
  const code = await rpc('eth_getCode', [address, 'latest']);
  return Boolean(code) && code !== '0x';
}

async function settled(what, predicate, { timeoutMs = 300_000, everyMs = 6_000 } = {}) {
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

function loadProgress() {
  return existsSync(PROGRESS_FILE) ? JSON.parse(readFileSync(PROGRESS_FILE, 'utf8')) : {};
}

function saveProgress(p) {
  mkdirSync(join(tmpdir(), 'pupate-mainnet'), { recursive: true });
  writeFileSync(PROGRESS_FILE, JSON.stringify(p, null, 2));
  mkdirSync(LAUNCH_DIR, { recursive: true });
  writeFileSync(join(LAUNCH_DIR, 'progress.json'), JSON.stringify(p, null, 2));
}

const pad = (address) => address.slice(2).toLowerCase().padStart(64, '0');
const fmtIMD = (wei) => `${(Number(wei) / 1e18).toFixed(3)} IMD`;
const fmtPupate = (wei) => `${(Number(wei) / 1e18).toLocaleString('en-US')} PUPATE`;

function answerWei(answerBytes) {
  try {
    return BigInt(answerBytes);
  } catch {
    return 0n;
  }
}

function near(got, want) {
  try {
    const d = BigInt(got) - BigInt(want);
    return (d < 0n ? -d : d) <= 10n ** 18n;
  } catch {
    return false;
  }
}

function scrub(text) {
  let out = String(text);
  for (const secret of [RPC, KEY, env('ETHERSCAN_API_KEY')]) {
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
