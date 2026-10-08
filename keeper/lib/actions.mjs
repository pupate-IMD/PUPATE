// The six decisions of a tick, in the order the loop runs them: report, flush, settle, buy, burn,
// auctions. Each one pre-checks what it can from the state, simulates with eth_call through
// tx.run (which logs a decoded custom error and skips on revert), and returns { acted, note } so
// the loop can print one "idle:" line for everything that had nothing to do.
//
// The pre-checks are the *Decision functions and scanListings. The status feed (status.mjs) calls
// the same functions on the same state, so what status.json says a step would do right now is
// exactly what the step itself decides.
import { isAddressEqual } from 'viem';
import { cocoonAbi, erc20Abi, feedAbi, hookAbi, seaportAbi } from './abi.mjs';
import { MULTICALL3 } from './chain.mjs';
import { checkOrder, listingsFromFile, listingsFromOpenSea, toAdvancedOrder, toComponents } from './listings.mjs';
import { fmtDuration, fmtEth, log, short } from './log.mjs';
import { attestedFloor, imdAttestation, localAttestation, reportDue, verifyAttestation } from './oracle.mjs';

const BPS = 10_000n;
const idle = (note) => ({ acted: false, note });
const acted = (res) => ({ acted: res.status === 'sent' || res.status === 'dry', res, note: '' });

// ------------------------------------------------------------------ a. report

/** Whether a report is due, by the feed's own clock. `force` is --force-report. */
export function reportDecision(cfg, s, force = false) {
  const due = reportDue({ ...s.feed, now: s.block.timestamp, everySec: cfg.reportEverySec, leadSec: cfg.reportLeadSec, force });
  return { ready: due.due, why: due.due ? `report due: ${due.reason}` : `report ${due.reason}`, due };
}

export async function report(ctx, s) {
  const { cfg, a, tx, cache, pub, account } = ctx;
  const { due } = reportDecision(cfg, s, ctx.forceReport);
  if (!due.due) return idle(`report ${due.reason}`);
  if (cfg.attestationSource === 'none') return idle(`report due (${due.reason}) but ATTESTATION_SOURCE is not set`);
  const since = Date.now() - (cache.lastReportAttempt || 0);
  if (!ctx.forceReport && since < cfg.reportRetrySec * 1000) {
    return idle(`report due, last attempt ${fmtDuration(since / 1000)} ago (REPORT_RETRY ${cfg.reportRetrySec}s)`);
  }
  cache.lastReportAttempt = Date.now();
  ctx.persist();
  log(`report due: ${due.reason}; attestation source ${cfg.attestationSource}`);

  const [questionHash, evidenceChainId, attester] = await pub.multicall({
    contracts: [
      { address: a.feed, abi: feedAbi, functionName: 'questionHash' },
      { address: a.feed, abi: feedAbi, functionName: 'EVIDENCE_CHAIN_ID' },
      { address: a.feed, abi: feedAbi, functionName: 'attester' },
    ],
    allowFailure: false,
    multicallAddress: MULTICALL3,
  });

  let signed;
  if (cfg.attestationSource === 'local') {
    if (!cfg.localAttesterKey) {
      log('skip report: LOCAL_ATTESTER_KEY is not set');
      return idle('');
    }
    signed = await localAttestation({
      pub,
      chainId: cfg.chainId,
      feed: a.feed,
      attesterKey: cfg.localAttesterKey,
      floorWei: cfg.localFloorWei,
      prevIssuedAt: s.feed.issuedAt,
      questionHash,
      evidenceChainId,
    });
  } else {
    signed = await imdAttestation({
      cfg,
      account,
      cache,
      persist: ctx.persist,
      feed: a.feed,
      consumerChainId: cfg.chainId,
      evidenceChainId,
      dryRun: ctx.dryRun,
    });
    if (!signed) return idle('report: IMD dry run');
  }

  const v = await verifyAttestation({ chainId: cfg.chainId, feed: a.feed, ...signed, attester });
  if (!v.ok) {
    log(`skip report: the attestation recovers ${v.signer ?? 'nobody'}, not the feed's attester ${attester}`);
    return idle('');
  }
  if (signed.attestation.questionHash.toLowerCase() !== questionHash.toLowerCase()) {
    log(`skip report: attestation questionHash ${signed.attestation.questionHash} is not the pinned ${questionHash}`);
    return idle('');
  }
  const floor = attestedFloor(signed.attestation);
  const label = `report floor ${fmtEth(floor)} (issued ${new Date(Number(signed.attestation.issuedAt) * 1000).toISOString()})`;
  return acted(await tx.run(label, { address: a.feed, abi: feedAbi, functionName: 'report', args: [signed.attestation, signed.signature] }));
}

// ------------------------------------------------------------------ b. flush

/** flush runs when the hook's ETH claims on the PoolManager are at least MIN_FLUSH_WEI. */
export function flushDecision(cfg, s) {
  if (s.claims === 0n) return { ready: false, why: 'nothing to flush' };
  if (s.claims < cfg.minFlushWei) return { ready: false, why: `flush ${fmtEth(s.claims)} < MIN_FLUSH_WEI ${fmtEth(cfg.minFlushWei)}` };
  return { ready: true, why: `the hook holds ${fmtEth(s.claims)} of tax`, label: `flush ${fmtEth(s.claims)}` };
}

export async function flush(ctx, s) {
  const { cfg, a, tx } = ctx;
  const d = flushDecision(cfg, s);
  if (!d.ready) return idle(d.why);
  return acted(await tx.run(d.label, { address: a.hook, abi: hookAbi, functionName: 'flush' }));
}

// ------------------------------------------------------------------ c. settle

const settleWhy = (seat) => (seat.gone ? `owner is ${seat.owner ? short(seat.owner) : 'nobody'}` : 'listing filled');

/** settleSeat is due for every held seat whose owner changed or whose order shows a fill. */
export function settleDecision(s) {
  if (s.seats.length === 0) return { ready: false, why: 'no seats held', due: [] };
  const due = s.seats.filter((x) => x.gone || x.filled);
  if (due.length === 0) {
    const open = s.seats.map((x) => `#${x.tokenId}`);
    return { ready: false, why: `${open.length} seat(s) still listed: ${open.join(' ')}`, due };
  }
  return { ready: true, why: due.map((x) => `#${x.tokenId} ${settleWhy(x)}`).join(', '), due };
}

export async function settle(ctx, s) {
  const { a, tx, cache } = ctx;
  const d = settleDecision(s);
  if (!d.ready) return idle(d.why);
  let did = false;
  for (const seat of d.due) {
    const res = await tx.run(`settleSeat #${seat.tokenId} (${settleWhy(seat)})`, { address: a.cocoon, abi: cocoonAbi, functionName: 'settleSeat', args: [seat.tokenId] });
    if (res.status === 'sent') {
      cache.seats[seat.tokenId.toString()] = { ...(cache.seats[seat.tokenId.toString()] || {}), held: false, event: 'settled' };
      ctx.persist();
      did = true;
    } else if (res.status === 'dry') did = true;
  }
  return did ? { acted: true, note: '' } : idle(`${d.due.length} seat(s) to settle, none went through`);
}

// ------------------------------------------------------------------ d. buy

const byPrice = (x, y) => (x.c.price < y.c.price ? -1 : x.c.price > y.c.price ? 1 : 0);

/**
 * The buy step's view of the market, read-only: the keeper's gates (a listing source, a fresh
 * floor, a pot), the listings from the source, each one through checkOrder, the valid ones by
 * price, the ones the seat pot covers (price plus reward), and Seaport's status for the first five.
 * Returns { source, fetchedAt, ceiling, affordable, checked: [{ l, c, skip }], tryList, ready,
 * why, best, error }. `buy` acts on it; the status feed publishes it.
 */
export async function scanListings(ctx, s) {
  const { cfg, a, pub } = ctx;
  const p = s.params;
  const tolerance = BigInt(p.toleranceBps);
  const reward = BigInt(p.callerRewardBps);
  const ceiling = (s.feed.floorWei * (BPS + tolerance)) / BPS;
  const affordable = (s.pots.seat * BPS) / (BPS + reward);
  const scan = { source: cfg.listingSource, fetchedAt: null, ceiling, affordable, checked: [], tryList: [], ready: false, why: '', best: null, error: null };
  if (cfg.listingSource === 'none') return { ...scan, why: 'buy: no LISTING_SOURCE' };
  if (!s.feed.fresh) return { ...scan, why: 'buy: floor not fresh' };
  if (affordable === 0n) return { ...scan, why: 'buy: seat pot empty' };

  let listings;
  try {
    listings =
      cfg.listingSource === 'file'
        ? listingsFromFile(cfg.listingsFile)
        : await listingsFromOpenSea({ apiKey: cfg.openseaApiKey, api: cfg.openseaApi, chain: cfg.openseaChain, collection: a.collection, seaport: a.seaport });
  } catch (e) {
    return { ...scan, error: e.message, why: `buy: listings unavailable: ${e.message}` };
  }
  scan.fetchedAt = new Date().toISOString();
  if (listings.length === 0) return { ...scan, why: `buy: no listings (${cfg.listingSource})` };

  const heldIds = new Set(s.seats.map((x) => x.tokenId.toString()));
  scan.checked = listings.map((l) => ({
    l,
    c: checkOrder(l, { collection: a.collection, cocoon: a.cocoon, floorWei: s.feed.floorWei, fresh: s.feed.fresh, toleranceBps: tolerance, heldIds, now: s.block.timestamp + 12n }),
    skip: null,
  }));
  const good = scan.checked.filter((x) => x.c.ok).sort(byPrice);
  if (good.length === 0) {
    const reasons = {};
    for (const x of scan.checked) reasons[x.c.reason] = (reasons[x.c.reason] || 0) + 1;
    const summary = Object.entries(reasons)
      .map(([r, n]) => `${n}x ${r}`)
      .join(', ');
    return { ...scan, why: `buy: ${listings.length} listing(s), none valid under ${fmtEth(ceiling)} (${summary})` };
  }
  const candidates = good.filter((x) => x.c.price + (x.c.price * reward) / BPS <= s.pots.seat);
  if (candidates.length === 0) {
    const g = good[0];
    return { ...scan, best: g.c.price, why: `buy: cheapest valid listing #${g.c.tokenId} at ${fmtEth(g.c.price)}, seat pot ${fmtEth(s.pots.seat)} covers up to ${fmtEth(affordable)} (PotTooSmall)` };
  }

  // Seaport's view of the candidates: the offerer's counter, the order hash, then its status.
  const tryList = candidates.slice(0, 5);
  const offerers = [...new Set(tryList.map((x) => x.l.parameters.offerer))];
  const counters = await pub.multicall({
    contracts: offerers.map((o) => ({ address: a.seaport, abi: seaportAbi, functionName: 'getCounter', args: [o] })),
    allowFailure: false,
    multicallAddress: MULTICALL3,
  });
  const counterOf = Object.fromEntries(offerers.map((o, i) => [o, counters[i]]));
  const hashes = await pub.multicall({
    contracts: tryList.map((x) => ({ address: a.seaport, abi: seaportAbi, functionName: 'getOrderHash', args: [toComponents(x.l.parameters, counterOf[x.l.parameters.offerer])] })),
    allowFailure: false,
    multicallAddress: MULTICALL3,
  });
  const statuses = await pub.multicall({
    contracts: hashes.map((h) => ({ address: a.seaport, abi: seaportAbi, functionName: 'getOrderStatus', args: [h] })),
    allowFailure: false,
    multicallAddress: MULTICALL3,
  });
  tryList.forEach((x, i) => {
    const [isValidated, isCancelled, totalFilled, totalSize] = statuses[i];
    if (isCancelled) x.skip = 'order cancelled on Seaport';
    else if (totalSize !== 0n && totalFilled >= totalSize) x.skip = 'order already filled';
    else if ((!x.l.signature || x.l.signature === '0x') && !isValidated) x.skip = 'no signature and not validated on-chain';
  });
  scan.tryList = tryList;
  const first = tryList.find((x) => !x.skip);
  if (!first) {
    return { ...scan, why: `buy: ${tryList.length} candidate(s), none open on Seaport (${tryList.map((x) => `#${x.c.tokenId} ${x.skip}`).join('; ')})` };
  }
  scan.ready = true;
  scan.best = first.c.price;
  scan.why = `cheapest valid listing #${first.c.tokenId} at ${fmtEth(first.c.price)} (${first.l.source}) under ${fmtEth(ceiling)}, seat pot ${fmtEth(s.pots.seat)}`;
  return scan;
}

export async function buy(ctx, s) {
  const { a, tx, cache } = ctx;
  const scan = await scanListings(ctx, s);
  ctx.listingScan = { ...scan, stateVersion: ctx.stateVersion };
  if (scan.error) {
    log(`skip buy: listings unavailable: ${scan.error}`);
    return idle('');
  }
  if (scan.tryList.length === 0) return idle(scan.why);

  for (const { l, c, skip } of scan.tryList) {
    const tag = `#${c.tokenId} at ${fmtEth(c.price)} (${l.source})`;
    if (skip) {
      log(`skip buySeat ${tag}: ${skip}`);
      continue;
    }
    const res = await tx.run(`buySeat ${tag}`, { address: a.cocoon, abi: cocoonAbi, functionName: 'buySeat', args: [toAdvancedOrder(l), []] });
    if (res.status === 'sent') {
      cache.seats[c.tokenId.toString()] = { held: true, cost: c.price.toString(), block: Number(res.receipt.blockNumber), event: 'SeatBought' };
      ctx.persist();
      return { acted: true, res, note: '' };
    }
    if (res.status === 'dry' || res.status === 'waiting' || res.status === 'nokey') return { acted: res.status === 'dry', res, note: '' };
    // reverted or failed: the next cheapest
  }
  return idle(`buy: ${scan.tryList.length} candidate(s) tried, none went through`);
}

// ------------------------------------------------------------------ e. burn

/** burn runs when wired, the pot is at least MIN_BURN_WEI and burnSpacing blocks have passed. */
export function burnDecision(cfg, s) {
  if (!s.wired) return { ready: false, why: 'burn: not wired' };
  if (s.pots.burn === 0n) return { ready: false, why: 'burn: pot empty' };
  if (s.pots.burn < cfg.minBurnWei) return { ready: false, why: `burn: pot ${fmtEth(s.pots.burn)} < MIN_BURN_WEI ${fmtEth(cfg.minBurnWei)}` };
  const next = s.lastBurnBlock + BigInt(s.params.burnSpacing);
  const landing = s.block.number + 1n; // the block the transaction would land in
  if (landing < next) return { ready: false, tooSoon: true, why: `TooSoon (${next - landing} block${next - landing === 1n ? '' : 's'})` };
  return {
    ready: true,
    why: `burn pot ${fmtEth(s.pots.burn)}, ${s.params.burnSpacing} blocks passed since the burn at block ${s.lastBurnBlock}`,
    label: `burn (pot ${fmtEth(s.pots.burn)})`,
  };
}

export async function burn(ctx, s) {
  const { cfg, a, tx } = ctx;
  const d = burnDecision(cfg, s);
  if (!d.ready) {
    if (!d.tooSoon) return idle(d.why);
    log(`skip burn: ${d.why}`);
    return idle('');
  }
  return acted(await tx.run(d.label, { address: a.cocoon, abi: cocoonAbi, functionName: 'burn' }));
}

// ------------------------------------------------------------------ f. auctions

/** startAuction, per HARVEST_TOKENS entry: a balance, no running auction, not PUPATE or the seats. */
export function harvestDecisions(cfg, s) {
  if (!s.wired) return { ready: false, why: 'auctions: not wired', tokens: [] };
  const a = cfg.addresses;
  const tokens = s.harvest.map((h) => {
    const t = { token: h.token, ready: false, why: '', label: '' };
    if (isAddressEqual(h.token, a.token) || isAddressEqual(h.token, a.collection)) t.why = `${short(h.token)} NotForAuction`;
    else if (h.auction.lot !== 0n) t.why = `${short(h.token)} auction running (lot ${h.auction.lot})`;
    else if (h.balance === 0n) t.why = `${short(h.token)} balance 0`;
    else {
      t.ready = true;
      t.why = `${short(h.token)} balance ${h.balance} with no auction running`;
      t.label = `startAuction ${short(h.token)} (lot ${h.balance})`;
    }
    return t;
  });
  return {
    ready: tokens.some((t) => t.ready),
    why: tokens.length ? tokens.map((t) => t.why).join(', ') : 'no HARVEST_TOKENS configured',
    tokens,
  };
}

/** startImdAuction: wired, no IMD auction running, an IMD-burn balance of at least MIN_IMD_AUCTION_WEI. */
export function imdAuctionDecision(cfg, s) {
  if (!s.wired) return { ready: false, why: 'auctions: not wired' };
  if (s.imdAuction.lot !== 0n) {
    return { ready: false, why: `imd auction running (lot ${fmtEth(s.imdAuction.lot)}, started ${fmtDuration(s.block.timestamp - BigInt(s.imdAuction.startedAt))} ago)` };
  }
  if (s.pots.imd === 0n) return { ready: false, why: 'imd burn balance 0' };
  if (s.pots.imd < cfg.minImdAuctionWei) return { ready: false, why: `imd burn balance ${fmtEth(s.pots.imd)} < MIN_IMD_AUCTION_WEI ${fmtEth(cfg.minImdAuctionWei)}` };
  return { ready: true, why: `imd burn balance ${fmtEth(s.pots.imd)} with no auction running`, label: `startImdAuction (lot ${fmtEth(s.pots.imd)})` };
}

export async function auctions(ctx, s) {
  const { cfg, a, tx } = ctx;
  if (!s.wired) return idle('auctions: not wired');
  const notes = [];
  let did = false;
  for (const t of harvestDecisions(cfg, s).tokens) {
    if (!t.ready) {
      notes.push(t.why);
      continue;
    }
    const res = await tx.run(t.label, { address: a.cocoon, abi: cocoonAbi, functionName: 'startAuction', args: [t.token] });
    did = did || res.status === 'sent' || res.status === 'dry';
  }
  const d = imdAuctionDecision(cfg, s);
  if (!d.ready) notes.push(d.why);
  else {
    const res = await tx.run(d.label, { address: a.cocoon, abi: cocoonAbi, functionName: 'startImdAuction' });
    did = did || res.status === 'sent' || res.status === 'dry';
  }
  return did ? { acted: true, note: '' } : idle(notes.length ? notes.join(', ') : 'auctions: nothing');
}

/** Balance of an ERC-20 held by Cocoon, for ad-hoc checks. */
export async function cocoonBalanceOf(ctx, token) {
  return ctx.pub.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [ctx.a.cocoon] });
}
