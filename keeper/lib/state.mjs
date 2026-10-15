// What the keeper knows at the start of a tick: the protocol's state in one multicall, the seats
// Cocoon holds (from its SeatBought / SeatAdopted / SeatSold logs, cached incrementally in
// .state/<chainId>.json), and for each held seat whether its listing has filled. With Metamorph MD
// in the addresses file, the mine's state too: its numbers, the seats it noted, the vault's seats
// confirmed on chain, and the staked cards (from its StakedCard / Unstaked logs, cached the same way).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { isAddressEqual, zeroAddress } from 'viem';
import { MODE, cocoonAbi, erc20Abi, erc721Abi, feedAbi, hookAbi, metamorphAbi, poolManagerAbi, seaportAbi } from './abi.mjs';
import { MULTICALL3, revertReason } from './chain.mjs';
import { seatComponents } from './listings.mjs';
import { fmtDuration, fmtEth, fmtTokens, short } from './log.mjs';

const SEAT_EVENTS = cocoonAbi.filter((x) => x.type === 'event' && ['SeatBought', 'SeatAdopted', 'SeatSold'].includes(x.name));
const STAKE_EVENTS = metamorphAbi.filter((x) => x.type === 'event' && ['StakedCard', 'Unstaked'].includes(x.name));
const ascending = (x, y) => (x < y ? -1 : x > y ? 1 : 0);

// ------------------------------------------------------------------ the cache file

export function emptyCache(chainId, cocoon, fromBlock) {
  return {
    chainId,
    cocoon,
    fromBlock: String(fromBlock),
    scannedTo: null,
    seats: {},
    lastReportAttempt: 0,
    pendingReport: null,
    // For the status feed: when the last tick finished and the last transactions sent (see status.mjs).
    lastTickAt: null,
    lastActions: [],
    // Metamorph MD's staked cards, { metamorph, scannedTo, staked: { id: staker } } (see syncStakes).
    mine: null,
  };
}

/**
 * The cache is only trusted for the same chain, the same Cocoon and the same deployment block (a
 * redeploy from the same nonce lands on the same address); anything else starts over.
 */
export function loadCache(file, chainId, cocoon, fromBlock) {
  if (existsSync(file)) {
    try {
      const c = JSON.parse(readFileSync(file, 'utf8'));
      if (Number(c.chainId) === chainId && c.cocoon && isAddressEqual(c.cocoon, cocoon) && String(c.fromBlock) === String(fromBlock)) {
        return { ...emptyCache(chainId, cocoon, fromBlock), ...c, seats: c.seats || {}, lastActions: Array.isArray(c.lastActions) ? c.lastActions : [] };
      }
    } catch {
      // unreadable: start over
    }
  }
  return emptyCache(chainId, cocoon, fromBlock);
}

export function saveCache(file, cache) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(cache, null, 2) + '\n');
}

/** True when an RPC refused a log query for its block range (Alchemy's free tier allows 10 blocks, others 2,000 or 10,000). */
export function isRangeRefusal(e) {
  const code = e?.code ?? e?.cause?.code;
  const text = `${e?.details || ''} ${e?.shortMessage || ''} ${e?.message || ''}`;
  return code === -32600 || code === -32005 || code === -32602 || /block range|too many|exceed|more than|limit/i.test(text);
}

/**
 * Scan `events` of `address` from block `from` up to `toBlock`, in LOG_CHUNK pieces, handing each piece
 * to `onChunk(logs, to)` in chain order. When the node refuses a range it is halved and retried, and
 * the size that worked is kept in the cache, so the next tick starts from it instead of learning it again.
 */
async function scanLogs({ pub, address, events, from, toBlock, cache, chunk }, onChunk) {
  let step = BigInt(cache.logChunk && cache.logChunk < chunk ? cache.logChunk : chunk);
  while (from <= toBlock) {
    const to = from + step - 1n < toBlock ? from + step - 1n : toBlock;
    let logs;
    try {
      logs = await pub.getLogs({ address, events, fromBlock: from, toBlock: to });
    } catch (e) {
      if (!isRangeRefusal(e) || step <= 1n) throw e;
      step = step / 2n < 1n ? 1n : step / 2n;
      cache.logChunk = Number(step);
      continue;
    }
    logs.sort((x, y) => (x.blockNumber === y.blockNumber ? Number(x.logIndex) - Number(y.logIndex) : x.blockNumber < y.blockNumber ? -1 : 1));
    onChunk(logs, to);
    from = to + 1n;
  }
}

/** Scan Cocoon's seat events from where the cache stopped up to `toBlock` (see scanLogs). */
export async function syncSeats({ pub, cocoon, fromBlock, toBlock, cache, chunk }) {
  const from = cache.scannedTo === null ? BigInt(fromBlock) : BigInt(cache.scannedTo) + 1n;
  await scanLogs({ pub, address: cocoon, events: SEAT_EVENTS, from, toBlock, cache, chunk }, (logs, to) => {
    for (const l of logs) {
      const id = l.args.tokenId.toString();
      if (l.eventName === 'SeatSold') {
        cache.seats[id] = { held: false, cost: l.args.cost.toString(), block: Number(l.blockNumber), event: 'SeatSold' };
      } else {
        cache.seats[id] = { held: true, cost: l.args.cost.toString(), block: Number(l.blockNumber), event: l.eventName };
      }
    }
    cache.scannedTo = Number(to);
  });
  return cache;
}

/**
 * Scan Metamorph MD's StakedCard / Unstaked events into `cache.mine.staked` (card id -> staker), from
 * FROM_BLOCK and then from where the last scan stopped, as syncSeats does for the seats. Another token
 * address starts the set over. The set only names candidates: readState confirms each with stakeOf.
 */
export async function syncStakes({ pub, metamorph, fromBlock, toBlock, cache, chunk }) {
  if (!cache.mine || !cache.mine.metamorph || !isAddressEqual(cache.mine.metamorph, metamorph)) {
    cache.mine = { metamorph, scannedTo: null, staked: {} };
  }
  const m = cache.mine;
  const from = m.scannedTo === null ? BigInt(fromBlock) : BigInt(m.scannedTo) + 1n;
  await scanLogs({ pub, address: metamorph, events: STAKE_EVENTS, from, toBlock, cache, chunk }, (logs, to) => {
    for (const l of logs) {
      const id = l.args.id.toString();
      if (l.eventName === 'StakedCard') m.staked[id] = l.args.staker;
      else delete m.staked[id];
    }
    m.scannedTo = Number(to);
  });
  return cache;
}

// ------------------------------------------------------------------ the state

const call = (address, abi, functionName, args = []) => ({ address, abi, functionName, args });

/**
 * One multicall for the protocol, then (only when seats are held) two more for the seats' owners,
 * order hashes and order statuses. `cache.seats` must already be synced to the current block.
 */
export async function readState({ pub, cfg, cache, keeperAddress }) {
  const a = cfg.addresses;
  const block = await pub.getBlock({ blockTag: 'latest' });
  const base = [
    call(a.poolManager, poolManagerAbi, 'balanceOf', [a.hook, 0n]),
    call(a.hook, hookAbi, 'totalTax'),
    call(a.hook, hookAbi, 'buyTaxBps'),
    call(a.feed, feedAbi, 'latest'),
    call(a.feed, feedAbi, 'issuedAt'),
    call(a.feed, feedAbi, 'expiresAt'),
    call(a.feed, feedAbi, 'maxAge'),
    call(a.cocoon, cocoonAbi, 'seatPot'),
    call(a.cocoon, cocoonAbi, 'burnPot'),
    call(a.cocoon, cocoonAbi, 'developerBalance'),
    call(a.cocoon, cocoonAbi, 'imdBurnBalance'),
    call(a.cocoon, cocoonAbi, 'heldCount'),
    call(a.cocoon, cocoonAbi, 'heldCost'),
    call(a.cocoon, cocoonAbi, 'lastBurnBlock'),
    call(a.cocoon, cocoonAbi, 'wired'),
    call(a.cocoon, cocoonAbi, 'getParams'),
    call(a.cocoon, cocoonAbi, 'imdAuction'),
    call(a.cocoon, cocoonAbi, 'mode'),
    call(a.token, erc20Abi, 'totalSupply'),
    call(a.seaport, seaportAbi, 'getCounter', [a.cocoon]),
    call(a.hook, hookAbi, 'taxBps'),
    call(a.hook, hookAbi, 'openedAt'),
  ];
  const harvestAt = base.length;
  for (const t of cfg.harvestTokens) {
    base.push(call(t, erc20Abi, 'balanceOf', [a.cocoon]));
    base.push(call(a.cocoon, cocoonAbi, 'auctions', [t]));
  }
  const heldIds = Object.entries(cache.seats)
    .filter(([, s]) => s.held)
    .map(([id]) => BigInt(id));
  const seatsAt = base.length;
  for (const id of heldIds) base.push(call(a.cocoon, cocoonAbi, 'seats', [id]));

  const r = await pub.multicall({ contracts: base, allowFailure: false, multicallAddress: MULTICALL3 });
  const [floorWei, fresh] = r[3];
  const issuedAt = BigInt(r[4]);
  const expiresAt = BigInt(r[5]);
  const maxAge = BigInt(r[6]);
  const byAge = issuedAt + maxAge;
  const freshUntil = issuedAt === 0n ? 0n : byAge < expiresAt ? byAge : expiresAt;
  const [imdLot, imdStart, imdStartedAt] = r[16];
  const [modeIdx, seatBps] = r[17];

  const harvest = cfg.harvestTokens.map((token, i) => {
    const [lot, start, startedAt] = r[harvestAt + 2 * i + 1];
    return { token, balance: r[harvestAt + 2 * i], auction: { lot, start, startedAt, price: null } };
  });

  // The running auctions' prices now. imdDemand and auctionPrice revert with NoAuction when nothing
  // runs, so they are asked only for a running auction and may fail without failing the tick.
  const priceCalls = [];
  if (imdLot !== 0n) priceCalls.push({ key: 'imd', c: call(a.cocoon, cocoonAbi, 'imdDemand') });
  harvest.forEach((h, i) => {
    if (h.auction.lot !== 0n) priceCalls.push({ key: i, c: call(a.cocoon, cocoonAbi, 'auctionPrice', [h.token]) });
  });
  let imdDemand = null;
  if (priceCalls.length) {
    const rp = await pub.multicall({ contracts: priceCalls.map((x) => x.c), allowFailure: true, multicallAddress: MULTICALL3 });
    priceCalls.forEach((x, i) => {
      const v = rp[i].status === 'success' ? rp[i].result : null;
      if (x.key === 'imd') imdDemand = v;
      else harvest[x.key].auction.price = v;
    });
  }

  // Held seats: terms from the contract, then owner + order hashes, then order statuses.
  let seats = heldIds.map((tokenId, i) => {
    const [cost, boughtAt, startX, endX, decay, held, round] = r[seatsAt + i];
    return { tokenId, held, terms: { cost, boughtAt, startX, endX, decay, round } };
  });
  seats = seats.filter((s) => s.held);
  const counter = r[19];
  if (seats.length) {
    const q1 = [];
    for (const s of seats) {
      const comps = seatComponents(a.cocoon, a.collection, s.tokenId, s.terms, counter);
      q1.push(call(a.collection, erc721Abi, 'ownerOf', [s.tokenId]));
      q1.push(call(a.seaport, seaportAbi, 'getOrderHash', [comps[0]]));
      q1.push(call(a.seaport, seaportAbi, 'getOrderHash', [comps[1]]));
    }
    const r1 = await pub.multicall({ contracts: q1, allowFailure: true, multicallAddress: MULTICALL3 });
    const q2 = [];
    seats.forEach((s, i) => {
      const owner = r1[3 * i].status === 'success' ? r1[3 * i].result : null;
      const hashes = [r1[3 * i + 1], r1[3 * i + 2]].map((x) => (x.status === 'success' ? x.result : null));
      s.owner = owner;
      s.hashes = hashes;
      for (const h of hashes) q2.push(call(a.seaport, seaportAbi, 'getOrderStatus', [h]));
    });
    const r2 = await pub.multicall({ contracts: q2, allowFailure: true, multicallAddress: MULTICALL3 });
    seats.forEach((s, i) => {
      s.status = [r2[2 * i], r2[2 * i + 1]].map((x) => {
        if (x.status !== 'success') return null;
        const [isValidated, isCancelled, totalFilled, totalSize] = x.result;
        return { isValidated, isCancelled, totalFilled, totalSize };
      });
      s.gone = s.owner === null || !isAddressEqual(s.owner, a.cocoon);
      s.filled = s.status.some((st) => st && st.totalFilled !== 0n);
    });
  }

  // Metamorph MD, when the addresses file names it, in reads of its own: a mine that cannot be read
  // leaves the vault's steps alone, and its four duties idle with the reason.
  let mine = null;
  if (a.metamorph) {
    try {
      mine = await readMine({ pub, a, cache, replayHeld: heldIds, seats });
    } catch (e) {
      mine = { error: revertReason(e) };
    }
  }

  const keeperBalance = keeperAddress ? await pub.getBalance({ address: keeperAddress }) : null;

  return {
    block: { number: block.number, timestamp: block.timestamp, baseFee: block.baseFeePerGas ?? 0n },
    claims: r[0],
    totalTax: r[1],
    buyTaxBps: r[2],
    taxBps: r[20],
    openedAt: r[21],
    feed: { floorWei, fresh, issuedAt, expiresAt, maxAge, freshUntil },
    pots: { seat: r[7], burn: r[8], dev: r[9], imd: r[10] },
    heldCount: r[11],
    heldCost: r[12],
    lastBurnBlock: r[13],
    wired: r[14],
    params: r[15],
    imdAuction: { lot: imdLot, start: imdStart, startedAt: imdStartedAt, demand: imdDemand },
    mode: { index: Number(modeIdx), name: MODE[Number(modeIdx)], seatBps },
    totalSupply: r[18],
    counter,
    harvest,
    seats,
    mine,
    keeperBalance,
  };
}

/**
 * The mine's side of the state, from Metamorph MD and Cocoon: one multicall for the numbers and the
 * noted seats, then one for what must be confirmed. The vault's seats are confirmed the way the token
 * checks them itself (`_vaultHolds`: on Cocoon's books and in Cocoon's wallet): `seats` are the replay's
 * held seats readState already found on the books, with their owner, and a noted seat the replay does not
 * list as held is read here the same way, so a noted seat is never forgotten on the logs' word alone.
 * The staked cards are the replay's candidates confirmed with `stakeOf` (a non-zero staker), each with
 * `stageOf`. Returns { error: null, noted, mineable, held, stakes, pot, ethPot, ... }.
 */
async function readMine({ pub, a, cache, replayHeld, seats }) {
  const md = a.metamorph;
  const r = await pub.multicall({
    contracts: [
      call(md, metamorphAbi, 'notedSeats'),
      call(md, metamorphAbi, 'mineableSeats'),
      call(md, metamorphAbi, 'pot'),
      call(md, metamorphAbi, 'ethPot'),
      call(md, metamorphAbi, 'lastConvertBlock'),
      call(md, metamorphAbi, 'mintPrice'),
      call(md, metamorphAbi, 'totalMinted'),
      call(md, metamorphAbi, 'bits'),
      call(md, metamorphAbi, 'epoch'),
      call(md, metamorphAbi, 'lastMintAt'),
      call(md, metamorphAbi, 'CONVERT_SPACING'),
      call(md, metamorphAbi, 'CONVERT_PRICES'),
      call(md, metamorphAbi, 'dutiesDue'),
    ],
    allowFailure: false,
    multicallAddress: MULTICALL3,
  });
  const noted = [...r[0]];
  const replayed = new Set(replayHeld.map(String));
  const extra = noted.filter((id) => !replayed.has(id.toString()));
  const stakedIds = Object.keys(cache.mine?.staked || {})
    .map((id) => BigInt(id))
    .sort(ascending);
  const q = [];
  for (const id of extra) q.push(call(a.cocoon, cocoonAbi, 'seats', [id]), call(a.collection, erc721Abi, 'ownerOf', [id]));
  for (const id of stakedIds) q.push(call(md, metamorphAbi, 'stakeOf', [id]), call(md, metamorphAbi, 'stageOf', [id]));
  // Two calls per staked card: in pieces of 8 KB of calldata (about 220 calls, a few million gas per
  // eth_call) rather than viem's 1 KB, so thousands of staked cards stay a few dozen calls a tick.
  const r2 = q.length ? await pub.multicall({ contracts: q, allowFailure: true, multicallAddress: MULTICALL3, batchSize: 8_192 }) : [];

  const held = seats.filter((x) => !x.gone).map((x) => x.tokenId);
  extra.forEach((id, i) => {
    const [books, owner] = [r2[2 * i], r2[2 * i + 1]];
    if (books.status === 'success' && books.result[5] && owner.status === 'success' && isAddressEqual(owner.result, a.cocoon)) held.push(id);
  });
  held.sort(ascending);

  const stakes = [];
  const at = 2 * extra.length;
  stakedIds.forEach((id, i) => {
    const [st, stage] = [r2[at + 2 * i], r2[at + 2 * i + 1]];
    if (st.status !== 'success' || stage.status !== 'success') return; // unreadable this tick: the next one retries
    const [staker, weight] = st.result;
    if (isAddressEqual(staker, zeroAddress)) return; // unstaked after the logs were read
    stakes.push({ id, staker, weight: Number(weight), stage: Number(stage.result) });
  });

  const [flushDue, burnDue, convertDue] = r[12];
  return {
    error: null,
    noted,
    mineable: [...r[1]],
    held,
    stakes,
    pot: r[2],
    ethPot: r[3],
    lastConvertBlock: r[4],
    mintPrice: r[5],
    totalMinted: Number(r[6]),
    bits: Number(r[7]),
    epoch: Number(r[8]),
    lastMintAt: BigInt(r[9]),
    convertSpacing: BigInt(r[10]),
    convertPrices: r[11],
    dutiesDue: { flush: flushDue, burn: burnDue, convert: convertDue },
  };
}

/** "#1 #1376", or "12 seats" past six of them, or "none". */
const seatTags = (ids) => (ids.length === 0 ? 'none' : ids.length > 6 ? `${ids.length} seats` : ids.map((id) => `#${id}`).join(' '));

/** The compact one-line status printed every tick. */
export function statusLine(s) {
  const now = s.block.timestamp;
  const feed = s.feed.issuedAt === 0n
    ? 'no report'
    : `floor ${fmtEth(s.feed.floorWei)} ${s.feed.fresh ? `fresh (stale in ${fmtDuration(s.feed.freshUntil - now)})` : `STALE (${fmtDuration(now - s.feed.freshUntil)} ago)`}`;
  const seats = s.seats.length ? s.seats.map((x) => `#${x.tokenId}${x.gone || x.filled ? '(sold)' : ''}`).join(' ') : '0';
  const imd = s.imdAuction.lot === 0n ? 'none' : `${fmtEth(s.imdAuction.lot)} lot`;
  const mine = !s.mine
    ? ''
    : s.mine.error
      ? ' | mine unreadable'
      : ` | mine ${s.mine.totalMinted} minted, noted ${seatTags(s.mine.noted)}, pot ${fmtTokens(s.mine.pot)}`;
  return (
    `block ${s.block.number} | ${feed} | hook claims ${fmtEth(s.claims)} | pots seat ${fmtEth(s.pots.seat)} burn ${fmtEth(s.pots.burn)} ` +
    `dev ${fmtEth(s.pots.dev)} imd ${fmtEth(s.pots.imd)} | held ${seats} | mode ${s.mode.name} | supply ${fmtTokens(s.totalSupply)} | ` +
    `imd auction ${imd}` +
    mine +
    (s.keeperBalance !== null ? ` | keeper ${fmtEth(s.keeperBalance)}` : '')
  );
}

/** The multi-line report behind --status. */
export function statusReport(s, cfg) {
  const now = s.block.timestamp;
  const p = s.params;
  const lines = [
    `block ${s.block.number} at ${new Date(Number(now) * 1000).toISOString()} (base fee ${Number(s.block.baseFee) / 1e9} gwei)`,
    `feed      floor ${fmtEth(s.feed.floorWei)} issued ${s.feed.issuedAt === 0n ? '-' : new Date(Number(s.feed.issuedAt) * 1000).toISOString()} ` +
      `maxAge ${fmtDuration(s.feed.maxAge)} ${s.feed.fresh ? `fresh, stale in ${fmtDuration(s.feed.freshUntil - now)}` : 'STALE'}`,
    `hook      claims ${fmtEth(s.claims)} totalTax ${fmtEth(s.totalTax)} buyTax ${s.buyTaxBps} bps`,
    `cocoon    seatPot ${fmtEth(s.pots.seat)} burnPot ${fmtEth(s.pots.burn)} developer ${fmtEth(s.pots.dev)} imdBurn ${fmtEth(s.pots.imd)}`,
    `          mode ${s.mode.name} (seat share ${s.mode.seatBps} bps) wired ${s.wired} heldCount ${s.heldCount} heldCost ${fmtEth(s.heldCost)} lastBurnBlock ${s.lastBurnBlock}`,
    `params    tolerance ${p.toleranceBps} bps, caller reward ${p.callerRewardBps} bps, burn impact ${p.burnImpactBps} bps, burn spacing ${p.burnSpacing} blocks, ` +
      `list ${p.listStartX}->${p.listEndX} over ${fmtDuration(p.listDecay)}, harvest start ${fmtEth(p.harvestStartWei)}, imd start ${fmtTokens(p.imdStartPerEth, 'IMD')}/ETH`,
    `token     totalSupply ${fmtTokens(s.totalSupply)}`,
    `imd auct. ${s.imdAuction.lot === 0n ? 'none' : `lot ${fmtEth(s.imdAuction.lot)} started ${new Date(Number(s.imdAuction.startedAt) * 1000).toISOString()}`}`,
  ];
  for (const h of s.harvest) {
    lines.push(`harvest   ${short(h.token)} balance ${h.balance} ${h.auction.lot === 0n ? 'no auction' : `auction lot ${h.auction.lot}`}`);
  }
  if (s.seats.length === 0) lines.push('seats     none held');
  for (const x of s.seats) {
    lines.push(
      `seat #${x.tokenId}  cost ${fmtEth(x.terms.cost)} round ${x.terms.round} bought ${new Date(Number(x.terms.boughtAt) * 1000).toISOString()} ` +
        `owner ${x.owner ? short(x.owner) : '?'} falling ${x.status[0] ? `${x.status[0].isValidated ? 'validated' : 'not validated'}${x.status[0].totalFilled ? ' FILLED' : ''}` : '?'} ` +
        `tail ${x.status[1] ? `${x.status[1].isValidated ? 'validated' : 'not validated'}${x.status[1].isCancelled ? ' cancelled' : ''}` : '?'}` +
        (x.gone || x.filled ? '  -> settle' : ''),
    );
  }
  if (s.mine?.error) lines.push(`mine      unreadable: ${s.mine.error}`);
  else if (s.mine) {
    const m = s.mine;
    const yes = (b) => (b ? 'yes' : 'no');
    lines.push(
      `mine      minted ${m.totalMinted}, epoch ${m.epoch}, mint price ${fmtTokens(m.mintPrice)}, ${m.bits} bit${m.bits === 1 ? '' : 's'}, ` +
        `last mint ${new Date(Number(m.lastMintAt) * 1000).toISOString()}`,
      `          noted ${seatTags(m.noted)}, mineable ${seatTags(m.mineable)}, the vault holds ${seatTags(m.held)}`,
      `          pot ${fmtTokens(m.pot)}, ethPot ${fmtEth(m.ethPot)}, lastConvertBlock ${m.lastConvertBlock} (spacing ${m.convertSpacing}), ` +
        `duties due: flush ${yes(m.dutiesDue.flush)} burn ${yes(m.dutiesDue.burn)} convert ${yes(m.dutiesDue.convert)}`,
      `          staked ${m.stakes.length} card${m.stakes.length === 1 ? '' : 's'}, ` +
        `${m.stakes.filter((x) => x.stage + 1 !== x.weight).length} of them at a weight their stage no longer has`,
    );
  }
  if (s.keeperBalance !== null) lines.push(`keeper    balance ${fmtEth(s.keeperBalance)}`);
  lines.push(`sources   attestation ${cfg.attestationSource}, listings ${cfg.listingSource}${cfg.flags.dryRun ? ', DRY RUN' : ''}`);
  return lines;
}
