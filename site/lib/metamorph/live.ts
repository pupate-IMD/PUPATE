// The mine, in numbers: the cards minted, the epoch and the mint price, the difficulty, the network's hash
// rate, the share of the 3,333 minted, the seconds since the last mint, and whether the vault holds a seat a
// mint can pick (none is the commons: cards draw from the whole identity.md collection, and the page's
// ready line says so). One eth_call reads the contract's views with Multicall3's block number and
// timestamp, at one block, every three seconds and at once after a mint (useMineNumbers).
//
// The network rate is the mints of the last hour, each worth the hashes a mint takes now (2^bits), over the
// hour's 3,600 seconds. The Minted log carries no time; a card's mintedAt is its block's timestamp, and the
// ids follow the order of the mints, so the hour's mints are the newest cards whose mintedAt falls within
// it. Each card's time is read once (a card keeps it) and the walk stops at the first card older than the
// hour. The seconds since the last mint come from lastMintAt(), which the contract starts at its deploy, so
// they show only once a card is minted.
//
// The clock is this machine's, or the chain's where the chain runs ahead of it (a local chain whose time
// was moved on, or a machine whose clock is slow); a block's timestamp lags the wall clock by up to a slot,
// so it is not taken when it is behind. The lead is measured when a block is first seen, newest then, and
// kept until the next one: a node answers a call with its latest block's time, which stands still between
// blocks, so measuring it again on every read would count the seconds back.
//
// Relative imports only, no "@/" alias: scripts/mine-logic.mjs runs this file in Node.
import { useCallback, useEffect, useRef, useState } from "react";
import { formatUnits, parseAbi, type PublicClient } from "viem";
import { fmtHashes, fmtRate } from "../miner/job";
import { metamorphAbi } from "./abi";
import { MULTICALL3, type LiveAddresses } from "./job";

/// The contract's MAX_SUPPLY, and its epochs: one per 303 mints, 11 in all.
export const SUPPLY = 3333;
export const EPOCHS = 11;
/// The network rate's window, in seconds.
export const HOUR = 3600;
/// How often the numbers are read.
export const NUMBERS_POLL_MS = 3000;
/// Card times read in one eth_call while walking the hour.
const TIME_BATCH = 64;
/// A reading whose clock skew moved less than this (seconds) counts as the same reading.
const SKEW_SLACK = 5;

/// Multicall3's own views, so the block and its timestamp come from the batch that reads the numbers.
const multicall3Views = parseAbi([
  "function getBlockNumber() view returns (uint256 blockNumber)",
  "function getCurrentBlockTimestamp() view returns (uint256 timestamp)",
]);

const scope = (a: Pick<LiveAddresses, "chainId" | "metamorph">) => `${a.chainId}:${a.metamorph.toLowerCase()}`;

/// One reading of the mine.
export interface MineNumbers {
  /// The token it is of (chain and address): a reading of another deployment is never shown.
  scope: string;
  /// totalMinted().
  minted: number;
  /// epoch(), 1 to 11.
  epoch: number;
  /// mintPrice(), in PUPATE wei.
  price: bigint;
  /// bits(): the leading zero bits a hash needs right now.
  bits: number;
  /// The last mint's time (unix seconds); null before the first mint.
  lastMintAt: number | null;
  /// The noted seats the vault holds with editions left (mineableSeats().length); 0 is the commons.
  mineable: number;
  /// The mints of the hour before `now`.
  lastHour: number;
  /// The block the reads ran at.
  block: bigint;
  /// The time the hour is counted back from (unix seconds): this machine's clock plus `skew`.
  now: number;
  /// How far the chain's clock runs ahead of this machine's (seconds; 0 when it does not), as measured when
  /// the block was first seen.
  skew: number;
}

// ------------------------------------------------------------------ the arithmetic

/// The network's hash rate in hashes per second: the mints of the last hour, each worth the hashes a mint
/// takes now (2^bits), over the hour; null when nothing was minted in it.
export function networkRate(lastHour: number, bits: number): number | null {
  return lastHour > 0 ? (lastHour * 2 ** bits) / HOUR : null;
}

/// The share of the 3,333 minted, rounded down to what it shows so it never says more than was minted:
/// 0%, 0.03%, 0.99%, 1.0%, 99.9%, and 100% only when all are.
export function fmtPercent(minted: number): string {
  if (minted <= 0) return "0%";
  if (minted >= SUPPLY) return "100%";
  const pct = (minted / SUPPLY) * 100;
  const digits = pct < 1 ? 2 : 1;
  const scale = 10 ** digits;
  return `${(Math.floor(pct * scale) / scale).toFixed(digits)}%`;
}

/// Whole seconds since the last mint at this machine's time `nowMs`, on the reading's clock; null before the
/// first mint.
export function secondsSince(n: Pick<MineNumbers, "lastMintAt" | "skew">, nowMs: number): number | null {
  if (n.lastMintAt === null) return null;
  return Math.max(0, Math.floor(nowMs / 1000) + n.skew - n.lastMintAt);
}

/// The seconds since the last mint as the page prints them: 42 s, 4 min 12 s, 2 h 5 min, 3 d 4 h; a dash
/// before the first mint.
export function fmtSince(s: number | null): string {
  if (s === null) return "—";
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${s % 60} s`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
  return `${Math.floor(s / 86400)} d ${Math.floor((s % 86400) / 3600)} h`;
}

/// PUPATE wei as the page prints a price: whole tokens, grouped (50,000).
export function fmtPupate(wei: bigint): string {
  return Number(formatUnits(wei, 18)).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

/// A network rate as the page prints it: a dash with no mint in the hour; under one hash a second (a chain
/// at a few bits) it says so rather than rounding to zero.
export function fmtNetworkRate(rate: number | null): string {
  if (rate === null) return "—";
  return rate < 1 ? "< 1 H/s" : fmtRate(rate);
}

/// The figures of "The mine, in numbers", as text; the seconds since the last mint tick on the page.
export interface NumbersText {
  minted: string;
  epoch: string;
  price: string;
  /// "≈ 1.0M hashes"
  difficulty: string;
  /// "20 bits" ("1 bit" at one)
  bits: string;
  /// "3.5 kH/s", or a dash with no mint in the hour.
  rate: string;
  percent: string;
}

export function numbersText(n: Pick<MineNumbers, "minted" | "epoch" | "price" | "bits" | "lastHour">): NumbersText {
  return {
    minted: n.minted.toLocaleString("en-US"),
    epoch: String(n.epoch),
    price: `${fmtPupate(n.price)} PUPATE`,
    difficulty: `≈ ${fmtHashes(2 ** n.bits)} hashes`,
    bits: `${n.bits} bit${n.bits === 1 ? "" : "s"}`,
    rate: fmtNetworkRate(networkRate(n.lastHour, n.bits)),
    percent: fmtPercent(n.minted),
  };
}

/// The mints of the hour before `now`, walking down from the newest card: the ids follow the order of the
/// mints, so the first card at or before `now − HOUR` ends the walk. `mintedAt` gives a card's time when it
/// is known; where the walk meets one it does not know, it stops and names the run of unknown ids from there
/// down to the first it knows (at most `batch`), and is walked again once they are read.
export function hourWalk(minted: number, now: number, mintedAt: (id: number) => number | undefined, batch = TIME_BATCH): { count: number; missing: number[] } {
  let count = 0;
  for (let id = minted; id >= 1; id--) {
    const t = mintedAt(id);
    if (t === undefined) {
      const missing: number[] = [];
      for (let k = id; k >= 1 && missing.length < batch && mintedAt(k) === undefined; k--) missing.push(k);
      return { count, missing };
    }
    if (t <= now - HOUR) break;
    count++;
  }
  return { count, missing: [] };
}

// ------------------------------------------------------------------ the reads

/// Per token: each card's mintedAt, by id, as read once.
const times = new Map<string, Map<number, number>>();
/// Per token: the newest block seen, and how far the chain's clock ran ahead when it was first seen.
const clocks = new Map<string, { block: bigint; skew: number }>();

/// One reading of the mine at this machine's time `nowMs`. Throws when the node does not answer; the caller
/// keeps its last reading.
export async function loadMine(client: PublicClient, a: LiveAddresses, nowMs: number = Date.now()): Promise<MineNumbers> {
  const md = { address: a.metamorph, abi: metamorphAbi } as const;
  const [minted, epoch, price, bits, lastMintAt, open, block, stamp] = await client.multicall({
    allowFailure: false,
    batchSize: 0,
    multicallAddress: MULTICALL3,
    contracts: [
      { ...md, functionName: "totalMinted" },
      { ...md, functionName: "epoch" },
      { ...md, functionName: "mintPrice" },
      { ...md, functionName: "bits" },
      { ...md, functionName: "lastMintAt" },
      { ...md, functionName: "mineableSeats" },
      { address: MULTICALL3, abi: multicall3Views, functionName: "getBlockNumber" },
      { address: MULTICALL3, abi: multicall3Views, functionName: "getCurrentBlockTimestamp" },
    ],
  });
  const wall = Math.floor(nowMs / 1000);
  const key = scope(a);
  const seen = clocks.get(key);
  const skew = seen && seen.block === block ? seen.skew : Math.max(0, Number(stamp) - wall);
  clocks.set(key, { block, skew });
  const now = wall + skew;
  const known = times.get(key) ?? new Map<number, number>();
  times.set(key, known);
  // A card above totalMinted is gone (its block was reorganised away); the card that takes its id later has
  // its own time.
  for (const id of [...known.keys()]) if (id > minted) known.delete(id);
  let walk = hourWalk(minted, now, (id) => known.get(id));
  while (walk.missing.length) {
    const ids = walk.missing;
    const cards = await client.multicall({
      allowFailure: false,
      batchSize: 0,
      multicallAddress: MULTICALL3,
      contracts: ids.map((id) => ({ ...md, functionName: "cards" as const, args: [BigInt(id)] as const })),
    });
    // The card row by name, so the index cannot drift again: mintedAt is the sixth field (after commons).
    ids.forEach((id, i) => {
      const [, , , , , mintedAt] = cards[i];
      known.set(id, Number(mintedAt));
    });
    walk = hourWalk(minted, now, (id) => known.get(id));
  }
  return {
    scope: key,
    minted,
    epoch,
    price,
    bits,
    lastMintAt: minted > 0 ? Number(lastMintAt) : null,
    mineable: open.length,
    lastHour: walk.count,
    block,
    now,
    skew,
  };
}

/// Two readings that show the same: every figure equal and the clock skew within a few seconds. The block
/// and the time of the read are not compared, so a quiet mine does not render the page again every poll.
export function sameNumbers(x: MineNumbers, y: MineNumbers): boolean {
  return (
    x.scope === y.scope &&
    x.minted === y.minted &&
    x.epoch === y.epoch &&
    x.price === y.price &&
    x.bits === y.bits &&
    x.lastMintAt === y.lastMintAt &&
    x.mineable === y.mineable &&
    x.lastHour === y.lastHour &&
    Math.abs(x.skew - y.skew) < SKEW_SLACK
  );
}

// ------------------------------------------------------------------ the hook

/// The mine's numbers for the page: read at once, then every three seconds while the page is there, and
/// again on `reload()` (after a mint). A poll that finds a read still on its way is skipped; a reload asked
/// for then runs when it ends. A failed read keeps the last reading. Null until the first reading, and with
/// no client or no contracts.
export function useMineNumbers(client: PublicClient | null | undefined, a: LiveAddresses | null): { numbers: MineNumbers | null; reload: () => void } {
  const [numbers, setNumbers] = useState<MineNumbers | null>(null);
  const reloadRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    if (!client || !a) return;
    let alive = true;
    let busy = false;
    let again = false;
    const read = async (asked: boolean) => {
      if (busy) {
        if (asked) again = true;
        return;
      }
      busy = true;
      try {
        const n = await loadMine(client, a);
        if (alive) setNumbers((was) => (was && sameNumbers(was, n) ? was : n));
      } catch {
        // The last reading stays up; the next poll tries again.
      } finally {
        busy = false;
        if (alive && again) {
          again = false;
          void read(false);
        }
      }
    };
    reloadRef.current = () => void read(true);
    void read(false);
    const timer = window.setInterval(() => void read(false), NUMBERS_POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
      reloadRef.current = () => undefined;
    };
  }, [client, a]);
  const reload = useCallback(() => reloadRef.current(), []);
  const key = client && a ? scope(a) : null;
  return { numbers: numbers && numbers.scope === key ? numbers : null, reload };
}
