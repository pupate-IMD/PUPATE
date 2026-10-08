#!/usr/bin/env node
// Smoke test against the local fork, with `cast`, from anvil account #1:
//   (a) a BUY through the Universal Router (V4_SWAP: SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL) with
//       0.1 ETH: the buyer receives PUPATE, hook.totalTax() grows by buyTaxBps of 0.1 ETH, Taxed is emitted
//   (b) hook.flush(): Cocoon's four pots grow by the 85/10/5 split and the mode's seat share
//   (c) feed.latest() is (FLOOR_WEI, true)
//   (d) 6000 seconds later the buy tax is the standing 6%
//   (e) a SELL through the Universal Router (Permit2 allowance): Taxed(buy=false, 600 bps), ETH comes back
// Needs `node script/local/up.mjs` first. Exits non-zero if an assertion fails.
import {
  ACCOUNTS,
  BPS,
  ETH,
  MAINNET,
  ZERO,
  anvilUp,
  call,
  callUint,
  castLocal,
  fmtEth,
  fmtPupate,
  hasCode,
  latestBlock,
  pct,
  readAddresses,
  rpc,
  send,
} from './common.mjs';

const TOPIC = {
  taxed: castLocal('keccak', 'Taxed(address,bool,uint256,uint256)'),
  flushed: castLocal('keccak', 'Flushed(uint256)'),
  taxDeposited: castLocal('keccak', 'TaxDeposited(uint256,uint256,uint256,uint256,uint256,uint8)'),
  swap: castLocal('keccak', 'Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)'),
};
const MODE = ['NEUTRAL', 'ACCUMULATE', 'BURN'];
const results = [];
let failed = 0;

main().catch((e) => {
  console.error(`\nsmoke failed: ${e.message}`);
  process.exitCode = 1;
});

async function main() {
  if (!(await anvilUp())) throw new Error('the fork is not up: run `node script/local/up.mjs`');
  const a = readAddresses();
  const buyer = ACCOUNTS.buyer.address;
  if (await hasCode(buyer)) {
    throw new Error(`${buyer} carries code (an EIP-7702 delegation from mainnet); \`up\` clears it, re-run \`down\` then \`up\``);
  }
  const key = { currency0: ZERO, currency1: a.token, fee: a.poolKey.fee, tickSpacing: a.poolKey.tickSpacing, hooks: a.hook };
  console.log(`trader: anvil account #1 ${buyer}`);
  console.log(`pool:   ETH / PUPATE, fee ${key.fee}, tick spacing ${key.tickSpacing}, hook ${key.hooks}`);
  console.log(`router: ${a.universalRouter}`);

  // ---------------------------------------------------------------- (a) buy
  section('(a) buy 0.1 ETH through the Universal Router');
  const amountIn = ETH / 10n;
  const rateBefore = callUint(a.hook, 'buyTaxBps()(uint256)');
  const totalTaxBefore = callUint(a.hook, 'totalTax()(uint256)');
  const pupateBefore = callUint(a.token, 'balanceOf(address)(uint256)', buyer);
  console.log(`  hook.buyTaxBps() before: ${rateBefore} bps`);

  const quoted = quote(a.quoter, key, true, amountIn);
  console.log(`  Quoter.quoteExactInputSingle(0.1 ETH): ${fmtPupate(quoted.amountOut)} (gas estimate ${quoted.gas}; the launch rate moves between blocks, so compared loosely)`);
  const buyData = v4Swap({ key, zeroForOne: true, amountIn, deadline: (await latestBlock()).timestamp + 3600 });
  const buy = send(buyer, a.universalRouter, buyData, [], { value: amountIn });
  const taxed = taxedEvent(buy, a.hook);
  const pupateAfter = callUint(a.token, 'balanceOf(address)(uint256)', buyer);
  const totalTaxAfter = callUint(a.hook, 'totalTax()(uint256)');
  const received = pupateAfter - pupateBefore;

  check('Taxed event emitted by the hook', taxed !== null, taxed ? `rate ${taxed.rateBps} bps, tax ${fmtEth(taxed.tax)}` : 'none');
  if (taxed) {
    check('Taxed.buy is true', taxed.buy, '');
    check('Taxed.sender is the Universal Router', taxed.sender.toLowerCase() === a.universalRouter.toLowerCase(), taxed.sender);
    check('tax == 0.1 ETH * rateBps / 10000', taxed.tax === (amountIn * taxed.rateBps) / BPS, `${taxed.tax} wei`);
    check(
      'rate is the launch schedule rate (within 5 minutes of the pre-read)',
      taxed.rateBps <= rateBefore && rateBefore - taxed.rateBps <= 500n,
      `${taxed.rateBps} vs ${rateBefore} read just before`,
    );
    check('hook.totalTax() grew by exactly the tax', totalTaxAfter - totalTaxBefore === taxed.tax, fmtEth(totalTaxAfter - totalTaxBefore));
  }
  check('buyer received PUPATE', received > 0n, fmtPupate(received));
  check('quote within 10% of what the buy returned (rate fell between the quote and the buy)', within(received, quoted.amountOut, 1000n), `${fmtPupate(quoted.amountOut)} quoted`);
  console.log(`  gas used ${Number(buy.gasUsed)}; ETH reaching the pool ${taxed ? fmtEth(amountIn - taxed.tax) : '?'} -> ${fmtPupate(received)}`);
  results.push({ what: 'buy 0.1 ETH', tax: taxed?.tax, rate: taxed?.rateBps, out: received });

  // ---------------------------------------------------------------- (b) flush
  section('(b) hook.flush() into Cocoon');
  const [modeIdx, seatBps] = call(a.cocoon, 'mode()(uint8,uint256)').map((v) => BigInt(v));
  const claims = callUint(a.poolManager, 'balanceOf(address,uint256)(uint256)', a.hook, 0);
  const potsBefore = pots(a.cocoon);
  const flush = send(buyer, a.hook, 'flush()');
  const potsAfter = pots(a.cocoon);
  const flushed = wordEvent(flush, a.hook, TOPIC.flushed);
  const deposited = words(flush, a.cocoon, TOPIC.taxDeposited);

  const amount = flushed ?? 0n;
  const dev = (amount * 1000n) / BPS;
  const imd = (amount * 500n) / BPS;
  const strategy = amount - dev - imd;
  const seat = (strategy * seatBps) / BPS;
  const burn = strategy - seat;
  console.log(`  mode ${MODE[Number(modeIdx)]} (seat share of the strategy 85%: ${seatBps} bps); claims held ${fmtEth(claims)}`);
  const wei = (x) => `${fmtEth(x)} = ${x} wei`;
  check('Flushed amount equals the claims the hook held', flushed === claims, wei(amount));
  check('TaxDeposited emitted by Cocoon', deposited !== null, deposited ? `mode ${MODE[Number(deposited[5])]}` : 'none');
  check(`seatPot      +${pct(seat, amount)}`, potsAfter.seat - potsBefore.seat === seat, wei(potsAfter.seat - potsBefore.seat));
  check(`burnPot      +${pct(burn, amount)}`, potsAfter.burn - potsBefore.burn === burn, wei(potsAfter.burn - potsBefore.burn));
  check('developerBalance +10%', potsAfter.dev - potsBefore.dev === dev, wei(potsAfter.dev - potsBefore.dev));
  check('imdBurnBalance   +5%', potsAfter.imd - potsBefore.imd === imd, wei(potsAfter.imd - potsBefore.imd));
  const cocoonBalance = BigInt(await rpc('eth_getBalance', [a.cocoon, 'latest']));
  check(
    'Cocoon balance identity (balance == the four pots)',
    cocoonBalance === potsAfter.seat + potsAfter.burn + potsAfter.dev + potsAfter.imd,
    wei(cocoonBalance),
  );
  results.push({ what: 'flush', amount, pots: potsAfter, mode: MODE[Number(modeIdx)] });

  // ---------------------------------------------------------------- (c) feed
  section('(c) feed.latest()');
  const [floor, fresh] = call(a.feed, 'latest()(uint256,bool)');
  const want = BigInt(process.env.FLOOR_WEI || (28n * 10n ** 17n).toString());
  check(`floorWei is ${fmtEth(want)}`, BigInt(floor) === want, fmtEth(floor));
  check('fresh is true', String(fresh) === 'true', String(fresh));

  // ---------------------------------------------------------------- (d) after the launch window
  section('(d) 6000 seconds later: the standing tax');
  await rpc('evm_increaseTime', [6000]);
  await rpc('evm_mine', []);
  const rateLater = callUint(a.hook, 'buyTaxBps()(uint256)');
  check('hook.buyTaxBps() is 600', rateLater === 600n, `${rateLater} bps`);
  const smallIn = ETH / 100n;
  const quoted2 = quote(a.quoter, key, true, smallIn);
  const buy2Data = v4Swap({ key, zeroForOne: true, amountIn: smallIn, deadline: (await latestBlock()).timestamp + 3600 });
  const pupateBefore2 = callUint(a.token, 'balanceOf(address)(uint256)', buyer);
  const buy2 = send(buyer, a.universalRouter, buy2Data, [], { value: smallIn });
  const taxed2 = taxedEvent(buy2, a.hook);
  const received2 = callUint(a.token, 'balanceOf(address)(uint256)', buyer) - pupateBefore2;
  check('second buy taxed at 600 bps', taxed2 !== null && taxed2.rateBps === 600n, taxed2 ? `${taxed2.rateBps} bps` : 'no Taxed event');
  check('tax == 0.01 ETH * 6%', taxed2 !== null && taxed2.tax === (smallIn * 600n) / BPS, taxed2 ? fmtEth(taxed2.tax) : '');
  check('buyer received PUPATE', received2 > 0n, fmtPupate(received2));
  check('Quoter quote equals what the buy returned (same state, same 600 bps rate)', quoted2.amountOut === received2, `${fmtPupate(quoted2.amountOut)} quoted, gas estimate ${quoted2.gas}`);
  results.push({ what: 'buy 0.01 ETH after the window', tax: taxed2?.tax, rate: taxed2?.rateBps, out: received2 });

  // ---------------------------------------------------------------- (e) sell
  section('(e) sell half of the PUPATE through the Universal Router (Permit2)');
  const holding = callUint(a.token, 'balanceOf(address)(uint256)', buyer);
  const sellIn = holding / 2n;
  const expiry = (await latestBlock()).timestamp + 86_400;
  const max = (1n << 256n) - 1n;
  send(buyer, a.token, 'approve(address,uint256)', [MAINNET.permit2, max]);
  send(buyer, MAINNET.permit2, 'approve(address,address,uint160,uint48)', [a.token, a.universalRouter, sellIn, expiry]);
  const ethBefore = BigInt(await rpc('eth_getBalance', [buyer, 'latest']));
  const sellData = v4Swap({ key, zeroForOne: false, amountIn: sellIn, deadline: (await latestBlock()).timestamp + 3600 });
  const sell = send(buyer, a.universalRouter, sellData);
  const ethAfter = BigInt(await rpc('eth_getBalance', [buyer, 'latest']));
  const taxedSell = taxedEvent(sell, a.hook);
  const swap = words(sell, a.poolManager, TOPIC.swap);
  const gasCost = BigInt(sell.gasUsed) * BigInt(sell.effectiveGasPrice);
  const poolEthOut = swap ? signed(swap[0]) : 0n; // amount0 of the pool's delta: positive = ETH leaves the pool
  const ethOut = taxedSell ? poolEthOut - taxedSell.tax : 0n;
  check('Taxed(buy=false) at 600 bps', taxedSell !== null && !taxedSell.buy && taxedSell.rateBps === 600n, taxedSell ? `${taxedSell.rateBps} bps, tax ${fmtEth(taxedSell.tax)}` : 'no Taxed event');
  check('tax == 6% of the ETH the pool paid', taxedSell !== null && swap !== null && taxedSell.tax === (poolEthOut * 600n) / BPS, swap ? fmtEth(poolEthOut) + ' from the pool' : '');
  check('buyer got the ETH net of tax and gas', ethAfter - ethBefore === ethOut - gasCost, `${fmtEth(ethOut)} out, ${gasCost} wei of gas`);
  check('buyer PUPATE fell by the amount sold', callUint(a.token, 'balanceOf(address)(uint256)', buyer) === holding - sellIn, fmtPupate(sellIn));
  results.push({ what: `sell ${fmtPupate(sellIn)}`, tax: taxedSell?.tax, rate: taxedSell?.rateBps, out: ethOut });

  // ---------------------------------------------------------------- summary
  section('summary');
  for (const r of results) {
    if (r.what === 'flush') {
      console.log(`  flush ${fmtEth(r.amount)} in mode ${r.mode}: seatPot ${fmtEth(r.pots.seat)}, burnPot ${fmtEth(r.pots.burn)}, developer ${fmtEth(r.pots.dev)}, imdBurn ${fmtEth(r.pots.imd)}`);
    } else {
      const out = r.what.startsWith('sell') ? fmtEth(r.out) : fmtPupate(r.out);
      console.log(`  ${r.what}: tax ${r.tax !== undefined ? fmtEth(r.tax) : '?'} at ${r.rate ?? '?'} bps, received ${out}`);
    }
  }
  console.log(`  hook.totalTax() now ${fmtEth(callUint(a.hook, 'totalTax()(uint256)'))}`);
  console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
  if (failed) process.exitCode = 1;
}

// ------------------------------------------------------------------ Universal Router calldata

/**
 * execute(bytes commands, bytes[] inputs, uint256 deadline) with one V4_SWAP (0x10) whose actions are
 * SWAP_EXACT_IN_SINGLE (0x06), SETTLE_ALL (0x0c), TAKE_ALL (0x0f). Built with `cast abi-encode`.
 * ExactInputSingleParams as deployed at the mainnet router: (poolKey, zeroForOne, amountIn, amountOutMinimum, hookData).
 */
function v4Swap({ key, zeroForOne, amountIn, deadline }) {
  const poolKey = `(${key.currency0},${key.currency1},${key.fee},${key.tickSpacing},${key.hooks})`;
  const swap = castLocal(
    'abi-encode',
    'f(((address,address,uint24,int24,address),bool,uint128,uint128,bytes))',
    `(${poolKey},${zeroForOne},${amountIn},0,0x)`,
  );
  const currencyIn = zeroForOne ? key.currency0 : key.currency1;
  const currencyOut = zeroForOne ? key.currency1 : key.currency0;
  const settleAll = castLocal('abi-encode', 'f(address,uint256)', currencyIn, String(amountIn));
  const takeAll = castLocal('abi-encode', 'f(address,uint256)', currencyOut, '0');
  const input = castLocal('abi-encode', 'f(bytes,bytes[])', '0x060c0f', `[${swap},${settleAll},${takeAll}]`);
  return castLocal('calldata', 'execute(bytes,bytes[],uint256)', '0x10', `[${input}]`, String(deadline));
}

/** V4Quoter.quoteExactInputSingle((poolKey, zeroForOne, exactAmount, hookData)) -> (amountOut, gasEstimate). */
function quote(quoter, key, zeroForOne, exactAmount) {
  const poolKey = `(${key.currency0},${key.currency1},${key.fee},${key.tickSpacing},${key.hooks})`;
  const [amountOut, gas] = call(
    quoter,
    'quoteExactInputSingle(((address,address,uint24,int24,address),bool,uint128,bytes))(uint256,uint256)',
    `(${poolKey},${zeroForOne},${exactAmount},0x)`,
  );
  return { amountOut: BigInt(amountOut), gas: Number(gas) };
}

function within(actual, expected, toleranceBps) {
  const diff = actual > expected ? actual - expected : expected - actual;
  return diff * BPS <= expected * toleranceBps;
}

// ------------------------------------------------------------------ events

function logsOf(receipt, emitter, topic) {
  return (receipt.logs || []).filter(
    (l) => l.address.toLowerCase() === emitter.toLowerCase() && l.topics[0].toLowerCase() === topic.toLowerCase(),
  );
}

function dataWords(log) {
  const hex = log.data.replace(/^0x/, '');
  const out = [];
  for (let i = 0; i + 64 <= hex.length; i += 64) out.push(BigInt('0x' + hex.slice(i, i + 64)));
  return out;
}

/** Taxed(address indexed sender, bool buy, uint256 tax, uint256 rateBps) */
function taxedEvent(receipt, hook) {
  const log = logsOf(receipt, hook, TOPIC.taxed)[0];
  if (!log) return null;
  const [buy, tax, rateBps] = dataWords(log);
  return { sender: '0x' + log.topics[1].slice(-40), buy: buy === 1n, tax, rateBps };
}

function wordEvent(receipt, emitter, topic) {
  const log = logsOf(receipt, emitter, topic)[0];
  return log ? dataWords(log)[0] : null;
}

function words(receipt, emitter, topic) {
  const log = logsOf(receipt, emitter, topic)[0];
  return log ? dataWords(log) : null;
}

/** int128/int256 stored in a 32-byte word. */
function signed(word) {
  return word >= 1n << 255n ? word - (1n << 256n) : word;
}

// ------------------------------------------------------------------ reads, output

function pots(cocoon) {
  return {
    seat: callUint(cocoon, 'seatPot()(uint256)'),
    burn: callUint(cocoon, 'burnPot()(uint256)'),
    dev: callUint(cocoon, 'developerBalance()(uint256)'),
    imd: callUint(cocoon, 'imdBurnBalance()(uint256)'),
  };
}

function check(name, ok, detail) {
  if (!ok) failed++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`);
}

function section(title) {
  console.log(`\n== ${title}`);
}
