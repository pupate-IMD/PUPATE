// The JavaScript twin of the Metamorph MD art contracts (src/metamorph/art/): the same integer arithmetic,
// the same order of operations and the same strings, so the site, the thumbnails and the parity script draw
// what the chain draws. The design reference is the owner's prototype (brand/previews/metamorph/
// metamorph-gen.mjs, untracked): it is the picture and is never read at run time. Where it and the spec
// (docs/superpowers/specs/2026-10-14-metamorph-art-design.md) differ, the spec wins.
//
// It holds the traits (ArtTraits.sol): seeds, words, the fixed-point draws, the weighted picks, the digit
// strings, the number formatter, the site's seat generator, the seat and card traits, the palette and the
// density table; the chrysalis figure (MetamorphChrysalis.sol); and the butterfly figure with its table of
// sines (MetamorphButterfly.sol).
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
//   node script/art/mirror.mjs sines      print the 91 sines of MetamorphButterfly.sol, sin(0°)..sin(90°) in
//                                         ten-thousandths (test/metamorph/art/Butterfly.t.sol)
//   node script/art/mirror.mjs figure chrysalis <seat> <round> <edition> <gilt 0|1>
//                                         print that card's chrysalis figure (test/metamorph/art/Chrysalis.t.sol)
//   node script/art/mirror.mjs figure butterfly <seat> <round> <edition> <gilt 0|1>
//                                         print that card's butterfly figure (test/metamorph/art/Butterfly.t.sol)

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

// ------------------------------------------------------------------ the chrysalis (MetamorphChrysalis.sol)

/// The prototype's FORMS, each form's six [x, y] control points flattened (x0, y0, x1, y1, …): the left side of
/// the shell from the top to the bottom point as two cubic curves, in the prototype's local units, mirrored for
/// the right side. BAND_FIT in hundredths: how wide the shell is where the band sits, relative to the teardrop.
export const SHELLS = [
  [16, 7, 21, 27, 18, 47, 15, 64, 8, 77, 0, 82], // teardrop
  [9, 6, 19, 36, 20, 58, 17, 72, 9, 81, 0, 84], // pear
  [8, 12, 14, 32, 14, 47, 12, 62, 6, 76, 0, 82], // spindle
  [20, 8, 23, 40, 17, 62, 12, 74, 6, 80, 0, 82], // round
];
export const BAND_FIT = [100, 74, 66, 105];

/// A form's control points and band fit; a form past 3 reads as the teardrop, the prototype's own path.
function shellForm(form) {
  const f = Number(form);
  return f >= 1 && f <= 3 ? { p: SHELLS[f], fit: BAND_FIT[f] } : { p: SHELLS[0], fit: BAND_FIT[0] };
}

/// The figure's one rounding (the contract's _mulDiv): the product of the integer factors, then one division by
/// the last argument (a power of ten), rounded half up. Every printed coordinate, size and length goes through it
/// with all of its factors at once: intermediate values are never rounded (shellW × 0.86 is carried unrounded as
/// shellW × 86). The factors are never negative, and BigInt throws on a float.
const mulDiv = (...xs) => {
  const den = BigInt(xs[xs.length - 1]);
  return (xs.slice(0, -1).reduce((acc, x) => acc * BigInt(x), 1n) + den / 2n) / den;
};

/// The point k units of a factor w across the axis x = 32 (left of it when `left`) and j units of a factor L
/// below `top`, printed "x y" in tenths: x = 320 ∓ k × w × 10 / 10000 and y = top + j × L × 10 / 10000, each
/// rounded once. w and L in ten-thousandths, top in tenths.
const pt = (left, k, w, j, L, top) => {
  const dx = mulDiv(k, w, 10, 10000);
  return `${f1(left ? 320n - dx : 320n + dx)} ${f1(BigInt(top) + mulDiv(j, L, 10, 10000))}`;
};

/// The prototype's shellPath(form, w, L, top): from the top on the axis, the left side down in two cubics to the
/// bottom point on the axis, the right side back up in two cubics. w and L in ten-thousandths, top in tenths.
function shellPath(p, w, L, top) {
  const l = (n) => pt(true, p[n], w, p[n + 1], L, top);
  const r = (n) => pt(false, p[n], w, p[n + 1], L, top);
  return (
    `M32 ${f1(top)}` +
    `C${l(0)} ${l(2)} ${l(4)}C${l(6)} ${l(8)} 32 ${f1(BigInt(top) + mulDiv(p[11], L, 10, 10000))}` +
    `C${r(8)} ${r(6)} ${r(4)}C${r(2)} ${r(0)} 32 ${f1(top)}Z`
  );
}

/// The prototype's wingPath(ww, wl, top): the folded wing's fixed control points, ww across and wl down
/// (ten-thousandths).
function wingPath(ww, wl, top) {
  const l = (k, j) => pt(true, k, ww, j, wl, top);
  const r = (k, j) => pt(false, k, ww, j, wl, top);
  return (
    `M32 ${f1(top)}C${l(9, 10)} ${l(13, 24)} ${l(8, 44)}C${l(4, 38)} ${l(1, 31)} 32 ` +
    `${f1(BigInt(top) + mulDiv(24, wl, 10, 10000))}` +
    `C${r(1, 31)} ${r(4, 38)} ${r(8, 44)}C${r(13, 24)} ${r(9, 10)} 32 ${f1(top)}Z`
  );
}

/// The prototype's bandPath(w): the arc across the shell at y 29, its ends 13 units of w from the axis; w in
/// millionths (bandW × BAND_FIT × shellW, unrounded).
function bandPath(w) {
  const a = mulDiv(13, w, 10, 1000000);
  const b = mulDiv(8, w, 10, 1000000);
  return `M${f1(320n - a)} 29C${f1(320n - b)} 26.4 ${f1(320n + b)} 26.4 ${f1(320n + a)} 29`;
}

/// The prototype's tp: a digit string on a path, the size in tenths. `more` follows a space even when it is
/// empty, as in the prototype (`fill="…" >`).
const tp = (href, size, fill, text, more) =>
  `<text font-size="${f1(size)}" fill="${fill}" ${more}><textPath href="#${href}">${text}</textPath></text>`;

/// The chrysalis figure: the prototype's chrysalisStage inside its figureGroup, with the minimal layout (cx 540,
/// cy 584, shell 6.6), in integer tenths. t: the card traits; c: the colours; s: the drawing seed
/// seed(seat, round, edition, 11), whose lines 11001..11006 carry the six digit strings. The seat traits are not
/// used. The order of the elements and their attributes is the prototype's, verbatim; every printed number is
/// one mulDiv of all its factors.
export function chrysalisFigure(t, c, s) {
  const { outer, inner } = densityOf(t.density);
  const { p, fit } = shellForm(t.form);
  let rings = "";
  for (let j = 0n; j < BigInt(t.rings); j++) {
    const w = mulDiv(140n - 30n * j, t.shellW, 100); // (14 − 3j) × shellW
    const y = 110n + mulDiv(530n + 70n * j, t.shellL, 100); // 11 + (53 + 7j) × shellL
    rings +=
      `<path d="M${f1(320n - w)} ${f1(y)}q${f1(w)} 4 ${f1(mulDiv(2, 140n - 30n * j, t.shellW, 100))} 0" ` +
      `stroke="${c.shell}" stroke-width="0.5" fill="none" opacity="0.45" stroke-dasharray="0.8 1.2"/>`;
  }
  const tickY = 300n + mulDiv(440, t.wingL, 100) - 10n; // 30 + 44 × wingL − 1
  return (
    // the group: translate(cx cy) rotate(tilt) scale(6.6 × scale) translate(-32 -52)
    `<g transform="translate(540 584) rotate(${f1(t.tilt)}) scale(${f1(mulDiv(66, t.scale, 100))}) ` +
    `translate(-32 -52)" font-family="Consolas, 'Courier New', monospace" letter-spacing="0.25">` +
    // the defs: the shell (its factors in ten-thousandths); the inner shell at shellW × 0.86, shellL × 0.93 from
    // 11 + 2.5 × shellL; the wing; the inner wing at wingW × 0.73, wingL × 0.82 from 34; the band, bandW ×
    // BAND_FIT × shellW wide; the vein, 44 × wingL long
    `<defs><path id="shell" d="${shellPath(p, t.shellW * 100n, t.shellL * 100n, 110n)}"/>` +
    `<path id="shell2" d="${shellPath(p, t.shellW * 86n, t.shellL * 93n, 110n + mulDiv(25, t.shellL, 100))}"/>` +
    `<path id="wing" d="${wingPath(t.wingW * 100n, t.wingL * 100n, 300n)}"/>` +
    `<path id="wing2" d="${wingPath(t.wingW * 73n, t.wingL * 82n, 340n)}"/>` +
    `<path id="band" d="${bandPath(t.bandW * BigInt(fit) * t.shellW)}"/>` +
    `<path id="vein" d="M32 30v${f1(mulDiv(440, t.wingL, 100))}"/></defs>` +
    // the six digit strings: the prototype's bits(seed + k, n) is bits(s, 11000 + k, n)
    tp("shell", outer, c.shell, bits(s, 11001, 190), "") +
    tp("shell2", inner, c.inner, bits(s, 11002, 210), `opacity="0.45"`) +
    tp("wing", mulDiv(outer, 90, 100), c.wing, bits(s, 11003, 130), `filter="url(#soft)"`) +
    tp("wing2", mulDiv(inner, 95, 100), c.wing2, bits(s, 11004, 140), `opacity="0.55"`) +
    tp("vein", mulDiv(inner, 105, 100), c.vein, bits(s, 11005, 40), `opacity="0.8"`) +
    tp("band", mulDiv(outer, 95, 100), c.band, bits(s, 11006, 30), "") +
    // the segment rings
    rings +
    // the gold tick, moved down to the end of the vein
    `<path transform="translate(0 ${f1(tickY - 730n)})" d="M${f1(320n - mulDiv(75, t.wingW, 100))} 73c` +
    `${f1(mulDiv(20, t.wingW, 100))}-3.6 ${f1(mulDiv(48, t.wingW, 100))}-6.6 ${f1(mulDiv(75, t.wingW, 100))}-9.4 ` +
    `${f1(mulDiv(27, t.wingW, 100))} 2.8 ${f1(mulDiv(55, t.wingW, 100))} 5.8 ${f1(mulDiv(75, t.wingW, 100))} 9.4" ` +
    `stroke="${c.band}" stroke-width="0.9" fill="none" stroke-linecap="round"/>` +
    // the stem
    `<path d="M32 2v9" stroke="${c.shell}" stroke-width="0.8" fill="none"/>` +
    "</g>"
  );
}

// ------------------------------------------------------------------ the butterfly (MetamorphButterfly.sol)

/// sin(d°) for d = 0..90 in ten-thousandths, Math.round(Math.sin(d × π / 180) × 10000): 0, 175, 349, …, 10000.
/// The contract holds the same 91 numbers as a constant table; `node script/art/mirror.mjs sines` prints them.
/// Angles between two whole degrees are interpolated (sinT).
export const SINES = Array.from({ length: 91 }, (_, d) => Math.round(Math.sin((d * Math.PI) / 180) * 10000));

/// sin(t / 10 degrees) for t in 0..900 tenths of a degree, in hundred-thousandths (ten times the table's
/// ten-thousandths, so that it stays an integer): the two whole degrees around it interpolated linearly and kept
/// unrounded, SINES[d] × (10 − f) + SINES[d + 1] × f with d = t / 10 and f = t % 10. At a whole degree (f = 0)
/// it is SINES[d] × 10 and the next entry is not read, so 90° never reads past the table. For an angle a in
/// tenths (−900..900): sin(a) = sign(a) × sinT(|a|) and cos(a) = sinT(900 − |a|).
export function sinT(t) {
  const d = Math.floor(t / 10), f = t % 10;
  return f === 0 ? BigInt(SINES[d]) * 10n : BigInt(SINES[d]) * BigInt(10 - f) + BigInt(SINES[d + 1]) * BigInt(f);
}

/// The prototype's clamp(v, lo, hi), on integers.
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/// The angle of upper vein i of n (n ≥ 2 after the clamp) in tenths of a degree: −62 + 70 × i / (n − 1)
/// degrees, its 700 × i / (n − 1) tenths one mulDiv (−38.67° is −387, −44.5° is −445).
export function veinAngle(i, n) {
  return -620 + Number(mulDiv(700, i, n - 1));
}

/// The prototype's ray(x, y, deg, len): from (x, y) in tenths at an angle a in tenths of a degree (−900..900),
/// its length len / 10000 tenths (len the unrounded product of its factors), printed "Mx yLx' y'". The end is
/// x + cos(a) × len and y + sin(a) × len: each offset is one product of the interpolated sine (sinT,
/// hundred-thousandths) and len divided once (by 10^9), its magnitude rounded half up; cos(a) = sinT(900 − |a|)
/// is never negative, and the sign of the angle goes on the rounded y offset.
function ray(x, y, a, len) {
  const m = Math.abs(a);
  const dx = mulDiv(sinT(900 - m), len, 1000000000);
  const dy = mulDiv(sinT(m), len, 1000000000);
  return `M${f1(x)} ${f1(y)}L${f1(BigInt(x) + dx)} ${f1(a < 0 ? BigInt(y) - dy : BigInt(y) + dy)}`;
}

/// The prototype's upper wing from (4, −22): 4 + k × span across and −22 − k × rise up, k in hundredths, span
/// and rise in thousandths of a unit (the seat's tenths × the edition's hundredths, unrounded); each value one
/// product divided once by 10000, its magnitude rounded half up.
function upperWing(span, rise) {
  const x = (k) => f1(40n + mulDiv(span, k, 10000));
  const y = (k) => f1(-220n - mulDiv(rise, k, 10000));
  return `M4 -22C${x(45)} ${y(100)} ${x(100)} ${y(95)} ${x(100)} ${y(30)}C${x(98)} -4 ${x(55)} 16 4 10Z`;
}

/// The prototype's lower wing from (4, 10): 4 + k × reach across and 10 + k × drop down, as the upper wing.
function lowerWing(reach, drop) {
  const x = (k) => f1(40n + mulDiv(reach, k, 10000));
  const y = (k) => f1(100n + mulDiv(drop, k, 10000));
  return `M4 10C${x(90)} 6 ${x(110)} ${y(60)} ${x(50)} ${y(100)}C${x(25)} ${y(92)} 10 ${y(50)} 4 30Z`;
}

/// A digit wash: the prototype's text on a wing path, its size in tenths; `more` is an attribute with its
/// leading space, or nothing.
const wash = (size, fill, more, spacing, href, digits) =>
  `<text font-size="${f1(size)}" fill="${fill}"${more} letter-spacing="${spacing}">` +
  `<textPath href="#${href}">${digits}</textPath></text>`;

/// The butterfly figure: the prototype's butterflyStage with the minimal layout (cx 540, cy 584 + 12, wings 2.2),
/// in integer tenths. t: the card traits; s: the seat traits; c: the colours; seed: the drawing seed
/// seed(seat, round, edition, 11), whose lines 11011..11014 carry the four digit strings. The seat's geometry is
/// scaled by the edition's deltas and carried unrounded (span = s.span × dSpan, thousandths of a unit); veins
/// and spots are clamped after the deltas (2..6, 0..4). The order of the elements, their attributes and the
/// newlines are the prototype's, verbatim; every printed number is one mulDiv of all its factors.
export function butterflyFigure(t, s, c, seed) {
  const { outer, inner } = densityOf(t.density);
  const span = s.span * t.dSpan, rise = s.rise * t.dRise, reach = s.reach * t.dReach, drop = s.drop * t.dDrop;
  const veins = clamp(s.veins + t.dVeins, 2, 6), spots = clamp(s.spots + t.dSpots, 0, 4);
  const upper = upperWing(span, rise), lower = lowerWing(reach, drop);
  const vein = (d, clip) =>
    `<path d="${d}" stroke="${c.vein}" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#${clip})"/>`;
  // the veins: the upper ones from (6, −8), span × 0.92 long; the lower ones from (6, 16) at 22, 48 and 74
  // degrees (tenths: 220, 480, 740), drop × 0.9 long
  let lines = "";
  for (let i = 0; i < veins; i++) lines += vein(ray(60, -80, veinAngle(i, veins), span * 92n), "cu");
  for (const a of [220, 480, 740]) lines += vein(ray(60, 160, a, drop * 90n), "cl");
  // the spots: spot i at 4 + span × (0.8 − 0.07 i), −22 − rise × 0.62 + 17 i, radius 5 − 0.6 i
  let dots = "";
  for (let i = 0; i < spots; i++) {
    const cx = 40n + mulDiv(span, 80 - 7 * i, 10000);
    const cy = -220n - mulDiv(rise, 62, 10000) + 170n * BigInt(i);
    dots += `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(50 - 6 * i)}" fill="${c.spots}"/>`;
  }
  // one half: the three digit washes (outer × 3.9, outer × 3.7, inner × 3.7), the veins, the spots
  const half =
    "<g>" +
    wash(mulDiv(outer, 39, 10), c.wing, "", "0.6", "up", bits(seed, 11011, 120)) +
    wash(mulDiv(outer, 37, 10), c.wing, "", "0.6", "lo", bits(seed, 11012, 100)) +
    wash(mulDiv(inner, 37, 10), c.inner, ` opacity="0.35"`, "0.5", "up2", bits(seed, 11013, 140)) +
    lines +
    dots +
    "</g>";
  return (
    // the group: translate(cx cy + 12) rotate(tilt) scale(2.2 × scale)
    `<g transform="translate(540 596) rotate(${f1(t.tilt)}) scale(${f1(mulDiv(22, t.scale, 100))})" ` +
    `font-family="Consolas, 'Courier New', monospace">\n` +
    `<defs><path id="up" d="${upper}"/><path id="lo" d="${lower}"/>` +
    `<path id="up2" transform="translate(4 -6) scale(0.82)" d="${upper}"/>\n` +
    `<clipPath id="cu"><path d="${upper}"/></clipPath><clipPath id="cl"><path d="${lower}"/></clipPath>` +
    `<path id="body" d="M0 -36V40"/></defs>\n` +
    // the half and its mirror image
    `${half}<g transform="scale(-1 1)">${half}</g>\n` +
    // the antennae, their tips, the head and the body with its fourteen digits
    `<path d="M-2 -52C-8 -76 -22 -90 -32 -93M2 -52C8 -76 22 -90 32 -93" stroke="${c.body}" stroke-width="1.4" ` +
    `fill="none" stroke-linecap="round"/>\n` +
    `<circle cx="-32" cy="-93" r="2.2" fill="${c.body}"/><circle cx="32" cy="-93" r="2.2" fill="${c.body}"/>\n` +
    `<circle cx="0" cy="-48" r="6.5" fill="${c.body}"/><ellipse cx="0" cy="2" rx="5.5" ry="44" fill="${c.body}"/>\n` +
    `<text font-size="5.5" fill="${PAPER}" letter-spacing="0.3" writing-mode="tb">` +
    `<textPath href="#body">${bits(seed, 11014, 14)}</textPath></text>\n` +
    "</g>"
  );
}

/// What the router hands a figure contract for a card: the card traits, the seat traits, the colours (the
/// palette, or the gilt row, with the seat's jade) and the drawing seed (line 11).
export function figureInputs(seat, round, edition, gilt) {
  const t = cardTraits(seat, round, edition);
  const st = seatTraits(seat);
  return { t, st, c: colours(t.palette, gilt, st.tone), s: seed(seat, round, edition, 11) };
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

const USAGE =
  "usage: node script/art/mirror.mjs vectors | sines | figure <chrysalis|butterfly> <seat> <round> <edition> <gilt 0|1>";

if (isMain) {
  const [cmd, ...args] = process.argv.slice(2);
  const figure = cmd === "figure" && args.length === 5 && ["0", "1"].includes(args[4]);
  if (cmd === "vectors") {
    console.log(vectors());
  } else if (cmd === "sines" && args.length === 0) {
    console.log(SINES.join(", "));
  } else if (figure && args[0] === "chrysalis") {
    const { t, c, s } = figureInputs(BigInt(args[1]), Number(args[2]), Number(args[3]), args[4] === "1");
    console.log(chrysalisFigure(t, c, s));
  } else if (figure && args[0] === "butterfly") {
    const { t, st, c, s } = figureInputs(BigInt(args[1]), Number(args[2]), Number(args[3]), args[4] === "1");
    console.log(butterflyFigure(t, st, c, s));
  } else {
    console.error(USAGE);
    process.exit(2);
  }
}
