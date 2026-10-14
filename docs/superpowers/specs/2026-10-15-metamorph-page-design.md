# Metamorph MD on the site and in the keeper: the live mine, the workspace, the duties

Design, 2026-10-15. The third and last plan of Metamorph MD: the mine page runs against the real contracts, the visitor's cards get their page, and the keeper takes the duties the contract left to it. The main spec's section "What the visitor sees and does" (`2026-10-13-metamorph-md-design.md`) is the binding description of the surface; "The miner, underneath the page" is the binding description of the miner; this document says how the site and the keeper do it with the contracts as built (`MetamorphMD` at `src/metamorph/MetamorphMD.sol`, the art at `src/metamorph/art/`, both merged and reviewed). The owner approved autonomous execution on 2026-10-14; every decision below is a ruling the owner can reverse before the site is deployed to pupate.fun.

## Why

The contracts can live before the first seat, and the page is what makes them usable: it hands the miner the right job, sends the mint with enough gas for the vault's duties, shows the visitor what they own, and lets them stake and claim without a word of the mechanism. The keeper does what no visitor should have to: it notes the vault's seats so cards can be mined, forgets sold ones, converts the pot when no mint is cheap enough to, and pokes staked cards that emerged so their weight and their image follow.

## What is built

| Area | Files | Responsibility |
|---|---|---|
| Addresses | `site/lib/addresses.ts`, `keeper/addresses.mainnet.json`, `script/local/up.mjs` | `metamorph` and `metamorphArt` next to the others (optional on a chain until deployed); the local fork deploys the art and the token too and publishes their addresses, so the page and the keeper run live on anvil |
| ABI | `site/lib/metamorph/abi.ts` | the subset of `MetamorphMD` and `MetamorphArt` the page reads and writes (viem `parseAbi`), one source for the page and the keeper (`keeper/lib/abi.mjs` gets the same strings) |
| Live jobs | `site/lib/metamorph/job.ts` (new), `site/lib/miner/job.ts` (extended), `site/lib/miner/useMiner.ts` | a `MinerJob` from the chain: `DOMAIN`, chainId, the contract, `folded = keccak256(abi.encode(anchorHash, prevWork))`, the miner, the target words from `effectiveTarget()`; polling every three seconds; rebuild when `prevWork` or the target changed or the anchor is within ten blocks of expiring; auto-mint; the race loser; the duty note |
| The mint | `site/lib/metamorph/mint.ts` | the PUPATE approval (once, `type(uint256).max`), the balance and price check, `mint(anchor, nonce)` with the gas limit = the estimate + 400,000 per due flush or burn + 1,000,000 for a due conversion (read from `dutiesDue()`), the receipt parsed for `Minted` and `DutyRun`, the log lines |
| The numbers | `site/lib/metamorph/live.ts`, `site/components/Mine.tsx` | minted, epoch, price, difficulty as "≈ N hashes" from `effectiveTarget()`, network rate (mints over the last hour × the expected hashes per mint ÷ seconds), percent minted, seconds since the last mint; "Ready. Nothing to mine until the vault holds a seat" when `mineableSeats()` is empty |
| The workspace | `site/app/cards/page.tsx` (new route `/cards`), `site/components/Workspace.tsx`, `site/components/CardTile.tsx`, `site/lib/metamorph/cards.ts` | the visitor's cards from `Transfer` events (to and from the wallet, folded into the current set), each with its live image (`tokenURI` through the token, decoded, cached per id and stage in memory and `localStorage`), its stage label (in the cocoon / emerged) and gilt mark; selection; Stake, Unstake, Claim IMD; "IMD earned, not claimed" = `pendingIMD(wallet)` + the unsettled share of each staked card (`weight × accIMDPerWeight − debt` ÷ 1e18); the one sentence; the gallery of every minted card (from `Minted` events, images lazy); the leaderboard (miners by cards, from `Minted`) |
| The seat drawing | `site/lib/seat.ts` | `traits(seat)` ported to the contract's integer tenths (the mirror's `seatTraits`), so the seat pages, the emergence card and the chain draw the same butterfly; the integers were already equal |
| The keeper | `keeper/lib/metamorph.mjs` (new), `keeper/lib/actions.mjs`, `keeper/bin/keeper.mjs`, `keeper/README.md` | duties with decision/action pairs like the others: `noteSeats` (replay `SeatBought`/`SeatAdopted` minus `SeatSold`, note each held seat not yet noted), `forgetSeats` (forget noted seats the vault no longer holds), `convert` (when the pot holds at least `CONVERT_PRICES / 5` mint prices or `ethPot != 0`, past the spacing, under the gas cap; padded gas), `poke` (staked cards whose `stageOf` no longer matches their stake weight); the status feed gains the mine's numbers |
| Copy | `site/components/Mine.tsx`, `site/components/How.tsx` or the docs page | the title "Clock in.", the sentence (reworded without "target": *Your machine searches for a hash with enough leading zeros. Find one, pay the mint in PUPATE, and the hash picks which seat your card comes from. Lucky hashes come out gilt.*), the four steps, the log lines of the spec, the workspace sentence |
| Tests | `site/scripts/*.mjs`, `keeper/test/*`, `script/local/*` | pure-logic checks in Node (the job builder against `workHash`, the gas padding, the pending-IMD formula, the Transfer folding), the keeper's duties against a local anvil with the full stack, the page driven in headless Edge against the same anvil for one practice-to-live mint |

## Live mode, step by step

1. **Readiness.** The page reads `notedSeats()` and `mineableSeats()`; with none mineable it shows the ready state and keeps the practice run available. With the contracts absent from `addresses.ts` for the chain, the page stays in preview mode as today.
2. **The job.** Every three seconds (and at once after a mint): `prevWork()`, `effectiveTarget()`, the newest usable anchor (`block.number − 1`; the anchor's hash from `anchorHash(n)` on the contract, so the page never computes a blockhash itself), `DOMAIN()` once. `folded = keccak256(abi.encode(anchorHash, prevWork))` (the contract's `workHash` folds the same way; a Node check pins it against `workHash` on anvil). The target words are the top 64 bits of `effectiveTarget()`; the practice target is not used live. The job is rebuilt when `prevWork` changed (someone minted: the found hash, if any, is dropped with the spec's log line), when the target changed (the difficulty eased or a mint retargeted), or when the anchor is within ten blocks of the 50-block window's end. `bits()` is shown as the difficulty; the page re-reads it on the poll since the target eases with silence and emits no event.
3. **A find.** The engine's hit is verified on the CPU as today, then: with auto-mint on, the page checks the price (`mintPrice()`), the allowance (approve once if short), the balance (log and stop with "not enough PUPATE for the mint price" otherwise), reads `dutiesDue()`, estimates gas for `mint(anchor, nonce)` and adds the padding, and sends. The wallet rejection turns auto-mint off (spec). A mint whose receipt shows no `Minted` for this miner, or that reverts with `NotASolution`, is the lost race: the spec's line, then re-mine. One retry on a transient RPC error, then re-mine.
4. **The receipt.** `Minted(id, seat, round, edition, miner, work, gilt, price, epoch)` gives the spec's success line; `DutyRun(kind, paid)` adds the duty line (kind 1 burn: paid in ETH; kind 2 convert: paid in IMD; kind 0 flush: "your mint also flushed the vault's tax"). The new card appears in the drawer with its real image (fetched from `tokenURI`), and the workspace invalidates its cache for that id.
5. **Gas.** The padding is the contract's documented rule; the page logs the limit it chose ("sending with N gas, the vault's duties included") so a user can see why a mint costs more than a transfer.

## The workspace

- Route `/cards` ("Your cards" in the nav next to "Mine"). Without a wallet: the gallery and the leaderboard only, and a connect prompt. With a wallet: the visitor's cards first.
- Each tile: the image (from `tokenURI`; the SVG inside the JSON, shown as an `<img>` with a data URI; cached), `#<id>`, the stage label with the spec's words, "gilt" when gilt, "staked" when staked, the seat number. Selection by tap; the three buttons act on the selection (`stake(ids)`, `unstake(ids)`, `claim(ids)`); Claim IMD with no selection claims pending only (`claim([])`). The figure "IMD earned, not claimed" updates after each receipt and on a 15-second poll.
- The sentence: *70% of every mint goes to the stakers as IMD; an emerged butterfly earns double.*
- The gallery: every minted card from `Minted` events, newest first, 24 per page, images lazy and cached; a card's tile links to its tokenURI-rendered page (`/cards/<id>`, static route rendering client-side).
- The leaderboard: miners ranked by cards, with gilt counts; from the same events.
- No conversion button, no refresh button, no locks, no weights (spec). `poke` is the keeper's; the page never shows it.
- Images are decoded from `tokenURI` at most once per (id, stage, gilt): the stage is read live, the cache key includes it, so an emerged card redraws.

## The keeper

- `noteSeats` on every tick: the vault's held seats (replayed from `SeatBought`/`SeatAdopted` minus `SeatSold` since `fromBlock`, then confirmed with `Cocoon.seats(id)` on the books and `ownerOf`) minus `notedSeats()` → `noteSeat` each, under the gas cap; a seat refused with `SeatNotHeld` is skipped and logged.
- `forgetSeats`: `notedSeats()` minus the held set → `forgetSeat` each (after the sale settled; `SeatHeld` skipped).
- `convert`: `pot() >= mintPrice() × CONVERT_PRICES / 5` (a fifth of the in-mint threshold, so the keeper converts about hourly at full pace) or `ethPot() != 0`, and `block.number >= lastConvertBlock() + CONVERT_SPACING`, under the gas cap; gas limit = estimate + 1,000,000. The reward goes to the keeper's wallet.
- `poke`: for every staked card (from `StakedCard`/`Unstaked` events) whose `stageOf(id)` disagrees with `stakeOf(id).weight` (0 → 1, 1 → 2), `poke(ids)` in batches of 50.
- Status feed: `work.json` gains minted, epoch, price, bits, the last mint's time, the pot, and the duties due, so the site's numbers have a fallback when the browser's RPC is slow.
- `keeper/README.md` documents the duties; `--once --dry-run` prints the decisions.

## Copy and words

The page uses: mine, hash, mint price, epoch (1 of 11), gilt, chrysalis / emerged, stake, claim IMD, "practice target" (practice mode only), difficulty. Never: series, target (outside "practice target"), anchor, prevWork, retarget, pot, convert, refresh, duties. The log lines are the spec's, verbatim. The "how" explanation of the duty line: *your mint also burned 0.046 ETH of tax for the vault · you earned 0.00023 ETH* (spec).

## Testing

- **Node checks** (`site/scripts/mine-logic.mjs`, run with `npm run mine-check`): the job's `folded` equals `MetamorphMD.workHash` for a known anchor/prevWork (computed on anvil with the real contract through viem); the gas padding; the pending-IMD formula against a scenario; the Transfer folding (mint, transfer out, transfer back); `practiceBitsFor` unchanged.
- **Local stack** (`script/local/up.mjs` extended; `node script/local/up.mjs` as today): anvil fork, the launch stack, plus `DeployMetamorphArt` and `DeployMetamorph` at `MIN_BITS=1`, one seat given to the vault and noted; addresses published for the site and the keeper.
- **Keeper** (`keeper/test/metamorph.test.mjs`, node test runner as the other keeper tests): against the local stack, `noteSeats` notes the seat, `forgetSeats` forgets it after a sale, `convert` converts a filled pot, `poke` reweighs an emerged card; `--dry-run` prints the decisions.
- **The page** (`site/scripts/mine-live.mjs`): starts the dev server against the local stack, drives headless Edge with a funded test wallet injected (a minimal EIP-1193 provider in the page under a dev flag, signing with anvil's key, so no extension is needed), connects, approves, mines at `MIN_BITS=1`, mints, sees the success line and the card in the drawer, opens `/cards`, stakes, claims; prints each step; exits non-zero on any missing line. This is the end-to-end proof before pupate.fun deploys.
- `npm run typecheck`, `npm run build` clean; the copy grep for forbidden words passes (a script that fails on them in `site/components` and `site/app`).

## Deployment and opening

- Mainnet: the owner deploys the art and the token (the README's steps), fills `metamorph` and `metamorphArt` in `keeper/addresses.mainnet.json` and `site/lib/addresses.ts`, runs the keeper on the VPS with the new duties, deploys the site (`vercel --prod`), and announces "contracts live, mining opens with the first seat". The page switches on by itself when the vault holds a seat and the keeper has noted it.
- The practice run stays available forever; the GPU engine's practice target follows the measured rate (as built).

## Out of scope

The work-feed attribute; the oracle; any contract change (if the page or the keeper needs one, it is a new revision plan, not this one).
