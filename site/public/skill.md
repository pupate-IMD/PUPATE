---
name: pupate-keeper
description: Run the public steps of Pupate (flush the tax, buy a seat, burn, run the auctions) and collect the caller reward where one is paid.
---

# Pupate keeper

Pupate is a token on Ethereum whose trading tax buys Identity MD seats. Nobody operates it. Every
step below is a public function: whoever calls it first moves the mechanism forward, and two of the
steps pay the caller. This file tells an agent what the steps are, when each one can be run, and
what it pays.

You need an Ethereum wallet with ETH for gas. You need no permission, no allowlist and no account
with Pupate.

## Status

Pupate is not deployed yet. The addresses marked "at launch" are published on https://pupate.fun and
in this file when the contracts go live. Do not send anything to an address that claims to be
Pupate before then.

| Contract | Address |
|---|---|
| Cocoon (the vault) | at launch |
| PupateHook (collects the tax) | at launch |
| FloorFeed (the reference price) | at launch |
| PUPATE token | at launch |
| Identity MD collection | `0x0000eC93127BAA929E58E97dd0095A2BFb38ec1D` |
| Seaport 1.6 | `0x0000000000000068F116a894984e2DB1123eB395` |
| IMD token | `0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7` |
| IMD oracle signer | `0x5598Aa9146215Bc13eb26f2c692Ad1461Fd32982` |

## What to read first

| Call | Tells you |
|---|---|
| `FloorFeed.latest()` returns `(uint256 floorWei, bool fresh)` | The reference price, and whether the vault may buy on it. |
| `Cocoon.seatPot()` | ETH set aside for buying seats. |
| `Cocoon.burnPot()` | ETH set aside for buying and burning PUPATE. |
| `Cocoon.getParams()` | `toleranceBps`, `callerRewardBps`, `burnImpactBps`, `burnSpacing` and the listing terms. |
| `Cocoon.lastBurnBlock()` | The block of the last burn. |
| `Cocoon.seats(tokenId)` | Whether the vault holds a seat, and what it paid. |
| `Cocoon.auctions(token)`, `Cocoon.auctionPrice(token)` | A running harvest auction and its price now. |
| `Cocoon.imdAuction()`, `Cocoon.imdDemand()` | The running IMD auction and the IMD it asks for now. |

Simulate every step with `eth_call` before sending it. Each one reverts with a named error when it
cannot run, and a revert costs you gas.

## The steps

### 1. Flush the tax

`PupateHook.flush()`

Moves the tax the hook has collected into Cocoon, which splits it between the seat pot, the burn
pot, the developer and the IMD burn. Reverts with `NothingToFlush` when nothing has been collected.

Reward: none. Run it when it makes one of the paid steps below possible.

### 2. Buy a seat

`Cocoon.buySeat(AdvancedOrder order, CriteriaResolver[] resolvers)`

Fulfils a Seaport 1.6 listing of one Identity MD seat for ETH, then lists the seat for sale from
the vault. You supply the order; the vault pays for it from the seat pot.

It runs when all of these hold:

- `FloorFeed.latest()` is fresh (otherwise `FloorNotFresh`).
- The order's price is at most `floorWei * (10000 + toleranceBps) / 10000` (otherwise `PriceAboveFloor`).
- The seat pot covers the price plus the reward (otherwise `PotTooSmall`).
- The order offers exactly one seat of the collection, in full, for native ETH, with no consideration
  item paid to Cocoon and no tip added by you (otherwise `BadOrder`).
- The vault does not already hold that seat (otherwise `AlreadyHeld`).

Reward: `callerRewardBps` of the ETH the purchase spent, paid to you in the same transaction. The
contract caps the parameter at 1%.

Find listings through the OpenSea API or by reading Seaport's `OrderValidated` events for the
collection. Pick the cheapest order that passes the checks above.

### 3. Settle a sold seat

`Cocoon.settleSeat(uint256 tokenId)`

After a buyer has taken one of the vault's listings, this takes the seat off the vault's books and
cancels its other order. Reverts with `StillHeld` while the listing is open and `NotHeld` if the
vault does not have the seat on its books.

Reward: none. The sale's ETH is already in the burn pot; settling keeps the books right.

### 4. Burn

`Cocoon.burn()`

Spends the burn pot on PUPATE in the launch pool and destroys what it buys. One call may move the
pool price by at most `burnImpactBps`, so a large pot takes several calls. Reverts with `TooSoon`
until `burnSpacing` blocks have passed since `lastBurnBlock`, and with `NothingToBurn` when the pot
is empty.

Reward: `callerRewardBps` of the ETH spent, paid to you in the same transaction.

### 5. Harvest auctions

`Cocoon.startAuction(address token)`, then `Cocoon.takeAuction(address token)` with ETH

Tokens the seats earned while working sit in Cocoon. `startAuction` puts the vault's whole balance
of one token up for sale at a price that halves every 2 hours and reaches zero after 48.
`takeAuction` buys the whole lot at the price of that moment; send at least `auctionPrice(token)`
and the excess comes back. PUPATE and the seats themselves cannot be auctioned (`NotForAuction`).

Reward: none for starting. The taker's gain is the gap between the falling price and what the lot
is worth. The ETH goes to the seat pot.

### 6. The IMD auction

`Cocoon.startImdAuction()`, then `Cocoon.takeImdAuction()`

5% of the tax is set aside to buy IMD and destroy it. `startImdAuction` offers that ETH; the amount
of IMD asked for it falls over time on the same curve. `takeImdAuction` pulls `imdDemand()` IMD
from you, sends it to the dead address and pays you the ETH. Approve Cocoon to spend your IMD first.

Reward: none for starting. The taker's gain is the gap between the ETH received and the IMD given.

### 7. Report the reference price

`FloorFeed.report(Attestation a, bytes sig)`

Stores a new reference price from an IMD oracle attestation for the pinned question. Anyone holding
a valid attestation may submit it. The feed checks the oracle's signature, the question, the panel
quorum and the validity window, and it refuses a rise of more than 25% per 6 hours.

Reward: none, and an attestation costs 0.5 IMD to request. The developer's keeper pays for a report
every six hours; submit one yourself only if that has stopped and you want the vault to keep buying.

## A sensible loop

1. Read `FloorFeed.latest()`, the two pots and `getParams()`.
2. If the hook holds tax and a pot is close to useful, `flush`.
3. If the feed is fresh and the seat pot covers a listing within tolerance, `buySeat`.
4. If the burn pot is not empty and the spacing has passed, `burn`.
5. Settle any seat whose listing has filled.
6. Check the two auctions; take one when the price is worth it to you.
7. Wait a few blocks and repeat.

## What you cannot do

No step lets a caller move the vault's ETH anywhere but a Seaport seat purchase, a PUPATE burn or
the caller reward. No step raises the tax. A caller cannot choose the price the vault pays above
the tolerance, and cannot route a purchase's ETH to itself.

## Risks to you

- Another caller can run the same step first; your transaction then reverts and you pay the gas.
- The reward is a share of what the step spends. On a small pot it can be less than the gas.
- Auction lots are tokens earned in IMD launches. They can be worth nothing.

Source, tests and the two independent reviews are linked from https://pupate.fun.
