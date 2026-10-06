# Pupate: design spec

Date: 2026-10-06
Status: revision 3. Revision 2 followed the Phase 0 desk findings in `docs/phase0-findings.md`; revision 3 followed the independent review of Plan 2 in `docs/REVIEW.md`. The change lists at the end say what moved.

## Summary

Pupate is a strategy token on Ethereum mainnet, launched through the IMD launchpad (imd.fun) as a `univ4_hook` launch. A tax on every trade in the launch pool funds a vault that buys Identity MD NFTs (IMD swarm seats). Each seat works in the IMD swarm while it is listed for resale. An IMD oracle report of a reference price for the collection decides how much of the tax buys seats and how much buys back and burns the token.

- Name: Pupate
- Ticker: PUPATE
- Domain: pupate.si
- Target collection: identity.md (IDMD), `0x0000eC93127BAA929E58E97dd0095A2BFb38ec1D`, 2,000 tokens. Confirmed on-chain.

## Goals

1. Buy Identity MD seats with trading tax, with no human holding the funds.
2. Put every held seat to work in the IMD swarm, and route what it earns back into the vault.
3. Shift between buying seats and burning the token based on the reference price.
4. Give the developer a visible, bounded income that also pays the running costs.

## Non-goals (this spec)

- Open operator market (leasing seats to third parties). Later, separate spec.
- Swarm-voted treasury decisions. Later, separate spec.
- Any chain other than Ethereum mainnet. No bridges.
- An upgradeable hook.
- Restricting where the token can trade. IMD requires a plain ERC-20 (see Known risks).

## Flow

1. A trader buys or sells PUPATE in the launch pool. The hook takes 6% of the ETH side of the trade. The pool's own 0.3% LP fee applies as well and goes to the liquidity position, which IMD holds.
2. Anyone can flush the collected tax to Cocoon. Cocoon splits it: 85% strategy, 10% developer, 5% IMD burn. The strategy share is divided between the seat pot and the burn pot according to the current mode.
3. Anyone can trigger a seat purchase when the seat pot can afford one.
4. The purchased seat is listed for resale at a descending price and paired to a worker device.
5. Tokens the seat earns are auctioned for ETH, which goes to the seat pot.
6. When a seat sells, the ETH goes to the burn pot, which buys PUPATE from the launch pool and burns it.

## Components

### PupateToken

A plain ERC-20, as IMD requires: 18 decimals, fixed supply of 1,000,000,000 minted once to the launch factory, no transfer fee, limit, pause or mint. Holders can burn their own tokens.

| Share | Recipient |
|---|---|
| 10% | IMD swarm (launch rule) |
| 85% | Launch pool, single-sided |
| 5% | Developer. The launch delivers it to the requester wallet; the developer moves it into PupateVesting. |

### PupateHook

A Uniswap v4 hook on the launch pool. Not upgradeable. Constructor arguments: the PoolManager, the sink (Cocoon), and the owner (the timelock).

- **Launch pool.** The first native-ETH pool initialised on the hook becomes the launch pool. Only that pool is taxed. The IMD factory deploys the hook and initialises the pool in one transaction, so no other pool can take that place.
- **Standing tax.** 6% of the ETH side of every buy and every sell. On a buy that is 6% of the ETH the trader pays; on a sell it is 6% of the ETH the pool pays out. Rounded down.
- **Launch schedule.** The buy tax starts at 99% when the launch pool opens and falls continuously, one percentage point per minute, until it meets the standing tax (93 minutes at 6%). Sells are always at the standing tax.
- **Collection.** The tax is taken inside the swap as PoolManager claims. No ETH moves, and no contract other than the PoolManager is called, during a swap. `flush()` is callable by anyone: it converts the claims to ETH and hands the hook's whole ETH balance to Cocoon. ETH forced into the hook reaches Cocoon the same way, so deliveries can exceed the hook's `totalTax`; nothing downstream assumes they are equal.
- **Cocoon's own swaps are not taxed.** Cocoon swaps only to buy back and burn.
- **Partial fills.** A swap that names an exact ETH amount and cannot be filled in full reverts, because its tax was computed on the full amount.
- **Owner.** May lower the standing tax. Nothing can raise it. The owner has no other power.

Why a launch schedule and not a wallet cap: the token must be plain, and a hook sees the router, not the buyer, so a per-wallet limit cannot be enforced. Capping each swap or each block does not change who ends up with the cheap supply. A buy tax that starts high and falls is a Dutch auction: whoever buys early pays for it, and the payment goes to the vault instead of to a sniper.

### FloorFeed

Stores the latest reference price of the collection as attested by the IMD oracle. Built and tested in Plan 1.

- `report(attestation, signature)` is callable by anyone. It verifies the oracle's EIP-712 signature (domain `IdentityMD Oracle`, version `2`, bound to FloorFeed's own address and chain) and stores the price and its issue time.
- Only attestations for one pinned question are accepted. The question asks for the median price of the collection's on-chain sales over the last 24 hours. The owner sets the question's hash, because the hash is only known once the first request has been made; changing it later goes through the timelock. Setting the question clears the stored price, and the first report after that is not rate-limited. Setting the same hash again is the way to clear a bad value.
- The attestation must name the evidence chain fixed at deployment (mainnet, where the collection lives), carry a quorum of at least 4 that is a majority of its panel, and be valid for at least the freshness window.
- A report is fresh for 6 hours after it was issued, or until the attestation's own expiry if the owner has since lengthened the window.
- **Rise limit.** The stored price may rise by at most 25% per 6 hours between two reports, measured between their issue times. The limit applies whether or not the earlier report is still fresh, so a report held back until the previous one lapses gains nothing, and reports in quick succession cannot compound. Falls are not limited, because a lower reference only makes the vault buy less. A genuine jump larger than the limit is reflected once enough time has passed; until then the vault simply does not buy.

This document calls the stored value "the floor". It is a reference price built from recent sales, not the lowest ask, because asks are not on-chain.

### Cocoon (vault)

Holds the seat pot, the burn pot, and the seats. Functions are callable by anyone unless stated.

**Tax intake.** `depositTax()` accepts ETH and splits it: 10% to the developer balance, 5% to the IMD burn balance, 85% to the strategy. The strategy share is divided between the seat pot and the burn pot by the mode at that moment.

**Mode.** Derived on read. Rows are evaluated top to bottom; the first match applies.

| Condition | Mode | Seat pot | Burn pot |
|---|---|---|---|
| No fresh floor report | NEUTRAL | 50% | 50% |
| Cocoon holds no seats | ACCUMULATE | 70% | 30% |
| Floor at or below the average purchase price of the seats held | ACCUMULATE | 70% | 30% |
| Floor above that average | BURN | 30% | 70% |

**Buying.** `buySeat(order)` fulfils a Seaport 1.6 listing when all of these hold:

- the item is a token of the target collection,
- payment is in ETH,
- a fresh floor report exists,
- the price is at most 105% of the floor,
- the seat pot covers the price plus the caller reward.

The caller receives 0.5% of the purchase price from the seat pot.

**Listing.** On purchase, Cocoon lists the seat on Seaport at a price that starts at 1.5x the purchase price and falls linearly to 1.1x over 14 days, then stays at 1.1x. Cocoon authorises the listing itself; no off-chain key signs it.

**Selling.** When a listing fills, the ETH goes to the burn pot.

**Burning.** `burn()` spends burn-pot ETH on PUPATE in the launch pool and burns what it receives. One call may move the pool price by at most 5%, and calls must be at least 5 blocks apart. Because every other trader pays the tax on both legs, moving the price by that much is not worth sandwiching. The caller receives 0.5% of the ETH spent. The limit is applied to the price the trade actually pays, not to the pool's quoted spot price alone: right after the open the spot price sits above all liquidity, and a 1-wei sell can move it to the maximum for free. Cocoon's swap parameters are fixed in code, since its swaps are the only untaxed ones, and Cocoon never calls `flush` from inside its own PoolManager unlock.

**Harvesting.** Seats earn ERC-20 tokens (launch allocations and IMD). `startAuction(token)` opens a descending-price auction for Cocoon's whole balance of that token: the ETH price falls from a high start to zero over 24 hours, and the first buyer takes the balance. Proceeds go to the seat pot. PUPATE is never auctioned; any PUPATE balance is burned.

**IMD burn.** The IMD burn balance is auctioned the other way round: the amount of IMD a taker must deliver falls over 24 hours, the first taker receives the ETH, and the IMD they deliver goes to the dead address. Cocoon does not route through IMD's pools.

**Developer balance.** `claimDeveloper()` pays the accrued balance to the developer address. Only the developer address can change the developer address.

**Pairing.** IMD pairs a device to a seat by checking an EIP-712 `WorkerAuthorization` signed by the seat's holder, and accepts ERC-1271 when the holder is a contract. Cocoon's operator approves a specific authorisation on-chain, and Cocoon's `isValidSignature` returns valid only for approved authorisations of seats it still holds. That is all the operator can do: it cannot transfer seats, move ETH, or change parameters. In this phase the operator is the developer.

**Wiring.** Cocoon is deployed before the launch, so it learns the launch pool afterwards through a one-time `wire` call. Until then `burn()` is disabled.

### PupateVesting

Holds the developer's 5% of supply and releases it linearly over 12 months to the developer address. No other function.

### Timelock

A 48-hour timelock owns the hook, FloorFeed and Cocoon.

### Keeper bot

An off-chain script, runnable by anyone, that:

- requests floor reports from the IMD oracle on a schedule and submits them to FloorFeed,
- flushes the hook,
- finds the cheapest valid listing and calls `buySeat`,
- calls `burn`, `startAuction` and the IMD auction when there is something to process.

The bot holds no privileged key. If it stops, anyone else can make the same calls.

### Website

A static site at pupate.si, hosted on IPFS, with no backend. It reads the chain through a public RPC and seat work statistics from IMD's public API. It carries its own swap panel, because third-party interfaces may not route through a pool with a custom hook.

#### UI/UX concept: the life cycle is the interface

The page is the insect's life cycle, and each stage is a live part of the protocol. A visitor who reads it top to bottom has read how Pupate works.

| Stage | What it is in the protocol | What the visitor sees |
|---|---|---|
| **Feed** | Trading and tax | The swap panel, the tax rate that applies right now, total tax collected, and how full the seat pot is against the price of the next seat ("next cocoon: 71%"). |
| **Cocoon** | Seats held, working, and listed | One chrysalis per seat, each with a specimen tag: seat number, purchase price, current listing price, day of 14, jobs accepted. |
| **Emerge** | Seats sold, tokens burned | Each sold seat as an empty shell with its sale price and the PUPATE burned with the proceeds; running totals of PUPATE and IMD burned. |

Above the stages, a **Conditions** strip shows the last floor report, how long it stays fresh, and the mode under its field name:

| Mode | Field name | Meaning shown |
|---|---|---|
| ACCUMULATE | Spinning | More of the tax is buying seats |
| BURN | Shedding | More of the tax is burning PUPATE |
| NEUTRAL | Resting | Waiting for a fresh floor report |

Rules the design follows:

- **A chrysalis shows its own state.** It starts opaque and turns translucent as its listing price falls over the 14 days, the way a real chrysalis clears before the adult emerges. Ripeness is readable at a glance, and the tag carries the same information in numbers.
- **Visual language.** A field naturalist's notebook and specimen drawer: paper, ink, hairline rules, monospace specimen tags, inked line drawings. One accent pair, jade green and gold, taken from the monarch chrysalis. A dark variant uses the same drawings on deep green-black. No neon, no gradient hero, no generic dashboard cards.
- **Voice.** Field notes: short, present tense, factual. "Day 6. Seat 1376 is working. 41 jobs accepted. Listed at 3.31 ETH."
- **The tax is never a surprise.** The current buy and sell tax sits beside the swap button. During the launch schedule the panel shows the countdown: "Buy tax now 43%. Reaches 6% in 37 minutes."
- **Every number links to its source**: a contract read or a transaction on a block explorer.
- **Anyone can run a step.** Flush, buy, burn and the auctions are shown as actions with the caller reward beside them.
- **No statement about returns**, and no sample or placeholder figures on the live site.
- **Access.** Stages stack on a phone. Mode is shown by label and icon, not colour alone. Motion is reduced when the visitor asks for it. Text meets WCAG AA contrast in both variants.

All site copy is English.

## Control

- The timelock owns the hook, FloorFeed and Cocoon.
- The standing tax can only be lowered.
- Changeable by the timelock within hard-coded bounds: mode split (30–70%), listing start multiple (1.1x–3x), listing end multiple (1.0x–1.5x), listing decay period (1–60 days), price tolerance above the floor (0–10%), caller rewards (0–1%), report freshness (1–24 hours), burn price-impact limit (1–10%), blocks between burns (1–300), operator address, oracle attester address, oracle question hash (setting it clears the stored price).
- Not changeable by anyone: target collection, token supply, the 85/10/5 split, the launch schedule, the hook's sink, the evidence chain the oracle question reads, the rise limit of 25% per 6 hours, and the rule that pot ETH can only buy seats or buy and burn PUPATE.

## Developer income

- 10% of the tax, which is 0.6% of each trade at the standing rate. It accrues in Cocoon and is claimed by the developer address.
- 5% of token supply, vested linearly over 12 months.
- Nothing from the pool's LP fee. IMD holds the liquidity position, and no share of it is documented.

## Running costs

The developer share is also what pays for operation in this phase:

- Floor reports: each oracle request costs 0.5 IMD, so four a day is 2 IMD a day.
- Keeper gas for reports, flushes, purchases, burns and auctions.
- One machine and one Claude or Codex subscription per seat that is put to work.

If the developer stops paying, the system degrades but does not lock: anyone may pay for and submit a report, and the purchase reward makes that worthwhile when a seat can be bought. Without reports, buying halts and the split falls back to 50/50.

## Deployment order

1. Deploy the timelock, FloorFeed, Cocoon and PupateVesting.
2. Launch through IMD: the factory deploys PupateToken and PupateHook (with Cocoon and the timelock as constructor arguments) and opens the launch pool.
3. Wire Cocoon to the launch pool. Confirm on-chain that the hook's launch pool is the intended one.
4. Move the developer's 5% into PupateVesting.
5. Make the first oracle request with FloorFeed as its consumer, set the question hash, submit the first report.
6. Hand ownership of FloorFeed and Cocoon to the timelock.

## Plans

| Plan | Scope | State |
|---|---|---|
| 1 | Repository, FloorFeed, Phase 0 desk findings | Done |
| 2 | PupateToken, PupateHook, independent review | Done |
| 3 | Cocoon, PupateVesting, timelock | Next |
| 4 | Launch manifest, Sepolia rehearsal, keeper bot, website | |

The Sepolia rehearsal in Plan 4 is where the remaining Phase 0 questions are settled: whether the swarm's review admits the hook as designed, whether a seat held by a contract can be paired, and whether the oracle panel agrees on the floor question.

## Testing

- Unit tests per contract.
- Hook tests run against a real v4-core PoolManager, in all four swap modes.
- Mainnet-fork tests for Seaport purchase and listing against the real collection.
- Invariant tests:
  - tax collected equals claims held by the hook plus ETH delivered to Cocoon;
  - pot ETH leaves Cocoon only to Seaport (seat purchase), the launch pool (buyback), or as a bounded caller reward;
  - the standing tax never increases;
  - a seat leaves Cocoon only through a filled listing;
  - the operator cannot move assets;
  - a rejected report never changes the stored floor, and no report raises it faster than the rise limit.

## Known risks

- **The tax can be avoided in other pools.** The tax lives in the hook of the launch pool. The token is a plain ERC-20, so anyone can open another pool for it and trade there untaxed. IMD6900 does not have this weakness: its token refuses transfers that bypass its pool, which is possible because it was not launched through IMD. The launch pool holds 85% of supply and the site trades through it, which keeps most early volume there, but the leak grows with success. Lowering the standing tax narrows it.
- **Token scanners will flag the launch.** For the first 93 minutes the buy tax is far above what scanners treat as normal.
- **Reference-price manipulation.** Wash sales can move a median of recent sales. Limited by the rise limit of 25% per 6 hours, which applies whether or not the previous report is fresh, and by the price tolerance and the 30–70% split range. A sustained manipulation can still raise the reference by about 25% every 6 hours for as long as the oracle keeps reporting the inflated figure, and a 24-hour sales window means one burst of wash sales lasts a day. Anyone holding a seat can still sell it to the vault at up to 105% of the reference price.
- **Trades made by providing liquidity are not taxed.** The hook taxes swaps. Someone who places PUPATE as a narrow liquidity position just above the price and lets buyers fill it has sold without paying the sell tax; someone who rests ETH just under the price at the open has bought without paying the launch tax. Each matched trade is then taxed once, on the taker. Closing this needs a `beforeAddLiquidity` gate that admits liquidity only in the transaction that opens the launch pool, which in turn depends on IMD's factory seeding the pool in that same transaction. Decision pending; see `docs/REVIEW.md`.
- **Thin seat yield.** Seat earnings are split across all connected seats (about 650 today) and may be small. The design still works without them, as a tax-and-flip strategy.
- **Seats that do not sell.** After 14 days a seat sits at 1.1x until bought. Capital is tied up if the market falls below that.
- **Oracle dependency.** If the IMD oracle stops, buying halts and the split falls back to 50/50, with the seat pot accumulating unspent.
- **Fixed sink.** The hook's sink cannot be changed. If Cocoon ever refuses deposits, collected tax stays in the PoolManager as claims.
- **Unaudited platform.** IMD itself has no formal audit.
- **Unverified integrations.** Pairing a contract-held seat and the floor question have not been exercised end to end.
- **Existing competitor.** IMD6900 runs a similar strategy on the same collection, with a tax that cannot be avoided.

## What the user provides

- An Ethereum wallet with ETH for gas and IMD for paid actions (0.5 IMD each).
- A GitHub account for the contract repository.
- The pupate.si domain.
- One machine and a Claude or Codex subscription to run the first seat.

## Changes in revision 2

1. Pool fee corrected to 0.3%, held by IMD. The "1% deployer fee" is gone; developer income is now a 10% share of the tax.
2. The tax split moved from the hook to Cocoon. The hook only collects.
3. The mode is computed in Cocoon, which knows the average purchase price. FloorFeed only stores the price.
4. The per-wallet launch cap is replaced by a falling launch buy tax. IMD's plain-token rule makes a wallet cap impossible.
5. Cocoon's buyback is exempt from the tax and bounded by price impact per call.
6. The IMD burn share is sold by auction instead of routed through IMD's pools.
7. FloorFeed's question hash is set by the owner after deployment instead of in the constructor.
8. New sections: UI/UX concept, running costs, deployment order.
9. New known risks: tax avoidance through other pools, scanner flags, reference-price manipulation, fixed sink.

## Changes in revision 3

1. FloorFeed's "25% while the previous report is fresh" cap is replaced by a rise limit of 25% per 6 hours that always applies. Falls are not limited.
2. FloorFeed checks the attestation's evidence chain (fixed at deployment), a minimum and majority quorum, and a minimum validity.
3. Setting FloorFeed's question clears the stored price.
4. The launch schedule is described as continuous, as the hook implements it.
5. `flush` is described as handing over the hook's whole balance.
6. New known risk: trades made by providing liquidity are not taxed. Decision pending.
7. Notes for Cocoon's `burn()`: price-impact limit on the trade's own price, fixed swap parameters, no `flush` from inside its unlock.
