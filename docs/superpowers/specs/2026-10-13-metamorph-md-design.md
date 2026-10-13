# Metamorph MD: the proof-of-work layer (v2)

**Date:** 2026-10-13 · **Status:** v2 design approved in conversation (owner, 2026-10-13, evening); this spec
is for the owner's review before the implementation plan. v2 replaces the four-stage, fee-to-developer design
of the same morning after the owner studied [imdworkers.fun](https://imdworkers.fun/) and asked for its
simplicity with Pupate's own flywheel. [`docs/v2-mining-proof-of-work.md`](../../v2-mining-proof-of-work.md)
stays as the record of the idea.

## Why

Pupate's token is live and its vault has no operator. Metamorph MD gives the project a second thing to do
with a browser besides trading: mine a card of a seat the vault holds. WORKERS proved that browser mining
with a wallet-bound hash, a rising price and auto-mint is a form people understand in a minute. We take
that form whole and change what it runs on: the fee is paid in PUPATE, so every mint buys PUPATE in the
pool and pays the 6% tax that buys the next seat; what is mined is a seat that really works in the IMD
swarm; the stakers' yield is paid in IMD out of real mint revenue, not out of an emission; and the mint
transaction itself can run the vault's duties and be paid for it. No second token, no activation, no burn
pool, no keys.

## What WORKERS does, as read from its code

Its front end is public (`app.js`, `keccak_core.js`, `gpu_miner.js`, `miner.worker.js`, `config.js`); its
contracts are not verified, so the retarget and staking formulas below are ours, not theirs.

- **Proof:** `keccak256(abi.encode(DOMAIN, chainid, nft, keccak256(abi.encode(anchorHash, prevWork)), minter,
  nonce)) < currentTarget()`. `anchorHash` is the hash of a recent block (at most 50 old), so nobody mines far
  ahead; `prevWork` is the previous mint's proof, so **every mint voids every open proof**: mints are
  sequential, one winner per round, like blocks.
- **Difficulty** starts at 12 bits and its floor rises one bit per epoch; the site shows about 13.4 bits
  (≈10,800 hashes), so the hash is a formality and the fee is the gate.
- **Epochs** of 370 mints (9 for the original 3,333), prices 0.25 → 0.5 → 0.75 → 1.25 → 1.75 → 2.5 → 3.25 → 4
  → 5 IMD. Supply cut to 1,555.
- **The winning hash picks a random unminted worker**; **Overclocked = proof < target/16** (1 in 16).
- **Miner:** hand-written keccak with a precomputed midstate (the first 136-byte block never changes), 40,000
  hashes per chunk, a benchmark to pick the thread count, a fully unrolled WebGPU shader, power 25–100%,
  a self-test against the contract's `workHash()` view, auto-mint through `mint(anchor, nonce)` after
  rechecking price, allowance and balance, and a job refresh when `prevWork`, the target or the anchor
  changes.
- **After the mint:** activation (0.15 IMD) for passive $WORK, custodial staking 7/14/30 days at 1×/2×/4×
  for 65% of mint fees plus $WORK, a 50M $WORK burn pool, a second token of 1,000,000,000 $WORK with a 10%
  trade fee, on Robinhood Chain.

## Decisions

Owner's decisions, with their dates. Later ones override earlier ones.

- **The WORKERS mechanism (2026-10-13 evening):** one valid proof is one mint; the work chain of anchor and
  `prevWork`; the hash picks the seat; gilt at target/16; the four-step page (Connect, Approve, Mine,
  Auto-mint) with CPU and GPU engines and a power control. Egg, larva, feeding and pupation are dropped.
- **Fee split 70 / 30 (2026-10-13):** 70% of every mint fee to the stakers, 30% to the treasury. The
  treasury is the developer's address as Cocoon records it, paid in PUPATE in the mint transaction.
- **Stakers are paid in IMD (2026-10-13):** the stakers' 70% is held as PUPATE and converted in batches,
  by a public bounded `convert()`, into IMD through the PUPATE/ETH pool and the ETH/IMD pool; stakers claim
  IMD. Chosen over conversion inside each mint (gas and MEV per mint) and over PUPATE rewards with a swap
  button in the site.
- **Staking without time locks (2026-10-13):** stake and unstake at will, equal weights, except that an
  emerged butterfly weighs 2×. A staked card is locked in place (transfers revert) rather than moved into
  the contract, so it stays visible in the wallet.
- **Mining runs the vault (2026-10-13):** a mint may also execute a due vault duty (flush, burn, convert);
  the caller rewards go to the miner. Opt-in per mint, never allowed to fail the mint.
- **The fuel is PUPATE (2026-10-13):** the mint price is in PUPATE, 50,000 at the start, ×1.25 per series of
  303 mints.
- **Supply (2026-10-13):** 303 cards per seat and round, 3,333 cards in all (11 × 303), only for seats the
  vault holds.
- **Two stages on one NFT (2026-10-13):** a card is born a chrysalis and becomes a butterfly when the vault
  no longer holds its seat, or 90 days after the mint. Computed, never sent.
- **Names (2026-10-13):** the collection is **Metamorph MD**, symbol **MMD**; each token is **`Metamorph.md
  #<n>`** by token id in mint order. The contracts are `MetamorphMD` and `MetamorphArt`.
- **Minimal label, every card visibly different (2026-10-13):** unchanged from the morning (see The
  drawing). The owner reviewed a full 3,333-card render.
- **Royalty 5% on resale through ERC-2981 (2026-10-13),** to `Cocoon.developer()`.
- **No keys.** No owner, setter, pause, upgrade or withdraw on any Metamorph contract. The only balances
  that rest in the contract are the stakers' PUPATE awaiting conversion and their IMD awaiting claims, and
  both move only by the rules below.

## What is built

| Unit | Does | Depends on |
|---|---|---|
| `MetamorphMD` (ERC-721) | the work chain and the mint, the seat pick, the fee split, the reward pot and `convert()`, staking and IMD claims, the vault duties, the two stages, `tokenURI`, ERC-2981 | Cocoon and PupateHook (reads, plus `burn()` and `flush()` when asked), PupateToken, IMD, the identity.md collection, the PoolManager (two pools), `MetamorphArt` |
| `MetamorphArt` | draws a card as SVG from its facts; pure | nothing |
| the Mine page and the miner | the four steps, the engines, auto-mint, the workspace (cards, stake, claim) | the site's live and wallet layers; `MetamorphMD` |

Cocoon, PupateHook, PupateToken, FloorFeed and the timelock are not changed and gain no new role.
`MetamorphMD` is an ordinary caller of their public functions.

## The work chain and the mint

A **proof** for miner `m` at anchor block `a` with nonce `n` is

    work = keccak256(abi.encode(DOMAIN, block.chainid, address(this), keccak256(abi.encode(blockhash(a), prevWork)), m, n))

and it is valid when `uint256(work) < target` and `a` is at least one block old and at most `ANCHOR_WINDOW`
(50) blocks old. `DOMAIN` is `keccak256("Metamorph MD work v1")`. `prevWork` is the proof of the last mint
(the domain at deployment). A proof therefore belongs to one wallet, one chain, one contract, one recent
block and one state of the chain of mints: it cannot be stolen from the mempool, mined ahead of time, or
kept for later, and every mint voids every proof that was being searched for. The 192-byte preimage is
laid out so that its first 136 bytes are constant while mining (the keccak midstate trick); only the nonce
changes.

`mint(uint256 anchor, uint256 nonce, bool runDuties)`:

1. checks supply, the proof, and that the vault holds at least one seat with editions left;
2. picks the seat: the held seats with editions left, in ascending token id, indexed by `work % count`
   (read from Cocoon: `heldCount()`, the held set, `seats(id).held`, `seats(id).round`, and the
   collection's `ownerOf`); the edition is the next for that (seat, round);
3. takes the fee: `transferFrom(msg.sender, this, price × 70%)` into the reward pot and
   `transferFrom(msg.sender, cocoon.developer(), price × 30%)`;
4. mints token `n = totalMinted + 1` to `msg.sender` with `gilt = uint256(work) < target >> 4`;
5. records `prevWork = work`, retargets, advances the series if due;
6. if `runDuties`, tries the vault duties (below) and forwards what they paid to `msg.sender`.

`workHash(bytes32 anchorHash, address miner, uint256 nonce) view` returns the proof the contract would
compute, for the miner's self-test; `anchorHash(uint256 block) view` returns `blockhash` or zero.

### Difficulty and price

- **Retarget every mint** toward `TARGET_INTERVAL` (90 seconds): `target = target × elapsed /
  TARGET_INTERVAL`, where `elapsed` is the time since the previous mint, clamped between a quarter and four
  times the previous target, and never above the series' ceiling `type(uint256).max >> (MIN_BITS +
  series)`: the difficulty floor is 20 bits in the first series and rises one bit per series. At the
  start the target is the first series' ceiling (20 bits, about a million hashes).
- **Price:** `BASE_PRICE × 1.25^series`, `series = totalMinted / 303`; eleven series, the last about ×9.3
  the first. `mintPrice()` is read by the page before every mint.
- **The pace this sets:** at most about forty mints an hour network-wide whatever the demand; demand shows
  up as difficulty, not throughput. At steady demand the collection takes at least three and a half days
  to mint out.

### The vault duties

With `runDuties`, after the mint and inside the same transaction, `MetamorphMD` tries in order, each in a
`try` with a gas allowance so that a failure never reverts the mint:

1. `PupateHook.flush()` when the hook's claims are at least `MIN_FLUSH` (0.005 ETH);
2. `Cocoon.burn()` when the burn pot is at least `MIN_BURN` (0.01 ETH) and the spacing allows; the 0.5%
   caller reward arrives in ETH and is forwarded to the miner;
3. `convert()` (below) when the reward pot is at least `MIN_CONVERT` (the current mint price ×2); the 0.5%
   caller reward arrives in IMD and is forwarded to the miner.

The page turns `runDuties` on by default when the base fee is under 2 gwei and a duty is due, and shows
the expected reward beside the mint. `MetamorphMD` has a `receive()` for the vault's ETH and never keeps
any: whatever ETH it holds at the end of a call goes to the caller.

## The fee, the pot and the stakers

- **Split:** 70% of each fee to the reward pot (PUPATE held by `MetamorphMD`), 30% to `cocoon.developer()`
  at once. Nothing else ever leaves the pot except through `convert()`.
- **`convert()`, public, bounded:** sells the pot's PUPATE for ETH in the PUPATE/ETH pool with the price
  limit Cocoon's `burn` uses, mirrored for a sale (`sqrtPrice × sqrt(1 − CONVERT_IMPACT)`, 5%), then buys
  IMD with that ETH in the ETH/IMD pool (currency0 ETH, currency1 IMD, fee 10,000, tick spacing 200, no
  hook, pool id `0xb07d640f…abfb3`, about $2.6M of liquidity on 2026-10-13) under the same bound, both in
  one `unlock`. The IMD bought, less `CALLER_REWARD` (0.5%) to the caller, is credited to the stakers'
  accumulator. What the bound leaves unsold stays in the pot for the next call. The sale pays the hook's
  6% tax to the vault like any sale, and that is wanted: the stakers' rewards pay for the next seat.
- **Stakers earn IMD** through the usual accumulator: `accIMDPerWeight` grows by `IMD × 1e18 /
  totalWeight` on every conversion; a staker's pending is `weight × acc − debt`. `claim()` pays the pending
  IMD. If `totalWeight` is zero when a conversion lands, that IMD goes to `cocoon.developer()`, so nothing
  waits in the contract for a staker who may never come.
- **`stake(ids)`, `unstake(ids)`, `claim()`, `refresh(ids)`:** staking settles pending, locks the cards
  (transfers revert with `Staked`), and adds their weight: 1 for a chrysalis, 2 for a butterfly, as the
  stage reads at that moment. `refresh` re-reads the stage of staked cards and raises their weight after
  emergence, settling first. Unstaking settles and unlocks. There is no lock period and no custody change.
- **Royalty:** `royaltyInfo` returns `cocoon.developer()` and 5% of the sale price.

## The card's two stages

| Stage | When | Weight when staked |
|---|---|---|
| **Chrysalis** | from the mint | 1 |
| **Butterfly** | computed on every read: the vault no longer holds the card's (seat, round), that is `seats(seat).held` is false, or `round` differs (the vault bought the seat again), or the collection's `ownerOf(seat)` is not Cocoon; or 90 days have passed since the mint whatever happened to the seat | 2 after `refresh` |

Nothing is sent to emerge; `stageOf` and `tokenURI` apply the rule, so no card can be stuck.

### Numbers

| Constant | Value | Why |
|---|---|---|
| `EDITIONS` | 303 per (seat, round) | 11 × 303 = 3,333 |
| `MAX_SUPPLY` | 3,333 | the collection is finite |
| `SERIES` | 303 mints | one seat's worth; price and difficulty floor step here |
| `BASE_PRICE` | 50,000 PUPATE | about $1.50 at launch-week prices |
| price growth | ×1.25 per series, eleven series | the last series about 465,661 PUPATE |
| `TARGET_INTERVAL` | 90 s | about forty mints an hour at most |
| `MIN_BITS` | 20 in series 1, +1 per series (constructor, 20 on mainnet) | the difficulty floor; about a million hashes at the start |
| retarget clamp | ÷4 to ×4 per mint | the same bound Bitcoin uses, applied per mint |
| `ANCHOR_WINDOW` | 50 blocks | about ten minutes on Ethereum; `blockhash` reaches 256 |
| gilt | `work < target >> 4` | 1 in 16, the Overclocked rule |
| fee split | 70% pot, 30% treasury | the owner's figures |
| `CONVERT_IMPACT` | 500 bps | the vault's burn bound, mirrored |
| `CALLER_REWARD` | 50 bps | the vault's figure, for `convert` |
| `MIN_FLUSH`, `MIN_BURN`, `MIN_CONVERT` | 0.005 ETH, 0.01 ETH, 2 × price | the keeper's thresholds |
| butterfly ceiling | 90 days from the mint | no card waits forever for a sale |
| staking weights | chrysalis 1, butterfly 2 | yield follows the vault's success |
| royalty | 500 bps | the owner's 5% |

## Interfaces

`MetamorphMD`:

- `mint(uint256 anchor, uint256 nonce, bool runDuties)`, `convert()`, `stake(uint256[] ids)`,
  `unstake(uint256[] ids)`, `claim()`, `refresh(uint256[] ids)`.
- Views: `target()`, `bits()` (for display), `prevWork()`, `lastMintAt()`, `series()`, `mintPrice()`,
  `totalMinted()`, `editionsMinted(seat, round)`, `mineableSeats()` (the held seats with editions left, in
  pick order), `workHash(anchorHash, miner, nonce)`, `anchorHash(block)`, `cards(id)` (seat, round, edition,
  gilt, mintedAt, miner, work), `stageOf(id)`, `pot()`, `pendingIMD(staker)`, `stakeOf(id)` (staker, weight),
  `totalWeight()`, `dutiesDue()` (flush, burn, convert as booleans with the expected rewards), `tokenURI`,
  `royaltyInfo`, `supportsInterface` (ERC-165, 721, 721Metadata, 2981).
- Events: `Minted(id, seat, round, edition, miner, work, gilt, price, series)`, `Retargeted(target)`,
  `Converted(pupateSold, ethBought, imdBought, caller, reward)`, `Staked(id, staker, weight)`,
  `Unstaked(id, staker)`, `Claimed(staker, imd)`, `Refreshed(id, weight)`, `DutyRun(kind, paid)`.
- Errors: `SupplyExhausted`, `NothingMineable`, `BadAnchor`, `NotASolution`, `StaleWork`, `Staked`,
  `NotStaked`, `NotCardOwner`, `NothingToConvert`, `NothingBought`, `ZeroAddress`.
- Constructor: `(Cocoon cocoon, PupateHook hook, PupateToken pupate, IERC20 imd, IERC721Minimal collection,
  IPoolManager poolManager, PoolKey pupateKey, PoolKey imdKey, MetamorphArt art, uint8 minBits)`, all
  immutable. `minBits` is the first series' difficulty floor: 20 on mainnet, 1 in the test suite so that
  proofs can be found inside a test (about every other nonce passes). The developer address is never
  stored; it is read from Cocoon at each payment and each royalty query.

`MetamorphArt`: `render(View calldata v) pure returns (string memory svg)` with `View = {seat, round,
edition, stage, gilt, miner, mintedAt}`; `tokenURI` wraps it as `data:application/json;base64,…` with the
image as `data:image/svg+xml;base64,…`. If it does not fit under 24,576 bytes in one piece, it is split into
the chrysalis renderer and the butterfly renderer, both immutables of `MetamorphMD`.

## The drawing

The card is the prototype's frame (1080×1080, green-black `#0b1410`, hairline grid, ivory `#e9e6da`,
jade `#3ec28f`, gold `#d9a94b`, dim `#9aa89f`), with the stage in the middle:

- **Chrysalis:** the shell, inner shell, folded wing, inner wing, vein, gold band and two gold ticks, every
  contour a line of 0s and 1s.
- **Butterfly:** the open wings of the site's emergence card (`site/components/EmergenceCard.tsx`): the
  upper and lower wing paths, veins and gold spots, mirrored, in the seat's jade tone.

No two cards draw the same. Three layers vary:

- **Per seat:** the wing geometry, vein count, spot count, dots, rings and jade tone are the site's
  `traits(seat)` (`site/lib/seat.ts`), reproduced in integer arithmetic so the chain and the site draw the
  same butterfly for the same seat. All 303 editions of a seat share its silhouette and tone, the way all
  photographs of one specimen share its shape.
- **Per edition:** the shell's form (teardrop 40%, pear 22%, spindle 22%, round 16%), the palette within
  the brand colours (classic 58%, inverted 20%, ember 12%, mono 10%), the halo of digit rings behind the
  figure (none 50%, one ring 30%, two rings 15%, orbit 5%), the signal texture of small digits (none 45%,
  column 25%, band 20%, rain 10%), the density of the contour digits (fine 30%, standard 50%, bold 20%), the
  tilt (−12° to 12°), the size (90% to 110%), the shell's width and length, the band and the segment rings,
  and for the butterfly a ±12% change of the seat's wing geometry with one vein and one spot more or fewer.
  Every digit string is the bits of `keccak256(seat, round, edition, line)`. The weights are those of the
  design reference (`brand/previews/metamorph/metamorph-gen.mjs`, untracked) and go into the contract
  unchanged: a full 3,333-card render gave 2,324 distinct visible families, the largest of 10 cards.
- **Per proof, tier and stage:** a gilt proof paints the card in the gold palette (shell gold, wing jade,
  band ivory) whatever the seed said; edition 1 of a seat has the double gold frame, 2–33 the gold corner;
  the stage decides the whole drawing and the colour of the labels (jade for the chrysalis, gold for the
  butterfly).

Text on the card is minimal: `METAMORPH.MD · PUPATE` small at the top left, the number `#<n>` large under
it, the stage label at the top right (`IN THE COCOON`, `EMERGED`, with `· GILT` appended for a gilt card),
and one small line at the bottom, `seat identity.md #<seat> · edition <e> of 303`. The miner, the price
paid and the site's name are attributes only; the drawing sits centred in the space that leaves.

The JSON `name` is `Metamorph.md #<n>`; its `description` names the seat and the stage. Attributes: Seat,
Round, Edition, Stage, Gilt, Series, Miner, Price paid (PUPATE), Tier (Holotype for edition 1, Paratype for
2–33, Series for the rest), Form, Palette, Halo, Signal, Density, Tone.

## Rarity

From the chain itself: the edition (1 of 303 is the holotype, the first 33 paratypes), the series (the first
is the cheapest; there are eleven), gilt (1 in 16, from the proof), the stage (a butterfly can only exist
for a seat the vault really sold), and the seat's own traits. The oracle work feed, later, adds the seat's
accepted jobs while the vault held it as an attribute and, in a later contract, as a staking weight.

## The Mine page and the miner

- **Steps, as WORKERS lays them out:** 1 Connect, 2 Approve PUPATE (one unlimited approval), 3 Mine, 4
  Auto-mint. The left panel: the status light, the hash rate in large type, engine CPU / GPU, power 25 / 50
  / 75 / 100%, auto-mint on / off, the main button, "or try a practice run" (a practice job at the same
  layout and real speed, before deployment and for anyone curious). The right panel: wallet, PUPATE balance
  with a Buy link, mint price and series, valid hashes this session, and the activity log. A line under the
  button says what runDuties will do and pay for the next mint.
- **The miner:** a hand-written keccak-f[1600] core with 32-bit lanes and the midstate of the constant
  first block, 40,000 hashes per chunk per worker, a one-second benchmark to pick the thread count, a fully
  unrolled WebGPU shader for the GPU engine (one nonce per thread, the same two-word target compare), the
  power control as a duty cycle, and a self-test before the first job: the CPU core's digest must equal
  viem's keccak of the same `abi.encode`, the contract's `workHash()` view, and the GPU's hit must verify on
  the CPU core. The spike of 2026-10-13 measured the generic JS keccak at about 42,000 hashes per second
  per thread; the hand-written core is the budget's basis and is benchmarked in the plan's first task.
- **Jobs:** the page builds a job from `prevWork`, `target`, the newest usable anchor and the miner's
  address; it polls every three seconds and rebuilds the job when `prevWork` changed ("someone minted first,
  your hash expired · mining again"), the target changed, or the anchor is within ten blocks of expiring.
  A found proof is minted at once when auto-mint is on, after rechecking price, allowance and balance; a
  wallet rejection turns auto-mint off; a mint that lost its block is retried once and then re-mined.
- **The workspace:** the visitor's cards with live images and stage, Stake / Unstake, pending IMD and
  Claim, a Refresh button for cards that emerged while staked, the pot and a public Convert button with the
  caller reward shown, and the collection's gallery.
- **Before the first seat:** the page says "Ready. Nothing to mine until the vault holds a seat" with the
  price, the difficulty floor and the practice run available.
- `Addresses` gains `cards` and `art`; reads follow `site/lib/live.ts`, writes the wallet layer.

## Errors the user can meet

| Case | Contract | Page |
|---|---|---|
| someone minted first | `StaleWork` | rebuilds the job, says so, keeps mining |
| the anchor aged out | `BadAnchor` | rebuilds the job before it happens (ten-block margin) |
| the target moved while sending | `NotASolution` | re-reads the target before sending; a lower target keeps old proofs valid, a higher one does not |
| no seat held or none with editions left | `NothingMineable` | shows the state and the vault's seat pot |
| the collection is complete | `SupplyExhausted` | shows 3,333 of 3,333; staking, claims and conversion keep working |
| not enough PUPATE or allowance | the token's errors | shows the price against the balance, links to Buy or to Approve |
| transferring a staked card | `Staked` | the marketplace shows the revert; the page says to unstake first |

## Testing

- **Unit:** the proof at the boundary of the target; bound to the sender, the contract, the chain, the
  anchor and `prevWork`; stale anchors and future anchors refused; a mint voids open proofs; the seat pick
  covers every mineable seat and skips exhausted ones; editions and supply; the price per series; the
  retarget (fast mints raise the difficulty, slow ones lower it, both clamped, the floor rises per series);
  the fee split to the pot and the developer, following `setDeveloper`; `convert` sells within the bound,
  credits the accumulator less the reward, sends IMD to the developer when nobody stakes, leaves the
  remainder in the pot; staking settles correctly for two stakers across conversions; butterfly weight
  after `refresh`; locked transfers; the vault duties run when due, never revert the mint, and forward
  their rewards; the butterfly rule (sold, re-bought, 90 days); `royaltyInfo`; `tokenURI` valid with the
  stage and gilt; the renderer deterministic; both contracts under 24,576 bytes.
- **Fuzz:** random nonces at the floor never pass; random fee amounts split exactly; random stake and
  unstake sequences never pay more IMD than the contract holds.
- **Invariants** (a handler minting with real proofs found off-chain in the test, converting, staking,
  claiming, selling seats through the fixture): `prevWork` always equals the last mint's proof; cards per
  (seat, round) never exceed 303 and the total 3,333; the pot equals 70% of fees minus what `convert` sold;
  the sum of pending IMD never exceeds the IMD balance; the contract never holds ETH after a call.
- **Fork test** on a mainnet fork against the real Cocoon, hook, token, IMD, collection and both pools: the
  vault is given a seat (a holder transfers it, Cocoon adopts it after a fresh floor is written into
  FloorFeed's storage), a proof is mined in the test, minted with duties on, the pot is converted through
  the real pools, a staker claims IMD, and the butterfly appears after the seat is settled.
- **Review:** an independent agent reviews both contracts and the tests without the design's reasoning, as
  the vault had; the mutation checks are repeated; the swap paths and the accumulator get a second pass.
  Nothing is deployed before the review is clean.

## Deployment and opening

- `script/DeployMetamorph.s.sol` deploys `MetamorphArt` then `MetamorphMD` with the mainnet addresses and
  both pool keys, from the launch wallet, run by the owner. `script/mainnet/README.md` gains the step.
- `keeper/addresses.mainnet.json` and `site/lib/addresses.ts` record `cards` and `art`; the keeper gains a
  `convert` duty (the same thresholds) so the pot never waits on a miner; Etherscan verification with the
  rest.
- The contracts may live before the first seat; the Mine page says so and switches on its own when the
  vault holds a seat. The announcement is "contracts live, mining opens with the first seat".

## Public copy to change with this spec

- Mine page: the fee line becomes "paid in PUPATE: 70% to the stakers, converted to IMD; 30% to the
  developer"; "33 per round" becomes "303 per seat, 3,333 in all"; the four stages become two.
- The README, the site and the posts call the cards Metamorph MD; `docs/v2-mining-proof-of-work.md` gets a
  note pointing here.

## Out of scope

The oracle work feed (phase 2); a CLI miner (the puzzle and `workHash` are public, anyone may write one);
cards on the seat sheets and the Work page; marketplace integrations beyond ERC-2981; any change to the
launched contracts; a second token, activation, a burn pool, or time-locked staking.
