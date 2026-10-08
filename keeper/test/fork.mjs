#!/usr/bin/env node
// The keeper against the local mainnet fork (script/local/up.mjs must be up, ideally fresh):
//   (1) anvil #1 buys 0.2 ETH of PUPATE through the Universal Router, so the hook holds tax
//   (2) keeper --once: flush happens (claims 0, seatPot grew); no report while the stored one is fresh
//   (3) keeper --once --force-report: a locally signed report lands (feed.issuedAt advances)
//   (4) the real holder of seat 1376 lists it on Seaport at 2.8 ETH (validated on-chain, no signature);
//       anvil #3 funds the seat pot; keeper --once buys it (seats(1376).held, SeatBought by anvil #2 with a reward)
//   (5) anvil #4 fills Cocoon's falling order; keeper --once settles the seat (heldCount 0) and burns
//       the proceeds (burnPot down, totalSupply down)
// The keeper runs as a child process with ATTESTATION_SOURCE=local (anvil #9 signs), LISTING_SOURCE=file,
// keeper key = anvil #2. Prints PASS/FAIL per assertion and the gas of every transaction the keeper sent;
// exits non-zero on any failure. anvil's keys are derived from its public mnemonic and never printed.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  parseEther,
  toHex,
  zeroAddress,
  zeroHash,
} from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { cocoonAbi, erc20Abi, erc721Abi, feedAbi, hookAbi, poolManagerAbi, seaportAbi, universalRouterAbi } from '../lib/abi.mjs';
import { MULTICALL3 } from '../lib/chain.mjs';
import { KEEPER_ROOT, REPO_ROOT, STATE_DIR } from '../lib/config.mjs';
import { seatComponents, seatOrders, seatParameters, startPrice } from '../lib/listings.mjs';
import { fmtEth, jsonSafe } from '../lib/log.mjs';

const RPC = `http://127.0.0.1:${process.env.ANVIL_PORT || 8545}`;
const ADDRESSES_FILE = process.env.ADDRESSES || join(REPO_ROOT, 'site', 'public', 'addresses.local.json');
const LISTINGS_FILE = join(STATE_DIR, 'fork-listings.json');
const SEAT = 1376n;
const MNEMONIC = 'test test test test test test test test test test test junk';
const DAY = 86_400n;

const chain = { ...foundry, id: 31337 };
const pub = createPublicClient({ chain, transport: http(RPC) });
const anvil = createTestClient({ chain, mode: 'anvil', transport: http(RPC) });

// anvil's default accounts, by index. The keys stay inside the child process environment.
const account = (i) => mnemonicToAccount(MNEMONIC, { addressIndex: i });
const keyOf = (i) => toHex(account(i).getHdKey().privateKey);
const TRADER = account(1).address;
const KEEPER = account(2).address;
const FUNDER = account(3).address;
const BUYER = account(4).address;
const ATTESTER = account(9).address;

let failed = 0;
const gasRows = [];

function check(name, ok, detail = '') {
  if (!ok) failed++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

function section(title) {
  console.log(`\n== ${title}`);
}

main().then(
  () => {
    section('summary');
    if (gasRows.length) {
      console.log('  gas used by the keeper, per action:');
      for (const g of gasRows) console.log(`    ${g.step.padEnd(8)} ${g.action.padEnd(72)} ${String(g.gas).padStart(9)}`);
    }
    console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
    process.exit(failed ? 1 : 0);
  },
  (e) => {
    console.error(`\nfork test failed: ${e.shortMessage || e.message}`);
    if (e.cause?.shortMessage) console.error(e.cause.shortMessage);
    process.exit(1);
  },
);

// ------------------------------------------------------------------ helpers

/** eth_sendTransaction from one of anvil's unlocked (or impersonated) accounts. */
function walletOf(address) {
  return createWalletClient({ account: address, chain, transport: http(RPC) });
}

// anvil's own gas estimate is tight, and a swap's path moves with the launch tax rate between the
// estimate and the block, so every test transaction carries a 50% buffer.
async function writeAs(from, args) {
  const gas = ((await pub.estimateContractGas({ ...args, account: from })) * 15n) / 10n;
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

async function snapshot(a) {
  const r = await pub.multicall({
    contracts: [
      { address: a.poolManager, abi: poolManagerAbi, functionName: 'balanceOf', args: [a.hook, 0n] },
      { address: a.hook, abi: hookAbi, functionName: 'totalTax' },
      { address: a.feed, abi: feedAbi, functionName: 'issuedAt' },
      { address: a.feed, abi: feedAbi, functionName: 'latest' },
      { address: a.cocoon, abi: cocoonAbi, functionName: 'seatPot' },
      { address: a.cocoon, abi: cocoonAbi, functionName: 'burnPot' },
      { address: a.cocoon, abi: cocoonAbi, functionName: 'imdBurnBalance' },
      { address: a.cocoon, abi: cocoonAbi, functionName: 'heldCount' },
      { address: a.cocoon, abi: cocoonAbi, functionName: 'lastBurnBlock' },
      { address: a.cocoon, abi: cocoonAbi, functionName: 'imdAuction' },
      { address: a.token, abi: erc20Abi, functionName: 'totalSupply' },
    ],
    allowFailure: false,
    multicallAddress: MULTICALL3,
  });
  return {
    claims: r[0],
    totalTax: r[1],
    issuedAt: r[2],
    floor: r[3][0],
    fresh: r[3][1],
    seatPot: r[4],
    burnPot: r[5],
    imdBurn: r[6],
    heldCount: r[7],
    lastBurnBlock: r[8],
    imdLot: r[9][0],
    supply: r[10],
    block: await pub.getBlockNumber(),
  };
}

/** Runs the keeper as a child process and returns its output; records the gas of every sent transaction. */
function keeper(step, args, extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  delete env.DRY_RUN;
  const r = spawnSync(process.execPath, [join(KEEPER_ROOT, 'bin', 'keeper.mjs'), ...args], {
    cwd: KEEPER_ROOT,
    env,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  console.log(out.trimEnd().replace(/^/gm, '    | '));
  if (r.status !== 0) throw new Error(`keeper ${args.join(' ')} exited with ${r.status}`);
  for (const m of out.matchAll(/ sent (.+?) -> 0x[0-9a-fA-F]{64} \(gas (\d+), block \d+\)/g)) {
    gasRows.push({ step, action: m[1], gas: Number(m[2]) });
  }
  return out;
}

/** Universal Router calldata, byte for byte what script/local/smoke.mjs builds with cast. */
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
  const swap = encodeAbiParameters(
    [
      {
        type: 'tuple',
        components: [
          { name: 'poolKey', ...poolKeyType },
          { name: 'zeroForOne', type: 'bool' },
          { name: 'amountIn', type: 'uint128' },
          { name: 'amountOutMinimum', type: 'uint128' },
          { name: 'hookData', type: 'bytes' },
        ],
      },
    ],
    [{ poolKey: key, zeroForOne, amountIn, amountOutMinimum: 0n, hookData: '0x' }],
  );
  const currencyIn = zeroForOne ? key.currency0 : key.currency1;
  const currencyOut = zeroForOne ? key.currency1 : key.currency0;
  const settleAll = encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [currencyIn, amountIn]);
  const takeAll = encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [currencyOut, 0n]);
  const actions = concatHex(['0x06', '0x0c', '0x0f']);
  const input = encodeAbiParameters([{ type: 'bytes' }, { type: 'bytes[]' }], [actions, [swap, settleAll, takeAll]]);
  return encodeFunctionData({ abi: universalRouterAbi, functionName: 'execute', args: ['0x10', [input], deadline] });
}

const event = (name) => cocoonAbi.find((x) => x.type === 'event' && x.name === name);

// ------------------------------------------------------------------ the test

async function main() {
  section('preconditions');
  const chainId = await pub.getChainId().catch(() => 0);
  if (chainId !== 31337) throw new Error(`nothing answers on ${RPC} with chain id 31337: run node script/local/up.mjs`);
  if (!existsSync(ADDRESSES_FILE)) throw new Error(`${ADDRESSES_FILE} is missing: run node script/local/up.mjs`);
  const a = JSON.parse(readFileSync(ADDRESSES_FILE, 'utf8'));
  console.log(`  cocoon ${a.cocoon} hook ${a.hook} feed ${a.feed} token ${a.token}`);
  console.log(`  trader #1 ${TRADER}, keeper #2 ${KEEPER}, funder #3 ${FUNDER}, buyer #4 ${BUYER}, attester #9 ${ATTESTER}`);
  check('addresses.attester is anvil #9', isAddressEqual(a.attester, ATTESTER), a.attester);
  const feedAttester = await read(a.feed, feedAbi, 'attester');
  check('feed.attester() is anvil #9', isAddressEqual(feedAttester, ATTESTER), feedAttester);
  for (const [who, addr] of [['trader', TRADER], ['keeper', KEEPER], ['buyer', BUYER]]) {
    const code = await pub.getCode({ address: addr });
    check(`${who} carries no code (7702 delegation cleared by up)`, !code || code === '0x');
  }
  mkdirSync(STATE_DIR, { recursive: true });
  const keeperEnv = {
    RPC,
    ADDRESSES: ADDRESSES_FILE,
    KEEPER_PRIVATE_KEY: keyOf(2),
    ATTESTATION_SOURCE: 'local',
    LOCAL_ATTESTER_KEY: keyOf(9),
    LOCAL_FLOOR_WEI: '2.8e18',
    LISTING_SOURCE: 'file',
    LISTINGS_FILE,
    GAS_PRICE_CAP_GWEI: '1000',
    MIN_IMD_AUCTION_WEI: '0',
  };
  writeFileSync(LISTINGS_FILE, '[]\n');

  // ---------------------------------------------------------------- (1) a taxed buy
  section('(1) anvil #1 buys 0.2 ETH of PUPATE through the Universal Router');
  const key = { currency0: zeroAddress, currency1: a.token, fee: a.poolKey.fee, tickSpacing: a.poolKey.tickSpacing, hooks: a.hook };
  const amountIn = parseEther('0.2');
  const s0 = await snapshot(a);
  const rate = await read(a.hook, hookAbi, 'buyTaxBps');
  const deadline = (await pub.getBlock()).timestamp + 3600n;
  const pupateBefore = await read(a.token, erc20Abi, 'balanceOf', [TRADER]);
  const buyReceipt = await sendAs(TRADER, { to: a.universalRouter, data: v4Swap({ key, zeroForOne: true, amountIn, deadline }), value: amountIn });
  const s1 = await snapshot(a);
  const got = (await read(a.token, erc20Abi, 'balanceOf', [TRADER])) - pupateBefore;
  check('buy succeeded', buyReceipt.status === 'success', `gas ${buyReceipt.gasUsed}, buy tax ${rate} bps at the time`);
  check('trader received PUPATE', got > 0n, `${got / 10n ** 18n} PUPATE`);
  check('hook.totalTax grew', s1.totalTax > s0.totalTax, `+${fmtEth(s1.totalTax - s0.totalTax)}`);
  check('hook holds ETH claims on the PoolManager', s1.claims > 0n && s1.claims === s1.totalTax - s0.totalTax + s0.claims, fmtEth(s1.claims));

  // ---------------------------------------------------------------- (2) flush, no report
  section('(2) keeper --once: flush, and no report while the stored one is fresh');
  check('stored report is fresh before the tick', s1.fresh, `issued ${new Date(Number(s1.issuedAt) * 1000).toISOString()}`);
  const out2 = keeper('(2)', ['--once'], keeperEnv);
  const s2 = await snapshot(a);
  check('flush was sent', /sent flush /.test(out2));
  check('hook claims are 0 after the tick', s2.claims === 0n, fmtEth(s2.claims));
  check('seatPot grew', s2.seatPot > s1.seatPot, `${fmtEth(s1.seatPot)} -> ${fmtEth(s2.seatPot)}`);
  check('no report was sent', !/sent report /.test(out2) && s2.issuedAt === s1.issuedAt, `issuedAt ${s2.issuedAt}`);
  check('tick reported the report as not due', /report fresh for/.test(out2));
  if (/sent burn /.test(out2)) check('burn in the same tick lowered the supply', s2.supply < s1.supply, `${fmtEth(s1.supply - s2.supply, 0).replace(' ETH', '')} PUPATE burned`);
  if (/sent startImdAuction/.test(out2)) check('IMD auction started on the 5% share', s2.imdLot > 0n, `lot ${fmtEth(s2.imdLot)}`);

  // ---------------------------------------------------------------- (3) a forced report
  section('(3) keeper --once --force-report: a locally signed report');
  const out3 = keeper('(3)', ['--once', '--force-report'], keeperEnv);
  const s3 = await snapshot(a);
  check('report was sent', /sent report floor 2\.8 ETH/.test(out3));
  check('feed.issuedAt advanced', s3.issuedAt > s2.issuedAt, `${s2.issuedAt} -> ${s3.issuedAt}`);
  check('floor is 2.8 ETH and fresh', s3.floor === parseEther('2.8') && s3.fresh, fmtEth(s3.floor));

  // ---------------------------------------------------------------- (4) a real listing, bought by the keeper
  section('(4) the holder of seat 1376 lists it at 2.8 ETH; anvil #3 funds the pot; keeper --once buys');
  const holder = await read(a.collection, erc721Abi, 'ownerOf', [SEAT]);
  const holderCode = await pub.getCode({ address: holder });
  console.log(`  holder of #${SEAT}: ${holder}${holderCode && holderCode !== '0x' ? ` (a contract, ${(holderCode.length - 2) / 2} bytes)` : ' (an EOA)'}`);
  check('the seat is not held by Cocoon yet', !isAddressEqual(holder, a.cocoon));
  await anvil.impersonateAccount({ address: holder });
  await anvil.setBalance({ address: holder, value: parseEther('10') });
  await writeAs(holder, { address: a.collection, abi: erc721Abi, functionName: 'setApprovalForAll', args: [a.seaport, true] });
  const boughtAt = (await pub.getBlock()).timestamp;
  const terms = { cost: parseEther('2.8'), startX: 10_000, endX: 10_000, decay: 7n * DAY, boughtAt, round: 0 };
  const parameters = seatParameters(holder, a.collection, SEAT, terms, 0);
  const validateReceipt = await writeAs(holder, { address: a.seaport, abi: seaportAbi, functionName: 'validate', args: [[{ parameters, signature: '0x' }]] });
  const holderCounter = await read(a.seaport, seaportAbi, 'getCounter', [holder]);
  const holderComponents = seatComponents(holder, a.collection, SEAT, terms, holderCounter)[0];
  const holderHash = await read(a.seaport, seaportAbi, 'getOrderHash', [holderComponents]);
  const [validated] = await read(a.seaport, seaportAbi, 'getOrderStatus', [holderHash]);
  check('holder validated the listing on Seaport', validateReceipt.status === 'success' && validated, `order ${holderHash.slice(0, 10)}…`);
  await anvil.stopImpersonatingAccount({ address: holder });
  writeFileSync(LISTINGS_FILE, jsonSafe([{ parameters, signature: '0x' }], 2) + '\n');
  console.log(`  listing written to ${LISTINGS_FILE}`);

  await writeAs(FUNDER, { address: a.cocoon, abi: cocoonAbi, functionName: 'depositTax', value: parseEther('5') });
  const s4a = await snapshot(a);
  check('seat pot covers the price plus the reward', s4a.seatPot >= parseEther('2.8') + parseEther('2.8') / 200n, fmtEth(s4a.seatPot));
  const holderBefore = await pub.getBalance({ address: holder });
  const keeperBefore = await pub.getBalance({ address: KEEPER });
  const out4 = keeper('(4)', ['--once'], keeperEnv);
  const s4 = await snapshot(a);
  const seat = await read(a.cocoon, cocoonAbi, 'seats', [SEAT]);
  const owner4 = await read(a.collection, erc721Abi, 'ownerOf', [SEAT]);
  check('buySeat was sent', /sent buySeat #1376 at 2\.8 ETH/.test(out4));
  check('seats(1376).held is true', seat[5] === true, `cost ${fmtEth(seat[0])}, round ${seat[6]}`);
  check('Cocoon owns the seat', isAddressEqual(owner4, a.cocoon), owner4);
  check('heldCount is 1', s4.heldCount === 1n);
  check('the holder was paid 2.8 ETH', (await pub.getBalance({ address: holder })) - holderBefore === parseEther('2.8'));
  const bought = await pub.getLogs({ address: a.cocoon, event: event('SeatBought'), fromBlock: s4a.block, toBlock: 'latest' });
  const sb = bought.find((l) => l.args.tokenId === SEAT);
  check('SeatBought names anvil #2 as the caller', sb !== undefined && isAddressEqual(sb.args.caller, KEEPER), sb ? sb.args.caller : 'no event');
  check('and pays a reward', sb !== undefined && sb.args.reward > 0n, sb ? fmtEth(sb.args.reward) : '');
  check('cost is exactly what Seaport paid out', sb !== undefined && sb.args.cost === parseEther('2.8'));
  const keeperAfter = await pub.getBalance({ address: KEEPER });
  console.log(`  keeper balance change over the tick (reward minus gas): ${keeperAfter >= keeperBefore ? '+' : '-'}${fmtEth(keeperAfter >= keeperBefore ? keeperAfter - keeperBefore : keeperBefore - keeperAfter, 6)}`);
  const ourTerms = { cost: seat[0], boughtAt: seat[1], startX: seat[2], endX: seat[3], decay: seat[4], round: seat[6] };
  const ourCounter = await read(a.seaport, seaportAbi, 'getCounter', [a.cocoon]);
  const ourComponents = seatComponents(a.cocoon, a.collection, SEAT, ourTerms, ourCounter);
  const ourHashes = await Promise.all(ourComponents.map((c) => read(a.seaport, seaportAbi, 'getOrderHash', [c])));
  const ourStatus = await Promise.all(ourHashes.map((h) => read(a.seaport, seaportAbi, 'getOrderStatus', [h])));
  check("Cocoon's two orders are validated on Seaport", ourStatus.every((st) => st[0] && !st[1]), `falling ${ourHashes[0].slice(0, 10)}…, tail ${ourHashes[1].slice(0, 10)}…`);

  // ---------------------------------------------------------------- (5) the listing fills; settle and burn
  section("(5) anvil #4 fills Cocoon's falling order; keeper --once settles and burns");
  const ours = seatOrders(a.cocoon, a.collection, SEAT, ourTerms);
  const price = startPrice(ourTerms); // the falling order asks at most this; Seaport refunds the rest
  const buyerBefore = await pub.getBalance({ address: BUYER });
  const fill = await writeAs(BUYER, {
    address: a.seaport,
    abi: seaportAbi,
    functionName: 'fulfillAdvancedOrder',
    args: [{ parameters: ours[0].parameters, numerator: 1n, denominator: 1n, signature: '0x', extraData: '0x' }, [], zeroHash, BUYER],
    value: price,
  });
  const s5a = await snapshot(a);
  const paid = buyerBefore - (await pub.getBalance({ address: BUYER })) - fill.gasUsed * fill.effectiveGasPrice;
  check('the buyer owns the seat', isAddressEqual(await read(a.collection, erc721Abi, 'ownerOf', [SEAT]), BUYER));
  check('the proceeds went to the burn pot', s5a.burnPot - s4.burnPot === paid && paid > parseEther('4'), `${fmtEth(paid)} paid (ceiling ${fmtEth(price)})`);
  // Refill the seat pot so the keeper gets past PotTooSmall and has to notice on Seaport that the
  // listing in the file is filled. burnSpacing blocks must pass since the last burn; on mainnet
  // they pass by themselves.
  await writeAs(FUNDER, { address: a.cocoon, abi: cocoonAbi, functionName: 'depositTax', value: parseEther('5') });
  await anvil.mine({ blocks: 5 });
  const s5b = await snapshot(a);
  const out5 = keeper('(5)', ['--once'], keeperEnv);
  const s5 = await snapshot(a);
  const seat5 = await read(a.cocoon, cocoonAbi, 'seats', [SEAT]);
  check('settleSeat was sent', /sent settleSeat #1376/.test(out5));
  check('heldCount is back to 0', s5.heldCount === 0n);
  check('seats(1376).held is false', seat5[5] === false);
  const tail = await read(a.seaport, seaportAbi, 'getOrderStatus', [ourHashes[1]]);
  check('the flat tail order is cancelled', tail[1] === true);
  check('the filled listing in the file was skipped', /skip buySeat #1376 .*already filled/.test(out5));
  check('no purchase was made', !/sent buySeat/.test(out5));
  check('burn was sent', /sent burn /.test(out5));
  check('burnPot decreased', s5.burnPot < s5b.burnPot, `${fmtEth(s5b.burnPot)} -> ${fmtEth(s5.burnPot)}`);
  check('token totalSupply decreased', s5.supply < s4.supply, `${(s4.supply - s5.supply) / 10n ** 18n} PUPATE burned`);
  const burned = await pub.getLogs({ address: a.cocoon, event: event('Burned'), fromBlock: s5a.block, toBlock: 'latest' });
  check('Burned names anvil #2 as the caller with a reward', burned.some((l) => isAddressEqual(l.args.caller, KEEPER) && l.args.reward > 0n), burned.length ? fmtEth(burned.at(-1).args.ethSpent) + ' spent' : 'no event');
  const balance = await pub.getBalance({ address: a.cocoon });
  const pots = await Promise.all(['seatPot', 'burnPot', 'developerBalance', 'imdBurnBalance'].map((f) => read(a.cocoon, cocoonAbi, f)));
  check('Cocoon balance identity (balance == the four pots)', balance === pots.reduce((x, y) => x + y, 0n), fmtEth(balance));
}
