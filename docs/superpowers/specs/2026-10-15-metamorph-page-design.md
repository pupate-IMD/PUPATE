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

## Errata from the implementation (2026-10-15)

Where the six tasks of the plan departed from the text above, by ruling or by what the build showed. Each is recorded in its task's report (`.superpowers/sdd/2026-10-15-metamorph-page/task-<n>-report.md`); where this document and the code differ, the code and this list hold.

**Addresses, the ABI, the local stack (Task 1)**

- The fork deploys through one local script, `script/local/DeployMetamorphLocal.s.sol`, at `MIN_BITS=1`, not through `DeployMetamorphArt` and `DeployMetamorph` (the mainnet script refuses any `MIN_BITS` but 20). It mirrors both: the same constructor arguments, pool keys and art check.
- The vault's seat on the fork is a real mainnet seat handed to Cocoon by impersonating its holder (`up.mjs` step 8; seat #1 unless `SEAT` says otherwise, never 1376, which the keeper's fork test buys); the forge script adopts and notes it.
- The ABI carries every custom error of the token (28) and `ANCHOR_WINDOW()`, `MAX_SUPPLY()` and `EPOCH()` besides the views listed.
- The keeper's tests are scripts against a fresh local stack, `keeper/test/metamorph.mjs` (`npm run test:mine`) beside `keeper/test/fork.mjs`, not `keeper/test/metamorph.test.mjs` under the node test runner. `fork.mjs`'s held-seat counts became relative, since the stack now starts with one seat.

**Live jobs and the mint (Task 2)**

- The block number comes from the same multicall as the state (Multicall3's `getBlockNumber`), the anchor is that block − 1 and its hash is the contract's `anchorHash(n)`. The engines' two target words are `effectiveTarget()`'s top 64 bits, so they never pass a hash the contract refuses; every find is checked again on the main thread against the whole target before the wallet opens.
- The gas line reads `sending with N gas, the vault's work included`, and only when a due duty padded the limit; "duties" is a forbidden word on the page. The conversion's duty line reads `your mint also turned the stakers' share into IMD · you earned <z> IMD`.
- The success line puts ` · gilt` after the seat, and drops ` · mining the next one` once the miner has stopped (a hash minted from the button after Stop).
- The lines the specs left open are the page's: `your hash waited too long and expired · mining again`, `the difficulty changed before your mint landed · mining again`, `you declined in your wallet · auto-mint is off`, `nothing to mine until the vault holds a seat`, `3,333 of 3,333 minted`, `PUPATE approved for every mint`, `the mint ran out of time (the hash was older than 50 blocks) · mining again`, `the mint reverted · mining again`, `your mint did not land within 50 blocks · mining again`, `stopped · the waiting hash was dropped`, `the hash was dropped · mining is stopped`, `wallet disconnected · stopped`, `the wallet changed · stopped`.
- "One retry on a transient RPC error" holds only before the wallet is asked to send. A mint that left the wallet is never sent again: when the wallet's answer or the receipt goes missing, the chain is watched (prevWork, the block, the receipt) until it shows what became of the mint. A reverted receipt is told apart by its block first (past the anchor's window), then by prevWork (someone minted first), else `the mint reverted`.
- A hash waiting for the Mint button is kept while it is valid: dropped when prevWork moves or its anchor reaches age 40, kept when the target only eased. Stop drops it, and `or stop mining` stands beside Mint it now. A poll that straddles a mint, or that meets a node still behind the page's own receipt, is skipped. A live run does not start while `mineableSeats()` is empty, ends the moment the wallet disconnects or changes, and ends with the page.
- The allowance is checked again before every mint (an epoch step raises the price) and approved again, to the maximum, when it is below the price: "approve once" holds for as long as the maximum lasts.

**The workspace (Task 3)**

- A card's page is `/cards/view/?id=<n>`, not `/cards/<id>`: a static export would need every id at build time, and the site's `/seat/?id=` already works this way.
- Ruling: Claim IMD with nothing selected claims for every staked card of the wallet (`claim(<their ids>)`, settling them), not `claim([])`. `pendingIMD` grows only when a card is settled, so `claim([])` would pay nothing in the common case of a card staked and left; the figure shown is what the button pays, and it is enabled only when that is above zero.
- Nothing is invalidated after a mint: a new id has no image cached yet, and the key carries the stage. The images are cached under `metamorph:img:<id>:<stage>:<gilt>`, the stored value tagged with the chain and the token so another deployment's card under the same key is never shown, and a failed `tokenURI` read is tried again after 2, 6, 18 and 54 s.
- The folded `Transfer` set is confirmed with `ownerOf`, and `balanceOf` is read in the same single multicall (`batchSize: 0`, so the figure and the list come from one block); each poll reads the last 12 blocks again, and a ledger that disagrees with `balanceOf` is read again from `fromBlock`, at most once a minute. Every write is simulated first, so a refusal is said in words and never opens the wallet.
- The leaderboard ranks miners by cards only, gilt shown beside them, ties newest card first: the top 20 and the wallet's own row.

**The numbers, the words, the seat (Task 4)**

- The mints of the last hour are counted from each card's `mintedAt` (its mint block's timestamp, read through Multicall3), not from `Minted` logs; a stack check holds the two equal.
- The numbers poll on their own three-second timer, reading their own block in the same multicall, not the job poller's.
- The difficulty reads "≈ N hashes" from `2^bits()`, not from `effectiveTarget()`; after a retarget that can understate the expected hashes up to twice (the exact figure is 2^256 / `effectiveTarget()`; left for the final wave). One bit reads "1 bit".
- The time since the last mint is a duration ("4 min 12 s"), a dash before the first mint.
- The housekeeping sentence is in the mine page's own footer, not in How.tsx or the docs. The dots between the four steps are drawn by CSS.
- Ruling: the forbidden words bind the Metamorph surface only: the mine page, `/cards` and their components (Mine, Incubator, Workspace, CardTile, Gallery, Leaderboard, CardView) and the strings `site/lib/metamorph` and `site/lib/miner` render. The vault's pages keep their established words (seat pot, burn pot, duties). `npm run copy-check` reads exactly that surface, not all of `site/components` and `site/app`.

**The keeper (Task 5)**

- Ruling: the mine's numbers live in `status.json`, its `mine` block rewritten every tick, not in `work.json` (which holds IMD's seat records and is refreshed every ten minutes at most). No site code reads either feed for the mine yet.
- "Held" is the token's own test, on Cocoon's books and in its wallet, checked on chain in every tick's state read: noteSeats never tries a seat already gone from the wallet, and forgetSeats never forgets on the logs' word alone.
- The keeper's transaction path gained a `padGas` option (the estimate plus a fixed pad instead of the default +25%), which `convert` uses with 1,000,000.
- The mine is read in its own multicalls: a missing or unreadable `metamorph` idles the four duties with the reason and never stops the vault's steps. `metamorph` is read from the addresses file only (`cfg.addresses.metamorph`), with no environment variable, so the VPS keeper needs `ADDRESSES` naming `keeper/addresses.mainnet.json`.
- convert's spacing is counted at the block the transaction would land in (head + 1), as the burn's is; at the exact edge the simulation still says `TooSoon`, which is logged and skipped.

**The end-to-end run (Task 6)**

- The dev wallet is the driver's, not a page component: `site/scripts/mine-live.mjs` puts an EIP-1193 provider into every page over the DevTools protocol, announces it through EIP-6963 (RainbowKit lists it under Installed, and the run connects through the modal), and signs in its own process with viem's `privateKeyToAccount` (anvil's public key #1 unless `--account` names another). There is no `site/components/DevWallet.tsx` and no `?dev-wallet=` flag: the site carries no dev-wallet code, and the run still builds the production export and looks through `out/` for every anvil key.
- The race is forced, not waited for, in the order the plan gives: a find waits, the rival mints the same prevWork, then Mint it now is pressed. The waiting nonce is read where the page's engines report it (the driver's probe keeps the live job a Worker is handed and its finds), and the rival's nonce is drawn so that the page's proof, folded again with the rival's proof as prevWork, has its top bit set, which no target takes; at a few bits a stale nonce would otherwise solve the new job by chance. For the second or so of the race the page's reads wait at the browser's door (the DevTools Fetch domain), so its own three-second poll cannot see the rival's mint first and drop the hash with the same line by another way.
- Claim IMD is run after a real credit: anvil #6 buys PUPATE through the Universal Router first (a fresh fork's launch pool holds no ETH to sell the pot into), and anvil #7 calls `convert()` once the dev wallet's card is staked.

## The commons (2026-10-16)

The token was redeployed with the rule in `2026-10-13-metamorph-md-design.md`'s "The commons": while the vault holds no noted seat with editions left, a mint draws its seat from the whole identity.md collection, and the vault's seats take over from the first noted one. The page treats a live contract with no vault seat as open:

- Start mining is on whenever the contract is live, and the live run reads its first job without asking for the vault's seats: "Readiness" above and the errata's "a live run does not start while `mineableSeats()` is empty" no longer hold. The practice run stays a link away.
- The ready line while `mineableSeats()` is empty is "Ready. The vault holds no seat yet, so cards draw from the whole identity.md collection."; with a seat held there is no ready line. The numbers keep the mineable count.
- The pre-register gate shows while no card was ever minted (`totalMinted()` 0), whatever the vault holds.
- `NothingMineable` can still come back (the collection's `totalSupply()` unreadable or zero, or seventeen full buckets in a row): the page's line for it is "no seat could be drawn for a card right now · stopped", and the run ends as before. The receipt is read as before: the card's seat and round are the event's.
- `scripts/mine-logic.mjs` pins a live run with `mineableSeats()` empty that gets its job and mints its find; `scripts/mine-live.mjs` no longer needs a noted seat in its fixture.
