# Metamorph MD art: the on-chain renderer

Design, 2026-10-14. The art contract `MetamorphMD` reads through `IMetamorphArt.tokenURI(View)`: the whole token URI, JSON with the SVG inside, drawn from the card's facts alone. This document is the authority for the renderer; the main spec (`2026-10-13-metamorph-md-design.md`, sections "The drawing" and "Rarity") says what the card looks like and this one says how the chain draws it. The design reference is `brand/previews/metamorph/metamorph-gen.mjs` (untracked, the owner's prototype): the drawing must look like it, card for card, and the JavaScript mirror in the repo (`script/art/mirror.mjs`) is rewritten from the contract so that the site and the chain draw the same bytes. Where the prototype and this document differ, this document wins; the prototype is a picture, the contract is the law.

The owner approved the direction on 2026-10-14 ("eksekusi langsung") and left the details to the controller; every decision below is recorded in the implementation ledger as a ruling the owner can reverse before deployment. Nothing is deployed before the owner reads the rendered cards.

## Why

A card is mined, never uploaded. The seat it belongs to, its edition, its proof (gilt or not), its epoch and its stage are facts on the chain; the drawing is a function of those facts and nothing else, so no server, no IPFS and no key can change what a card is. The renderer is a separate contract from the token for one reason: `MetamorphMD` must stay under the size limit with its mining, staking and conversion code, and the art needs a budget of its own. Nothing can be swapped later: `ART` is immutable in the token, and the art contracts have no owner and no setter either. If the drawing is wrong at deployment, the collection is wrong forever; hence the parity tests below.

## What is built

| Contract or file | Responsibility |
|---|---|
| `src/metamorph/art/MetamorphArt.sol` | implements `IMetamorphArt`: derives the traits, draws the frame (grid, edge, corner, notes, signal, halo, dots, labels), calls the figure contract for the stage, assembles the SVG and the JSON, base64-encodes both, returns `data:application/json;base64,...` |
| `src/metamorph/art/MetamorphChrysalis.sol` | `figure(Traits, Colours, seed) returns (string)`: the chrysalis group (shell, inner shell, wing, inner wing, vein, band, segment rings, ticks, the stem) |
| `src/metamorph/art/MetamorphButterfly.sol` | `figure(Traits, SeatTraits, Colours, seed) returns (string)`: the open wings, veins, spots, the digit washes, the body and antennae |
| `src/metamorph/art/ArtTraits.sol` | internal library: the integer random generator, the seat traits, the card traits, the palette, the bit strings, the number formatter |
| `src/metamorph/art/Base64.sol` | internal library: standard base64 with padding, no dependency |
| `src/interfaces/IMetamorphFigure.sol` | the figure contracts' interface and the shared structs (`Traits`, `SeatTraits`, `Colours`) |
| `script/DeployMetamorphArt.s.sol` | deploys the two figure contracts then `MetamorphArt` with their addresses; prints the three addresses; `DeployMetamorph` takes the router as `ART` |
| `script/art/mirror.mjs` | the JavaScript mirror of the contract: the same integer arithmetic, the same strings; renders a card from the same facts (used by the parity test, the site's previews and the thumbnails) |
| `script/art/parity.mjs` | starts anvil, deploys the art, calls `tokenURI` for a sample of cards through `eth_call`, decodes the data URIs, compares the SVG and JSON byte for byte with the mirror, checks every SVG parses as XML, measures gas per call, writes the SVGs to `out/art/` for the eye |
| `test/metamorph/art/*.t.sol` | unit tests on vectors the mirror produced, size tests, gas tests, determinism tests, and the token's `tokenURI` through the real art |

The token contract is not changed. The fixture keeps `StubArt` for the token suites; one new suite deploys the real art behind the token and reads `tokenURI`.

## The facts a card is drawn from

`IMetamorphArt.View`: `id`, `seat`, `round`, `edition`, `stage` (0 chrysalis, 1 butterfly), `gilt`, `epoch`, `miner`, `mintedAt`, `paid` (PUPATE wei). The drawing uses `id`, `seat`, `round`, `edition`, `stage`, `gilt`; the JSON uses all of them.

## Determinism: seeds, the generator, fixed point

- **Seeds are keccak.** `seed(seat, round, edition, line) = keccak256(abi.encode(seat, round, edition, line))` with `line` a small constant naming what the seed is for (the prototype's `mix(seat, round, edition, 7)` for the card traits and `mix(..., 11)` for the drawing become lines 7 and 11; every `seed + k` of the prototype becomes line `11 × 1000 + k`, so no two uses collide). A seed never depends on the miner, the price or the time: the same card always draws the same.
- **A 32-bit draw from a seed.** `word(seed, k) = uint32(uint256(keccak256(abi.encode(seed, k / 8))) >> (32 × (k % 8)))`: the k-th 32-bit word, eight per hash. A trait generator draws words 0, 1, 2, … in the order the prototype calls `r()`.
- **The seat generator is the site's.** `seatTraits(seat)` reproduces `site/lib/seat.ts` exactly for every integer it produces (veins, spots, dots, rings, the tone index) by running the same 32-bit arithmetic: `a = seat × 2654435761 mod 2^32`; each draw does `a = a + 0x6d2b79f5 mod 2^32; t = a; t = (t ^ (t >> 15)) × (t | 1) mod 2^32; t = t ^ (t + ((t ^ (t >> 7)) × (t | 61) mod 2^32)) mod 2^32; u = (t ^ (t >> 14)) mod 2^32`; the JavaScript divides `u` by 2^32 to get a float; the contract keeps `u`. The seat traits are drawn in the prototype's order: span, rise, reach, drop, veins, spots, dots, rings, tilt, tone.
- **Fixed point: tenths.** Every geometric quantity the prototype formats with `f1` (one decimal) is an integer number of tenths in the contract. A float range `between(lo, hi)` becomes `tenths = lo × 10 + round(u × (hi − lo) × 10 / 2^32)` with round half up, computed as `(u × (hi − lo) × 10 + 2^31) >> 32`. Ratios the prototype keeps as unit-less factors (`scale`, `shellW`, `shellL`, `wingW`, `wingL`, `bandW`, `dSpan`, `dRise`, `dReach`, `dDrop`) are integers in hundredths, drawn the same way with `× 100`. Angles (`tilt`, `orbitDeg`) are tenths of a degree. Integer counts (`veins`, `spots`, `dots`, `rings`, `rings` of the segment lines, the `dVeins`/`dSpots` deltas) are `floor(u × n / 2^32)` where the prototype has `Math.floor(r() × n)`.
- **Products of factors.** Where the prototype multiplies factors and a base length (for instance `t.shellW × 0.86` or `layout.shell × t.scale`), the contract multiplies the integers and divides once at the end, rounding half up, so that the printed value is the nearest tenth. The order of operations is the order the prototype uses, left to right; the mirror copies it from the contract, not from the prototype.
- **The formatter.** `f1(tenths)` prints `-12.3`, `12.3`, `12` (no trailing `.0`), `0`, `-0.4`; this is what `(Math.round(v × 10) / 10).toString()` prints. Integers print as decimal with no sign for zero.
- **Weighted picks.** `pick(u, table)` with `x = (u × total) >> 32`, then walk the table subtracting weights, returning the first entry where `x < w`. The tables and the weights are the main spec's, verbatim; the prototype's `gilt` palette entry is dropped (gilt comes from the proof, never from the seed): form teardrop 40, pear 22, spindle 22, round 16; signal none 45, column 25, band 20, rain 10; density fine 30, standard 50, bold 20; halo none 50, ring 30, double 15, orbit 5; palette classic 58, inverted 20, ember 12, mono 10.
- **Bit strings.** `bits(seed, line, n)`: the first `n` bits of `keccak256(abi.encode(seed, line))`, then of `keccak256(abi.encode(seed, line, 1))`, `(…, 2)` and so on when `n > 256`, most significant bit first, written as the characters `0` and `1`. The prototype's `bits(seed + k, n)` becomes `bits(seed, k, n)` with the same `n`.

## The traits

**Per seat** (`SeatTraits`, from `seatTraits(seat)`): `span` 118–152, `rise` 92–124, `reach` 78–104, `drop` 84–118 (tenths), `veins` 3–5, `spots` 0–3, `dots` 3–7, `rings` 3–5, `tilt` −5–5 (tenths of a degree), `tone` one of the four jades `#3ec28f`, `#2aa87a`, `#5fd0a3`, `#37b59a`.

**Per edition** (`Traits`, from `cardTraits(seat, round, edition)`, seed line 7, draws in this order): `form`, `signal`, `tilt` −12–12 (tenths of a degree), `scale` 90–110 (hundredths), `shellW` 85–120, `shellL` 92–110, `wingW` = min(draw 80–120, `shellW × 110 / 100`), `wingL` 90–108, `density`, `halo`, `palette`, `bandW` 80–115, `rings` 2–5 (segment lines), `orbitDeg` 0–3600 (tenths), `dSpan`, `dRise`, `dReach`, `dDrop` 88–112, `dVeins` −1–1, `dSpots` −1–1. `tier`: holotype for edition 1, paratype for 2–33, series otherwise.

**Colours** (`Colours`, from the palette and the seat's tone; `gilt` overrides the palette with the prototype's gilt set: shell gold, inner gold, wing tone, wing2 tone, vein tone, band ivory, glow gold, spots ivory, body gold): the prototype's `colours(palette, tone)` table, verbatim. The brand constants: paper `#0b1410`, ink `#e9e6da`, dim `#9aa89f`, hair `#223029`, jade `#3ec28f`, gold `#d9a94b`.

**Density**: fine outer 1.9 inner 1.2 dots 12; standard 2.3 / 1.5 / 26; bold 2.8 / 1.8 / 42 (font sizes in tenths: 19, 12; 23, 15; 28, 18).

## The drawing

The SVG is the prototype's `renderCard(v)` with `labels = "minimal"` and the layout `{ cx 540, cy 584, shell 6.6, wings 2.2, ring 306, inner 292, outer 330, orbit 338 }`, 1080 × 1080, in this order: the two filters (`glow`, `soft`), the paper, the grid (every 60 px), the edge (double gold frame for the holotype, hairline otherwise), the corners (gold corner for the paratype), the notes (nine dashed lines with six-digit labels, only when the halo is none and the stage is not the butterfly), the signal (column, band or rain; rain places nine digit runs by a generator on seed line 300), the halo (ring, double or orbit), the glow dots (count by density, placed by a generator on seed line 50), the figure, the labels. The labels: `METAMORPH.MD · PUPATE` top left, `#<id>` large under it, the stage label top right (`IN THE COCOON` jade or `EMERGED` gold, with ` · GILT` appended for a gilt card), and one line at the bottom, `seat identity.md #<seat> · edition <e> of 303`. Fonts: `Consolas, 'Courier New', monospace` for digits and labels, `Georgia, 'Times New Roman', serif` for the number.

**The chrysalis figure** is the prototype's `chrysalisStage`: the group transform `translate(540 584) rotate(tilt) scale(6.6 × scale) translate(-32 -52)`, the defs (shell path by form with `shellW`/`shellL`, the inner shell at 0.86 / 0.93 offset `11 + 2.5 × shellL`, the wing and inner wing, the band, the vein), the six text paths with their digit strings (lines 1–6 with 190, 210, 130, 140, 40, 30 bits), the segment rings, the gold ticks, the stem. The four shell forms' control points are the prototype's `FORMS` table and `BAND_FIT`.

**The butterfly figure** is the prototype's `butterflyStage`: the seat's geometry scaled by the edition's deltas (`span × dSpan` and so on, in tenths), `veins` and `spots` clamped after the deltas (2–6, 0–4), the upper and lower wing paths, the vein rays (`cos`/`sin` of the ray angles become a 90-entry table of sines in ten-thousandths, one per degree, with the angles rounded to the nearest degree), the gold spots, the three digit washes (lines 11–13; 120, 100, 140 bits), the mirrored half, the antennae, the body with its fourteen-bit digit string (line 14).

The egg and larva stages of the prototype are not on the chain: the token has two stages. The site's incubator draws the search client-side.

## The JSON

```
{"name":"Metamorph.md #<id>","description":"Seat identity.md #<seat>, edition <e> of 303, <stage sentence>.","image":"data:image/svg+xml;base64,<svg>","attributes":[...]}
```

The stage sentence: `in the cocoon` or `emerged`; a gilt card adds `, a gilt proof`. Attributes (`trait_type`/`value`, strings unless noted): Seat, Round (number), Edition (number), Stage (`Chrysalis`/`Butterfly`), Gilt (`Yes`/`No`), Epoch (number), Miner (the checksummed address is not computed on-chain: the lowercase hex address), Price paid (PUPATE) (number, whole tokens, `paid / 1e18` rounded down), Tier (`Holotype`/`Paratype`/`Series`), Form, Palette (`Gilt` when gilt), Halo, Signal, Density, Tone (the hex colour). Values are capitalised as the main spec lists them. The whole JSON is base64 inside `data:application/json;base64,`.

## Limits

- Each of the three contracts under 24,576 bytes of runtime code; a size test pins each.
- `tokenURI` for either stage under 20,000,000 gas (an `eth_call` cap of 50M is common; the fork test and the site use `eth_call`); a gas test pins both stages at the worst case the tests can construct (bold density, double halo, rain signal, a butterfly with six veins and four spots).
- The SVG under 24 KB; the JSON under 40 KB.
- No external resources, no scripts, no fonts embedded: `textPath` with `href`, `filter` with `feGaussianBlur`, `clipPath`, standard attributes only.

## Testing

- **Vectors from the mirror.** The mirror is written first from this document (it is the smaller program), then the contract. `test/metamorph/art/ArtTraits.t.sol` pins `seatTraits` for seats 1, 1376, 2345 and 4096 and `cardTraits` for (1376, 0, 1), (1376, 0, 2), (1376, 1, 303), (42, 0, 17) against the mirror's numbers, every field; `f1` for −123, −4, 0, 7, 120, 1234; `bits` for two seeds at 30, 190 and 320 bits; `pick` at the table boundaries.
- **Site parity for the seat.** The integer parts of `seatTraits` (veins, spots, dots, rings, tone) equal `site/lib/seat.ts`'s `traits(seat)` for 64 seats (the mirror runs the site's generator and the contract's side by side).
- **Determinism.** The same `View` twice gives the same bytes; two cards of one seat differ; the gilt flag changes only the colours and the label; the stage changes the figure and the label colour.
- **Through the token.** A suite deploys the real art behind `MetamorphMD` on the fixture, mints, reads `tokenURI`, decodes the base64 JSON, checks the name, the attributes and that the image is a base64 SVG starting with `<svg`.
- **Size and gas** as in Limits.
- **Parity on anvil** (`script/art/parity.mjs`, run by hand and before deployment): for a sample of 24 cards (both stages, gilt and plain, the three tiers, every form, halo, signal, density and palette at least once), the contract's SVG and JSON equal the mirror's byte for byte; every SVG parses as XML; the gas per call is printed; the SVGs land in `out/art/` and the thumbnail script of the prototype can rasterise them for the owner's eye.
- **Before broadcast.** The deploy script's dry run calls `tokenURI` on a sample `View` and prints its length; the owner looks at the rendered sample.

## Deployment

`script/DeployMetamorphArt.s.sol` deploys `MetamorphChrysalis`, `MetamorphButterfly`, then `MetamorphArt(chrysalis, butterfly)`, prints the three addresses and a sample `tokenURI` length; `script/mainnet/README.md`'s "Metamorph MD" section gains the step before `DeployMetamorph` (`ART` = the router). `keeper/addresses.mainnet.json` and `site/lib/addresses.ts` record `metamorphArt` (the router) besides `metamorph` (the token). No keys anywhere.

## Out of scope

The site's "your cards" page (the page plan reads `tokenURI` and shows the image); the incubator's egg and larva drawings (client-side, from the sample digest); the work-feed attribute (later contract); any change to the token contract.
