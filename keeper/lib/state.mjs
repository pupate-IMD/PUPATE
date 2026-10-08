// What the keeper knows at the start of a tick: the protocol's state in one multicall, the seats
// Cocoon holds (from its SeatBought / SeatAdopted / SeatSold logs, cached incrementally in
// .state/<chainId>.json), and for each held seat whether its listing has filled.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { isAddressEqual } from 'viem';
import { MODE, cocoonAbi, erc20Abi, erc721Abi, feedAbi, hookAbi, poolManagerAbi, seaportAbi } from './abi.mjs';
import { MULTICALL3 } from './chain.mjs';
import { seatComponents } from './listings.mjs';
import { fmtDuration, fmtEth, fmtTokens, short } from './log.mjs';

const SEAT_EVENTS = cocoonAbi.filter((x) => x.type === 'event' && ['SeatBought', 'SeatAdopted', 'SeatSold'].includes(x.name));

// ------------------------------------------------------------------ the cache file

export function emptyCache(chainId, cocoon, fromBlock) {
  return { chainId, cocoon, fromBlock: String(fromBlock), scannedTo: null, seats: {}, lastReportAttempt: 0, pendingReport: null };
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
        return { ...emptyCache(chainId, cocoon, fromBlock), ...c, seats: c.seats || {} };
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

/** Scan Cocoon's seat events from where the cache stopped up to `toBlock`, in LOG_CHUNK pieces. */
export async function syncSeats({ pub, cocoon, fromBlock, toBlock, cache, chunk }) {
  let from = cache.scannedTo === null ? BigInt(fromBlock) : BigInt(cache.scannedTo) + 1n;
  const step = BigInt(chunk);
  while (from <= toBlock) {
    const to = from + step - 1n < toBlock ? from + step - 1n : toBlock;
    const logs = await pub.getLogs({ address: cocoon, events: SEAT_EVENTS, fromBlock: from, toBlock: to });
    logs.sort((x, y) => (x.blockNumber === y.blockNumber ? Number(x.logIndex) - Number(y.logIndex) : x.blockNumber < y.blockNumber ? -1 : 1));
    for (const l of logs) {
      const id = l.args.tokenId.toString();
      if (l.eventName === 'SeatSold') {
        cache.seats[id] = { held: false, cost: l.args.cost.toString(), block: Number(l.blockNumber), event: 'SeatSold' };
      } else {
        cache.seats[id] = { held: true, cost: l.args.cost.toString(), block: Number(l.blockNumber), event: l.eventName };
      }
    }
    cache.scannedTo = Number(to);
    from = to + 1n;
  }
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
    return { token, balance: r[harvestAt + 2 * i], auction: { lot, start, startedAt } };
  });

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

  const keeperBalance = keeperAddress ? await pub.getBalance({ address: keeperAddress }) : null;

  return {
    block: { number: block.number, timestamp: block.timestamp, baseFee: block.baseFeePerGas ?? 0n },
    claims: r[0],
    totalTax: r[1],
    buyTaxBps: r[2],
    feed: { floorWei, fresh, issuedAt, expiresAt, maxAge, freshUntil },
    pots: { seat: r[7], burn: r[8], dev: r[9], imd: r[10] },
    heldCount: r[11],
    heldCost: r[12],
    lastBurnBlock: r[13],
    wired: r[14],
    params: r[15],
    imdAuction: { lot: imdLot, start: imdStart, startedAt: imdStartedAt },
    mode: { index: Number(modeIdx), name: MODE[Number(modeIdx)], seatBps },
    totalSupply: r[18],
    counter,
    harvest,
    seats,
    keeperBalance,
  };
}

/** The compact one-line status printed every tick. */
export function statusLine(s) {
  const now = s.block.timestamp;
  const feed = s.feed.issuedAt === 0n
    ? 'no report'
    : `floor ${fmtEth(s.feed.floorWei)} ${s.feed.fresh ? `fresh (stale in ${fmtDuration(s.feed.freshUntil - now)})` : `STALE (${fmtDuration(now - s.feed.freshUntil)} ago)`}`;
  const seats = s.seats.length ? s.seats.map((x) => `#${x.tokenId}${x.gone || x.filled ? '(sold)' : ''}`).join(' ') : '0';
  const imd = s.imdAuction.lot === 0n ? 'none' : `${fmtEth(s.imdAuction.lot)} lot`;
  return (
    `block ${s.block.number} | ${feed} | hook claims ${fmtEth(s.claims)} | pots seat ${fmtEth(s.pots.seat)} burn ${fmtEth(s.pots.burn)} ` +
    `dev ${fmtEth(s.pots.dev)} imd ${fmtEth(s.pots.imd)} | held ${seats} | mode ${s.mode.name} | supply ${fmtTokens(s.totalSupply)} | ` +
    `imd auction ${imd}` +
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
  if (s.keeperBalance !== null) lines.push(`keeper    balance ${fmtEth(s.keeperBalance)}`);
  lines.push(`sources   attestation ${cfg.attestationSource}, listings ${cfg.listingSource}${cfg.flags.dryRun ? ', DRY RUN' : ''}`);
  return lines;
}
