#!/usr/bin/env node
// The keeper's mine duties against the local mainnet fork. Precondition: a fresh `node script/local/up.mjs`
// (Metamorph MD at one bit, the vault's one seat noted, nothing minted; keeper/test/fork.mjs and the site's
// `npm run mine-check` change the stack, so bring a new one up before this test). Then:
//   (1) keeper --once: the seat up.mjs noted is noted, so noteSeats idles, and so do forgetSeats, convert, poke
//   (2) the holder of a second seat hands it to Cocoon and anvil #4 adopts it, as up.mjs gives the vault its
//       seat; keeper --once notes it
//   (3) anvil #5 mints, the clock moved on 100 s before each mint so the difficulty stays at one bit, until the
//       pot holds CONVERT_PRICES / 5 mint prices (no test-only threshold: the real one); anvil #1 buys PUPATE for
//       2 ETH through the Universal Router (the launch pool opened single-sided, so the pot can only be sold
//       into ETH that buyers paid in); anvil #5 stakes a card of the second seat
//   (4) keeper --once converts: the gas limit is the estimate + 1,000,000 and the caller's IMD reaches the
//       keeper; poke idles, the staked card weighs what its stage does
//   (5) anvil #4 buys the second seat from Cocoon's falling order: the staked card emerges
//   (6) keeper --once --dry-run prints the four decisions and sends nothing
//   (7) keeper --once settles the second seat, forgets it and pokes the card to weight 2
//   (8) a buy and a sale in one tick (the plan's Review Focus 4): anvil #4 buys the first seat from Cocoon, the
//       holder of seat 1376 lists it at the floor, anvil #3 funds the seat pot; the keeper's own state read
//       counts the sold seat out of the vault although its logs still hold it; keeper --once settles it, buys
//       #1376, notes #1376 and forgets the sold seat, all in the one tick
//   (9) keeper --once: nothing left to note, forget or poke
//  (10) the refusals: the keeper's own noteSeats and forgetSeats, run here in a dry run on states made stale
//       on purpose, meet SeatNotHeld, SeatHeld and SeatNotNoted in the simulation, log each by name and skip it
// The keeper runs as a child process as anvil #2 with ATTESTATION_SOURCE=local (anvil #9 signs),
// LISTING_SOURCE=file, its status feed in keeper/.state/metamorph-status, and a stand-in for IMD's seat API
// (404 for every seat, so the work feed is written without calling IMD). The keeper's seat cache for chain
// 31337 is cleared first, so the replay starts at FROM_BLOCK. Prints PASS/FAIL per assertion and the gas of
// every transaction the keeper sent; exits non-zero on a failure. anvil's keys are derived from its public
// mnemonic and passed to the keeper's environment only, never printed.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import {
  concatHex,
  createPublicClient,
  createTestClient,
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  http,
  isAddressEqual,
  keccak256,
  maxUint256,
  parseAbi,
  parseEther,
  parseEventLogs,
  toHex,
  zeroAddress,
  zeroHash,
} from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { cocoonAbi, erc20Abi, erc721Abi, metamorphAbi, seaportAbi, universalRouterAbi } from '../lib/abi.mjs';
import { createTx } from '../lib/chain.mjs';
import { KEEPER_ROOT, REPO_ROOT, STATE_DIR, loadConfig } from '../lib/config.mjs';
import { seatOrders, seatParameters, startPrice } from '../lib/listings.mjs';
import { fmtEth, fmtTokens, jsonSafe } from '../lib/log.mjs';
import { CONVERT_PAD, CONVERT_SHARE, forgetSeats, forgetSeatsDecision, noteSeats, noteSeatsDecision } from '../lib/metamorph.mjs';
import { loadCache, readState, syncSeats, syncStakes } from '../lib/state.mjs';

const RPC = `http://127.0.0.1:${process.env.ANVIL_PORT || 8545}`;
const ADDRESSES_FILE = process.env.ADDRESSES || join(REPO_ROOT, 'site', 'public', 'addresses.local.json');
const LISTINGS_FILE = join(STATE_DIR, 'metamorph-listings.json');
const STATUS_DIR = join(STATE_DIR, 'metamorph-status');
const SEAT_CACHE = join(STATE_DIR, '31337.json');
/// The seat keeper/test/fork.mjs lists and buys; up.mjs keeps it out of the vault, and step (8) buys it.
const LISTED = 1376n;
const MNEMONIC = 'test test test test test test test test test test test junk';
const DAY = 86_400n;
const E18 = 10n ** 18n;
/// What workHash encodes, in order (MetamorphMD.workHash).
const WORK = [{ type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }, { type: 'bytes32' }, { type: 'address' }, { type: 'uint256' }];
const PAIR = [{ type: 'bytes32' }, { type: 'bytes32' }];
/// PUPATE as the test moves it: the keeper's ERC-20 slice and `transfer`, which the keeper never calls.
const tokenAbi = [...erc20Abi, ...parseAbi(['function transfer(address to, uint256 amount) returns (bool)'])];

const chain = { ...foundry, id: 31337 };
const pub = createPublicClient({ chain, transport: http(RPC), pollingInterval: 200 });
const anvil = createTestClient({ chain, mode: 'anvil', transport: http(RPC) });

// anvil's default accounts, by index. The keys stay inside the child process environment.
const account = (i) => mnemonicToAccount(MNEMONIC, { addressIndex: i });
const keyOf = (i) => toHex(account(i).getHdKey().privateKey);
const TRADER = account(1).address;
const KEEPER = account(2).address;
const FUNDER = account(3).address;
const BUYER = account(4).address;
const MINER = account(5).address;
const SWARM = account(8).address; // the swarm share's stand-in: 100M PUPATE after up.mjs
const ATTESTER = account(9).address;

let failed = 0;
const gasRows = [];
let imd = null; // the stand-in for IMD's seat API

function check(name, ok, detail = '') {
  if (!ok) failed++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

function section(title) {
  console.log(`\n== ${title}`);
}

main()
  .then(
    () => {
      section('summary');
      if (gasRows.length) {
        console.log('  gas used by the keeper, per action:');
        for (const g of gasRows) console.log(`    ${g.step.padEnd(5)} ${g.action.padEnd(72)} ${String(g.gas).padStart(9)}`);
      }
      console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
      return failed ? 1 : 0;
    },
    (e) => {
      console.error(`\nmine test failed: ${e.shortMessage || e.message}`);
      if (e.cause?.shortMessage) console.error(e.cause.shortMessage);
      return 1;
    },
  )
  .then((code) => {
    if (imd) imd.close();
    process.exit(code);
  });

// ------------------------------------------------------------------ helpers

/** eth_sendTransaction from one of anvil's unlocked (or impersonated) accounts. */
function walletOf(address) {
  return createWalletClient({ account: address, chain, transport: http(RPC) });
}

// anvil's own gas estimate is tight, so a test transaction carries a 50% buffer, or `pad` gas over the
// estimate (a mint, so that the duties it may run are never starved).
async function writeAs(from, args, pad = null) {
  const estimate = await pub.estimateContractGas({ ...args, account: from });
  const gas = pad === null ? (estimate * 15n) / 10n : estimate + pad;
  const hash = await walletOf(from).writeContract({ ...args, account: from, chain, gas });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`${args.functionName} from ${from} reverted (${hash})`);
  return receipt;
}

async function sendAs(from, tx) {
  const gas = ((await pub.estimateGas({ ...tx, account: from })) * 15n) / 10n;
  const hash = await walletOf(from).sendTransaction({ ...tx, account: from, chain, gas });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`transaction from ${from} reverted (${hash})`);
  return receipt;
}

const read = (address, abi, functionName, args = []) => pub.readContract({ address, abi, functionName, args });
const tags = (ids) => ids.map((id) => `#${id}`).join(' ');
const sameIds = (xs, ys) => xs.length === ys.length && xs.every((x, i) => BigInt(x) === BigInt(ys[i]));
const sorted = (xs) => [...xs].map(BigInt).sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
const sentLines = (out) => [...out.matchAll(/\] sent (.+?) -> 0x[0-9a-fA-F]{64}/g)].map((m) => m[1]);

/** The keeper's environment: anvil #2 as the keeper, local reports, listings from a file, the feed here. */
function keeperEnv(imdApi) {
  return {
    RPC,
    ADDRESSES: ADDRESSES_FILE,
    KEEPER_PRIVATE_KEY: keyOf(2),
    ATTESTATION_SOURCE: 'local',
    LOCAL_ATTESTER_KEY: keyOf(9),
    LOCAL_FLOOR_WEI: '2.8e18',
    LISTING_SOURCE: 'file',
    LISTINGS_FILE,
    GAS_PRICE_CAP_GWEI: '1000',
    STATUS_DIR,
    IMD_API: imdApi,
  };
}
let ENV = null;

/**
 * Runs the keeper as a child process (asynchronously, so the stand-in IMD API in this process can answer)
 * and returns its output; records the gas of every transaction it sent.
 */
function keeper(step, args) {
  const env = { ...process.env, ...ENV };
  delete env.DRY_RUN;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(KEEPER_ROOT, 'bin', 'keeper.mjs'), ...args], { cwd: KEEPER_ROOT, env, windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('error', reject);
    child.on('close', (code) => {
      console.log(out.trimEnd().replace(/^/gm, '    | '));
      if (code !== 0) return reject(new Error(`keeper ${args.join(' ')} exited with ${code}`));
      for (const m of out.matchAll(/ sent (.+?) -> 0x[0-9a-fA-F]{64} \(gas (\d+), block \d+\)/g)) gasRows.push({ step, action: m[1], gas: Number(m[2]) });
      resolve(out);
    });
  });
}

/** The status feed the keeper wrote after its last tick. */
const statusFile = () => JSON.parse(readFileSync(join(STATUS_DIR, 'status.json'), 'utf8'));

/** Metamorph MD's view `fn`. */
let mdAt = null;
const md = (fn, args = []) => read(mdAt, metamorphAbi, fn, args);

/**
 * One mint from `miner`: the clock moved on 100 s first (a mint more than TARGET_INTERVAL after the last
 * one never makes the next harder, so the stack stays at one bit), a nonce found here with the contract's
 * own workHash encoding against effectiveTarget, then mint(anchor, nonce) one block behind the head.
 * Returns the Minted event's arguments.
 */
async function mintOne(miner) {
  await anvil.increaseTime({ seconds: 100 });
  const head = await pub.getBlock();
  const anchor = head.number - 1n;
  const [{ hash: anchorHash }, domain, prevWork, target] = await Promise.all([
    pub.getBlock({ blockNumber: anchor }),
    md('DOMAIN'),
    md('prevWork'),
    md('effectiveTarget'),
  ]);
  const folded = keccak256(encodeAbiParameters(PAIR, [anchorHash, prevWork]));
  let nonce = BigInt(toHex(randomBytes(16)));
  while (BigInt(keccak256(encodeAbiParameters(WORK, [domain, 31337n, mdAt, folded, miner, nonce]))) >= target) nonce += 1n;
  const receipt = await writeAs(miner, { address: mdAt, abi: metamorphAbi, functionName: 'mint', args: [anchor, nonce] }, 1_200_000n);
  const [ev] = parseEventLogs({ abi: metamorphAbi, eventName: 'Minted', logs: receipt.logs });
  return ev.args;
}

/** The first seat from `start` held by a plain EOA, other than those in `skip`: its holder can hand it over. */
async function seatOfAnEoa(a, start, skip) {
  for (let id = start; id < start + 400n; id++) {
    if (skip.includes(id)) continue;
    let holder;
    try {
      holder = await read(a.collection, erc721Abi, 'ownerOf', [id]);
    } catch {
      continue; // not minted
    }
    if (isAddressEqual(holder, a.cocoon)) continue;
    const code = await pub.getCode({ address: holder });
    if (!code || code === '0x') return { seat: id, holder };
  }
  throw new Error(`no seat from ${start} on is held by a plain EOA`);
}

/** The holder, impersonated, sends the seat to Cocoon with transferFrom (as up.mjs does); `by` adopts it. */
async function handOver(a, seat, holder, by) {
  await anvil.impersonateAccount({ address: holder });
  try {
    const balance = await pub.getBalance({ address: holder });
    if (balance < parseEther('0.05')) await anvil.setBalance({ address: holder, value: balance + parseEther('0.05') });
    await writeAs(holder, { address: a.collection, abi: erc721Abi, functionName: 'transferFrom', args: [holder, a.cocoon, seat] });
  } finally {
    await anvil.stopImpersonatingAccount({ address: holder });
  }
  return writeAs(by, { address: a.cocoon, abi: cocoonAbi, functionName: 'adopt', args: [seat] });
}

/** `buyer` fills Cocoon's falling order for `seat` at its start price (Seaport refunds the difference). */
async function buyFromCocoon(a, seat, buyer) {
  const t = await read(a.cocoon, cocoonAbi, 'seats', [seat]);
  const terms = { cost: t[0], boughtAt: t[1], startX: t[2], endX: t[3], decay: t[4], round: t[6] };
  const [falling] = seatOrders(a.cocoon, a.collection, seat, terms);
  return writeAs(buyer, {
    address: a.seaport,
    abi: seaportAbi,
    functionName: 'fulfillAdvancedOrder',
    args: [{ parameters: falling.parameters, numerator: 1n, denominator: 1n, signature: '0x', extraData: '0x' }, [], zeroHash, buyer],
    value: startPrice(terms),
  });
}

/** Universal Router calldata for one exact-input v4 swap, as keeper/test/fork.mjs builds it. */
function v4Swap({ key, zeroForOne, amountIn, deadline }) {
  const poolKeyType = {
    type: 'tuple',
    components: [
      { name: 'currency0', type: 'address' },
      { name: 'currency1', type: 'address' },
      { name: 'fee', type: 'uint24' },
      { name: 'tickSpacing', type: 'int24' },
      { name: 'hooks', type: 'address' },
    ],
  };
  const swapParams = {
    type: 'tuple',
    components: [
      { name: 'poolKey', ...poolKeyType },
      { name: 'zeroForOne', type: 'bool' },
      { name: 'amountIn', type: 'uint128' },
      { name: 'amountOutMinimum', type: 'uint128' },
      { name: 'hookData', type: 'bytes' },
    ],
  };
  const swap = encodeAbiParameters([swapParams], [{ poolKey: key, zeroForOne, amountIn, amountOutMinimum: 0n, hookData: '0x' }]);
  const currencyIn = zeroForOne ? key.currency0 : key.currency1;
  const currencyOut = zeroForOne ? key.currency1 : key.currency0;
  const settleAll = encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [currencyIn, amountIn]);
  const takeAll = encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [currencyOut, 0n]);
  const actions = concatHex(['0x06', '0x0c', '0x0f']);
  const input = encodeAbiParameters([{ type: 'bytes' }, { type: 'bytes[]' }], [actions, [swap, settleAll, takeAll]]);
  return encodeFunctionData({ abi: universalRouterAbi, functionName: 'execute', args: ['0x10', [input], deadline] });
}

/** Metamorph MD's `name` events after block `after`: none when no block came since. */
async function eventsAfter(name, after) {
  const head = await pub.getBlockNumber({ cacheTime: 0 });
  if (head <= after) return [];
  return pub.getLogs({ address: mdAt, event: mdEvent(name), fromBlock: after + 1n, toBlock: head });
}

/** Runs `fn` with console.log collected (the keeper's log() writes there); returns its result and the lines. */
async function captured(fn) {
  const lines = [];
  const real = console.log;
  console.log = (...xs) => lines.push(xs.join(' '));
  try {
    return { r: await fn(), out: lines.join('\n') };
  } finally {
    console.log = real;
  }
}

/** The keeper's own load, in this process: its seat cache file, synced to the head (not saved), and readState. */
async function keeperState(a) {
  const saved = {};
  for (const [k, v] of Object.entries(ENV)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  let cfg;
  try {
    cfg = loadConfig([]);
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
  const cache = loadCache(cfg.stateFile, cfg.chainId, cfg.addresses.cocoon, cfg.fromBlock);
  const head = await pub.getBlockNumber({ cacheTime: 0 });
  await syncSeats({ pub, cocoon: a.cocoon, fromBlock: cfg.fromBlock, toBlock: head, cache, chunk: cfg.logChunk });
  await syncStakes({ pub, metamorph: a.metamorph, fromBlock: cfg.fromBlock, toBlock: head, cache, chunk: cfg.logChunk });
  const s = await readState({ pub, cfg, cache, keeperAddress: KEEPER });
  return { cfg, cache, s };
}

const mdEvent = (name) => metamorphAbi.find((x) => x.type === 'event' && x.name === name);
const quiet = (out) => !sentLines(out).some((l) => /^(noteSeat|forgetSeat|convert|poke) /.test(l));

// ------------------------------------------------------------------ the test

async function main() {
  section('preconditions');
  const chainId = await pub.getChainId().catch(() => 0);
  if (chainId !== 31337) throw new Error(`nothing answers on ${RPC} with chain id 31337: run node script/local/up.mjs`);
  if (!existsSync(ADDRESSES_FILE)) throw new Error(`${ADDRESSES_FILE} is missing: run node script/local/up.mjs`);
  const a = JSON.parse(readFileSync(ADDRESSES_FILE, 'utf8'));
  if (!a.metamorph) throw new Error(`${ADDRESSES_FILE} names no metamorph: run node script/local/up.mjs from this checkout`);
  mdAt = a.metamorph;
  console.log(`  cocoon ${a.cocoon} metamorph ${a.metamorph}`);
  console.log(`  keeper #2 ${KEEPER}, funder #3 ${FUNDER}, buyer #4 ${BUYER}, miner #5 ${MINER}, PUPATE from #8 ${SWARM}, attester #9 ${ATTESTER}`);
  const [noted0, minted0, held0, listedOwner] = await Promise.all([
    md('notedSeats'),
    md('totalMinted'),
    read(a.cocoon, cocoonAbi, 'heldCount'),
    read(a.collection, erc721Abi, 'ownerOf', [LISTED]),
  ]);
  const fresh = noted0.length === 1 && minted0 === 0 && held0 === 1n && !isAddressEqual(listedOwner, a.cocoon);
  check(`a fresh stack: one seat noted, nothing minted, the vault holds one seat and not #${LISTED}`, fresh, `noted ${tags(noted0)}, minted ${minted0}, heldCount ${held0}`);
  if (!fresh) throw new Error('this test needs a fresh stack: node script/local/up.mjs down, then node script/local/up.mjs');
  const S1 = noted0[0];
  for (const [who, addr] of [['keeper', KEEPER], ['buyer', BUYER], ['miner', MINER]]) {
    const code = await pub.getCode({ address: addr });
    check(`${who} carries no code (7702 delegation cleared by up)`, !code || code === '0x');
  }
  imd = createServer((req, res) => {
    res.statusCode = 404; // IMD knows no device for the seat
    res.end('{}');
  });
  await new Promise((r) => imd.listen(0, '127.0.0.1', r));
  ENV = keeperEnv(`http://127.0.0.1:${imd.address().port}`);
  mkdirSync(STATE_DIR, { recursive: true });
  rmSync(SEAT_CACHE, { force: true });
  rmSync(STATUS_DIR, { recursive: true, force: true });
  writeFileSync(LISTINGS_FILE, '[]\n');
  console.log(`  the keeper's seat cache ${SEAT_CACHE} cleared; its status feed in ${STATUS_DIR}`);

  // ---------------------------------------------------------------- (1) nothing to do
  section(`(1) keeper --once: up.mjs noted seat #${S1}, so the four duties idle`);
  const out1 = await keeper('(1)', ['--once']);
  check('noteSeats idles: every seat the vault holds is noted', out1.includes(`noteSeats: every seat the vault holds is noted (#${S1})`));
  check("forgetSeats idles: the noted seat is still the vault's", out1.includes(`forgetSeats: every noted seat is still the vault's (#${S1})`));
  check('convert idles: nothing in the pot', /convert: nothing in the pot/.test(out1));
  check('poke idles: no card staked', /poke: no card staked/.test(out1));
  check('none of the four was sent', quiet(out1), sentLines(out1).join('; ') || 'nothing sent');
  const st1 = statusFile();
  const price = await md('mintPrice');
  const m1 = st1.mine || {};
  check(
    'status.json: the mine block (minted 0, epoch 1, the mint price, 1 bit, the last mint, pot 0, ethPot 0, the duties due)',
    m1.minted === '0' && m1.epoch === '1' && m1.price === price.toString() && m1.bits === '1' && m1.lastMintAt === String(await md('lastMintAt')) &&
      m1.pot === '0' && m1.ethPot === '0' && ['flush', 'burn', 'convert'].every((k) => typeof m1.dutiesDue?.[k] === 'boolean'),
    st1.mine ? `price ${m1.price}, lastMintAt ${m1.lastMintAt}, noted ${m1.notedSeats}` : 'no mine block',
  );
  check('status.json: the four duties under steps, none ready, each with a why', ['noteSeats', 'forgetSeats', 'convert', 'poke'].every((k) => st1.steps[k]?.ready === false && st1.steps[k].why));

  // ---------------------------------------------------------------- (2) a second seat, noted
  const { seat: S2, holder: holder2 } = await seatOfAnEoa(a, S1 + 1n, [LISTED]);
  section(`(2) the holder of seat #${S2} hands it to Cocoon and anvil #4 adopts it; keeper --once notes it`);
  await handOver(a, S2, holder2, BUYER);
  const books2 = await read(a.cocoon, cocoonAbi, 'seats', [S2]);
  const owner2 = await read(a.collection, erc721Abi, 'ownerOf', [S2]);
  check(`seat #${S2} is the vault's (on Cocoon's books and in its wallet) and not noted yet`, books2[5] === true && isAddressEqual(owner2, a.cocoon) && sameIds(await md('notedSeats'), [S1]));
  const block2 = await pub.getBlockNumber({ cacheTime: 0 });
  const out2 = await keeper('(2)', ['--once']);
  check(`noteSeat #${S2} was sent`, sentLines(out2).includes(`noteSeat #${S2}`), sentLines(out2).join('; '));
  const noted2 = sorted(await md('notedSeats'));
  check(`notedSeats and mineableSeats are #${S1} #${S2}`, sameIds(noted2, sorted([S1, S2])) && sameIds(sorted(await md('mineableSeats')), sorted([S1, S2])), tags(noted2));
  const notedLogs = await eventsAfter('SeatNoted', block2);
  check(`SeatNoted(${S2}) was emitted`, notedLogs.some((l) => l.args.seat === S2));

  // ---------------------------------------------------------------- (3) mints fill the pot; a card is staked
  const convertPrices = await md('CONVERT_PRICES');
  const threshold = (price * convertPrices) / CONVERT_SHARE;
  section(`(3) anvil #5 mints until the pot holds ${convertPrices / CONVERT_SHARE} mint prices (${fmtTokens(threshold)}) and stakes a card of seat #${S2}`);
  await writeAs(SWARM, { address: a.token, abi: tokenAbi, functionName: 'transfer', args: [MINER, 3_000_000n * E18] });
  await writeAs(MINER, { address: a.token, abi: tokenAbi, functionName: 'approve', args: [a.metamorph, maxUint256] });
  const cards = [];
  while (cards.length < 60 && ((await md('pot')) < threshold || !cards.some((c) => c.seat === S2))) cards.push(await mintOne(MINER));
  const pot3 = await md('pot');
  const onS2 = cards.filter((c) => c.seat === S2);
  check(`the pot holds ${fmtTokens(threshold)} or more`, pot3 >= threshold, `${cards.length} mints, pot ${fmtTokens(pot3)}`);
  check(
    'every mint landed on a noted seat, the difficulty still one bit, totalMinted counts them',
    cards.every((c) => c.seat === S1 || c.seat === S2) && (await md('bits')) === 1 && (await md('totalMinted')) === cards.length,
    `${cards.length - onS2.length} on #${S1}, ${onS2.length} on #${S2}`,
  );
  // The launch pool opened single-sided: only ETH that buyers paid in lets the pot's PUPATE be sold, and a
  // fresh fork has had no buyer (mine-check and fork.mjs buy first too). anvil #1 buys through the router.
  const key = { currency0: zeroAddress, currency1: a.token, fee: a.poolKey.fee, tickSpacing: a.poolKey.tickSpacing, hooks: a.hook };
  const deadline = (await pub.getBlock()).timestamp + 3600n;
  const pupateBefore = await read(a.token, tokenAbi, 'balanceOf', [TRADER]);
  await sendAs(TRADER, { to: a.universalRouter, data: v4Swap({ key, zeroForOne: true, amountIn: parseEther('2'), deadline }), value: parseEther('2') });
  const traded = (await read(a.token, tokenAbi, 'balanceOf', [TRADER])) - pupateBefore;
  check('anvil #1 bought PUPATE for 2 ETH through the Universal Router, so the launch pool holds ETH', traded > 0n, fmtTokens(traded));
  const card = onS2[0].id;
  await writeAs(MINER, { address: a.metamorph, abi: metamorphAbi, functionName: 'stake', args: [[card]] });
  const stake3 = await md('stakeOf', [card]);
  check(`card #${card} of seat #${S2}: staked by anvil #5 at weight 1, a chrysalis (stage 0)`, isAddressEqual(stake3[0], MINER) && stake3[1] === 1 && (await md('stageOf', [card])) === 0);

  // ---------------------------------------------------------------- (4) the conversion
  section("(4) keeper --once converts the pot; the caller's IMD reaches the keeper; poke idles");
  const imdBefore = await read(a.imd, erc20Abi, 'balanceOf', [KEEPER]);
  const block4 = await pub.getBlockNumber({ cacheTime: 0 });
  const out4 = await keeper('(4)', ['--once']);
  const sent4 = out4.match(/\] sent (convert \(pot [^)]*\)) -> (0x[0-9a-fA-F]{64}) \(gas \d+, block \d+\)/);
  check('convert was sent', sent4 !== null, sent4 ? sent4[1] : 'no sent convert line');
  const gas4 = out4.match(/gas for convert \(pot [^)]*\): estimate (\d+) \+ (\d+) = (\d+)/);
  const tx4 = sent4 ? await pub.getTransaction({ hash: sent4[2] }) : null;
  check(
    'it went out with the estimate + 1,000,000 as its gas limit',
    gas4 !== null && BigInt(gas4[2]) === CONVERT_PAD && BigInt(gas4[3]) === BigInt(gas4[1]) + CONVERT_PAD && tx4 !== null && tx4.gas === BigInt(gas4[3]),
    gas4 ? `estimate ${gas4[1]} + ${gas4[2]} = ${gas4[3]}, the transaction's limit ${tx4?.gas}` : 'no gas line',
  );
  const conv4 = await eventsAfter('Converted', block4);
  const ev4 = conv4.find((l) => isAddressEqual(l.args.caller, KEEPER));
  check(
    'Converted names the keeper as the caller, with PUPATE sold, IMD bought and a reward',
    ev4 !== undefined && ev4.args.pupateSold > 0n && ev4.args.imdBought > 0n && ev4.args.reward > 0n,
    ev4 ? `sold ${fmtTokens(ev4.args.pupateSold)} for ${fmtEth(ev4.args.ethBought, 6)}, bought ${ev4.args.imdBought} IMD wei, reward ${ev4.args.reward} IMD wei` : 'no event',
  );
  const imdAfter = await read(a.imd, erc20Abi, 'balanceOf', [KEEPER]);
  check("the keeper's IMD balance grew by exactly the reward", ev4 !== undefined && imdAfter - imdBefore === ev4.args.reward, `+${imdAfter - imdBefore} IMD wei`);
  const pot4 = await md('pot');
  check(
    "the pot fell by what was sold; lastConvertBlock is the conversion's block",
    ev4 !== undefined && pot4 === pot3 - ev4.args.pupateSold && (await md('lastConvertBlock')) === ev4.blockNumber,
    `pot ${fmtTokens(pot3)} -> ${fmtTokens(pot4)}, ethPot ${fmtEth(await md('ethPot'), 6)}`,
  );
  check('the keeper logged the conversion', /converted: sold [\d,]+ PUPATE for [\d.]+ ETH, bought [\d,.]+ IMD for the stakers, [\d,.]+ IMD of it the caller's reward/.test(out4));
  check('poke idles: the staked card weighs what its stage does', /poke: 1 staked card, each at the weight of its stage/.test(out4));
  const st4 = statusFile();
  check('status.json: the pot and the cards minted as the chain has them', st4.mine?.pot === pot4.toString() && st4.mine?.minted === String(cards.length), `pot ${st4.mine?.pot}, minted ${st4.mine?.minted}`);

  // ---------------------------------------------------------------- (5) the second seat sells
  section(`(5) anvil #4 buys seat #${S2} from Cocoon's falling order: the staked card emerges`);
  await buyFromCocoon(a, S2, BUYER);
  const books5 = await read(a.cocoon, cocoonAbi, 'seats', [S2]);
  check(`anvil #4 owns seat #${S2}; Cocoon's books hold it until settleSeat`, isAddressEqual(await read(a.collection, erc721Abi, 'ownerOf', [S2]), BUYER) && books5[5] === true);
  check(`card #${card} emerged (stage 1) and still weighs 1`, (await md('stageOf', [card])) === 1 && (await md('stakeOf', [card]))[1] === 1);
  check(`mineableSeats is #${S1} alone; notedSeats still names #${S2}`, sameIds(await md('mineableSeats'), [S1]) && sameIds(sorted(await md('notedSeats')), sorted([S1, S2])));

  // ---------------------------------------------------------------- (6) the dry run
  section('(6) keeper --once --dry-run prints the four decisions and sends nothing');
  const look = async () => ({
    nonce: await pub.getTransactionCount({ address: KEEPER }),
    block: await pub.getBlockNumber({ cacheTime: 0 }),
    noted: sorted(await md('notedSeats')),
    weight: (await md('stakeOf', [card]))[1],
    books: (await read(a.cocoon, cocoonAbi, 'seats', [S2]))[5],
  });
  const before6 = await look();
  const out6 = await keeper('(6)', ['--once', '--dry-run']);
  const after6 = await look();
  check('noteSeats: decided and printed, nothing to note', out6.includes(`noteSeats: every seat the vault holds is noted (#${S1})`));
  check(`forgetSeats: would send forgetSeat #${S2}`, out6.includes(`dry run: would send forgetSeat #${S2} (gas estimate `));
  const conv6 = out6.match(/(dry run: would send convert \([^\n]*|skip convert: [^\n]*|convert: [^;\n]*)/);
  check('convert: decided and printed', conv6 !== null, conv6 ? conv6[1] : 'no convert line');
  check(`poke: would send poke #${card}`, out6.includes(`dry run: would send poke #${card} (1 card) (gas estimate `));
  check(`and the vault's own: would send settleSeat #${S2}`, out6.includes(`dry run: would send settleSeat #${S2} `));
  check(
    'nothing was sent: no sent line; the same nonce, block, noted seats, weight and books',
    sentLines(out6).length === 0 && after6.nonce === before6.nonce && after6.block === before6.block && sameIds(after6.noted, before6.noted) && after6.weight === before6.weight && after6.books === before6.books,
    ['nonce', 'block', 'noted', 'weight', 'books'].map((k) => `${k} ${before6[k]} -> ${after6[k]}`).join(', ') + `, ${sentLines(out6).length} sent line(s)`,
  );

  // ---------------------------------------------------------------- (7) settle, forget, poke
  section(`(7) keeper --once settles seat #${S2}, forgets it and pokes card #${card} to weight 2`);
  const block7 = await pub.getBlockNumber({ cacheTime: 0 });
  const out7 = await keeper('(7)', ['--once']);
  const sent7 = sentLines(out7);
  check(
    `settleSeat #${S2}, forgetSeat #${S2} and poke #${card} were sent`,
    sent7.some((l) => l.startsWith(`settleSeat #${S2} `)) && sent7.includes(`forgetSeat #${S2}`) && sent7.includes(`poke #${card} (1 card)`),
    sent7.join('; '),
  );
  check(`notedSeats is #${S1} alone`, sameIds(await md('notedSeats'), [S1]));
  const stake7 = await md('stakeOf', [card]);
  check(`card #${card} weighs 2, still staked by anvil #5`, stake7[1] === 2 && isAddressEqual(stake7[0], MINER));
  const reweighed = await eventsAfter('Reweighed', block7);
  const forgotten = await eventsAfter('SeatForgotten', block7);
  check(`Reweighed(${card}, 2) and SeatForgotten(${S2}) were emitted`, reweighed.some((l) => l.args.id === card && l.args.weight === 2) && forgotten.some((l) => l.args.seat === S2));

  // ---------------------------------------------------------------- (8) a buy and a sale in one tick
  section(`(8) one tick, a seat sold and one bought: anvil #4 buys #${S1} from Cocoon, the holder of #${LISTED} lists it`);
  await buyFromCocoon(a, S1, BUYER);
  check(`anvil #4 owns seat #${S1}; Cocoon's books still hold it`, isAddressEqual(await read(a.collection, erc721Abi, 'ownerOf', [S1]), BUYER) && (await read(a.cocoon, cocoonAbi, 'seats', [S1]))[5] === true);
  const holder8 = await read(a.collection, erc721Abi, 'ownerOf', [LISTED]);
  await anvil.impersonateAccount({ address: holder8 });
  await anvil.setBalance({ address: holder8, value: parseEther('10') });
  await writeAs(holder8, { address: a.collection, abi: erc721Abi, functionName: 'setApprovalForAll', args: [a.seaport, true] });
  const terms8 = { cost: parseEther('2.8'), startX: 10_000, endX: 10_000, decay: 7n * DAY, boughtAt: (await pub.getBlock()).timestamp, round: 0 };
  const parameters = seatParameters(holder8, a.collection, LISTED, terms8, 0);
  await writeAs(holder8, { address: a.seaport, abi: seaportAbi, functionName: 'validate', args: [[{ parameters, signature: '0x' }]] });
  await anvil.stopImpersonatingAccount({ address: holder8 });
  writeFileSync(LISTINGS_FILE, jsonSafe([{ parameters, signature: '0x' }], 2) + '\n');
  const need = parseEther('2.8') + parseEther('2.8') / 200n;
  for (let i = 0; i < 8 && (await read(a.cocoon, cocoonAbi, 'seatPot')) < need; i++) {
    await writeAs(FUNDER, { address: a.cocoon, abi: cocoonAbi, functionName: 'depositTax', value: parseEther('5') });
  }
  const seatPot8 = await read(a.cocoon, cocoonAbi, 'seatPot');
  check(`#${LISTED} is listed at 2.8 ETH (validated on Seaport) and the seat pot covers it with the reward`, seatPot8 >= need, `seat pot ${fmtEth(seatPot8)}`);

  // The keeper's own state read before the tick: the logs say one thing, the chain another.
  const { cfg, cache, s } = await keeperState(a);
  const replay = cache.seats[S1.toString()];
  check(`the logs still hold seat #${S1}: no SeatSold yet`, replay?.held === true, replay ? `last event ${replay.event}` : 'not in the replay');
  check(
    `the state read counts #${S1} out of the vault (gone from its wallet), so the held set is empty`,
    s.seats.some((x) => x.tokenId === S1 && x.gone) && s.mine.held.length === 0,
    `held ${tags(s.mine.held) || 'none'}, noted ${tags(s.mine.noted)}`,
  );
  check(
    `forgetSeats decides #${S1} on the chain's word; noteSeats has nothing yet (#${LISTED} is not the vault's)`,
    sameIds(forgetSeatsDecision(cfg, s).due, [S1]) && noteSeatsDecision(cfg, s).due.length === 0,
  );

  const out8 = await keeper('(8)', ['--once']);
  const sent8 = sentLines(out8);
  const at = (prefix) => sent8.findIndex((l) => l.startsWith(prefix));
  const order = [at(`settleSeat #${S1} `), at(`buySeat #${LISTED} `), at(`noteSeat #${LISTED}`), at(`forgetSeat #${S1}`)];
  check(
    `in one tick: settleSeat #${S1}, buySeat #${LISTED}, noteSeat #${LISTED}, forgetSeat #${S1}, in that order`,
    order.every((i) => i >= 0) && order.every((i, k) => k === 0 || i > order[k - 1]),
    sent8.join('; '),
  );
  check('no noteSeat or forgetSeat was refused (no SeatNotHeld, no SeatHeld)', !/skip (noteSeat|forgetSeat) #\d+: /.test(out8));
  check(`notedSeats and mineableSeats are #${LISTED} alone`, sameIds(await md('notedSeats'), [LISTED]) && sameIds(await md('mineableSeats'), [LISTED]));
  check(
    `the vault holds #${LISTED} (books and wallet); #${S1} is off its books`,
    (await read(a.cocoon, cocoonAbi, 'seats', [LISTED]))[5] === true && isAddressEqual(await read(a.collection, erc721Abi, 'ownerOf', [LISTED]), a.cocoon) && (await read(a.cocoon, cocoonAbi, 'seats', [S1]))[5] === false,
  );

  // ---------------------------------------------------------------- (9) nothing left
  section('(9) keeper --once: nothing left to note, forget or poke');
  const out9 = await keeper('(9)', ['--once']);
  check(`noteSeats idles: #${LISTED} is noted`, out9.includes(`noteSeats: every seat the vault holds is noted (#${LISTED})`));
  check("forgetSeats idles: the noted seat is the vault's", out9.includes(`forgetSeats: every noted seat is still the vault's (#${LISTED})`));
  check('poke idles: the staked butterfly weighs 2', /poke: 1 staked card, each at the weight of its stage/.test(out9));
  check('none of noteSeat, forgetSeat or poke was sent', !sentLines(out9).some((l) => /^(noteSeat|forgetSeat|poke) /.test(l)), sentLines(out9).join('; ') || 'nothing sent');
  const st9 = statusFile();
  check(
    `status.json: noted #${LISTED}, mineable #${LISTED}, ${cards.length} minted, the three seat and card duties not ready`,
    st9.mine?.notedSeats?.join() === String(LISTED) && st9.mine?.mineableSeats?.join() === String(LISTED) && st9.mine?.minted === String(cards.length) && !st9.steps.noteSeats.ready && !st9.steps.forgetSeats.ready && !st9.steps.poke.ready,
    `steps.convert: ${st9.steps.convert?.why}`,
  );

  // ---------------------------------------------------------------- (10) the refusals
  section('(10) noteSeats and forgetSeats on states made stale on purpose: each refusal is logged by name and skipped');
  const { cfg: cfg10, s: s10 } = await keeperState(a);
  const stale = (over) => ({ ...s10, mine: { ...s10.mine, ...over } });
  const ctx10 = { cfg: cfg10, a: cfg10.addresses, tx: createTx({ pub, wallet: null, account: null, dryRun: true, gasCapWei: 10n ** 12n, txTimeoutSec: 60 }) };
  const r1 = await captured(() => noteSeats(ctx10, stale({ held: [S2], noted: [LISTED] })));
  check(
    `a state that still calls #${S2} the vault's: noteSeat #${S2} meets SeatNotHeld, logged and skipped`,
    r1.out.includes(`skip noteSeat #${S2}: SeatNotHeld`) && r1.r.acted === false && r1.r.note === 'noteSeats: 1 seat to note, none went through',
    r1.out.split('\n').find((l) => l.includes('noteSeat #')) || r1.r.note,
  );
  const r2 = await captured(() => forgetSeats(ctx10, stale({ held: [], noted: [LISTED] })));
  check(
    `a state that has lost #${LISTED}: forgetSeat #${LISTED} meets SeatHeld, logged and skipped`,
    r2.out.includes(`skip forgetSeat #${LISTED}: SeatHeld`) && r2.r.acted === false,
    r2.out.split('\n').find((l) => l.includes('forgetSeat #')) || r2.r.note,
  );
  const r3 = await captured(() => forgetSeats(ctx10, stale({ held: [LISTED], noted: [LISTED, S1] })));
  check(
    `a state that still lists #${S1} as noted: forgetSeat #${S1} meets SeatNotNoted, logged and skipped`,
    r3.out.includes(`skip forgetSeat #${S1}: SeatNotNoted`) && r3.r.acted === false,
    r3.out.split('\n').find((l) => l.includes('forgetSeat #')) || r3.r.note,
  );
  check(`the chain is as the keeper left it: #${LISTED} noted`, sameIds(await md('notedSeats'), [LISTED]));
}
