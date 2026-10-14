# Metamorph MD Revision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the five pre-deploy decisions the owner approved after the whole-branch review of `MetamorphMD`: difficulty that eases with silence, a conversion duty that pays for itself, a back-off after a failed duty conversion, no gas-starvation guard, and a permissionless `poke` with ERC-4906 events; plus the two parked minors.

**Architecture:** Four small, independent changes to `src/metamorph/MetamorphMD.sol` (each a constant or a view plus a few lines), each pinned by tests on the existing fixture (`test/metamorph/MetamorphFixture.sol`: real PoolManager, hook and vault; `minBits = 1`; duties off unless a test sets `vm.fee(1 gwei)`), then the spec errata and the review ledger. Execution note: Tasks 1–3 are one implementer dispatch and one review (they touch the same file and are small); Task 4 is the second dispatch.

**Tech Stack:** Solidity 0.8.26, Foundry (forge 1.7.1), v4-core vendored. Run commands from the worktree root. `forge test --match-contract <Name> -vv` for one suite; `forge test` for all (fork tests skip without `MAINNET_RPC_URL`; the main checkout's `.env` has it: `set -a; . "/c/dev/imd project/.env"; set +a; forge test --match-contract MetamorphForkTest -vvv` runs them; never print it).

**Spec:** `docs/superpowers/specs/2026-10-13-metamorph-md-design.md` (v2 + "Errata from the implementation (2026-10-14)"); the decisions come from `docs/REVIEW.md` sections "Metamorph MD (2026-10-14)" (L-1, L-2, L-3, I-1) and "The whole-branch review (2026-10-14)" (I5) and the owner's approval of the controller's recommendations on 2026-10-14.

## Global Constraints

- English only in code, names, comments, commit messages (chat with the owner is Indonesian).
- Never add a privileged key: no owner, setter, pause, upgrade, withdraw. `poke` is permissionless and credits only the staker.
- The launched contracts under `src/` outside `src/metamorph/` are frozen.
- Commit messages: one line, no `Co-Authored-By`, no body; never push.
- `forge test` green at every commit (333 passed, 11 fork skips at the start); the fork test green with the RPC after Task 2; the invariant campaign green (`forge test --match-contract MetamorphInvariantTest`, 48 × 48, `fail_on_revert`).
- `MetamorphMD` runtime under 24,576 bytes (19,582 at the start; `MetamorphSizeTest` pins it).
- Constants, verbatim: `DECAY_INTERVAL = 360` seconds (one ×4 easing per interval of silence); `CONVERT_PRICES = 100` (the duty converts when the pot holds 100 mint prices); `CONVERT_BACKOFF = 300` blocks; ERC-4906 interface id `0x49064906`; event `MetadataUpdate(uint256 _tokenId)`.
- The plan's code blocks start with a caption comment; never copy it as line 1 of a file (SPDX is line 1). Run `forge fmt` on touched files. No new solc warnings (the known 2018 one in `test/FloorFeed.t.sol` is fine).

## Review Focus

1. A burst of same-block mints (elapsed 0, ÷4 each) followed by silence: the effective target must climb ×4 per 360 s up to the epoch's ceiling with no mint in between, and a proof valid against the effective target must mint (Task 1, `test_silenceEasesTheTargetWithoutAMint`).
2. A proof found against the stored `target` stays valid after silence (the effective target is never below the stored one) (Task 1, `test_aProofAgainstTheStoredTargetStaysValid`).
3. A failed duty conversion must not be retried by the next cheap mint, but the public `convert()` must stay callable (Task 2, `test_aFailedDutyConversionBacksOff`).
4. A stranger calling `poke` must not take any IMD: the staker's pending grows, the caller's does not; and a card that emerged reaches weight 2 without its staker's touch (Task 3, `test_anyoneCanPokeAndOnlyTheStakerEarns`).
5. With the 100-price threshold the duty must still run when reached: a pot filled by mints at dear gas, then one cheap mint converts and pays the miner (Task 2, `test_mintConvertsWhenThePotIsAHundredPricesDeep`).

---

## File structure

| File | Change |
|---|---|
| `src/metamorph/MetamorphMD.sol` | `DECAY_INTERVAL`, `effectiveTarget()`, `bits()` and `mint` read it, `_retarget` starts from it; `CONVERT_PRICES`, `CONVERT_BACKOFF`, `convertBackoffUntil`, `dutiesDue` and `_duties` use them; `poke`, `MetadataUpdate`, `supportsInterface` adds `0x49064906`, `_settle` emits on a weight change |
| `test/metamorph/MetamorphFixture.sol` | `_proof` searches against `effectiveTarget()` |
| `test/metamorph/MetamorphMint.t.sol` | the retarget test adapted; the decay tests; the fuzz test's `vm.assume` |
| `test/metamorph/MetamorphDuties.t.sol` | the threshold tests at 100 prices; the back-off test |
| `test/metamorph/MetamorphStaking.t.sol` | the `poke` tests |
| `test/metamorph/MetamorphStages.t.sol` | ERC-4906 interface id |
| `test/metamorph/MetamorphSize.t.sol` | the function-count comment |
| `test/metamorph/MetamorphHandler.sol` | `effectiveTarget()` where it reads `target()` for proofs (if it does) |
| `test/fork/Metamorph.fork.t.sol` | the conversion step at the new threshold |
| `docs/superpowers/specs/2026-10-13-metamorph-md-design.md`, `docs/REVIEW.md` | errata and outcomes |

---

### Task 1: Difficulty eases with silence

**Files:**
- Modify: `src/metamorph/MetamorphMD.sol` (constants; `bits()`; the work chain reads; `mint`; `_retarget`)
- Modify: `test/metamorph/MetamorphFixture.sol` (`_proof`)
- Test: `test/metamorph/MetamorphMint.t.sol`

**Interfaces:**
- Produces: `DECAY_INTERVAL() = 360`, `effectiveTarget() returns (uint256)` (the target a proof is checked against right now: `min(ceiling(epoch()), target × 4^((block.timestamp − lastMintAt) / DECAY_INTERVAL))`), `bits()` now reports the effective target. `target` (storage) keeps its meaning: the base the last retarget set.

- [ ] **Step 1: Write the failing tests**

Add to `test/metamorph/MetamorphMint.t.sol` (inside the test contract):

```solidity
    /// A burst of same-block mints divides the target by four each; silence then multiplies it by four
    /// per DECAY_INTERVAL without a mint, up to the ceiling.
    function test_silenceEasesTheTargetWithoutAMint() public {
        uint256 cap = type(uint256).max >> 1; // minBits 1, epoch 1
        _mintAs(miner);
        uint256 t0 = md.target();
        // three more mints in the same block: elapsed 0, ÷4 each
        for (uint256 i; i < 3; i++) _mintAs(miner);
        uint256 t = md.target();
        assertEq(t, t0 / 4 / 4 / 4, "three same-block mints quarter the target three times");
        assertEq(md.effectiveTarget(), t, "no silence yet");
        vm.warp(block.timestamp + md.DECAY_INTERVAL() - 1);
        assertEq(md.effectiveTarget(), t, "one second short of an interval changes nothing");
        vm.warp(block.timestamp + 1);
        assertEq(md.effectiveTarget(), t * 4, "one interval of silence: x4");
        vm.warp(block.timestamp + md.DECAY_INTERVAL());
        assertEq(md.effectiveTarget(), t * 16, "two intervals: x16");
        vm.warp(block.timestamp + 365 days);
        assertEq(md.effectiveTarget(), cap, "a year of silence: the ceiling, never above it");
        assertEq(md.bits(), 1, "bits() reports the effective target");
    }

    /// A proof found against the stored target stays valid after silence: the effective target is never
    /// below the stored one.
    function test_aProofAgainstTheStoredTargetStaysValid() public {
        _mintAs(miner);
        for (uint256 i; i < 3; i++) _mintAs(miner);
        uint256 anchor = _anchor();
        uint256 nonce = _proofBelow(miner, anchor, md.target());
        vm.warp(block.timestamp + 2 * md.DECAY_INTERVAL());
        vm.roll(block.number + 1); // the anchor stays inside the window
        vm.prank(miner);
        uint256 id = md.mint(anchor, nonce);
        assertEq(md.ownerOf(id), miner, "the old proof mints against the eased target");
    }

    /// A proof that only passes the eased target is a solution too, and the retarget after it starts
    /// from the effective target: with elapsed >= 4 x TARGET_INTERVAL the next target is x4 of it, capped.
    function test_aProofAgainstTheEasedTargetMintsAndRetargetsFromIt() public {
        uint256 cap = type(uint256).max >> 1;
        _mintAs(miner);
        for (uint256 i; i < 10; i++) _mintAs(miner); // ÷4 ten times
        uint256 stored = md.target();
        vm.warp(block.timestamp + 3 * md.DECAY_INTERVAL());
        uint256 eased = md.effectiveTarget();
        assertEq(eased, stored * 64, "three intervals: x64");
        uint256 anchor = _anchor();
        // a nonce whose work lies between the stored and the eased target
        uint256 nonce = _proofBetween(miner, anchor, stored, eased);
        vm.roll(block.number + 1);
        vm.prank(miner);
        md.mint(anchor, nonce);
        uint256 expected = eased > cap / 4 ? cap : eased * 4;
        assertEq(md.target(), expected, "the retarget starts from the eased target");
    }
```

Add these helpers to the test contract (or the fixture, beside `_proof`):

```solidity
    function _proofBelow(address who, uint256 anchor, uint256 limit) internal view returns (uint256 nonce) {
        bytes32 h = blockhash(anchor);
        while (uint256(md.workHash(h, who, nonce)) >= limit) nonce++;
    }

    function _proofBetween(address who, uint256 anchor, uint256 low, uint256 high)
        internal
        view
        returns (uint256 nonce)
    {
        bytes32 h = blockhash(anchor);
        while (true) {
            uint256 w = uint256(md.workHash(h, who, nonce));
            if (w >= low && w < high) return nonce;
            nonce++;
        }
    }
```

Note on `workHash`: its first argument is the anchor hash as `mint` computes it; check `MetamorphFixture._proof` for the exact call it uses and copy that form.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `forge test --match-contract MetamorphMintTest -vv`
Expected: compilation error, `effectiveTarget` / `DECAY_INTERVAL` not found.

- [ ] **Step 3: Add the decay to the contract**

In the constants section, after `TARGET_INTERVAL`:

```solidity
    /// @notice Seconds of silence that ease the target by four, without a mint. A burst of fast mints
    /// quarters the target each time; without this, only the next mint could bring it back.
    uint256 public constant DECAY_INTERVAL = 360;
```

In "the work chain, read", after `bits()` (and change `bits()` to read the effective target):

```solidity
    /// @notice The target a proof is checked against right now: the stored target eased by four for every
    /// `DECAY_INTERVAL` of silence since the last mint, never above the epoch's ceiling.
    function effectiveTarget() public view returns (uint256 t) {
        t = target;
        uint256 cap = _ceiling(epoch());
        if (t >= cap) return cap;
        uint256 shift = 2 * ((block.timestamp - lastMintAt) / DECAY_INTERVAL);
        if (shift >= 256 || t > (cap >> shift)) return cap;
        return t << shift;
    }

    function bits() public view returns (uint8 n) {
        uint256 t = effectiveTarget();
        while (n < 255 && (t >> (255 - n)) == 0) n++;
    }
```

In `mint`, replace `uint256 t = target;` with `uint256 t = effectiveTarget();` (the proof check and the gilt line keep using `t`).

In `_retarget`, start from the effective target: replace the three reads of `target` in the `next` computation with a local `uint256 base = effectiveTarget();` taken first (so `base > type(uint256).max / 4 ? ... : base * 4`, `base / 4`, and the `mulDiv(base, elapsed, TARGET_INTERVAL)` branch with its saturation check on `base`). `_retarget` runs before `lastMintAt` is updated, so `effectiveTarget()` still sees the previous mint's time. Update the NatSpec: "Every mint moves the target, starting from the effective (eased) target, toward one mint per `TARGET_INTERVAL` ...".

In `test/metamorph/MetamorphFixture.sol`, make `_proof` search against `md.effectiveTarget()` instead of `md.target()` (at `minBits = 1` both are near the maximum, so existing tests keep passing).

- [ ] **Step 4: Adapt the existing retarget test and run the suite**

`test_retargetFollowsThePaceWithinTheClampAndTheCeiling` warps between mints; where it warps by `DECAY_INTERVAL` or more, the base of that retarget is now the eased target. Recompute its expected values with the rule `expected = clamp(base × elapsed / 90, base/4 .. base×4)` capped at the ceiling, where `base = min(cap, stored × 4^(elapsed/360))`. Keep every case; add a comment above each changed expectation saying which interval of silence applied.

Run: `forge test --match-contract MetamorphMintTest -vv`
Expected: all pass (the three new tests and the adapted one).

Then: `forge test --match-path "test/metamorph/*"` and `forge test --match-contract MetamorphInvariantTest` (the handler warps up to 30 days in `pass`; proofs found against `effectiveTarget()` stay valid; all invariants hold).

- [ ] **Step 5: Commit**

```bash
git add src/metamorph/MetamorphMD.sol test/metamorph/MetamorphFixture.sol test/metamorph/MetamorphMint.t.sol
git commit -m "metamorph: silence eases the target by four per six minutes; a proof is checked against the eased target"
```

---

### Task 2: The conversion duty pays for itself and backs off

**Files:**
- Modify: `src/metamorph/MetamorphMD.sol` (constants; storage; `dutiesDue`; `_duties`)
- Test: `test/metamorph/MetamorphDuties.t.sol`, `test/fork/Metamorph.fork.t.sol`

**Interfaces:**
- Produces: `CONVERT_PRICES() = 100`, `CONVERT_BACKOFF() = 300`, `convertBackoffUntil() returns (uint256)` (the block from which a duty conversion may be tried again after a failure; `0` when none failed). `dutiesDue().convertDue` is true only when `pot >= CONVERT_PRICES × mintPrice()` or `ethPot != 0`, the spacing has passed, and `block.number >= convertBackoffUntil`. The public `convert()` ignores the back-off.

- [ ] **Step 1: Write the failing tests**

In `test/metamorph/MetamorphDuties.t.sol`: rename `test_mintConvertsWhenThePotIsTwoPricesDeep` to `test_mintConvertsWhenThePotIsAHundredPricesDeep` and fill the pot with mints at dear gas until `md.pot() >= md.CONVERT_PRICES() * md.mintPrice()` (143 mints at 50,000 × 70% = 35,000 each; use the suite's `_mintMany` or a loop with `_mintAs(miner)`; fund the miner with `deal` if its 100M PUPATE runs short), then one cheap mint converts: keep the test's existing assertions (the duty ran, `DutyRun(2, …)`, the miner's IMD reward). Update `test_convertIsNotDueUntilTheSpacingHasPassed`'s `assertGe(md.pot(), 2 * md.mintPrice())` to `md.CONVERT_PRICES() * md.mintPrice()`. Add:

```solidity
    /// 99 prices in the pot is not due; the hundredth makes it due.
    function test_theConversionDutyWaitsForAHundredPrices() public {
        vm.fee(3 gwei); // duties off while filling
        uint256 need = md.CONVERT_PRICES() * md.mintPrice();
        while (md.pot() + md.mintPrice() * md.STAKER_BPS() / 10_000 < need) _mintAs(miner);
        (,, bool c) = md.dutiesDue();
        assertFalse(c, "one mint short");
        _mintAs(miner);
        (,, c) = md.dutiesDue();
        assertTrue(c, "the hundredth price makes the conversion due");
    }

    /// A duty conversion that fails is not retried by the next cheap mints: it backs off CONVERT_BACKOFF
    /// blocks. The public convert() is not held back.
    function test_aFailedDutyConversionBacksOff() public {
        // fill the pot past the threshold at dear gas, then remove the IMD liquidity so a conversion
        // finds nothing to buy (as test_failingDutyNeverRevertsTheMint does)
        vm.fee(3 gwei);
        uint256 need = md.CONVERT_PRICES() * md.mintPrice();
        while (md.pot() < need) _mintAs(miner);
        _removeImdLiquidity(); // the helper the failing-duty test uses; reuse its exact code
        vm.fee(1 gwei);
        vm.roll(block.number + md.CONVERT_SPACING());
        (,, bool c) = md.dutiesDue();
        assertTrue(c, "due before the attempt");
        uint256 id = _mintAs(miner); // the duty tries, fails, the mint succeeds
        assertEq(md.ownerOf(id), miner);
        assertEq(md.convertBackoffUntil(), block.number + md.CONVERT_BACKOFF(), "backed off");
        (,, c) = md.dutiesDue();
        assertFalse(c, "not due inside the back-off");
        vm.roll(block.number + md.CONVERT_BACKOFF() - 1);
        (,, c) = md.dutiesDue();
        assertFalse(c, "one block short");
        vm.roll(block.number + 1);
        (,, c) = md.dutiesDue();
        assertTrue(c, "due again after the back-off");
        // the public entry is not held back: it reverts for its own reason, not TooSoon
        vm.roll(block.number - md.CONVERT_BACKOFF() + 2);
        vm.expectRevert(MetamorphMD.NothingBought.selector);
        md.convert();
    }
```

If the suite has no `_removeImdLiquidity` helper, extract the liquidity-removal lines of `test_failingDutyNeverRevertsTheMint` into one and use it in both. Check `vm.roll` backwards is allowed in this forge (it is: `vm.roll` sets the number); otherwise restructure so the public `convert()` call happens inside the back-off window before rolling forward.

In `test/fork/Metamorph.fork.t.sol`: the step that expected mint 3's duty to convert the pot no longer holds at 100 prices. Change it so the test asserts the duty did NOT convert (`convertDue` false, `lastConvertBlock` unchanged) and then converts through the public `convert()` (roll past the spacing; the caller's IMD reward delta is the assertion), keeping the rest of the flow. Run it with the RPC.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `forge test --match-contract MetamorphDutiesTest -vv`
Expected: compilation error (`CONVERT_PRICES`, `CONVERT_BACKOFF`, `convertBackoffUntil` not found).

- [ ] **Step 3: Add the threshold and the back-off**

Constants (beside `CONVERT_SPACING`):

```solidity
    /// @notice The pot converts inside a mint once it holds this many mint prices: at two prices the
    /// miner's 0.5% reward was about a fiftieth of the duty's gas; at a hundred it covers it.
    uint256 public constant CONVERT_PRICES = 100;
    /// @notice Blocks a mint leaves the conversion alone after a duty conversion failed, so a stuck pool
    /// does not tax every cheap mint with a failing retry. The public `convert()` ignores it.
    uint256 public constant CONVERT_BACKOFF = 300;
```

Storage (beside `lastConvertBlock`):

```solidity
    /// @notice The block from which a duty conversion may be tried again after one failed; 0 when none.
    uint256 public convertBackoffUntil;
```

`dutiesDue`:

```solidity
        convertDue = (pot >= CONVERT_PRICES * mintPrice() || ethPot != 0)
            && block.number >= lastConvertBlock + CONVERT_SPACING && block.number >= convertBackoffUntil;
```

`_duties`, the conversion branch:

```solidity
        if (convertDue) {
            try this.convertDuty{gas: CONVERT_GAS}(miner_) returns (uint256 bought) {
                emit DutyRun(2, bought * CALLER_REWARD_BPS / BPS);
            } catch {
                convertBackoffUntil = block.number + CONVERT_BACKOFF;
            }
        }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `forge test --match-contract MetamorphDutiesTest -vv`, then `forge test` (whole suite), then the fork test with the RPC loaded from the main checkout's `.env` (never print it): `set -a; . "/c/dev/imd project/.env"; set +a; forge test --match-contract MetamorphForkTest -vvv`.
Expected: all pass; the fork test passes against mainnet.

- [ ] **Step 5: Commit**

```bash
git add src/metamorph/MetamorphMD.sol test/metamorph/MetamorphDuties.t.sol test/fork/Metamorph.fork.t.sol
git commit -m "metamorph: the conversion duty waits for a hundred prices and backs off three hundred blocks after a failure"
```

---

### Task 3: Anyone may poke a staked card; ERC-4906

**Files:**
- Modify: `src/metamorph/MetamorphMD.sol` (events; staking section; `supportsInterface`; `_settle`)
- Test: `test/metamorph/MetamorphStaking.t.sol`, `test/metamorph/MetamorphStages.t.sol`, `test/metamorph/MetamorphSize.t.sol`

**Interfaces:**
- Produces: `poke(uint256[] ids)` (settles each staked card: credits what it earned to its staker, re-reads its stage, updates its weight; reverts `NotStaked` for an unstaked id); event `MetadataUpdate(uint256 _tokenId)` (ERC-4906) emitted whenever a settlement changes a card's weight (its stage changed); `supportsInterface(0x49064906)` is true.

- [ ] **Step 1: Write the failing tests**

In `test/metamorph/MetamorphStaking.t.sol` (use the suite's existing way to make a card emerge, e.g. the fixture's `_sell(seat)` after a mint, and its harness `creditForTests` or a real conversion to credit IMD):

```solidity
    /// A stranger pokes a staked card: its staker's pending grows, the stranger's does not, and an emerged
    /// card reaches weight 2 without its staker's touch.
    function test_anyoneCanPokeAndOnlyTheStakerEarns() public {
        uint256 id = _mintAs(miner);
        uint256[] memory ids = new uint256[](1);
        ids[0] = id;
        vm.prank(miner);
        md.stake(ids);
        _creditIMD(30 ether); // whatever the suite uses to credit stakers (harness creditForTests or a conversion)
        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        md.poke(ids);
        assertEq(md.pendingIMD(miner), 30 ether, "the staker was credited");
        assertEq(md.pendingIMD(stranger), 0, "the stranger was not");
        (, uint8 w,) = md.stakeOf(id);
        assertEq(w, 1, "still a chrysalis");
        _sell(uint256(_seatOf(id))); // the seat leaves the vault: the card emerges
        vm.expectEmit(true, false, false, true, address(md));
        emit MetamorphMD.MetadataUpdate(id);
        vm.prank(stranger);
        md.poke(ids);
        (, w,) = md.stakeOf(id);
        assertEq(w, 2, "reweighed to butterfly by a stranger's poke");
        assertEq(md.totalWeight(), 2);
    }

    function test_pokeRefusesAnUnstakedCardAndIgnoresAnEmptyList() public {
        uint256 id = _mintAs(miner);
        uint256[] memory ids = new uint256[](1);
        ids[0] = id;
        vm.expectRevert(MetamorphMD.NotStaked.selector);
        md.poke(ids);
        md.poke(new uint256[](0)); // no-op
    }

    /// A poke that does not change the weight emits no MetadataUpdate.
    function test_pokeWithoutAStageChangeIsSilent() public {
        uint256 id = _mintAs(miner);
        uint256[] memory ids = new uint256[](1);
        ids[0] = id;
        vm.prank(miner);
        md.stake(ids);
        vm.recordLogs();
        md.poke(ids);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; i++) {
            assertTrue(logs[i].topics[0] != MetamorphMD.MetadataUpdate.selector, "no MetadataUpdate");
        }
    }
```

`_seatOf(id)` reads `cards(id)`'s first field: `(uint32 seat,,,,,,,) = md.cards(id);`. Replace `_creditIMD` with the suite's actual mechanism (read `MetamorphStaking.t.sol` first and follow it).

In `test/metamorph/MetamorphStages.t.sol`, in the interface test, add `assertTrue(md.supportsInterface(0x49064906), "ERC-4906")`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `forge test --match-contract MetamorphStakingTest -vv`
Expected: compilation error, `poke` / `MetadataUpdate` not found.

- [ ] **Step 3: Add poke and the event**

Events (beside `Reweighed`):

```solidity
    /// @notice ERC-4906: a card's metadata changed (its stage flipped), so marketplaces refresh it.
    event MetadataUpdate(uint256 _tokenId);
```

Staking section, after `claim`:

```solidity
    /// @notice Settle any staked cards: anyone may call it. What each card earned goes to its staker, never
    /// to the caller; the card's stage is re-read, so an emerged card weighs 2 from here on, and one whose
    /// stage fell back weighs 1 again. A changed stage emits `MetadataUpdate`.
    function poke(uint256[] calldata ids) external nonReentrant {
        for (uint256 i; i < ids.length; i++) {
            Stake storage s = stakeOf[ids[i]];
            if (s.staker == address(0)) revert NotStaked();
            _settle(ids[i], s);
        }
    }
```

In `_settle`, inside `if (w != s.weight) { ... }` after `emit Reweighed(id, w);` add `emit MetadataUpdate(id);`.

`supportsInterface`: `return interfaceId == 0x2a55205a || interfaceId == 0x49064906 || super.supportsInterface(interfaceId);`

- [ ] **Step 4: Run the tests to verify they pass**

Run: `forge test --match-contract MetamorphStakingTest -vv && forge test --match-contract MetamorphStagesTest -vv && forge test --match-contract MetamorphSizeTest -vv`
Expected: pass. Update the function-count comment in `MetamorphSize.t.sol` (run `forge inspect MetamorphMD methodIdentifiers | wc -l` and count the state-changing ones: `poke` adds one). Record the runtime size.

- [ ] **Step 5: Commit**

```bash
git add src/metamorph/MetamorphMD.sol test/metamorph/MetamorphStaking.t.sol test/metamorph/MetamorphStages.t.sol test/metamorph/MetamorphSize.t.sol
git commit -m "metamorph: anyone may poke a staked card; a stage change emits MetadataUpdate (ERC-4906)"
```

---

### Task 4: Errata, the review ledger, and the two parked minors

**Files:**
- Modify: `docs/superpowers/specs/2026-10-13-metamorph-md-design.md` (constants table; Interfaces; the errata list)
- Modify: `docs/REVIEW.md` (outcomes for L-1, L-2, I5, I-1, I-3; a new "Revision (2026-10-14)" section)
- Modify: `test/metamorph/MetamorphMint.t.sol` (the fuzz test's `vm.assume`)

- [ ] **Step 1: The fuzz test**

In `testFuzz_aRandomNonceIsRefusedAtTwentyBits`, before the prank, add `vm.assume(uint256(strict.workHash(<the anchor hash the test uses>, who, nonce)) >= type(uint256).max >> 20);` (the 20-bit deployment's variable is `strict` or whatever the test names it; read it). This removes the ~1-in-4,096 false failure that forge's `cache/fuzz` would replay forever. Run: `forge test --match-test testFuzz_aRandomNonceIsRefusedAtTwentyBits -vv`. Expected: pass.

- [ ] **Step 2: Spec errata**

Under "Errata from the implementation (2026-10-14)" add, each one short:
- Difficulty eases with silence: `effectiveTarget() = min(ceiling, target × 4^((now − lastMintAt) / DECAY_INTERVAL))`, `DECAY_INTERVAL = 360` s; proofs are checked against it, `bits()` reports it, the retarget after a mint starts from it (audit L-1, adopted by the owner).
- The conversion duty runs when the pot holds `CONVERT_PRICES = 100` mint prices (was 2): at two prices the miner's reward was about a fiftieth of the duty's gas (whole-branch review I5). The keeper and `convert()` may convert earlier.
- After a failed duty conversion, mints leave the conversion alone for `CONVERT_BACKOFF = 300` blocks (`convertBackoffUntil`); `convert()` is not held back (audit L-2, partial: the dead-pool lock stays accepted).
- No gas-starvation guard: the page and the keeper pad the gas limit (audit I-1, declined).
- `poke(ids)`: anyone may settle staked cards; earnings go to the staker; ERC-4906 `MetadataUpdate(id)` on a stage change; `supportsInterface(0x49064906)`.
- Update the constants table rows: retarget clamp (add the decay), the conversion threshold (100 × price), `CONVERT_BACKOFF`, `DECAY_INTERVAL`; the Interfaces list: `effectiveTarget`, `poke`, `convertBackoffUntil`, `MetadataUpdate`, `CONVERT_PRICES`, `CONVERT_BACKOFF`, `DECAY_INTERVAL`.
- Fix the stale L-1 trade-off line (it is no longer "kept": it is fixed) and the L-2 line (a back-off exists now).

- [ ] **Step 3: REVIEW.md**

In the audit section's table and resolutions: L-1 → `Fixed in <Task 1 commit>` (test names); L-2 → `Partly fixed in <Task 2 commit>: back-off; the dead-pool lock stays accepted`; I-1 → `Declined: the page pads gas`; I-3 → add `forgetSeat` to the list of ways the open seat list can be reordered. In "The whole-branch review (2026-10-14)" section: I5 → `Fixed in <Task 2 commit>` with the numbers (100 prices; reward ≈ gas at 1 gwei). Add a short `### Revision (2026-10-14)` paragraph: the five decisions, the commits, the suite result, the runtime size.

- [ ] **Step 4: Run everything and commit**

Run: `forge test` (whole suite, RPC-less), `forge test --match-contract MetamorphInvariantTest`, `forge test --match-contract MetamorphSizeTest -vv`.
Expected: green; record the counts and the size in the REVIEW.md paragraph.

```bash
git add docs/superpowers/specs/2026-10-13-metamorph-md-design.md docs/REVIEW.md test/metamorph/MetamorphMint.t.sol
git commit -m "metamorph: errata and the review ledger for the revision; the fuzz test assumes a non-solution"
```

---

## Self-review (done while writing)

- Decisions coverage: decay ✓ (T1), 100 prices ✓ (T2), back-off ✓ (T2), no gas guard ✓ (T4 errata only), poke + 4906 ✓ (T3), fuzz vm.assume ✓ (T4), I-3 note ✓ (T4).
- Type consistency: `effectiveTarget() returns (uint256)` read by `mint`, `bits()`, `_retarget`, the fixture's `_proof` and the tests; `convertBackoffUntil` is `uint256`; `CONVERT_PRICES`, `CONVERT_BACKOFF`, `DECAY_INTERVAL` are `uint256` constants; `poke(uint256[] calldata)`; `MetadataUpdate(uint256)`.
- Review Focus 1–5 pinned: T1 `test_silenceEasesTheTargetWithoutAMint`, T1 `test_aProofAgainstTheStoredTargetStaysValid`, T2 `test_aFailedDutyConversionBacksOff`, T3 `test_anyoneCanPokeAndOnlyTheStakerEarns`, T2 `test_mintConvertsWhenThePotIsAHundredPricesDeep`.
- Known interplay: with the decay, `_retarget` eases twice after long silence (the eased base, then ×4 for elapsed ≥ 360 s); the ceiling caps it and fast mints quarter it back; the invariant `targetIsNeverAboveTheCeiling` still reads the stored target, which `_retarget` caps.
