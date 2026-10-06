# Pupate Plan 2: Token and Tax Hook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build PupateToken and PupateHook, tested against a real Uniswap v4 PoolManager, and let FloorFeed's question be set after deployment.

**Architecture:** PupateToken is a plain ERC-20, as IMD requires. PupateHook taxes the ETH side of every trade in the launch pool, collects the tax as PoolManager claims inside the swap, and hands it to a sink (Cocoon, Plan 3) through a permissionless `flush`. The hook knows nothing about how the tax is split; that belongs to the sink.

**Tech Stack:** Solidity 0.8.26, Foundry, EVM `cancun`, Uniswap v4-core 1.0.2 (vendored), forge-std.

**Spec:** `docs/superpowers/specs/2026-10-06-pupate-design.md` (revision 2), sections PupateToken, PupateHook, FloorFeed.

## Global Constraints

- Everything in the repository is English: code, identifiers, comments, docs, commit messages.
- Solidity `0.8.26` exactly; `evm_version = "cancun"`; optimizer on, 200 runs; `via_ir = false`; `bytecode_hash = "none"`; `cbor_metadata = false`.
- No proxies, no `delegatecall`, no `selfdestruct`.
- No push to any remote. Local commits only.
- The `identity-md-launches` reference repositories carry no licence. Do not copy code from them.
- Token: 18 decimals, supply 1,000,000,000, minted once to the deployer, no fee, limit, pause or mint.
- Standing tax: 6% of the ETH side of every buy and every sell, rounded down. It can only be lowered.
- Launch schedule: the buy tax starts at 99% when the launch pool opens and falls one percentage point a minute until it meets the standing tax. Sells are always at the standing tax.
- Hook address flags: `0x18CC` (afterInitialize, beforeAddLiquidity, beforeSwap, afterSwap, beforeSwapReturnDelta, afterSwapReturnDelta). The beforeAddLiquidity gate was added in Task 8.
- During a swap no ETH moves and no contract other than the PoolManager is called.

## Review Focus

1. A swap that names an exact ETH amount but cannot be filled in full (price limit, thin liquidity): it must revert, not be taxed on ETH that never moved. Test: `test_exactEthSwapThatCannotFillReverts`.
2. The first buy into a pool that holds no ETH yet: it must go through. Test: `test_firstBuyWorksWhileThePoolHoldsNoEth`.
3. A stranger opens a second native-ETH pool on the hook: it must not replace the launch pool and must not be taxed. Test: `test_aSecondNativePoolIsNotTheLaunchPoolAndTakesNoLiquidity`.
4. The sink refuses a deposit: `flush` reverts and the collected tax is still there. Test: `test_flushLeavesTheTaxInPlaceWhenTheSinkRejects`.
5. A trade so small its tax rounds to zero, and a standing tax lowered to zero: swaps still go through. Tests: `test_dustSwapWhoseTaxRoundsToZeroStillGoesThrough`, `test_taxCanBeLoweredToZero`.

---

### Task 1: Dependencies and housekeeping

**Files:**
- Create: `lib/v4-core/`, `lib/solmate/`, `.gitattributes`, `docs/dependencies.md`
- Modify: `foundry.toml` (remappings), `README.md`

**Interfaces:**
- Produces: imports under `v4-core/src/...` resolve; `new PoolManager(address)` deploys in tests.

- [ ] **Step 1: Vendor v4-core 1.0.2 and the one solmate file it needs**

```bash
mkdir -p /tmp/v4 && cd /tmp/v4 && npm pack @uniswap/v4-core@1.0.2 && tar -xzf uniswap-v4-core-1.0.2.tgz
cd "/c/dev/imd project"
mkdir -p lib/v4-core lib/solmate/src/auth
cp -r /tmp/v4/package/src lib/v4-core/src && rm -rf lib/v4-core/src/test
cp -r /tmp/v4/package/licenses lib/v4-core/licenses
cp /tmp/v4/package/lib/solmate/src/auth/Owned.sol lib/solmate/src/auth/Owned.sol
cp /tmp/v4/package/lib/solmate/LICENSE lib/solmate/LICENSE
```

- [ ] **Step 2: Add the remappings**

In `foundry.toml`, set:

```toml
remappings = ["forge-std/=lib/forge-std/src/", "v4-core/=lib/v4-core/", "solmate/=lib/solmate/"]
```

- [ ] **Step 3: Keep line endings stable**

File: `.gitattributes`

```
* text=auto eol=lf
```

- [ ] **Step 4: Record the dependencies**

File: `docs/dependencies.md`

```markdown
# Vendored dependencies

Everything the build needs is committed as ordinary files under `lib/`. There are no git submodules and
no package manager step, and `forge build` and `forge test` need no network.

| Package | Version | Vendored | Remapping | Licence |
|---|---|---|---|---|
| [Uniswap v4-core](https://github.com/Uniswap/v4-core) | 1.0.2 (npm `@uniswap/v4-core@1.0.2`) | `src/` without `src/test/`, `licenses/` | `v4-core/=lib/v4-core/` | BUSL-1.1 for `PoolManager.sol` and six libraries (`Pool`, `Position`, `Lock`, `CurrencyDelta`, `CurrencyReserves`, `NonzeroDeltaCount`); MIT for everything else |
| [forge-std](https://github.com/foundry-rs/forge-std) | v1.9.7 | whole repository | `forge-std/=lib/forge-std/src/` | MIT OR Apache-2.0 |
| [solmate](https://github.com/transmissions11/solmate) | the copy pinned inside v4-core 1.0.2 | `src/auth/Owned.sol`, `LICENSE` | `solmate/=lib/solmate/` | AGPL-3.0-only |

The contracts in `src/` import only MIT-licensed parts of v4-core: interfaces, types, and the `Hooks` and
`SafeCast` libraries. The BUSL-1.1 files and solmate's `Owned.sol` are used only by the PoolManager that
the tests deploy locally.

`forge fmt` ignores `lib/**`, so the upstream files stay byte for byte as delivered.
```

- [ ] **Step 5: Describe the contracts in the README**

File: `README.md`

```markdown
# Pupate

Pupate is a strategy token on Ethereum. A tax on every trade funds a vault that buys Identity MD
seats, puts them to work in the IMD swarm, and lists them for resale. An IMD oracle report of the
collection's reference price decides how much of the tax buys seats and how much buys back and burns
the token.

- Design: `docs/superpowers/specs/2026-10-06-pupate-design.md`
- What was checked before building: `docs/phase0-findings.md`
- Dependencies: `docs/dependencies.md`

## Contracts

| Contract | What it does |
|---|---|
| `PupateToken` | PUPATE: a plain ERC-20 with a fixed supply, burnable by its holders. |
| `PupateHook` | Uniswap v4 hook. Takes the tax on the ETH side of every trade in the launch pool and flushes it to the vault. |
| `FloorFeed` | Stores the collection's reference price from IMD oracle attestations. |

## Build

    forge build
    forge test

Toolchain is pinned in `foundry.toml`. Dependencies are vendored under `lib/`; the build needs no network.
```

- [ ] **Step 6: Build and commit**

Run: `forge build && forge test`
Expected: compiles; the 27 tests from Plan 1 pass.

```bash
git add -A
git commit -m "chore: vendor Uniswap v4-core 1.0.2"
```

---

### Task 2: FloorFeed question set by the owner

The oracle's `questionHash` is only known after the first request has been made, and that request has to name FloorFeed as its consumer. So the hash cannot be a constructor argument.

**Files:**
- Modify: `src/FloorFeed.sol`, `test/FloorFeed.t.sol`

**Interfaces:**
- Produces: `constructor(address owner_, address attester_)`, `function setQuestion(bytes32 questionHash_) external` (owner only), `bytes32 public questionHash`, `event QuestionSet(bytes32 questionHash)`. `QUESTION_HASH` no longer exists.

- [ ] **Step 1: Change the tests first**

In `test/FloorFeed.t.sol`, replace the construction in `setUp`:

```solidity
        feed = new FloorFeed(owner, attester);
        vm.prank(owner);
        feed.setQuestion(QUESTION);
```

Add to `test_onlyOwnerCanAdminister`:

```solidity
        vm.expectRevert(FloorFeed.NotOwner.selector);
        feed.setQuestion(keccak256("mine"));
```

Append these tests:

```solidity
    function test_rejectsEveryReportBeforeAQuestionIsSet() public {
        FloorFeed fresh = new FloorFeed(owner, attester);
        OracleAttestation.Attestation memory a = _att(2 ether, T0);
        a.questionHash = bytes32(0);
        bytes memory sig = _sign(a, ATTESTER_KEY, address(fresh));
        vm.expectRevert(FloorFeed.WrongQuestion.selector);
        fresh.report(a, sig);
    }

    function test_questionCannotBeSetToZero() public {
        vm.prank(owner);
        vm.expectRevert(FloorFeed.WrongQuestion.selector);
        feed.setQuestion(bytes32(0));
    }

    function test_changingTheQuestionRejectsReportsForTheOldOne() public {
        bytes32 next = keccak256("a better floor question");
        vm.prank(owner);
        feed.setQuestion(next);

        OracleAttestation.Attestation memory old = _att(2 ether, T0);
        bytes memory oldSig = _sign(old, ATTESTER_KEY, address(feed));
        vm.expectRevert(FloorFeed.WrongQuestion.selector);
        feed.report(old, oldSig);

        OracleAttestation.Attestation memory fresh = _att(2 ether, T0);
        fresh.questionHash = next;
        feed.report(fresh, _sign(fresh, ATTESTER_KEY, address(feed)));
        (uint256 floorWei,) = feed.latest();
        assertEq(floorWei, 2 ether);
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `forge test --match-contract FloorFeedTest`
Expected: compilation fails, `setQuestion` is not a member of FloorFeed.

- [ ] **Step 3: Change `src/FloorFeed.sol`**

Remove `bytes32 public immutable QUESTION_HASH;`. Add the event and the storage variable:

```solidity
    event QuestionSet(bytes32 questionHash);
```

```solidity
    /// @notice Hash of the only oracle question whose attestations are accepted. Zero until set.
    bytes32 public questionHash;
```

Constructor:

```solidity
    constructor(address owner_, address attester_) {
        if (owner_ == address(0) || attester_ == address(0)) revert ZeroAddress();
        owner = owner_;
        attester = attester_;
    }
```

In `report`, replace the question check:

```solidity
        bytes32 pinned = questionHash;
        if (pinned == bytes32(0) || a.questionHash != pinned) revert WrongQuestion();
```

Add the setter:

```solidity
    /// @notice Pin the oracle question. Its hash is only known once the first request has been made.
    function setQuestion(bytes32 questionHash_) external onlyOwner {
        if (questionHash_ == bytes32(0)) revert WrongQuestion();
        questionHash = questionHash_;
        emit QuestionSet(questionHash_);
    }
```

- [ ] **Step 4: Run the tests**

Run: `forge test --match-contract FloorFeedTest`
Expected: 26 passed.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: let the owner pin FloorFeed's oracle question"
```

---

### Task 3: PupateToken

**Files:**
- Create: `src/PupateToken.sol`
- Test: `test/PupateToken.t.sol`

**Interfaces:**
- Produces: `contract PupateToken` with a zero-argument constructor that mints `1_000_000_000 ether` to `msg.sender`; the ERC-20 functions; `burn(uint256)`; `burnFrom(address,uint256)`; errors `ZeroAddress`, `InsufficientBalance`, `InsufficientAllowance`.

- [ ] **Step 1: Write the failing tests**

File: `test/PupateToken.t.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {PupateToken} from "../src/PupateToken.sol";

contract PupateTokenTest is Test {
    uint256 constant SUPPLY = 1_000_000_000 ether;

    PupateToken token;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        token = new PupateToken();
    }

    function test_metadata() public view {
        assertEq(token.name(), "Pupate");
        assertEq(token.symbol(), "PUPATE");
        assertEq(token.decimals(), 18);
    }

    function test_wholeSupplyIsMintedToTheDeployer() public view {
        assertEq(token.totalSupply(), SUPPLY);
        assertEq(token.balanceOf(address(this)), SUPPLY);
    }

    function test_transferMovesBalance() public {
        assertTrue(token.transfer(alice, 5 ether));
        assertEq(token.balanceOf(alice), 5 ether);
        assertEq(token.balanceOf(address(this)), SUPPLY - 5 ether);
        assertEq(token.totalSupply(), SUPPLY);
    }

    function test_transferOfMoreThanTheBalanceReverts() public {
        vm.prank(alice);
        vm.expectRevert(PupateToken.InsufficientBalance.selector);
        token.transfer(bob, 1);
    }

    function test_transferToTheZeroAddressReverts() public {
        vm.expectRevert(PupateToken.ZeroAddress.selector);
        token.transfer(address(0), 1);
    }

    function test_transferFromSpendsTheAllowance() public {
        token.approve(alice, 10 ether);
        vm.prank(alice);
        assertTrue(token.transferFrom(address(this), bob, 4 ether));
        assertEq(token.balanceOf(bob), 4 ether);
        assertEq(token.allowance(address(this), alice), 6 ether);
    }

    function test_transferFromBeyondTheAllowanceReverts() public {
        token.approve(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(PupateToken.InsufficientAllowance.selector);
        token.transferFrom(address(this), bob, 1 ether + 1);
    }

    function test_unlimitedAllowanceIsNotSpent() public {
        token.approve(alice, type(uint256).max);
        vm.prank(alice);
        token.transferFrom(address(this), bob, 4 ether);
        assertEq(token.allowance(address(this), alice), type(uint256).max);
    }

    function test_burnReducesBalanceAndSupply() public {
        token.burn(7 ether);
        assertEq(token.balanceOf(address(this)), SUPPLY - 7 ether);
        assertEq(token.totalSupply(), SUPPLY - 7 ether);
    }

    function test_burnOfMoreThanTheBalanceReverts() public {
        vm.prank(alice);
        vm.expectRevert(PupateToken.InsufficientBalance.selector);
        token.burn(1);
    }

    function test_burnFromSpendsTheAllowance() public {
        token.approve(alice, 10 ether);
        vm.prank(alice);
        token.burnFrom(address(this), 3 ether);
        assertEq(token.totalSupply(), SUPPLY - 3 ether);
        assertEq(token.allowance(address(this), alice), 7 ether);
    }

    function test_burnFromWithoutAllowanceReverts() public {
        vm.prank(alice);
        vm.expectRevert(PupateToken.InsufficientAllowance.selector);
        token.burnFrom(address(this), 1);
    }

    function testFuzz_transferNeverChangesTheSupply(address to, uint256 amount) public {
        vm.assume(to != address(0) && to != address(this));
        amount = bound(amount, 0, SUPPLY);
        token.transfer(to, amount);
        assertEq(token.balanceOf(to) + token.balanceOf(address(this)), SUPPLY);
        assertEq(token.totalSupply(), SUPPLY);
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `forge test --match-contract PupateTokenTest`
Expected: compilation fails, `src/PupateToken.sol` not found.

- [ ] **Step 3: Write the token**

File: `src/PupateToken.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice PUPATE: a plain ERC-20 with a fixed supply minted once to its deployer.
/// @dev No owner, mint, pause, fee or transfer limit. `burn` and `burnFrom` only reduce supply.
contract PupateToken {
    error ZeroAddress();
    error InsufficientBalance();
    error InsufficientAllowance();

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);

    string public constant name = "Pupate";
    string public constant symbol = "PUPATE";
    uint8 public constant decimals = 18;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor() {
        totalSupply = 1_000_000_000 ether;
        balanceOf[msg.sender] = totalSupply;
        emit Transfer(address(0), msg.sender, totalSupply);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        _spendAllowance(from, amount);
        _transfer(from, to, amount);
        return true;
    }

    /// @notice Destroy `amount` of the caller's tokens.
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    /// @notice Destroy `amount` of `from`'s tokens, spending the caller's allowance.
    function burnFrom(address from, uint256 amount) external {
        _spendAllowance(from, amount);
        _burn(from, amount);
    }

    function _transfer(address from, address to, uint256 amount) private {
        if (to == address(0)) revert ZeroAddress();
        uint256 balance = balanceOf[from];
        if (balance < amount) revert InsufficientBalance();
        unchecked {
            balanceOf[from] = balance - amount;
            // Cannot overflow: balances never sum to more than totalSupply.
            balanceOf[to] += amount;
        }
        emit Transfer(from, to, amount);
    }

    function _burn(address from, uint256 amount) private {
        uint256 balance = balanceOf[from];
        if (balance < amount) revert InsufficientBalance();
        unchecked {
            balanceOf[from] = balance - amount;
            totalSupply -= amount;
        }
        emit Transfer(from, address(0), amount);
    }

    function _spendAllowance(address from, uint256 amount) private {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed == type(uint256).max) return;
        if (allowed < amount) revert InsufficientAllowance();
        unchecked {
            allowance[from][msg.sender] = allowed - amount;
        }
    }
}
```

- [ ] **Step 4: Run the tests**

Run: `forge test --match-contract PupateTokenTest`
Expected: 13 passed.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add PupateToken"
```

---

### Task 4: Pool test utilities

Test-only code. A router that settles swaps and liquidity changes against the PoolManager, a sink double, and a base test that opens pools the way the launch does. Written from scratch against v4-core.

**Files:**
- Create: `src/interfaces/ITaxSink.sol`, `test/utils/PoolRouter.sol`, `test/utils/SinkRouter.sol`, `test/utils/PoolSetup.sol`
- Test: `test/PoolSetup.t.sol`

**Interfaces:**
- Produces:
  - `interface ITaxSink { function depositTax() external payable; }`
  - `contract PoolRouter` with `swap(PoolKey memory, SwapParams memory) external payable returns (BalanceDelta)` and `addLiquidity(PoolKey memory, ModifyLiquidityParams memory) external payable returns (BalanceDelta)`. It settles for `msg.sender` and returns unspent ETH.
  - `contract SinkRouter is PoolRouter, ITaxSink` with `uint256 public deposited`, `setRejecting(bool)`.
  - `abstract contract PoolSetup is Test` with `manager`, `router`, `token`, constants `SQRT_PRICE_OPEN`, `LP_FEE`, `TICK_SPACING`, `POOL_SHARE`, `T0`, and helpers `_ethPool(address quote, address hooks)`, `_open(PoolKey memory, uint256 tokens)`, `_seed`, `_limit(bool)`, `_swap(PoolRouter, PoolKey memory, bool zeroForOne, int256 amountSpecified)`, `_sqrtPrice(PoolKey memory)`.

- [ ] **Step 1: Write the sink interface**

File: `src/interfaces/ITaxSink.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Where PupateHook delivers the tax it collects.
interface ITaxSink {
    /// @notice Accept tax in ETH.
    function depositTax() external payable;
}
```

- [ ] **Step 2: Write the router**

File: `test/utils/PoolRouter.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams, SwapParams} from "v4-core/src/types/PoolOperation.sol";

interface IERC20Like {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @dev Test-only router. Runs one swap or one liquidity change per call and settles the caller's
/// deltas: ETH from the value sent along, tokens by transferFrom. Unspent ETH goes back to the caller.
/// No slippage or deadline checks.
contract PoolRouter is IUnlockCallback {
    struct Job {
        address payer;
        PoolKey key;
        bool isSwap;
        SwapParams swap;
        ModifyLiquidityParams liquidity;
    }

    IPoolManager public immutable manager;

    constructor(IPoolManager manager_) {
        manager = manager_;
    }

    receive() external payable {}

    function swap(PoolKey memory key, SwapParams memory params) external payable returns (BalanceDelta) {
        ModifyLiquidityParams memory none;
        return _run(Job(msg.sender, key, true, params, none));
    }

    function addLiquidity(PoolKey memory key, ModifyLiquidityParams memory params)
        external
        payable
        returns (BalanceDelta)
    {
        SwapParams memory none;
        return _run(Job(msg.sender, key, false, none, params));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager), "not manager");
        Job memory job = abi.decode(data, (Job));
        BalanceDelta delta;
        if (job.isSwap) {
            delta = manager.swap(job.key, job.swap, "");
        } else {
            (delta,) = manager.modifyLiquidity(job.key, job.liquidity, "");
        }
        _resolve(job.key.currency0, job.payer, delta.amount0());
        _resolve(job.key.currency1, job.payer, delta.amount1());
        return abi.encode(delta);
    }

    /// @dev ETH this contract already held stays put; only what the call left over is returned.
    function _run(Job memory job) private returns (BalanceDelta delta) {
        uint256 held = address(this).balance - msg.value;
        delta = abi.decode(manager.unlock(abi.encode(job)), (BalanceDelta));
        uint256 unspent = address(this).balance - held;
        if (unspent != 0) {
            (bool ok,) = msg.sender.call{value: unspent}("");
            require(ok, "refund failed");
        }
    }

    /// @dev A positive delta is owed to the payer; a negative one is owed by the payer.
    function _resolve(Currency currency, address payer, int128 amount) private {
        if (amount > 0) {
            manager.take(currency, payer, uint128(amount));
        } else if (amount < 0) {
            uint256 owed = uint128(-amount);
            if (currency.isAddressZero()) {
                manager.settle{value: owed}();
            } else {
                manager.sync(currency);
                require(
                    IERC20Like(Currency.unwrap(currency)).transferFrom(payer, address(manager), owed),
                    "pay failed"
                );
                manager.settle();
            }
        }
    }
}
```

- [ ] **Step 3: Write the sink double**

File: `test/utils/SinkRouter.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {ITaxSink} from "../../src/interfaces/ITaxSink.sol";
import {PoolRouter} from "./PoolRouter.sol";

/// @dev Stands in for Cocoon: it receives the tax, and it can swap in its own name.
contract SinkRouter is PoolRouter, ITaxSink {
    uint256 public deposited;
    bool public rejecting;

    constructor(IPoolManager manager_) PoolRouter(manager_) {}

    function setRejecting(bool value) external {
        rejecting = value;
    }

    function depositTax() external payable {
        require(!rejecting, "sink rejects");
        deposited += msg.value;
    }
}
```

- [ ] **Step 4: Write the base setup**

File: `test/utils/PoolSetup.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {PoolManager} from "v4-core/src/PoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {FixedPoint96} from "v4-core/src/libraries/FixedPoint96.sol";
import {FullMath} from "v4-core/src/libraries/FullMath.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {Currency, CurrencyLibrary} from "v4-core/src/types/Currency.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams, SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {PupateToken} from "../../src/PupateToken.sol";
import {PoolRouter} from "./PoolRouter.sol";

/// @dev Shared offline setup: a fresh PoolManager, a settlement router, and the PUPATE supply held by
/// the test contract. Pools open the way the launch does: at a 10 ETH valuation, seeded with tokens only.
abstract contract PoolSetup is Test {
    /// @dev 1 ETH buys 100,000,000 PUPATE, so the whole supply is worth 10 ETH. sqrt(1e8) * 2^96.
    uint160 internal constant SQRT_PRICE_OPEN = 792281625142643375935439503360000;
    uint24 internal constant LP_FEE = 3000;
    int24 internal constant TICK_SPACING = 60;
    uint256 internal constant POOL_SHARE = 850_000_000 ether;
    uint256 internal constant T0 = 1_800_000_000;

    IPoolManager internal manager;
    PoolRouter internal router;
    PupateToken internal token;

    /// @dev The last position `_seed` opened, so tests can remove from it.
    int24 internal seedLower;
    int24 internal seedUpper;
    uint256 internal seedLiquidity;

    receive() external payable {}

    function setUp() public virtual {
        vm.warp(T0);
        manager = IPoolManager(address(new PoolManager(address(this))));
        router = new PoolRouter(manager);
        token = new PupateToken();
        token.approve(address(router), type(uint256).max);
        vm.deal(address(this), 1_000_000 ether);
    }

    function _ethPool(address quote, address hooks) internal pure returns (PoolKey memory) {
        return
            PoolKey(CurrencyLibrary.ADDRESS_ZERO, Currency.wrap(quote), LP_FEE, TICK_SPACING, IHooks(hooks));
    }

    function _open(PoolKey memory poolKey, uint256 tokens) internal {
        manager.initialize(poolKey, SQRT_PRICE_OPEN);
        _seed(poolKey, tokens);
    }

    /// @dev Adds `tokens` of currency1 as one-sided liquidity from the lowest usable tick up to the tick
    /// spacing boundary at or below the current tick. It needs no ETH, and buys walk the price into it.
    function _seed(PoolKey memory poolKey, uint256 tokens) internal {
        (, int24 tick,,) = StateLibrary.getSlot0(manager, poolKey.toId());
        int24 upper = (tick / poolKey.tickSpacing) * poolKey.tickSpacing;
        if (tick < 0 && tick % poolKey.tickSpacing != 0) upper -= poolKey.tickSpacing;
        int24 lower = TickMath.minUsableTick(poolKey.tickSpacing);
        uint256 width = TickMath.getSqrtPriceAtTick(upper) - TickMath.getSqrtPriceAtTick(lower);
        uint256 liquidity = FullMath.mulDiv(tokens, FixedPoint96.Q96, width);
        seedLower = lower;
        seedUpper = upper;
        seedLiquidity = liquidity;
        router.addLiquidity(poolKey, ModifyLiquidityParams(lower, upper, int256(liquidity), bytes32(0)));
    }

    function _limit(bool zeroForOne) internal pure returns (uint160) {
        return zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1;
    }

    /// @dev Swaps as the test contract. Buys send plenty of ETH along; the router returns the rest.
    function _swap(PoolRouter via, PoolKey memory poolKey, bool zeroForOne, int256 amountSpecified)
        internal
        returns (BalanceDelta)
    {
        uint256 value = zeroForOne ? 100_000 ether : 0;
        return via.swap{value: value}(poolKey, SwapParams(zeroForOne, amountSpecified, _limit(zeroForOne)));
    }

    function _sqrtPrice(PoolKey memory poolKey) internal view returns (uint160 sqrtPrice) {
        (sqrtPrice,,,) = StateLibrary.getSlot0(manager, poolKey.toId());
    }
}
```

- [ ] **Step 5: Write the tests for the utilities**

File: `test/PoolSetup.t.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolSetup} from "./utils/PoolSetup.sol";
import {SinkRouter} from "./utils/SinkRouter.sol";

/// @dev Checks the test utilities themselves on a pool without any hook.
contract PoolSetupTest is PoolSetup {
    PoolKey internal plain;

    function setUp() public override {
        super.setUp();
        plain = _ethPool(address(token), address(0));
        _open(plain, POOL_SHARE);
    }

    function test_seedingTakesTokensAndNoEth() public view {
        uint256 seeded = token.balanceOf(address(manager));
        assertLe(seeded, POOL_SHARE);
        assertApproxEqAbs(seeded, POOL_SHARE, 1e6);
        assertEq(address(manager).balance, 0);
    }

    function test_buyPaysExactlyTheNamedEthAndReceivesTokens() public {
        uint256 ethBefore = address(this).balance;
        uint256 tokensBefore = token.balanceOf(address(this));

        BalanceDelta delta = _swap(router, plain, true, -1 ether);

        assertEq(ethBefore - address(this).balance, 1 ether, "unspent ETH comes back");
        assertEq(delta.amount0(), -1 ether);
        uint256 received = token.balanceOf(address(this)) - tokensBefore;
        assertEq(uint256(uint128(delta.amount1())), received);
        // x*y=k with about 8.51 ETH of virtual reserve and a 0.3% LP fee.
        assertApproxEqRel(received, 89_110_000 ether, 0.01e18);
    }

    function test_sellPaysOutEth() public {
        _swap(router, plain, true, -1 ether);
        uint256 ethBefore = address(this).balance;

        BalanceDelta delta = _swap(router, plain, false, -10_000_000 ether);

        assertGt(delta.amount0(), 0);
        assertEq(address(this).balance - ethBefore, uint256(uint128(delta.amount0())));
    }

    function test_sinkRouterKeepsItsDepositsWhenItSwaps() public {
        SinkRouter sink = new SinkRouter(manager);
        sink.depositTax{value: 3 ether}();
        token.approve(address(sink), type(uint256).max);

        _swap(sink, plain, true, -1 ether);

        assertEq(sink.deposited(), 3 ether);
        assertEq(address(sink).balance, 3 ether);
    }

    function test_sinkRouterCanBeToldToReject() public {
        SinkRouter sink = new SinkRouter(manager);
        sink.setRejecting(true);
        vm.expectRevert(bytes("sink rejects"));
        sink.depositTax{value: 1}();
    }
}
```

- [ ] **Step 6: Run the tests**

Run: `forge test --match-contract PoolSetupTest -vv`
Expected: 5 passed.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "test: add Uniswap v4 pool utilities"
```

---

### Task 5: PupateHook

**Files:**
- Create: `src/PupateHook.sol`, `test/utils/HookFixture.sol`
- Test: `test/PupateHook.t.sol`

**Interfaces:**
- Consumes: `ITaxSink.depositTax()`, `PoolSetup`, `SinkRouter` from Task 4; `PupateToken` from Task 3.
- Produces: `contract PupateHook is IUnlockCallback` with
  - `constructor(IPoolManager poolManager_, address sink_, address owner_)`
  - `function buyTaxBps() public view returns (uint256)`, `uint16 public taxBps`, `uint40 public openedAt`, `PoolId public launchPool`, `uint256 public totalTax`, `address public owner`, `address public immutable sink`, `IPoolManager public immutable poolManager`
  - `function flush() external returns (uint256 amount)`
  - `function lowerTax(uint16 newTaxBps) external`, `function transferOwnership(address to) external`
  - `function getHookPermissions() public pure returns (Hooks.Permissions memory)`
  - the callbacks `afterInitialize`, `beforeSwap`, `afterSwap`, `unlockCallback`
  - errors `ZeroAddress`, `OnlyPoolManager`, `NotOwner`, `NotLower`, `PartialFill`, `NothingToFlush`

How the tax is taken, by swap mode. The pool is ETH (currency0) against PUPATE (currency1); a buy is `zeroForOne`.

| Mode | The trader names | Tax | Returned from |
|---|---|---|---|
| Buy, exact input | ETH paid (gross) | `paid * rate / 10000` | `beforeSwap`, specified delta |
| Sell, exact output | ETH received (net) | `received * rate / (10000 - rate)` | `beforeSwap`, specified delta |
| Buy, exact output | PUPATE received | `poolLeg * rate / (10000 - rate)` | `afterSwap`, unspecified delta |
| Sell, exact input | PUPATE sold | `poolLeg * rate / 10000` | `afterSwap`, unspecified delta |

In every mode the tax is at most `rate` of the gross ETH side: what the trader pays on a buy, what the pool pays out on a sell.

- [ ] **Step 1: Write the fixture**

File: `test/utils/HookFixture.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {CustomRevert} from "v4-core/src/libraries/CustomRevert.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PupateHook} from "../../src/PupateHook.sol";
import {PoolSetup} from "./PoolSetup.sol";
import {SinkRouter} from "./SinkRouter.sol";

/// @dev The launch as the tests see it: the hook at a mined CREATE2 address, and the ETH/PUPATE pool
/// opened on it at time T0 with 85% of supply as one-sided liquidity.
abstract contract HookFixture is PoolSetup {
    /// @dev afterInitialize, beforeAddLiquidity, beforeSwap, afterSwap, beforeSwapReturnDelta,
    /// afterSwapReturnDelta.
    uint160 internal constant HOOK_FLAGS = 0x18CC;

    SinkRouter internal sink;
    PupateHook internal hook;
    PoolKey internal key;
    address internal owner = makeAddr("timelock");

    function setUp() public virtual override {
        super.setUp();
        sink = new SinkRouter(manager);
        token.approve(address(sink), type(uint256).max);
        hook = _deployHook(address(sink), owner);
        key = _ethPool(address(token), address(hook));
        _open(key, POOL_SHARE);
    }

    /// @dev Mines a CREATE2 salt until the address carries exactly HOOK_FLAGS in its low 14 bits.
    function _deployHook(address sink_, address owner_) internal returns (PupateHook deployed) {
        bytes32 initHash =
            keccak256(abi.encodePacked(type(PupateHook).creationCode, abi.encode(manager, sink_, owner_)));
        for (uint256 salt; salt < 1_000_000; ++salt) {
            address predicted = address(
                uint160(
                    uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), bytes32(salt), initHash)))
                )
            );
            if (uint160(predicted) & Hooks.ALL_HOOK_MASK != HOOK_FLAGS || predicted.code.length != 0) {
                continue;
            }
            deployed = new PupateHook{salt: bytes32(salt)}(manager, sink_, owner_);
            assertEq(address(deployed), predicted, "CREATE2 prediction");
            return deployed;
        }
        revert("no salt");
    }

    function _endLaunch() internal {
        vm.warp(T0 + 2 hours);
    }

    function _claims() internal view returns (uint256) {
        return manager.balanceOf(address(hook), 0);
    }

    function _buyExactIn(uint256 ethIn) internal returns (BalanceDelta) {
        return _swap(router, key, true, -int256(ethIn));
    }

    function _buyExactOut(uint256 tokensOut) internal returns (BalanceDelta) {
        return _swap(router, key, true, int256(tokensOut));
    }

    function _sellExactIn(uint256 tokensIn) internal returns (BalanceDelta) {
        return _swap(router, key, false, -int256(tokensIn));
    }

    function _sellExactOut(uint256 ethOut) internal returns (BalanceDelta) {
        return _swap(router, key, false, int256(ethOut));
    }

    /// @dev The PoolManager wraps a hook revert: WrappedError(hook, callback, reason, HookCallFailed).
    function _hookRevert(bytes4 callback, bytes4 reason) internal view returns (bytes memory) {
        return _hookRevertFrom(address(hook), callback, reason);
    }

    function _hookRevertFrom(address target, bytes4 callback, bytes4 reason)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encodeWithSelector(
            CustomRevert.WrappedError.selector,
            target,
            callback,
            abi.encodeWithSelector(reason),
            abi.encodeWithSelector(Hooks.HookCallFailed.selector)
        );
    }
}
```

- [ ] **Step 2: Write the failing tests**

File: `test/PupateHook.t.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {BalanceDelta, toBalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {PoolId} from "v4-core/src/types/PoolId.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams, SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {PupateHook} from "../src/PupateHook.sol";
import {PupateToken} from "../src/PupateToken.sol";
import {HookFixture} from "./utils/HookFixture.sol";

contract PupateHookTest is HookFixture {
    // ------------------------------------------------------------------ construction

    function test_addressEncodesExactlyTheDeclaredPermissions() public view {
        assertEq(uint160(address(hook)) & Hooks.ALL_HOOK_MASK, HOOK_FLAGS);
        Hooks.Permissions memory p = hook.getHookPermissions();
        assertTrue(p.afterInitialize && p.beforeAddLiquidity && p.beforeSwap && p.afterSwap);
        assertTrue(p.beforeSwapReturnDelta && p.afterSwapReturnDelta);
        assertFalse(p.beforeInitialize || p.afterAddLiquidity);
        assertFalse(p.beforeRemoveLiquidity || p.afterRemoveLiquidity || p.beforeDonate || p.afterDonate);
        assertFalse(p.afterAddLiquidityReturnDelta || p.afterRemoveLiquidityReturnDelta);
    }

    function test_constructorRejectsZeroAddresses() public {
        vm.expectRevert(PupateHook.ZeroAddress.selector);
        new PupateHook(IPoolManager(address(0)), address(sink), owner);
        vm.expectRevert(PupateHook.ZeroAddress.selector);
        new PupateHook(manager, address(0), owner);
        vm.expectRevert(PupateHook.ZeroAddress.selector);
        new PupateHook(manager, address(sink), address(0));
    }

    function test_constructorRejectsAnAddressThatDoesNotEncodeItsPermissions() public {
        address plain = vm.computeCreateAddress(address(this), vm.getNonce(address(this)));
        vm.expectRevert(abi.encodeWithSelector(Hooks.HookAddressNotValid.selector, plain));
        new PupateHook(manager, address(sink), owner);
    }

    function test_callbacksRejectCallersOtherThanThePoolManager() public {
        SwapParams memory params = SwapParams(true, -1 ether, _limit(true));
        vm.expectRevert(PupateHook.OnlyPoolManager.selector);
        hook.afterInitialize(address(this), key, SQRT_PRICE_OPEN, 0);
        vm.expectRevert(PupateHook.OnlyPoolManager.selector);
        hook.beforeAddLiquidity(address(this), key, ModifyLiquidityParams(0, 0, 0, bytes32(0)), "");
        vm.expectRevert(PupateHook.OnlyPoolManager.selector);
        hook.beforeSwap(address(this), key, params, "");
        vm.expectRevert(PupateHook.OnlyPoolManager.selector);
        hook.afterSwap(address(this), key, params, toBalanceDelta(0, 0), "");
        vm.expectRevert(PupateHook.OnlyPoolManager.selector);
        hook.unlockCallback("");
    }

    // ------------------------------------------------------------------ launch pool

    function test_firstNativePoolBecomesTheLaunchPool() public view {
        assertEq(PoolId.unwrap(hook.launchPool()), PoolId.unwrap(key.toId()));
        assertEq(hook.openedAt(), T0);
        assertEq(hook.openedAtBlock(), block.number);
    }

    function test_aSecondNativePoolIsNotTheLaunchPoolAndTakesNoLiquidity() public {
        _endLaunch();
        PupateToken other = new PupateToken();
        other.approve(address(router), type(uint256).max);
        PoolKey memory second = _ethPool(address(other), address(hook));
        manager.initialize(second, SQRT_PRICE_OPEN);

        assertEq(PoolId.unwrap(hook.launchPool()), PoolId.unwrap(key.toId()));
        assertEq(hook.openedAt(), T0);

        // Same block as the launch pool opened, so only the pool check can reject this.
        vm.expectRevert(_hookRevert(IHooks.beforeAddLiquidity.selector, PupateHook.LiquidityClosed.selector));
        router.addLiquidity(second, ModifyLiquidityParams(-887_220, 887_220, 1e18, bytes32(0)));
    }

    function test_aPoolWithoutNativeEthDoesNotBecomeTheLaunchPool() public {
        PupateHook fresh = _deployHook(address(sink), owner);
        PupateToken a = new PupateToken();
        PupateToken b = new PupateToken();
        (address low, address high) =
            address(a) < address(b) ? (address(a), address(b)) : (address(b), address(a));
        manager.initialize(
            PoolKey(Currency.wrap(low), Currency.wrap(high), LP_FEE, TICK_SPACING, IHooks(address(fresh))),
            SQRT_PRICE_OPEN
        );
        assertEq(fresh.openedAt(), 0);
        assertEq(fresh.buyTaxBps(), 600, "no launch pool, no launch schedule");

        vm.warp(T0 + 500);
        PoolKey memory native = _ethPool(address(a), address(fresh));
        manager.initialize(native, SQRT_PRICE_OPEN);
        assertEq(fresh.openedAt(), T0 + 500);
        assertEq(PoolId.unwrap(fresh.launchPool()), PoolId.unwrap(native.toId()));
        assertEq(fresh.buyTaxBps(), 9900);
    }

    // ------------------------------------------------------------------ standing tax

    function test_buyExactIn_taxIsSixPercentOfTheEthPaid() public {
        _endLaunch();
        uint256 ethBefore = address(this).balance;

        vm.expectEmit(true, false, false, true, address(hook));
        emit PupateHook.Taxed(address(router), true, 0.06 ether, 600);
        BalanceDelta delta = _buyExactIn(1 ether);

        assertEq(ethBefore - address(this).balance, 1 ether, "the trader pays what they named");
        assertEq(delta.amount0(), -1 ether);
        assertGt(delta.amount1(), 0);
        assertEq(_claims(), 0.06 ether);
        assertEq(hook.totalTax(), 0.06 ether);
    }

    function test_firstBuyWorksWhileThePoolHoldsNoEth() public {
        _endLaunch();
        assertEq(address(manager).balance, 0);
        _buyExactIn(1 ether);
        // 0.94 ETH in the pool and 0.06 ETH backing the hook's claims.
        assertEq(address(manager).balance, 1 ether);
    }

    function test_buyExactOut_taxIsSixPercentOfTheGrossEthPaid() public {
        _endLaunch();
        BalanceDelta delta = _buyExactOut(1_000_000 ether);

        uint256 paid = uint256(uint128(-delta.amount0()));
        uint256 tax = _claims();
        assertEq(uint256(uint128(delta.amount1())), 1_000_000 ether, "the trader gets what they named");
        assertEq(tax, (paid - tax) * 600 / 9400);
        assertLe(tax * 10_000, paid * 600, "never more than 6% of the gross");
        assertGe(tax * 10_000 + 10_000, paid * 600, "and within a wei of it");
    }

    function test_sellExactIn_taxIsSixPercentOfTheEthPaidOut() public {
        _endLaunch();
        _buyExactIn(5 ether);
        uint256 claimsBefore = _claims();
        uint256 ethBefore = address(this).balance;

        BalanceDelta delta = _sellExactIn(10_000_000 ether);

        uint256 received = address(this).balance - ethBefore;
        uint256 tax = _claims() - claimsBefore;
        assertEq(delta.amount1(), -10_000_000 ether, "the trader sells what they named");
        assertEq(uint256(uint128(delta.amount0())), received);
        assertGt(tax, 0);
        assertEq(tax, (received + tax) * 600 / 10_000);
    }

    function test_sellExactOut_taxIsSixPercentOfTheGrossEthPaidOut() public {
        _endLaunch();
        _buyExactIn(5 ether);
        uint256 claimsBefore = _claims();
        uint256 ethBefore = address(this).balance;

        BalanceDelta delta = _sellExactOut(0.1 ether);

        assertEq(address(this).balance - ethBefore, 0.1 ether, "the trader receives what they named");
        assertEq(delta.amount0(), 0.1 ether);
        assertEq(_claims() - claimsBefore, uint256(0.1 ether) * 600 / 9400);
    }

    function test_dustSwapWhoseTaxRoundsToZeroStillGoesThrough() public {
        _endLaunch();
        BalanceDelta delta = _buyExactIn(10);
        assertEq(delta.amount0(), -10);
        assertEq(_claims(), 0);
    }

    function test_exactEthSwapThatCannotFillReverts() public {
        _endLaunch();
        uint160 tight = uint160(uint256(_sqrtPrice(key)) * 999 / 1000);
        vm.expectRevert(_hookRevert(IHooks.afterSwap.selector, PupateHook.PartialFill.selector));
        router.swap{value: 100 ether}(key, SwapParams(true, -100 ether, tight));
    }

    function test_exactTokenSwapMayFillPartlyAndIsTaxedOnWhatMoved() public {
        _endLaunch();
        uint160 tight = uint160(uint256(_sqrtPrice(key)) * 990 / 1000);

        BalanceDelta delta = router.swap{value: 100 ether}(key, SwapParams(true, 500_000_000 ether, tight));

        assertLt(uint256(uint128(delta.amount1())), 500_000_000 ether, "fewer tokens than asked for");
        uint256 paid = uint256(uint128(-delta.amount0()));
        uint256 tax = _claims();
        assertGt(tax, 0);
        assertEq(tax, (paid - tax) * 600 / 9400);
    }

    function testFuzz_buyExactIn_traderPaysWhatTheyNamedAtAnyPointOfTheSchedule(
        uint256 ethIn,
        uint256 elapsed
    ) public {
        ethIn = bound(ethIn, 1e9, 1_000 ether);
        vm.warp(T0 + bound(elapsed, 0, 3 hours));
        uint256 rate = hook.buyTaxBps();

        BalanceDelta delta = _buyExactIn(ethIn);

        assertEq(uint256(uint128(-delta.amount0())), ethIn);
        assertEq(_claims(), ethIn * rate / 10_000);
    }

    // ------------------------------------------------------------------ launch schedule

    function test_buyTaxStartsAtNinetyNinePercent() public view {
        assertEq(hook.buyTaxBps(), 9900);
    }

    function test_buyTaxFallsOnePointAMinute() public {
        vm.warp(T0 + 60);
        assertEq(hook.buyTaxBps(), 9800);
        vm.warp(T0 + 90);
        assertEq(hook.buyTaxBps(), 9750);
        vm.warp(T0 + 30 minutes);
        assertEq(hook.buyTaxBps(), 6900);
    }

    function test_buyTaxMeetsTheStandingTaxAfterNinetyThreeMinutes() public {
        vm.warp(T0 + 93 minutes - 1);
        assertEq(hook.buyTaxBps(), 602);
        vm.warp(T0 + 93 minutes);
        assertEq(hook.buyTaxBps(), 600);
        vm.warp(T0 + 365 days);
        assertEq(hook.buyTaxBps(), 600);
    }

    function test_buyAtTheOpenPaysTheLaunchTax() public {
        BalanceDelta delta = _buyExactIn(1 ether);
        assertEq(delta.amount0(), -1 ether);
        assertEq(_claims(), 0.99 ether);
    }

    function test_buyExactOutAtTheOpenPaysNinetyNineTimesThePoolLeg() public {
        BalanceDelta delta = _buyExactOut(1_000_000 ether);
        uint256 paid = uint256(uint128(-delta.amount0()));
        uint256 tax = _claims();
        assertEq(tax, (paid - tax) * 99);
    }

    function test_sellAtTheOpenPaysOnlyTheStandingTax() public {
        _buyExactIn(10 ether);
        uint256 claimsBefore = _claims();

        BalanceDelta delta = _sellExactIn(1_000_000 ether);

        uint256 received = uint256(uint128(delta.amount0()));
        uint256 tax = _claims() - claimsBefore;
        assertGt(tax, 0);
        assertEq(tax, (received + tax) * 600 / 10_000);
    }

    // ------------------------------------------------------------------ the sink

    function test_theSinksOwnSwapsAreNotTaxed() public {
        // At the open, when everyone else pays 99%.
        BalanceDelta delta = _swap(sink, key, true, -1 ether);
        assertEq(delta.amount0(), -1 ether);
        assertEq(_claims(), 0);
        assertEq(hook.totalTax(), 0);
        assertEq(address(manager).balance, 1 ether);
    }

    function test_theSinksOwnSwapMayFillPartly() public {
        uint160 tight = uint160(uint256(_sqrtPrice(key)) * 990 / 1000);
        BalanceDelta delta = sink.swap{value: 100 ether}(key, SwapParams(true, -100 ether, tight));
        assertGt(delta.amount0(), -100 ether);
        assertEq(_claims(), 0);
    }

    function test_flushHandsTheCollectedTaxToTheSink() public {
        _endLaunch();
        _buyExactIn(2 ether);
        uint256 tax = _claims();
        assertEq(tax, 0.12 ether);

        vm.expectEmit(false, false, false, true, address(hook));
        emit PupateHook.Flushed(tax);
        vm.prank(makeAddr("anyone"));
        uint256 flushed = hook.flush();

        assertEq(flushed, tax);
        assertEq(sink.deposited(), tax);
        assertEq(_claims(), 0);
        assertEq(address(hook).balance, 0);
        assertEq(hook.totalTax(), tax, "the running total is not reset");
    }

    function test_flushWithNothingCollectedReverts() public {
        vm.expectRevert(PupateHook.NothingToFlush.selector);
        hook.flush();
    }

    function test_flushLeavesTheTaxInPlaceWhenTheSinkRejects() public {
        _endLaunch();
        _buyExactIn(2 ether);
        uint256 tax = _claims();
        sink.setRejecting(true);

        vm.expectRevert(bytes("sink rejects"));
        hook.flush();
        assertEq(_claims(), tax);

        sink.setRejecting(false);
        hook.flush();
        assertEq(sink.deposited(), tax);
    }

    function test_hookRefusesEthFromAnyoneButThePoolManager() public {
        (bool ok,) = address(hook).call{value: 1}("");
        assertFalse(ok);
    }

    // ------------------------------------------------------------------ the owner

    function test_ownerCanLowerTheStandingTax() public {
        vm.expectEmit(false, false, false, true, address(hook));
        emit PupateHook.TaxLowered(400);
        vm.prank(owner);
        hook.lowerTax(400);
        assertEq(hook.taxBps(), 400);

        _endLaunch();
        _buyExactIn(1 ether);
        assertEq(_claims(), 0.04 ether);
    }

    function test_standingTaxCannotBeRaisedOrRestated() public {
        vm.startPrank(owner);
        vm.expectRevert(PupateHook.NotLower.selector);
        hook.lowerTax(600);
        vm.expectRevert(PupateHook.NotLower.selector);
        hook.lowerTax(601);
        vm.stopPrank();
        assertEq(hook.taxBps(), 600);
    }

    function test_onlyTheOwnerCanLowerTheTaxOrHandOverOwnership() public {
        vm.expectRevert(PupateHook.NotOwner.selector);
        hook.lowerTax(100);
        vm.expectRevert(PupateHook.NotOwner.selector);
        hook.transferOwnership(address(this));
    }

    function test_aLowerStandingTaxExtendsTheLaunchScheduleDownToIt() public {
        vm.prank(owner);
        hook.lowerTax(300);
        vm.warp(T0 + 93 minutes);
        assertEq(hook.buyTaxBps(), 600);
        vm.warp(T0 + 96 minutes);
        assertEq(hook.buyTaxBps(), 300);
    }

    function test_taxCanBeLoweredToZero() public {
        vm.prank(owner);
        hook.lowerTax(0);
        _endLaunch();

        _buyExactIn(1 ether);
        _buyExactOut(1_000_000 ether);
        _sellExactIn(1_000_000 ether);
        _sellExactOut(0.01 ether);

        assertEq(_claims(), 0);
        assertEq(hook.totalTax(), 0);
    }

    function test_ownershipCanBeHandedOver() public {
        address next = makeAddr("next timelock");
        vm.prank(owner);
        hook.transferOwnership(next);
        assertEq(hook.owner(), next);

        vm.prank(owner);
        vm.expectRevert(PupateHook.NotOwner.selector);
        hook.lowerTax(500);

        vm.prank(next);
        hook.lowerTax(500);
        assertEq(hook.taxBps(), 500);
    }

    function test_ownershipCannotGoToTheZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(PupateHook.ZeroAddress.selector);
        hook.transferOwnership(address(0));
    }

    // ------------------------------------------------------------------ added after review

    function test_exactOutSellThatCannotFillReverts() public {
        _endLaunch();
        _buyExactIn(5 ether);

        // More ETH than the pool holds.
        vm.expectRevert(_hookRevert(IHooks.afterSwap.selector, PupateHook.PartialFill.selector));
        router.swap(key, SwapParams(false, int256(100 ether), _limit(false)));

        // A price limit that stops the fill early.
        uint160 tight = uint160(uint256(_sqrtPrice(key)) * 1001 / 1000);
        vm.expectRevert(_hookRevert(IHooks.afterSwap.selector, PupateHook.PartialFill.selector));
        router.swap(key, SwapParams(false, int256(0.5 ether), tight));
    }

    function test_exactOutSellDuringTheLaunchPaysTheStandingRate() public {
        _swap(sink, key, true, -10 ether);
        uint256 ethBefore = address(this).balance;

        BalanceDelta delta = _sellExactOut(0.1 ether);

        assertEq(address(this).balance - ethBefore, 0.1 ether);
        assertEq(delta.amount0(), 0.1 ether);
        assertEq(_claims(), uint256(0.1 ether) * 600 / 9400);
        assertEq(hook.buyTaxBps(), 9900, "buys would still pay the launch rate");
    }

    function test_theSinkIsExemptInEveryMode() public {
        _swap(sink, key, true, -1 ether);
        _swap(sink, key, true, int256(1_000_000 ether));
        _swap(sink, key, false, -int256(1_000_000 ether));
        _swap(sink, key, false, int256(0.01 ether));
        assertEq(_claims(), 0);
        assertEq(hook.totalTax(), 0);
    }

    function test_launchPoolSetEventNamesThePoolAndTheTime() public {
        PupateHook fresh = _deployHook(address(sink), owner);
        PupateToken other = new PupateToken();
        PoolKey memory native = _ethPool(address(other), address(fresh));
        vm.warp(T0 + 123);
        vm.expectEmit(true, false, false, true, address(fresh));
        emit PupateHook.LaunchPoolSet(native.toId(), T0 + 123);
        manager.initialize(native, SQRT_PRICE_OPEN);
    }

    function test_taxedEventReportsSells() public {
        _endLaunch();
        _buyExactIn(5 ether);
        vm.expectEmit(true, false, false, true, address(hook));
        emit PupateHook.Taxed(address(router), false, uint256(0.1 ether) * 600 / 9400, 600);
        _sellExactOut(0.1 ether);
    }

    /// @dev ETH can be forced into any contract. It is delivered to the sink rather than stranded, so
    /// deliveries can exceed `totalTax`; nothing downstream may assume they are equal.
    function test_flushAlsoDeliversEthForcedIntoTheHook() public {
        _endLaunch();
        _buyExactIn(1 ether);
        vm.deal(address(hook), 2 ether);

        uint256 flushed = hook.flush();

        assertEq(flushed, 2.06 ether);
        assertEq(sink.deposited(), 2.06 ether);
        assertEq(hook.totalTax(), 0.06 ether, "totalTax counts tax only");
    }

    // ------------------------------------------------------------------ liquidity gate

    function test_liquidityCanBeAddedOnlyInTheBlockTheLaunchPoolOpened() public {
        assertEq(hook.openedAtBlock(), block.number);
        _seed(key, 1_000 ether);

        vm.roll(block.number + 1);
        vm.expectRevert(_hookRevert(IHooks.beforeAddLiquidity.selector, PupateHook.LiquidityClosed.selector));
        router.addLiquidity(key, ModifyLiquidityParams(seedLower, seedUpper, 1e15, bytes32(0)));
    }

    function test_liquidityCanStillBeRemovedAfterTheOpeningBlock() public {
        vm.roll(block.number + 1);
        uint256 before = token.balanceOf(address(this));

        router.addLiquidity(
            key, ModifyLiquidityParams(seedLower, seedUpper, -int256(seedLiquidity / 2), bytes32(0))
        );

        assertGt(token.balanceOf(address(this)), before);
    }

    function test_noPoolOnTheHookTakesLiquidityBeforeTheLaunchPoolOpens() public {
        PupateHook fresh = _deployHook(address(sink), owner);
        PupateToken a = new PupateToken();
        PupateToken b = new PupateToken();
        a.approve(address(router), type(uint256).max);
        b.approve(address(router), type(uint256).max);
        (address low, address high) =
            address(a) < address(b) ? (address(a), address(b)) : (address(b), address(a));
        PoolKey memory pair =
            PoolKey(Currency.wrap(low), Currency.wrap(high), LP_FEE, TICK_SPACING, IHooks(address(fresh)));
        manager.initialize(pair, SQRT_PRICE_OPEN);

        vm.expectRevert(
            _hookRevertFrom(
                address(fresh), IHooks.beforeAddLiquidity.selector, PupateHook.LiquidityClosed.selector
            )
        );
        router.addLiquidity(pair, ModifyLiquidityParams(-887_220, 887_220, 1e18, bytes32(0)));
    }
}
```

- [ ] **Step 3: Run to verify it fails**

Run: `forge test --match-contract PupateHookTest`
Expected: compilation fails, `src/PupateHook.sol` not found.

- [ ] **Step 4: Write the hook**

File: `src/PupateHook.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {SafeCast} from "v4-core/src/libraries/SafeCast.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {
    BeforeSwapDelta,
    BeforeSwapDeltaLibrary,
    toBeforeSwapDelta
} from "v4-core/src/types/BeforeSwapDelta.sol";
import {CurrencyLibrary} from "v4-core/src/types/Currency.sol";
import {PoolId} from "v4-core/src/types/PoolId.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams, SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {ITaxSink} from "./interfaces/ITaxSink.sol";

/// @notice Uniswap v4 hook that taxes the ETH side of every trade in the Pupate launch pool.
/// @dev The tax is taken inside the swap as ERC-6909 claims on the PoolManager: no ETH moves and no
/// contract other than the PoolManager is called from a swap callback. `flush` turns the claims into
/// ETH and hands them to the sink. The hook's address must encode afterInitialize, beforeSwap,
/// beforeAddLiquidity, afterSwap, beforeSwapReturnDelta and afterSwapReturnDelta: low 14 bits 0x18CC.
/// Liquidity can be added only to the launch pool and only in the block that opens it, so after the
/// launch the pool's liquidity can only shrink and nobody can trade by resting liquidity untaxed.
contract PupateHook is IUnlockCallback {
    using SafeCast for uint256;

    error ZeroAddress();
    error OnlyPoolManager();
    error NotOwner();
    error NotLower();
    error PartialFill();
    error NothingToFlush();
    error LiquidityClosed();

    event LaunchPoolSet(PoolId indexed poolId, uint256 openedAt);
    event Taxed(address indexed sender, bool buy, uint256 tax, uint256 rateBps);
    event Flushed(uint256 amount);
    event TaxLowered(uint256 taxBps);
    event OwnershipTransferred(address indexed from, address indexed to);

    uint256 public constant BPS = 10_000;
    /// @notice Buy tax at the moment the launch pool opens.
    uint256 public constant LAUNCH_TAX_BPS = 9900;
    /// @notice How fast the launch buy tax falls towards the standing tax.
    uint256 public constant LAUNCH_DECAY_BPS_PER_MINUTE = 100;
    /// @dev ERC-6909 id of native ETH on the PoolManager.
    uint256 private constant ETH_CLAIM_ID = 0;

    IPoolManager public immutable poolManager;
    /// @notice Receives every flushed wei. Swaps the sink makes itself are not taxed.
    address public immutable sink;

    /// @notice May lower the standing tax. Nothing can raise it.
    address public owner;
    /// @notice When the launch pool was initialised. Zero until then.
    uint40 public openedAt;
    /// @notice Standing tax on the ETH side of every buy and sell, in basis points.
    uint16 public taxBps = 600;
    /// @notice Block in which the launch pool was initialised. Liquidity can be added in that block only.
    uint40 public openedAtBlock;
    /// @notice The first native-ETH pool initialised on this hook. Only this pool is taxed.
    PoolId public launchPool;
    /// @notice Every wei of tax ever collected.
    uint256 public totalTax;

    modifier onlyPoolManager() {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();
        _;
    }

    constructor(IPoolManager poolManager_, address sink_, address owner_) {
        if (address(poolManager_) == address(0) || sink_ == address(0) || owner_ == address(0)) {
            revert ZeroAddress();
        }
        poolManager = poolManager_;
        sink = sink_;
        owner = owner_;
        emit OwnershipTransferred(address(0), owner_);
        Hooks.validateHookPermissions(IHooks(address(this)), getHookPermissions());
    }

    /// @dev ETH only ever arrives from the PoolManager, during `flush`.
    receive() external payable {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();
    }

    function getHookPermissions() public pure returns (Hooks.Permissions memory permissions) {
        permissions.afterInitialize = true;
        permissions.beforeAddLiquidity = true;
        permissions.beforeSwap = true;
        permissions.afterSwap = true;
        permissions.beforeSwapReturnDelta = true;
        permissions.afterSwapReturnDelta = true;
    }

    /// @notice The buy tax right now: 99% when the launch pool opens, one point lower each minute,
    /// until it meets the standing tax.
    function buyTaxBps() public view returns (uint256) {
        uint256 standing = taxBps;
        uint256 opened = openedAt;
        if (opened == 0) return standing;
        uint256 fallen = (block.timestamp - opened) * LAUNCH_DECAY_BPS_PER_MINUTE / 60;
        if (fallen >= LAUNCH_TAX_BPS - standing) return standing;
        return LAUNCH_TAX_BPS - fallen;
    }

    // ------------------------------------------------------------------ pool callbacks

    /// @notice `IHooks.afterInitialize`. Records the first native-ETH pool as the launch pool.
    function afterInitialize(address, PoolKey calldata key, uint160, int24)
        external
        onlyPoolManager
        returns (bytes4)
    {
        if (openedAt == 0 && key.currency0.isAddressZero()) {
            PoolId id = key.toId();
            launchPool = id;
            openedAt = uint40(block.timestamp);
            openedAtBlock = uint40(block.number);
            emit LaunchPoolSet(id, block.timestamp);
        }
        return IHooks.afterInitialize.selector;
    }

    /// @notice `IHooks.beforeAddLiquidity`. Admits liquidity only into the launch pool, and only in
    /// the block that opened it: the factory opens and seeds the pool in one transaction. Removing
    /// liquidity is never gated.
    function beforeAddLiquidity(address, PoolKey calldata key, ModifyLiquidityParams calldata, bytes calldata)
        external
        view
        onlyPoolManager
        returns (bytes4)
    {
        uint256 opened = openedAtBlock;
        if (opened == 0 || block.number != opened || PoolId.unwrap(key.toId()) != PoolId.unwrap(launchPool)) {
            revert LiquidityClosed();
        }
        return IHooks.beforeAddLiquidity.selector;
    }

    /// @notice `IHooks.beforeSwap`. When the trader names the ETH amount, the tax is returned here as a
    /// positive specified delta. Nothing is stored; `afterSwap` checks the fill and collects.
    function beforeSwap(address sender, PoolKey calldata key, SwapParams calldata params, bytes calldata)
        external
        view
        onlyPoolManager
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        if (!_taxed(sender, key) || !_namesEth(params)) {
            return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        }
        uint256 tax = _taxOnNamedEth(params, _rate(params.zeroForOne));
        return (IHooks.beforeSwap.selector, toBeforeSwapDelta(tax.toInt128(), 0), 0);
    }

    /// @notice `IHooks.afterSwap`. `delta` is the pool's raw delta, before the hook's own.
    /// @dev When the trader named the ETH amount, the pool must have moved exactly that amount net of
    /// the tax; otherwise the fill was partial and the swap reverts. When the trader named the token
    /// amount, the tax is computed from the ETH the pool actually moved and returned as a positive
    /// unspecified delta. Either way the tax is minted to the hook as claims.
    function afterSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata
    ) external onlyPoolManager returns (bytes4, int128) {
        if (!_taxed(sender, key)) return (IHooks.afterSwap.selector, 0);

        bool buy = params.zeroForOne;
        uint256 rate = _rate(buy);
        uint256 tax;
        int128 unspecified;
        if (_namesEth(params)) {
            tax = _taxOnNamedEth(params, rate);
            if (int256(delta.amount0()) != params.amountSpecified + int256(tax)) revert PartialFill();
        } else {
            int128 eth = delta.amount0();
            // A buy pays ETH into the pool (negative delta) and the tax comes on top of it. A sell
            // takes ETH out of the pool (positive delta) and the tax comes out of it.
            tax = buy ? uint256(uint128(-eth)) * rate / (BPS - rate) : uint256(uint128(eth)) * rate / BPS;
            unspecified = tax.toInt128();
        }

        if (tax != 0) {
            totalTax += tax;
            emit Taxed(sender, buy, tax, rate);
            // Minting claims debits the hook; the positive hook delta the PoolManager books after this
            // callback cancels that debit.
            poolManager.mint(address(this), ETH_CLAIM_ID, tax);
        }
        return (IHooks.afterSwap.selector, unspecified);
    }

    // ------------------------------------------------------------------ flushing

    /// @notice Converts every collected claim to ETH and hands it to the sink. Anyone may call.
    function flush() external returns (uint256 amount) {
        uint256 claims = poolManager.balanceOf(address(this), ETH_CLAIM_ID);
        if (claims == 0) revert NothingToFlush();
        poolManager.unlock(abi.encode(claims));
        amount = address(this).balance;
        emit Flushed(amount);
        ITaxSink(sink).depositTax{value: amount}();
    }

    /// @inheritdoc IUnlockCallback
    /// @dev Reached only through `flush`. Burning the hook's claims credits it; taking the same amount
    /// of ETH settles that credit.
    function unlockCallback(bytes calldata data) external onlyPoolManager returns (bytes memory) {
        uint256 claims = abi.decode(data, (uint256));
        poolManager.burn(address(this), ETH_CLAIM_ID, claims);
        poolManager.take(CurrencyLibrary.ADDRESS_ZERO, address(this), claims);
        return "";
    }

    // ------------------------------------------------------------------ owner

    /// @notice Lower the standing tax. It can never be raised.
    function lowerTax(uint16 newTaxBps) external {
        if (msg.sender != owner) revert NotOwner();
        if (newTaxBps >= taxBps) revert NotLower();
        taxBps = newTaxBps;
        emit TaxLowered(newTaxBps);
    }

    function transferOwnership(address to) external {
        if (msg.sender != owner) revert NotOwner();
        if (to == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, to);
        owner = to;
    }

    // ------------------------------------------------------------------ internals

    /// @dev Only the launch pool is taxed, and never the sink's own swaps.
    function _taxed(address sender, PoolKey calldata key) private view returns (bool) {
        return sender != sink && PoolId.unwrap(key.toId()) == PoolId.unwrap(launchPool);
    }

    /// @dev ETH is currency0, so the trader names the ETH amount exactly when the swap is an
    /// exact-input buy or an exact-output sell.
    function _namesEth(SwapParams calldata params) private pure returns (bool) {
        return (params.amountSpecified < 0) == params.zeroForOne;
    }

    function _rate(bool buy) private view returns (uint256) {
        return buy ? buyTaxBps() : taxBps;
    }

    /// @dev Exact-input buy: the trader names the gross ETH they pay, and the tax is a share of it.
    /// Exact-output sell: the trader names the net ETH they receive, and the pool pays that plus the
    /// tax, so the tax is the same share of the gross.
    function _taxOnNamedEth(SwapParams calldata params, uint256 rate) private pure returns (uint256) {
        if (params.zeroForOne) return uint256(-params.amountSpecified) * rate / BPS;
        return uint256(params.amountSpecified) * rate / (BPS - rate);
    }
}
```

- [ ] **Step 5: Run the tests**

Run: `forge test --match-contract PupateHookTest`
Expected: 35 passed.

- [ ] **Step 6: Format and commit**

```bash
forge fmt
git add -A
git commit -m "feat: add PupateHook with standing tax and launch schedule"
```

---

### Task 6: Stateful invariants for the hook

**Files:**
- Create: `test/utils/Trader.sol`
- Test: `test/PupateHook.invariant.t.sol`

**Interfaces:**
- Consumes: `HookFixture`, `PupateHook`, `PoolRouter`.
- Produces: `contract Trader` (invariant handler) with `buyExactIn`, `buyExactOut`, `sellExactIn`, `sellExactOut`, `flush`, `wait`, `lowerTax`, `uint256 public previousTax` and `uint256 public swapsDone`.

- [ ] **Step 1: Write the handler**

`foundry.toml` sets `fail_on_revert = true`, so the handler never reverts: swaps and flushes that would fail are caught.

File: `test/utils/Trader.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {StdUtils} from "forge-std/StdUtils.sol";
import {Vm} from "forge-std/Vm.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {PupateHook} from "../../src/PupateHook.sol";
import {PoolRouter} from "./PoolRouter.sol";

/// @dev Invariant handler: trades the launch pool in all four swap modes, flushes, lets time pass and
/// lowers the tax. Every action records the standing tax it started from.
contract Trader is StdUtils {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    PoolRouter private immutable router;
    PupateHook private immutable hook;
    address private immutable owner;
    PoolKey private key;

    uint256 public previousTax;
    uint256 public swapsDone;

    constructor(PoolRouter router_, PupateHook hook_, PoolKey memory key_, address owner_) {
        router = router_;
        hook = hook_;
        key = key_;
        owner = owner_;
        previousTax = hook_.taxBps();
    }

    receive() external payable {}

    function buyExactIn(uint256 ethIn) external {
        _begin();
        _trySwap(true, -int256(bound(ethIn, 1e9, 50 ether)));
    }

    function buyExactOut(uint256 tokensOut) external {
        _begin();
        _trySwap(true, int256(bound(tokensOut, 1 ether, 5_000_000 ether)));
    }

    function sellExactIn(uint256 tokensIn) external {
        _begin();
        _trySwap(false, -int256(bound(tokensIn, 1 ether, 5_000_000 ether)));
    }

    function sellExactOut(uint256 ethOut) external {
        _begin();
        _trySwap(false, int256(bound(ethOut, 1e9, 1 ether)));
    }

    function flush() external {
        _begin();
        try hook.flush() {} catch {}
    }

    function wait(uint256 time) external {
        _begin();
        vm.warp(block.timestamp + bound(time, 1, 30 minutes));
    }

    function lowerTax(uint256 drop) external {
        _begin();
        uint256 current = hook.taxBps();
        if (current == 0) return;
        vm.prank(owner);
        hook.lowerTax(uint16(current - bound(drop, 1, current)));
    }

    function _begin() private {
        previousTax = hook.taxBps();
    }

    function _trySwap(bool zeroForOne, int256 amountSpecified) private {
        uint160 limit = zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1;
        uint256 value = zeroForOne ? address(this).balance : 0;
        try router.swap{value: value}(key, SwapParams(zeroForOne, amountSpecified, limit)) {
            ++swapsDone;
        } catch {}
    }
}
```

- [ ] **Step 2: Write the invariants**

File: `test/PupateHook.invariant.t.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {HookFixture} from "./utils/HookFixture.sol";
import {Trader} from "./utils/Trader.sol";

contract PupateHookInvariantTest is HookFixture {
    Trader internal trader;

    function setUp() public override {
        super.setUp();
        trader = new Trader(router, hook, key, owner);
        token.transfer(address(trader), 100_000_000 ether);
        vm.prank(address(trader));
        token.approve(address(router), type(uint256).max);
        vm.deal(address(trader), 100_000 ether);
        targetContract(address(trader));
    }

    /// @dev A handler whose actions all fail quietly would make every invariant below hold for nothing.
    function test_theHandlerActuallyTrades() public {
        trader.buyExactIn(1 ether);
        trader.buyExactOut(1_000_000 ether);
        trader.sellExactIn(1_000_000 ether);
        trader.sellExactOut(1e12);
        assertEq(trader.swapsDone(), 4);
        assertGt(hook.totalTax(), 0);

        trader.flush();
        assertEq(sink.deposited(), hook.totalTax());
    }

    function invariant_everyWeiOfTaxIsHeldAsClaimsOrDeliveredToTheSink() public view {
        assertEq(manager.balanceOf(address(hook), 0) + sink.deposited(), hook.totalTax());
    }

    function invariant_theHookHoldsNoEth() public view {
        assertEq(address(hook).balance, 0);
    }

    function invariant_theStandingTaxNeverRises() public view {
        assertLe(hook.taxBps(), trader.previousTax());
    }
}
```

- [ ] **Step 3: Run the invariants**

Run: `forge test --match-contract PupateHookInvariantTest`
Expected: 4 passed. The three invariants each run 48 times over 48 calls; `test_theHandlerActuallyTrades` proves the handler's swaps succeed, so the invariants are not holding for nothing.

- [ ] **Step 4: Run everything and commit**

Run: `forge fmt && forge test`
Expected: all suites pass.

```bash
git add -A
git commit -m "test: add stateful invariants for PupateHook"
```

---

### Task 7: Review fixes

Done after an independent review of Tasks 2 to 6; the findings and outcomes are in `docs/REVIEW.md`.

**Files:**
- Modify: `src/FloorFeed.sol`, `test/FloorFeed.t.sol` (rewritten), `test/PupateHook.t.sol` (tests appended)
- Modify: `docs/superpowers/specs/2026-10-06-pupate-design.md` (revision 3), `docs/phase0-findings.md`
- Create: `docs/REVIEW.md`

**Interfaces:**
- Changes: `FloorFeed` constructor is now `(address owner_, address attester_, uint256 evidenceChainId_)`; new `EVIDENCE_CHAIN_ID`, `MAX_RISE_BPS`, `RISE_WINDOW`, `MIN_QUORUM`, `BPS` constants; new error `ShortLived`; `setQuestion` clears the stored report and emits `Reported(0, 0, 0)`.

- [x] **Step 1: Replace the freshness-gated move cap with a rise limit that always applies**

In `report`, after decoding `next`:

```solidity
        uint256 prev = floorWei;
        if (previousIssuedAt != 0 && next > prev) {
            uint256 gap = a.issuedAt - previousIssuedAt;
            uint256 allowedRise = FullMath.mulDiv(prev, MAX_RISE_BPS * gap, RISE_WINDOW * BPS);
            if (next - prev > allowedRise) revert MoveTooLarge();
        }
```

- [x] **Step 2: Check the evidence chain, the panel and the validity**

```solidity
        if (a.chainId != EVIDENCE_CHAIN_ID) revert WrongChain();
        if (
            a.quorum < MIN_QUORUM || uint256(a.quorum) * 2 <= a.panelSize || a.agreed < a.quorum
                || a.agreed > a.panelSize
        ) revert NoQuorum();
        uint64 age = maxAge;
        if (a.expiresAt < a.issuedAt || a.expiresAt - a.issuedAt < age) revert ShortLived();
        if (a.issuedAt > block.timestamp || block.timestamp > uint256(a.issuedAt) + age) revert Expired();
```

- [x] **Step 3: Clear the stored report when the question is set**

```solidity
        questionHash = questionHash_;
        delete floorWei;
        delete issuedAt;
        delete expiresAt;
        emit QuestionSet(questionHash_);
        emit Reported(0, 0, 0);
```

- [x] **Step 4: Rewrite `test/FloorFeed.t.sol` around the new rules and append the hook tests**

Run: `forge test`
Expected: all suites pass; FloorFeed has 44 tests, the hook 41.

- [x] **Step 5: Commit**

```bash
git add -A
git commit -m "fix: rate-limit FloorFeed rises and pin the attestation's panel and chain"
```

---

### Task 8: Liquidity gate

Adopted after the review's second finding (`docs/REVIEW.md`): trades made by resting liquidity escaped the tax. Approved by the project owner on 2026-10-06.

**Files:**
- Modify: `src/PupateHook.sol`, `test/utils/HookFixture.sol` (flags `0x18CC`, `_hookRevertFrom`), `test/utils/PoolSetup.sol` (records the seeded position), `test/PupateHook.t.sol`

**Interfaces:**
- Changes: `PupateHook` gains `beforeAddLiquidity`, `uint40 public openedAtBlock` and `error LiquidityClosed()`; `getHookPermissions()` sets `beforeAddLiquidity`; the launch manifest's `permissions` list gains `beforeAddLiquidity`.

- [x] **Step 1: Record the opening block and gate liquidity**

```solidity
    function beforeAddLiquidity(address, PoolKey calldata key, ModifyLiquidityParams calldata, bytes calldata)
        external
        view
        onlyPoolManager
        returns (bytes4)
    {
        uint256 opened = openedAtBlock;
        if (opened == 0 || block.number != opened || PoolId.unwrap(key.toId()) != PoolId.unwrap(launchPool)) {
            revert LiquidityClosed();
        }
        return IHooks.beforeAddLiquidity.selector;
    }
```

- [x] **Step 2: Tests**

Liquidity can be added in the opening block and not after; it can still be removed after; no pool on the hook takes liquidity before the launch pool opens; a second native pool on the hook takes none. The fixture mines `0x18CC`.

Run: `forge test`
Expected: all suites pass; the hook suite has 44 tests.

- [x] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: admit liquidity only in the block the launch pool opens"
```
