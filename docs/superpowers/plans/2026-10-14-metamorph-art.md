# Metamorph MD Art Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the on-chain renderer of Metamorph MD cards (`MetamorphArt` + two figure contracts + the trait library), a JavaScript mirror that draws the same bytes, the parity test on anvil, the deploy script, and the tests that pin determinism, size and gas, so that `MetamorphMD.tokenURI` returns a finished card.

**Architecture:** `MetamorphArt` implements `IMetamorphArt`: it derives the traits with the internal library `ArtTraits` (keccak seeds, a 32-bit word generator, the site's seat generator, fixed-point tenths/hundredths, weighted picks, bit strings, a number formatter), draws the frame and the labels, asks `MetamorphChrysalis` or `MetamorphButterfly` (immutable addresses, `IMetamorphFigure`) for the figure, assembles the SVG and the JSON and base64-encodes them (`Base64`, internal). The mirror `script/art/mirror.mjs` is the same program in JavaScript (BigInt for the 32-bit arithmetic and keccak from viem), written first so its numbers become the contract's test vectors; `script/art/parity.mjs` proves the two agree byte for byte on anvil.

**Tech Stack:** Solidity 0.8.26 (cancun, forge 1.7.1), Foundry tests on the existing `MetamorphFixture`; Node 20+ with viem for the mirror and parity (`npm`-free: the scripts use the site's `node_modules` via `NODE_PATH` or a one-line `import` of viem from `site/node_modules`; no new dependency); anvil (ships with Foundry).

**Spec:** `docs/superpowers/specs/2026-10-14-metamorph-art-design.md` (the renderer's law); the main spec's "The drawing" and "Rarity" sections (`docs/superpowers/specs/2026-10-13-metamorph-md-design.md`, lines ~376-421); the prototype `brand/previews/metamorph/metamorph-gen.mjs` (untracked, read it: it is the picture to reproduce; the spec's integer rules win where they differ).

## Global Constraints

- English only in code, names, comments, commit messages, the mirror and the scripts.
- No owner, setter, pause, upgrade or withdraw in any art contract; constructor arguments are immutables; nothing reads `msg.sender` or `block.*` in the renderer (pure functions over the `View`).
- The token contract `src/metamorph/MetamorphMD.sol` and the frozen launched contracts are not modified. `IMetamorphArt` is not modified (the token is merged and audited against it).
- Commit messages: one line, no `Co-Authored-By`, no body; never push.
- `forge test` green at every commit (357 tests at the start, 11 fork tests skip without the RPC). New tests under `test/metamorph/art/`.
- Each art contract under 24,576 bytes of runtime (`MetamorphSizeTest`-style test per contract). `tokenURI` under 20,000,000 gas for both stages at the worst-case traits. SVG under 24 KB, JSON under 40 KB.
- Fixed point, verbatim from the spec: lengths and font sizes in tenths; factors in hundredths; angles in tenths of a degree; `between(lo, hi)` → `lo × unit + ((u × (hi − lo) × unit + 2^31) >> 32)`; counts `floor(u × n / 2^32)` = `(u × n) >> 32`; picks `x = (u × total) >> 32`; `word(seed, k) = uint32(uint256(keccak256(abi.encode(seed, k / 8))) >> (32 × (k % 8)))`; `seed(seat, round, edition, line) = keccak256(abi.encode(seat, round, edition, line))`; lines 7 (card traits), 11 (the drawing), `11000 + k` for the prototype's `seed + k`; `bits(seed, line, n)` from `keccak256(abi.encode(seed, line))`, then `(seed, line, 1)`, `(seed, line, 2)` for n > 256, MSB first.
- The weight tables, ranges, colours, layout numbers, density table and label texts are the spec's, verbatim; the gilt palette comes only from `View.gilt`.
- The mirror is the contract's twin: it must not read the prototype at run time, and it must follow the contract's order of operations and rounding (not the prototype's floats).
- The plan's code blocks start with a caption comment; never copy it as line 1 of a file (SPDX is line 1). `forge fmt` on touched Solidity. No new solc warnings.

## Review Focus

1. A seat whose site generator rounds a float ending in exactly .x5 (the tenths rounding could differ between float and integer): the spec makes the contract the law; the mirror and the seat test compare the INTEGER parts (veins, spots, dots, rings, tone) with the site and the tenths with the contract only (Task 1, `test_seatTraitsIntegerPartsMatchTheSite` and the mirror's `seatParity.mjs` check).
2. A card with every heavy trait at once (bold, double halo, rain, a butterfly with six veins and four spots, the holotype frame): the gas and the SVG size must stay inside the limits (Task 4, `test_worstCaseStaysUnderTheLimits`, constructed by searching seeds in the mirror for such a card and pinning its (seat, round, edition)).
3. A `View` with `edition = 0` or `seat = 0` or `stage > 1` (a mis-wired caller): `tokenURI` must not revert with a panic or produce broken XML; it treats stage > 1 as butterfly, and renders any edition/seat (the token never produces these, but the renderer is public) (Task 4, `test_oddViewsStillRender`).
4. Characters that would break the JSON or the SVG (the miner address is hex, numbers are decimal; no user text reaches the output): the JSON is valid and every `"` inside it is ours (Task 4, `test_jsonIsWellFormed`, decoded and checked field by field).
5. The parity sample must include every form, halo, signal, density and palette, both stages, gilt and plain, and the three tiers, or a branch could ship untested (Task 5, the sample is chosen by the mirror by searching seeds until each value appears, and the parity script asserts the coverage before comparing).

---

## File structure

| File | Responsibility |
|---|---|
| `src/interfaces/IMetamorphFigure.sol` | `struct SeatTraits`, `struct Traits`, `struct Colours`; `interface IMetamorphFigure { function figure(Traits, SeatTraits, Colours, bytes32 seed) external pure returns (string) }` |
| `src/metamorph/art/ArtTraits.sol` | internal library: `seed`, `word`, `between`, `count`, `pick`, `bits`, `f1`, `u`, `seatTraits`, `cardTraits`, `colours`, `densityOf` |
| `src/metamorph/art/Base64.sol` | internal library `encode(bytes) returns (string)` |
| `src/metamorph/art/MetamorphChrysalis.sol` | the chrysalis figure |
| `src/metamorph/art/MetamorphButterfly.sol` | the butterfly figure, the sine table |
| `src/metamorph/art/MetamorphArt.sol` | `IMetamorphArt`: frame, labels, SVG, JSON, base64; immutables `CHRYSALIS`, `BUTTERFLY` |
| `script/art/mirror.mjs` | the twin: `seatTraits`, `cardTraits`, `colours`, `bits`, `f1`, `renderSVG(view)`, `tokenJSON(view)`, `tokenURI(view)`; CLI: `node script/art/mirror.mjs vectors` prints the Solidity test vectors; `node script/art/mirror.mjs render <seat> <round> <edition> <stage> <gilt> <id>` writes an SVG |
| `script/art/seatParity.mjs` | compares the integer seat traits of the mirror with `site/lib/seat.ts`'s for 64 seats (imports the TS through a tiny transpile-free copy of `rng`/`traits` in JS, kept in the script, with a comment that it mirrors `site/lib/seat.ts`) |
| `script/art/parity.mjs` | anvil + deploy + `eth_call` + byte comparison + XML parse + gas + `out/art/*.svg` |
| `script/DeployMetamorphArt.s.sol` | deploys the three contracts, prints addresses and a sample URI length |
| `test/metamorph/art/ArtTraits.t.sol`, `Chrysalis.t.sol`, `Butterfly.t.sol`, `MetamorphArt.t.sol`, `ArtSize.t.sol`, `ArtThroughTheToken.t.sol` | the suites |

Run commands (Git Bash): `forge test --match-path "test/metamorph/art/*" -vv`; `node script/art/mirror.mjs vectors`; `node script/art/parity.mjs` (needs `anvil` and `forge` on PATH; it starts and stops anvil itself on port 8546).

---

### Task 1: The trait library, the base64, and the mirror's trait half

**Files:**
- Create: `src/interfaces/IMetamorphFigure.sol`, `src/metamorph/art/ArtTraits.sol`, `src/metamorph/art/Base64.sol`, `script/art/mirror.mjs` (traits half), `script/art/seatParity.mjs`
- Test: `test/metamorph/art/ArtTraits.t.sol`

**Interfaces:**
- Produces (Solidity, all `internal pure`): `seed(uint256 seat, uint16 round, uint16 edition, uint256 line) returns (bytes32)`; `word(bytes32 seed, uint256 k) returns (uint32)`; `between(uint32 u, int256 lo, int256 hi, uint256 unit) returns (int256)`; `count(uint32 u, uint256 n) returns (uint256)`; `pick(uint32 u, uint16[4] memory weights) returns (uint8)` (index into the table; weights sum to 100); `bits(bytes32 seed, uint256 line, uint256 n) returns (string)`; `f1(int256 tenths) returns (string)`; `u(uint256) returns (string)`; `i(int256) returns (string)`; `seatTraits(uint256 seat) returns (SeatTraits)`; `cardTraits(uint256 seat, uint16 round, uint16 edition) returns (Traits)`; `colours(uint8 palette, bool gilt, uint8 toneIndex) returns (Colours)`; `densityOf(uint8 density) returns (uint256 outer, uint256 inner, uint256 dots)`; `Base64.encode(bytes) returns (string)`.
- Structs (in `IMetamorphFigure.sol`):

```solidity
// src/interfaces/IMetamorphFigure.sol
struct SeatTraits {
    int256 span; // tenths
    int256 rise;
    int256 reach;
    int256 drop;
    uint8 veins; // 3..5
    uint8 spots; // 0..3
    uint8 dots; // 3..7
    uint8 rings; // 3..5
    int256 tilt; // tenths of a degree, -50..50
    uint8 tone; // index into the four jades
}

struct Traits {
    uint8 form; // 0 teardrop, 1 pear, 2 spindle, 3 round
    uint8 signal; // 0 none, 1 column, 2 band, 3 rain
    int256 tilt; // tenths of a degree, -120..120
    uint256 scale; // hundredths, 90..110
    uint256 shellW; // hundredths, 85..120
    uint256 shellL; // hundredths, 92..110
    uint256 wingW; // hundredths, min(80..120, shellW * 110 / 100)
    uint256 wingL; // hundredths, 90..108
    uint8 density; // 0 fine, 1 standard, 2 bold
    uint8 halo; // 0 none, 1 ring, 2 double, 3 orbit
    uint8 palette; // 0 classic, 1 inverted, 2 ember, 3 mono
    uint256 bandW; // hundredths, 80..115
    uint8 rings; // 2..5
    uint256 orbitDeg; // tenths of a degree, 0..3600
    uint256 dSpan; // hundredths, 88..112
    uint256 dRise;
    uint256 dReach;
    uint256 dDrop;
    int8 dVeins; // -1..1
    int8 dSpots; // -1..1
    uint8 tier; // 0 holotype, 1 paratype, 2 series
}

struct Colours {
    string shell;
    string inner;
    string wing;
    string wing2;
    string vein;
    string band;
    string glow;
    string spots;
    string body;
}

interface IMetamorphFigure {
    function figure(Traits calldata t, SeatTraits calldata s, Colours calldata c, bytes32 seed) external pure returns (string memory);
}
```

- [ ] **Step 1: Write the mirror's trait half first** (`script/art/mirror.mjs`). It defines, in this order, exactly the arithmetic of the Global Constraints: `seed(seat, round, edition, line)` = `keccak256(encodeAbiParameters([uint256, uint16, uint16, uint256]))` with viem (`import { keccak256, encodeAbiParameters } from "../../site/node_modules/viem/index.js"` — check the exact resolvable path with `node -e` first; if the site's `node_modules` is absent, say so and run `npm install` in `site/`); `word(seed, k)`; `between`, `count`, `pick`, `bits`, `f1` on BigInt/Number as the spec defines them; `seatRng(seat)` (the site's 32-bit generator with BigInt or `Math.imul`/`>>> 0`, draws in the site's order); `seatTraits(seat)` returning tenths for the four lengths and the tilt, integers for the counts, the tone index; `cardTraits(seat, round, edition)` drawing words 0.. in the prototype's order (form, signal, tilt, scale, shellW, shellL, wingW, wingL, density, halo, palette, bandW, rings, orbitDeg, dSpan, dRise, dReach, dDrop, dVeins, dSpots); `colours(palette, gilt, toneIndex)`; `densityOf`. A `vectors` sub-command prints Solidity assertions for the spec's vector list (seats 1, 1376, 2345, 4096; cards (1376,0,1), (1376,0,2), (1376,1,303), (42,0,17); `f1` of −123, −4, 0, 7, 120, 1234; `bits` of two seeds at 30, 190, 320; `pick` at the boundaries) in the exact form the test in Step 3 consumes. Write `script/art/seatParity.mjs`: for seats 1..64 compare the mirror's integer seat traits with a verbatim JS copy of `site/lib/seat.ts`'s `rng` and `traits` (kept inside the script, commented "mirrors site/lib/seat.ts; keep in sync"); it must print 64 OK lines and exit 0.

- [ ] **Step 2: Run the mirror and the seat parity**

Run: `node script/art/mirror.mjs vectors > /tmp/vectors.txt && node script/art/seatParity.mjs`
Expected: the vectors print; seat parity prints 64 OK. If a seat's integer trait differs, the mirror's generator is wrong (the site's is the reference for integers), fix it.

- [ ] **Step 3: Write the failing Solidity tests** (`test/metamorph/art/ArtTraits.t.sol`): a harness contract exposing the library's functions; the tests paste the vectors from Step 2 (`assertEq` on every field for the four seats and the four cards; `f1` and `bits` and `pick` cases); `test_seatTraitsIntegerPartsMatchTheSite` restates the 64-seat integer parity for 8 of those seats with the numbers the parity script printed; `test_base64RoundTrips` encodes "", "f", "fo", "foo", "foob", "fooba", "foobar" to the RFC 4648 vectors and a 300-byte pseudo-random blob (compare to a vector the mirror prints with `Buffer.from(b).toString("base64")`).

- [ ] **Step 4: Run the tests to verify they fail**

Run: `forge test --match-path "test/metamorph/art/ArtTraits.t.sol" -vv`
Expected: compilation error (the library does not exist).

- [ ] **Step 5: Write the library** (`src/metamorph/art/ArtTraits.sol`) and `Base64.sol`. The core helpers, verbatim:

```solidity
// src/metamorph/art/ArtTraits.sol (the helpers; seatTraits/cardTraits/colours follow the spec's tables)
function seed(uint256 seat, uint16 round, uint16 edition, uint256 line) internal pure returns (bytes32) {
    return keccak256(abi.encode(seat, round, edition, line));
}

function word(bytes32 s, uint256 k) internal pure returns (uint32) {
    return uint32(uint256(keccak256(abi.encode(s, k / 8))) >> (32 * (k % 8)));
}

/// lo + u * (hi - lo) in `unit`ths, rounded half up.
function between(uint32 u_, int256 lo, int256 hi, uint256 unit) internal pure returns (int256) {
    return lo * int256(unit) + int256((uint256(u_) * uint256(hi - lo) * unit + (1 << 31)) >> 32);
}

function count(uint32 u_, uint256 n) internal pure returns (uint256) {
    return (uint256(u_) * n) >> 32;
}

function pick(uint32 u_, uint16[4] memory w) internal pure returns (uint8) {
    uint256 x = (uint256(u_) * 100) >> 32;
    for (uint8 k; k < 4; k++) {
        if (x < w[k]) return k;
        x -= w[k];
    }
    return 3;
}

function bits(bytes32 s, uint256 line, uint256 n) internal pure returns (string memory) {
    bytes memory out = new bytes(n);
    uint256 h;
    for (uint256 k; k < n; k++) {
        if (k % 256 == 0) {
            h = k == 0 ? uint256(keccak256(abi.encode(s, line))) : uint256(keccak256(abi.encode(s, line, k / 256)));
        }
        out[k] = ((h >> (255 - (k % 256))) & 1) == 1 ? bytes1("1") : bytes1("0");
    }
    return string(out);
}

/// Tenths as the prototype's f1 prints them: -12.3, 12, 0, -0.4.
function f1(int256 tenths) internal pure returns (string memory) {
    bool neg = tenths < 0;
    uint256 a = uint256(neg ? -tenths : tenths);
    string memory whole = u(a / 10);
    string memory s = a % 10 == 0 ? whole : string.concat(whole, ".", u(a % 10));
    return neg ? string.concat("-", s) : s;
}
```

`seatTraits`: run the site's generator (`uint32 a = uint32(seat * 2654435761)`; each draw: `a += 0x6d2b79f5; uint32 t = a; t = (t ^ (t >> 15)) * (t | 1); t ^= t + ((t ^ (t >> 7)) * (t | 61)); return t ^ (t >> 14);` all in `unchecked` uint32 arithmetic) in the site's order with `between(u, lo, hi, 10)` for span/rise/reach/drop/tilt and `count` for veins (3 + count(u, 3)), spots (count(u, 4)), dots (3 + count(u, 5)), rings (3 + count(u, 3)), tone (count(u, 4)). `cardTraits`: `bytes32 s = seed(seat, round, edition, 7)`, words 0, 1, 2 … in the order listed in Step 1, with the tables and ranges of the spec; `tier` from the edition. `colours`: the prototype's table with the brand constants; `gilt` overrides. `densityOf`: (19, 12, 12), (23, 15, 26), (28, 18, 42).

- [ ] **Step 6: Run the tests to verify they pass**

Run: `forge test --match-path "test/metamorph/art/ArtTraits.t.sol" -vv`
Expected: all pass. If a vector differs, the Solidity and the mirror disagree: find which one deviates from the spec's rule and fix THAT one (never edit a vector to pass).

- [ ] **Step 7: Commit**

```bash
git add src/interfaces/IMetamorphFigure.sol src/metamorph/art/ArtTraits.sol src/metamorph/art/Base64.sol script/art/mirror.mjs script/art/seatParity.mjs test/metamorph/art/ArtTraits.t.sol
git commit -m "art: the trait library and its JavaScript mirror; the seat generator matches the site"
```

---

### Task 2: The chrysalis figure

**Files:**
- Create: `src/metamorph/art/MetamorphChrysalis.sol`; extend `script/art/mirror.mjs` (`chrysalisFigure(t, c, seed)`)
- Test: `test/metamorph/art/Chrysalis.t.sol`

**Interfaces:**
- Produces: `MetamorphChrysalis.figure(Traits, SeatTraits, Colours, bytes32 seed) returns (string)` (ignores `SeatTraits`): the `<g transform=…>…</g>` string of the prototype's `chrysalisStage` with the minimal layout.

- [ ] **Step 1: Extend the mirror** with `chrysalisFigure(t, c, seed)` reproducing, in integer tenths, the prototype's `shellPath`, `wingPath`, `bandPath`, `shellDefs`, `segmentRings`, `chrysalisStage` and `figureGroup`. The prototype, to transcribe (every float becomes tenths, every `f1` the mirror's `f1`; `layout.shell × t.scale` → `(66 × scale + 50) / 100` tenths; `11 + 2.5 × shellL` → `110 + (25 × shellL + 50) / 100`; `tickY = 30 + 44 × wingL − 1` → `300 + (440 × wingL + 50) / 100 − 10` tenths; the segment ring `w = (14 − 3j) × shellW`, `y = 11 + (53 + 7j) × shellL` in tenths with the same rounding):

```js
// prototype (brand/previews/metamorph/metamorph-gen.mjs): the chrysalis, to be reproduced in integers
const FORMS = {
  teardrop: [[16, 7], [21, 27], [18, 47], [15, 64], [8, 77], [0, 82]],
  pear: [[9, 6], [19, 36], [20, 58], [17, 72], [9, 81], [0, 84]],
  spindle: [[8, 12], [14, 32], [14, 47], [12, 62], [6, 76], [0, 82]],
  round: [[20, 8], [23, 40], [17, 62], [12, 74], [6, 80], [0, 82]],
};
const BAND_FIT = { teardrop: 1, pear: 0.74, spindle: 0.66, round: 1.05 }; // hundredths: 100, 74, 66, 105
function shellPath(form, w, L, top = 11, cx = 32) {
  const p = FORMS[form];
  const y = (k) => f1(top + k * L), xl = (k) => f1(cx - k * w), xr = (k) => f1(cx + k * w);
  const left = `C${xl(p[0][0])} ${y(p[0][1])} ${xl(p[1][0])} ${y(p[1][1])} ${xl(p[2][0])} ${y(p[2][1])}C${xl(p[3][0])} ${y(p[3][1])} ${xl(p[4][0])} ${y(p[4][1])} ${cx} ${y(p[5][1])}`;
  const right = `C${xr(p[4][0])} ${y(p[4][1])} ${xr(p[3][0])} ${y(p[3][1])} ${xr(p[2][0])} ${y(p[2][1])}C${xr(p[1][0])} ${y(p[1][1])} ${xr(p[0][0])} ${y(p[0][1])} ${cx} ${f1(top)}`;
  return `M${cx} ${f1(top)}${left}${right}Z`;
}
function wingPath(ww, wl, top = 30, cx = 32) {
  const y = (k) => f1(top + k * wl), xl = (k) => f1(cx - k * ww), xr = (k) => f1(cx + k * ww);
  return `M${cx} ${f1(top)}C${xl(9)} ${y(10)} ${xl(13)} ${y(24)} ${xl(8)} ${y(44)}C${xl(4)} ${y(38)} ${xl(1)} ${y(31)} ${cx} ${y(24)}C${xr(1)} ${y(31)} ${xr(4)} ${y(38)} ${xr(8)} ${y(44)}C${xr(13)} ${y(24)} ${xr(9)} ${y(10)} ${cx} ${f1(top)}Z`;
}
const bandPath = (w) => `M${f1(32 - 13 * w)} 29C${f1(32 - 8 * w)} 26.4 ${f1(32 + 8 * w)} 26.4 ${f1(32 + 13 * w)} 29`;
const tp = (href, size, fill, text, more = "") => `<text font-size="${size}" fill="${fill}" ${more}><textPath href="#${href}">${text}</textPath></text>`;
function figureGroup(t, inner) { // layout.cx 540, cy 584, shell 6.6
  return `<g transform="translate(540 584) rotate(${f1(t.tilt)}) scale(${f1(6.6 * t.scale)}) translate(-32 -52)" font-family="Consolas, 'Courier New', monospace" letter-spacing="0.25">${inner}</g>`;
}
function shellDefs(t) {
  return `<defs><path id="shell" d="${shellPath(t.form, t.shellW, t.shellL)}"/><path id="shell2" d="${shellPath(t.form, t.shellW * 0.86, t.shellL * 0.93, 11 + 2.5 * t.shellL)}"/>` +
    `<path id="wing" d="${wingPath(t.wingW, t.wingL)}"/><path id="wing2" d="${wingPath(t.wingW * 0.73, t.wingL * 0.82, 34)}"/>` +
    `<path id="band" d="${bandPath(t.bandW * BAND_FIT[t.form] * t.shellW)}"/><path id="vein" d="M32 30v${f1(44 * t.wingL)}"/></defs>`;
}
function segmentRings(t, c) {
  let s = "";
  for (let j = 0; j < t.rings; j++) {
    const w = (14 - j * 3) * t.shellW, y = 11 + (53 + j * 7) * t.shellL;
    s += `<path d="M${f1(32 - w)} ${f1(y)}q${f1(w)} 4 ${f1(w * 2)} 0" stroke="${c.shell}" stroke-width="0.5" fill="none" opacity="0.45" stroke-dasharray="0.8 1.2"/>`;
  }
  return s;
}
function chrysalisStage(t, c, seed) { // d = DENSITY[t.density]; sizes d.outer * 0.9 etc. are tenths products rounded half up
  const d = DENSITY[t.density];
  const tickY = 30 + 44 * t.wingL - 1;
  return figureGroup(t,
    shellDefs(t) +
      tp("shell", d.outer, c.shell, bits(seed + 1, 190)) +
      tp("shell2", d.inner, c.inner, bits(seed + 2, 210), `opacity="0.45"`) +
      tp("wing", d.outer * 0.9, c.wing, bits(seed + 3, 130), `filter="url(#soft)"`) +
      tp("wing2", d.inner * 0.95, c.wing2, bits(seed + 4, 140), `opacity="0.55"`) +
      tp("vein", d.inner * 1.05, c.vein, bits(seed + 5, 40), `opacity="0.8"`) +
      tp("band", d.outer * 0.95, c.band, bits(seed + 6, 30)) +
      segmentRings(t, c) +
      `<path transform="translate(0 ${f1(tickY - 73)})" d="M${f1(32 - 7.5 * t.wingW)} 73c${f1(2 * t.wingW)}-3.6 ${f1(4.8 * t.wingW)}-6.6 ${f1(7.5 * t.wingW)}-9.4 ${f1(2.7 * t.wingW)} 2.8 ${f1(5.5 * t.wingW)} 5.8 ${f1(7.5 * t.wingW)} 9.4" stroke="${c.band}" stroke-width="0.9" fill="none" stroke-linecap="round"/>` +
      `<path d="M32 2v9" stroke="${c.shell}" stroke-width="0.8" fill="none"/>`,
  );
}
```

Rules for the transcription: the factor arguments (`t.shellW * 0.86` etc.) are hundredths products `(shellW × 86 + 50) / 100`, still hundredths; `xl(k)` with `k` an integer control point and `w` in hundredths gives tenths `320 − (k × w × 10 + 50) / 100`; `y(k)` with `L` in hundredths gives `top10 + (k × L × 10 + 50) / 100` where `top10` is the top in tenths (110, or the shell2 offset); the font sizes `d.outer * 0.9` are tenths `(outer × 90 + 50) / 100`; `bits(seed + k, n)` is `bits(seed, 11000 + k, n)` where `seed = seed(seat, round, edition, 11)`. Every division rounds half up (`+ half` before `/`), with the sign handled by computing on magnitudes (`xl` subtracts a positive quantity from 320). The mirror writes these exact expressions in BigInt; the Solidity repeats them.

- [ ] **Step 2: Write the failing test** (`test/metamorph/art/Chrysalis.t.sol`): deploy `MetamorphChrysalis`; for cards (1376,0,1) classic plain and (42,0,17) with gilt true, build `Traits`/`Colours` through a harness over `ArtTraits`, call `figure`, and `assertEq` the whole string with the mirror's output pasted from `node script/art/mirror.mjs figure chrysalis 1376 0 1 0` (add that sub-command: it prints the figure string). Keep the expected strings in the test as string literals (they are a few KB each; split with `string.concat` across lines if the compiler complains).

- [ ] **Step 3: Run the test to verify it fails**

Run: `forge test --match-path "test/metamorph/art/Chrysalis.t.sol" -vv`
Expected: compilation error (`MetamorphChrysalis` missing).

- [ ] **Step 4: Write `MetamorphChrysalis.sol`**: `contract MetamorphChrysalis is IMetamorphFigure` with `figure(...) external pure` building the string with `string.concat` in the exact order of the mirror; private pure helpers `_shellPath`, `_wingPath`, `_bandPath`, `_tp`, `_rings`; the `FORMS` table as constants; no storage.

- [ ] **Step 5: Run the test to verify it passes**, then the size check (`forge build --sizes 2>/dev/null | grep -i chrysalis`: must be under 24,576; if over, move the digit-string generation to the router by passing precomputed strings — say so in the report, do not change the output).

- [ ] **Step 6: Commit**

```bash
git add src/metamorph/art/MetamorphChrysalis.sol script/art/mirror.mjs test/metamorph/art/Chrysalis.t.sol
git commit -m "art: the chrysalis figure, byte for byte with the mirror"
```

---

### Task 3: The butterfly figure

**Files:**
- Create: `src/metamorph/art/MetamorphButterfly.sol`; extend `script/art/mirror.mjs` (`butterflyFigure(t, s, c, seed)`)
- Test: `test/metamorph/art/Butterfly.t.sol`

**Interfaces:**
- Produces: `MetamorphButterfly.figure(Traits, SeatTraits, Colours, bytes32 seed) returns (string)`: the prototype's `butterflyStage` group.

- [ ] **Step 1: Extend the mirror** with `butterflyFigure`. The prototype:

```js
// prototype: the butterfly (layout.cy + 12 = 596; layout.wings 2.2)
function butterflyStage(t, c, s, seed) {
  const span = s.span * t.dSpan, rise = s.rise * t.dRise, reach = s.reach * t.dReach, drop = s.drop * t.dDrop;
  const veins = clamp(s.veins + t.dVeins, 2, 6), spots = clamp(s.spots + t.dSpots, 0, 4);
  const upper = `M4 -22C${f1(4 + span * 0.45)} ${f1(-22 - rise)} ${f1(4 + span)} ${f1(-22 - rise * 0.95)} ${f1(4 + span)} ${f1(-22 - rise * 0.3)}C${f1(4 + span * 0.98)} -4 ${f1(4 + span * 0.55)} 16 4 10Z`;
  const lower = `M4 10C${f1(4 + reach * 0.9)} 6 ${f1(4 + reach * 1.1)} ${f1(10 + drop * 0.6)} ${f1(4 + reach * 0.5)} ${f1(10 + drop)}C${f1(4 + reach * 0.25)} ${f1(10 + drop * 0.92)} 10 ${f1(10 + drop * 0.5)} 4 30Z`;
  const ray = (x, y, deg, len) => { const a = (deg * Math.PI) / 180; return `M${x} ${y}L${f1(x + Math.cos(a) * len)} ${f1(y + Math.sin(a) * len)}`; };
  let lines = "";
  for (let i = 0; i < veins; i++) lines += `<path d="${ray(6, -8, -62 + (70 * i) / (veins - 1), span * 0.92)}" stroke="${c.vein}" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cu)"/>`;
  for (const deg of [22, 48, 74]) lines += `<path d="${ray(6, 16, deg, drop * 0.9)}" stroke="${c.vein}" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cl)"/>`;
  let dots = "";
  for (let i = 0; i < spots; i++) dots += `<circle cx="${f1(4 + span * (0.8 - i * 0.07))}" cy="${f1(-22 - rise * 0.62 + i * 17)}" r="${f1(5 - i * 0.6)}" fill="${c.spots}"/>`;
  const d = DENSITY[t.density];
  const half = `<g>` +
    `<text font-size="${f1(d.outer * 3.9)}" fill="${c.wing}" letter-spacing="0.6"><textPath href="#up">${bits(seed + 11, 120)}</textPath></text>` +
    `<text font-size="${f1(d.outer * 3.7)}" fill="${c.wing}" letter-spacing="0.6"><textPath href="#lo">${bits(seed + 12, 100)}</textPath></text>` +
    `<text font-size="${f1(d.inner * 3.7)}" fill="${c.inner}" opacity="0.35" letter-spacing="0.5"><textPath href="#up2">${bits(seed + 13, 140)}</textPath></text>` +
    lines + dots + `</g>`;
  return `<g transform="translate(540 596) rotate(${f1(t.tilt)}) scale(${f1(2.2 * t.scale)})" font-family="Consolas, 'Courier New', monospace">
<defs><path id="up" d="${upper}"/><path id="lo" d="${lower}"/><path id="up2" transform="translate(4 -6) scale(0.82)" d="${upper}"/>
<clipPath id="cu"><path d="${upper}"/></clipPath><clipPath id="cl"><path d="${lower}"/></clipPath><path id="body" d="M0 -36V40"/></defs>
${half}<g transform="scale(-1 1)">${half}</g>
<path d="M-2 -52C-8 -76 -22 -90 -32 -93M2 -52C8 -76 22 -90 32 -93" stroke="${c.body}" stroke-width="1.4" fill="none" stroke-linecap="round"/>
<circle cx="-32" cy="-93" r="2.2" fill="${c.body}"/><circle cx="32" cy="-93" r="2.2" fill="${c.body}"/>
<circle cx="0" cy="-48" r="6.5" fill="${c.body}"/><ellipse cx="0" cy="2" rx="5.5" ry="44" fill="${c.body}"/>
<text font-size="5.5" fill="#0b1410" letter-spacing="0.3" writing-mode="tb"><textPath href="#body">${bits(seed + 14, 14)}</textPath></text>
</g>`;
}
```

Transcription rules: `span = (s.span × dSpan + 50) / 100` tenths (and the others); products with the prototype's decimals are tenths products rounded half up (`span × 0.45` → `(span × 45 + 50) / 100`); the ray angles are integers after rounding half up (`-62 + (70 × i) / (veins − 1)` rounded to the nearest degree; for `veins == 1` the prototype divides by zero: `veins` is clamped to ≥ 2 so it cannot happen); `cos` and `sin` come from a `SIN` table of 91 entries, sin(0°)..sin(90°) in ten-thousandths (`0, 175, 349, 523, …, 10000`; generate it in the mirror with `Math.round(Math.sin(d × π / 180) × 10000)` and paste the same 91 numbers into the contract as a constant array), with `cos(a) = sin(90 − |a|)` and the signs by quadrant (angles here lie in −62..74 degrees, so `cos ≥ 0`, `sin` carries the sign); `x + cos × len` → tenths `x10 + (sinTable × len + 5000) / 10000` with the sign of the angle applied to the sine term; the spot circle `cx` uses `(0.8 − 0.07 i)` → `(span × (80 − 7i) + 50) / 100`, `cy` → `−220 − (rise × 62 + 50) / 100 + 170 × i`, `r` → `50 − 6 × i` tenths; font sizes `d.outer × 3.9` → `(outer × 39 + 5) / 10` tenths; the group scale `2.2 × scale` → `(22 × scale + 50) / 100` tenths.

- [ ] **Step 2: Write the failing test** (`test/metamorph/art/Butterfly.t.sol`) for cards (1376,0,1) plain and (2345,0,5) gilt with `node script/art/mirror.mjs figure butterfly …` output pasted, plus `test_sineTableMatchesTheMirror` (the 91 values the mirror prints with `node script/art/mirror.mjs sines`).

- [ ] **Step 3: Run the test to verify it fails**; **Step 4: write `MetamorphButterfly.sol`**; **Step 5: run the test to verify it passes** and the size check (`grep -i butterfly`).

- [ ] **Step 6: Commit**

```bash
git add src/metamorph/art/MetamorphButterfly.sol script/art/mirror.mjs test/metamorph/art/Butterfly.t.sol
git commit -m "art: the butterfly figure from the seat's geometry, byte for byte with the mirror"
```

---

### Task 4: The router: frame, labels, JSON, limits

**Files:**
- Create: `src/metamorph/art/MetamorphArt.sol`; extend `script/art/mirror.mjs` (`renderSVG(view)`, `tokenJSON(view)`, `tokenURI(view)`, `render` and `uri` sub-commands)
- Test: `test/metamorph/art/MetamorphArt.t.sol`, `test/metamorph/art/ArtSize.t.sol`, `test/metamorph/art/ArtThroughTheToken.t.sol`

**Interfaces:**
- Produces: `MetamorphArt(IMetamorphFigure chrysalis, IMetamorphFigure butterfly)` with immutables `CHRYSALIS`, `BUTTERFLY` (zero address refused: `ZeroAddress()`), `tokenURI(View) external view returns (string)` (view because it calls the figure contracts), `svg(View) public view returns (string)` and `json(View) public view returns (string)` (both public, so the page and the tests can read the parts).

- [ ] **Step 1: Extend the mirror** with the frame and the JSON. The prototype's `renderCard` for `labels = "minimal"`:

```js
// prototype: the frame and the labels (minimal layout: cx 540, cy 584, ring 306, inner 292, outer 330, orbit 338)
function halo(t, c, seed) {
  if (t.halo === "none") return "";
  const ring = (R, size, n, fill, op) =>
    `<path id="h${R}" d="M${540 - R} 584a${R} ${R} 0 1 1 ${2 * R} 0a${R} ${R} 0 1 1 ${-2 * R} 0" fill="none"/>` +
    `<text font-family="Consolas, 'Courier New', monospace" font-size="${size}" letter-spacing="2" fill="${fill}" opacity="${op}"><textPath href="#h${R}">${bits(seed + R, n)}</textPath></text>`;
  let s = "";
  if (t.halo === "ring" || t.halo === "orbit") s += ring(306, 14, 260, c.glow, 0.5);
  if (t.halo === "double") s += ring(292, 13, 250, c.glow, 0.5) + ring(330, 11, 320, "#9aa89f", 0.45);
  if (t.halo === "orbit") {
    const a = (t.orbitDeg * Math.PI) / 180;
    s += `<circle cx="540" cy="584" r="338" fill="none" stroke="#223029" stroke-width="1" stroke-dasharray="3 9"/>` +
      `<circle cx="${f1(540 + Math.cos(a) * 338)}" cy="${f1(584 + Math.sin(a) * 338)}" r="7" fill="#d9a94b"/>`;
  }
  return s;
}
// renderCard (minimal): grid, notes, signal, dots, edge, corner, figure, labels
let grid = ""; for (let i = 60; i < 1080; i += 60) grid += `<path d="M${i} 0V1080M0 ${i}H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>`;
let notes = "";
if (t.halo === "none" && v.stage !== "butterfly") for (let i = 0; i < 9; i++) { const y = 300 + i * 56; notes += `<path d="M300 ${y}H780" stroke="#223029" stroke-width="1" stroke-dasharray="2 6"/><text x="792" y="${y + 4}" font-family="Consolas, 'Courier New', monospace" font-size="12" fill="#9aa89f">${bits(seed + 100 + i, 6)}</text>`; }
const sig = (x, y, n, rot) => `<text x="${x}" y="${y}" font-family="Consolas, 'Courier New', monospace" font-size="13" letter-spacing="1" fill="#9aa89f" opacity="0.5"${rot ? ` transform="rotate(90 ${x} ${y})"` : ""}>${bits(seed + 200 + x + y, n)}</text>`;
let signal = "";
if (t.signal === "column") signal = sig(150, 250, 56, true) + sig(176, 250, 56, true);
else if (t.signal === "band") signal = sig(92, 826, 92, false) + sig(92, 844, 92, false);
else if (t.signal === "rain") { const rr = rng(seed + 300); for (let i = 0; i < 9; i++) signal += sig(100 + Math.floor(rr() * 860), 240 + Math.floor(rr() * 420), 8 + Math.floor(rr() * 14), true); }
const r = rng(seed + 50); let dots = "";
for (let i = 0; i < d.dots; i++) { const x = 90 + Math.floor(r() * 900), y = 240 + Math.floor(r() * 600); dots += `<circle cx="${x}" cy="${y}" r="${f1(1.5 + r() * 1.2)}" fill="${c.glow}" opacity="${f1(0.4 + r() * 0.4)}" filter="url(#glow)"/>`; }
const edge = t.tier === "holotype" ? `<rect x="48" y="48" width="984" height="984" fill="none" stroke="#d9a94b" stroke-width="3"/><rect x="60" y="60" width="960" height="960" fill="none" stroke="#d9a94b" stroke-width="1" opacity="0.6"/>` : `<rect x="48" y="48" width="984" height="984" fill="none" stroke="#223029" stroke-width="2"/>`;
const corner = t.tier === "paratype" ? `<path d="M1032 1002V1032H1002" fill="none" stroke="#d9a94b" stroke-width="4"/><path d="M48 78V48H78" fill="none" stroke="#e9e6da" stroke-width="4"/>` : `<path d="M48 78V48H78M1032 1002V1032H1002" fill="none" stroke="#e9e6da" stroke-width="4"/>`;
const labelColor = v.stage === "butterfly" ? "#d9a94b" : "#3ec28f";
const text = `<text x="92" y="122" font-family="Consolas, 'Courier New', monospace" font-size="24" letter-spacing="3" fill="#9aa89f">METAMORPH.MD · PUPATE</text>
<text x="92" y="204" font-family="Georgia, 'Times New Roman', serif" font-size="76" fill="#e9e6da">#${v.id}</text>
<text x="988" y="122" font-family="Consolas, 'Courier New', monospace" font-size="24" letter-spacing="3" text-anchor="end" fill="${labelColor}">${v.stage === "butterfly" ? "EMERGED" : "IN THE COCOON"}${v.gilt ? " · GILT" : ""}</text>` +
  `<text x="92" y="984" font-family="Consolas, 'Courier New', monospace" font-size="24" letter-spacing="2" fill="#9aa89f">seat identity.md #${v.seat} · edition ${v.edition} of 303</text>`;
return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1080" width="1080" height="1080">
<defs>
  <filter id="glow" x="-200%" y="-200%" width="500%" height="500%"><feGaussianBlur stdDeviation="1.6"/></filter>
  <filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="0.6"/></filter>
</defs>
<rect width="1080" height="1080" fill="#0b1410"/>
${grid}${edge}${corner}${notes}${signal}${halo(t, c, seed)}${dots}
${figure}
${text}
</svg>`;
```

Rules: the "rng" draws of the rain and the dots (`rng(seed + 300)`, `rng(seed + 50)`) become `word(seed, k)` sequences on seed lines 11300 and 11050 (k = 0, 1, 2 …) with `count` for the floors and `between(u, 15, 27, 10)` / `between(u, 4, 8, 10)` for the dot radius and opacity (tenths; the prototype's `1.5 + r × 1.2` and `0.4 + r × 0.4`); the halo's digit lines are `11000 + R`; the orbit dot uses the sine table (angle = `orbitDeg / 10` rounded to the nearest degree; the quadrant rule for 0..360). The `·` (middle dot) is UTF-8 `\xc2\xb7`: write it in Solidity as `unicode"·"` and in the mirror as the character; the base64 covers the whole SVG so no escaping is needed. The JSON per the spec; numbers as decimals; the miner lowercase hex with `0x`; the description sentence; the attributes list in the spec's order.

- [ ] **Step 2: Write the failing tests**: `MetamorphArt.t.sol` (`test_svgMatchesTheMirror` for the two cards of Tasks 2 and 3 in both stages: paste `node script/art/mirror.mjs render …`; `test_jsonIsWellFormed`: decode the base64 with a test helper (write a small decoder in the test), check the prefix `data:application/json;base64,`, the name, the description, every attribute, and that the image is `data:image/svg+xml;base64,` + the base64 of `svg(view)`; `test_sameViewSameBytes`; `test_twoCardsOfOneSeatDiffer`; `test_giltChangesOnlyColoursAndLabel`; `test_oddViewsStillRender` (seat 0, edition 0, stage 7); `test_worstCaseStaysUnderTheLimits` (the mirror's `worst` sub-command searches seeds for a card with bold, double halo, rain, a butterfly with 6 veins and 4 spots, holotype; print its (seat, round, edition); assert gas < 20,000,000 with `gasleft()` around the call, SVG length < 24,576 and JSON length < 40,960)); `ArtSize.t.sol` (three contracts under 24,576 runtime bytes); `ArtThroughTheToken.t.sol` (the fixture with the real art: override `_deploy` or build the fixture with `new MetamorphArt(new MetamorphChrysalis(), new MetamorphButterfly())`, mint, `md.tokenURI(1)` decodes to the right name and a `<svg` image; sell the seat and read the butterfly).

- [ ] **Step 3: Run the tests to verify they fail**; **Step 4: write `MetamorphArt.sol`** (`contract MetamorphArt is IMetamorphArt`; `error ZeroAddress()`; constructor; `tokenURI` → `string.concat("data:application/json;base64,", Base64.encode(bytes(json(v))))`; `json` builds the JSON with the image = `"data:image/svg+xml;base64," + Base64.encode(bytes(svg(v)))`; `svg` assembles the frame around `figure`; private pure helpers for the grid, notes, signal, halo, dots, edge, corner, labels, attributes); **Step 5: run all art suites and sizes**; if `MetamorphArt` is over the limit, move the halo and signal into a third figure-like contract `MetamorphFrame` (same interface shape) and record it in the report.

- [ ] **Step 6: Commit**

```bash
git add src/metamorph/art/MetamorphArt.sol script/art/mirror.mjs test/metamorph/art/MetamorphArt.t.sol test/metamorph/art/ArtSize.t.sol test/metamorph/art/ArtThroughTheToken.t.sol
git commit -m "art: the card's frame, labels and JSON; the token returns a finished card"
```

---

### Task 5: Parity on anvil, the deploy script, the runbook

**Files:**
- Create: `script/art/parity.mjs`, `script/DeployMetamorphArt.s.sol`
- Modify: `script/mainnet/README.md` ("Metamorph MD": the art step before the token), `docs/superpowers/specs/2026-10-13-metamorph-md-design.md` (errata: the art is three contracts; the address-book keys are `metamorph` and `metamorphArt`), `.gitignore` (`out/art/` if `out/` is not already ignored)

- [ ] **Step 1: The deploy script** (`script/DeployMetamorphArt.s.sol`, the house pattern of `script/DeployMetamorph.s.sol`): `vm.startBroadcast()`; `new MetamorphChrysalis()`; `new MetamorphButterfly()`; `new MetamorphArt(chrysalis, butterfly)`; `vm.stopBroadcast()`; `console2.log` the three addresses and the length of `art.tokenURI(sample)` for a sample `View` (id 1, seat 1376, round 0, edition 1, stage 0, gilt false, epoch 1, miner the sender, mintedAt block.timestamp, paid 50_000 ether).

- [ ] **Step 2: The parity script** (`script/art/parity.mjs`): spawn `anvil --port 8546 --silent`; wait for the port; run `forge script script/DeployMetamorphArt.s.sol --rpc-url http://127.0.0.1:8546 --broadcast --private-key <anvil's first default key, hard-coded with a comment that it is anvil's public test key>`; parse the router address from the logs; choose the sample with the mirror's `sample` sub-command (24 cards covering every form, halo, signal, density, palette, both stages, gilt and plain, the three tiers; assert the coverage); for each, call `tokenURI(View)` with viem (`eth_call` with gas 30,000,000 and `estimateGas` recorded), decode the base64 JSON, compare `svg` with the mirror's `renderSVG` byte for byte and the JSON with `tokenJSON`, parse the SVG as XML (a strict, dependency-free check: a tiny recursive descent over tags, attributes and entities is enough; or `new DOMParser` if `jsdom` is already in the site's `node_modules`, else the tiny check), write the SVG to `out/art/<seat>-<round>-<edition>-<stage>[-gilt].svg`, print a table (card, gas, bytes, ok); kill anvil; exit non-zero on any mismatch.

- [ ] **Step 3: Run it**

Run: `node script/art/parity.mjs`
Expected: 24 OK rows, every gas under 20M, the SVGs in `out/art/`. Then rasterise a few with the prototype's thumbnail script if Edge is available (`node brand/previews/metamorph/metamorph-thumbs-edge.mjs` reads a directory; if it cannot take `out/art/`, write a 10-line variant under `script/art/thumbs.mjs`) and look at them: the report must say what you saw (shapes, digits legible, labels placed).

- [ ] **Step 4: The runbook and the errata**: README "Metamorph MD" gains "1. Deploy the art: `forge script script/DeployMetamorphArt.s.sol --rpc-url "$MAINNET_RPC_URL" --broadcast --private-key "$KEEPER_PRIVATE_KEY"` (simulate first without `--broadcast`), record `metamorphArt` (the router) and pass it as `ART` to `DeployMetamorph`"; the main spec's errata: the art is three keyless contracts (`MetamorphArt` + two figures), the address-book keys are `metamorph` and `metamorphArt`, the palette table drops the prototype's gilt entry (gilt from the proof only), the seat traits are integer tenths (the site's generator kept for the integers), egg and larva are client-side.

- [ ] **Step 5: Commit**

```bash
git add script/art/parity.mjs script/DeployMetamorphArt.s.sol script/mainnet/README.md docs/superpowers/specs/2026-10-13-metamorph-md-design.md .gitignore
git commit -m "art: parity on anvil, the deploy script and the runbook step"
```

---

## Self-review (done while writing)

- Spec coverage: determinism ✓ (T1), seat parity ✓ (T1), chrysalis ✓ (T2), butterfly ✓ (T3), frame + labels + JSON ✓ (T4), limits ✓ (T4), through the token ✓ (T4), parity on anvil ✓ (T5), deploy + runbook ✓ (T5), the owner's eye ✓ (T5 thumbnails).
- Type consistency: `IMetamorphFigure.figure(Traits, SeatTraits, Colours, bytes32)` for both figures; `ArtTraits` names as listed in Task 1; `MetamorphArt.tokenURI/svg/json(View)`.
- Review Focus 1–5 pinned: T1 seat integer parity; T4 worst case; T4 odd views; T4 JSON; T5 coverage assertion.
- Not in this plan: the site's rendering of owned cards (page plan), egg/larva (client-side), the work-feed attribute.
