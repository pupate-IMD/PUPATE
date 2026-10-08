# v2 design: Chrysalis Cards, a mined collectible backed by real work

Status: design only, for after the hackathon launch. Nothing here changes the launched contracts.
Written 2026-10-08 after the project owner asked for a "POW" feature in the spirit of
[imdworkers.fun](https://imdworkers.fun/).

## What WORKERS does, in one paragraph

WORKERS is a browser-mining NFT platform on IMD. A visitor's browser hashes nonces until it finds a
hash under an epoch difficulty; the wallet address is inside the hash, so a solution belongs to its
finder. Each solution is the right to mint one of 3,333 worker NFTs for a fee in IMD (0.25–5 IMD by
epoch). Minted workers are activated (0.15 IMD) to emit a second token, $WORK, which can be staked
(7/14/30 days at 1×/2×/4×) for IMD from the mint fees, or burned against a 50M $WORK pool. $WORK was
launched through IMD paired with IMD on Robinhood Chain, with a 2% trade fee and a 50%→2% opening
fee decay. The proof of work is the distribution mechanism; the hashes do no useful work.

## Why not copy it

Pupate's claim is the opposite of a hash: the vault's seats do real, judged work in the IMD swarm,
and the site now proves it from IMD's own records (`/work`). Bolting hash-mining onto the token would
blur that. A second emission token would dilute PUPATE's one story (tax → seats → burn). And any new
contract is new audit surface: not before the launch.

## What fits: mine a card of a seat that worked

Every seat the vault buys already has a drawing: the chrysalis of its number, which turns into its
butterfly when the seat sells (the emergence cards on the seat sheets). v2 turns those into
collectibles whose **distribution** is a browser proof of work, like WORKERS, but whose **meaning**
is Pupate's: each card is a seat the vault really held, carrying the work that seat really did.

- **Card** = ERC-721 "Chrysalis Card" for one `(tokenId, round)` the vault has held (the vault's
  `seats(tokenId).round` already distinguishes repurchases). A bounded number of editions per seat
  (say 33). Art on-chain: the same deterministic SVG as the site, so no server.
- **Mining** = the browser searches nonces for `keccak(minter, seatId, epoch, nonce) < target`, as
  WORKERS does, so a solution is bound to the wallet. Difficulty adjusts per epoch toward a target
  cadence (for example one solution per minute network-wide) so neither a GPU farm nor a phone is
  shut out entirely; a per-wallet cap per epoch limits farms.
- **Mint fee in PUPATE, burned.** A solution lets the finder mint by paying a fee in PUPATE that the
  Mine contract burns through `PupateToken.burnFrom`. Mining therefore feeds the token's one sink
  instead of a treasury: more cards, less supply. (Alternative: a fee in ETH sent to the vault's seat
  pot through `depositTax`-like plain ETH, which the vault books as proceeds; this buys more seats.
  Pick one at build time; PUPATE burn is the simpler story.)
- **Metamorphosis on-chain.** A card minted while the vault holds the seat is a chrysalis; when the
  seat's listing fills (`SeatSold`), `tokenURI` flips to the butterfly. No admin: the Card contract
  reads `Cocoon.seats(tokenId).held` and the event, nothing else.
- **Rarity from real work.** The IMD oracle can attest a number for a pinned question just as
  FloorFeed consumes the floor; a second feed, "accepted jobs of seat X", lets the card's traits (and
  edition count) follow the work the seat actually did while the vault held it. This is the part no
  hash-mining project can copy: the proof of work in the hash is spent on a proof of work by a seat.

## Contracts (new, not changes)

| Contract | Does | Owner |
|---|---|---|
| `ChrysalisCards` (ERC-721) | Mints `(seat, round, edition)`; on-chain SVG; `tokenURI` reads Cocoon for held/sold; traits read the work feed | none, or the existing 48-hour timelock for the three bounded knobs |
| `CardMine` | Epochs, difficulty retarget, solution verification (`keccak256(abi.encode(minter, seat, epoch, nonce)) < target`), replay guard, per-wallet cap, fee in PUPATE burned via `burnFrom` | same |
| `WorkFeed` (optional) | FloorFeed's twin for "accepted jobs of seat X", reported from IMD oracle attestations | timelock |

Cocoon, PupateHook, PupateToken, FloorFeed are not touched. The Cards only read them.

## Economics to decide at build time

- Editions per seat (33?), fee per epoch (flat, or rising like WORKERS), epoch length, target cadence,
  per-wallet cap, whether unsolved epochs roll over.
- Secondary royalty (WORKERS: 0 on mint, 5% on resale): if any, it should go to the burn pot, not a
  treasury, to keep "no treasury" true.
- Which seats are mineable: only seats the vault holds now (scarce, live) or any seat it ever held
  (a growing catalogue). Holding-only keeps the mining tied to the vault's present work.

## Risks

- Browser mining is energy and attention spent for a lottery; some users dislike it. Keep the mint
  fee the real price and the hash only the queue.
- GPU miners outcompete phones; caps and retargeting only soften that.
- A card market can distract from the token. Cards must stay a lens on the seats, not a second product
  line: no emissions, no staking, no "card token".
- New contracts need the same treatment as the first set: tests, invariants, two independent reviews,
  the swarm's review if launched through IMD as `evm_contracts`.

## Sequence

1. After the mainnet launch and the hackathon submission.
2. Spec revision (this document → a numbered spec), then the Card and Mine contracts with Foundry tests
   and invariants (no mint without a valid solution; fee always burned; `tokenURI` never lies about
   held/sold; caps hold), then review.
3. The browser miner in the site (a Web Worker, adjustable power, the same design language), the
   mint flow through the existing wallet layer, cards on the seat sheets.
4. Optional: the work feed through the IMD oracle, for traits.

Rough size: two small contracts and a miner UI, two to three weeks including review.
