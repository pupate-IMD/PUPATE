// The live counterpart of the simulation: reads the deployed contracts and their events and shapes
// them into the same state the components already render. Pure async; the context decides when to
// call it. Figures are converted to numbers for display, as the simulation's are.

import { formatEther, isAddressEqual, type Address, type Hex, type PublicClient } from "viem";
import type { Addresses } from "./addresses";
import { cocoonAbi, erc20Abi, erc721Abi, feedAbi, hookAbi, poolManagerAbi } from "./abi";
import { SUPPLY, type Auction, type Caller, type HistoryPoint, type LiveMeta, type Run, type Sale, type Seat, type SimState } from "./sim";

const MULTICALL3: Address = "0xcA11bde05977b3631167028862bE2a173976CA11";
const SECONDS_PER_BLOCK = 12;
const LOG_CHUNK = 50_000n;
const f = (wei: bigint) => Number(formatEther(wei));
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export type LiveSnapshot = Pick<
  SimState,
  | "preset"
  | "launchMinute"
  | "day"
  | "floor"
  | "taxCollected"
  | "hookWaiting"
  | "seatPot"
  | "burnPot"
  | "dev"
  | "imdBurn"
  | "burned"
  | "imdBurned"
  | "harvested"
  | "seats"
  | "sold"
  | "auction"
  | "burnCooldown"
  | "history"
  | "callers"
  | "runs"
> & { live: LiveMeta };

interface RawLog {
  eventName: string;
  args: Record<string, unknown>;
  blockNumber: bigint;
  transactionHash: Hex;
  logIndex: number;
}

const cocoonEvents = cocoonAbi.filter((x) => x.type === "event");
const hookEvents = hookAbi.filter((x) => x.type === "event");

/// True when an endpoint refused a log query for its block range (Alchemy's free tier allows 10 blocks, others 2,000 or 10,000).
function isRangeRefusal(e: unknown): boolean {
  const x = e as { code?: number; details?: string; shortMessage?: string; message?: string; cause?: { code?: number } };
  const code = x?.code ?? x?.cause?.code;
  const text = `${x?.details ?? ""} ${x?.shortMessage ?? ""} ${x?.message ?? ""}`;
  return code === -32600 || code === -32005 || code === -32602 || /block range|too many|exceed|more than|limit/i.test(text);
}

/// The chunk size the endpoint accepted last, so later reads start from it.
let learnedChunk = LOG_CHUNK;

/// Logs over a range, in chunks the endpoint accepts: when it refuses a range, the chunk is halved and retried.
async function logsOf(client: PublicClient, address: Address, events: typeof cocoonEvents | typeof hookEvents, from: bigint, to: bigint): Promise<RawLog[]> {
  const out: RawLog[] = [];
  let chunk = learnedChunk;
  for (let start = from; start <= to; ) {
    const end = start + chunk - 1n < to ? start + chunk - 1n : to;
    // A refused range comes back as null and the chunk shrinks; anything else is a real failure.
    const logs = await client.getLogs({ address, events, fromBlock: start, toBlock: end }).catch((e: unknown) => {
      if (!isRangeRefusal(e) || chunk <= 1n) throw e;
      return null;
    });
    if (logs === null) {
      chunk = chunk / 2n < 1n ? 1n : chunk / 2n;
      learnedChunk = chunk;
      continue;
    }
    start = end + 1n;
    for (const l of logs) {
      out.push({
        eventName: String(l.eventName),
        args: (l.args ?? {}) as Record<string, unknown>,
        blockNumber: l.blockNumber,
        transactionHash: l.transactionHash,
        logIndex: l.logIndex,
      });
    }
  }
  return out.sort((x, y) => (x.blockNumber === y.blockNumber ? x.logIndex - y.logIndex : Number(x.blockNumber - y.blockNumber)));
}

const only = (logs: RawLog[], name: string) => logs.filter((l) => l.eventName === name);
const big = (v: unknown) => (typeof v === "bigint" ? v : 0n);
const addr = (v: unknown) => String(v) as Address;

export async function loadLive(client: PublicClient, a: Addresses): Promise<LiveSnapshot> {
  const block = await client.getBlock();
  const now = Number(block.timestamp);
  const blockNumber = Number(block.number);
  const tsAt = (n: bigint) => now - (blockNumber - Number(n)) * SECONDS_PER_BLOCK;

  const r = await client.multicall({
    allowFailure: false,
    multicallAddress: MULTICALL3,
    contracts: [
      { address: a.hook, abi: hookAbi, functionName: "buyTaxBps" },
      { address: a.hook, abi: hookAbi, functionName: "taxBps" },
      { address: a.hook, abi: hookAbi, functionName: "openedAt" },
      { address: a.hook, abi: hookAbi, functionName: "totalTax" },
      { address: a.feed, abi: feedAbi, functionName: "latest" },
      { address: a.feed, abi: feedAbi, functionName: "issuedAt" },
      { address: a.feed, abi: feedAbi, functionName: "expiresAt" },
      { address: a.feed, abi: feedAbi, functionName: "maxAge" },
      { address: a.cocoon, abi: cocoonAbi, functionName: "seatPot" },
      { address: a.cocoon, abi: cocoonAbi, functionName: "burnPot" },
      { address: a.cocoon, abi: cocoonAbi, functionName: "developerBalance" },
      { address: a.cocoon, abi: cocoonAbi, functionName: "imdBurnBalance" },
      { address: a.cocoon, abi: cocoonAbi, functionName: "lastBurnBlock" },
      { address: a.cocoon, abi: cocoonAbi, functionName: "wired" },
      { address: a.cocoon, abi: cocoonAbi, functionName: "getParams" },
      { address: a.cocoon, abi: cocoonAbi, functionName: "imdAuction" },
      { address: a.token, abi: erc20Abi, functionName: "totalSupply" },
      { address: a.poolManager, abi: poolManagerAbi, functionName: "balanceOf", args: [a.hook, 0n] },
    ],
  });
  const [buyTaxBps, taxBps, openedAtRaw, totalTax, latest, issuedAt, expiresAt, maxAge, seatPot, burnPot, developerBalance, imdBurnBalance, lastBurnBlock, wired, params, imdAuctionRaw, totalSupply, claims] = r;
  const [floorWei, fresh] = latest;
  const openedAt = Number(openedAtRaw);
  const [imdLot, , imdStartedAt] = imdAuctionRaw;

  const fromBlock = BigInt(a.fromBlock);
  const [cocoonLogs, hookLogs] = await Promise.all([
    logsOf(client, a.cocoon, cocoonEvents, fromBlock, block.number),
    logsOf(client, a.hook, hookEvents, fromBlock, block.number),
  ]);

  // Seats on the books: every id ever bought or adopted, kept if the vault still holds it.
  const ids = [...new Set([...only(cocoonLogs, "SeatBought"), ...only(cocoonLogs, "SeatAdopted")].map((l) => big(l.args.tokenId)))];
  const seatRows = ids.length
    ? await client.multicall({
        allowFailure: false,
        multicallAddress: MULTICALL3,
        contracts: ids.map((id) => ({ address: a.cocoon, abi: cocoonAbi, functionName: "seats" as const, args: [id] as const })),
      })
    : [];
  const seats: Seat[] = [];
  ids.forEach((id, i) => {
    const [cost, boughtAt, , , , held] = seatRows[i];
    if (!held) return;
    seats.push({ id: Number(id), cost: f(cost), day: Math.max(0, Math.floor((now - Number(boughtAt)) / 86400)), jobs: 0, status: "held", boughtAt: Number(boughtAt) });
  });

  // Seats on the books that the vault no longer holds: a buyer took the listing and settleSeat is
  // due. The keeper also reads Seaport's fill status, which covers a seat sent straight back; the
  // owner alone covers the common case. A failed ownerOf (a burned token) counts as gone, as it does there.
  const owners = seats.length
    ? await client.multicall({
        allowFailure: true,
        multicallAddress: MULTICALL3,
        contracts: seats.map((x) => ({ address: a.collection, abi: erc721Abi, functionName: "ownerOf" as const, args: [BigInt(x.id)] as const })),
      })
    : [];
  const settleDue = seats.filter((_, i) => owners[i].status !== "success" || !isAddressEqual(owners[i].result as Address, a.cocoon)).map((x) => x.id);

  // Sales: a settled seat, priced by the ETH Seaport sent in before it was settled (first unmatched).
  const boughtAtOf = new Map<bigint, { cost: bigint; block: bigint }>();
  for (const l of [...only(cocoonLogs, "SeatBought"), ...only(cocoonLogs, "SeatAdopted")]) boughtAtOf.set(big(l.args.tokenId), { cost: big(l.args.cost), block: l.blockNumber });
  const proceeds = only(cocoonLogs, "ProceedsReceived")
    .filter((l) => isAddressEqual(addr(l.args.from), a.seaport))
    .map((l) => ({ block: l.blockNumber, amount: big(l.args.amount), used: false }));
  const sold: (Sale & { block: bigint })[] = [];
  for (const l of only(cocoonLogs, "SeatSold")) {
    const id = big(l.args.tokenId);
    const bought = boughtAtOf.get(id);
    const p = proceeds.find((x) => !x.used && x.block <= l.blockNumber);
    if (p) p.used = true;
    sold.push({
      id: Number(id),
      bought: f(big(l.args.cost)),
      sold: p ? f(p.amount) : 0,
      held: bought ? Math.max(0, Math.round((Number(l.blockNumber - bought.block) * SECONDS_PER_BLOCK) / 86400)) : 0,
      burned: 0,
      block: l.blockNumber,
    });
  }
  // Burns are credited to the oldest sale still waiting, as the preview does.
  const burns = only(cocoonLogs, "Burned");
  for (const b of burns) {
    const waiting = sold.find((s) => s.burned === 0 && s.block <= b.blockNumber);
    if (waiting) waiting.burned = f(big(b.args.pupateBurned));
  }

  // The open harvest auction, if any: the last token started with no take after it.
  let auction: Auction | null = null;
  let harvestToken: Address | null = null;
  const started = only(cocoonLogs, "AuctionStarted");
  if (started.length) {
    const last = started[started.length - 1];
    const token = addr(last.args.token);
    const takenAfter = only(cocoonLogs, "AuctionTaken").some((t) => isAddressEqual(addr(t.args.token), token) && t.blockNumber >= last.blockNumber);
    if (!takenAfter) {
      const [lot, start, startedAt] = await client.readContract({ address: a.cocoon, abi: cocoonAbi, functionName: "auctions", args: [token] });
      if (lot > 0n) {
        auction = { token: short(token), lot: f(lot), start: f(start), ageH: Math.max(0, now - Number(startedAt)) / 3600 };
        harvestToken = token;
      }
    }
  }

  // Who has been running the steps. Flushes name no caller, so their senders are looked up (capped).
  const byCaller = new Map<string, Caller>();
  const credit = (who: string, kind: "flush" | "buy" | "burn", reward: bigint) => {
    const row = byCaller.get(who) ?? { who, flush: 0, buy: 0, burn: 0, reward: 0 };
    row[kind] += 1;
    row.reward += f(reward);
    byCaller.set(who, row);
  };
  for (const l of only(cocoonLogs, "SeatBought")) credit(short(addr(l.args.caller)), "buy", big(l.args.reward));
  for (const l of burns) credit(short(addr(l.args.caller)), "burn", big(l.args.reward));
  const flushes = only(hookLogs, "Flushed").slice(-60);
  const senders = await Promise.all(flushes.map((l) => client.getTransaction({ hash: l.transactionHash }).then((t) => t.from).catch(() => null)));
  for (const from of senders) if (from) credit(short(from), "flush", 0n);

  // The last runs of the steps, newest first, for the Run page's "Who ran it". A flush names no
  // caller in its event, so the transaction's sender stands for it.
  const whenOf = (n: bigint) => `block ${Number(n).toLocaleString("en-US")}`;
  const runRows: (Run & { block: bigint; index: number })[] = [];
  for (const l of only(cocoonLogs, "SeatBought")) {
    const who = addr(l.args.caller);
    runRows.push({ kind: "buy", when: whenOf(l.blockNumber), who: short(who), address: who, eth: f(big(l.args.cost)), pupate: 0, reward: f(big(l.args.reward)), tx: l.transactionHash, block: l.blockNumber, index: l.logIndex });
  }
  for (const l of burns) {
    const who = addr(l.args.caller);
    runRows.push({ kind: "burn", when: whenOf(l.blockNumber), who: short(who), address: who, eth: f(big(l.args.ethSpent)), pupate: f(big(l.args.pupateBurned)), reward: f(big(l.args.reward)), tx: l.transactionHash, block: l.blockNumber, index: l.logIndex });
  }
  flushes.forEach((l, i) => {
    const from = senders[i];
    runRows.push({ kind: "flush", when: whenOf(l.blockNumber), who: from ? short(from) : "unknown", address: from ?? undefined, eth: f(big(l.args.amount)), pupate: 0, reward: 0, tx: l.transactionHash, block: l.blockNumber, index: l.logIndex });
  });
  runRows.sort((x, y) => (x.block === y.block ? y.index - x.index : Number(y.block - x.block)));
  const runs: Run[] = runRows.slice(0, 40).map(({ block: _b, index: _i, ...r }) => r);

  // History by day since the open: supply burned and seats held.
  const history: HistoryPoint[] = [];
  const day = openedAt ? Math.max(0, Math.floor((now - openedAt) / 86400)) : 0;
  if (openedAt && day > 0) {
    const burnedByDay = new Map<number, number>();
    for (const b of burns) {
      const d = Math.max(0, Math.floor((tsAt(b.blockNumber) - openedAt) / 86400));
      burnedByDay.set(d, (burnedByDay.get(d) ?? 0) + f(big(b.args.pupateBurned)));
    }
    const delta = new Map<number, number>();
    for (const l of [...only(cocoonLogs, "SeatBought"), ...only(cocoonLogs, "SeatAdopted")]) {
      const d = Math.max(0, Math.floor((tsAt(l.blockNumber) - openedAt) / 86400));
      delta.set(d, (delta.get(d) ?? 0) + 1);
    }
    for (const l of only(cocoonLogs, "SeatSold")) {
      const d = Math.max(0, Math.floor((tsAt(l.blockNumber) - openedAt) / 86400));
      delta.set(d, (delta.get(d) ?? 0) - 1);
    }
    let cumBurned = 0;
    let held = 0;
    for (let d = 0; d < day; d++) {
      cumBurned += burnedByDay.get(d) ?? 0;
      held += delta.get(d) ?? 0;
      history.push({ day: d, burned: Math.round(cumBurned), seats: Math.max(0, held) });
    }
  }

  const burnSpacing = Number(params.burnSpacing);
  const lastBurn = Number(lastBurnBlock);
  const freshUntil = Math.min(Number(issuedAt) + Number(maxAge), Number(expiresAt));
  const minutesOpen = openedAt ? Math.floor((now - openedAt) / 60) : 0;

  return {
    preset: Number(buyTaxBps) > Number(taxBps) ? "launch" : "steady",
    launchMinute: Math.min(minutesOpen, 93),
    day,
    floor: f(floorWei),
    taxCollected: f(totalTax),
    hookWaiting: f(claims),
    seatPot: f(seatPot),
    burnPot: f(burnPot),
    dev: f(developerBalance),
    imdBurn: f(imdBurnBalance),
    burned: Math.max(0, SUPPLY - f(totalSupply)),
    imdBurned: only(cocoonLogs, "ImdBurned").reduce((acc, l) => acc + f(big(l.args.imdBurned)), 0),
    harvested: only(cocoonLogs, "AuctionTaken").reduce((acc, l) => acc + f(big(l.args.price)), 0),
    seats,
    sold: sold.map(({ block: _b, ...s }) => s).reverse(),
    auction,
    burnCooldown: lastBurn ? Math.max(0, lastBurn + burnSpacing - blockNumber) : 0,
    history,
    callers: [...byCaller.values()],
    runs,
    live: {
      chainId: a.chainId,
      block: blockNumber,
      openedAt,
      buyTaxBps: Number(buyTaxBps),
      taxBps: Number(taxBps),
      floorIssuedAt: Number(issuedAt),
      freshUntil,
      fresh,
      burnSpacing,
      lastBurnBlock: lastBurn,
      callerRewardBps: Number(params.callerRewardBps),
      toleranceBps: Number(params.toleranceBps),
      wired,
      imdAuction:
        imdLot > 0n
          ? {
              lotEth: f(imdLot),
              demandImd: f(await client.readContract({ address: a.cocoon, abi: cocoonAbi, functionName: "imdDemand" })),
              startedAt: Number(imdStartedAt),
            }
          : null,
      harvestToken,
      settleDue,
      burnImpactBps: Number(params.burnImpactBps),
      pending: null,
    },
  };
}
