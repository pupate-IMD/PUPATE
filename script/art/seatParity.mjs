// Seat parity: the seat traits of the mirror (the contract's uint32 generator, see mirror.mjs) against the
// site's own traits(seat) (site/lib/seat.ts, imported as it is: Node 22.18 or later runs TypeScript without a
// flag), for seats 1..64. Every field must be equal: the integers (veins, spots, dots, rings, the tone) and
// the tenths (span, rise, reach, drop, tilt), which the site returns as numbers, tenths / 10.
//
// Usage: node script/art/seatParity.mjs   (prints one OK line per seat, exits 1 on any difference)

import { registerHooks } from "node:module";
import { TONES, seatTraits } from "./mirror.mjs";

// site/package.json names no module type, so Node would parse seat.ts as CommonJS first and warn; the hook
// says it is a TypeScript module. The import comes after it (a static import is resolved before any hook).
registerHooks({
  resolve(specifier, context, nextResolve) {
    const r = nextResolve(specifier, context);
    return r.url.endsWith(".ts") ? { ...r, format: "module-typescript" } : r;
  },
});
const { traits } = await import("../../site/lib/seat.ts");

const SEATS = 64;
const TENTHS = ["span", "rise", "reach", "drop", "tilt"];
let bad = 0;
for (let seat = 1; seat <= SEATS; seat++) {
  const site = traits(seat);
  const m = seatTraits(seat);
  const fields = [
    ["veins", site.veins, m.veins],
    ["spots", site.spots, m.spots],
    ["dots", site.dots, m.dots],
    ["rings", site.rings, m.rings],
    ["tone", site.tone, TONES[m.tone]],
    // The site's number is the contract's tenths divided by ten, the same double, nothing rounded twice.
    ...TENTHS.map((k) => [k, site[k], Number(m[k]) / 10]),
  ];
  const diff = fields.filter(([, a, b]) => a !== b);
  const listed = fields.map(([name, , b]) => `${name} ${b}`).join(", ");
  if (diff.length === 0) {
    console.log(`OK seat ${seat}: ${listed}`);
  } else {
    bad++;
    console.log(`DIFF seat ${seat}: ${diff.map(([name, a, b]) => `${name} site ${a} mirror ${b}`).join(", ")}`);
  }
}
console.log(`${SEATS - bad} of ${SEATS} seats equal the mirror in every integer and every tenth`);
process.exit(bad === 0 ? 0 : 1);
