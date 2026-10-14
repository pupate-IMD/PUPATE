# Review log

Independent reviews of this repository, what they found, and what was done about it. The swarm's
adversarial review at launch is separate and comes on top of these.

## 2026-10-06: Plan 2 (PupateToken, PupateHook, FloorFeed)

Reviewer: an agent that had not seen the implementation plan's reasoning. It compared the hook's tax
against a hookless twin pool in all four swap modes (5,000 fuzz runs per mode, with and without a v4
protocol fee), checked the delta accounting against the vendored v4-core, ran 56 mutants of `src/`
against the test suite, and tried third-party denial of service on swaps and `flush`.

### Clean

- Tax amount in every swap mode, at every point of the launch schedule, after the tax is lowered, and
  with a protocol fee set: exactly floor(gross ETH × rate / 10,000).
- Hook delta accounting against `Hooks.sol` and `PoolManager.sol`.
- Partial fills: exact-ETH swaps revert, exact-token swaps fill partly and are taxed on what moved.
- The sink's exemption in all four modes.
- Conservation after trading in every mode, lowering the tax, flushing and withdrawing all liquidity.
- No way for a third party to make swaps or `flush` revert: donated claims, forced ETH and free price
  moves do not block anything.
- `PupateToken`, `ITaxSink`.

### Findings and outcomes

| # | Finding | Severity | Outcome |
|---|---|---|---|
| 1 | FloorFeed's 25% move cap only applied while the previous report was fresh. At the documented cadence the previous report had always lapsed, so the cap almost never applied to a scheduled report but always applied to the correction after a bad one. Reports a second apart could also compound (2 ETH to 11.9 ETH in 8 seconds). | High | **Fixed.** Replaced by a rise limit of 25% per 6 hours measured between issue times, applied whether or not the previous report is fresh. Falls are not limited. Covered by `test/FloorFeed.t.sol` (held-back attestation, quick succession, stale base, two fuzz tests). |
| 2 | Trades made by providing liquidity pay no tax. A seller who rests PUPATE as a narrow position just above the price is filled by buyers without paying the sell tax; a buyer who rests ETH just under the price at the open avoids the launch tax (one such trade received 101,045,666 PUPATE for 1 ETH against 994,240 by swapping). Each matched trade is taxed once, on the taker. | High | **Fixed.** `beforeAddLiquidity` admits liquidity only into the launch pool and only in the block that opened it (hook flags `0x18CC`); removing liquidity is never gated. Tests: `test_liquidityCanBeAddedOnlyInTheBlockTheLaunchPoolOpened`, `test_liquidityCanStillBeRemovedAfterTheOpeningBlock`, `test_noPoolOnTheHookTakesLiquidityBeforeTheLaunchPoolOpens`, `test_aSecondNativePoolIsNotTheLaunchPoolAndTakesNoLiquidity`. The gate is safe only because IMD's factory initialises the pool and seeds it in one transaction. Verified on launch 775: its deployment transaction `0x9eeabe67…11ad2` (from the launch wallet `0xcecc…a551` to the factory `0x12c63b58…a96f`) contains both `PoolManager.Initialize` and `PoolManager.ModifyLiquidity` for the same pool, with the factory as the liquidity sender. Recorded in the spec's known risks. |
| 3 | FloorFeed pinned only the question hash. It accepted a panel of 100 with quorum 1, `agreed` above the panel size, an inverted block window, and an attestation valid for 60 seconds that cut a 6-hour report short and voided earlier honest ones. | Medium | **Fixed.** Quorum at least 4 and a majority of the panel, `agreed` within the panel, validity at least the freshness window, and the evidence chain fixed at deployment. The block window is not checked; the oracle sets it. Whether a requester can vary these fields under the same question hash is still to be confirmed on Sepolia. |
| 4 | `flush` hands over the hook's whole ETH balance, so donated claims or forced ETH are delivered too, and `totalTax` no longer equals deliveries. | Low | **Kept, documented.** Delivering forced ETH to the vault is better than stranding it. The spec and `test_flushAlsoDeliversEthForcedIntoTheHook` state that nothing downstream may assume equality. |

### Lower-severity notes carried into Plan 3

- `flush` reverts with `AlreadyUnlocked` inside any unlock, so Cocoon cannot flush from its own swap callback.
- Right after the open the spot price sits above every position, so a 1-wei sell moves it to the maximum for free. Cocoon's `burn()` price-impact guard must not trust the spot price alone there.
- Every Cocoon code path that reaches `poolManager.swap` is an untaxed trade (99% discount at the open), so `burn()`'s swap parameters must be fixed in code.
- `setMaxAge` applies retroactively: raising it can make a lapsed report fresh again. Intended; pinned by `test_raisingMaxAgeRevivesAnOlderReport`.
- The attestation's `chainId` is read as the evidence chain (it sits beside the block window). FloorFeed takes it as a constructor argument so a Sepolia FloorFeed can read mainnet sales. To be confirmed in the rehearsal.
- `figure` in the attestation is ignored; its meaning is unconfirmed. The `answer` bytes carry the price.
- The constructor does not check that `sink_` has code. The deployment checklist must verify the sink address before the launch is paid for.

### Tests added after the review

Hook: exact-out sell partial fills, exact-out sells during the launch window, the sink's exemption in
every mode, the `LaunchPoolSet` and sell-side `Taxed` events, forced ETH in `flush`. FloorFeed: the
suite was rewritten around the new rules (49 tests), including each expiry rule on its own, the domain
chain id, every zero-address check, ownership transfer, and the events.

## 2026-10-06: Plan 3 (Cocoon, libraries, PupateVesting)

Reviewer: an agent that had not seen the plan's reasoning, with the mock Seaport fixture and the real
PoolManager; no mainnet RPC, so nothing ran against live Seaport. It wrote nine proof tests, all of
which passed against the code as reviewed.

### Clean

- `isValidSignature` against Seaport: digests built under the Worker domain cannot equal a Seaport
  order digest; contract orders and zones naming Cocoon fail elsewhere. The operator can sign nothing else.
- Reentrancy: the lock covers every ETH-moving function; `unlockCallback` needs the PoolManager and
  the lock; Seaport's own guard blocks filling Cocoon's listings mid-purchase.
- `burn()`: the limit `sqrt(0.95)` gives a 5.02% maximum move, the clamp and the settle/take of the
  real deltas are right, the reward is held back, and a 12% round-trip tax makes sandwiching a 5% move
  unprofitable.
- Arithmetic across the casts, `Decay`, the IMD demand and the split rounding; SeatListing salts and
  windows; PupateVesting; Decay; WorkerAuthorization; parameter bounds; developer rotation.

### Findings and outcomes

| # | Finding | Severity | Outcome |
|---|---|---|---|
| 1 | The seat's cost was the balance change during the purchase, and `receive` swallowed any ETH while a purchase was in flight. A seller could list with the payment routed back to Cocoon, buy through `buySeat` themselves, book the seat at 1 wei, collect the 0.5% reward, buy the 1-wei listing back and repeat, draining the seat pot 0.5% per cycle with the balance identity intact. Routing everything back booked a cost of zero, which froze the seat on the books and flipped the mode. | Critical | **Fixed.** `_checkOrder` rejects any consideration item paid to Cocoon and any zero amount. During a purchase `receive` accepts ETH from Seaport only and counts it as the refund; the cost is price minus refund. `test_rejectsOrdersThatPayCocoon`, `test_rejectsZeroAmountItems`, `test_ethFromAnyoneButSeaportDuringAPurchaseRevertsThePurchase`, `test_costIsWhatSeaportPaidOutAndTheRewardIsOnIt`. |
| 2 | Seaport pays consideration items beyond `totalOriginalConsiderationItems` ("tips") from the fulfiller's value, and `_checkOrder` summed whatever array it was given. A keeper could append a tip to itself up to the ceiling, so every purchase would cost the ceiling. | High | **Fixed.** The consideration array must be exactly the original. `test_rejectsConsiderationThatIsNotTheOriginal`; a legitimate two-item split is still accepted. |
| 3 | `depositTax` reachable mid-purchase from a payout recipient or a zone credited the pots and shrank the booked cost, breaking the balance identity. | Medium | **Fixed.** `depositTax` and `skim` revert while a purchase is in flight; non-Seaport ETH reverts the purchase (finding 1). |
| 4 | `startAuction` accepted the collection (a lot of seats) and, before `wire`, PUPATE. | Low | **Fixed.** Rejects the collection, PUPATE and the zero address, and requires the wire. `test_auctionsRejectTheCollectionAndNeedTheWire`. |
| 5 | A pairing approval keyed on ownership alone revived if a sold seat came back by plain transfer, under a departed operator and an expired message. | Low | **Fixed.** Approvals record the seat's purchase round and are valid only while that round is held. `test_pairingApprovalDoesNotReviveWhenTheSeatComesBack`. |
| 6 | A buyer who filled a listing and sent the seat straight back froze its books: `settleSeat` saw it held, `adopt` saw it recorded, and the old flat tail stayed live at the old price. | Low | **Fixed.** `settleSeat` accepts a filled Seaport order as proof of sale; `adopt` then re-records at the floor. `test_aSeatSentBackBeforeSettleCanBeSettledAndAdopted`. |
| 7 | The caller reward was 0.5% of the order's maximum price, not of what was spent. | Low | **Fixed.** Reward on the spend. |
| — | `wire` did not check that the hook had opened its pool; forced ETH broke the `==` identity; IMD's `transferFrom` to the dead address is unverified. | Info | `wire` now requires `openedAt != 0`; `skim` books forced ETH; the IMD transfer is checked in the fork test (Plan 4). |

### Carried into Plan 4

- The fork test should also cover a FULL_RESTRICTED (zoned) order, a two-item consideration as
  OpenSea builds it, the refund path, a repurchase (round 1), `adopt`, and a fulfiller tip being refused.
- No invariant yet tracks the ETH exit paths or "a seat leaves only through a filled listing"; the
  handler settles in the same call, so stale states never persist. Worth adding before launch.
- Cocoon's runtime is 24,191 bytes against the 24,576 limit. Any further addition should come with
  a trim or a split.

## Before the mainnet launch (2026-10-12)

One change to a reviewed contract, made after reading how IMD's own audit treats hook launches, and reviewed independently before it was launched.

| # | Finding | Severity | Outcome |
|---|---|---|---|
| 1 | The liquidity gate admitted liquidity for the whole block that opened the launch pool. A transaction placed behind the launch in the same block could add a one-sided ETH range and take PUPATE from sellers without paying the buy tax, including during the 99% opening window. IMD's audit judge parked launch #1183 for the same class of gate ("exempts the whole opening timestamp, not the factory's opening transaction"). | Medium | **Fixed.** The gate is the opening transaction: `afterInitialize` sets a transient-storage mark, `beforeAddLiquidity` requires it, and the EVM clears it when the transaction ends. `test_theOpeningTransactionSeedsTheLaunchPool`, `test_liquidityIsClosedOnceTheOpeningTransactionEnds`, `test_liquidityStaysClosedInLaterBlocks`, `test_inTheOpeningTransactionOnlyTheLaunchPoolTakesLiquidity`. The fixture opens and seeds in one call, as the factory does; the suite passes in forge's default mode and with `--isolate`, and the launch was replayed on a fork of mainnet with the real PoolManager. |

Checked against three real IMD launch transactions (#775, #1283, #1341): the factory deploys the token, the hook and the distributor, initialises the pool and adds its one position in a single transaction.

### Independent review of the change (2026-10-12)

A reviewer that had not written the change was given the diff, the hook and its tests, and asked to break the gate or the launch. Verdict: safe to launch, nothing blocking. It ran the suite on forge 1.7.1 and on forge 1.8.3 (the version IMD's checks build with) in default and `--isolate` modes, mutated the gate to see which tests notice, and replayed the launch on a fork of mainnet through IMD's real `LaunchFactory` (source verified on Sourcify), called as its deployer.

| # | Finding | Severity | Outcome |
|---|---|---|---|
| 1 | The mark is set only where the launch pool is recorded, in the same call frame, so the record and the mark are set or reverted together; it cannot outlive the transaction; the slot is the hook's own; `tload` in a `view` callback is legal. | Clean | No change. |
| 2 | Residual: the mark names no account and is not consumed, so anything that gets control later in the opening transaction can add to the launch pool. With IMD's factory nothing does: `launch()` is callable only by the factory's deployer, and after `initialize` the factory calls only the PoolManager, the launched token and its own registry. Only IMD's own key could use it, by wrapping the launch in a batch. | Low | **Accepted and disclosed.** Consuming the mark on the first add, or binding it to the initialiser, would close it, at the price of making the launch depend on the factory seeding exactly once and from the initialising address; the reviewer recommended leaving the code as it is for this launch. `test_theOpeningTransactionIsTheGateNotTheAccountThatOpens` pins the behaviour, and `launch.json` and the launch request state it. IMD admitted launch #1205 with the same residual, rated low. |
| 3 | The real factory's one transaction passes the gate. A seed into any pool other than the launch pool would revert, so an untaxed seeded pool cannot result. The factory's fee collection (a zero-liquidity `modifyLiquidity`) is routed to the remove callbacks, which the hook does not gate. A harness that initialises and seeds in two transactions now fails, as intended. | Clean | Kept as a test: `test/fork/LaunchFactory.fork.t.sol` launches this repository's token and hook through the real factory on a fork. The launch call uses about 3.4M gas; liquidity offered in the next transaction is refused; a 1 ETH buy at the open pays 0.99 ETH of tax; `claimFees` still collects. |
| 4 | Nothing else changed: ABI, method ids, storage layout and permissions (0x18CC) are identical; the runtime gained one `TSTORE` and one `TLOAD` and lost one `NUMBER`; it has no `DELEGATECALL`, `CALLCODE`, `SELFDESTRUCT` or `CHAINID`. | Clean | No change. |
| 5 | Test gap: nothing showed that a later `initialize` on the hook cannot set the mark again. A mutant that sets it in every `afterInitialize` survived the suite. | Should fix (tests) | **Fixed.** `test_laterPoolsOnTheHookDoNotReopenTheLaunchPool` initialises a second native pool and a pool without ETH in a later transaction, then offers the launch pool liquidity and is refused. It fails against that mutant. |
| 6 | No other blocking candidate in the hook: the constructor has no chain-id or code-existence gate, the launch-pool rule cannot be front-run under this factory, the four tax modes were re-derived against v4's delta accounting, and `unlockCallback` is reachable only through the hook's own `unlock`. | Clean | No change. |
| 7 | The stated test count depended on the forge version, and one older fork test failed `forge fmt --check`. | Note | Counts are stated with their version; the file is formatted. |

After the review the suite is 222 tests on forge 1.7.1, none failing, in default and `--isolate` modes; forge 1.8.3 counts the same suite as 215, because it reports each contract's invariants as one test. Ten are mainnet-fork tests that skip themselves without `MAINNET_RPC_URL`.

The same day, IMD's public records of other hook launches were read for what admission checks: every contract under `src/` must build reproducibly and carry no `CALLCODE`, `DELEGATECALL` or `SELFDESTRUCT` (all of Pupate's are clean, the pre-deployed ones included), seven protected tests run against the creation code (flags against permissions, callbacks refusing callers other than the PoolManager, the token minting the policy's supply to its deployer), and a judge ranks the audit's findings, parking the launch on one that blocks and stays open.

## The audit of launch #1400 (2026-10-12)

IMD's swarm audited the repository at commit `697677a` for the launch. One agent audited the code as it was, four specialists audited the math, the permissions, the economics and the control flow, and a judge reproduced, merged and ranked what they found. Six of the seven admission checks passed: provenance, independent review, bytecode, manifest, protected invariants and economics. The seventh, findings, did not. One blocking finding stayed open, because a request to launch exact code gives no agent a way to change the source, and the launch was parked. Nothing had been deployed by it. The audit raised nothing against PupateHook or PupateToken.

The finding was real, and both earlier reviews of Cocoon had missed it. The invariant suite already stated the property it breaks (the balance is exactly the four pots), but its handler only ever auctioned a well-behaved token.

| # | Finding | Severity | Outcome |
|---|---|---|---|
| 1 | `takeAuction` called the lot token while the taker's excess ETH was still in the balance, and `skim` was guarded only against running during a Seaport purchase. Anyone can put any contract up as a lot (`startAuction` asks a token for nothing but a balance), wait for the price to decay to zero, and take the lot with a large excess. The token's `transfer` then calls `skim`, which books the unrefunded excess into the burn pot, and the excess is refunded. The pots claim ETH that has left, and later burns spend the developer, seat and IMD pots. Free for the attacker, and nothing in the vault could correct a pot. | High (critical by the economics specialist) | **Fixed.** `skim` and `depositTax` hold the reentrancy lock that every other ETH-moving entry point holds, `takeAuction` refunds the excess before it calls the lot token, and `burn` lowers its pot by what it spent instead of assigning it. `test/cocoon/CocoonReentrancy.t.sol` keeps the audit's proof and adds the same window in the IMD auction. The invariant handler now has a lot token that calls back into Cocoon; with the defect put back, `invariant_theBalanceIsExactlyTheFourPots` fails. The vault deployed for launch #1400 (`0x0adD7b9584cd73CeF21B39014e3ff6077BE53441`) was never wired and holds nothing. It is abandoned, and a new one is deployed from the fixed source. |
| 2 | `_record` kept a seat's cost in 128 bits and added the untruncated cost to `heldCost`. A reported floor of 2^128 wei or more (an attester or unit error) would leave a residue in `heldCost` that pins the mode to ACCUMULATE. | Low | **Fixed.** A cost that does not fit is refused (`OutOfBounds`): `test_aFloorTooLargeForTheBooksCannotBeAdopted`, `test_theLargestCostTheBooksHoldIsRecordedWhole`. |
| 3 | A harvest auction starts at a fixed price whatever the lot is worth, so whoever opens it can take a lot worth more than that in the same transaction. The IMD auction has the same shape. | Low (medium by the economics specialist) | **Mitigated.** Nothing on-chain prices an arbitrary token, so the default start is now the upper bound, 100 ETH, and the curve finds the price on the way down: `test_openingAndTakingAtOnceCostsTheWholeStartPrice`. The IMD auction's default start, 20,000 IMD per ETH, was about 78 times the market rate that day (256 IMD per ETH). The timelock can move both. |
| 4 | `burn` takes its price limit from the pool's spot price. When sells have taken the pool's last ETH, a sell can leave the price parked above the seeded range at no cost, and the buyback then buys nothing and reverts until someone buys. | Low | **Accepted.** Temporary and self-healing: any buy, however small, moves the price back into the range. The keeper does not send that buy itself yet. |
| 5 | FloorFeed lets a fall through without limit and caps a rise at 25% of the lower value per six hours, so one low report holds the floor down for days. Meanwhile the vault cannot buy at the market price, and a seat adopted in that time is listed far too low. | Low | **Accepted.** FloorFeed is deployed and unchanged. The cap exists against a manipulated high floor, which is the direction that costs the vault money. The owner's `setQuestion` clears a bad value, through the 48-hour timelock after handover. |
| 6 | `launch.json`'s notes were 4,307 characters; the manifest allows 4,000. | Medium (manifest only) | **Fixed** by the swarm's manifest agent at the time, and kept under the limit since. |
| 7 | The swarm's manifest agent replaced `initialPrice` with 2^96, following its own reference text. The specialists flagged that as a 1,000,000,000 ETH valuation and it was restored. | High (manifest only, introduced and fixed within the audit) | The request now says to keep the 10 ETH value. |
| 8 | IMD's protected tests do not compile inside this tree: they bring their own mocks and helpers. | Info | None needed. The verifier builds them in its own project, and all seven passed at admission. |

### Independent review of the fix (2026-10-12)

A reviewer that had not written the fix was given the diff and asked to break the fixed vault. It confirmed the reported bug closed (the restored defect fails the balance invariant on every seed it tried) and found that the fix itself had opened a second hole.

| # | Finding | Severity | Outcome |
|---|---|---|---|
| 1 | Refunding the excess before the lot transfer gives the taker control while the lot is still in the vault. From its refund the taker calls `startAuction`, which held no lock, and it reads a balance that still counts the lot: an auction is booked for tokens that leave a moment later. The next harvest of that token cannot be auctioned (`AuctionRunning`), nobody else can take the phantom lot (`TransferFailed`), and after 48 hours the attacker tops the balance up and takes everything the vault has gathered of that token for nothing, setting the trap again in the same call. The ETH books stay whole; the harvest is lost. | High | **Fixed.** `startAuction` and `startImdAuction` hold the lock as well: nothing that reads a balance into the books runs while a take is half done. The reviewer's proof fails against the fix; `test_aTakerCannotReopenTheHarvestAuctionFromItsRefund` and `test_aTakerCannotReopenTheImdAuctionFromItsPayout` keep it, the invariant handler has a taker that calls back from its payment, and `invariant_noAuctionClaimsMoreThanCocoonHolds` states the property. With either lock removed, the suite fails. Cocoon's runtime is 24,362 bytes. The vault deployed with the first fix (`0xc4E514E60565a2c04bd657f18bB34B503D6c299D`) carries this hole; it was never wired and holds nothing. |
| 2 | A seat holder can list its own seat at 1 wei, have the vault buy it, and buy it straight back, which records a cost of 1 wei and flips `mode()` to BURN until the seat is settled. No ETH leaves; the split of the next deposits moves. | Low to medium | **Accepted for now.** The vault pays 1 wei for a seat it then lists at the usual multiples, and `settleSeat` restores the books. A floor-relative lower bound on the purchase price is the fix if it is ever abused. |
| 3 | Two changes of the fix are pinned by no test: `burnPot -= spent + reward` (sound, and indistinguishable while nothing third-party runs inside `burn`) and the order of `takeImdAuction`'s bookkeeping. | Low | The lock on `startImdAuction` removes what the second could have become. |
| 4 | Notes: `receive` is necessarily outside the lock; an absurd attested floor (2^256 / heldCount) makes `mode()` overflow until the report expires; a seat can be recorded 65,536 times at most. The review also ran the IMD auction against the live IMD token on a fork: the IMD reaches the dead address and the lot reaches the taker. | Note | The contract's description now says what the lock covers and what `receive` does outside it. |

The review found nothing else blocking, ran the suite on forge 1.7.1 and 1.8.3 in both modes, mutated the fix twenty ways, and scanned every contract's bytecode for the opcodes the launch platform refuses (none).

## The audit of launch #1412 (2026-10-12)

The second attempt launched commit `f66596e`, with the first fix and the vault deployed from it (`0xc4E514E60565a2c04bd657f18bB34B503D6c299D`), while the independent review of that fix was still running. It was parked for two blocking findings. One was the review's own finding, which it had reported fourteen minutes after the launch was paid. The other was new. Every other admission check passed again, and the hook and the token again drew no finding.

| # | Finding | Severity | Outcome |
|---|---|---|---|
| 1 | `takeAuction` refunds the taker before the lot leaves and `startAuction` held no lock: a taker re-enters and books a phantom auction over tokens the vault no longer holds. | High | **Fixed** before this audit ruled (the section above): `startAuction` and `startImdAuction` hold the lock. |
| 2 | `buySeat` accepted an order whose offerer is Cocoon itself. Seaport asks no signature of an offerer that fulfils its own order, and Cocoon is the fulfiller, so a seat Cocoon already held but had not recorded (one sent to it directly, or one that came back after a sale) could be "sold" to it for the floor plus 5%, paid from the seat pot to whoever the order named, plus the caller reward. | Medium | **Fixed.** `_checkOrder` refuses an order whose offerer is Cocoon, and any order for a seat the vault already holds (`AlreadyHeld`); such a seat is adopted for nothing. The mock Seaport now skips validation for a self-fulfilled order as the real one does, so `test_cocoonCannotBeSoldASeatItAlreadyHolds` shows the exploit and its refusal; `test_aSeatTheVaultAlreadyHoldsCannotBeBoughtFromAnyone` covers the other offerers. |
| 3 | One base unit of a harvest token, sent to the vault and auctioned at the 100 ETH start, parks the real harvest of that token behind a 48-hour dust auction; a 1 wei IMD lot does the same to the IMD auction. | Low | **Accepted.** The curve reaches zero after 48 hours whatever the start, so the delay is the same at any start price, and the lot is taken for nothing then and the real harvest auctioned next. A minimum lot per token cannot be stated on-chain. |
| 4 | Notes: the integer square root in `burn` rounds the price limit down (one burn may move the price 5.016% against a 5% bound); the rise allowance in FloorFeed truncates to zero for tiny stored floors; until `PostLaunch` one EOA holds every role and is the timelock's sole proposer, and behind the 48-hour delay it can replace the attester; only the launch pool is taxed, so a hookless ETH/PUPATE pool would trade untaxed. | Info | The site and the README describe the tax as the launch pool's; the timelock and the attester are documented in `docs/deployment.md`. |

The vault of this attempt was never wired and holds nothing. The third vault, `0x54993066369e57a49215f6fc2D9911a8e5a57a79`, is deployed from the source with all three fixes.

### Independent review of fixes two and three (2026-10-12)

A reviewer that had written none of the fixes was given the lock on the two auction openers and the two `_checkOrder` guards, and asked to break them before the third attempt was paid for. Verdict: safe to redeploy and launch, nothing to change first. It checked the Seaport side against the live Seaport 1.6 on a fork of mainnet, not only against the mock: with the two guards removed, a self-order for an unrecorded seat the vault held paid the attacker 2.8 ETH and cost the seat pot 2.814 ETH; with them it reverts `BadOrder`, and an order for a held seat from a third party or an ERC-1271 offerer reverts `AlreadyHeld`. A zone that re-enters from both of Seaport's zone hooks got `Reentrancy` from every book-reading entry point it probed, and the purchase still completed. It re-derived Seaport's rules from its source (the signature is skipped only for the caller; conduits only change who executes the offerer's transfer; criteria resolvers and partial fills are refused by `_checkOrder`), found no legitimate flow that reaches the openers under the lock, and mutated each guard: every one is caught by at least one test. One gap: the post-fulfilment check that the seat really arrived was pinned by nothing, so `test_aPurchaseThatDeliversNoSeatIsRefused` now fails without it (the mock Seaport can be told to take the price and deliver nothing). Noted and accepted: ETH force-sent to Seaport is swept to the next fulfiller, which here understates one purchase's recorded cost by that amount.

## Independent audit of the whole vault (2026-10-12, before the third attempt)

After two parked launches the whole of Cocoon was given to a fresh auditor, with the brief to find anything a strict automated judge would rate medium or above, before another launch was paid for. Two small changes from the earlier reviews' notes went in first: the burn's price limit rounds in the vault's favour (one unit added to its integer square root, so a burn never moves the price past `burnImpactBps`; before, 5.016% at the 5% bound), and a purchase far under the floor is refused.

| # | Finding | Severity | Outcome |
|---|---|---|---|
| 1 | The new lower bound on a purchase price checked the order's ceiling (the larger of its two amounts), but Seaport charges the current amount of a rising or falling listing. A listing falling from 1.05 times the floor to a wei with a second left passed every check and was bought for about nothing: a cost of a wei on the books, the mode tilted to BURN, and the seat bought back from the vault's own listing for about as little, repeatable after every settle. Reproduced on the mock and on the live Seaport with the live collection. | Medium | **Fixed.** The bound binds what was actually spent, checked after Seaport returns (`spent < floor / 2` reverts `BadOrder`); `_checkOrder` hands the floor back for it. `test/cocoon/CocoonPriceBound.t.sol`: a falling listing near its end and a rising one in its first second are refused, a falling one still above half the floor and a flat one at half are bought, a flat one a wei under is refused. The check also catches a seller's recipient pushing most of its payment back into Seaport, which Seaport sweeps to the vault as refund. |
| 2 | The upper bound checks the ceiling too, so a falling listing that starts above 1.05 times the floor is refused even when its current price is at or under the floor. | Low | **Accepted.** A missed bargain, never a loss; relaxing it would let a purchase revert after Seaport ran. |
| 3 | `launch.json`'s notes still named the retired second vault as the sink while `constructorArgs` named the third. | Low (manifest) | **Fixed**; both name the vault that is launched. |
| 4 | Notes: a sandwich around the permissionless `burn` gains at most the impact limit and pays the hook tax twice, so the timelock should keep twice the standing tax above `burnImpactBps`; after a sold seat is sent back and before `settleSeat`, its flat-tail listing is live again (the vault only gains); the collection is a plain ERC-721 and the IMD token an OpenZeppelin OFT, both without transfer hooks, as the vault assumes. | Info | Recorded. |

Checked and found clean: every pot-changing path against the balance identity, the lock on every value-moving and balance-reading entry point, `_checkOrder` against Seaport 1.6's rules (signature skipped only for the caller, the sweep of Seaport's whole balance to the fulfiller, criteria resolvers refused, validate and cancel offerer-only), the operator's and developer's powers, the owner's bounds, harvest auctions with reverting, silent and re-entering tokens, the burn limit at every allowed `burnImpactBps`, FloorFeed stale, tiny and huge, and the hook interplay. The fix was confirmed by the same auditor on the repository's tree before the third attempt.

After these changes the suite is 245 tests on forge 1.7.1 and 237 as forge 1.8.3 counts them, none failing, in default and `--isolate` modes. Cocoon's runtime is 24,490 bytes of the 24,576 allowed.

## Metamorph MD (2026-10-14)

Reviewer: an agent that had not seen the design, given one paragraph describing the contract and asked to break it as an adversarial auditor. Commit reviewed: `e115b54`. Scope: `src/metamorph/MetamorphMD.sol` (672 lines), `src/metamorph/ERC721Lite.sol` (111 lines) and the twelve files of `test/metamorph/`. The deployed contracts (Cocoon, PupateHook, PupateToken) and v4-core's PoolManager were read as the environment and not reviewed. The contracts were read in full before the tests. The suite was 84 tests on forge 1.7.1, all passing. Every candidate was tried on the fixture in a scratch test file: two proofs, eleven checks, a profitability sweep, a model of the bound, and one mutant run through the invariant campaign. The file was deleted afterwards. Nothing ran against a live RPC, and the fork test was not run.

### Findings and outcomes

| # | Finding | Severity | Outcome |
|---|---|---|---|
| M-1 | The IMD leg of a conversion is bounded against a spot price the caller can move, so a sandwich of `convert()` or of a mint's duty conversion pays on the hookless ETH/IMD pool. | Medium | **Fixed** in `c2d9321`: the IMD leg has its own bound, `BUY_IMPACT_BPS = 150`; the launch leg keeps 500. Since `1815057` the constructor also refuses an ETH/IMD pool charging under 1%, which the bound assumes. Pinned by `test_sandwichingAPublicConvertDoesNotPay` and `test_aMinerSandwichingItsOwnDutyConversionDoesNotPay`. Both proofs reproduced before the fix. A residual for an attacker that is also a large share of the pool's liquidity is recorded below. |
| L-1 | The difficulty eases only on a successful mint, so a burst of fast mints leaves it high for as long as nobody mints. | Low | **Fixed** in `2b8548d` with the audit's own fix: silence eases the target by four per `DECAY_INTERVAL` (360 s) without a mint, and proofs, gilt and the retarget use the eased target. Pinned by `test_silenceEasesTheTargetWithoutAMint`, `test_aProofAgainstTheStoredTargetStaysValid`, `test_aProofAgainstTheEasedTargetMintsAndRetargetsFromIt` and, since `a8bf5da`, `test_giltIsJudgedAgainstTheEasedTarget`. |
| L-2 | A conversion runs both legs or neither: a parked launch price or an empty IMD pool stops the ETH and the PUPATE together, and every cheap mint retries the failure. | Low | **Partly fixed** in `bde2b06`: after a failed duty conversion, mints leave the conversion alone for `CONVERT_BACKOFF` (300) blocks; since `d68a172` only a duty that had its whole gas allowance arms the back-off (`a8bf5da` set its margin: more than `CONVERT_GAS` × 64/63 + 10,000 gas must be left at the call). The dead-pool lock stays accepted: if the liquidity within 1.5% of the ETH/IMD spot leaves for good, the pot never converts again (see the resolution). |
| L-3 | Rewards are paid per conversion, not per time staked. Staking, converting and unstaking in one transaction takes a full share. | Low | **Accepted**: no time locks is the spec's choice. With no keys and no upgrade path, a stake-age rule can only come with a new collection, so it is a decision for the owner before deploy, not a later change. Verified. |
| L-4 | `uint32(seat)` silently cuts seat ids of 2^32 and above. | Low | **Fixed** in `c2d9321`: `noteSeat` refuses seat ids above 2^32 − 1 (`SeatTooLarge`). Pinned by `test_noteSeatRefusesSeatIdsAbove32Bits`. Verified; latent on mainnet. |
| L-5 | The constructor accepts a launch-pool key that is not the hook's launch pool, and the pot is then locked forever. | Low | **Fixed** in `c2d9321`: the launch key must be the hook's `launchPool`, and both pools must be initialised (`BadPoolKey`). Pinned by `test_constructorRefusesBadBitsAndBadKeys`. Verified. |
| L-6 | A card's stage can fall back from butterfly to chrysalis, while its stake keeps the butterfly weight. | Low | **Accepted and pinned** in `c2d9321` by `test_aStageCanFallBackUntilTheSeatIsSettled`; documented in the spec's errata, and the keeper settles promptly. Verified. |
| I-1 to I-9 | Duty starvation by gas limit, stray tokens, seat pick drift, the seat list's walk, the launch leg's reliance on the hook tax, proof-of-work properties, ERC-721 details, lazy reweighing, test gaps. | Info | **Accepted**: recorded, no change, except I-9, whose weight invariant was added in `c2d9321` (`invariant_totalWeightIsTheSumOfStakedWeights`), I-4, whose seat list `forgetSeat` prunes since `ab81701`, and I-8, answered by the permissionless `poke(ids)` of `b1a277f`. I-1 was **declined** in the revision: the page and the keeper pad the gas limit. |

#### M-1. The IMD buy is bounded against a spot price the caller can move

**Lines.** `src/metamorph/MetamorphMD.sol:575-584` (`_limits`; the buy limit is set at 580-583 from the spot of the moment), `:524` (the limits are read when the call is made), `:561-569` (the ETH/IMD swap), `:506-508` (`convert` is open to anyone), `:316-318` (the receiver hook runs before `_duties`), `:634-638` (the duty conversion), `:85` (`CONVERT_IMPACT_BPS = 500`, used for both legs).

**Sequence.** 1. A conversion is due, with ETH to spend: what its sale brings plus `ethPot`. 2. In one transaction or bundle, the attacker borrows ETH (a flash loan works) and buys IMD in the ETH/IMD pool, which pushes its price down. 3. The attacker calls `convert()`. `_limits` reads the moved spot, so the 5% bound starts from there, and because it is a fraction of the moved pool, it widens with the front-run. The contract spends its ETH at the moved price. 4. The attacker sells the IMD back and repays. `unlock` cannot nest, so the three steps are three separate unlocks, and nothing in the contract prevents that. A contract miner needs no mempool at all: it makes the same front-run from `onERC721Received`, which runs before `_duties`, so it sandwiches the conversion its own mint runs and also collects the 0.5% reward.

**Impact.** The IMD the stakers are credited per ETH falls as far as the attacker's fees allow. On the fixture's pool (100 ETH deep, 1% fee), the best of seven front-runs (2 to 100 ETH) lost money when the contract had ETH worth 1.0% of the pool's ETH depth to spend, and earned 0.083, 0.27, 0.83 and 2.20 ETH at 1.5, 2, 3 and 5%. At 5% the stakers received 25% of the honest rate. The buy bound itself binds at about 2.6% of depth, so any conversion big enough to hit it can be sandwiched for a profit, and hitting the bound is exactly how ETH comes to wait in `ethPot`. Since the bound scales with the moved pool, the only cap on the attacker is the ETH the conversion holds. Against a buyer with unlimited ETH, the 500 bps bound let a 400 ETH front-run net 7.5 ETH. Whether mainnet reaches this depends on the depth of the ETH/IMD pool against the size of a conversion. Small, frequent duty conversions against a deep pool are safe. A thin pool, a large pot (gas dear for a while and nobody calling `convert`) or a rising PUPATE price are not. The launch leg is not exposed while the hook taxes both sides of a trade (see "Not exploitable, considered"). The hook's owner can lower that tax but never raise it (I-5).

**PoC** (`test/metamorph/MetamorphAudit.t.sol`, run with `forge test --match-contract MetamorphAuditTest -vv`):

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {console2} from "forge-std/console2.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {PupateToken} from "../../src/PupateToken.sol";
import {MetamorphMD} from "../../src/metamorph/MetamorphMD.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {PoolRouter} from "../utils/PoolRouter.sol";
import {MetamorphFixture} from "./MetamorphFixture.sol";

/// @dev A miner that sandwiches the conversion its own mint runs: it buys IMD while the card is
/// delivered (before the duties), and sells it back once the mint returns.
contract SandwichMiner {
    MetamorphMD internal immutable md;
    PoolRouter internal immutable router;
    MockERC20 internal immutable imdToken;
    PoolKey internal imdKey;
    uint256 internal front;
    uint256 internal got;

    constructor(MetamorphMD md_, PoolRouter router_, PupateToken pupate_, MockERC20 imd_, PoolKey memory imdKey_) {
        md = md_;
        router = router_;
        imdToken = imd_;
        imdKey = imdKey_;
        pupate_.approve(address(md_), type(uint256).max);
        imd_.approve(address(router_), type(uint256).max);
    }

    function run(uint256 anchor, uint256 nonce, uint256 front_) external {
        front = front_;
        md.mint(anchor, nonce); // the duties convert inside, after the front-run
        router.swap(imdKey, SwapParams(false, -int256(got), TickMath.MAX_SQRT_PRICE - 1)); // back-run
    }

    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4) {
        uint256 before = imdToken.balanceOf(address(this));
        router.swap{value: front}(imdKey, SwapParams(true, -int256(front), TickMath.MIN_SQRT_PRICE + 1));
        got = imdToken.balanceOf(address(this)) - before;
        return this.onERC721Received.selector;
    }

    receive() external payable {}
}

contract MetamorphAuditTest is MetamorphFixture {
    /// The IMD leg's bound is relative to the spot price at the call. A searcher moves the hookless
    /// ETH/IMD pool first, lets convert() buy at the moved price, and moves it back.
    function test_poc_sandwichTheImdLeg() public {
        // ETH waiting in the contract, 3% of the IMD pool's 100 ETH: what a conversion leaves when its buy
        // bound refused part of the ETH (MetamorphConvertTest builds that state with a thinned pool).
        vm.deal(address(md), 3 ether);

        // The honest conversion, on a copy of the state.
        uint256 copy = vm.snapshotState();
        uint256 honestImd = md.convert();
        uint256 honestSpent = 3 ether - address(md).balance;
        vm.revertToState(copy);

        // The sandwich, as one transaction: front-run, convert(), back-run. The 60 ETH can be flash-borrowed.
        uint256 imd0 = imd.balanceOf(address(this));
        uint256 eth0 = address(this).balance;
        _swap(router, imdKey, true, -int256(60 ether)); // front-run: buy IMD
        uint256 got = imd.balanceOf(address(this)) - imd0;
        uint256 sandwichedImd = md.convert(); // anyone may call; the 0.5% reward is the attacker's as well
        uint256 sandwichedSpent = 3 ether - address(md).balance;
        _swap(router, imdKey, false, -int256(got)); // back-run: sell the same IMD
        int256 profit = int256(address(this).balance) - int256(eth0);

        console2.log("honest: IMD bought", honestImd, "ETH spent", honestSpent);
        console2.log("sandwiched: IMD bought", sandwichedImd, "ETH spent", sandwichedSpent);
        console2.log("attacker ETH profit (wei)", profit);
        assertGt(profit, 0.8 ether, "the sandwich nets the attacker over 0.8 ETH");
        assertLt(
            sandwichedImd * 1e18 / sandwichedSpent,
            (honestImd * 1e18 / honestSpent) * 40 / 100,
            "the stakers get under 40% of the honest IMD per ETH"
        );
    }

    /// The same, inside a mint: a contract miner front-runs from its receiver hook, before the duties run.
    function test_poc_minerSandwichesItsOwnDutyConversion() public {
        _endLaunch();
        for (uint256 i; i < 3; i++) {
            vm.roll(block.number + 1);
            vm.warp(block.timestamp + 90);
            _mintAs(miner); // gas is dear: 105,000 PUPATE wait in the pot, a conversion is due
        }
        vm.deal(address(md), 3 ether); // and ETH waits, as in the test above
        SandwichMiner sm = new SandwichMiner(md, router, token, imd, imdKey);
        deal(address(token), address(sm), 1_000_000 ether);
        vm.deal(address(sm), 60 ether);
        vm.fee(1 gwei); // gas is cheap: the mint runs its duties
        vm.roll(block.number + 1);
        vm.warp(block.timestamp + 90);
        uint256 a = _anchor();
        uint256 n = _proof(address(sm), a);
        sm.run(a, n, 60 ether);
        console2.log("miner ETH after (wei)", address(sm).balance);
        console2.log("miner IMD reward", imd.balanceOf(address(sm)));
        assertEq(md.lastConvertBlock(), block.number, "the duty converted inside the mint");
        assertGt(address(sm).balance, 60.8 ether, "and the miner kept over 0.8 ETH more than it started with");
    }
}
```

**Outcome.** Both tests pass, so both attacks reproduce. `test_poc_sandwichTheImdLeg`: run honestly, the conversion bought 647.68 IMD for 2.6219 ETH (247.0 IMD per ETH; its bound left 0.378 ETH waiting). Sandwiched, it bought 293.77 IMD for all 3 ETH (97.9 IMD per ETH, 39.6% of the honest rate), and the attacker kept 0.8264 ETH. `test_poc_minerSandwichesItsOwnDutyConversion`: the duty converted inside the mint, and the miner finished with 60.8273 ETH from 60 plus 1.4696 IMD of reward.

**Fix.** Bound the IMD leg so that one conversion cannot move the pool's ETH depth by more than the pool's fee, whatever spot it starts from. On a 1% pool that is a price impact of at most 150 bps: the ETH reserve then moves by at most 0.76%. I checked this by modelling the buy with the router: a buyer with unlimited ETH, limited exactly as `_limits` limits it, and front-runs from 1 to 400 ETH. At 150 bps every front-run lost (at best −0.005 ETH). At 200 bps the best broke even, and at 300 bps one still paid 2.5 ETH. Keep 500 bps for the taxed launch leg. The cost is that waiting ETH is spent more slowly, over more conversions five blocks apart. Optionally, also refuse a conversion whose IMD spot has moved by more than the bound from a price recorded in an earlier block (at the last mint, say), which takes away the same-block lever altogether. Keep the two proofs as tests.

**Resolution.** Fixed in `c2d9321`. The IMD leg has its own bound, `BUY_IMPACT_BPS = 150`, and the taxed launch leg keeps `CONVERT_IMPACT_BPS = 500`. The bound resists a sandwich only against a fee of at least 1% a side, so since `1815057` the constructor refuses an ETH/IMD key whose fee is under 10,000 (`BadPoolKey`; a 0.3% pool that exists is refused in `test_constructorRefusesBadBitsAndBadKeys`). The two proofs are kept in `test/metamorph/MetamorphConvert.t.sol` as `test_sandwichingAPublicConvertDoesNotPay` (front-runs of 1 to 400 ETH) and `test_aMinerSandwichingItsOwnDutyConversionDoesNotPay`, which now assert that the sandwich costs its maker ETH. On the same state, the public sandwich (a 60 ETH front-run, 3 ETH waiting) went from +0.8264 ETH to −0.2458 ETH, and the miner's from +0.8273 ETH to −0.2458 ETH (its IMD reward from 1.4696 to 0.6023). The honest conversion now buys 192.0 IMD for 0.7633 ETH and leaves 2.24 ETH waiting. Over front-runs of 0.5 to 400 ETH with 0.5 to 30 ETH waiting, the attacker's best result was −0.0025 ETH. The three bound tests now end exactly at the limit, 9,925/10,000 of the sqrt price: with 500 bps on the buy leg, six tests fail, and without the `+ 1`, three do.

Two things the bound does not do. The stakers' rate in a sandwiched conversion is set by the size of the front-run, not by the bound: 39.35% of the honest IMD per ETH at 60 ETH, against 39.6% before. The bound caps the ETH exposed (1.22 of the 3 ETH, where all 3 went before), and the rest waits for a later conversion, but a griefer still pays less than the stakers lose (0.25 ETH against about 0.74 ETH of IMD at the honest rate). And the protection rests on the fees going to someone else: an attacker that is also about a quarter or more of the pool's in-range liquidity gets enough of them back. On the fixture (its wealth after withdrawing its position, IMD valued at 256 per ETH, against the honest conversion), a 60 ETH front-run netted +0.05 ETH at a 30% share, +0.16 ETH at 40%, +0.26 ETH at 50% and +0.73 ETH as the only LP; at 25%, every size lost. The earlier-block reference price would close both. By ruling, it was not added.

#### L-1. The difficulty eases only on a successful mint

**Lines.** `MetamorphMD.sol:343-359` (`_retarget` runs only inside `mint`), `:292-293` (the target that is checked is the stored one).

**Sequence.** Each mint 22 seconds or less after the last one divides the target by four. Five mints in consecutive blocks raised the requirement from 1 bit to 11 on the fixture; at the mainnet floor that is 20 bits to 30. After a month of silence `bits()` was still 11, and a proof that met a target four times easier was refused with `NotASolution`. By estimate, a miner hashing about 1.5 GH/s (one strong GPU) finds each next proof within a 12-second block up to roughly 34 bits, which leaves the target at about 36 bits. Browser miners then need about 2^36 hashes for the next proof. After that, each mint eases the target by at most 2 bits, and only when it came at least 360 seconds after the one before.

**Impact.** Liveness only. After a burst, or after a large share of the hash rate leaves, the pace can stay far below one mint per 90 seconds until the miners who remain grind through about 1.33 times the work of the last proof. No funds are at risk.

**Fix.** Apply the elapsed time when a proof is checked. For example, the effective target could be `min(ceiling, target × 4^((now − lastMintAt) / 360))`, or the same `mulDiv` formula with the current elapsed time. Silence then eases the difficulty without a mint, and the retarget after a mint starts from the effective target.

**Resolution.** First accepted as a design trade-off; then fixed in the revision, `2b8548d`, with the fix above: `effectiveTarget() = min(ceiling, target × 4^((now − lastMintAt) / DECAY_INTERVAL))`, `DECAY_INTERVAL = 360` s. Proofs are checked against it, `bits()` reports it, the retarget after a mint starts from it, and gilt is judged against it (pinned in `a8bf5da`). The month of silence above now brings the target back to the ceiling. Pinned by `test_silenceEasesTheTargetWithoutAMint`, `test_aProofAgainstTheStoredTargetStaysValid`, `test_aProofAgainstTheEasedTargetMintsAndRetargetsFromIt` and `test_giltIsJudgedAgainstTheEasedTarget`; with the retarget's base or the proof's check reverted to the stored target, the tests fail. Since the final review of the revision, `test_silenceStopsAtTheCeilingBeforeTheShiftSaturates` and `invariant_targetIsNeverAboveTheCeiling` also pin the ceiling's cap on the eased target before the shift saturates. Two consequences are accepted: after silence the retarget lands ×4 above the eased target, so ×16, ×64, … above the stored target after one, two, … intervals, up to the ceiling, where it was ×4; and at an epoch boundary its base is clamped to the next epoch's ceiling, one bit harder.

#### L-2. A conversion runs both legs or neither, and a failure is retried by every cheap mint

**Lines.** `MetamorphMD.sol:549-559` (the sale is tried whenever `pot != 0`), `:577-579` (the sale limit is clamped to `MAX_SQRT_PRICE − 1`, which equals a parked spot, so the swap reverts `PriceLimitAlreadyExceeded`), `:527` (`NothingBought` also undoes the sale), `:605-606` and `:634-638` (there is no back-off: `lastConvertBlock` moves only on success).

**Sequence.** (a) Sells take the launch pool's last ETH and leave its price parked at `MAX_SQRT_PRICE − 1`. On the fixture that took one sale of 100M PUPATE into its pool of about 1 ETH. Every `convert()` then reverts inside the unlock, the waiting ETH included, until any buy brings the price back; in the test, a buy of 0.01 ETH did. (b) If the ETH/IMD pool has no liquidity within the bound, `NothingBought` undoes the PUPATE sale as well. Neither leg then runs while the IMD pool is down, and the pot stays exposed to the PUPATE price. (c) In either state, every cheap mint after the spacing tries the conversion again. The measured cost was about 300k gas per cheap mint, against 121k for a mint without duties: 180k more per mint, for as long as the state lasts, because a failure never moves `lastConvertBlock`.

**Impact.** Liveness and miners' gas. No funds are lost. (a) is temporary and heals itself. (b) lasts as long as the IMD pool stays empty, and the contract cannot switch to another pool.

**Fix.** Skip the sale when `saleLimit <= spot`, since nothing can be sold. Let a conversion that sold but could not buy keep its ETH in `ethPot` rather than revert, or run the two legs separately. In `_duties`, back off after a failure: record the block it happened in, and treat the conversion as not due for `CONVERT_SPACING` blocks.

**Resolution.** First accepted with the worst case stated; then partly fixed in the revision. A conversion still runs both legs or neither, and the keeper's `convert()` reverts in the same states as the duty (`PriceLimitAlreadyExceeded` while the launch price is parked; `NothingBought` when no IMD liquidity sits within the bound), so it is not a way out of either state. Since `bde2b06` a failed duty conversion backs off: mints leave the conversion alone for `CONVERT_BACKOFF` (300) blocks (`convertBackoffUntil`), so a failing state no longer costs every cheap mint about 180k gas, and the public `convert()` is not held back. Since `d68a172` only a duty that had its whole gas allowance can arm it. That is decided by gas before the call, not by the revert, because v4-core wraps an out-of-gas inside hook callbacks and currency transfers into a `WrappedError` that carries data. `a8bf5da` set the margin at 10,000 gas, so that the catch can always pay its first write. So a failure arms the back-off only when more than `CONVERT_GAS` × 64/63 + 10,000 gas, about 924,300, is left at the call; from about 914,700 the duty already gets its whole allowance, and in that band it fails without a back-off, so the page and the keeper pad a due conversion by 1,000,000 (the final review, below). Pinned by `test_aFailedDutyConversionBacksOff`, `test_aStarvedDutyConversionDoesNotBackOff` (a starved duty that, on this fixture, fails with a wrapped error), `test_aStarvedDutyConversionDoesNotBackOffWhenItRevertsEmpty` and, since the final review, `test_aMintPaddedByAMillionArmsTheBackOff` (the threshold) and `test_mintConvertsWhenThePotIsAHundredPricesDeep` (a success never arms it). The dead-pool lock stays, accepted by the owner: if the liquidity within 1.5% of the ETH/IMD spot leaves for good, the pot can never convert again, and 70% of every later fee stays locked as PUPATE, with any ETH waiting in `ethPot`. Recorded in the spec's errata.

#### L-3. Rewards are per conversion, not per time staked

**Lines.** `MetamorphMD.sol:418-431` (`stake`), `:434-444` (`unstake`), `:478-486` (`_credit`), `:506-508` (`convert`).

**Sequence.** A long-term staker held one card. Another holder with three unstaked cards staked them, called `convert()`, unstaked and claimed, all in one transaction. The holder got 0.3079 of the 0.4105 IMD credited (three quarters) and the long-term staker 0.1026. The three cards could be traded again in the same transaction.

**Impact.** The transfer lock that staking imposes costs a just-in-time staker nothing. Long-term stakers are diluted by weight that is there for one block. With lent cards, if a lending market for them ever exists, that weight need not even be owned. Nobody takes more than a permanent staker of the same weight would.

**Fix.** Stream each conversion's IMD over a period (a reward rate, as Synthetix does), or let a stake earn only from conversions at least N blocks after it was made.

**Resolution.** Accepted: no time locks is the spec's choice, so a stake made just before a conversion takes a full share of it. With no keys and no upgrade path, a stake-age rule can only come with a new collection, so it is a decision for the owner before deploy, not a later change. Recorded in the spec's errata.

#### L-4. `uint32(seat)` cuts seat ids of 2^32 and above

**Lines.** `MetamorphMD.sol:306-307` (the cast), `:117-118` (`Card.seat`), `:373` (`stageOf` reads the stored seat), `:391` (`tokenURI`), `:275-282` (`noteSeat` accepts any id).

**Sequence.** Seat 2^32 + 999 was given to the vault, noted, and picked by a mint. The card stored seat 999. `stageOf` then read seat 999, which the vault does not hold, so the card was a butterfly at once and staked at weight 2 from its first block. The art receives seat 999.

**Impact.** Latent. The mainnet collection's ids look small (the fork tests use seat 1376), so this matters only if ids of 2^32 or more exist.

**Fix.** Refuse such seats in `noteSeat` (`if (seat > type(uint32).max) revert`), or store the seat in full.

**Resolution.** Fixed in `c2d9321`: `noteSeat` refuses seat ids above 2^32 − 1 with `SeatTooLarge`. `test_noteSeatRefusesSeatIdsAbove32Bits` (`test/metamorph/MetamorphViews.t.sol`) refuses 2^32, and notes, picks and stores 2^32 − 1 whole.

#### L-5. The constructor accepts a launch-pool key that is not the hook's launch pool

**Lines.** `MetamorphMD.sol:186-190`.

**Sequence.** The constructor checks the keys' currencies and hooks, but not their fee or tick spacing. On the fixture, whose launch pool has a fee of 3,000, a key with fee 12,500 deployed and minted, and then every `convert()` reverted (`PoolNotInitialized`). The PUPATE pot can never be sold, and there is no owner to correct it. An ETH/IMD key that names an uninitialised or empty pool behaves the same way.

**Impact.** A deployment mistake would lock 70% of every fee for good. `script/DeployMetamorph.s.sol` hard-codes 12,500/60 and 10,000/200, matching the fork test, so this is a guard against a mistake, not a live defect.

**Fix.** In the constructor, require `PoolId.unwrap(pupateKey_.toId()) == PoolId.unwrap(hook_.launchPool())`, and a non-zero `sqrtPriceX96` for both pools.

**Resolution.** Fixed in `c2d9321`, as proposed: the launch key must be the hook's `launchPool`, and both pools must be initialised on the PoolManager given, else `BadPoolKey`. `test_constructorRefusesBadBitsAndBadKeys` (`test/metamorph/MetamorphViews.t.sol`) adds three cases, each breaking one rule alone: a launch key with fee 12,500, initialised on the same hook; an ETH/IMD key whose pool was never initialised; and a PoolManager on which only the ETH/IMD pool exists. With any one rule removed, the test fails. The fork test and `script/DeployMetamorph.s.sol` need no change: they name the mainnet launch pool (fee 12,500, spacing 60), which Cocoon's `wire` already checked against the hook's `launchPool()`, and both pools exist.

#### L-6. A card's stage can fall back

**Lines.** `MetamorphMD.sol:369-374` (`stageOf`), `:644-652` (`_vaultHolds` reads the books and the wallet as they stand), `:468-473` (`_settle` reweighs to whatever the stage reads).

**Sequence.** A listing fills and the seat leaves the vault, so the cards of that round become butterflies. A staker touches its card, which reweighs it to 2. The buyer then sends the seat back to the vault before anyone calls `settleSeat`. The cards read as chrysalises again, and the touched stake keeps weight 2. `settleSeat`, which anyone can call, ends the state for good.

**Impact.** Until the next settle, the art and the weights contradict "a chrysalis until the vault no longer holds its seat", and the weights are slightly unfair. The round trip costs the buyer the seat. `invariant_stagesNeverGoBack` holds only because the handler settles a seat in the same call that sells it.

**Fix.** Accept it and document it (the keeper settles promptly), and add a test that pins the behaviour. Optionally, make emergence sticky by recording the first butterfly reading in `_settle`.

**Resolution.** Accepted and pinned in `c2d9321` by `test_aStageCanFallBackUntilTheSeatIsSettled` (`test/metamorph/MetamorphStages.t.sol`): the card falls back to a chrysalis when the seat comes back unsettled, its stake keeps weight 2 until a `claim` touches it and reweighs it to 1, and a settle while the seat is out makes the card a butterfly for good. Documented in the spec's errata; the keeper settles promptly. Emergence is not made sticky.

#### Info

- **I-1. A gas limit can skip the duties.** Each duty runs with a fixed allowance under EIP-150's 63/64 rule (`:615`, `:621`, `:635`). With a flush due, a gas limit close to the mint's own needs (330k on the fixture) skipped the flush, and the mint still succeeded. The same starves any duty. A gas estimator that settles near the gas used can do the same. If the front-end wants the duties run, it should send headroom: the mint plus the 1.7M of allowances. The duties can cost a miner up to about 1.7M gas at 2 gwei or less, against rewards that may be smaller. **Declined** in the revision: no gas-starvation guard; the page and the keeper pad the gas limit, since the final review by 400,000 for each due flush or burn and by 1,000,000 for a due conversion. A starved duty conversion does not arm the conversion's back-off (`d68a172`). What `eth_estimateGas` returns depends on the client: geth and reth start their search from the gas the unconstrained run used, so an estimate may already include a duty's consumption; a client that searches from below settles on the lowest limit at which the mint succeeds, which runs the earlier due duties and starves only the last, a starved conversion burning about 20,000 gas. Either way an estimated mint is a mid-range sender: while a pool is stuck it may pay for a failing conversion on every cheap mint, and it never arms the back-off.
- **I-2. Stray tokens and dust stay in the contract.** PUPATE or IMD sent to the contract outside a mint or a conversion is never sold, credited or recovered, because `pot` (`:146`, `:302`) and `imdOwed` (`:485`) count only their own flows. The invariants' exact `balance == pot` would fail on a donation, which the handler never makes. `imdOwed` also keeps each credit's rounding dust forever (`:484`): it cannot be claimed and does no harm.
- **I-3. A pending proof can land on a different seat.** `noteSeat` (open to anyone), `forgetSeat` (open to anyone too; it moves the list's last seat into the forgotten one's place), a fill, a settle, an adoption or an edition cap can reorder the open list without changing `prevWork` (`:329-334`). The price and the difficulty stay the same; only the seat changes, or the mint reverts `NothingMineable`.
- **I-4. Every mint walks the whole seat list.** `_seats` only grows, and `mint` walks every noted seat with two external calls each (`:259-272`), about 5k gas per seat. The list grows by every seat ever noted, sold ones included, and nothing prunes it. (Corrected by the whole-branch review: this item first said the list was bounded by the seats the vault holds during the mint. Since `ab81701`, `forgetSeat`, permissionless, takes off a seat the vault no longer holds.)
- **I-5. The launch leg's protection is the hook tax.** The launch leg resists a sandwich because the hook takes 6% on each side, against a 5% bound. PupateHook's owner can lower that tax and never raise it (`src/PupateHook.sol:237-242`). By a first-order estimate, below a standing tax of about 1.2% on the mainnet pool (whose fee is 1.25%), the launch leg could be sandwiched the way M-1 sandwiches the IMD leg. `docs/deployment.md` now warns the timelock of this floor.
- **I-6. Proof of work favours GPUs.** GPU miners outpace browser miners at any floor, because the retarget follows the strongest hardware. A miner can also pre-mine a short chain of proofs on its own unpublished work within the 50-block anchor window and land them in one block, each needing four times the work of the one before.
- **I-7. ERC721Lite differs from the standard in small ways.** `balanceOf(address(0))` and `getApproved` of an unminted id return 0, where ERC-721 says to throw (`ERC721Lite.sol:29-30`). A receiver whose fallback returns nothing makes the transfer revert with empty data instead of `UnsafeRecipient` (`:103-110`). None of this does harm.
- **I-8. Only the staker can reweigh a card.** Reweighing is lazy (`:448-453`, `:468-473`). A passive staker's butterfly keeps earning at weight 1 indefinitely while active stakers move to 2. The NatSpec documents this ("reweighed to 2 here"). A permissionless `poke(ids)` would keep the weights current. Done in the revision: `poke(ids)` (`b1a277f`) settles any staked cards for their stakers, emits ERC-4906 `MetadataUpdate` when a weight changes, and since `a8bf5da` skips ids that are not staked.
- **I-9. Test gaps.**
  - No invariant ties `totalWeight` to the stakes. A mutant whose `unstake` subtracts the weight from before `_settle` passed all seven invariants and `test_theHandlerActuallyActs` (48 runs × 48 calls). An added `invariant_totalWeightIsTheSumOfStakes`, which sums `stakeOf(id).weight` over `handler.minted`, caught it at once (`1 != 0`: weight left behind with nothing staked, so later credits are owed to nobody). The same invariant passes on the real contract.
  - No test sandwiches a conversion (M-1). The conversion tests run at about 0.2% of the IMD pool's depth, where a sandwich does not pay.
  - No test shows the difficulty easing with time alone (L-1); it never does.
  - The handler settles every seat in the call that sells it, which rules out the stage regression of L-6 by construction.
  - The parked launch price, the emptied IMD pool and the cost of the retries (L-2) are tested only as far as "the mint survives".
  - Nothing covers a seat id of 2^32 or more (L-4), a launch key that is not the hook's launch pool (L-5), just-in-time staking (L-3) or a gas-starved duty (I-1).
  - The `+ 1` in the buy limit is not pinned. Both impact tests accept 9,746/10,000, which the limit still meets without it.

**Resolution.** Accepted as recorded, with no change, except I-9 and, since the whole-branch review, I-4 (`forgetSeat`, `ab81701`). I-1's advice, to pad a mint's gas limit for the duties due, is in the spec's errata for the page and the keeper: 400,000 for each flush or burn and, since the final review, 1,000,000 for a conversion, which clears its back-off's threshold. I-9: `invariant_totalWeightIsTheSumOfStakedWeights` was added in `c2d9321`. With the audit's mutant (`unstake` subtracting the weight from before its settle) it fails at once (`2 != 1`), while the seven other invariants and `test_theHandlerActuallyActs` still pass; on the real contract it holds at 48 runs × 48 calls. Of I-9's other gaps, the sandwich (M-1), the seat id (L-4), the launch key (L-5), the stage's fall-back (L-6) and the `+ 1` of the buy limit are now pinned. Since the revision, so are easing with time alone (L-1), the back-off after a failure in the emptied IMD pool (L-2), and a starved duty conversion (I-1); since the final review, the padding that arms the back-off too. The parked price (L-2) and just-in-time staking (L-3) stay untested, their findings accepted.

### What the suite pins well

- The chain of work: the preimage, the binding to the miner, stale proofs refused before any fee is taken, the anchor window at both edges, and an anchor without a hash.
- The retarget: both clamps, the ceiling to the unit, and saturation at the 1-bit floor between 181 and 360 seconds.
- Supply and pricing: all 3,333 cards over 11 seats, each round starting its own editions, the pick formula, and the price step at the 303rd and 304th mints.
- Reentrancy through the receiver hook (`ProbingMiner`), both guards of the callback, and `convertDuty` refusing every caller but the contract.
- The staking arithmetic in isolation: splits by weight over time, settling before unstaking, reweighing on touch, the transfer lock on all three paths, and payouts never above credits (fuzzed).
- Conversions: both legs' amounts replayed through the router, the bound in an unmoved pool, the refused remainder waiting in both pots, the spacing, ETH-only conversions, and routing to the developer when nobody stakes.
- Duties: each duty, the base-fee gate at exactly 2 gwei, each gas allowance, isolation of every failure, and a miner that refuses ETH.
- Invariants: `prevWork`, the edition cap crossed within a campaign, the pot as 70% of fees less what was sold, IMD owed covered, ETH equal to the ETH pot, and the target never above the ceiling. The size test and the no-owner probe, which sends arguments.

### Not exploitable, considered

- **Reentrancy from mint through the duties into `convertDuty` and `unlockCallback`.** The lock is held from the first line of `mint` to the end of the duties. Miner code runs at two points only: the receiver hook and the burn reward's ETH send. From either one, every guarded entry reverts `Reentrancy` and `convertDuty` reverts `OnlySelf`. A scratch test confirmed this for the reward callback; the suite already covers the receiver hook. The unguarded calls a miner can reach (`noteSeat`, ERC-721 approvals and transfers of other cards, `receive`) cannot change the mint's books. The PoolManager calls back only the caller of `unlock`, and `unlock` cannot nest.
- **A sandwich of the launch (PUPATE) leg.** Dropped as a finding: it did not reproduce. After a 50 ETH buy into the launch pool, front-runs of 2M, 5M, 10M and 20M PUPATE lost 0.07, 0.17, 0.32 and 0.58 ETH, because the hook taxes both legs. The fixture's launch pool charges a 0.3% fee and the mainnet pool 1.25%, so on mainnet the loss is larger.
- **The staking accumulator.** Each credit distributes at most what it credits, and a settle that rounds down never adds. `_settle` keeps `totalWeight` equal to the sum of the stakes' weights. So total claims never exceed total credits, and `imdOwed -= paid` cannot underflow. At realistic amounts the accumulator cannot overflow. The order in which stakers claim does not matter.
- **Rounding of the bounds.** The sale limit uses 10,246/10,000 against sqrt(1.05) = 1.024695, and the buy limit 9,747/10,000 against sqrt(0.95) = 0.974679 (at `e115b54`; since `c2d9321` the buy limit is 9,925/10,000 against sqrt(0.985) = 0.992472, rounded the same way). Both round in the contract's favour, and the clamps never widen them.
- **The fee split.** The split is 70/30 to the wei. The developer cannot be the zero address, and PUPATE and IMD transfers never call the recipient, so the developer cannot make a mint or a conversion revert.
- **Retarget overflow.** The saturation guard is exact, and the target cannot fall to zero in practice.
- **Seat pick bias and the edition cap.** The modulo bias is about n/2^236, the round read in `_pick` is the round the filter used, and the edition cap cannot be crossed.
- **Replay.** The chain id, the contract's address and `prevWork` are all in the preimage. A stale or foreign proof reverts before any transfer.
- **The hook's deltas on the sale.** An exact-in PUPATE sale is not a trade that names the ETH amount, so it cannot trigger `PartialFill`. The tax comes out of the ETH the pool moved, and settling the PUPATE resets the synced currency before the native settle.
- **ETH bookkeeping.** Only the burn reward can arrive during the duties, and a reward the miner refuses is spent by the next conversion. Forced ETH, or a donation of one wei, does not make a conversion due.
- **Gas allowances.** A full conversion used 334k gas of its 900k allowance on the fixture.

After the fixes (`c2d9321`, `1815057`) the suite is 335 tests on forge 1.7.1 in default mode: 324 pass and none fail, and the 11 fork tests skip without an RPC. `test/metamorph/` holds 89 of them, with eight invariants at 48 runs × 48 calls. Under `--isolate`, 9 metamorph tests fail: the 8 that already failed there at `e115b54` and the new miner sandwich test, all because `vm.fee` does not reach isolated calls, so the mints the tests make with gas dear run their duties anyway. MetamorphMD's runtime is 19,187 bytes of the 24,576 allowed.

### The whole-branch review (2026-10-14)

A last review of the whole branch at `8167a5d`, after the audit's fixes, found five important items and seven minor ones; the fifth, I5, was left to the owner and settled in the revision below. The code, the tests and the script changed in `ab81701`; the spec's errata, this log, `script/mainnet/README.md` and `docs/deployment.md` in the commit that adds this section.

| # | Finding | Severity | Outcome |
|---|---|---|---|
| I1 | Two mutants survived the suite: a burn duty that pays the miner the contract's whole balance (`reward = address(this).balance`), and with it the ETH waiting in `ethPot`; and a `supportsInterface` that answers only ERC-2981. | Important | **Fixed** in `ab81701`. `test_theBurnRewardLeavesTheWaitingEthAlone` (`MetamorphDuties.t.sol`) leaves ETH waiting, makes a burn due and mints at 1 gwei inside the conversion spacing, so the conversion is not due and does not run; the miner gains exactly the reward of Cocoon's `Burned` event, and `ethPot` and the balance do not move. `test_supportsTheFiveInterfacesItImplements` (`MetamorphStages.t.sol`; four interfaces when `ab81701` added it, ERC-4906 since `b1a277f`) checks ERC-165, 721, 721 metadata, 2981 and 4906 on the contract, and two ids it must refuse. Each mutant now fails its test and no other: 97 of the 98 metamorph tests pass. |
| I2 | The errata and this log called a stake-age rule a possible later change (L-3) and the keeper's convert duty the backstop of L-2, whose worst case they left unstated. | Important | **Fixed**: L-2 and L-3 above, and the same two items in the spec's errata. |
| I3 | Nothing tied the deploy inputs to the launched contracts: an IMD, a collection or a PoolManager other than the vault's, or a hook that pays another vault, deployed, and nothing could correct it. The script narrowed `MIN_BITS` to 8 bits before checking it, so 276 passed for 20. | Important | **Fixed** in `ab81701`. The constructor reverts `BadWiring` unless `imd`, `collection` and `poolManager` are Cocoon's `IMD()`, `COLLECTION()` and `POOL_MANAGER()` and the hook's `sink()` is Cocoon; the script checks `MIN_BITS` before narrowing it. `test_constructorRefusesWrongWiring` breaks each input alone, past every key rule: another IMD with an initialised 1% pool of its own, another collection, another PoolManager (its storage reads mocked, as only the manager the hook answers to can initialise the launch pool), another vault on the same addresses, and a hook that pays another sink. With any one of the four comparisons removed, the test fails. `test_constructorRefusesEachZeroAddress` and `test_minBitsRunsFromOneTo200` add the guards the plan had left untested. The live vault was built with the IMD, collection and PoolManager that the fork test names (its local broadcast record), and `launch.json` names it as the hook's sink, so the fork test and the deployment pass the new check; the fork test itself was not run. |
| I4 | The seat list only grew (audit I-4, whose text also understated it): every seat ever noted stayed on it, and every mint walks it. | Important | **Fixed** in `ab81701`. `forgetSeat(seat)`, permissionless, takes off a noted seat the vault no longer holds, by swap and pop through an index (`SeatForgotten`; `SeatNotNoted`, `SeatHeld`). Editions are counted per seat and round and never reset, so a seat noted again goes on in the same round or starts at 1 in a new one. Four unit tests in `MetamorphViews.t.sol`. The invariant handler forgets every seat it sells, the campaign reaches that call, and the eight invariants hold at 48 × 48 with no revert. A mutant that skips the index update of the moved seat, and one that forgets a held seat, each fail a test. |
| I5 | The conversion duty ran once the pot held two mint prices, where the miner's 0.5% reward was about a fiftieth of the duty's gas, so a cheap mint paid to run it. Left to the owner as one of the revision's decisions; recorded here with the revision. | Important | **Fixed** in `bde2b06`: the duty waits for `CONVERT_PRICES = 100` mint prices. On a mainnet fork a hundred prices (5,005,000 PUPATE) sold for 0.0563 ETH and bought 18.45 IMD; the caller's 0.0922 IMD, about 0.000282 ETH, is about 94% of the conversion's ~300k gas at 1 gwei and 47% at the 2 gwei ceiling. Pinned by `test_mintConvertsWhenThePotIsAHundredPricesDeep`, `test_theConversionDutyWaitsForAHundredPrices`, and on the fork since `a8bf5da` by a hundred-price duty conversion inside a mint. |
| M1–M7 | The NatSpec of `ethPot`, `imdOwed` and `claim`; four places where the spec's text disagreed with the code; the plan's caption on line 1 of both ERC721Lite files; the runbook's seat step; a fuzz test whose second assertion followed from its first; no warning to the timelock about the launch leg's reliance on the tax (I-5); no note that `--isolate` breaks `vm.fee`. | Minor | **Fixed**, the code and the tests in `ab81701`: the NatSpec; four errata (the sale limit's `1 + CONVERT_IMPACT`, the script that deploys no art, the art's `View`, the waiting ETH spent with the sale's and not first); the captions removed; `script/mainnet/README.md` on finding, noting and forgetting seats; `testFuzz_aRandomNonceIsRefusedAtTwentyBits`, which expects the mint at 20 bits to refuse a random nonce from anyone (with the floor dropped to one bit it fails within a few runs); `docs/deployment.md` warns the timelock; the fixture notes `--isolate`. |

After these changes the suite is 344 tests on forge 1.7.1 in default mode: 333 pass and none fail, and the 11 fork tests skip without an RPC. `test/metamorph/` holds 98 of them, with the eight invariants at 48 runs × 48 calls. Under `--isolate` the same 9 metamorph tests fail as before, for the same reason. MetamorphMD's runtime is 19,582 bytes of the 24,576 allowed.

### Revision (2026-10-14)

The owner approved five decisions on the findings above before deploy, and the plan `docs/superpowers/plans/2026-10-14-metamorph-md-revision.md` applied them:
1. Difficulty eases with silence (L-1): `2b8548d`.
2. The conversion duty waits for a hundred prices (I5): `bde2b06`.
3. A back-off after a failed duty conversion (L-2, partly): `bde2b06`; then `d68a172`, which arms it only when the duty had its whole gas allowance, since v4-core wraps an out-of-gas into errors with data.
4. No gas-starvation guard (I-1, declined): the page and the keeper pad the gas limit.
5. A permissionless `poke(ids)` with ERC-4906 `MetadataUpdate` (I-8): `b1a277f`.

An independent review of these commits approved them. Its findings were ruled on and applied in `a8bf5da`:
- The back-off's dependence on the gas limit is documented (a mint whose limit came from `eth_estimateGas` never arms it; the page and the keeper pad the limit). The code stays.
- `whole` keeps a 10,000-gas margin, so the catch can always pay its first write.
- `poke` skips ids that are not staked.
- The `_retarget` and `CONVERT_PRICES` NatSpec state the epoch-boundary clamp and the measured reward.
- `test_giltIsJudgedAgainstTheEasedTarget` pins gilt to the eased target.
- The fork test converts a hundred prices inside a mint.

The commit that adds this section writes the spec's errata, records I5 in the table above, and settles the two parked minors: the twenty-bit fuzz test assumes a non-solution, and I-3 names `forgetSeat`.

**State after the revision.** `forge test` in default mode runs 355 tests: 344 pass, none fail, and the 11 fork tests skip without an RPC. `test/metamorph/` holds 109 of them, and the eight invariants hold at 48 runs × 48 calls with no revert. The Metamorph fork test passes against mainnet, a hundred-price duty conversion inside a mint included. MetamorphMD's runtime is 20,223 bytes of the 24,576 allowed.

**Deferred minors from the review:**
- No test pinned the 64/63 threshold of `whole` at its boundary. Settled by the final review below: `test_aMintPaddedByAMillionArmsTheBackOff` pins it.
- The 380k starved test's claim that its conversion fails with data rests on a trace, not an assertion. Settled by the final review below: its comment now says only what holds on this fixture, a starved conversion that reaches the catch with a wrapped error that carries data, seen in a trace and not asserted.
- The silent-poke test's poke emits no log, so its loop checks nothing when it passes; it still fails a `MetadataUpdate` emitted on every settlement.

**The final review (2026-10-14).** A final review of the revision, `d5f16f0..5c0c124`, found no critical item, two important ones and seven minor ones. Its findings were ruled on; the commit that adds this paragraph applies them in the tests, the comments and the docs only. MetamorphMD's bytecode is unchanged, byte for byte.
- Important 1: the padding the docs gave sat inside the back-off's margin. A failure arms the back-off only when more than `CONVERT_GAS` × 64/63 + 10,000 gas, about 924,300, is left at the call, while the duty gets its whole 900,000 from about 914,700. In between, measured at 914,654 to 924,285, a failing duty conversion had its whole allowance and did not back off, and a mint padded by exactly `CONVERT_GAS` over the lowest limit at which it succeeds landed there. The NatSpec of `CONVERT_BACKOFF`, `convertBackoffUntil` and `dutiesDue`, the comment in `_duties` and the spec's errata now state the threshold; the page and the keeper pad a due conversion by 1,000,000; and the note on `eth_estimateGas` no longer assumes one client's search. `test_aMintPaddedByAMillionArmsTheBackOff` (`MetamorphDuties.t.sol`) empties the IMD pool with the conversion due and finds E, the lowest limit at which the mint succeeds, by binary search: E mints and does not back off; E + 1,000,000 arms the back-off; E + 900,000 gives the duty exactly 900,000 (an `expectCall` with the gas) and does not back off. With the threshold at `CONVERT_GAS * 2`, without the margin, or at `CONVERT_GAS * 63 / 64 + 10_000`, the test fails, and no other test does.
- Important 2: the decay's cap before the shift saturates (`t > (cap >> shift)`) was unpinned; without it a fast mint and two intervals of silence would accept 18-bit proofs at the 20-bit floor. `test_silenceStopsAtTheCeilingBeforeTheShiftSaturates` (`MetamorphMint.t.sol`) brings a burst's target to the ceiling ÷256, then checks ×256 after four intervals and the ceiling exactly after five; `invariant_targetIsNeverAboveTheCeiling` now also bounds `effectiveTarget()` by the ceiling and by the stored target. With the cap removed, both fail.
- Minors, fixed: the ×16 wording of L-1, exact only from 360 to 719 s; the estimated mint, which runs the earlier due duties and starves only the last, the starved conversion burning about 20,000 gas, not a few thousand; `test_mintConvertsWhenThePotIsAHundredPricesDeep` now asserts that a successful duty conversion leaves the back-off alone, which a mutant that also arms on success fails; and this log's count of the whole-branch review's important items and its renamed interface test. Deferred to the test pass of the keeper and page plan: an in-mint conversion and a `poke` action in the campaign, an assertion of the sale in the fork test, and an `expectCall` in the back-off test.

**State after the final review.** `forge test` in default mode runs 357 tests: 346 pass, none fail, and the 11 fork tests skip without an RPC. `test/metamorph/` holds 111 of them, and the eight invariants hold at 48 runs × 48 calls with no revert. The fork test was not run again; its file did not change. MetamorphMD's runtime is still 20,223 bytes of the 24,576 allowed.

## Metamorph MD art (2026-10-15)

Reviewer: an agent that had not written the code, given the whole art branch, `01e64ad..3726247`: the three contracts (`src/metamorph/art/`), the JavaScript mirror and the parity check (`script/art/`), the two deploy scripts, the tests, the spec's errata and the runbook. It found no critical item, two important ones and a handful of minor ones, and said "with fixes". One fix wave took the important items and the cheap minors, in the commits titled `art: the runbook guards the deploy; the limits and the textPath note` and `art: the heaviest chrysalis pinned; comments and docstrings exact`: docs, scripts, tests and comments only. **No contract bytecode changed**: the sha256 of `forge inspect <Contract> deployedBytecode` is the same before and after for `MetamorphArt` (`3f5bae1a…7035`), `MetamorphChrysalis` (`eaea4571…386b`) and `MetamorphButterfly` (`0f696fc2…50d3`).

| # | Finding | Severity | Outcome |
|---|---|---|---|
| I1 | Rasterisers built on librsvg (sharp) draw no `<textPath>`, so the figure's digit contours and the halo rings vanish there, while browsers draw them. | Important | **Fixed**, in the spec and the runbook. Reproduced here: sharp 0.35.5 (librsvg 2.63.2) draws a chrysalis without its shell and a butterfly without its wings, and Edge draws both whole. The spec's Limits now record the limitation and the rule that the site draws a card only through `<img src="data:…">` in the browser, never rasterised on a server and never inlined (every card repeats its element ids). The runbook recommends a look at a testnet marketplace's item page and in a wallet before the mainnet broadcast, through a throwaway ERC-721 that forwards fixed views to the art; whether to spend a testnet deployment on it is the owner's call. |
| I2 | The deploy key is the running keeper's key, and nothing checked the router after the broadcast: a keeper transaction between the three deployments would leave a router that points at an address with no code, for good. | Important | **Fixed**, in the runbook and the scripts. The runbook stops the keeper loop for both deployments, and after the art's broadcast checks that `CHRYSALIS()` and `BUTTERFLY()` have 7,655 and 8,191 bytes of code and that `tokenURI` returns the dry run's 21,045 and 20,285 bytes for a chrysalis and a butterfly (the commands were run on anvil; on a router built on a missing butterfly the size is 0 and stage 1 reverts, while stage 0 still reads). `DeployMetamorphArt` logs both lengths. `DeployMetamorph` reads a card of each stage through `ART` in its simulation and refuses an answer under 100 bytes or with any prefix but `data:application/json;base64,`: six tests in `ArtDeployCheck.t.sol`, and each of four mutants of the check (a floor of 99 or 101, no prefix check, only the chrysalis read) fails one of them. |
| Minors | `parity.mjs` ignored SIGTERM and SIGHUP; the heaviest chrysalis was not pinned; the rounding comments missed one exception; no source-verification step in the runbook; the spec gave 20M gas and not EIP-7825's cap; two fuzz docstrings claimed every card for 256 runs; `thumbs.mjs` left its temporary profile and assumed the Windows Edge path; the element ids repeat on every card; the numeric attributes carry no `display_type`. | Minor | **Fixed**, all but the last. `parity.mjs` stops anvil and exits 143, 129 and 130 on SIGTERM, SIGHUP and SIGINT. (1095, 4, 1) gilt, the heaviest chrysalis, is a third view of `test_worstCaseStaysUnderTheLimits` (3,992,519 gas inside the call, an SVG of 12,622 bytes, a JSON of 17,624), its digests recomputed from the mirror. The rounding comments of `MetamorphChrysalis.sol` and `mirror.mjs` state the one exception: the inner shell's printed top is rounded, and its y values add one rounded product to it. The runbook verifies the three contracts (`--verify`, or `forge verify-contract` with the router's constructor arguments). The spec notes that EIP-7825 caps a transaction at 16,777,216 gas, 4.2 times the 4.0M worst case, and the gas test pins the cap. The fuzz tests are now `testFuzz_randomCardsDraw`, documented as samples. `thumbs.mjs` removes its profile and reads Edge's path from `EDGE_PATH`, the Windows default otherwise. The repeated ids are the rule in I1. The `display_type` is the owner's choice and is not changed. |

Left as it is: the whole-string tests do not reach three spots or every quadrant of the orbit dot; the parity sample does.

**State after the fix wave.** `forge test` in default mode runs 411 tests: 400 pass, none fail, and the 11 fork tests skip without an RPC; `test/metamorph/art/` holds 54 of them, six new. `node script/art/parity.mjs` reads 24 cards through the deployed router, each byte-identical to the mirror and well-formed XML. The worst cases, by `eth_estimateGas` on anvil: 3,999,602 gas for the heaviest chrysalis, (1095, 4, 1), and 3,991,502 for the heaviest butterfly, (8296, 2, 1); an SVG of at most 13,865 bytes and a JSON of at most 19,280. Against the limits that is 5 times under 20M gas and 4.2 times under EIP-7825's 16,777,216, 1.8 times under 24,576 bytes of SVG and 2.1 times under 40,960 bytes of JSON. The runtimes: `MetamorphArt` 18,766 bytes of the 24,576 allowed, `MetamorphButterfly` 8,191, `MetamorphChrysalis` 7,655.
