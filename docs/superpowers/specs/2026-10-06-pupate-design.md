# Pupate: design spec

Date: 2026-10-06
Status: draft, awaiting review

## Summary

Pupate is a strategy token on Ethereum mainnet, launched through the IMD launchpad (imd.fun). A tax on every trade funds a vault that buys Identity MD NFTs (IMD swarm seats). Each seat works in the IMD swarm while it is listed for resale. An IMD oracle report of the collection floor price decides how much of the tax buys seats and how much buys back and burns the token.

- Name: Pupate
- Ticker: PUPATE
- Domain: pupate.si
- Target NFT collection: Identity MD, `0x0000eC93127BAA929E58E97dd0095A2BFb38ec1D` (address taken from a third-party README; confirm on-chain in Phase 0)

## Goals

1. Buy Identity MD seats with trading tax, with no human holding the funds.
2. Put every held seat to work in the IMD swarm, and route what it earns back into the vault.
3. Shift between buying seats and burning the token based on the floor price.
4. Give the developer a visible, bounded income.

## Non-goals (this spec)

- Open operator market (leasing seats to third parties). Phase 2, separate spec.
- Swarm-voted treasury decisions. Phase 2, separate spec.
- Any chain other than Ethereum mainnet. No bridges.
- An upgradeable hook.

## Flow

1. A trader buys or sells PUPATE. The hook takes a 6% tax in ETH. The pool's own fee (1.25% under current IMD policy) applies on top.
2. The hook splits the tax:
   - 5% buys IMD and burns it.
   - 95% goes to the strategy, split between the seat pot and the burn pot according to the current mode.
3. Anyone can trigger a seat purchase when the seat pot can afford one.
4. The purchased seat is listed for resale at a descending price and paired to a worker device.
5. Tokens the seat earns are auctioned for ETH, which goes to the seat pot.
6. When a seat sells, the ETH buys PUPATE and burns it.

## Components

### PupateToken

ERC-20, 18 decimals, fixed supply of 1,000,000,000 (IMD launch rule). No mint function after launch. Burnable.

Distribution:

| Share | Recipient |
|---|---|
| 10% | IMD swarm (launch rule) |
| 85% | Uniswap v4 pool, single-sided |
| 5% | Developer vesting contract, linear over 12 months |

The IMD launch page mentions a 2% share to the paying wallet. Whether that is fixed or an example is checked in Phase 0; if fixed, it counts toward the developer's 5%.

### PupateHook

Uniswap v4 hook on the PUPATE/ETH pool. Not upgradeable.

- Takes the tax on buys and sells, in ETH.
- Reads the current mode from FloorFeed and splits the strategy share.
- Sends the seat share and burn share to Cocoon, and the IMD share to the IMD burn path.
- Tax rate is a stored value that can only be lowered.

For the first 10 minutes after the pool opens, a single wallet may hold at most 1% of supply. There is no elevated launch tax.

### FloorFeed

Stores the latest floor price of the Identity MD collection as attested by the IMD oracle.

- `report(attestation)` is callable by anyone. It verifies the IMD oracle's EIP-712 signature (domain name `IdentityMD Oracle`, version `2`) and stores the floor price and timestamp.
- A report is fresh for 6 hours.
- A new report may move the stored floor by at most 25% from the previous fresh one. A larger move is rejected.

Mode, derived on read:

| Condition | Mode | Seat pot | Burn pot |
|---|---|---|---|
| No fresh report | NEUTRAL | 50% | 50% |
| Vault holds no seats | ACCUMULATE | 70% | 30% |
| Floor at or below the vault's average purchase price | ACCUMULATE | 70% | 30% |
| Floor above the vault's average purchase price | BURN | 30% | 70% |

Rows are evaluated top to bottom; the first match applies.

### Cocoon (vault)

Holds the seat pot, the burn pot, and the seats. All functions below are callable by anyone unless stated.

**Buying.** `buySeat(order)` fulfils a Seaport 1.6 listing when all of these hold:

- the item is a token of the target collection,
- payment is in ETH,
- a fresh floor report exists,
- the price is at most 105% of the reported floor,
- the seat pot covers the price plus the caller reward.

The caller receives 0.5% of the purchase price from the seat pot.

**Listing.** On purchase, Cocoon creates a Seaport listing for the seat, with a price that starts at 1.5x the purchase price and falls linearly to 1.1x over 14 days, then stays at 1.1x. Cocoon authorises the listing on-chain; no off-chain key signs it.

**Selling.** When a listing fills, the ETH goes to the burn pot.

**Burning.** `burn()` spends the burn pot on PUPATE through the pool and burns what it receives. Each call spends at most a fixed amount, to limit price impact and sandwiching. The caller receives 0.5% of the amount spent.

**Harvesting.** Seats earn ERC-20 tokens (launch allocations and IMD). `startAuction(token)` opens a descending-price auction for Cocoon's whole balance of that token: the ETH price falls from a high start to zero over 24 hours, and the first buyer takes the balance. Proceeds go to the seat pot. PUPATE itself is never auctioned; any PUPATE balance is burned.

**Pairing.** An operator address can authorise a worker device for a held seat. This is the only thing the operator can do: it cannot transfer seats, move ETH, or change parameters. In Phase 1 the operator is the developer.

### Keeper bot

An off-chain script, runnable by anyone, that:

- requests floor reports from the IMD oracle on a schedule and submits them to FloorFeed,
- finds the cheapest valid listing and calls `buySeat`,
- calls `burn` and `startAuction` when there is something to process.

The bot holds no privileged key. If it stops, anyone else can make the same calls.

### Website

A static dashboard at pupate.si showing: seat pot and burn pot balances, seats held with purchase price and current listing price, current mode and last floor report, total PUPATE burned, total IMD burned. It reads from the chain only. It describes the mechanism and makes no statement about returns.

## Control

- A timelock with a 48-hour delay owns the hook, FloorFeed, and Cocoon.
- The tax rate can only be lowered.
- Changeable within hard-coded bounds: mode split (30–70%), listing start multiple (1.1x–3x), listing floor multiple (1.0x–1.5x), listing decay period (1–60 days), floor tolerance (0–10%), caller rewards (0–1%), report freshness (1–24 hours), operator address.
- Not changeable: target collection, token supply, the rule that pot ETH can only buy seats or buy and burn PUPATE.

## Developer income

- The IMD deployer fee: 1% of each trade, paid to the wallet that pays for the launch (asset and claim method checked in Phase 0).
- 5% of token supply, vested linearly over 12 months.
- No share of the strategy tax.

## Build phases

### Phase 0: verify assumptions on Sepolia

Nothing else is built until these are answered.

| Question | If the answer is no |
|---|---|
| Does IMD launch policy admit a hook that takes a 6% tax on top of the pool fee? | Lower the tax to the admitted maximum, or deploy outside the launchpad and keep the IMD oracle. Decide with the user. |
| In what asset is the 1% deployer fee paid, and how is it claimed? | Informational; affects only developer income. |
| Can a contract-owned seat be paired (ERC-1271 accepted for `WorkerAuthorization`)? | Seats held by Cocoon are listed but do not work. Harvesting is dropped from Phase 1. |
| Will the IMD oracle answer "floor price of collection X" consistently across panels, and can a contract verify the attestation? | Replace the feed with a time-based price cap, and drop mode switching to a fixed 50/50 split. Decide with the user. |
| Is the 2% share to the paying wallet fixed? | Adjust the developer vesting share so the total stays 5%. |
| Is the target collection address correct, and are its listings fulfillable through Seaport 1.6 in ETH? | Correct the address; adapt the buy path. |

### Phase 1: contracts

Written and tested in our own repository with Foundry, in English throughout. Then submitted to IMD as a `launch.open` job of kind `univ4_hook`, with `repoUrl` and `baseCommit`, for independent review and deployment.

### Phase 2: Sepolia launch

Full run of the flow: trade, tax split in each mode, buy, list, sell, burn, harvest, pairing.

### Phase 3: mainnet launch

Contracts, keeper bot, and website go live together.

## Testing

- Unit tests per contract.
- Mainnet-fork tests for Seaport purchase and listing against the real collection.
- Invariant tests:
  - pot ETH leaves Cocoon only to Seaport (seat purchase), the pool (buyback), or as a bounded caller reward;
  - the tax rate never increases;
  - a seat leaves Cocoon only through a filled listing;
  - the operator cannot move assets;
  - a stale or out-of-range report never changes the stored floor.

## Known risks

- **Floor manipulation.** A seller can list high and try to push the reported floor up. Limited by the 25% per-report move cap, the 105% tolerance, and the 30–70% split range.
- **Thin seat yield.** Seat earnings are split across all connected seats (about 650 today) and may be small. The design still works without them, as a tax-and-flip strategy.
- **Seats that do not sell.** After 14 days a seat sits at 1.1x until bought. Capital can be tied up if the floor falls below that.
- **Oracle dependency.** If the IMD oracle stops, buying halts and the split falls back to 50/50, with the seat pot accumulating unspent.
- **Unaudited platform.** IMD itself has no formal audit.
- **Existing competitor.** IMD6900 runs a similar strategy on the same collection.

## What the user provides

- An Ethereum wallet with ETH for gas and IMD for paid actions (0.5 IMD each).
- A GitHub account for the contract repository.
- The pupate.si domain.
- One machine and a Claude or Codex subscription to run the first seat.
