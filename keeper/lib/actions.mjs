// The six decisions of a tick, in the order the loop runs them: report, flush, settle, buy, burn,
// auctions. Each one pre-checks what it can from the state, simulates with eth_call through
// tx.run (which logs a decoded custom error and skips on revert), and returns { acted, note } so
// the loop can print one "idle:" line for everything that had nothing to do.
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

export async function report(ctx, s) {
  const { cfg, a, tx, cache, pub, account } = ctx;
  const due = reportDue({ ...s.feed, now: s.block.timestamp, everySec: cfg.reportEverySec, leadSec: cfg.reportLeadSec, force: ctx.forceReport });
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

export async function flush(ctx, s) {
  const { cfg, a, tx } = ctx;
  if (s.claims === 0n) return idle('nothing to flush');
  if (s.claims < cfg.minFlushWei) return idle(`flush ${fmtEth(s.claims)} < MIN_FLUSH_WEI ${fmtEth(cfg.minFlushWei)}`);
  return acted(await tx.run(`flush ${fmtEth(s.claims)}`, { address: a.hook, abi: hookAbi, functionName: 'flush' }));
}

// ------------------------------------------------------------------ c. settle

export async function settle(ctx, s) {
  const { a, tx, cache } = ctx;
  if (s.seats.length === 0) return idle('no seats held');
  let did = false;
  const open = [];
  for (const seat of s.seats) {
    if (!seat.gone && !seat.filled) {
      open.push(`#${seat.tokenId}`);
      continue;
    }
    const why = seat.gone ? `owner is ${seat.owner ? short(seat.owner) : 'nobody'}` : 'listing filled';
    const res = await tx.run(`settleSeat #${seat.tokenId} (${why})`, { address: a.cocoon, abi: cocoonAbi, functionName: 'settleSeat', args: [seat.tokenId] });
    if (res.status === 'sent') {
      cache.seats[seat.tokenId.toString()] = { ...(cache.seats[seat.tokenId.toString()] || {}), held: false, event: 'settled' };
      ctx.persist();
      did = true;
    } else if (res.status === 'dry') did = true;
  }
  return did ? { acted: true, note: '' } : idle(`${open.length} seat(s) still listed: ${open.join(' ')}`);
}

// ------------------------------------------------------------------ d. buy

export async function buy(ctx, s) {
  const { cfg, a, tx, pub, cache } = ctx;
  if (cfg.listingSource === 'none') return idle('buy: no LISTING_SOURCE');
  if (!s.feed.fresh) return idle('buy: floor not fresh');
  const p = s.params;
  const tolerance = BigInt(p.toleranceBps);
  const reward = BigInt(p.callerRewardBps);
  const ceiling = (s.feed.floorWei * (BPS + tolerance)) / BPS;
  const affordable = (s.pots.seat * BPS) / (BPS + reward);
  if (affordable === 0n) return idle('buy: seat pot empty');

  let listings;
  try {
    listings =
      cfg.listingSource === 'file'
        ? listingsFromFile(cfg.listingsFile)
        : await listingsFromOpenSea({ apiKey: cfg.openseaApiKey, api: cfg.openseaApi, chain: cfg.openseaChain, collection: a.collection, seaport: a.seaport });
  } catch (e) {
    log(`skip buy: listings unavailable: ${e.message}`);
    return idle('');
  }
  if (listings.length === 0) return idle(`buy: no listings (${cfg.listingSource})`);

  const heldIds = new Set(s.seats.map((x) => x.tokenId.toString()));
  const checked = listings.map((l) => ({
    l,
    c: checkOrder(l, { collection: a.collection, cocoon: a.cocoon, floorWei: s.feed.floorWei, fresh: s.feed.fresh, toleranceBps: tolerance, heldIds, now: s.block.timestamp + 12n }),
  }));
  const good = checked.filter((x) => x.c.ok).sort((x, y) => (x.c.price < y.c.price ? -1 : x.c.price > y.c.price ? 1 : 0));
  if (good.length === 0) {
    const reasons = {};
    for (const x of checked) reasons[x.c.reason] = (reasons[x.c.reason] || 0) + 1;
    const summary = Object.entries(reasons)
      .map(([r, n]) => `${n}x ${r}`)
      .join(', ');
    return idle(`buy: ${listings.length} listing(s), none valid under ${fmtEth(ceiling)} (${summary})`);
  }
  const candidates = good.filter((x) => x.c.price + (x.c.price * reward) / BPS <= s.pots.seat);
  if (candidates.length === 0) {
    const g = good[0];
    return idle(`buy: cheapest valid listing #${g.c.tokenId} at ${fmtEth(g.c.price)}, seat pot ${fmtEth(s.pots.seat)} covers up to ${fmtEth(affordable)} (PotTooSmall)`);
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

  for (let i = 0; i < tryList.length; i++) {
    const { l, c } = tryList[i];
    const [isValidated, isCancelled, totalFilled, totalSize] = statuses[i];
    const tag = `#${c.tokenId} at ${fmtEth(c.price)} (${l.source})`;
    if (isCancelled) {
      log(`skip buySeat ${tag}: order cancelled on Seaport`);
      continue;
    }
    if (totalSize !== 0n && totalFilled >= totalSize) {
      log(`skip buySeat ${tag}: order already filled`);
      continue;
    }
    if ((!l.signature || l.signature === '0x') && !isValidated) {
      log(`skip buySeat ${tag}: no signature and not validated on-chain`);
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
  return idle(`buy: ${tryList.length} candidate(s) tried, none went through`);
}

// ------------------------------------------------------------------ e. burn

export async function burn(ctx, s) {
  const { cfg, a, tx } = ctx;
  if (!s.wired) return idle('burn: not wired');
  if (s.pots.burn === 0n) return idle('burn: pot empty');
  if (s.pots.burn < cfg.minBurnWei) return idle(`burn: pot ${fmtEth(s.pots.burn)} < MIN_BURN_WEI ${fmtEth(cfg.minBurnWei)}`);
  const next = s.lastBurnBlock + BigInt(s.params.burnSpacing);
  const landing = s.block.number + 1n; // the block the transaction would land in
  if (landing < next) {
    log(`skip burn: TooSoon (${next - landing} block${next - landing === 1n ? '' : 's'})`);
    return idle('');
  }
  return acted(await tx.run(`burn (pot ${fmtEth(s.pots.burn)})`, { address: a.cocoon, abi: cocoonAbi, functionName: 'burn' }));
}

// ------------------------------------------------------------------ f. auctions

export async function auctions(ctx, s) {
  const { cfg, a, tx } = ctx;
  if (!s.wired) return idle('auctions: not wired');
  const notes = [];
  let did = false;
  for (const h of s.harvest) {
    if (isAddressEqual(h.token, a.token) || isAddressEqual(h.token, a.collection)) {
      notes.push(`${short(h.token)} NotForAuction`);
      continue;
    }
    if (h.auction.lot !== 0n) {
      notes.push(`${short(h.token)} auction running (lot ${h.auction.lot})`);
      continue;
    }
    if (h.balance === 0n) {
      notes.push(`${short(h.token)} balance 0`);
      continue;
    }
    const res = await tx.run(`startAuction ${short(h.token)} (lot ${h.balance})`, { address: a.cocoon, abi: cocoonAbi, functionName: 'startAuction', args: [h.token] });
    did = did || res.status === 'sent' || res.status === 'dry';
  }
  if (s.imdAuction.lot !== 0n) {
    notes.push(`imd auction running (lot ${fmtEth(s.imdAuction.lot)}, started ${fmtDuration(s.block.timestamp - BigInt(s.imdAuction.startedAt))} ago)`);
  } else if (s.pots.imd === 0n) {
    notes.push('imd burn balance 0');
  } else if (s.pots.imd < cfg.minImdAuctionWei) {
    notes.push(`imd burn balance ${fmtEth(s.pots.imd)} < MIN_IMD_AUCTION_WEI ${fmtEth(cfg.minImdAuctionWei)}`);
  } else {
    const res = await tx.run(`startImdAuction (lot ${fmtEth(s.pots.imd)})`, { address: a.cocoon, abi: cocoonAbi, functionName: 'startImdAuction' });
    did = did || res.status === 'sent' || res.status === 'dry';
  }
  return did ? { acted: true, note: '' } : idle(notes.length ? notes.join(', ') : 'auctions: nothing');
}

/** Balance of an ERC-20 held by Cocoon, for ad-hoc checks. */
export async function cocoonBalanceOf(ctx, token) {
  return ctx.pub.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [ctx.a.cocoon] });
}
