// Seat parity: the integer seat traits of the mirror (the contract's uint32 generator, see mirror.mjs) against
// the site's own float generator, for seats 1..64. The integers (veins, spots, dots, rings, the tone index)
// must be equal for every seat; the tenths are the contract's (the site adopts them later), and the script
// also reports, for information, whether they equal the site's floats rounded to a tenth.
//
// Usage: node script/art/seatParity.mjs   (prints one OK line per seat, exits 1 on any difference)

import { seatTraits } from "./mirror.mjs";

// ---- mirrors site/lib/seat.ts; keep in sync (rng and traits, verbatim, with the types removed)

function rng(seed) {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TONES = ["#3ec28f", "#2aa87a", "#5fd0a3", "#37b59a"];

function traits(id) {
  const r = rng(id);
  const between = (lo, hi) => lo + r() * (hi - lo);
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

// ---- the comparison

const SEATS = 64;
let bad = 0;
let tenthsEqual = 0;
for (let seat = 1; seat <= SEATS; seat++) {
  const site = traits(seat);
  const m = seatTraits(seat);
  const siteTone = TONES.indexOf(site.tone);
  const fields = [
    ["veins", site.veins, m.veins],
    ["spots", site.spots, m.spots],
    ["dots", site.dots, m.dots],
    ["rings", site.rings, m.rings],
    ["tone", siteTone, m.tone],
  ];
  const diff = fields.filter(([, a, b]) => a !== b);
  const listed = fields.map(([name, , b]) => `${name} ${b}`).join(", ");
  if (diff.length === 0) {
    console.log(`OK seat ${seat}: ${listed}`);
  } else {
    bad++;
    console.log(`DIFF seat ${seat}: ${diff.map(([name, a, b]) => `${name} site ${a} mirror ${b}`).join(", ")}`);
  }
  const tenths = ["span", "rise", "reach", "drop", "tilt"].every((k) => BigInt(Math.round(site[k] * 10)) === m[k]);
  if (tenths) tenthsEqual++;
}
console.log(
  `${SEATS - bad} of ${SEATS} seats equal the site in every integer; ` +
    `tenths equal the site's floats rounded to a tenth for ${tenthsEqual} of ${SEATS} (information only)`,
);
process.exit(bad === 0 ? 0 : 1);
