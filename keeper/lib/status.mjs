// The status feed. After every tick (and on --status) the keeper writes two JSON files for anyone
// who wants the vault's state without an RPC: IMD agents deciding whether a step is worth a call,
// judges, third-party keepers, and the site's "keeper alive" panel.
//
//   status.json    schema pupate-status/1: the chain, the hook, the feed, the vault, the held seats
//                  with their listings, the auctions, the supply, what each step would do right now
//                  (the keeper's own decision functions on the same state) and the keeper's last
//                  tick and last transactions.
//   listings.json  schema pupate-listings/1: the market the buy step last looked at (OpenSea only;
//                  the file source and none give an empty array), each listing with its check
//                  result and no signature.
//
// Every integer is a decimal string (wei, seconds, bps, block numbers); chainId and block are plain
// JSON numbers, the few *Eth fields are floats for humans. Each file is written to a temp file and
// renamed into place, so a reader never sees a partial one.
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { formatEther } from 'viem';
import { burnDecision, flushDecision, harvestDecisions, imdAuctionDecision, reportDecision, scanListings, settleDecision } from './actions.mjs';
import { currentPrice, endPrice, seatParameters, startPrice } from './listings.mjs';
import { jsonSafe, warn } from './log.mjs';

export const STATUS_SCHEMA = 'pupate-status/1';
export const LISTINGS_SCHEMA = 'pupate-listings/1';
/// 1,000,000,000 PUPATE, minted once; burns only ever lower totalSupply.
export const INITIAL_SUPPLY_WEI = 10n ** 27n;
/// Transactions kept in the keeper's state file and published under keeper.lastActions.
export const MAX_ACTIONS = 20;

const str = (v) => (v === null || v === undefined ? null : typeof v === 'bigint' ? v.toString() : String(v));
const eth = (wei) => Number(formatEther(BigInt(wei)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Remember a transaction that got a receipt (chain.mjs calls this through createTx's onResult). */
export function rememberAction(cache, entry) {
  cache.lastActions = [...(cache.lastActions || []), entry].slice(-MAX_ACTIONS);
}

/** A scan that never happened, so the files can still be written when scanListings itself failed. */
export function emptyScan(cfg, why) {
  return { source: cfg.listingSource, fetchedAt: null, ceiling: 0n, affordable: 0n, checked: [], tryList: [], ready: false, why, best: null, error: why };
}

/** status.json. `scan` is scanListings' result on the same state `s`. */
export function buildStatus({ cfg, s, cache, scan, keeperAddress, dryRun }) {
  const a = cfg.addresses;
  const now = s.block.timestamp;
  const seats = s.seats.map((x) => {
    // The falling order (index 0) of Cocoon's two Seaport listings; after decayEnd the flat tail asks endWei.
    const falling = seatParameters(a.cocoon, a.collection, x.tokenId, x.terms, 0);
    const priceNow = currentPrice(falling, now);
    return {
      tokenId: str(x.tokenId),
      costWei: str(x.terms.cost),
      boughtAt: str(x.terms.boughtAt),
      round: str(x.terms.round),
      filled: Boolean(x.gone || x.filled),
      listing: {
        startWei: str(startPrice(x.terms)),
        endWei: str(endPrice(x.terms)),
        startTime: str(falling.startTime),
        decayEnd: str(falling.endTime),
        priceNowWei: str(priceNow),
        priceNowEth: eth(priceNow),
      },
    };
  });
  const flush = flushDecision(cfg, s);
  const burn = burnDecision(cfg, s);
  const imd = imdAuctionDecision(cfg, s);
  const settle = settleDecision(s);
  const report = reportDecision(cfg, s);
  const harvest = harvestDecisions(cfg, s);
  const burned = INITIAL_SUPPLY_WEI > s.totalSupply ? INITIAL_SUPPLY_WEI - s.totalSupply : 0n;
  return {
    schema: STATUS_SCHEMA,
    generatedAt: new Date().toISOString(),
    chainId: cfg.chainId,
    block: Number(s.block.number),
    blockTimestamp: Number(now),
    addresses: {
      token: a.token,
      hook: a.hook,
      cocoon: a.cocoon,
      feed: a.feed,
      timelock: a.timelock ?? null,
      collection: a.collection,
      seaport: a.seaport,
      universalRouter: a.universalRouter ?? null,
      quoter: a.quoter ?? null,
    },
    hook: {
      buyTaxBps: str(s.buyTaxBps),
      taxBps: str(s.taxBps),
      openedAt: str(s.openedAt),
      totalTaxWei: str(s.totalTax),
      claimsWei: str(s.claims),
    },
    feed: {
      floorWei: str(s.feed.floorWei),
      floorEth: eth(s.feed.floorWei),
      issuedAt: str(s.feed.issuedAt),
      freshUntil: str(s.feed.freshUntil),
      fresh: Boolean(s.feed.fresh),
    },
    vault: {
      seatPotWei: str(s.pots.seat),
      seatPotEth: eth(s.pots.seat),
      burnPotWei: str(s.pots.burn),
      burnPotEth: eth(s.pots.burn),
      developerWei: str(s.pots.dev),
      imdBurnWei: str(s.pots.imd),
      heldCount: str(s.heldCount),
      heldCostWei: str(s.heldCost),
      mode: s.mode.name,
      seatShareBps: str(s.mode.seatBps),
      wired: Boolean(s.wired),
      lastBurnBlock: str(s.lastBurnBlock),
      burnSpacing: str(s.params.burnSpacing),
      params: Object.fromEntries(Object.entries(s.params).map(([k, v]) => [k, str(v)])),
    },
    seats,
    auctions: {
      imd:
        s.imdAuction.lot === 0n
          ? null
          : { lotWei: str(s.imdAuction.lot), lotEth: eth(s.imdAuction.lot), demandWei: str(s.imdAuction.demand), startedAt: str(s.imdAuction.startedAt) },
      harvest: s.harvest
        .filter((h) => h.auction.lot !== 0n)
        .map((h) => ({ token: h.token, lotWei: str(h.auction.lot), startWei: str(h.auction.start), startedAt: str(h.auction.startedAt), priceNowWei: str(h.auction.price) })),
    },
    supply: { totalWei: str(s.totalSupply), burnedWei: str(burned) },
    steps: {
      flush: { ready: flush.ready, why: flush.why },
      buySeat: {
        ready: scan.ready,
        why: scan.why,
        ...(scan.best !== null && scan.best !== undefined ? { bestListingWei: str(scan.best) } : {}),
        ceilingWei: str(scan.ceiling),
        affordableWei: str(scan.affordable),
        source: scan.source,
      },
      burn: { ready: burn.ready, why: burn.why },
      startImdAuction: { ready: imd.ready, why: imd.why },
      settle: { ready: settle.ready, why: settle.why, tokenIds: settle.due.map((x) => str(x.tokenId)) },
      startAuction: { ready: harvest.ready, why: harvest.why },
      report: { ready: report.ready, why: report.why },
    },
    keeper: {
      lastTickAt: cache.lastTickAt ?? null,
      lastActions: (cache.lastActions || []).slice(-MAX_ACTIONS),
      listingSource: cfg.listingSource,
      attestationSource: cfg.attestationSource,
      dryRun: Boolean(dryRun),
      address: keeperAddress ?? null,
    },
  };
}

/** listings.json. Only the OpenSea source is published; a file is the operator's own and `none` fetches nothing. */
export function buildListings({ cfg, s, scan }) {
  const published = scan.source === 'opensea';
  const rows = published
    ? scan.checked.map(({ l, c, skip }) => {
        const rules = c.ok || c.reason === 'PriceAboveFloor' || c.reason === 'FloorNotFresh';
        return {
          ref: l.source,
          tokenId: str(c.tokenId),
          priceWei: str(c.price),
          priceEth: eth(c.price),
          offerer: l.parameters.offerer,
          endTime: str(l.parameters.endTime),
          withinTolerance: c.tokenId !== null && c.price <= scan.ceiling,
          passesOrderRules: rules && !skip,
          ok: c.ok && !skip,
          reason: skip || c.reason || '',
        };
      })
    : [];
  return {
    schema: LISTINGS_SCHEMA,
    generatedAt: new Date().toISOString(),
    chainId: cfg.chainId,
    block: Number(s.block.number),
    source: scan.source,
    fetchedAt: scan.fetchedAt,
    floorWei: str(s.feed.floorWei),
    fresh: Boolean(s.feed.fresh),
    ceilingWei: str(scan.ceiling),
    affordableWei: str(scan.affordable),
    note: !published
      ? scan.source === 'file'
        ? 'LISTING_SOURCE=file: an operator file, not published'
        : scan.why
      : scan.error
        ? `fetch failed: ${scan.error}`
        : scan.fetchedAt
          ? ''
          : scan.why,
    listings: rows,
  };
}

/** Write JSON to `file` through a temp file and a rename, so no reader sees a partial file. */
export async function writeJsonAtomic(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, jsonSafe(value, 2) + '\n');
  // Windows refuses the rename while a reader holds the target open: a few short retries.
  for (let attempt = 1; ; attempt++) {
    try {
      renameSync(tmp, file);
      return;
    } catch (e) {
      if (attempt >= 4 || (e.code !== 'EPERM' && e.code !== 'EBUSY' && e.code !== 'EACCES')) {
        rmSync(tmp, { force: true });
        throw e;
      }
      await sleep(100 * attempt);
    }
  }
}

/**
 * Build and write both files for state `s`. Reuses the buy step's scan when it was made on this
 * very state, otherwise scans now (one listings fetch; the only cost of --status).
 * Returns the paths, or null when the feed is disabled or the write failed (which is warned, not thrown).
 */
export async function writeStatusFiles(ctx, s) {
  const { cfg, cache } = ctx;
  if (!cfg.statusDir) return null;
  let scan = ctx.listingScan && ctx.listingScan.stateVersion === ctx.stateVersion ? ctx.listingScan : null;
  if (!scan) {
    try {
      scan = await scanListings(ctx, s);
    } catch (e) {
      scan = emptyScan(cfg, `buy: listings scan failed: ${e.shortMessage || e.message}`);
    }
  }
  const files = { status: join(cfg.statusDir, 'status.json'), listings: join(cfg.statusDir, 'listings.json') };
  try {
    await writeJsonAtomic(files.status, buildStatus({ cfg, s, cache, scan, keeperAddress: ctx.account?.address ?? null, dryRun: ctx.dryRun }));
    await writeJsonAtomic(files.listings, buildListings({ cfg, s, scan }));
  } catch (e) {
    warn(`could not write the status feed in ${cfg.statusDir}: ${e.message}`);
    return null;
  }
  return files;
}
