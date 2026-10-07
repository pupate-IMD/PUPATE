// What is drawn and listed for one seat: the shape of its chrysalis and butterfly, fixed by the
// seat's number, and the sample record of its work in the swarm.

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

export function traits(id: number): Traits {
  const r = rng(id);
  const between = (lo: number, hi: number) => lo + r() * (hi - lo);
  return {
    span: between(118, 152),
    rise: between(92, 124),
    reach: between(78, 104),
    drop: between(84, 118),
    veins: 3 + Math.floor(r() * 3),
    spots: Math.floor(r() * 4),
    dots: 3 + Math.floor(r() * 5),
    rings: 3 + Math.floor(r() * 3),
    tilt: between(-5, 5),
    tone: TONES[Math.floor(r() * TONES.length)],
  };
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
