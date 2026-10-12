---
name: pupate-keeper
description: Run the public duties of Pupate on Ethereum mainnet (flush, buy a seat, burn, settle, the auctions, the floor report) and collect the caller reward where one is paid.
---

# Pupate keeper

Pupate is a token on Ethereum whose trading tax buys Identity MD seats. Nobody operates it. Every
duty below is a public function: whoever calls it first moves the mechanism forward, and two of the
duties pay the caller. This file tells an agent what the duties are, when each one can be run, what
it pays and how it fails. You need an Ethereum wallet with ETH for gas, and no permission, allowlist
or account with Pupate.

## Run the vault and get paid

Live on Ethereum mainnet (chain id 1) since 2026-10-12 16:08 UTC, IMD launch #1434. These are the
only Pupate addresses; anything else is a scam. The opening buy-tax window closed 93 minutes after
the open; the tax is 6% of the ETH side of every buy and sell. The same duties with buttons, for a
visitor with a wallet, are at `https://pupate.fun/run/`.

| Contract | Address |
|---|---|
| Cocoon (the vault) | `0x54993066369e57a49215f6fc2D9911a8e5a57a79` |
| PupateHook (collects the tax) | `0xb5e544166144a590e171bf0350e8f227858318cc` |
| FloorFeed (the reference price) | `0x5A215aa9883cEfE5fa74085ba66288388b83700C` |
| PUPATE token | `0x59fb66660626a6a2c7e0e1a39af1367d09ed92b0` |
| TimelockController (48 h) | `0x8bE826082c0FbAeC485048aA26ef42aC147898EC` |
| PupateVesting | `0xF0fe8B9a80366469F7FE6C82dF61330b3682B048` |
| Pool ETH/PUPATE (fee 12500, spacing 60) | id `0xd4cd0ab2c332b918dae711bbb0a7ac24cd5dd80dabbd3c92c196388c45eca8a7` |
| Identity MD collection | `0x0000eC93127BAA929E58E97dd0095A2BFb38ec1D` |
| Seaport 1.6 | `0x0000000000000068F116a894984e2DB1123eB395` |
| IMD token | `0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7` |
| IMD oracle signer | `0x5598Aa9146215Bc13eb26f2c692Ad1461Fd32982` |

The duties, the rule that lets each one through, and what it pays. `callerRewardBps` is 50 (0.5%;
the contract caps it at 1%) and `burnSpacing` is 5 blocks; `getParams()` has the current values.

| Duty | Call | Goes through when | Pays the caller |
|---|---|---|---|
| Flush | `PupateHook.flush()` | the hook's ETH claims on the PoolManager, `balanceOf(hook, 0)`, are not zero | nothing |
| Buy a seat | `Cocoon.buySeat(order, [])` | the feed is fresh, the order passes the rules in step 2, and the seat pot covers the price plus 0.5% | 0.5% of the ETH spent |
| Settle | `Cocoon.settleSeat(id)` | a held seat has left the vault, or one of its two Seaport orders shows a fill | nothing |
| Adopt | `Cocoon.adopt(id)` | the vault owns a seat that is not on its books, and the feed is fresh | nothing |
| Burn | `Cocoon.burn()` | the burn pot is not empty and the block is at least `lastBurnBlock + 5` | 0.5% of the ETH spent |
| Open a harvest auction | `Cocoon.startAuction(token)` | the vault holds an ERC-20 other than PUPATE or the collection, and no auction runs for it | nothing |
| Take a harvest auction | `Cocoon.takeAuction(token)` with ETH | an auction runs; send at least `auctionPrice(token)` | the whole lot, for the price of the moment |
| Open the IMD auction | `Cocoon.startImdAuction()` | `imdBurnBalance()` is not zero and no IMD auction runs | nothing |
| Take the IMD auction | `Cocoon.takeImdAuction()` | an IMD auction runs and you approved `imdDemand()` IMD to Cocoon | the ETH lot, for the IMD demanded now |
| Report | `FloorFeed.report(a, sig)` | you hold a valid IMD attestation for the pinned question, newer than the stored one | nothing (the attestation costs 0.5 IMD) |

One command per duty with Foundry's `cast`. Run the `cast call` form of a send first: it simulates
the call and names the error when the duty is not ready, and a reverted send costs gas.

```sh
RPC=https://…; KEY=0x…
HOOK=0xb5e544166144a590e171bf0350e8f227858318cc; COCOON=0x54993066369e57a49215f6fc2D9911a8e5a57a79
FEED=0x5A215aa9883cEfE5fa74085ba66288388b83700C; IMD=0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7
PM=0x000000000004444c5dc75cB358380D2e3dE08A90   # the Uniswap v4 PoolManager
cast call $PM "balanceOf(address,uint256)(uint256)" $HOOK 0 --rpc-url $RPC   # flush is ready if not 0
cast send $HOOK "flush()" --rpc-url $RPC --private-key $KEY
cast call $COCOON "burnPot()(uint256)" --rpc-url $RPC                        # and lastBurnBlock()(uint256)
cast send $COCOON "burn()" --rpc-url $RPC --private-key $KEY
cast send $COCOON "settleSeat(uint256)" $ID --rpc-url $RPC --private-key $KEY
cast send $COCOON "adopt(uint256)" $ID --rpc-url $RPC --private-key $KEY
cast send $COCOON "buySeat(((address,address,(uint8,address,uint256,uint256,uint256)[],(uint8,address,uint256,uint256,uint256,address)[],uint8,uint256,uint256,bytes32,uint256,bytes32,uint256),uint120,uint120,bytes,bytes),(uint256,uint8,uint256,uint256,bytes32[])[])" "$ORDER" "[]" --rpc-url $RPC --private-key $KEY
cast send $COCOON "startAuction(address)" $TOKEN --rpc-url $RPC --private-key $KEY
cast call $COCOON "auctionPrice(address)(uint256)" $TOKEN --rpc-url $RPC     # pass it as $PRICE
cast send $COCOON "takeAuction(address)" $TOKEN --value $PRICE --rpc-url $RPC --private-key $KEY
cast send $COCOON "startImdAuction()" --rpc-url $RPC --private-key $KEY
cast call $COCOON "imdDemand()(uint256)" --rpc-url $RPC                      # pass it as $DEMAND
cast send $IMD "approve(address,uint256)" $COCOON $DEMAND --rpc-url $RPC --private-key $KEY
cast send $COCOON "takeImdAuction()" --rpc-url $RPC --private-key $KEY
cast send $FEED "report((bytes32,uint256,bytes32,uint8,bytes,uint256,uint64,uint64,bytes32,bytes32,uint16,uint16,uint16,uint64,uint64),bytes)" "$ATTESTATION" $SIG --rpc-url $RPC --private-key $KEY
```

`$ORDER` is a listing's Seaport `AdvancedOrder`: its `parameters`, numerator 1, denominator 1, its
signature, empty `extraData`. `$ATTESTATION` and `$SIG` are the `message` and `signature` of
`https://api.imd.fun/oracle/requests/{id}/attestation` for the pinned question
`0x0bd457cf1b0d092b4f12904589b3f08b5c67793cc4ef5292d79b2733ba5bab24`.

**Strangers are paid.** Within 90 minutes of the open the hook had collected 0.32 ETH of tax, and the
first `burn()` was sent by a stranger, `0x1b9d70b357e84ab805beca00a3f464be0a68d1ac`, in transaction
`0x006b19a01a90a122a59d54873cb957d12d4f4b8fa11d9484e9a840e2a1834c92` (block 26177928): the vault
spent 0.10907 ETH, burned 7,235,926.509 PUPATE, and paid the caller 0.000545 ETH in the same
transaction (the `Burned` event carries all four figures).

**Two listing rules before you search:** a purchase must pay at least half the floor, measured on
what is actually paid once Seaport returns the unused part of a falling price, and the offerer may not
be Cocoon; both revert with `BadOrder`. **What you cannot do:** nothing moves value to the caller
beyond the reward (the full list is at the end).

## What to read first

| Call | Tells you |
|---|---|
| `FloorFeed.latest()` returns `(uint256 floorWei, bool fresh)` | The reference price, and whether the vault may buy on it. |
| `Cocoon.seatPot()`, `burnPot()`, `imdBurnBalance()`, `lastBurnBlock()`, `getParams()` | The pots, the last burn, and the tolerance, reward, impact limit, spacing and listing terms. |
| `Cocoon.seats(id)`, `heldCount()`, `auctions(token)`, `auctionPrice(token)`, `imdAuction()`, `imdDemand()` | The held seats and what they cost; the running auctions and their price or demand now. |

## Live state

`https://pupate.fun/status.json` (schema `pupate-status/1`) is the developer's keeper's view of the
above, rewritten after every tick: the feed, the pots, the mode, each held seat's listing price now,
the auctions, and `steps`, where each `steps.<name>.ready` says whether that duty would go through
right now and `why` not otherwise; `steps.buySeat.bestListingWei` is the cheapest listing that passes
the checks. If the file is missing or `keeper.lastTickAt` is older than a few minutes, use the RPC
reads above. `https://pupate.fun/listings.json` (`pupate-listings/1`) has the candidate listings the
keeper last saw, each with a `reason` when it fails a rule. The chain, not the file, is the truth
when they disagree.

## The steps

### 1. Flush the tax

`PupateHook.flush()`

Moves the tax the hook has collected into Cocoon, which splits it 85% strategy (seat pot and burn
pot, by the mode), 10% developer, 5% IMD burn. Reverts with `NothingToFlush` when nothing has been
collected. Reward: none. Run it when it makes one of the paid duties possible.

### 2. Buy a seat

`Cocoon.buySeat(AdvancedOrder order, CriteriaResolver[] resolvers)`

Fulfils a Seaport 1.6 listing of one Identity MD seat for ETH, then lists the seat for sale from
the vault at 1.5× cost falling to 1.1× over 14 days. You supply the order; the vault pays from the
seat pot. It runs when all of these hold:

- `FloorFeed.latest()` is fresh (otherwise `FloorNotFresh`).
- The highest price the order can ask is at most `floorWei * (10000 + toleranceBps) / 10000`, 105%
  today (otherwise `PriceAboveFloor`).
- What is actually paid, after Seaport returns the unused part of the price, is at least `floorWei / 2`
  (otherwise `BadOrder`).
- The seat pot covers the price plus the reward (otherwise `PotTooSmall`).
- The order offers exactly one seat of the collection, in full (numerator = denominator = 1,
  `FULL_OPEN` or `FULL_RESTRICTED`), from an offerer other than Cocoon, for native ETH only, every
  consideration item non-zero and paid to someone other than Cocoon, and the consideration array is
  exactly the original one (otherwise `BadOrder`).
- The vault does not already hold that seat (otherwise `AlreadyHeld`; such a seat is adopted for nothing).

Reward: `callerRewardBps` of the ETH actually spent, paid to you in the same transaction.

Find listings through the OpenSea API or Seaport's `OrderValidated` events and pick the cheapest
order that passes the checks above; skip orders in OpenSea's signed zone (`0x000056F7…D100`), which
need extra data the vault does not pass.

### 3. Settle a sold seat, adopt a given one

`Cocoon.settleSeat(uint256 tokenId)` takes a seat whose listing has filled off the vault's books and
cancels its other order (`StillHeld` while the listing is open, `NotHeld` if the seat is not on the
books); the sale's ETH is already in the burn pot. `Cocoon.adopt(uint256 tokenId)` is the opposite
case: a seat sent to the vault directly is taken onto the books at the floor and listed. Reward: none.

### 4. Burn

`Cocoon.burn()`

Spends the burn pot on PUPATE in the launch pool and destroys what it buys. One call may move the
pool price by at most `burnImpactBps` (5%), so a large pot takes several calls. Reverts with
`TooSoon` until `burnSpacing` blocks have passed since `lastBurnBlock`, with `NothingToBurn` when
the pot is empty, and with `NothingBought` while the pool price is parked above its liquidity.

Reward: `callerRewardBps` of the ETH spent, paid to you in the same transaction.

### 5. Harvest auctions

`Cocoon.startAuction(address token)`, then `Cocoon.takeAuction(address token)` with ETH

Tokens the seats earned while working sit in Cocoon. `startAuction` puts the vault's whole balance
of one token up for sale at `harvestStartWei`, 100 ETH today; the price halves every 2 hours, falls
in a straight line inside each half-life, and is zero from 48 hours on. `takeAuction` buys the whole
lot at the price of that moment; the excess comes back. PUPATE and the seats cannot be auctioned
(`NotForAuction`). Reward: none for starting; the taker's gain is the gap between the falling price
and what the lot is worth. The ETH goes to the seat pot.

### 6. The IMD auction

`Cocoon.startImdAuction()`, then `Cocoon.takeImdAuction()`

5% of the tax is set aside to buy IMD and destroy it. `startImdAuction` offers that ETH; the IMD
asked for it starts at `imdStartPerEth` (20,000 IMD per ETH of the lot) and falls on the same
curve. `takeImdAuction` pulls `imdDemand()` IMD from you (approve Cocoon first), sends it to the dead
address and pays you the ETH. Reward: none for starting; the taker's gain is the gap between the ETH
received and the IMD given.

### 7. Report the reference price

`FloorFeed.report(Attestation a, bytes sig)`

Stores a new reference price from an IMD oracle attestation for the pinned question (the
collection's lowest OpenSea listing, read by a panel of 20 seats, 11 agreeing). The feed checks the
signer, the question, the quorum and the validity window, and refuses a rise of more than 25% per
6 hours. As of 2026-10-13 the feed holds no report: until one is stored, `buySeat` and `adopt`
revert with `FloorNotFresh` and the vault splits deposits half and half (NEUTRAL).

Reward: none, and an attestation costs 0.5 IMD. The project's keeper is meant to pay for one every
six hours; submit one yourself if that has stopped and you want the vault to buy.

## A sensible loop

1. Read `FloorFeed.latest()`, the pots and `getParams()`, or `status.json` when it is fresh.
2. If the hook holds tax and a pot is close to useful, `flush`.
3. If the feed is fresh and the seat pot covers a listing within tolerance, `buySeat`.
4. If the burn pot is not empty and the spacing has passed, `burn`.
5. Settle any seat whose listing has filled; adopt any seat sent in directly.
6. Open an auction that can be opened; take one when the price is worth it to you.
7. Wait a few blocks and repeat.

## What you cannot do

No duty lets a caller move the vault's ETH anywhere but a Seaport seat purchase, a PUPATE burn, an
auction's payout to its taker or the caller reward. No duty raises the tax, changes a parameter or
transfers a seat. A caller cannot choose the price the vault pays above the tolerance or under half
the floor, cannot sell the vault a seat it already holds, and cannot route a purchase's ETH to itself.

## Risks to you

- Another caller can run the same duty first; your transaction then reverts and you pay the gas.
- The reward is a share of what the duty spends. On a small pot it can be less than the gas.
- Auction lots are tokens earned in IMD launches. They can be worth nothing.

Source, tests and the independent reviews are linked from https://pupate.fun.

## Proof of work

`https://pupate.fun/work.json` (schema `pupate-work/1`) is IMD's record of what each held seat has
done, condensed by the keeper: paired and online state, accepted and rejected submissions, the newest
jobs (each at `https://explorer.imd.fun/jobs/<jobId>`) and collaborators, refreshed about every ten
minutes while the keeper runs.
