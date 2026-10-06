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
| 2 | Trades made by providing liquidity pay no tax. A seller who rests PUPATE as a narrow position just above the price is filled by buyers without paying the sell tax; a buyer who rests ETH just under the price at the open avoids the launch tax (one such trade received 101,045,666 PUPATE for 1 ETH against 994,240 by swapping). Each matched trade is taxed once, on the taker. | High | **Open, decision pending.** The fix is a `beforeAddLiquidity` gate that admits liquidity only in the block that opens the launch pool (hook flags become `0x18CC`). It is safe only if IMD's factory initialises the pool and seeds it in one transaction. Verified on launch 775: its deployment transaction `0x9eeabe67…11ad2` (from the launch wallet `0xcecc…a551` to the factory `0x12c63b58…a96f`) contains both `PoolManager.Initialize` and `PoolManager.ModifyLiquidity` for the same pool, with the factory as the liquidity sender. Recorded in the spec's known risks. |
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
