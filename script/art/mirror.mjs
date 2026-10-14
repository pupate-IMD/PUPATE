// The JavaScript twin of the Metamorph MD art contracts (src/metamorph/art/): the same integer arithmetic,
// the same order of operations and the same strings, so the site, the thumbnails and the parity script draw
// what the chain draws. The design reference is the owner's prototype (brand/previews/metamorph/
// metamorph-gen.mjs, untracked): it is the picture and is never read at run time. Where it and the spec
// (docs/superpowers/specs/2026-10-14-metamorph-art-design.md) differ, the spec wins.
//
// This half holds the traits (ArtTraits.sol): seeds, words, the fixed-point draws, the weighted picks, the
// digit strings, the number formatter, the site's seat generator, the seat and card traits, the palette and
// the density table.
//
// Types follow the contract's: a value the contract keeps as uint256 or int256 (tenths, hundredths, words,
// counts before they are narrowed) is a BigInt here; a uint8 or int8 field (an index into a table, a count,
// a delta) is a Number.
//
// viem comes from the site's own install, no new dependency: run `npm ci` (or `npm install`) in site/ once.
// The package's "exports" map "." to ./_esm/index.js for `import`; a relative path does not go through that
// map, so the file is named directly (site/node_modules/viem/index.js does not exist).
//
// Usage:
//   node script/art/mirror.mjs vectors    print the Solidity vectors of test/metamorph/art/ArtTraits.t.sol

import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeAbiParameters, keccak256 } from "../../site/node_modules/viem/_esm/index.js";

const MASK32 = 0xffffffffn;
const HALF32 = 1n << 31n;

// ------------------------------------------------------------------ determinism

/// seed(seat, round, edition, line) = keccak256(abi.encode(uint256 seat, uint16 round, uint16 edition,
/// uint256 line)). Line 7 is the card traits, line 11 the drawing, 11000 + k the prototype's `seed + k`.
export function seed(seat, round, edition, line) {
  return keccak256(
    encodeAbiParameters(
      [{ type: "uint256" }, { type: "uint16" }, { type: "uint16" }, { type: "uint256" }],
      [BigInt(seat), Number(round), Number(edition), BigInt(line)],
    ),
  );
}

/// word(seed, k) = uint32(uint256(keccak256(abi.encode(seed, k / 8))) >> (32 × (k % 8))): the k-th 32-bit
/// word, eight per hash, the lowest word first.
export function word(s, k) {
  const kk = BigInt(k);
  const h = BigInt(keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [s, kk / 8n])));
  return (h >> (32n * (kk % 8n))) & MASK32;
}

/// lo + u/2^32 × (hi − lo), in `unit`ths, rounded half up: lo × unit + ((u × (hi − lo) × unit + 2^31) >> 32).
/// Tenths take the bounds as the prototype writes them and unit 10 (118..152 → between(u, 118, 152, 10));
/// hundredths of a factor take the bounds already in hundredths and unit 1 (0.85..1.2 → between(u, 85, 120,
/// 1)), which is the spec's lo × 100 + round(u × (hi − lo) × 100 / 2^32), the same number.
export function between(u, lo, hi, unit) {
  return BigInt(lo) * BigInt(unit) + ((BigInt(u) * (BigInt(hi) - BigInt(lo)) * BigInt(unit) + HALF32) >> 32n);
}

/// floor(u × n / 2^32): the prototype's Math.floor(r() × n).
export function count(u, n) {
  return (BigInt(u) * BigInt(n)) >> 32n;
}

/// A weighted pick over four weights summing to 100: x = (u × 100) >> 32, then walk the table subtracting
/// weights and return the first index where x < w (a three-entry table ends in a zero weight).
export function pick(u, w) {
  let x = (BigInt(u) * 100n) >> 32n;
  for (let k = 0; k < 4; k++) {
    if (x < BigInt(w[k])) return k;
    x -= BigInt(w[k]);
  }
  return 3;
}

/// The first n bits of keccak256(abi.encode(seed, line)), then of keccak256(abi.encode(seed, line, 1)),
/// (…, 2) and so on, most significant bit first, as the characters 0 and 1.
export function bits(s, line, n) {
  let out = "";
  let h = 0n;
  for (let k = 0; k < n; k++) {
    if (k % 256 === 0) {
      h = BigInt(
        k === 0
          ? keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [s, BigInt(line)]))
          : keccak256(
              encodeAbiParameters(
                [{ type: "bytes32" }, { type: "uint256" }, { type: "uint256" }],
                [s, BigInt(line), BigInt(Math.floor(k / 256))],
              ),
            ),
      );
    }
    out += (h >> BigInt(255 - (k % 256))) & 1n ? "1" : "0";
  }
  return out;
}

/// An unsigned integer in decimal.
export function u(x) {
  return BigInt(x).toString();
}

/// A signed integer in decimal: "-" for a negative one, no sign for zero.
export function i(x) {
  return BigInt(x).toString();
}

/// Tenths as the prototype's f1 prints them: -12.3, 12.3, 12 (no trailing .0), 0, -0.4.
export function f1(tenths) {
  const t = BigInt(tenths);
  const neg = t < 0n;
  const a = neg ? -t : t;
  const whole = u(a / 10n);
  const s = a % 10n === 0n ? whole : `${whole}.${u(a % 10n)}`;
  return neg ? `-${s}` : s;
}

// ------------------------------------------------------------------ the seat

/// The site's generator (site/lib/seat.ts) in uint32 arithmetic, as the contract runs it, returning the 32-bit
/// draw u (the site divides it by 2^32): a = seat × 2654435761 mod 2^32; each draw a += 0x6d2b79f5;
/// t = a; t = (t ^ (t >> 15)) × (t | 1); t ^= t + (t ^ (t >> 7)) × (t | 61); u = t ^ (t >> 14), all mod 2^32.
export function seatRng(seat) {
  let a = (BigInt(seat) * 2654435761n) & MASK32;
  return () => {
    a = (a + 0x6d2b79f5n) & MASK32;
    let t = a;
    t = ((t ^ (t >> 15n)) * (t | 1n)) & MASK32;
    t = t ^ ((t + (((t ^ (t >> 7n)) * (t | 61n)) & MASK32)) & MASK32);
    return (t ^ (t >> 14n)) & MASK32;
  };
}

/// Per seat, in the site's order: span, rise, reach, drop (tenths), veins, spots, dots, rings, tilt (tenths of
/// a degree), tone (an index into the four jades). The integers equal the site's traits(seat) for every seat.
export function seatTraits(seat) {
  const r = seatRng(seat);
  const span = between(r(), 118, 152, 10);
  const rise = between(r(), 92, 124, 10);
  const reach = between(r(), 78, 104, 10);
  const drop = between(r(), 84, 118, 10);
  const veins = 3 + Number(count(r(), 3));
  const spots = Number(count(r(), 4));
  const dots = 3 + Number(count(r(), 5));
  const rings = 3 + Number(count(r(), 3));
  const tilt = between(r(), -5, 5, 10);
  const tone = Number(count(r(), 4));
  return { span, rise, reach, drop, veins, spots, dots, rings, tilt, tone };
}

// ------------------------------------------------------------------ the card

/// The weight tables, the main spec's, verbatim (the prototype's gilt palette entry is dropped: gilt comes
/// from the proof, never from the seed). Each sums to 100.
export const FORM = [40, 22, 22, 16]; // teardrop, pear, spindle, round
export const SIGNAL = [45, 25, 20, 10]; // none, column, band, rain
export const DENSITY = [30, 50, 20, 0]; // fine, standard, bold
export const HALO = [50, 30, 15, 5]; // none, ring, double, orbit
export const PALETTE = [58, 20, 12, 10]; // classic, inverted, ember, mono

export const FORMS = ["teardrop", "pear", "spindle", "round"];
export const SIGNALS = ["none", "column", "band", "rain"];
export const DENSITIES = ["fine", "standard", "bold"];
export const HALOS = ["none", "ring", "double", "orbit"];
export const PALETTES = ["classic", "inverted", "ember", "mono"];
export const TIERS = ["holotype", "paratype", "series"];

/// Holotype for edition 1, paratype for 2..33, series otherwise (edition 0 included, which the token never
/// mints).
export function tierOf(edition) {
  return edition === 1 ? 0 : edition >= 2 && edition <= 33 ? 1 : 2;
}

/// Per edition: seed line 7, one word per draw (picks and counts included), words 0, 1, 2, … in the spec's
/// order: form, signal, tilt, scale, shellW, shellL, wingW, wingL, density, halo, palette, bandW, rings,
/// orbitDeg, dSpan, dRise, dReach, dDrop, dVeins, dSpots. Tilt and orbitDeg in tenths of a degree, the
/// factors in hundredths. (The prototype draws shellW before form; the spec's list is the law here.)
export function cardTraits(seat, round, edition) {
  const s = seed(seat, round, edition, 7);
  let k = 0;
  const w = () => word(s, k++);
  const form = pick(w(), FORM);
  const signal = pick(w(), SIGNAL);
  const tilt = between(w(), -12, 12, 10);
  const scale = between(w(), 90, 110, 1);
  const shellW = between(w(), 85, 120, 1);
  const shellL = between(w(), 92, 110, 1);
  // wingW = min(0.8..1.2, shellW × 1.1): the cap in hundredths, rounded half up.
  const wingDraw = between(w(), 80, 120, 1);
  const wingCap = (shellW * 110n + 50n) / 100n;
  const wingW = wingDraw < wingCap ? wingDraw : wingCap;
  const wingL = between(w(), 90, 108, 1);
  const density = pick(w(), DENSITY);
  const halo = pick(w(), HALO);
  const palette = pick(w(), PALETTE);
  const bandW = between(w(), 80, 115, 1);
  const rings = 2 + Number(count(w(), 4));
  const orbitDeg = between(w(), 0, 360, 10);
  const dSpan = between(w(), 88, 112, 1);
  const dRise = between(w(), 88, 112, 1);
  const dReach = between(w(), 88, 112, 1);
  const dDrop = between(w(), 88, 112, 1);
  const dVeins = Number(count(w(), 3)) - 1;
  const dSpots = Number(count(w(), 3)) - 1;
  const tier = tierOf(Number(edition));
  return {
    form, signal, tilt, scale, shellW, shellL, wingW, wingL, density, halo, palette, bandW, rings, orbitDeg,
    dSpan, dRise, dReach, dDrop, dVeins, dSpots, tier,
  };
}

// ------------------------------------------------------------------ the palette

export const PAPER = "#0b1410";
export const INK = "#e9e6da";
export const DIM = "#9aa89f";
export const HAIR = "#223029";
export const JADE = "#3ec28f";
export const GOLD = "#d9a94b";

/// The four jades; an index past 3 reads as the first (the contract's fallback). The index is coerced with
/// Number(), so a BigInt index picks its jade instead of falling through to the first.
export const TONES = ["#3ec28f", "#2aa87a", "#5fd0a3", "#37b59a"];
export function tone(index) {
  const k = Number(index);
  return k === 1 ? TONES[1] : k === 2 ? TONES[2] : k === 3 ? TONES[3] : TONES[0];
}

const row = (shell, inner, wing, wing2, vein, band, glow, spots, body) => ({
  shell, inner, wing, wing2, vein, band, glow, spots, body,
});

/// The prototype's colours(palette, tone) table; a gilt card takes the prototype's gilt row whatever its
/// palette; a palette past 3 reads as classic (the prototype's default branch). The palette is coerced with
/// Number(), as in tone().
export function colours(palette, gilt, toneIndex) {
  const t = tone(toneIndex);
  const p = Number(palette);
  if (gilt) return row(GOLD, GOLD, t, t, t, INK, GOLD, INK, GOLD);
  if (p === 1) return row(t, t, INK, INK, INK, GOLD, t, GOLD, INK); // inverted
  if (p === 2) return row(INK, INK, GOLD, GOLD, GOLD, t, GOLD, t, INK); // ember
  if (p === 3) return row(INK, INK, INK, INK, INK, GOLD, INK, GOLD, INK); // mono
  return row(INK, INK, t, t, t, GOLD, t, GOLD, INK); // classic
}

/// Font sizes in tenths and the glow dot count: fine 1.9 / 1.2 / 12, standard 2.3 / 1.5 / 26, bold 2.8 / 1.8
/// / 42; a density past 2 reads as bold. The density is coerced with Number(), as in tone().
export function densityOf(density) {
  const d = Number(density);
  if (d === 0) return { outer: 19n, inner: 12n, dots: 12n };
  if (d === 1) return { outer: 23n, inner: 15n, dots: 26n };
  return { outer: 28n, inner: 18n, dots: 42n };
}

// ------------------------------------------------------------------ the vectors

const q = (str) => JSON.stringify(str);
const W = (w) => `[uint16(${w[0]}), ${w[1]}, ${w[2]}, ${w[3]}]`;

/// The 300..302-byte blob of the base64 test: keccak256(abi.encode(uint256 j)) for j = 0..9, cut to n bytes.
export function blob(n) {
  const parts = [];
  for (let j = 0; j < 10; j++) {
    parts.push(Buffer.from(keccak256(encodeAbiParameters([{ type: "uint256" }], [BigInt(j)])).slice(2), "hex"));
  }
  return Buffer.concat(parts).subarray(0, n);
}

function vectors() {
  const out = [];
  const say = (line) => out.push(line);

  say("// ---- test_seedsAndWords");
  const sA = seed(1376, 0, 1, 7);
  const sB = seed(1376, 0, 1, 11);
  const sC = seed(42, 0, 17, 7);
  say(`assertEq(h.seed(1376, 0, 1, 7), bytes32(${sA}));`);
  say(`assertEq(h.seed(1376, 0, 1, 11), bytes32(${sB}));`);
  say(`assertEq(h.seed(42, 0, 17, 7), bytes32(${sC}));`);
  for (const k of [0, 1, 7, 8, 19]) say(`assertEq(h.word(bytes32(${sA}), ${k}), ${word(sA, k)});`);

  say("// ---- test_betweenAndCount");
  const betweens = [
    [0n, 118, 152, 10], [MASK32, 118, 152, 10], [HALF32, 0, 1, 1], [HALF32 - 1n, 0, 1, 1], [HALF32, -1, 0, 1],
    [HALF32 - 1n, -1, 0, 1], [0n, -12, 12, 10], [MASK32, -12, 12, 10], [0x9e3779b9n, 85, 120, 1], [0x9e3779b9n, 0, 360, 10],
  ];
  for (const [x, lo, hi, unit] of betweens) say(`assertEq(h.between(${x}, ${lo}, ${hi}, ${unit}), ${between(x, lo, hi, unit)});`);
  for (const [x, n] of [[0n, 3], [1431655765n, 3], [1431655766n, 3], [MASK32, 3], [MASK32, 5], [0x9e3779b9n, 4]]) {
    say(`assertEq(h.count(${x}, ${n}), ${count(x, n)});`);
  }

  say("// ---- test_seatTraitsVectors");
  for (const seat of [1, 1376, 2345, 4096]) {
    const s = seatTraits(seat);
    say(
      `_seat(${seat}, SeatTraits({span: ${s.span}, rise: ${s.rise}, reach: ${s.reach}, drop: ${s.drop}, ` +
        `veins: ${s.veins}, spots: ${s.spots}, dots: ${s.dots}, rings: ${s.rings}, tilt: ${s.tilt}, tone: ${s.tone}}));`,
    );
  }

  say("// ---- test_cardTraitsVectors");
  // (1376, 0, 4) and (1376, 0, 20): the wingW draw (116, 114) is above the cap (shellW × 110 + 50) / 100
  // (105, 96), so the cap is what the card gets.
  const cards = [[1376, 0, 1], [1376, 0, 2], [1376, 1, 303], [42, 0, 17], [1376, 0, 4], [1376, 0, 20]];
  for (const [seat, round, edition] of cards) {
    const t = cardTraits(seat, round, edition);
    say(
      `_card(${seat}, ${round}, ${edition}, Traits({form: ${t.form}, signal: ${t.signal}, tilt: ${t.tilt}, ` +
        `scale: ${t.scale}, shellW: ${t.shellW}, shellL: ${t.shellL}, wingW: ${t.wingW}, wingL: ${t.wingL}, ` +
        `density: ${t.density}, halo: ${t.halo}, palette: ${t.palette}, bandW: ${t.bandW}, rings: ${t.rings}, ` +
        `orbitDeg: ${t.orbitDeg}, dSpan: ${t.dSpan}, dRise: ${t.dRise}, dReach: ${t.dReach}, dDrop: ${t.dDrop}, ` +
        `dVeins: ${t.dVeins}, dSpots: ${t.dSpots}, tier: ${t.tier}}));`,
    );
  }

  say("// ---- test_f1PrintsTenths");
  for (const v of [-123, -4, 0, 7, 120, 1234]) say(`assertEq(h.f1(${v}), ${q(f1(v))});`);

  say("// ---- test_integersPrintInDecimal");
  for (const v of [0n, 7n, 1234567890n]) say(`assertEq(h.u(${v}), ${q(u(v))});`);
  say(`assertEq(h.u(type(uint256).max), ${q(u((1n << 256n) - 1n))});`);
  for (const v of [-5n, 0n, 42n]) say(`assertEq(h.i(${v}), ${q(i(v))});`);
  say(`assertEq(h.i(type(int256).min), ${q(i(-(1n << 255n)))});`);

  say("// ---- test_bitsVectors");
  const sD = seed(42, 0, 17, 11);
  for (const n of [30, 190, 320]) say(`assertEq(h.bits(bytes32(${sB}), 11001, ${n}), ${q(bits(sB, 11001, n))});`);
  for (const n of [30, 190, 320]) say(`assertEq(h.bits(bytes32(${sD}), 11006, ${n}), ${q(bits(sD, 11006, n))});`);

  // The boundaries run on the library's own tables (the ones cardTraits draws with), each pinned first to the
  // spec's weights.
  say("// ---- test_pickAtTheTableBoundaries");
  const tables = [["form", FORM], ["signal", SIGNAL], ["density", DENSITY], ["halo", HALO], ["palette", PALETTE]];
  for (const [n, [name, w]] of tables.entries()) {
    say(`${n === 0 ? "uint16[4] memory " : ""}w = h.${name}Weights();`);
    say(`_weights(w, ${W(w)});`);
    say(`assertEq(h.pick(0, w), ${pick(0n, w)});`);
    let b = 0;
    for (let k = 0; k < 3; k++) {
      b += w[k];
      if (b >= 100) break;
      // The first u with (u × 100) >> 32 == b, and the one before it.
      const first = (BigInt(b) * (1n << 32n) + 99n) / 100n;
      say(`assertEq(h.pick(${first - 1n}, w), ${pick(first - 1n, w)});`);
      say(`assertEq(h.pick(${first}, w), ${pick(first, w)});`);
    }
    say(`assertEq(h.pick(type(uint32).max, w), ${pick(MASK32, w)});`);
  }

  say("// ---- test_tonesAreTheFourJades");
  for (const t of [0, 1, 2, 3, 4, 255]) say(`assertEq(h.tone(${t}), ${q(tone(t))});`);

  say("// ---- test_coloursFollowThePrototypeTable");
  const cases = [[0, false, 0], [1, false, 1], [2, false, 2], [3, false, 3], [2, true, 1], [0, true, 3], [7, false, 2], [0, false, 9]];
  for (const [p, g, tIdx] of cases) {
    const c = colours(p, g, tIdx);
    say(
      `_colours(${p}, ${g}, ${tIdx}, Colours({shell: ${q(c.shell)}, inner: ${q(c.inner)}, wing: ${q(c.wing)}, ` +
        `wing2: ${q(c.wing2)}, vein: ${q(c.vein)}, band: ${q(c.band)}, glow: ${q(c.glow)}, spots: ${q(c.spots)}, ` +
        `body: ${q(c.body)}}));`,
    );
  }

  say("// ---- test_densityTable");
  for (const d of [0, 1, 2, 3]) {
    const x = densityOf(d);
    say(`_density(${d}, ${x.outer}, ${x.inner}, ${x.dots});`);
  }

  say("// ---- test_base64RoundTrips");
  for (const str of ["", "f", "fo", "foo", "foob", "fooba", "foobar"]) {
    say(`assertEq(h.encode(bytes(${q(str)})), ${q(Buffer.from(str).toString("base64"))});`);
  }
  for (const n of [300, 301, 302]) say(`assertEq(h.encode(_blob(${n})), ${q(blob(n).toString("base64"))});`);

  return out.join("\n");
}

// ------------------------------------------------------------------ the command line

const isMain = (() => {
  try {
    const self = realpathSync(fileURLToPath(import.meta.url));
    const run = realpathSync(resolve(process.argv[1] ?? ""));
    return process.platform === "win32" ? self.toLowerCase() === run.toLowerCase() : self === run;
  } catch {
    return false;
  }
})();

if (isMain) {
  const [cmd] = process.argv.slice(2);
  if (cmd === "vectors") {
    console.log(vectors());
  } else {
    console.error("usage: node script/art/mirror.mjs vectors");
    process.exit(2);
  }
}
