# Metamorph MD: the proof-of-work layer

**Date:** 2026-10-13 · **Status:** design approved in conversation (owner, 2026-10-13); this spec is for the
owner's review before the implementation plan. Supersedes the fee and contract layout of
[`docs/v2-mining-proof-of-work.md`](../../v2-mining-proof-of-work.md), which stays as the record of the idea.

## Why

Pupate's token is live and its vault has no operator. The proof-of-work layer gives the project a second
thing to do with a browser besides trading: mine a card of a seat the vault holds. The hash is only the
queue; the meaning of a card is the seat behind it, which the vault really bought and which really works
in the IMD swarm. Mining makes people buy PUPATE in the pool to pay the fees, and every one of those
trades pays the 6% tax that buys more seats.

## Decisions

Owner's decisions, with their dates. Later ones override earlier ones.

- **Scope now (2026-10-13):** the contracts with tests and an independent review, the browser miner and
  a live Mine page. The oracle work feed (rarity from the seat's accepted jobs) comes after the first seat
  works; the pupation threshold is a constant until then.
- **Fees go to the developer, not to a burn (2026-10-13).** Every fee is paid in PUPATE and transferred
  in the same transaction to the developer's address as Cocoon records it (`Cocoon.developer()`). Nothing
  rests in the card contract and no key can redirect it; the developer decides later whether to burn,
  hold or spend. This replaces the 2026-10-10 decision to burn the fees. The Mine page, the README and
  the public posts must say it plainly.
- **Royalty 5% on resale through ERC-2981 (2026-10-13),** paid to the same `Cocoon.developer()`. No transfer
  validator and no operator list: the cards have no admin, so a marketplace that ignores ERC-2981 cannot
  be forced. Primary mints carry no royalty, only the fee.
- **Four stages on one NFT (2026-10-12).** A card is a single ERC-721 token whose image and attributes
  follow its stage: Egg, Larva, Chrysalis, Butterfly. There is no separate token per stage and nothing is
  re-minted; the token id never changes.
- **Only seats the vault holds now are mineable (2026-10-08).** **303 editions per seat per round, and a
  collection of exactly 3,333 cards (2026-10-13):** the first seat opens 303 cards at once; the collection
  closes after eleven seats' worth (11 × 303), finite like Identity MD's 1,999 without copying the number.
- **A minimal label on the image (2026-10-13).** The card prints only the collection mark, the number, the
  stage and one line naming the seat and the edition; the miner, the fees and the site are attributes.
  Chosen from side-by-side renders over the full specimen label and over no text at all.
- **Every card visibly different (2026-10-13).** Beyond the digit strings, each edition draws its own shell
  form, palette, halo, signal, density, tilt and size, so that all 3,333 are told apart at thumbnail size.
  The owner reviewed a full render of the collection before this was fixed.
- **Price and difficulty rise as the collection fills (2026-10-12, numbers 2026-10-13):** the difficulty
  retargets every epoch of 33 eggs; the price steps ×1.25 every series of 303 eggs, one seat's worth; eleven
  series, the last about 9.3 times the first.
- **Names (2026-10-13).** The collection is **Metamorph MD** (ERC-721 `name`), symbol **MMD**, in the
  manner of Identity MD. Each token is named **`Metamorph.md #<n>`** where `n` is the token id, counted from 1
  in mint order across all seats, the way `identity.md #994` is named by its id. The seat a card comes from,
  its round and its edition are attributes and are drawn on the card; they are not part of the name. The
  contracts are `MetamorphMD` and `MetamorphArt`; "chrysalis" is only the name of the third stage.
- **No keys over the cards.** Every number below is a constant or an immutable set in the constructor.
  There is no owner, setter, pause, upgrade or withdraw.

## What is built

Two contracts and one page.

| Unit | Does | Depends on |
|---|---|---|
| `MetamorphMD` (ERC-721) | The puzzle, the epochs, the fees, the four stages, `tokenURI`, ERC-2981 | Cocoon (read only), PupateToken (`transferFrom`), the identity.md collection (`ownerOf`), `MetamorphArt` |
| `MetamorphArt` | Draws a card as SVG from its facts; pure, no storage | nothing |
| Mine page + miner | Picks a seat, mines in Web Workers, mints, feeds, pupates, shows the visitor's cards | the site's live layer and wallet layer; `MetamorphMD` |

Cocoon, PupateHook, PupateToken, FloorFeed and the timelock are not changed and gain no new role.

## The puzzle and the epochs

A **solution** is a nonce such that

    uint256(keccak256(abi.encode(miner, seat, epoch, nonce))) < type(uint256).max / difficulty

where `miner` is the address that will submit it (`msg.sender`), `seat` the identity.md token id, and
`epoch` the current epoch. A solution therefore belongs to one wallet, one seat and one epoch; nobody can
submit another miner's nonce, and a nonce found in an earlier epoch is worthless. Each accepted solution's
digest is recorded so it cannot be submitted twice.

An **epoch** is 33 eggs minted, across all seats. When the 33rd egg of an epoch is minted, the contract
advances the epoch in the same transaction:

- the difficulty is retargeted by how long the epoch took against the target of 33 eggs in 19,800
  seconds (one egg per 10 minutes): `next = difficulty × 19,800 / elapsed`, clamped to no less than a
  quarter and no more than four times the previous difficulty, and never under the minimum difficulty;
- the epoch's counters (eggs, per-wallet eggs, per-card feeds) start again.

A **series** is 303 eggs, one seat's worth; the epochs of 33 eggs run independently of it. The mint price
is `BASE_PRICE × 1.25^series`, where `series` is `totalMinted / 303`, so it steps up once per full series and
never between. The collection closes when `totalMinted` reaches 3,333 (`MAX_SUPPLY`): the eleventh series
is the last and `mintEgg` reverts with `SupplyExhausted` after it. A seat's editions run out at 303 for its
(seat, round) whatever the series.

Feeding solutions do not count toward the epoch; only eggs do. The difficulty applies to every solution of
the epoch, eggs and feeds alike.

## The card's life

| Stage | Reached by | Pays |
|---|---|---|
| **Egg** | `mintEgg(seat, nonce)`: one solution, a seat the vault holds, editions left for (seat, round), supply left, the wallet's epoch cap not reached | the mint price in PUPATE, to the developer |
| **Larva** | the first `feed(cardId, nonces[])`; each accepted solution adds one to the card's `work`; the card is *ripe* at 64 | gas only |
| **Chrysalis** | `pupate(cardId)` by the card's owner (or an approved operator) once ripe; records `pupatedAt` | the mint price of the current epoch in PUPATE, to the developer |
| **Butterfly** | computed, never sent: seven days after pupation **and** the vault no longer holds that (seat, round), or ninety days after pupation whatever happened to the seat | nothing |

"The vault no longer holds (seat, round)" is read from Cocoon: `seats(seat)` returns `held` and `round`;
the card's seat is sold when `held` is false, or `round` differs from the card's round (the vault bought the
seat again), or the collection's `ownerOf(seat)` is not Cocoon. `stageOf(cardId)` and `tokenURI` apply this
rule on every read, so no card can be stuck waiting for a transaction nobody sends.

Anyone may feed any card; the solutions are bound to the feeder, so a friend can spend their own hashes on
your card. Only the owner can pupate, because pupation costs a fee. A card can be sold at any stage; the
buyer continues it. Feeding after ripeness is allowed up to the card's per-epoch cap, and the extra work
is recorded and drawn (nothing else depends on it).

### Numbers

| Constant | Value | Why |
|---|---|---|
| `EDITIONS` | 303 per (seat, round) | the owner's figure of 2026-10-13: 11 × 303 = 3,333 |
| `MAX_SUPPLY` | 3,333 cards | eleven seats' worth; the collection is finite |
| `EPOCH_EGGS` | 33 | the difficulty's retarget interval |
| `SERIES_EGGS` | 303 | the price's step interval, one seat's worth |
| `BASE_PRICE` | 50,000 PUPATE | about $1.50 at launch-week prices |
| price growth | ×1.25 per series, eleven series at most | the last series is about ×9.3 the first, 465,661 PUPATE |
| `INITIAL_DIFFICULTY` | 2^24 | about 17 million hashes, roughly 15 seconds on a laptop CPU in the browser |
| `MIN_DIFFICULTY` | 2^20 | a floor so an idle network never becomes free |
| retarget clamp | ÷4 to ×4 per epoch | the same bound Bitcoin uses |
| `TARGET_EPOCH_SECONDS` | 19,800 | 33 eggs at one per 10 minutes |
| `WALLET_EGGS_PER_EPOCH` | 3 | a farm cannot sweep an edition in one epoch |
| `CARD_FEEDS_PER_EPOCH` | 16 | breadth, not depth: a GPU cannot rush one card |
| `RIPE_WORK` | 64 solutions | four epochs of full feeding at the cap, or fewer with patience |
| `COCOON_PERIOD` | 7 days | the chrysalis is sealed for a week |
| `COCOON_CEILING` | 90 days | no card waits forever for a sale |
| royalty | 500 bps | the owner's 5% |

## Interfaces

`MetamorphMD`:

- `mintEgg(uint256 seat, uint256 nonce)`, `feed(uint256 cardId, uint256[] calldata nonces)`,
  `pupate(uint256 cardId)`.
- Views: `epoch()`, `series()`, `difficulty()`, `target()`, `mintPrice()`, `eggsInEpoch()`, `epochStartedAt()`,
  `editionsMinted(seat, round)`, `eggsMintedBy(epoch, wallet)`, `feedsIn(cardId, epoch)`, `cards(cardId)`
  (seat, round, edition, stage as stored, work, mintedEpoch, pupatedAt, miner, paid), `stageOf(cardId)`
  (with the butterfly rule applied), `isSolution(miner, seat, epoch, nonce)`, `mineable(seat)` (held by the
  vault and editions left), `tokenURI`, `royaltyInfo`, `supportsInterface` (ERC-165, 721, 721Metadata, 2981),
  `totalMinted()`.
- Events: `EggMinted(cardId, seat, round, edition, miner, epoch, fee)`, `Fed(cardId, feeder, solutions,
  work)`, `Pupated(cardId, fee)`, `EpochAdvanced(epoch, difficulty, mintPrice)`. The butterfly has no event
  because it is not a transaction.
- Errors: `SeatNotHeld`, `EditionsExhausted`, `SupplyExhausted`, `WalletCapReached`, `CardCapReached`, `NotASolution`,
  `SolutionUsed`, `WrongStage`, `NotRipe`, `NotCardOwner`, `NothingToFeed`, `ZeroAddress`.
- Constructor: `(Cocoon cocoon, PupateToken token, IERC721Minimal collection, MetamorphArt art)`, all
  immutable. The developer address is never stored; it is read from Cocoon at each payment and each
  royalty query, so it follows `Cocoon.setDeveloper`.

The fee is `token.transferFrom(msg.sender, cocoon.developer(), fee)`; the miner approves the card contract
once. If the transfer returns false or reverts, the mint or pupation reverts.

`MetamorphArt`:

- `render(View calldata v) pure returns (string memory svg)` with `View = {seat, round, edition, stage,
  work, ripeWork, miner, paid, mintedEpoch}`; `MetamorphMD.tokenURI` wraps it as
  `data:application/json;base64,…` with the image as `data:image/svg+xml;base64,…`.
- If the renderer does not fit under the 24,576-byte contract limit in one piece, it is split into two
  pure contracts (the chrysalis stages and the butterfly), both immutables of `MetamorphMD`.

## The drawing

The card is the prototype's frame (1080×1080, green-black `#0b1410`, hairline grid, ivory `#e9e6da`,
jade `#3ec28f`, gold `#d9a94b`, dim `#9aa89f`), with the stage in the middle:

- **Egg:** a small oval traced by one line of 0s and 1s, a gold point, the band below it empty.
- **Larva:** the chrysalis shell outline traced in 0s and 1s, filling from the bottom in proportion to
  `work / ripeWork`; the fill is the second, fainter line of digits.
- **Chrysalis:** the prototype as it is: shell, inner shell, wing, inner wing, vein, gold band, two
  gold ticks.
- **Butterfly:** the open wings of the site's emergence card (`site/components/EmergenceCard.tsx`): the
  upper and lower wing paths, veins and gold spots, mirrored, in the seat's jade tone.

No two cards draw the same. Three layers vary:

- **Per seat:** the wing geometry, vein count, spot count, dots, rings and jade tone are the site's
  `traits(seat)` (`site/lib/seat.ts`), reproduced in integer arithmetic so the chain and the site draw the
  same butterfly for the same seat. All 303 editions of a seat share its silhouette and tone, the way all
  photographs of one specimen share its shape.
- **Per edition:** the shell's form (teardrop 40%, pear 22%, spindle 22%, round 16%), the palette within the
  brand colours (classic 55%, inverted 20%, ember 12%, mono 10%, gilt 3%), the halo of digit rings behind the
  figure (none 50%, one ring 30%, two rings 15%, orbit 5%), the signal texture of small digits (none 45%,
  column 25%, band 20%, rain 10%), the density of the contour digits (fine 30%, standard 50%, bold 20%), the
  tilt (−12° to 12°), the size (90% to 110%), the shell's width and length, the band and the segment rings,
  and for the butterfly a ±12% change of the seat's wing geometry with one vein and one spot more or fewer.
  Every digit string is the bits of `keccak256(seat, round, edition, line)`. The weights are those of the
  design reference (`brand/previews/metamorph/metamorph-gen.mjs`, untracked) and go into the contract
  unchanged: a full 3,333-card render gave 2,324 distinct visible families, the largest of 10 cards, told
  apart by proportions, tilt, size and digits.
- **Per tier and stage:** edition 1 has the double gold frame, 2–33 the gold corner; the stage decides
  the whole drawing and the colour of the labels (jade until the butterfly, gold after). Text on the card is minimal: `METAMORPH.MD · PUPATE` small at the top left, the number `#<n>` large
under it, the stage label at the top right (`EGG`, `LARVA · 23 OF 64`, `IN THE COCOON`, `EMERGED`), and one
small line at the bottom, `seat identity.md #<seat> · edition <e> of 303`. The miner, the fees paid and the
site's name are attributes only; the drawing sits centred in the space that leaves. The first edition carries a double gold frame, editions two to thirty-three a gold corner.

The JSON `name` is `Metamorph.md #<n>`; its `description` names the seat and the stage. Attributes: Seat, Round, Edition, Stage, Work, Epoch mined, Series, Miner, Fees paid (PUPATE), Tier (Holotype
for edition 1, Paratype for 2–33, Series for the rest), Form, Palette, Halo, Signal, Density, Tone.

## Rarity, in this version

Rarity comes from facts the chain already has: the edition (1 of 303 is the holotype, the first 33 are
paratypes), the series of the mint (the first series is the cheapest and there are eleven), the stage (an emerged butterfly can only exist for a seat the vault
really sold), the work recorded beyond ripeness, and the seat's own traits. The oracle work feed, later,
adds the seat's accepted jobs while the vault held it; when it exists, a new card contract for the seats
bought after it can scale the pupation threshold by that number. This contract's threshold stays 64.

## The Mine page and the miner

- **Before deployment** the page keeps its present copy, corrected to say the fees go to the developer.
- **Deployed, no seat held:** "Ready. Nothing to mine until the vault holds a seat", with the epoch, the
  price and the difficulty read live.
- **Seat(s) held:** a seat picker (seat number, days held, editions left of 303), the miner, the queue of found
  solutions, the Mint button, the visitor's cards with their live images, and per card the Feed and Pupate
  controls with the countdown to the butterfly.
- **The miner** is a pool of Web Workers (`site/workers/miner.worker.ts`), default `hardwareConcurrency −
  1` threads, adjustable from one upward, hashing `keccak256(abi.encode(miner, seat, epoch, nonce))` with a
  fast keccak over a preassembled 128-byte buffer in which only the nonce word changes. Each worker starts
  at a random 256-bit offset. It reports the hash rate and the solutions found. A solution is kept only for
  the epoch it was found in; the page re-reads `epoch()` before sending and drops stale ones with a note.
- **Transactions** go through the site's existing wallet layer (`writeContractAsync`): one unlimited
  `approve` of PUPATE to the card contract, then `mintEgg`, `feed` (batches of up to 16), `pupate`. The
  page shows the price in PUPATE and the visitor's balance, with a link to Buy when it is short.
- **Reads** follow `site/lib/live.ts`: multicall of the contract's views, the visitor's cards from
  `Transfer` logs since the deployment block, images from `tokenURI`.
- `Addresses` gains optional `cards` and `art` fields; `MAINNET` is filled after deployment.

## Errors the user can meet

| Case | What happens | What the page does |
|---|---|---|
| epoch advanced between mining and sending | `NotASolution` | re-reads the epoch first; drops the stale queue and says why |
| seat sold or re-bought between mining and minting | `SeatNotHeld` | re-reads `mineable(seat)` before sending |
| editions ran out | `EditionsExhausted` | shows editions left live; disables Mint at zero |
| the collection is complete | `SupplyExhausted` | shows "3,333 of 3,333" and keeps Feed and Pupate working |
| wallet cap reached | `WalletCapReached` | shows "3 of 3 this epoch" |
| not enough PUPATE | the token's `InsufficientBalance` | shows the price against the balance, links to Buy |
| feeding a chrysalis or butterfly | `WrongStage` | hides Feed for those stages |

## Testing

- **Unit:** the puzzle at the boundary of the target; solutions bound to the sender, the seat and the
  epoch; replay refused; editions, supply, wallet and card caps; the price schedule (×1.25 per series of
  303, flat inside a series, eleven series); the
  retarget (fast epoch raises, slow epoch lowers, both clamped, floor respected); fees land on the
  developer and follow `setDeveloper`; the stage machine and every `WrongStage`; the butterfly rule
  (seven days and sold, ninety days regardless, re-bought seat counts as sold); `royaltyInfo`; `tokenURI`
  is valid JSON with a valid SVG that changes with the stage; the renderer is deterministic; both contracts
  fit under 24,576 bytes.
- **Fuzz:** random nonces at high difficulty never pass; random caps and editions hold; the price never
  overflows.
- **Invariants** (handler minting, feeding, pupating, selling seats through the fixture): every card has a
  recorded solution digest; cards per (seat, round) never exceed 303 and the total never exceeds 3,333; a card's stored stage never
  decreases; the developer's PUPATE received from the cards equals the sum of fees in events; PUPATE's
  total supply is unchanged by the cards (they burn nothing).
- **Fork test** on a mainnet fork against the real Cocoon, token and collection: the vault is given a seat
  (the collection's holder transfers it, Cocoon adopts it after a fresh floor is written into FloorFeed's
  storage with `vm.store`), a card is mined off-chain in the test, minted, fed to ripeness, pupated, and
  the butterfly appears after the seat is settled and the cocoon period passes.
- **Review:** an independent agent reviews both contracts and the tests without the design's reasoning,
  as the vault had, and the mutation checks are repeated. Nothing is deployed before the review is clean.

## Deployment and opening

- `script/DeployMetamorph.s.sol` deploys `MetamorphArt` then `MetamorphMD` with the mainnet addresses,
  from the launch wallet, run by the owner. `script/mainnet/README.md` gains the step.
- `keeper/addresses.mainnet.json` and `site/lib/addresses.ts` record `cards` and `art`; the Etherscan
  verification goes with the rest.
- The contracts may live before the first seat; the Mine page says so and switches on its own when
  `Cocoon.heldCount()` becomes one or more. The announcement is "contracts live, mining opens with the
  first seat".

## Public copy to change with this spec

- Mine page: "33 per round" becomes "303 per seat, 3,333 in all"; the fee line ("paid in PUPATE, burned in full. No treasury takes a cut") becomes "paid in
  PUPATE to the developer, who decides whether to burn or spend it; stated here so nobody is surprised".
- The Mine page, the README and the site call the cards Metamorph MD; "Chrysalis Cards" goes.
- README's Chrysalis line, the X thread's card post and `docs/v2-mining-proof-of-work.md` get a note that
  the fees go to the developer.

## Out of scope

The oracle work feed; a WebGPU or CLI miner (the puzzle is public, anyone may write one); cards on the
seat sheets and the Work page; marketplace integrations beyond ERC-2981; any change to the launched
contracts.
