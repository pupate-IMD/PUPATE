// What is drawn and listed for one seat: the shape of its chrysalis and butterfly, fixed by the
// seat's number, and the sample record of its work in the swarm.
//
// The shape is the chain's: traits(seat) is ArtTraits.seatTraits (src/metamorph/art/ArtTraits.sol, its
// JavaScript twin script/art/mirror.mjs), rng's draws taken as the 32-bit words they are and the lengths and
// the tilt drawn in tenths, rounded half up, so the seat pages, the emergence card and the token draw the
// same butterfly. script/art/seatParity.mjs holds this file against the mirror; so does npm run mine-check.

/// A small deterministic generator, so a seat always draws the same way.
export function rng(seed: number): () => number {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Traits {
  span: number; // reach of the upper wing
  rise: number; // height of the upper wing
  reach: number; // reach of the lower wing
  drop: number; // length of the lower wing
  veins: number;
  spots: number;
  dots: number; // gold dots on the chrysalis band
  rings: number; // segment lines on the chrysalis
  tilt: number; // degrees
  tone: string; // the jade of this seat
}

const TONES = ["#3ec28f", "#2aa87a", "#5fd0a3", "#37b59a"];
const WORD = 4294967296; // 2^32

/// rng's generator as the contract runs it, in uint32 arithmetic: each draw is the 32-bit word u that rng
/// divides by 2^32. The seed's product is taken modulo 2^32 with Math.imul, so it is exact for every seat.
function words(seat: number): () => number {
  let a = Math.imul(seat, 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

/// lo + u/2^32 × (hi − lo) in tenths, rounded half up: lo × 10 + ((u × (hi − lo) × 10 + 2^31) >> 32), the
/// contract's between(u, lo, hi, 10). Exact in a double: u × (hi − lo) × 10 stays below 2^42.
function tenths(u: number, lo: number, hi: number): number {
  return lo * 10 + Math.floor((u * (hi - lo) * 10 + WORD / 2) / WORD);
}

/// floor(u × n / 2^32), the contract's count(u, n): what Math.floor(rng() × n) gave, exactly.
function count(u: number, n: number): number {
  return Math.floor((u * n) / WORD);
}

/// The seat's traits as the chain draws them: the integers as before (veins, spots, dots, rings, the tone),
/// the lengths and the tilt in tenths, as numbers (123.4 is the contract's 1234).
export function traits(seat: number): Traits {
  const u = words(seat);
  const span = tenths(u(), 118, 152);
  const rise = tenths(u(), 92, 124);
  const reach = tenths(u(), 78, 104);
  const drop = tenths(u(), 84, 118);
  const veins = 3 + count(u(), 3);
  const spots = count(u(), 4);
  const dots = 3 + count(u(), 5);
  const rings = 3 + count(u(), 3);
  const tilt = tenths(u(), -5, 5);
  const tone = TONES[count(u(), TONES.length)];
  return { span: span / 10, rise: rise / 10, reach: reach / 10, drop: drop / 10, veins, spots, dots, rings, tilt: tilt / 10, tone };
}

export type JobKind = "Oracle panel" | "Launch review" | "Launch build";

export interface Job {
  n: number;
  day: number;
  kind: JobKind;
  outcome: string;
}

export interface WorkLog {
  jobs: Job[]; // newest first
  byDay: { day: number; total: number }[]; // running total, one point per day held
  kinds: { kind: JobKind; count: number }[];
}

const OUTCOMES: Record<JobKind, string[]> = {
  "Oracle panel": ["agreed with the quorum", "agreed with the quorum", "agreed with the quorum", "outside the quorum"],
  "Launch review": ["review accepted", "review accepted", "changes requested"],
  "Launch build": ["build accepted", "build accepted", "superseded by another seat"],
};

/// The sample record of a seat: `count` jobs spread over the days it has been held. The live site
/// reads the same shape from IMD's public seat records.
export function workLog(id: number, days: number, count: number): WorkLog {
  const r = rng(id * 31 + 7);
  const perDay = Array.from({ length: days + 1 }, () => 0);
  const jobs: Job[] = [];
  for (let n = 1; n <= count; n++) {
    // Spread in order: job n falls on the day its share of the count has reached.
    const day = Math.min(days, Math.floor(((n - 1 + r()) / count) * (days + 1)));
    const roll = r();
    const kind: JobKind = roll < 0.62 ? "Oracle panel" : roll < 0.86 ? "Launch review" : "Launch build";
    const outcomes = OUTCOMES[kind];
    perDay[day] += 1;
    jobs.push({ n, day, kind, outcome: outcomes[Math.floor(r() * outcomes.length)] });
  }
  let total = 0;
  const byDay = perDay.map((c, day) => ({ day, total: (total += c) }));
  const kinds = (["Oracle panel", "Launch review", "Launch build"] as JobKind[]).map((kind) => ({
    kind,
    count: jobs.filter((j) => j.kind === kind).length,
  }));
  return { jobs: jobs.reverse(), byDay, kinds };
}
