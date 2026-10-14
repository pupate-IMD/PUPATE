# Metamorph MD Page and Keeper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the mine page run against the real Metamorph MD contracts (live jobs, mints with the vault's duties paid for, the numbers), give the visitor the workspace of their cards (live images, stake, unstake, claim IMD, the gallery, the leaderboard), port the site's seat drawing to the contract's integers, and give the keeper the duties the contract left to it (note and forget seats, convert, poke), all proven end to end on a local anvil stack before pupate.fun deploys.

**Architecture:** The site stays a Next.js static export with viem/wagmi; a new `site/lib/metamorph/` module holds the ABI subset, the live job builder, the mint sender, the numbers, and the cards reader; `useMiner` gains a live mode that plugs into the same engines (CPU workers, the GPU engine) through the same `MinerJob`; a new `/cards` route hosts the workspace; the keeper gains `keeper/lib/metamorph.mjs` with decision/action pairs in the existing tick. The local stack (`script/local/up.mjs`) deploys the art and the token on the anvil fork and publishes their addresses, so the page, the keeper and the end-to-end script run against real contracts without mainnet.

**Tech Stack:** Next.js 15 static export, React, TypeScript, viem, wagmi, RainbowKit (`site/`); Node 20+ ESM (`keeper/`, `script/`); Foundry scripts and anvil for the local stack; headless Edge for the end-to-end run. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-15-metamorph-page-design.md`; the main spec's "What the visitor sees and does" and "The miner, underneath the page" (`docs/superpowers/specs/2026-10-13-metamorph-md-design.md`), both binding. Contracts: `src/metamorph/MetamorphMD.sol` (the ABI is final: `mint(uint256 anchor, uint256 nonce)`, `prevWork()`, `effectiveTarget()`, `bits()`, `mintPrice()`, `epoch()`, `totalMinted()`, `mineableSeats()`, `notedSeats()`, `noteSeat(uint256)`, `forgetSeat(uint256)`, `dutiesDue() returns (bool,bool,bool)`, `cards(uint256) returns (uint32 seat, uint16 round, uint16 edition, bool gilt, uint40 mintedAt, uint96 paid, address miner, bytes32 work)`, `stageOf(uint256)`, `stakeOf(uint256) returns (address staker, uint8 weight, uint256 debt)`, `accIMDPerWeight()`, `pendingIMD(address)`, `stake(uint256[])`, `unstake(uint256[])`, `claim(uint256[]) returns (uint256)`, `poke(uint256[])`, `convert()`, `pot()`, `ethPot()`, `lastConvertBlock()`, `CONVERT_SPACING()`, `CONVERT_PRICES()`, `DOMAIN()`, `anchorHash(uint256)`, `workHash(bytes32,address,uint256)`, `tokenURI(uint256)`, `ownerOf`, `balanceOf`; events `Minted(uint256 indexed id, uint256 indexed seat, uint16 round, uint16 edition, address indexed miner, bytes32 work, bool gilt, uint256 price, uint16 epoch)` (check the exact declaration in the contract and copy it), `DutyRun(uint8 kind, uint256 paid)`, `StakedCard(uint256 indexed id, address indexed staker, uint8 weight)`, `Unstaked(uint256 indexed id, address indexed staker)`, `Claimed(address indexed staker, uint256 imd)`, `Reweighed`, `MetadataUpdate(uint256)`, `SeatNoted`, `SeatForgotten`, `Converted`, `Transfer`).

## Global Constraints

- English only in code, names, comments, copy, commit messages (chat with the owner is Indonesian).
- The contracts are not modified (`src/` untouched); if the page or the keeper needs a contract change, stop and report.
- Commit messages: one line, no `Co-Authored-By`, no body; never push.
- `npm run typecheck` and `npm run build` clean in `site/` at every commit; `forge test` untouched (no Solidity changes except the local-stack scripts under `script/local/`, which are not tests); the keeper's tests green (`node --test keeper/test`).
- The page's words: mine, hash, mint price, epoch (1 of 11), gilt, chrysalis / emerged, stake, claim IMD, difficulty, "practice target" (practice only). Never in rendered copy: series, target (outside "practice target"), anchor, prevWork, retarget, pot, convert, refresh, duties. A grep script enforces it.
- Gas for a live mint: the estimate + 400,000 per due flush or burn + 1,000,000 for a due conversion (`dutiesDue()`), verbatim from the contract's NatSpec; the keeper's `convert`: estimate + 1,000,000.
- Reads go through the site's existing public client pattern (`usePublicClient` / `SimContext`'s `client`); writes through `writeContractAsync` (wagmi) as `SimContext` does; the wallet is never asked for anything but the approval and the mint/stake/unstake/claim.
- Images are only ever read from `tokenURI` (never drawn client-side for a minted card); cached per (id, stage, gilt).
- The plan's code blocks start with a caption comment; never copy it as line 1 of a file.

## Review Focus

1. A mint sent while someone else's mint lands in the same block: the page must show the spec's lost-race line and re-mine with the new `prevWork`, never report a success it did not get (Task 2, `mine-logic.mjs`'s receipt parsing + the end-to-end run's forced race in Task 6).
2. A wallet whose PUPATE allowance is below the price after a price step (epoch change): the page re-checks the allowance before every mint and re-approves once (Task 2, `test_allowanceReCheckedAtAnEpochStep` in the logic script).
3. A card transferred out and back: the workspace's Transfer folding must show it exactly once and with the right stage (Task 3, the folding check).
4. The keeper noting a seat the vault bought in the same tick it sold another: `noteSeats` and `forgetSeats` must act on the confirmed on-chain state, not the event replay alone (Task 5, the keeper test's buy-and-sell scenario).
5. A GPU practice run switched to live mid-search: the live job must replace the practice job for both engines, and a practice find must never be sent as a mint (Task 2, the engine-switch check in `useMiner`).

---

## File structure

| File | Responsibility |
|---|---|
| `site/lib/metamorph/abi.ts` | `metamorphAbi`, `metamorphArtAbi` (viem `parseAbi` arrays), typed event names |
| `site/lib/metamorph/job.ts` | `liveJob(client, a, miner): Promise<LiveJob>` (the `MinerJob` + the anchor number, `prevWork`, the target, bits, the block); `jobChanged(prev, next)`; `anchorExpiring(job, block)` |
| `site/lib/metamorph/mint.ts` | `prepareMint(client, a, wallet, price)` (balance, allowance, duties, gas padding), `sendMint(...)`, `parseMintReceipt(receipt, miner)` → `{ minted?: {...}, duties: [...], lost: boolean }`, the log lines |
| `site/lib/metamorph/live.ts` | `loadMine(client, a)` → the numbers for the header; the 3-second poller hook `useMineNumbers` |
| `site/lib/metamorph/cards.ts` | `walletCards(client, a, wallet)` from `Transfer` logs; `cardFacts(client, a, id)`; `pendingIMD(client, a, wallet, ids)`; `tokenImage(client, a, id)` with the cache; `mintedCards(client, a)` for the gallery; `leaderboard(cards)` |
| `site/lib/miner/useMiner.ts` | live mode: `start({ live: true })`, the poller, the engine-agnostic job swap, the mint flow, the log lines |
| `site/components/Mine.tsx` | the numbers header, the four steps, the CTA chain, the live log |
| `site/app/cards/page.tsx`, `site/components/Workspace.tsx`, `site/components/CardTile.tsx`, `site/components/Gallery.tsx`, `site/components/Leaderboard.tsx` | the workspace |
| `site/lib/seat.ts` | the integer `traits(seat)` |
| `site/lib/addresses.ts` | `metamorph?: Address; metamorphArt?: Address;` |
| `site/scripts/mine-logic.mjs`, `site/scripts/copy-check.mjs`, `site/scripts/mine-live.mjs` | the Node checks, the copy grep, the end-to-end run |
| `script/local/up.mjs`, `script/local/DeployMetamorphLocal.s.sol` | the local stack with Metamorph |
| `keeper/lib/metamorph.mjs`, `keeper/lib/abi.mjs`, `keeper/lib/state.mjs`, `keeper/bin/keeper.mjs`, `keeper/test/metamorph.test.mjs`, `keeper/README.md` | the duties |

---

### Task 1: Addresses, the ABI, the local stack with Metamorph

**Files:**
- Modify: `site/lib/addresses.ts` (optional `metamorph`, `metamorphArt`), `script/local/up.mjs` (deploy the art and the token after the launch stack; give the vault one seat and note it; publish the two addresses), `keeper/lib/abi.mjs` (the same ABI strings), `keeper/lib/config.mjs` (read `metamorph`/`metamorphArt` from the addresses file; both optional)
- Create: `site/lib/metamorph/abi.ts`, `script/local/DeployMetamorphLocal.s.sol` (deploys `MetamorphChrysalis`, `MetamorphButterfly`, `MetamorphArt`, then `MetamorphMD` at `MIN_BITS=1` against the local stack's addresses; gives the vault a seat the way `script/local/LaunchLocal.s.sol` gives seats, or by the local collection's mint + `adopt`; calls `noteSeat`; prints the addresses)

**Interfaces:**
- Produces: `Addresses.metamorph?`, `Addresses.metamorphArt?`; `metamorphAbi`; the local addresses file gains `metamorph` and `metamorphArt`; `node script/local/up.mjs` ends with Metamorph live at one bit.

- [ ] **Step 1: Write the ABI module** from the contract's public surface (copy each signature from `src/metamorph/MetamorphMD.sol` and `src/metamorph/art/MetamorphArt.sol`; `parseAbi` strings; export the event names as constants). Add a Node check in `site/scripts/mine-logic.mjs` (created here, extended in Task 2) that `parseAbi` accepts every string and that `keccak256` of each event signature equals the selector forge prints (`forge inspect MetamorphMD events` run once; paste the topic hashes as expected values).
- [ ] **Step 2: Run** `node site/scripts/mine-logic.mjs` → the ABI check passes.
- [ ] **Step 3: The local deploy script** and the `up.mjs` extension (a new step "8/8 Metamorph" after the checks: `forge script script/local/DeployMetamorphLocal.s.sol --rpc-url <anvil> --broadcast --private-key <anvil key 0>`; grab the addresses; the vault's seat; `noteSeat`; write the two addresses into `site/public/addresses.local.json` and print them). `addresses.ts` reads them when present (the local file already feeds the site).
- [ ] **Step 4: Run** `node script/local/up.mjs` → the stack is up with Metamorph; `cast call <metamorph> "mineableSeats()(uint256[])" --rpc-url <anvil>` shows one seat; `node script/local/up.mjs down`.
- [ ] **Step 5: Commit** — `mine: the Metamorph ABI and addresses; the local stack deploys the art and the token`

---

### Task 2: Live jobs and the mint

**Files:**
- Create: `site/lib/metamorph/job.ts`, `site/lib/metamorph/mint.ts`
- Modify: `site/lib/miner/job.ts` (a `MinerJob` from live fields; `targetWordsFrom(uint256)`), `site/lib/miner/useMiner.ts` (live mode), `site/components/Mine.tsx` (the CTA chain Connect → Approve PUPATE → Start mining → Stop mining; "or try a practice run"; the live log lines), `site/scripts/mine-logic.mjs`

**Interfaces:**
- Produces: `liveJob`, `jobChanged`, `anchorExpiring`; `prepareMint`, `sendMint`, `parseMintReceipt`; `useMiner().start({ live: true, wallet })`, `state.live`, `state.lastMint`.

- [ ] **Step 1: The job builder.** `liveJob` reads in one multicall: `prevWork()`, `effectiveTarget()`, `bits()`, `DOMAIN()` (cached after the first), the latest block number `n`; the anchor is `n − 1`; `anchorHash(n − 1)` from the contract (never a client-side blockhash); `folded = keccak256(encodeAbiParameters([{type:'bytes32'},{type:'bytes32'}], [anchorHash, prevWork]))` — verify against the contract: `workHash(anchorHash, miner, nonce)` on anvil must equal the CPU worker's digest for the same job and nonce (a Node check in `mine-logic.mjs` against the local stack, using the worker's preimage builder: import `preimage` from `site/lib/miner/gpu/words.ts` through a small transpile or duplicate the 192-byte builder in the script with a comment); the target words = the top 64 bits of `effectiveTarget()`; `jobChanged` when `prevWork` or the target words differ; `anchorExpiring` when `block.number − anchor >= 40`.
- [ ] **Step 2: The mint.** `prepareMint`: `mintPrice()`, `balanceOf(wallet)` on PUPATE (log "not enough PUPATE for the mint price" and stop auto-mint if short), `allowance(wallet, metamorph)` (approve `maxUint256` once if below the price; the log line "approving PUPATE once for every mint"), `dutiesDue()`, `estimateGas` for `mint(anchor, nonce)` from the wallet, then `gas = estimate + 400_000 × (flushDue + burnDue) + (convertDue ? 1_000_000 : 0)`; `sendMint` → `writeContractAsync` with that `gas`; `parseMintReceipt`: the `Minted` log for this miner → the success line `Metamorph.md #<id> is yours · seat identity.md #<seat> · mining the next one` (with ` · gilt` when gilt); `DutyRun` logs → `your mint also burned <x> ETH of tax for the vault · you earned <y> ETH` (kind 1; `x` from Cocoon's `Burned` log in the same receipt if present, else omitted), `your mint also converted the stakers' share · you earned <z> IMD` (kind 2), `your mint also flushed the vault's tax` (kind 0); no `Minted` → `lost`. A revert with `NotASolution` before sending (simulation) → the lost-race line; the page re-mines.
- [ ] **Step 3: `useMiner` live mode.** `start({ live: true, wallet })`: the poller (3 s) calls `liveJob`; on `jobChanged` or `anchorExpiring` it dispatches the new job to the running engine (CPU workers or the GPU engine, the same `dispatch`) and logs `someone minted first, your hash expired · mining again` when a found hash was pending; a find in live mode → `prepareMint`/`sendMint` with auto-mint on, or `pending` with the Mint button; a wallet rejection turns auto-mint off (spec); after a receipt, the new job is fetched at once. The practice run keeps today's path untouched; a practice find is never sent (the job carries `live: false`). Gilt in live mode is told from the receipt (`Minted.gilt`), not from leading zeros.
- [ ] **Step 4: The page.** The CTA chain per the spec; "or try a practice run"; the numbers header reads `useMineNumbers` (Task 4 provides it; stub it here with the live job's bits and price) ; the engine and power controls unchanged.
- [ ] **Step 5: Checks.** `mine-logic.mjs` against the local stack: the folded word equals `workHash`; a one-bit mint from the script's own wallet (anvil key) succeeds and `parseMintReceipt` finds `Minted`; the gas padding arithmetic; the allowance re-check at an epoch step (simulate `mintPrice` growing); `npm run typecheck`, `npm run build`.
- [ ] **Step 6: Commit** — `mine: live jobs from the contract and the mint with the vault's duties paid for`

---

### Task 3: The workspace: your cards, stake, unstake, claim IMD, the gallery, the leaderboard

**Files:**
- Create: `site/lib/metamorph/cards.ts`, `site/app/cards/page.tsx`, `site/components/Workspace.tsx`, `site/components/CardTile.tsx`, `site/components/Gallery.tsx`, `site/components/Leaderboard.tsx`
- Modify: `site/components/TopBar.tsx` (the "Your cards" link), `site/app/globals.css` (the tiles)

**Interfaces:**
- Produces: `walletCards`, `cardFacts`, `pendingIMD`, `tokenImage`, `mintedCards`, `leaderboard`; the `/cards` route.

- [ ] **Step 1: The reads.** `walletCards`: `Transfer` logs with `to == wallet` and `from == wallet` since `fromBlock` (the site's chunked `logsOf` pattern from `site/lib/live.ts`), folded into the current set (a token is owned if its last transfer went to the wallet); for each id `cards(id)`, `stageOf(id)`, `stakeOf(id)`; `pendingIMD` = `pendingIMD(wallet)` + Σ over staked ids of `(weight × accIMDPerWeight − debt) / 1e18`; `tokenImage(id)`: `tokenURI(id)` → decode base64 JSON → `image` (a data URI) → cache in memory and `localStorage` under `metamorph:img:<id>:<stage>:<gilt>` (guard every storage access with try/catch); `mintedCards`: `Minted` logs → `{ id, seat, miner, gilt, epoch }[]`; `leaderboard`: miners by count, gilt count, newest first on ties.
- [ ] **Step 2: The components.** `CardTile` (image, `#id`, stage word, gilt mark, staked mark, seat); `Workspace` (the wallet's cards, selection, the three buttons through `writeContractAsync`: `stake(ids)`, `unstake(ids)`, `claim(ids)` (empty selection → `claim([])`), the "IMD earned, not claimed" figure, the sentence, a 15-second poll, invalidation after receipts); `Gallery` (24 per page, lazy images); `Leaderboard`; the page composes them; without a wallet the workspace shows the connect prompt above the gallery.
- [ ] **Step 3: Checks.** `mine-logic.mjs`: the Transfer folding (mint → transfer out → transfer back → owned once), the pending formula on a scenario (two stakers, one conversion), the cache key; `typecheck`, `build`; the copy grep.
- [ ] **Step 4: Commit** — `cards: the workspace of your cards, stake, unstake and claim IMD; the gallery and the leaderboard`

---

### Task 4: The numbers, the copy, the seat drawing

**Files:**
- Create: `site/lib/metamorph/live.ts`, `site/scripts/copy-check.mjs`
- Modify: `site/components/Mine.tsx` (the header "The mine, in numbers": minted, epoch, price, difficulty "≈ N hashes", network rate, percent minted, seconds since the last mint; the title "Clock in."; the sentence; the four steps; the ready state), `site/lib/seat.ts` (the integer `traits`), `site/components/How.tsx` or the docs page (the duty line explained in one sentence), `site/package.json` (`copy-check`, `mine-check` scripts)

- [ ] **Step 1: `loadMine`**: `totalMinted`, `epoch`, `mintPrice`, `bits` → expected hashes `2^bits` shown with `fmtHashes`, `lastMintAt` (from `cards(totalMinted).mintedAt` or a `lastMintAt()` getter if public — check the contract), the network rate = (mints in the last hour from `Minted` logs × 2^bits) ÷ 3600, percent = `totalMinted / 3333`, seconds since the last mint; `mineableSeats().length` for the ready state. `useMineNumbers` polls every 3 s (shared with the job poller's block).
- [ ] **Step 2: The copy** per the spec and the Global Constraints (the sentence without "target"); `copy-check.mjs` greps `site/components` and `site/app` for the forbidden words in JSX text and string literals (allowing "practice target") and fails on a hit.
- [ ] **Step 3: `seat.ts`**: port `seatTraits` from `script/art/mirror.mjs` (the uint32 generator and `between` in tenths) so `traits(seat)` returns the same integers and tenths (as numbers: tenths / 10) — the emergence card and the seat pages then draw the chain's butterfly; keep the `Traits` interface.
- [ ] **Step 4: Checks**: `npm run copy-check`, `npm run mine-check` (the seat port equals the mirror for 64 seats), `typecheck`, `build`.
- [ ] **Step 5: Commit** — `mine: the numbers, the words, and the seat drawn as the chain draws it`

---

### Task 5: The keeper's duties

**Files:**
- Create: `keeper/lib/metamorph.mjs`, `keeper/test/metamorph.test.mjs`
- Modify: `keeper/lib/state.mjs` (read the mine's state: `notedSeats`, `mineableSeats`, `pot`, `ethPot`, `lastConvertBlock`, `mintPrice`, `totalMinted`, `bits`, the staked set from events), `keeper/bin/keeper.mjs` (steps `noteSeats`, `forgetSeats`, `convertPot`, `poke` after `claim`; skipped when `metamorph` is absent), `keeper/lib/status.mjs` (the work feed's mine numbers), `keeper/README.md`

- [ ] **Step 1: Decisions and actions** in the house pattern (`xDecision(cfg, s)` → `{ ready, why, label }`, `x(ctx, s)` → `idle`/`acted` through `tx.run`): `noteSeatsDecision` (held − noted, confirmed with `Cocoon.seats` and `ownerOf`), `forgetSeatsDecision` (noted − held), `convertDecision` (`pot >= mintPrice × CONVERT_PRICES / 5 || ethPot != 0`, past the spacing, gas cap; `gas: estimate + 1_000_000`), `pokeDecision` (staked ids whose `stageOf` ≠ weight − 1, batches of 50).
- [ ] **Step 2: Tests** against the local stack (`node script/local/up.mjs` in the test's setup, or a documented precondition): the seat is noted on the first tick; after a sale it is forgotten; a filled pot converts; an emerged staked card is poked; `--dry-run` prints the four decisions; the buy-and-sell-in-one-tick scenario acts on the confirmed state.
- [ ] **Step 3: Run** `node --test keeper/test` → green; `node keeper/bin/keeper.mjs --once --dry-run` against the local stack prints the decisions.
- [ ] **Step 4: Commit** — `keeper: the mine's duties; seats noted and forgotten, the pot converted, staked cards poked`

---

### Task 6: The end-to-end run and the runbook

**Files:**
- Create: `site/scripts/mine-live.mjs`, `site/components/DevWallet.tsx` (a minimal EIP-1193 provider injected under a dev query flag `?dev-wallet=<index>` that signs with anvil's key through viem's `privateKeyToAccount`; never built into production: the component returns null unless `process.env.NODE_ENV !== "production"` and the flag is present)
- Modify: `script/mainnet/README.md` (the site step: fill `metamorph`/`metamorphArt` in `site/lib/addresses.ts`, `vercel --prod`), `keeper/README.md` (start line with the duties), `docs/deployment.md` (the keeper's new duties and the page switch-on), the spec's errata if anything deviated

- [ ] **Step 1: The dev wallet** (dev only) so headless Edge can sign without an extension; the page's RainbowKit connect sees it as an injected wallet.
- [ ] **Step 2: `mine-live.mjs`**: `up.mjs` (if not up), the dev server, headless Edge with the DevTools protocol (the pattern of `site/scripts/gpu-selftest.mjs`): open `/mine/?dev-wallet=1`, connect, approve, start mining (CPU, one bit), wait for the success line, assert the drawer shows the card with its real image, open `/cards/`, stake, claim, assert the figures; force a race once (mint from another anvil key between the find and the mint) and assert the lost-race line; print each step; exit non-zero on a missing line; stop everything.
- [ ] **Step 3: Run it** → every step passes; record the log in the report.
- [ ] **Step 4: Docs and commit** — `mine: the end-to-end run on the local stack; the runbook's site and keeper steps`

---

## Self-review (done while writing)

- Spec coverage: addresses/local stack ✓ (T1), live jobs + mint + gas ✓ (T2), the workspace ✓ (T3), the numbers + copy + seat port ✓ (T4), the keeper ✓ (T5), end to end + runbook ✓ (T6).
- Review Focus 1–5 pinned: T2/T6 the race; T2 the allowance; T3 the folding; T5 the confirmed state; T2 the engine switch.
- Type consistency: `MinerJob` fields as today plus `live`; `LiveJob = MinerJob & { anchor, block, prevWork, target }`; `Addresses.metamorph?`/`metamorphArt?`; the keeper's decision/action signatures as `actions.mjs`.
- Not in this plan: contract changes; the X announcement text (the owner's).
