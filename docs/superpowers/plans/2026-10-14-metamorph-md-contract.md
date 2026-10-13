# Metamorph MD Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `MetamorphMD`, the ERC-721 that is mined with the WORKERS-style work chain, paid in PUPATE, splits every fee 70/30 between a reward pot converted to IMD for stakers and the developer, runs the vault's duties from inside a mint, and tells a chrysalis from a butterfly by reading Cocoon; with unit, fuzz, invariant and mainnet-fork tests and a deploy script.

**Architecture:** One contract (`MetamorphMD`) on a hand-rolled ERC-721 base (`ERC721Lite`), reading the launched `Cocoon`, `PupateHook`, `PupateToken` and the identity.md collection, swapping through Uniswap v4's `PoolManager` in its own `unlockCallback` (PUPATE → ETH in the hooked launch pool, ETH → IMD in the hookless ETH/IMD pool). The image and the token JSON come from a separate `IMetamorphArt` contract (built in the next plan; a stub serves the tests). No owner, no setters: every number is a constant or an immutable.

**Tech Stack:** Solidity 0.8.26 (cancun, forge 1.7.1 locally, IMD builds with 1.8.3), Foundry tests on the existing `CocoonFixture` (real `PoolManager`, real hook, mock collection/Seaport/IMD), v4-core libraries already vendored, no OpenZeppelin (the vendored tree only has `IERC721Receiver`).

**Spec:** `docs/superpowers/specs/2026-10-13-metamorph-md-design.md` (v2). The plan argues from it; where the plan deviates, Task 12 records the erratum in the spec.

## Global Constraints

- English only in code, names, comments, commit messages (chat with the owner is Indonesian).
- Never add a privileged key: no owner, setter, pause, upgrade, withdraw in any Metamorph contract.
- The launched contracts under `src/` are frozen; Metamorph only calls their public functions.
- Commit messages carry no `Co-Authored-By` line; the git identity is already the repo's (`pupate-IMD`); never push, never run a mainnet transaction, never print keys or RPC URLs.
- `forge test` must stay green for the whole suite (245 tests before this plan) at every commit; new tests live under `test/metamorph/`.
- Both new contracts must be under 24,576 bytes of runtime code (`forge build --sizes`), checked by a test.
- Constants from the spec, verbatim: `EDITIONS 303`, `MAX_SUPPLY 3333`, `EPOCH 303` mints, `BASE_PRICE 50_000 ether`, price ×1.25 per epoch, `TARGET_INTERVAL 90` s, retarget clamp ÷4..×4 per mint, floor `minBits + epoch − 1` bits (`minBits` constructor, 20 on mainnet, 1 in tests), `ANCHOR_WINDOW 50` blocks, gilt `work < target >> 4`, fee split 70% pot / 30% `Cocoon.developer()`, `CONVERT_IMPACT_BPS 500`, `CALLER_REWARD_BPS 50`, `DUTY_MAX_BASEFEE 2 gwei`, `MIN_FLUSH 0.005 ether`, `MIN_BURN 0.01 ether`, `MIN_CONVERT = 2 × mintPrice()`, butterfly ceiling `90 days` from the mint, staking weights chrysalis 1 / butterfly 2, royalty `500` bps, `DOMAIN = keccak256("Metamorph MD work v1")`.
- ERC-721 `name` "Metamorph MD", `symbol` "MMD"; token ids start at 1 in mint order.

## Review Focus

Inputs the spec implies but no obvious test exercises, each pinned to a task below:

1. A proof found against the previous `prevWork` is sent after someone else's mint landed: it must revert with `NotASolution`, never mint, never take a fee (Task 3, `test_proofFromBeforeAnotherMintIsRefused`).
2. The vault sells the only mineable seat between the miner's job and the mint, or buys it back as a new round: the mint must revert `NothingMineable`, and after the re-buy the new round starts its editions at 1 (Task 3, `test_reboughtSeatStartsItsOwnEditions`).
3. A card is transferred while staked (direct call, approved operator, `safeTransferFrom`): every path reverts `Staked` (Task 5, `test_stakedCardCannotMoveByAnyPath`).
4. `convert()` when the pools can only absorb part of the pot under the 5% bound: it sells what it can, keeps the rest in the pot, and the ETH the IMD pool could not absorb waits in `ethPot` for the next call, so the contract's ETH equals `ethPot` after every call (Task 6, `test_convertLeavesWhatTheBoundRefuses`).
5. A duty that reverts inside the mint (Cocoon's `burn` with `TooSoon`, or a `convert` that finds nothing to buy) must not revert the mint, and the miner must still get the card (Task 7, `test_failingDutyNeverRevertsTheMint`).

---

## File structure

| File | Responsibility |
|---|---|
| `src/metamorph/ERC721Lite.sol` | the ERC-721 Metamorph needs: ownership, approvals, safe transfers, ERC-165, a `_beforeTransfer` hook |
| `src/interfaces/IMetamorphArt.sol` | `View` struct and `tokenURI(View)`: what the art contract renders for a card |
| `src/metamorph/MetamorphMD.sol` | the work chain, the mint, the seat registry, fees, pot, `convert`, staking, duties, stages, royalty |
| `test/mocks/StubArt.sol` | an `IMetamorphArt` that returns a fixed data URI |
| `test/metamorph/MetamorphFixture.sol` | `CocoonFixture` + the ETH/IMD pool, the stub art, the contract at `minBits = 1`, proof and seat helpers |
| `test/metamorph/MetamorphHarness.sol` | the contract with one test-only entry (`creditForTests`) to drive the staking accumulator |
| `test/metamorph/ERC721Lite.t.sol`, `MetamorphViews.t.sol`, `MetamorphMint.t.sol`, `MetamorphStages.t.sol`, `MetamorphStaking.t.sol`, `MetamorphConvert.t.sol`, `MetamorphDuties.t.sol`, `Metamorph.invariant.t.sol`, `MetamorphSize.t.sol` | one suite per concern |
| `test/fork/Metamorph.fork.t.sol` | the whole flow against mainnet's real contracts and pools |
| `script/DeployMetamorph.s.sol` | deploys `MetamorphMD` against an already deployed art contract |

Run commands (Windows, Git Bash): `forge test --match-path "test/metamorph/*" -vv` for the suites, `forge test --match-contract <Name> -vv` for one, `forge build --sizes 2>/dev/null | grep -i metamorph` for sizes. Forge lives at `~/.foundry/bin/forge.exe` if not on PATH.

---

### Task 1: ERC721Lite

**Files:**
- Create: `src/metamorph/ERC721Lite.sol`
- Test: `test/metamorph/ERC721Lite.t.sol`

**Interfaces:**
- Produces: `abstract contract ERC721Lite` with `constructor(string name_, string symbol_)`, `ownerOf(uint256)`, `balanceOf(address)`, `getApproved(uint256)`, `isApprovedForAll(address,address)`, `approve`, `setApprovalForAll`, `transferFrom`, two `safeTransferFrom`, `supportsInterface(bytes4) virtual`, `tokenURI(uint256) virtual`, `_mint(address,uint256)` (with the receiver check), `_beforeTransfer(uint256) virtual`, errors `NotOwner NotAuthorized ZeroAddress AlreadyMinted NotMinted UnsafeRecipient`.

- [ ] **Step 1: Write the failing tests**

```solidity
// test/metamorph/ERC721Lite.t.sol
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {ERC721Lite} from "../../src/metamorph/ERC721Lite.sol";

contract Lite is ERC721Lite {
    bool public blockTransfers;

    constructor() ERC721Lite("Lite", "LT") {}

    function mint(address to, uint256 id) external {
        _mint(to, id);
    }

    function setBlock(bool v) external {
        blockTransfers = v;
    }

    function tokenURI(uint256) public pure override returns (string memory) {
        return "uri";
    }

    function _beforeTransfer(uint256) internal view override {
        require(!blockTransfers, "blocked");
    }
}

contract Receiver {
    bytes4 public answer = 0x150b7a02;

    function setAnswer(bytes4 a) external {
        answer = a;
    }

    function onERC721Received(address, address, uint256, bytes calldata) external view returns (bytes4) {
        return answer;
    }
}

contract ERC721LiteTest is Test {
    Lite lite;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        lite = new Lite();
    }

    function test_mintSetsOwnerBalanceAndEmits() public {
        vm.expectEmit(true, true, true, true);
        emit ERC721Lite.Transfer(address(0), alice, 1);
        lite.mint(alice, 1);
        assertEq(lite.ownerOf(1), alice);
        assertEq(lite.balanceOf(alice), 1);
    }

    function test_mintRefusesZeroAndDuplicates() public {
        vm.expectRevert(ERC721Lite.ZeroAddress.selector);
        lite.mint(address(0), 1);
        lite.mint(alice, 1);
        vm.expectRevert(ERC721Lite.AlreadyMinted.selector);
        lite.mint(bob, 1);
    }

    function test_ownerOfUnmintedReverts() public {
        vm.expectRevert(ERC721Lite.NotMinted.selector);
        lite.ownerOf(7);
    }

    function test_transferByOwnerApprovedAndOperator() public {
        lite.mint(alice, 1);
        lite.mint(alice, 2);
        lite.mint(alice, 3);
        vm.prank(alice);
        lite.transferFrom(alice, bob, 1);
        assertEq(lite.ownerOf(1), bob);
        vm.prank(alice);
        lite.approve(bob, 2);
        vm.prank(bob);
        lite.transferFrom(alice, bob, 2);
        assertEq(lite.getApproved(2), address(0), "approval cleared");
        vm.prank(alice);
        lite.setApprovalForAll(bob, true);
        vm.prank(bob);
        lite.transferFrom(alice, bob, 3);
        assertEq(lite.balanceOf(alice), 0);
        assertEq(lite.balanceOf(bob), 3);
    }

    function test_transferRefusesStrangersWrongFromAndZeroTo() public {
        lite.mint(alice, 1);
        vm.prank(bob);
        vm.expectRevert(ERC721Lite.NotAuthorized.selector);
        lite.transferFrom(alice, bob, 1);
        vm.prank(alice);
        vm.expectRevert(ERC721Lite.NotOwner.selector);
        lite.transferFrom(bob, alice, 1);
        vm.prank(alice);
        vm.expectRevert(ERC721Lite.ZeroAddress.selector);
        lite.transferFrom(alice, address(0), 1);
    }

    function test_safeTransferChecksTheReceiver() public {
        Receiver good = new Receiver();
        lite.mint(alice, 1);
        vm.prank(alice);
        lite.safeTransferFrom(alice, address(good), 1);
        assertEq(lite.ownerOf(1), address(good));
        Receiver bad = new Receiver();
        bad.setAnswer(0xdeadbeef);
        lite.mint(alice, 2);
        vm.prank(alice);
        vm.expectRevert(ERC721Lite.UnsafeRecipient.selector);
        lite.safeTransferFrom(alice, address(bad), 2);
        vm.prank(alice);
        vm.expectRevert(ERC721Lite.UnsafeRecipient.selector);
        lite.safeTransferFrom(alice, address(bad), 2, "x");
    }

    function test_mintToContractWithoutReceiverReverts() public {
        vm.expectRevert(ERC721Lite.UnsafeRecipient.selector);
        lite.mint(address(this), 1);
    }

    function test_hookRunsBeforeEveryTransferButNotOnMint() public {
        lite.setBlock(true);
        lite.mint(alice, 1);
        vm.prank(alice);
        vm.expectRevert("blocked");
        lite.transferFrom(alice, bob, 1);
        vm.prank(alice);
        vm.expectRevert("blocked");
        lite.safeTransferFrom(alice, bob, 1);
    }

    function test_supportsTheThreeInterfaces() public view {
        assertTrue(lite.supportsInterface(0x01ffc9a7));
        assertTrue(lite.supportsInterface(0x80ac58cd));
        assertTrue(lite.supportsInterface(0x5b5e139f));
        assertFalse(lite.supportsInterface(0xffffffff));
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `forge test --match-contract ERC721LiteTest -vv`
Expected: compilation error, `ERC721Lite` not found.

- [ ] **Step 3: Write the contract**

```solidity
// src/metamorph/ERC721Lite.sol
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IERC721TokenReceiver {
    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata data)
        external
        returns (bytes4);
}

/// @notice The part of ERC-721 that Metamorph MD needs, with a hook before every transfer so a staked
/// card can refuse to move. Hand-rolled like the rest of this repository (no OpenZeppelin vendored).
abstract contract ERC721Lite {
    error NotOwner();
    error NotAuthorized();
    error ZeroAddress();
    error AlreadyMinted();
    error NotMinted();
    error UnsafeRecipient();

    event Transfer(address indexed from, address indexed to, uint256 indexed id);
    event Approval(address indexed owner, address indexed spender, uint256 indexed id);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);

    string public name;
    string public symbol;

    mapping(uint256 id => address) internal _owner;
    mapping(address owner => uint256) public balanceOf;
    mapping(uint256 id => address) public getApproved;
    mapping(address owner => mapping(address operator => bool)) public isApprovedForAll;

    constructor(string memory name_, string memory symbol_) {
        name = name_;
        symbol = symbol_;
    }

    function ownerOf(uint256 id) public view returns (address owner) {
        owner = _owner[id];
        if (owner == address(0)) revert NotMinted();
    }

    function tokenURI(uint256 id) public view virtual returns (string memory);

    function approve(address spender, uint256 id) external {
        address owner = ownerOf(id);
        if (msg.sender != owner && !isApprovedForAll[owner][msg.sender]) revert NotAuthorized();
        getApproved[id] = spender;
        emit Approval(owner, spender, id);
    }

    function setApprovalForAll(address operator, bool approved) external {
        isApprovedForAll[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function transferFrom(address from, address to, uint256 id) public {
        if (from != _owner[id]) revert NotOwner();
        if (to == address(0)) revert ZeroAddress();
        if (msg.sender != from && !isApprovedForAll[from][msg.sender] && msg.sender != getApproved[id]) {
            revert NotAuthorized();
        }
        _beforeTransfer(id);
        unchecked {
            balanceOf[from]--;
            balanceOf[to]++;
        }
        _owner[id] = to;
        delete getApproved[id];
        emit Transfer(from, to, id);
    }

    function safeTransferFrom(address from, address to, uint256 id) external {
        transferFrom(from, to, id);
        _checkReceiver(from, to, id, "");
    }

    function safeTransferFrom(address from, address to, uint256 id, bytes calldata data) external {
        transferFrom(from, to, id);
        _checkReceiver(from, to, id, data);
    }

    function supportsInterface(bytes4 interfaceId) public view virtual returns (bool) {
        return interfaceId == 0x01ffc9a7 || interfaceId == 0x80ac58cd || interfaceId == 0x5b5e139f;
    }

    /// @dev Mints and, when `to` is a contract, requires it to accept, so a card never lands where it
    /// cannot move again.
    function _mint(address to, uint256 id) internal {
        if (to == address(0)) revert ZeroAddress();
        if (_owner[id] != address(0)) revert AlreadyMinted();
        unchecked {
            balanceOf[to]++;
        }
        _owner[id] = to;
        emit Transfer(address(0), to, id);
        _checkReceiver(address(0), to, id, "");
    }

    /// @dev Runs before a transfer moves anything; a revert here stops the transfer.
    function _beforeTransfer(uint256 id) internal virtual {}

    function _checkReceiver(address from, address to, uint256 id, bytes memory data) private {
        if (to.code.length == 0) return;
        try IERC721TokenReceiver(to).onERC721Received(msg.sender, from, id, data) returns (bytes4 answer) {
            if (answer != IERC721TokenReceiver.onERC721Received.selector) revert UnsafeRecipient();
        } catch {
            revert UnsafeRecipient();
        }
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `forge test --match-contract ERC721LiteTest -vv`
Expected: 9 passed.

- [ ] **Step 5: Commit**

```bash
git add src/metamorph/ERC721Lite.sol test/metamorph/ERC721Lite.t.sol
git commit -m "metamorph: ERC721Lite, the token base with a hook before every transfer"
```

---

### Task 2: The art interface, the fixture, and the contract's views

**Files:**
- Create: `src/interfaces/IMetamorphArt.sol`, `test/mocks/StubArt.sol`, `src/metamorph/MetamorphMD.sol` (skeleton: storage, constants, constructor, views, seat registry), `test/metamorph/MetamorphFixture.sol`
- Test: `test/metamorph/MetamorphViews.t.sol`

**Interfaces:**
- Consumes: `ERC721Lite` (Task 1); `Cocoon` (`seats(uint256)` returns `(uint128 cost, uint40 boughtAt, uint16 startX, uint16 endX, uint32 decay, bool held, uint16 round)`, `developer()`, `burnPot()`, `lastBurnBlock()`, `wired()`, `getParams()`, `burn()`), `PupateHook.flush()`, `IPoolManager`, `PoolKey`.
- Produces: `IMetamorphArt.View`, `IMetamorphArt.tokenURI(View) view returns (string)`; `MetamorphMD` constants and views: `DOMAIN`, `EDITIONS`, `MAX_SUPPLY`, `EPOCH`, `BASE_PRICE`, `TARGET_INTERVAL`, `ANCHOR_WINDOW`, `MIN_BITS`, `target()`, `bits()`, `prevWork()`, `lastMintAt()`, `totalMinted()`, `epoch()`, `mintPrice()`, `workHash(bytes32,address,uint256)`, `anchorHash(uint256)`, `noteSeat(uint256)`, `mineableSeats()`, `notedSeats()`, `editionsMinted(uint256,uint16)`; fixture fields `md`, `art`, `imdKey`, `miner`, `other`, helpers `_anchor()`, `_proof(address,uint256)`, `_mintAs(address)`, `_sell(uint256)`.

- [ ] **Step 1: Write the art interface and the stub**

```solidity
// src/interfaces/IMetamorphArt.sol
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice What Metamorph MD hands its art contract for one card, and what it gets back: the whole
/// token URI (JSON with the image inside), so the card contract carries no drawing or JSON code.
interface IMetamorphArt {
    struct View {
        uint256 id;
        uint256 seat;
        uint16 round;
        uint16 edition;
        /// 0 chrysalis, 1 butterfly
        uint8 stage;
        bool gilt;
        uint16 epoch;
        address miner;
        uint40 mintedAt;
        /// the mint price paid, in PUPATE wei
        uint256 paid;
    }

    function tokenURI(View calldata v) external view returns (string memory);
}
```

```solidity
// test/mocks/StubArt.sol
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IMetamorphArt} from "../../src/interfaces/IMetamorphArt.sol";

/// @dev Stands in for the renderer: echoes the facts it was given so tests can read them back.
contract StubArt is IMetamorphArt {
    function tokenURI(View calldata v) external pure returns (string memory) {
        return string.concat(
            "stub:",
            _u(v.id), ":", _u(v.seat), ":", _u(v.round), ":", _u(v.edition), ":", _u(v.stage), ":",
            v.gilt ? "gilt" : "plain", ":", _u(v.epoch), ":", _u(v.paid)
        );
    }

    function _u(uint256 x) private pure returns (string memory s) {
        if (x == 0) return "0";
        bytes memory b;
        while (x != 0) {
            b = abi.encodePacked(uint8(48 + x % 10), b);
            x /= 10;
        }
        return string(b);
    }
}
```

- [ ] **Step 2: Write the failing view tests**

```solidity
// test/metamorph/MetamorphViews.t.sol
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MetamorphFixture} from "./MetamorphFixture.sol";
import {MetamorphMD} from "../../src/metamorph/MetamorphMD.sol";

contract MetamorphViewsTest is MetamorphFixture {
    function test_constantsMatchTheSpec() public view {
        assertEq(md.EDITIONS(), 303);
        assertEq(md.MAX_SUPPLY(), 3333);
        assertEq(md.EPOCH(), 303);
        assertEq(md.BASE_PRICE(), 50_000 ether);
        assertEq(md.TARGET_INTERVAL(), 90);
        assertEq(md.ANCHOR_WINDOW(), 50);
        assertEq(md.DOMAIN(), keccak256("Metamorph MD work v1"));
        assertEq(md.MIN_BITS(), 1);
        assertEq(md.name(), "Metamorph MD");
        assertEq(md.symbol(), "MMD");
    }

    function test_startsAtTheFirstEpochCeiling() public view {
        assertEq(md.target(), type(uint256).max >> 1);
        assertEq(md.bits(), 1);
        assertEq(md.prevWork(), md.DOMAIN());
        assertEq(md.lastMintAt(), block.timestamp);
        assertEq(md.totalMinted(), 0);
        assertEq(md.epoch(), 1);
    }

    function test_priceStepsOnceEveryEpoch() public view {
        assertEq(md.priceAt(1), 50_000 ether);
        assertEq(md.priceAt(2), 62_500 ether);
        assertEq(md.priceAt(3), 78_125 ether);
        assertEq(md.priceAt(11), 465_661_287_307_739_257_812_500);
        assertEq(md.mintPrice(), 50_000 ether);
    }

    function test_workHashIsTheSpecsPreimage() public view {
        bytes32 ah = blockhash(block.number - 1);
        assertTrue(ah != bytes32(0), "forge gives recent blocks a hash");
        bytes32 expected = keccak256(
            abi.encode(md.DOMAIN(), block.chainid, address(md), keccak256(abi.encode(ah, md.prevWork())), miner, uint256(7))
        );
        assertEq(md.workHash(ah, miner, 7), expected);
        assertEq(md.anchorHash(block.number - 1), ah);
        assertEq(md.anchorHash(block.number), bytes32(0), "the current block has no hash yet");
    }

    function test_seatRegistryOnlyTakesSeatsTheVaultHolds() public {
        assertEq(md.notedSeats().length, 1);
        assertEq(md.mineableSeats()[0], 1376);
        vm.expectRevert(MetamorphMD.SeatNotHeld.selector);
        md.noteSeat(99);
        collection.mint(seller, 99);
        vm.expectRevert(MetamorphMD.SeatNotHeld.selector);
        md.noteSeat(99);
        _giveSeat(42);
        md.noteSeat(42);
        md.noteSeat(42); // twice is fine, noted once
        assertEq(md.notedSeats().length, 2);
        assertEq(md.mineableSeats().length, 2);
    }

    function test_soldSeatLeavesTheMineableListButStaysNoted() public {
        _sell(1376);
        assertEq(md.notedSeats().length, 1);
        assertEq(md.mineableSeats().length, 0);
    }
}
```

- [ ] **Step 3: Write the fixture**

```solidity
// test/metamorph/MetamorphFixture.sol
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {FixedPoint96} from "v4-core/src/libraries/FixedPoint96.sol";
import {FullMath} from "v4-core/src/libraries/FullMath.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {Currency, CurrencyLibrary} from "v4-core/src/types/Currency.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {IERC20Minimal} from "../../src/interfaces/IERC20Minimal.sol";
import {IERC721Minimal} from "../../src/interfaces/IERC721Minimal.sol";
import {IMetamorphArt} from "../../src/interfaces/IMetamorphArt.sol";
import {MetamorphMD} from "../../src/metamorph/MetamorphMD.sol";
import {StubArt} from "../mocks/StubArt.sol";
import {CocoonFixture} from "../utils/CocoonFixture.sol";

/// @dev The vault fixture plus an ETH/IMD pool (1 ETH = 256 IMD, 100 ETH deep, no hook), the stub
/// art, and Metamorph MD at a one-bit floor so a proof is found in a handful of hashes. The vault holds
/// seat 1376 from the start and the miner holds 100M PUPATE, approved.
abstract contract MetamorphFixture is CocoonFixture {
    uint24 internal constant IMD_FEE = 10_000;
    int24 internal constant IMD_SPACING = 200;
    /// sqrt(256) * 2^96
    uint160 internal constant IMD_SQRT_PRICE = uint160(16 * FixedPoint96.Q96);

    StubArt internal art;
    MetamorphMD internal md;
    PoolKey internal imdKey;
    address internal miner = makeAddr("miner");
    address internal other = makeAddr("other");

    function setUp() public virtual override {
        super.setUp();
        vm.roll(block.number + 60);

        imdKey = PoolKey(CurrencyLibrary.ADDRESS_ZERO, Currency.wrap(address(imd)), IMD_FEE, IMD_SPACING, IHooks(address(0)));
        imd.mint(address(this), 10_000_000 ether);
        imd.approve(address(router), type(uint256).max);
        int24 lower = TickMath.minUsableTick(IMD_SPACING);
        int24 upper = TickMath.maxUsableTick(IMD_SPACING);
        // Full range: about 100 ETH on one side and 25,600 IMD on the other at the opening price.
        uint256 liquidity = FullMath.mulDiv(100 ether, IMD_SQRT_PRICE, FixedPoint96.Q96);
        router.open{value: 101 ether}(imdKey, IMD_SQRT_PRICE, ModifyLiquidityParams(lower, upper, int256(liquidity), bytes32(0)));

        art = new StubArt();
        md = _deploy(1);

        _setFloor(2 ether);
        _giveSeat(1376);
        md.noteSeat(1376);

        token.transfer(miner, 100_000_000 ether);
        vm.prank(miner);
        token.approve(address(md), type(uint256).max);
        vm.deal(miner, 10 ether);
    }

    function _deploy(uint8 minBits) internal virtual returns (MetamorphMD) {
        return new MetamorphMD(
            cocoon,
            hook,
            token,
            IERC20Minimal(address(imd)),
            IERC721Minimal(address(collection)),
            manager,
            key,
            imdKey,
            IMetamorphArt(address(art)),
            minBits
        );
    }

    function _anchor() internal view returns (uint256) {
        return block.number - 1;
    }

    /// @dev The first nonce whose proof is under the target, for `who` at `anchor`, as the browser does.
    function _proof(address who, uint256 anchor) internal view returns (uint256 nonce) {
        bytes32 ah = blockhash(anchor);
        uint256 t = md.target();
        for (nonce = 1;; nonce++) {
            if (uint256(md.workHash(ah, who, nonce)) < t) return nonce;
        }
    }

    function _mintAs(address who) internal returns (uint256 id) {
        uint256 a = _anchor();
        uint256 n = _proof(who, a);
        vm.prank(who);
        id = md.mint(a, n);
    }

    /// @dev The vault "sells" a seat: it leaves the vault and the books, the way a filled listing ends.
    function _sell(uint256 seat) internal {
        vm.prank(address(cocoon));
        collection.transferFrom(address(cocoon), other, seat);
        cocoon.settleSeat(seat);
    }
}
```

- [ ] **Step 4: Write the contract skeleton with the views and the registry**

```solidity
// src/metamorph/MetamorphMD.sol
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {Cocoon} from "../Cocoon.sol";
import {PupateHook} from "../PupateHook.sol";
import {PupateToken} from "../PupateToken.sol";
import {IERC20Minimal} from "../interfaces/IERC20Minimal.sol";
import {IERC721Minimal} from "../interfaces/IERC721Minimal.sol";
import {IMetamorphArt} from "../interfaces/IMetamorphArt.sol";
import {ERC721Lite} from "./ERC721Lite.sol";

/// @title Metamorph MD
/// @notice 3,333 cards of the identity.md seats Pupate's vault holds, mined in the browser. One valid
/// proof is one mint; the hash picks the seat; the fee is PUPATE, 70% to a pot converted to IMD for the
/// stakers and 30% to the developer; a mint also runs the vault's due duties and pays the miner their
/// rewards. A card is a chrysalis until the vault no longer holds its seat, then a butterfly. No keys.
contract MetamorphMD is ERC721Lite, IUnlockCallback {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    // ------------------------------------------------------------------ errors and events

    error SupplyExhausted();
    error NothingMineable();
    error BadAnchor();
    error NotASolution();
    error SeatNotHeld();
    error Staked();
    error NotStaked();
    error NotCardOwner();
    error NothingToConvert();
    error NothingBought();
    error OnlyPoolManager();
    error OnlySelf();
    error UnexpectedCallback();
    error Reentrancy();
    error TransferFailed();

    event Minted(
        uint256 indexed id,
        uint256 indexed seat,
        uint16 round,
        uint16 edition,
        address indexed miner,
        bytes32 work,
        bool gilt,
        uint256 price,
        uint16 epoch
    );
    event Retargeted(uint256 target);
    event SeatNoted(uint256 indexed seat);
    event Converted(uint256 pupateSold, uint256 ethBought, uint256 imdBought, address indexed caller, uint256 reward);
    event StakedCard(uint256 indexed id, address indexed staker, uint8 weight);
    event Unstaked(uint256 indexed id, address indexed staker);
    event Claimed(address indexed staker, uint256 imd);
    event Reweighed(uint256 indexed id, uint8 weight);
    /// kind: 0 flush, 1 burn, 2 convert; paid: what the miner received for it (ETH wei or IMD wei)
    event DutyRun(uint8 kind, uint256 paid);

    // ------------------------------------------------------------------ constants

    bytes32 public constant DOMAIN = keccak256("Metamorph MD work v1");
    uint16 public constant EDITIONS = 303;
    uint16 public constant MAX_SUPPLY = 3333;
    uint16 public constant EPOCH = 303;
    uint256 public constant BASE_PRICE = 50_000 ether;
    uint256 public constant TARGET_INTERVAL = 90;
    uint256 public constant ANCHOR_WINDOW = 50;
    uint256 public constant STAKER_BPS = 7000;
    uint256 public constant CONVERT_IMPACT_BPS = 500;
    uint256 public constant CALLER_REWARD_BPS = 50;
    uint256 public constant DUTY_MAX_BASEFEE = 2 gwei;
    uint256 public constant MIN_FLUSH = 0.005 ether;
    uint256 public constant MIN_BURN = 0.01 ether;
    uint256 public constant BUTTERFLY_CEILING = 90 days;
    uint256 public constant ROYALTY_BPS = 500;
    uint256 public constant DUTY_GAS = 400_000;
    uint256 public constant CONVERT_GAS = 900_000;
    uint256 private constant BPS = 10_000;
    uint256 private constant ACC = 1e18;
    uint256 private constant LOCK_SLOT = 1;

    // ------------------------------------------------------------------ immutables

    Cocoon public immutable COCOON;
    PupateHook public immutable HOOK;
    PupateToken public immutable PUPATE;
    IERC20Minimal public immutable IMD;
    IERC721Minimal public immutable COLLECTION;
    IPoolManager public immutable POOL_MANAGER;
    IMetamorphArt public immutable ART;
    /// @notice The difficulty floor of epoch one, in bits; it rises one bit per epoch.
    uint8 public immutable MIN_BITS;

    PoolKey internal pupateKey;
    PoolKey internal imdKey;

    // ------------------------------------------------------------------ storage

    struct Card {
        uint32 seat;
        uint16 round;
        uint16 edition;
        bool gilt;
        uint40 mintedAt;
        address miner;
        bytes32 work;
        uint96 paid;
    }

    struct Stake {
        address staker;
        uint8 weight;
        /// weight × accIMDPerWeight at the last settlement (ACC units)
        uint256 debt;
    }

    bytes32 public prevWork;
    uint256 public target;
    uint40 public lastMintAt;
    uint16 public totalMinted;
    mapping(uint256 id => Card) public cards;
    mapping(uint256 seat => mapping(uint16 round => uint16)) public editionsMinted;

    uint256[] private _seats;
    mapping(uint256 seat => bool) public noted;

    /// @notice PUPATE waiting to be converted for the stakers.
    uint256 public pot;
    /// @notice ETH a conversion bought but the IMD pool could not absorb yet; spent by the next one.
    uint256 public ethPot;
    uint256 public accIMDPerWeight;
    uint256 public totalWeight;
    /// @notice IMD credited to stakers and not yet paid out.
    uint256 public imdOwed;
    mapping(uint256 id => Stake) public stakeOf;
    mapping(address staker => uint256) public pendingIMD;

    // ------------------------------------------------------------------ construction

    modifier nonReentrant() {
        if (_tload(LOCK_SLOT) != 0) revert Reentrancy();
        _tstore(LOCK_SLOT, 1);
        _;
        _tstore(LOCK_SLOT, 0);
    }

    constructor(
        Cocoon cocoon_,
        PupateHook hook_,
        PupateToken pupate_,
        IERC20Minimal imd_,
        IERC721Minimal collection_,
        IPoolManager poolManager_,
        PoolKey memory pupateKey_,
        PoolKey memory imdKey_,
        IMetamorphArt art_,
        uint8 minBits_
    ) ERC721Lite("Metamorph MD", "MMD") {
        if (
            address(cocoon_) == address(0) || address(hook_) == address(0) || address(pupate_) == address(0)
                || address(imd_) == address(0) || address(collection_) == address(0)
                || address(poolManager_) == address(0) || address(art_) == address(0)
        ) revert ZeroAddress();
        if (minBits_ == 0 || minBits_ > 200) revert BadAnchor();
        COCOON = cocoon_;
        HOOK = hook_;
        PUPATE = pupate_;
        IMD = imd_;
        COLLECTION = collection_;
        POOL_MANAGER = poolManager_;
        ART = art_;
        MIN_BITS = minBits_;
        pupateKey = pupateKey_;
        imdKey = imdKey_;
        prevWork = DOMAIN;
        target = _ceiling(1);
        lastMintAt = uint40(block.timestamp);
    }

    receive() external payable {}

    // ------------------------------------------------------------------ the work chain, read

    /// @notice The proof the contract computes for a miner's nonce at an anchor; the miner's self-test.
    function workHash(bytes32 anchorHash_, address miner_, uint256 nonce) public view returns (bytes32) {
        return keccak256(
            abi.encode(DOMAIN, block.chainid, address(this), keccak256(abi.encode(anchorHash_, prevWork)), miner_, nonce)
        );
    }

    /// @notice `blockhash` of a block, zero when it is not available.
    function anchorHash(uint256 blockNumber) public view returns (bytes32) {
        return blockhash(blockNumber);
    }

    /// @notice The current epoch, 1 to 11: one per 303 mints.
    function epoch() public view returns (uint16) {
        return totalMinted / EPOCH + 1;
    }

    /// @notice The mint price of an epoch: 50,000 PUPATE, ×1.25 per epoch.
    function priceAt(uint16 epoch_) public pure returns (uint256 price) {
        price = BASE_PRICE;
        for (uint16 i = 1; i < epoch_; i++) {
            price = price * 125 / 100;
        }
    }

    function mintPrice() public view returns (uint256) {
        return priceAt(epoch());
    }

    /// @notice Leading zero bits a proof needs right now, for display.
    function bits() public view returns (uint8 n) {
        uint256 t = target;
        while (n < 255 && (t >> (255 - n)) == 0) n++;
    }

    function notedSeats() external view returns (uint256[] memory) {
        return _seats;
    }

    /// @notice The seats a mint may pick from, in the order the hash indexes them: noted, still held by
    /// the vault in their current round, and with editions left.
    function mineableSeats() public view returns (uint256[] memory open) {
        uint256 n = _seats.length;
        uint256[] memory buf = new uint256[](n);
        uint256 k;
        for (uint256 i; i < n; i++) {
            uint256 seat = _seats[i];
            (bool held, uint16 round) = _vaultHolds(seat);
            if (held && editionsMinted[seat][round] < EDITIONS) buf[k++] = seat;
        }
        open = new uint256[](k);
        for (uint256 i; i < k; i++) {
            open[i] = buf[i];
        }
    }

    /// @notice Tell the contract about a seat the vault holds. Anyone may; the page and the keeper do.
    function noteSeat(uint256 seat) external {
        (bool held,) = _vaultHolds(seat);
        if (!held) revert SeatNotHeld();
        if (noted[seat]) return;
        noted[seat] = true;
        _seats.push(seat);
        emit SeatNoted(seat);
    }

    // ------------------------------------------------------------------ internals (reads)

    /// @dev Held by the vault right now: on its books and in its wallet. Returns the current round.
    function _vaultHolds(uint256 seat) internal view returns (bool held, uint16 round) {
        (,,,,, bool onBooks, uint16 r) = COCOON.seats(seat);
        if (!onBooks) return (false, r);
        try COLLECTION.ownerOf(seat) returns (address holder) {
            return (holder == address(COCOON), r);
        } catch {
            return (false, r);
        }
    }

    /// @dev The largest target of an epoch: `MIN_BITS + epoch − 1` leading zero bits.
    function _ceiling(uint16 epoch_) internal view returns (uint256) {
        uint256 shift = uint256(MIN_BITS) + epoch_ - 1;
        if (shift > 255) shift = 255;
        return type(uint256).max >> shift;
    }

    function _tload(uint256 slot) private view returns (uint256 value) {
        assembly ("memory-safe") {
            value := tload(slot)
        }
    }

    function _tstore(uint256 slot, uint256 value) private {
        assembly ("memory-safe") {
            tstore(slot, value)
        }
    }

    // The mint, the stages, the staking, the conversion and the duties follow in later tasks.

    function tokenURI(uint256 id) public view override returns (string memory) {
        id;
        return "";
    }

    function unlockCallback(bytes calldata) external pure returns (bytes memory) {
        revert UnexpectedCallback();
    }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `forge test --match-contract MetamorphViewsTest -vv`
Expected: 6 passed. If `test_workHashIsTheSpecsPreimage` fails on `forge gives recent blocks a hash`, this forge build returns zero for `blockhash` in tests: add `vm.setBlockhash(block.number - 1, keccak256("anchor"))` at the end of the fixture's `setUp` and before each `vm.roll` in later tests (the cheatcode exists in forge 1.7), and keep going.

- [ ] **Step 6: Commit**

```bash
git add src/interfaces/IMetamorphArt.sol src/metamorph/MetamorphMD.sol test/mocks/StubArt.sol test/metamorph/MetamorphFixture.sol test/metamorph/MetamorphViews.t.sol
git commit -m "metamorph: the art interface, the fixture with an ETH/IMD pool, and the contract's views and seat registry"
```

---

### Task 3: The mint

**Files:**
- Modify: `src/metamorph/MetamorphMD.sol` (add `mint`, `_anchor`, `_pick`, `_retarget`, `_pull`; a `_duties` stub)
- Test: `test/metamorph/MetamorphMint.t.sol`

**Interfaces:**
- Produces: `mint(uint256 anchor, uint256 nonce) returns (uint256 id)`, event `Minted`, errors `SupplyExhausted NothingMineable BadAnchor NotASolution`; `_duties(address)` internal (no-op until Task 7).

- [ ] **Step 1: Write the failing tests**

```solidity
// test/metamorph/MetamorphMint.t.sol
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MetamorphFixture} from "./MetamorphFixture.sol";
import {MetamorphMD} from "../../src/metamorph/MetamorphMD.sol";

contract MetamorphMintTest is MetamorphFixture {
    function test_aValidProofMintsCardOneOfSeat1376() public {
        uint256 a = _anchor();
        uint256 n = _proof(miner, a);
        uint256 price = md.mintPrice();
        uint256 devBefore = token.balanceOf(developer);
        vm.prank(miner);
        uint256 id = md.mint(a, n);
        assertEq(id, 1);
        assertEq(md.ownerOf(1), miner);
        assertEq(md.totalMinted(), 1);
        (uint32 seat, uint16 round, uint16 edition,, uint40 mintedAt, address who, bytes32 work, uint96 paid) = md.cards(1);
        assertEq(seat, 1376);
        assertEq(round, 0);
        assertEq(edition, 1);
        assertEq(mintedAt, block.timestamp);
        assertEq(who, miner);
        assertEq(work, md.prevWork(), "prevWork is the last proof");
        assertEq(paid, price);
        assertEq(md.pot(), price * 7000 / 10_000, "70% to the pot");
        assertEq(token.balanceOf(developer) - devBefore, price - price * 7000 / 10_000, "30% to the developer");
        assertEq(token.balanceOf(address(md)), md.pot(), "the contract holds exactly the pot");
        assertEq(md.lastMintAt(), block.timestamp);
    }

    function test_badProofIsRefusedWithoutTakingAFee() public {
        uint256 a = _anchor();
        uint256 n = _proof(miner, a);
        bytes32 ah = blockhash(a);
        // Find a nonce that does NOT pass, so the refusal is about the proof, not the anchor.
        uint256 bad = n;
        while (uint256(md.workHash(ah, miner, bad)) < md.target()) bad++;
        uint256 before = token.balanceOf(miner);
        vm.prank(miner);
        vm.expectRevert(MetamorphMD.NotASolution.selector);
        md.mint(a, bad);
        assertEq(token.balanceOf(miner), before);
        assertEq(md.totalMinted(), 0);
    }

    function test_proofFromBeforeAnotherMintIsRefused() public {
        uint256 a = _anchor();
        uint256 mine = _proof(miner, a);
        // Someone else mints first with their own proof: prevWork changes.
        token.transfer(other, 1_000_000 ether);
        vm.prank(other);
        token.approve(address(md), type(uint256).max);
        _mintAs(other);
        uint256 before = token.balanceOf(miner);
        vm.prank(miner);
        vm.expectRevert(MetamorphMD.NotASolution.selector);
        md.mint(a, mine);
        assertEq(token.balanceOf(miner), before, "no fee for a stale proof");
        assertEq(md.totalMinted(), 1);
    }

    function test_proofIsBoundToTheMiner() public {
        uint256 a = _anchor();
        uint256 n = _proof(miner, a);
        token.transfer(other, 1_000_000 ether);
        vm.prank(other);
        token.approve(address(md), type(uint256).max);
        vm.prank(other);
        vm.expectRevert(MetamorphMD.NotASolution.selector);
        md.mint(a, n);
    }

    function test_anchorMustBeRecentAndInThePast() public {
        uint256 n = _proof(miner, _anchor());
        vm.prank(miner);
        vm.expectRevert(MetamorphMD.BadAnchor.selector);
        md.mint(block.number, n);
        vm.prank(miner);
        vm.expectRevert(MetamorphMD.BadAnchor.selector);
        md.mint(block.number + 3, n);
        uint256 old = block.number - 51;
        uint256 n2 = _proof(miner, old);
        vm.prank(miner);
        vm.expectRevert(MetamorphMD.BadAnchor.selector);
        md.mint(old, n2);
        uint256 edge = block.number - 50;
        uint256 n3 = _proof(miner, edge);
        vm.prank(miner);
        md.mint(edge, n3);
    }

    function test_theHashPicksAmongTheMineableSeats() public {
        _giveSeat(42);
        md.noteSeat(42);
        _giveSeat(7);
        md.noteSeat(7);
        bool saw1376;
        bool sawOther;
        for (uint256 i; i < 12; i++) {
            vm.roll(block.number + 1);
            vm.warp(block.timestamp + 90);
            uint256 id = _mintAs(miner);
            (uint32 seat,,,,,,,) = md.cards(id);
            if (seat == 1376) saw1376 = true;
            else sawOther = true;
            assertTrue(seat == 1376 || seat == 42 || seat == 7);
        }
        assertTrue(saw1376 && sawOther, "twelve picks spread over the seats");
    }

    function test_noMineableSeatMeansNoMint() public {
        _sell(1376);
        uint256 a = _anchor();
        uint256 n = _proof(miner, a);
        vm.prank(miner);
        vm.expectRevert(MetamorphMD.NothingMineable.selector);
        md.mint(a, n);
    }

    function test_reboughtSeatStartsItsOwnEditions() public {
        _mintAs(miner);
        assertEq(md.editionsMinted(1376, 0), 1);
        _sell(1376);
        // The vault buys the same seat again: a new round.
        vm.prank(other);
        collection.transferFrom(other, address(cocoon), 1376);
        cocoon.adopt(1376);
        (,,,,,, uint16 round) = cocoon.seats(1376);
        assertEq(round, 1);
        vm.roll(block.number + 1);
        uint256 id = _mintAs(miner);
        (, uint16 r, uint16 edition,,,,,) = md.cards(id);
        assertEq(r, 1);
        assertEq(edition, 1, "the new round's first edition");
        assertEq(md.editionsMinted(1376, 1), 1);
    }

    function test_editionsRunOutAt303AndTheSupplyAt3333() public {
        // Eleven seats, 303 cards each: the whole collection.
        uint256[11] memory seats = [uint256(1376), 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
        for (uint256 i = 1; i < seats.length; i++) {
            _giveSeat(seats[i]);
            md.noteSeat(seats[i]);
        }
        token.transfer(miner, 800_000_000 ether);
        for (uint256 i; i < 3333; i++) {
            vm.roll(block.number + 1);
            vm.warp(block.timestamp + 90);
            _mintAs(miner);
        }
        assertEq(md.totalMinted(), 3333);
        assertEq(md.epoch(), 12, "past the last epoch");
        for (uint256 i; i < seats.length; i++) {
            assertEq(md.editionsMinted(seats[i], 0), 303);
        }
        assertEq(md.mineableSeats().length, 0);
        vm.roll(block.number + 1);
        uint256 a = _anchor();
        uint256 n = _proof(miner, a);
        vm.prank(miner);
        vm.expectRevert(MetamorphMD.SupplyExhausted.selector);
        md.mint(a, n);
    }

    function test_priceStepsAfter303Mints() public {
        _giveSeat(2);
        md.noteSeat(2);
        token.transfer(miner, 100_000_000 ether);
        for (uint256 i; i < 303; i++) {
            vm.roll(block.number + 1);
            vm.warp(block.timestamp + 90);
            _mintAs(miner);
        }
        assertEq(md.epoch(), 2);
        assertEq(md.mintPrice(), 62_500 ether);
        uint256 devBefore = token.balanceOf(developer);
        vm.roll(block.number + 1);
        _mintAs(miner);
        assertEq(token.balanceOf(developer) - devBefore, 62_500 ether * 3000 / 10_000);
    }

    function test_retargetFollowsThePaceWithinTheClampAndTheCeiling() public {
        uint256 ceiling = type(uint256).max >> 1;
        // A fast mint (1 s) wants the target to fall by 90×, clamped to ÷4.
        vm.roll(block.number + 1);
        vm.warp(block.timestamp + 1);
        _mintAs(miner);
        assertEq(md.target(), ceiling / 4);
        // A slow mint (20 min) wants ×13, clamped to ×4, and the ceiling caps it.
        vm.roll(block.number + 1);
        vm.warp(block.timestamp + 20 minutes);
        _mintAs(miner);
        assertEq(md.target(), ceiling, "never above the epoch's ceiling");
        // Exactly the interval leaves the target alone (it was at the ceiling).
        vm.roll(block.number + 1);
        vm.warp(block.timestamp + 90);
        _mintAs(miner);
        assertEq(md.target(), ceiling);
        // Twice the interval from below the ceiling doubles it.
        vm.roll(block.number + 1);
        vm.warp(block.timestamp + 1);
        _mintAs(miner); // ceiling / 4
        vm.roll(block.number + 1);
        vm.warp(block.timestamp + 180);
        _mintAs(miner);
        assertEq(md.target(), ceiling / 2);
    }

    function test_giltIsFourMoreBitsThanTheTarget() public {
        // Mine until one proof is under target/16 and one is not; both mint, only one is gilt.
        bool sawGilt;
        bool sawPlain;
        for (uint256 i; i < 40 && !(sawGilt && sawPlain); i++) {
            vm.roll(block.number + 1);
            vm.warp(block.timestamp + 90);
            uint256 a = _anchor();
            uint256 n = _proof(miner, a);
            bytes32 work = md.workHash(blockhash(a), miner, n);
            bool expectGilt = uint256(work) < md.target() >> 4;
            vm.prank(miner);
            uint256 id = md.mint(a, n);
            (,,, bool gilt,,,,) = md.cards(id);
            assertEq(gilt, expectGilt);
            if (gilt) sawGilt = true;
            else sawPlain = true;
        }
        assertTrue(sawGilt && sawPlain);
    }

    function testFuzz_randomNoncesNeverPassAtTwentyBits(uint256 nonce, address who) public {
        MetamorphMD strict = _deployAt(20);
        bytes32 ah = blockhash(_anchor());
        // 2^-20 odds per try: a fuzz run of a few hundred never finds one; if it does, the proof is genuine
        // and the assertion below says so instead of failing.
        bool passes = uint256(strict.workHash(ah, who, nonce)) < strict.target();
        if (passes) assertLt(uint256(strict.workHash(ah, who, nonce)), type(uint256).max >> 20);
        else assertGe(uint256(strict.workHash(ah, who, nonce)), type(uint256).max >> 20);
    }

    function _deployAt(uint8 minBits) private returns (MetamorphMD) {
        return _deploy(minBits);
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `forge test --match-contract MetamorphMintTest -vv`
Expected: compilation error, `mint` is not a member of `MetamorphMD`.

- [ ] **Step 3: Add the mint to the contract**

Insert after `noteSeat` (before `// ---- internals (reads)`):

```solidity
    // ------------------------------------------------------------------ the mint

    /// @notice Mint with a proof for `anchor` (a block 1 to 50 behind) and `nonce`. The hash picks the
    /// seat; the fee is `mintPrice()` in PUPATE, 70% to the pot and 30% to the developer; then the
    /// vault's due duties run and pay the caller.
    function mint(uint256 anchor, uint256 nonce) external nonReentrant returns (uint256 id) {
        if (totalMinted >= MAX_SUPPLY) revert SupplyExhausted();
        bytes32 work = workHash(_anchor(anchor), msg.sender, nonce);
        uint256 t = target;
        if (uint256(work) >= t) revert NotASolution();
        (uint256 seat, uint16 round) = _pick(uint256(work));
        uint16 edition = ++editionsMinted[seat][round];

        uint16 epoch_ = epoch();
        uint256 price = priceAt(epoch_);
        uint256 toPot = price * STAKER_BPS / BPS;
        _pull(msg.sender, address(this), toPot);
        _pull(msg.sender, COCOON.developer(), price - toPot);
        pot += toPot;

        id = ++totalMinted;
        bool gilt = uint256(work) < (t >> 4);
        cards[id] = Card(uint32(seat), round, edition, gilt, uint40(block.timestamp), msg.sender, work, uint96(price));
        _mint(msg.sender, id);
        emit Minted(id, seat, round, edition, msg.sender, work, gilt, price, epoch_);

        prevWork = work;
        _retarget();
        lastMintAt = uint40(block.timestamp);
        _duties(msg.sender);
    }

    /// @dev Runs the vault's due duties for a miner. Filled in by a later task.
    function _duties(address) internal virtual {}

    // ------------------------------------------------------------------ internals (mint)

    function _anchor(uint256 anchor) private view returns (bytes32 h) {
        if (anchor >= block.number || block.number - anchor > ANCHOR_WINDOW) revert BadAnchor();
        h = blockhash(anchor);
        if (h == bytes32(0)) revert BadAnchor();
    }

    function _pick(uint256 work) private view returns (uint256 seat, uint16 round) {
        uint256[] memory open = mineableSeats();
        if (open.length == 0) revert NothingMineable();
        seat = open[work % open.length];
        (,,,,,, round) = COCOON.seats(seat);
    }

    /// @dev Every mint moves the target toward one mint per `TARGET_INTERVAL`, by at most ×4 or ÷4, and
    /// never above the epoch's ceiling. Reads `epoch()` after `totalMinted` moved, so the ceiling of the
    /// epoch the next mint belongs to applies.
    function _retarget() private {
        uint256 elapsed = block.timestamp - lastMintAt;
        if (elapsed > 4 * TARGET_INTERVAL) elapsed = 4 * TARGET_INTERVAL;
        if (elapsed * 4 < TARGET_INTERVAL) elapsed = TARGET_INTERVAL / 4;
        uint256 next = target * elapsed / TARGET_INTERVAL;
        uint256 cap = _ceiling(totalMinted >= MAX_SUPPLY ? uint16(MAX_SUPPLY / EPOCH + 1) : epoch());
        if (next > cap) next = cap;
        target = next;
        emit Retargeted(next);
    }

    function _pull(address from, address to, uint256 amount) private {
        if (!PUPATE.transferFrom(from, to, amount)) revert TransferFailed();
    }
```

Note on `elapsed * 4 < TARGET_INTERVAL`: an elapsed of 0 to 22 seconds becomes 22.5 → `TARGET_INTERVAL / 4 = 22`, giving `target × 22 / 90`, which is not exactly ÷4. Use the exact clamp instead: replace the two clamp lines with

```solidity
        uint256 next;
        if (elapsed >= 4 * TARGET_INTERVAL) next = target * 4;
        else if (elapsed * 4 <= TARGET_INTERVAL) next = target / 4;
        else next = target * elapsed / TARGET_INTERVAL;
```

and keep the ceiling cap. (`target × 4` cannot overflow: the target is at most `2^255` at `MIN_BITS = 1`, and the cap is applied after; compute `target * 4` only when `target <= type(uint256).max / 4`, otherwise use the cap directly:)

```solidity
        if (elapsed >= 4 * TARGET_INTERVAL) next = target > type(uint256).max / 4 ? type(uint256).max : target * 4;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `forge test --match-contract MetamorphMintTest -vv`
Expected: 13 passed. The 3,333-mint test takes a few seconds.

- [ ] **Step 5: Run the whole suite and commit**

Run: `forge test`
Expected: everything green.

```bash
git add src/metamorph/MetamorphMD.sol test/metamorph/MetamorphMint.t.sol
git commit -m "metamorph: the mint; the work chain, the seat pick, the fee split, the retarget"
```

---

### Task 4: Stages, royalty and the token URI

**Files:**
- Modify: `src/metamorph/MetamorphMD.sol` (add `stageOf`, `royaltyInfo`, `supportsInterface` override, `tokenURI`, `_vaultHoldsRound`)
- Test: `test/metamorph/MetamorphStages.t.sol`

**Interfaces:**
- Produces: `stageOf(uint256) returns (uint8)` (0 chrysalis, 1 butterfly), `royaltyInfo(uint256,uint256) returns (address,uint256)`, `tokenURI(uint256)` built from `ART.tokenURI(View)`, `supportsInterface` adds `0x2a55205a`.

- [ ] **Step 1: Write the failing tests**

```solidity
// test/metamorph/MetamorphStages.t.sol
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MetamorphFixture} from "./MetamorphFixture.sol";
import {ERC721Lite} from "../../src/metamorph/ERC721Lite.sol";

contract MetamorphStagesTest is MetamorphFixture {
    function test_aNewCardIsAChrysalis() public {
        uint256 id = _mintAs(miner);
        assertEq(md.stageOf(id), 0);
    }

    function test_butterflyWhenTheVaultSellsTheSeat() public {
        uint256 id = _mintAs(miner);
        _sell(1376);
        assertEq(md.stageOf(id), 1);
    }

    function test_butterflyWhenTheVaultBuysTheSeatAgain() public {
        uint256 id = _mintAs(miner);
        _sell(1376);
        vm.prank(other);
        collection.transferFrom(other, address(cocoon), 1376);
        cocoon.adopt(1376);
        assertEq(md.stageOf(id), 1, "round 0 is over even though the vault holds the seat");
        vm.roll(block.number + 1);
        uint256 id2 = _mintAs(miner);
        assertEq(md.stageOf(id2), 0, "a round-1 card is a chrysalis");
    }

    function test_butterflyAfterNinetyDaysWhateverHappened() public {
        uint256 id = _mintAs(miner);
        vm.warp(block.timestamp + 90 days - 1);
        assertEq(md.stageOf(id), 0);
        vm.warp(block.timestamp + 1);
        assertEq(md.stageOf(id), 1);
    }

    function test_butterflyWhenTheSeatLeavesTheVaultWithoutSettling() public {
        uint256 id = _mintAs(miner);
        vm.prank(address(cocoon));
        collection.transferFrom(address(cocoon), other, 1376);
        assertEq(md.stageOf(id), 1, "the wallet, not only the books, decides");
    }

    function test_stageOfUnmintedReverts() public {
        vm.expectRevert(ERC721Lite.NotMinted.selector);
        md.stageOf(5);
    }

    function test_royaltyIsFivePercentToTheDeveloperOfTheMoment() public {
        _mintAs(miner);
        (address to, uint256 amount) = md.royaltyInfo(1, 1 ether);
        assertEq(to, developer);
        assertEq(amount, 0.05 ether);
        vm.prank(developer);
        cocoon.setDeveloper(other);
        (to,) = md.royaltyInfo(1, 1 ether);
        assertEq(to, other);
        assertTrue(md.supportsInterface(0x2a55205a));
    }

    function test_tokenURIHandsTheArtEveryFact() public {
        uint256 id = _mintAs(miner);
        assertEq(md.tokenURI(id), "stub:1:1376:0:1:0:plain:1:50000000000000000000000");
        _sell(1376);
        assertEq(md.tokenURI(id), "stub:1:1376:0:1:1:plain:1:50000000000000000000000");
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `forge test --match-contract MetamorphStagesTest -vv`
Expected: compilation error, `stageOf` not found.

- [ ] **Step 3: Add the stages, the royalty and the URI**

Replace the placeholder `tokenURI` at the bottom of the contract and add, after the mint section:

```solidity
    // ------------------------------------------------------------------ stages, royalty, metadata

    /// @notice 0 while the vault holds the card's seat in the card's round, 1 after it no longer does,
    /// or 90 days after the mint whatever happened. Computed, never stored.
    function stageOf(uint256 id) public view returns (uint8) {
        Card memory c = cards[id];
        if (c.mintedAt == 0) revert NotMinted();
        if (block.timestamp >= uint256(c.mintedAt) + BUTTERFLY_CEILING) return 1;
        return _vaultHoldsRound(c.seat, c.round) ? 0 : 1;
    }

    /// @notice ERC-2981: 5% of every resale to the developer Cocoon names today.
    function royaltyInfo(uint256, uint256 salePrice) external view returns (address, uint256) {
        return (COCOON.developer(), salePrice * ROYALTY_BPS / BPS);
    }

    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return interfaceId == 0x2a55205a || super.supportsInterface(interfaceId);
    }

    function tokenURI(uint256 id) public view override returns (string memory) {
        Card memory c = cards[id];
        if (c.mintedAt == 0) revert NotMinted();
        return ART.tokenURI(
            IMetamorphArt.View({
                id: id,
                seat: c.seat,
                round: c.round,
                edition: c.edition,
                stage: stageOf(id),
                gilt: c.gilt,
                epoch: _epochOf(id),
                miner: c.miner,
                mintedAt: c.mintedAt,
                paid: c.paid
            })
        );
    }

    /// @dev The epoch a card was minted in: ids count from 1, 303 per epoch.
    function _epochOf(uint256 id) private pure returns (uint16) {
        return uint16((id - 1) / EPOCH + 1);
    }

    function _vaultHoldsRound(uint256 seat, uint16 round) private view returns (bool) {
        (bool held, uint16 r) = _vaultHolds(seat);
        return held && r == round;
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `forge test --match-contract MetamorphStagesTest -vv`
Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add src/metamorph/MetamorphMD.sol test/metamorph/MetamorphStages.t.sol
git commit -m "metamorph: the two stages read from Cocoon, the royalty, the token URI through the art"
```

---

### Task 5: Staking

**Files:**
- Modify: `src/metamorph/MetamorphMD.sol` (add `stake`, `unstake`, `claim`, `_settle`, `_credit`, `_weight`, `_beforeTransfer` override, `_payIMD`)
- Create: `test/metamorph/MetamorphHarness.sol`
- Test: `test/metamorph/MetamorphStaking.t.sol`

**Interfaces:**
- Produces: `stake(uint256[] ids)`, `unstake(uint256[] ids)`, `claim(uint256[] ids) returns (uint256 paid)`, `stakeOf(id) returns (address staker, uint8 weight, uint256 debt)`, `pendingIMD(address)`, `totalWeight()`, `accIMDPerWeight()`, `imdOwed()`, `_credit(uint256 imd) internal` (used by `convert` in Task 6), errors `Staked NotStaked NotCardOwner`, events `StakedCard Unstaked Claimed Reweighed`.

- [ ] **Step 1: Write the harness and the failing tests**

```solidity
// test/metamorph/MetamorphHarness.sol
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Cocoon} from "../../src/Cocoon.sol";
import {PupateHook} from "../../src/PupateHook.sol";
import {PupateToken} from "../../src/PupateToken.sol";
import {IERC20Minimal} from "../../src/interfaces/IERC20Minimal.sol";
import {IERC721Minimal} from "../../src/interfaces/IERC721Minimal.sol";
import {IMetamorphArt} from "../../src/interfaces/IMetamorphArt.sol";
import {MetamorphMD} from "../../src/metamorph/MetamorphMD.sol";

/// @dev The contract with one test-only door: credit IMD to the stakers as a conversion would, so the
/// staking arithmetic is tested apart from the pools.
contract MetamorphHarness is MetamorphMD {
    constructor(
        Cocoon c, PupateHook h, PupateToken p, IERC20Minimal i, IERC721Minimal col, IPoolManager pm,
        PoolKey memory pk, PoolKey memory ik, IMetamorphArt a, uint8 bits_
    ) MetamorphMD(c, h, p, i, col, pm, pk, ik, a, bits_) {}

    /// @dev The caller must have transferred `imd` to this contract first.
    function creditForTests(uint256 imd) external {
        _credit(imd);
    }
}
```

```solidity
// test/metamorph/MetamorphStaking.t.sol
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MetamorphFixture} from "./MetamorphFixture.sol";
import {MetamorphHarness} from "./MetamorphHarness.sol";
import {MetamorphMD} from "../../src/metamorph/MetamorphMD.sol";
import {IERC20Minimal} from "../../src/interfaces/IERC20Minimal.sol";
import {IERC721Minimal} from "../../src/interfaces/IERC721Minimal.sol";
import {IMetamorphArt} from "../../src/interfaces/IMetamorphArt.sol";

contract MetamorphStakingTest is MetamorphFixture {
    MetamorphHarness h;

    function _deploy(uint8 minBits) internal override returns (MetamorphMD) {
        h = new MetamorphHarness(
            cocoon, hook, token, IERC20Minimal(address(imd)), IERC721Minimal(address(collection)), manager, key, imdKey,
            IMetamorphArt(address(art)), minBits
        );
        return MetamorphMD(payable(address(h)));
    }

    function _credit(uint256 amount) private {
        imd.mint(address(h), amount);
        h.creditForTests(amount);
    }

    function _ids(uint256 a) private pure returns (uint256[] memory ids) {
        ids = new uint256[](1);
        ids[0] = a;
    }

    function test_stakeLocksAndWeighsOne() public {
        uint256 id = _mintAs(miner);
        vm.prank(miner);
        md.stake(_ids(id));
        (address staker, uint8 weight,) = md.stakeOf(id);
        assertEq(staker, miner);
        assertEq(weight, 1);
        assertEq(md.totalWeight(), 1);
        assertEq(md.ownerOf(id), miner, "the card stays in the wallet");
    }

    function test_onlyTheOwnerStakesAndOnlyOnce() public {
        uint256 id = _mintAs(miner);
        vm.prank(other);
        vm.expectRevert(MetamorphMD.NotCardOwner.selector);
        md.stake(_ids(id));
        vm.prank(miner);
        md.stake(_ids(id));
        vm.prank(miner);
        vm.expectRevert(MetamorphMD.Staked.selector);
        md.stake(_ids(id));
    }

    function test_stakedCardCannotMoveByAnyPath() public {
        uint256 id = _mintAs(miner);
        vm.prank(miner);
        md.stake(_ids(id));
        vm.prank(miner);
        vm.expectRevert(MetamorphMD.Staked.selector);
        md.transferFrom(miner, other, id);
        vm.prank(miner);
        md.setApprovalForAll(other, true);
        vm.prank(other);
        vm.expectRevert(MetamorphMD.Staked.selector);
        md.safeTransferFrom(miner, other, id);
        vm.prank(other);
        vm.expectRevert(MetamorphMD.Staked.selector);
        md.safeTransferFrom(miner, other, id, "");
        vm.prank(miner);
        md.unstake(_ids(id));
        vm.prank(miner);
        md.transferFrom(miner, other, id);
        assertEq(md.ownerOf(id), other);
    }

    function test_creditWithNoStakersGoesToTheDeveloper() public {
        uint256 before = imd.balanceOf(developer);
        _credit(1000 ether);
        assertEq(imd.balanceOf(developer) - before, 1000 ether);
        assertEq(md.imdOwed(), 0);
    }

    function test_twoStakersSplitByWeightAcrossTime() public {
        uint256 a = _mintAs(miner);
        vm.roll(block.number + 1);
        token.transfer(other, 1_000_000 ether);
        vm.prank(other);
        token.approve(address(md), type(uint256).max);
        uint256 b = _mintAs(other);
        vm.prank(miner);
        md.stake(_ids(a));
        _credit(100 ether); // miner alone: 100
        vm.prank(other);
        md.stake(_ids(b));
        _credit(100 ether); // both: 50 / 50
        assertEq(md.imdOwed(), 200 ether);
        vm.prank(miner);
        uint256 paid = md.claim(_ids(a));
        assertEq(paid, 150 ether);
        assertEq(imd.balanceOf(miner), 150 ether);
        vm.prank(other);
        paid = md.claim(_ids(b));
        assertEq(paid, 50 ether);
        assertEq(md.imdOwed(), 0);
        // Nothing more to claim until the next credit.
        vm.prank(miner);
        assertEq(md.claim(_ids(a)), 0);
    }

    function test_unstakeSettlesFirst() public {
        uint256 a = _mintAs(miner);
        vm.prank(miner);
        md.stake(_ids(a));
        _credit(40 ether);
        vm.prank(miner);
        md.unstake(_ids(a));
        assertEq(md.totalWeight(), 0);
        assertEq(md.pendingIMD(miner), 40 ether);
        // A later credit with nobody staked goes to the developer, not to the former staker.
        _credit(10 ether);
        assertEq(md.pendingIMD(miner), 40 ether);
        vm.prank(miner);
        assertEq(md.claim(new uint256[](0)), 40 ether);
    }

    function test_butterflyWeighsTwoOnTheNextTouch() public {
        uint256 a = _mintAs(miner);
        vm.prank(miner);
        md.stake(_ids(a));
        _sell(1376);
        (, uint8 weight,) = md.stakeOf(a);
        assertEq(weight, 1, "not until touched");
        _credit(30 ether); // still weight 1 while earning this
        vm.prank(miner);
        vm.expectEmit(true, false, false, true);
        emit MetamorphMD.Reweighed(a, 2);
        md.claim(_ids(a));
        (, weight,) = md.stakeOf(a);
        assertEq(weight, 2);
        assertEq(md.totalWeight(), 2);
        assertEq(imd.balanceOf(miner), 30 ether);
    }

    function test_claimOnlyTouchesYourOwnStakes() public {
        uint256 a = _mintAs(miner);
        vm.prank(miner);
        md.stake(_ids(a));
        vm.prank(other);
        vm.expectRevert(MetamorphMD.NotStaked.selector);
        md.claim(_ids(a));
        vm.prank(other);
        vm.expectRevert(MetamorphMD.NotStaked.selector);
        md.unstake(_ids(a));
    }

    function testFuzz_neverPaysMoreThanItHolds(uint96 c1, uint96 c2, uint96 c3) public {
        uint256 a = _mintAs(miner);
        vm.roll(block.number + 1);
        token.transfer(other, 1_000_000 ether);
        vm.prank(other);
        token.approve(address(md), type(uint256).max);
        uint256 b = _mintAs(other);
        vm.prank(miner);
        md.stake(_ids(a));
        _credit(c1);
        vm.prank(other);
        md.stake(_ids(b));
        _credit(c2);
        vm.prank(miner);
        md.unstake(_ids(a));
        _credit(c3);
        vm.prank(miner);
        uint256 p1 = md.claim(new uint256[](0));
        vm.prank(other);
        uint256 p2 = md.claim(_ids(b));
        assertLe(p1 + p2, uint256(c1) + c2 + c3);
        assertLe(md.imdOwed(), imd.balanceOf(address(md)));
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `forge test --match-contract MetamorphStakingTest -vv`
Expected: compilation error, `stake` not found.

- [ ] **Step 3: Add staking to the contract**

After the stages section:

```solidity
    // ------------------------------------------------------------------ staking

    /// @notice Lock cards you own in your wallet and earn the stakers' IMD by weight: 1 for a chrysalis,
    /// 2 for a butterfly. No lock period, no custody change.
    function stake(uint256[] calldata ids) external nonReentrant {
        for (uint256 i; i < ids.length; i++) {
            uint256 id = ids[i];
            if (ownerOf(id) != msg.sender) revert NotCardOwner();
            Stake storage s = stakeOf[id];
            if (s.staker != address(0)) revert Staked();
            uint8 w = _weight(id);
            s.staker = msg.sender;
            s.weight = w;
            s.debt = uint256(w) * accIMDPerWeight;
            totalWeight += w;
            emit StakedCard(id, msg.sender, w);
        }
    }

    /// @notice Settle and unlock cards you staked.
    function unstake(uint256[] calldata ids) external nonReentrant {
        for (uint256 i; i < ids.length; i++) {
            uint256 id = ids[i];
            Stake storage s = stakeOf[id];
            if (s.staker != msg.sender) revert NotStaked();
            _settle(id, s);
            totalWeight -= s.weight;
            delete stakeOf[id];
            emit Unstaked(id, msg.sender);
        }
    }

    /// @notice Settle the given staked cards (an emerged card is reweighed to 2 here) and pay out
    /// everything pending for the caller.
    function claim(uint256[] calldata ids) external nonReentrant returns (uint256 paid) {
        for (uint256 i; i < ids.length; i++) {
            Stake storage s = stakeOf[ids[i]];
            if (s.staker != msg.sender) revert NotStaked();
            _settle(ids[i], s);
        }
        paid = pendingIMD[msg.sender];
        if (paid != 0) {
            pendingIMD[msg.sender] = 0;
            imdOwed -= paid;
            _payIMD(msg.sender, paid);
        }
        emit Claimed(msg.sender, paid);
    }

    /// @dev Books what a staked card earned since its last settlement, then re-reads its stage.
    function _settle(uint256 id, Stake storage s) private {
        uint256 acc = accIMDPerWeight;
        uint256 earned = (uint256(s.weight) * acc - s.debt) / ACC;
        if (earned != 0) pendingIMD[s.staker] += earned;
        uint8 w = _weight(id);
        if (w != s.weight) {
            totalWeight = totalWeight - s.weight + w;
            s.weight = w;
            emit Reweighed(id, w);
        }
        s.debt = uint256(w) * acc;
    }

    /// @dev IMD for the stakers: spread over the current weight, or to the developer when nobody stakes.
    function _credit(uint256 imdAmount) internal {
        if (imdAmount == 0) return;
        if (totalWeight == 0) {
            _payIMD(COCOON.developer(), imdAmount);
            return;
        }
        accIMDPerWeight += imdAmount * ACC / totalWeight;
        imdOwed += imdAmount;
    }

    function _weight(uint256 id) private view returns (uint8) {
        return stageOf(id) == 1 ? 2 : 1;
    }

    function _payIMD(address to, uint256 amount) private {
        if (!IMD.transfer(to, amount)) revert TransferFailed();
    }

    /// @dev A staked card does not move.
    function _beforeTransfer(uint256 id) internal view override {
        if (stakeOf[id].staker != address(0)) revert Staked();
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `forge test --match-contract MetamorphStakingTest -vv`
Expected: 9 passed (the fuzz test runs 256 times).

- [ ] **Step 5: Commit**

```bash
git add src/metamorph/MetamorphMD.sol test/metamorph/MetamorphHarness.sol test/metamorph/MetamorphStaking.t.sol
git commit -m "metamorph: staking without locks; weight by stage, settled on every touch"
```

---

### Task 6: The conversion

**Files:**
- Modify: `src/metamorph/MetamorphMD.sol` (add `convert`, `convertDuty`, `_convert`, `unlockCallback`, `_limits`, `_sqrt`, `_pay`)
- Test: `test/metamorph/MetamorphConvert.t.sol`

**Interfaces:**
- Produces: `convert() returns (uint256 imdOut)`, `convertDuty(address miner) returns (uint256)` (self-call only), event `Converted`, errors `NothingToConvert NothingBought OnlyPoolManager OnlySelf UnexpectedCallback`.

- [ ] **Step 1: Write the failing tests**

```solidity
// test/metamorph/MetamorphConvert.t.sol
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MetamorphFixture} from "./MetamorphFixture.sol";
import {MetamorphMD} from "../../src/metamorph/MetamorphMD.sol";

contract MetamorphConvertTest is MetamorphFixture {
    function _ids(uint256 a) private pure returns (uint256[] memory ids) {
        ids = new uint256[](1);
        ids[0] = a;
    }

    function _mintMany(uint256 n) private {
        for (uint256 i; i < n; i++) {
            vm.roll(block.number + 1);
            vm.warp(block.timestamp + 90);
            _mintAs(miner);
        }
    }

    function test_nothingToConvertReverts() public {
        vm.expectRevert(MetamorphMD.NothingToConvert.selector);
        md.convert();
    }

    function test_convertSellsThePotForIMDPaysTheCallerAndTheDeveloperWhenNobodyStakes() public {
        _mintMany(3);
        uint256 potBefore = md.pot();
        assertEq(potBefore, 3 * 50_000 ether * 7000 / 10_000);
        uint256 devBefore = imd.balanceOf(developer);
        (uint256 seatPot, uint256 burnPot, uint256 dev, uint256 imdBurn) = _pots();
        uint256 vaultBefore = seatPot + burnPot + dev + imdBurn;
        vm.prank(keeper);
        uint256 out = md.convert();
        assertGt(out, 0);
        assertEq(md.pot(), 0, "the whole pot fit under the bound");
        assertEq(token.balanceOf(address(md)), 0);
        uint256 reward = imd.balanceOf(keeper);
        assertEq(reward, out * 50 / 10_000, "0.5% to the caller");
        assertEq(imd.balanceOf(developer) - devBefore, out - reward, "nobody staked: the rest to the developer");
        assertEq(address(md).balance, md.ethPot(), "ETH equals the ETH pot");
        (seatPot, burnPot, dev, imdBurn) = _pots();
        assertGt(seatPot + burnPot + dev + imdBurn, vaultBefore, "the sale paid the vault its tax");
    }

    function test_convertCreditsStakersByWeight() public {
        uint256 a = _mintAs(miner);
        vm.prank(miner);
        md.stake(_ids(a));
        _mintMany(2);
        vm.prank(keeper);
        uint256 out = md.convert();
        uint256 credited = out - out * 50 / 10_000;
        assertEq(md.imdOwed(), credited);
        vm.prank(miner);
        uint256 paid = md.claim(_ids(a));
        assertEq(paid, credited);
        assertEq(imd.balanceOf(miner), credited);
    }

    function test_convertStaysWithinTheImpactBound() public {
        // A big pot: 303 mints of epoch one is 10.6M PUPATE, far more than 5% of the pool.
        _giveSeat(2);
        md.noteSeat(2);
        token.transfer(miner, 100_000_000 ether);
        _mintMany(303);
        uint160 pupateBefore = _sqrtPrice(key);
        uint160 imdBefore = _sqrtPrice(imdKey);
        vm.prank(keeper);
        md.convert();
        // Selling PUPATE lifts its sqrt price by at most sqrt(1.05); buying IMD lowers that pool's by at most sqrt(0.95).
        assertLe(uint256(_sqrtPrice(key)), uint256(pupateBefore) * 10_247 / 10_000 + 1);
        assertGe(uint256(_sqrtPrice(imdKey)), uint256(imdBefore) * 9_746 / 10_000 - 1);
    }

    function test_convertLeavesWhatTheBoundRefuses() public {
        _giveSeat(2);
        md.noteSeat(2);
        token.transfer(miner, 100_000_000 ether);
        _mintMany(303);
        uint256 potBefore = md.pot();
        vm.prank(keeper);
        md.convert();
        assertGt(md.pot(), 0, "part of the pot waits");
        assertLt(md.pot(), potBefore);
        assertEq(token.balanceOf(address(md)), md.pot(), "the contract holds exactly the pot");
        assertEq(address(md).balance, md.ethPot(), "and exactly the ETH pot");
        // The next call, after the pools recover a step, converts more.
        vm.roll(block.number + 1);
        uint256 again = md.pot();
        vm.prank(keeper);
        md.convert();
        assertLt(md.pot(), again);
    }

    function test_callbackOnlyFromThePoolManagerAndOnlyDuringAConversion() public {
        vm.expectRevert(MetamorphMD.OnlyPoolManager.selector);
        md.unlockCallback("");
        vm.prank(address(manager));
        vm.expectRevert(MetamorphMD.UnexpectedCallback.selector);
        md.unlockCallback("");
    }

    function test_convertDutyIsSelfOnly() public {
        vm.expectRevert(MetamorphMD.OnlySelf.selector);
        md.convertDuty(keeper);
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `forge test --match-contract MetamorphConvertTest -vv`
Expected: compilation error, `convert` not found.

- [ ] **Step 3: Add the conversion**

Replace the placeholder `unlockCallback` and add after the staking section:

```solidity
    // ------------------------------------------------------------------ the conversion

    /// @notice Sell the pot's PUPATE for ETH, then the ETH for IMD, each under a 5% price-impact bound,
    /// and credit the stakers. Anyone may call; the caller is paid 0.5% of the IMD bought. What the
    /// bound leaves unsold stays for the next call.
    function convert() external nonReentrant returns (uint256 imdOut) {
        return _convert(msg.sender);
    }

    /// @dev The conversion as a duty inside a mint: the mint holds the lock, so this entry has none,
    /// and only the contract itself may use it.
    function convertDuty(address miner_) external returns (uint256 imdOut) {
        if (msg.sender != address(this)) revert OnlySelf();
        return _convert(miner_);
    }

    function _convert(address caller) private returns (uint256 imdOut) {
        uint256 pupateIn = pot;
        ethPot = address(this).balance;
        if (pupateIn == 0 && ethPot == 0) revert NothingToConvert();
        (uint160 saleLimit, uint160 buyLimit) = _limits();
        bytes memory result = POOL_MANAGER.unlock(abi.encode(pupateIn, ethPot, saleLimit, buyLimit));
        (uint256 sold, uint256 ethBought, uint256 bought) = abi.decode(result, (uint256, uint256, uint256));
        if (bought == 0) revert NothingBought();
        pot -= sold;
        ethPot = address(this).balance;
        uint256 reward = bought * CALLER_REWARD_BPS / BPS;
        if (reward != 0) _payIMD(caller, reward);
        _credit(bought - reward);
        emit Converted(sold, ethBought, bought, caller, reward);
        return bought;
    }

    /// @inheritdoc IUnlockCallback
    /// @dev Reached only from `_convert`. Swap one: PUPATE for ETH in the launch pool, exact input,
    /// up to the sale limit. Swap two: all the ETH in hand for IMD, exact input, up to the buy limit.
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(POOL_MANAGER)) revert OnlyPoolManager();
        if (_tload(LOCK_SLOT) == 0) revert UnexpectedCallback();
        (uint256 pupateIn, uint256 ethHeld, uint160 saleLimit, uint160 buyLimit) =
            abi.decode(data, (uint256, uint256, uint160, uint160));

        uint256 sold;
        uint256 ethBought;
        if (pupateIn != 0) {
            BalanceDelta d = POOL_MANAGER.swap(pupateKey, SwapParams(false, -int256(pupateIn), saleLimit), "");
            sold = uint256(uint128(-d.amount1()));
            ethBought = uint256(uint128(d.amount0()));
            if (sold != 0) {
                POOL_MANAGER.sync(pupateKey.currency1);
                if (!PUPATE.transfer(address(POOL_MANAGER), sold)) revert TransferFailed();
                POOL_MANAGER.settle();
            }
            if (ethBought != 0) POOL_MANAGER.take(pupateKey.currency0, address(this), ethBought);
        }

        uint256 ethIn = ethHeld + ethBought;
        uint256 bought;
        if (ethIn != 0) {
            BalanceDelta d2 = POOL_MANAGER.swap(imdKey, SwapParams(true, -int256(ethIn), buyLimit), "");
            uint256 ethSpent = uint256(uint128(-d2.amount0()));
            bought = uint256(uint128(d2.amount1()));
            if (ethSpent != 0) POOL_MANAGER.settle{value: ethSpent}();
            if (bought != 0) POOL_MANAGER.take(imdKey.currency1, address(this), bought);
        }
        return abi.encode(sold, ethBought, bought);
    }

    /// @dev The price limits of one conversion: the sale may lift the launch pool's sqrt price by at
    /// most sqrt(1 + impact); the buy may lower the IMD pool's by at most sqrt(1 − impact).
    function _limits() private view returns (uint160 saleLimit, uint160 buyLimit) {
        (uint160 p1,,,) = POOL_MANAGER.getSlot0(pupateKey.toId());
        uint256 up = uint256(p1) * _sqrt((BPS + CONVERT_IMPACT_BPS) * BPS) / BPS;
        if (up >= TickMath.MAX_SQRT_PRICE) up = TickMath.MAX_SQRT_PRICE - 1;
        saleLimit = uint160(up);
        (uint160 p2,,,) = POOL_MANAGER.getSlot0(imdKey.toId());
        uint256 down = uint256(p2) * (_sqrt((BPS - CONVERT_IMPACT_BPS) * BPS) + 1) / BPS;
        if (down <= TickMath.MIN_SQRT_PRICE) down = TickMath.MIN_SQRT_PRICE + 1;
        buyLimit = uint160(down);
    }

    function _sqrt(uint256 x) private pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }

    function _pay(address to, uint256 amount) private {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
```

`_pay` is used by Task 7; the compiler warns about it being unused until then, which is fine.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `forge test --match-contract MetamorphConvertTest -vv`
Expected: 7 passed. If `test_convertStaysWithinTheImpactBound` fails by a few wei on the IMD side, the hook's tax took ETH before swap two: that is expected, the assertion bounds are on prices, not amounts; if the price bound itself fails, the sqrt rounding went the wrong way: use `_sqrt(...) + 1` for the sale limit too and re-run.

- [ ] **Step 5: Commit**

```bash
git add src/metamorph/MetamorphMD.sol test/metamorph/MetamorphConvert.t.sol
git commit -m "metamorph: convert the pot to IMD through both pools under the vault's impact bound"
```

---

### Task 7: The vault duties inside the mint

**Files:**
- Modify: `src/metamorph/MetamorphMD.sol` (replace the `_duties` stub; add `dutiesDue`)
- Test: `test/metamorph/MetamorphDuties.t.sol`

**Interfaces:**
- Produces: `dutiesDue() returns (bool flushDue, bool burnDue, bool convertDue)`, event `DutyRun(kind, paid)`.

- [ ] **Step 1: Write the failing tests**

```solidity
// test/metamorph/MetamorphDuties.t.sol
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MetamorphFixture} from "./MetamorphFixture.sol";
import {MetamorphMD} from "../../src/metamorph/MetamorphMD.sol";

contract MetamorphDutiesTest is MetamorphFixture {
    function setUp() public override {
        super.setUp();
        _endLaunch();
        vm.fee(1 gwei);
    }

    function test_nothingDueRunsNothing() public {
        (bool f, bool b, bool c) = md.dutiesDue();
        assertFalse(f || b || c);
        vm.recordLogs();
        _mintAs(miner);
        // No DutyRun event among the logs.
        bytes32 sig = keccak256("DutyRun(uint8,uint256)");
        for (uint256 i; i < vm.getRecordedLogs().length; i++) {
            assertTrue(vm.getRecordedLogs()[i].topics[0] != sig);
        }
    }

    function test_mintFlushesTheHookWhenClaimsAreDue() public {
        _buyExactIn(1 ether); // 6% tax waits in the hook
        assertGe(_claims(), 0.005 ether);
        (bool f,,) = md.dutiesDue();
        assertTrue(f);
        vm.expectEmit(false, false, false, true);
        emit MetamorphMD.DutyRun(0, 0);
        _mintAs(miner);
        assertEq(_claims(), 0);
        assertGt(cocoon.burnPot(), 0, "the tax reached the vault");
    }

    function test_mintBurnsForTheVaultAndPaysTheMinerTheReward() public {
        _deposit(1 ether); // burn pot 0.425 ETH
        vm.roll(block.number + 10);
        (, bool b,) = md.dutiesDue();
        assertTrue(b);
        uint256 before = miner.balance;
        uint256 potBefore = cocoon.burnPot();
        _mintAs(miner);
        assertLt(cocoon.burnPot(), potBefore, "the vault burned");
        assertGt(miner.balance, before, "the miner got the caller reward");
        assertEq(address(md).balance, md.ethPot(), "nothing stays behind");
    }

    function test_mintConvertsWhenThePotIsTwoPricesDeep() public {
        for (uint256 i; i < 3; i++) {
            vm.roll(block.number + 1);
            vm.warp(block.timestamp + 90);
            _mintAs(miner);
        }
        (,, bool c) = md.dutiesDue();
        assertTrue(c, "pot of 105k PUPATE is over twice the price");
        vm.roll(block.number + 1);
        vm.warp(block.timestamp + 90);
        _mintAs(miner);
        assertLt(md.pot(), 50_000 ether, "the pot was converted inside the mint");
        assertGt(imd.balanceOf(miner), 0, "the miner got the conversion reward");
    }

    function test_expensiveGasSkipsEveryDuty() public {
        _buyExactIn(1 ether);
        vm.fee(3 gwei);
        _mintAs(miner);
        assertGt(_claims(), 0, "flush skipped at 3 gwei");
    }

    function test_failingDutyNeverRevertsTheMint() public {
        // Make the burn due but impossible: nothing in the pool to buy below the limit is hard to arrange,
        // so use the spacing: a burn in this very block makes the next one TooSoon, yet `dutiesDue` reads
        // the stale lastBurnBlock only after our own burn... Instead, break the convert: a pot that is due
        // while the IMD pool has no liquidity in range cannot buy anything.
        for (uint256 i; i < 3; i++) {
            vm.roll(block.number + 1);
            vm.warp(block.timestamp + 90);
            _mintAs(miner);
        }
        // Drain the IMD pool's liquidity so swap two buys nothing.
        router.addLiquidity(
            imdKey,
            _removeAll()
        );
        (,, bool c) = md.dutiesDue();
        assertTrue(c);
        vm.roll(block.number + 1);
        vm.warp(block.timestamp + 90);
        uint256 id = _mintAs(miner); // must not revert
        assertEq(md.ownerOf(id), miner);
    }

    function _removeAll() private view returns (ModifyLiquidityParams memory) {
        return ModifyLiquidityParams(
            TickMath.minUsableTick(IMD_SPACING), TickMath.maxUsableTick(IMD_SPACING), -int256(_imdLiquidity()), bytes32(0)
        );
    }

    function _imdLiquidity() private view returns (uint256) {
        return FullMath.mulDiv(100 ether, IMD_SQRT_PRICE, FixedPoint96.Q96);
    }
}
```

Add these imports at the top of the test file: `import {FixedPoint96} from "v4-core/src/libraries/FixedPoint96.sol"; import {FullMath} from "v4-core/src/libraries/FullMath.sol"; import {TickMath} from "v4-core/src/libraries/TickMath.sol"; import {ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";`. The fixture opened the IMD position from the test contract through the router, so the test contract owns it and can remove it the same way.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `forge test --match-contract MetamorphDutiesTest -vv`
Expected: `dutiesDue` not found.

- [ ] **Step 3: Replace the `_duties` stub**

```solidity
    // ------------------------------------------------------------------ the vault's duties

    /// @notice Which duties a mint would run right now: the hook's flush, the vault's burn, the pot's
    /// conversion. The keeper reads the same.
    function dutiesDue() public view returns (bool flushDue, bool burnDue, bool convertDue) {
        flushDue = POOL_MANAGER.balanceOf(address(HOOK), 0) >= MIN_FLUSH;
        burnDue = COCOON.wired() && COCOON.burnPot() >= MIN_BURN
            && block.number >= COCOON.lastBurnBlock() + COCOON.getParams().burnSpacing;
        convertDue = pot >= 2 * mintPrice() || ethPot != 0;
    }

    /// @dev Inside a mint, when gas is cheap: each duty in a try with a gas allowance, so none of them can
    /// fail the mint. The burn's ETH reward and the conversion's IMD reward go to the miner.
    function _duties(address miner_) internal override {
        if (block.basefee > DUTY_MAX_BASEFEE) return;
        (bool flushDue, bool burnDue, bool convertDue) = dutiesDue();
        if (flushDue) {
            try HOOK.flush{gas: DUTY_GAS}() {
                emit DutyRun(0, 0);
            } catch {}
        }
        if (burnDue) {
            uint256 before = address(this).balance;
            try COCOON.burn{gas: DUTY_GAS}() {
                uint256 got = address(this).balance - before;
                if (got != 0) _pay(miner_, got);
                emit DutyRun(1, got);
            } catch {}
        }
        if (convertDue) {
            try this.convertDuty{gas: CONVERT_GAS}(miner_) returns (uint256 bought) {
                emit DutyRun(2, bought * CALLER_REWARD_BPS / BPS);
            } catch {}
        }
    }
```

Remove the `virtual` stub `_duties` from Task 3 and drop `override` here (one definition), or keep the stub `virtual` and this one `override`; either compiles. `POOL_MANAGER.balanceOf(address,uint256)` is the ERC-6909 claims balance; `IPoolManager` inherits it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `forge test --match-contract MetamorphDutiesTest -vv`
Expected: 6 passed. If `test_mintBurnsForTheVaultAndPaysTheMinerTheReward` finds `burnDue` false, the launch window is still open (the fixture's `_endLaunch` must run before the deposit) or the spacing has not passed (`vm.roll(block.number + 10)` must follow the deposit).

- [ ] **Step 5: Commit**

```bash
git add src/metamorph/MetamorphMD.sol test/metamorph/MetamorphDuties.t.sol
git commit -m "metamorph: a mint runs the vault's due duties when gas is cheap and pays the miner"
```

---

### Task 8: Invariants

**Files:**
- Create: `test/metamorph/MetamorphHandler.sol`, `test/metamorph/Metamorph.invariant.t.sol`

**Interfaces:**
- Consumes: everything above; `CocoonFixture` helpers.

- [ ] **Step 1: Write the handler**

```solidity
// test/metamorph/MetamorphHandler.sol
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {Cocoon} from "../../src/Cocoon.sol";
import {PupateToken} from "../../src/PupateToken.sol";
import {MetamorphMD} from "../../src/metamorph/MetamorphMD.sol";
import {MockERC721} from "../mocks/MockERC721.sol";

/// @dev Drives Metamorph MD with valid actions only (the suite fails on revert): mints with real
/// proofs, stakes, unstakes, claims, converts, sells seats, and moves the clock and the chain.
contract MetamorphHandler is Test {
    MetamorphMD public md;
    Cocoon public cocoon;
    PupateToken public token;
    MockERC721 public collection;
    address[] public actors;
    uint256[] public seats;
    address public sink;

    uint256 public feesPaid;
    uint256 public pupateSold;
    mapping(uint256 id => uint8) public lastStage;
    uint256[] public minted;

    constructor(MetamorphMD md_, Cocoon cocoon_, PupateToken token_, MockERC721 collection_, address[] memory actors_, uint256[] memory seats_, address sink_) {
        md = md_;
        cocoon = cocoon_;
        token = token_;
        collection = collection_;
        actors = actors_;
        seats = seats_;
        sink = sink_;
    }

    function mint(uint256 who, uint256 dt) external {
        address a = actors[who % actors.length];
        if (md.totalMinted() >= md.MAX_SUPPLY() || md.mineableSeats().length == 0) return;
        if (token.balanceOf(a) < md.mintPrice()) return;
        vm.roll(block.number + 1);
        vm.warp(block.timestamp + bound(dt, 1, 600));
        uint256 anchor = block.number - 1;
        bytes32 ah = blockhash(anchor);
        uint256 t = md.target();
        uint256 nonce = 1;
        while (uint256(md.workHash(ah, a, nonce)) >= t) nonce++;
        uint256 price = md.mintPrice();
        vm.prank(a);
        uint256 id = md.mint(anchor, nonce);
        feesPaid += price;
        minted.push(id);
        lastStage[id] = md.stageOf(id);
    }

    function stake(uint256 who, uint256 pick) external {
        address a = actors[who % actors.length];
        if (minted.length == 0) return;
        uint256 id = minted[pick % minted.length];
        if (md.ownerOf(id) != a) return;
        (address staker,,) = md.stakeOf(id);
        if (staker != address(0)) return;
        uint256[] memory ids = new uint256[](1);
        ids[0] = id;
        vm.prank(a);
        md.stake(ids);
    }

    function unstake(uint256 pick) external {
        if (minted.length == 0) return;
        uint256 id = minted[pick % minted.length];
        (address staker,,) = md.stakeOf(id);
        if (staker == address(0)) return;
        uint256[] memory ids = new uint256[](1);
        ids[0] = id;
        vm.prank(staker);
        md.unstake(ids);
    }

    function claim(uint256 pick) external {
        if (minted.length == 0) return;
        uint256 id = minted[pick % minted.length];
        (address staker,,) = md.stakeOf(id);
        uint256[] memory ids = new uint256[](staker == address(0) ? 0 : 1);
        if (staker != address(0)) ids[0] = id;
        address who = staker == address(0) ? actors[pick % actors.length] : staker;
        vm.prank(who);
        md.claim(ids);
    }

    function convert(uint256 who) external {
        if (md.pot() == 0 && md.ethPot() == 0) return;
        uint256 potBefore = md.pot();
        vm.prank(actors[who % actors.length]);
        try md.convert() {
            pupateSold += potBefore - md.pot();
        } catch (bytes memory reason) {
            // NothingBought is a legitimate outcome of an exhausted bound; anything else is a bug.
            require(bytes4(reason) == MetamorphMD.NothingBought.selector, "convert reverted");
        }
    }

    function sellSeat(uint256 pick) external {
        uint256 seat = seats[pick % seats.length];
        (,,,,, bool held,) = cocoon.seats(seat);
        if (!held || collection.ownerOf(seat) != address(cocoon)) return;
        vm.prank(address(cocoon));
        collection.transferFrom(address(cocoon), sink, seat);
        cocoon.settleSeat(seat);
    }

    function pass(uint256 dt) external {
        vm.warp(block.timestamp + bound(dt, 1, 30 days));
        vm.roll(block.number + 1);
    }

    function mintedCount() external view returns (uint256) {
        return minted.length;
    }
}
```

- [ ] **Step 2: Write the invariant suite**

```solidity
// test/metamorph/Metamorph.invariant.t.sol
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MetamorphFixture} from "./MetamorphFixture.sol";
import {MetamorphHandler} from "./MetamorphHandler.sol";

contract MetamorphInvariantTest is MetamorphFixture {
    MetamorphHandler handler;
    uint256[] seatList;

    function setUp() public override {
        super.setUp();
        _endLaunch();
        vm.fee(1 gwei);
        address[] memory actors = new address[](3);
        actors[0] = miner;
        actors[1] = makeAddr("actor1");
        actors[2] = makeAddr("actor2");
        seatList.push(1376);
        for (uint256 s = 2; s <= 4; s++) {
            _giveSeat(s);
            md.noteSeat(s);
            seatList.push(s);
        }
        for (uint256 i; i < actors.length; i++) {
            token.transfer(actors[i], 200_000_000 ether);
            vm.prank(actors[i]);
            token.approve(address(md), type(uint256).max);
            vm.deal(actors[i], 1 ether);
        }
        handler = new MetamorphHandler(md, cocoon, token, collection, actors, seatList, other);
        targetContract(address(handler));
    }

    function invariant_prevWorkIsTheLastProof() public view {
        uint256 n = md.totalMinted();
        if (n == 0) {
            assertEq(md.prevWork(), md.DOMAIN());
            return;
        }
        (,,,,,, bytes32 work,) = md.cards(n);
        assertEq(md.prevWork(), work);
    }

    function invariant_editionsAndSupplyHold() public view {
        assertLe(md.totalMinted(), 3333);
        for (uint256 i; i < seatList.length; i++) {
            for (uint16 r; r < 3; r++) {
                assertLe(md.editionsMinted(seatList[i], r), 303);
            }
        }
    }

    function invariant_potIsSeventyPercentOfFeesLessWhatWasSold() public view {
        assertEq(md.pot(), handler.feesPaid() * 7000 / 10_000 - handler.pupateSold());
        assertEq(token.balanceOf(address(md)), md.pot());
    }

    function invariant_imdOwedIsCovered() public view {
        assertLe(md.imdOwed(), imd.balanceOf(address(md)));
    }

    function invariant_ethEqualsTheEthPot() public view {
        assertEq(address(md).balance, md.ethPot());
    }

    function invariant_stagesNeverGoBack() public {
        uint256 n = handler.mintedCount();
        for (uint256 i; i < n; i++) {
            uint256 id = handler.minted(i);
            uint8 now_ = md.stageOf(id);
            assertGe(now_, handler.lastStage(id));
        }
    }

    function invariant_targetIsNeverAboveTheCeiling() public view {
        uint256 epoch_ = md.epoch();
        uint256 shift = uint256(md.MIN_BITS()) + epoch_ - 1;
        assertLe(md.target(), type(uint256).max >> shift);
    }
}
```

The handler records `lastStage` at the mint; `invariant_stagesNeverGoBack` compares against it (0 then, so it checks nothing goes below 0, which is trivially true) — make it meaningful: in the handler's `pass` and `sellSeat`, after acting, refresh `lastStage[id] = max(lastStage[id], md.stageOf(id))` for every minted id, and in the invariant assert `md.stageOf(id) >= lastStage[id]`. Add this helper to the handler and call it at the end of `pass` and `sellSeat`:

```solidity
    function _refreshStages() private {
        for (uint256 i; i < minted.length; i++) {
            uint8 s = md.stageOf(minted[i]);
            if (s > lastStage[minted[i]]) lastStage[minted[i]] = s;
        }
    }
```

- [ ] **Step 3: Run the invariants**

Run: `forge test --match-contract MetamorphInvariantTest -vv`
Expected: 7 invariants pass over 48 runs × 48 depth (the repo's config). A failing `invariant_potIsSeventyPercent…` means a mint's conversion duty sold PUPATE the handler did not count: count it by reading `md.pot()` before and after each `mint` in the handler and adding the drop beyond the 70% credit to `pupateSold`. Do that from the start:

```solidity
        uint256 potBefore = md.pot();
        vm.prank(a);
        uint256 id = md.mint(anchor, nonce);
        feesPaid += price;
        uint256 expected = potBefore + price * 7000 / 10_000;
        if (md.pot() < expected) pupateSold += expected - md.pot();
```

- [ ] **Step 4: Commit**

```bash
git add test/metamorph/MetamorphHandler.sol test/metamorph/Metamorph.invariant.t.sol
git commit -m "metamorph: invariants over mints, staking, conversions and seat sales"
```

---

### Task 9: Size and interface checks

**Files:**
- Test: `test/metamorph/MetamorphSize.t.sol`

- [ ] **Step 1: Write the test**

```solidity
// test/metamorph/MetamorphSize.t.sol
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MetamorphFixture} from "./MetamorphFixture.sol";

contract MetamorphSizeTest is MetamorphFixture {
    function test_underTheContractSizeLimit() public view {
        assertLe(address(md).code.length, 24_576, "MetamorphMD runtime");
        assertLe(address(art).code.length, 24_576, "art runtime");
    }

    function test_noOwnerNoSetters() public {
        // The ABI has no owner, setter, pause, upgrade or withdraw: these selectors do not exist.
        bytes4[6] memory selectors = [
            bytes4(keccak256("owner()")),
            bytes4(keccak256("setArt(address)")),
            bytes4(keccak256("setPrice(uint256)")),
            bytes4(keccak256("pause()")),
            bytes4(keccak256("withdraw(uint256)")),
            bytes4(keccak256("sweep(address)"))
        ];
        for (uint256 i; i < selectors.length; i++) {
            (bool ok,) = address(md).call(abi.encodeWithSelector(selectors[i]));
            assertFalse(ok);
        }
    }
}
```

- [ ] **Step 2: Run it and record the size**

Run: `forge test --match-contract MetamorphSizeTest -vv && forge build --sizes 2>/dev/null | grep -i "metamorph\|erc721lite"`
Expected: pass; note the runtime size in the commit message. If `MetamorphMD` is over 24,576: move `priceAt`'s loop to a lookup of the eleven constants, shorten revert paths, and as a last resort drop `notedSeats()` (the page can read `SeatNoted` events).

- [ ] **Step 3: Commit**

```bash
git add test/metamorph/MetamorphSize.t.sol
git commit -m "metamorph: size and no-keys checks (MetamorphMD <size> bytes)"
```

---

### Task 10: The mainnet fork test

**Files:**
- Create: `test/fork/Metamorph.fork.t.sol`

**Interfaces:**
- Consumes: mainnet addresses from `keeper/addresses.mainnet.json` (hard-coded below), the real `Cocoon`, `PupateHook`, `PupateToken`, IMD, identity.md, PoolManager; the ETH/IMD pool key `(ETH, IMD, 10000, 200, no hook)`.

- [ ] **Step 1: Write the test**

```solidity
// test/fork/Metamorph.fork.t.sol
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {Currency, CurrencyLibrary} from "v4-core/src/types/Currency.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Cocoon} from "../../src/Cocoon.sol";
import {FloorFeed} from "../../src/FloorFeed.sol";
import {PupateHook} from "../../src/PupateHook.sol";
import {PupateToken} from "../../src/PupateToken.sol";
import {IERC20Minimal} from "../../src/interfaces/IERC20Minimal.sol";
import {IERC721Minimal} from "../../src/interfaces/IERC721Minimal.sol";
import {IMetamorphArt} from "../../src/interfaces/IMetamorphArt.sol";
import {MetamorphMD} from "../../src/metamorph/MetamorphMD.sol";
import {OracleAttestation} from "../../src/oracle/OracleAttestation.sol";
import {StubArt} from "../mocks/StubArt.sol";

/// @dev The whole flow on a fork of mainnet: the real vault, hook, token, IMD, collection and both
/// pools. Skipped without MAINNET_RPC_URL. The vault is given a seat (a holder hands it over and the
/// vault adopts it after a fresh floor from a test attester), a card is mined and minted with duties,
/// the pot is converted through the real pools, a staker claims IMD, the seat is sold, the card emerges.
contract MetamorphForkTest is Test {
    Cocoon constant COCOON = Cocoon(payable(0x54993066369e57a49215f6fc2D9911a8e5a57a79));
    PupateHook constant HOOK = PupateHook(payable(0xb5e544166144a590e171bf0350e8f227858318cc));
    PupateToken constant PUPATE = PupateToken(0x59fb66660626a6a2c7e0e1a39af1367d09ed92b0);
    FloorFeed constant FEED = FloorFeed(0x5A215aa9883cEfE5fa74085ba66288388b83700C);
    address constant TIMELOCK = 0x8bE826082c0FbAeC485048aA26ef42aC147898EC;
    address constant IMD = 0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7;
    address constant COLLECTION = 0x0000eC93127BAA929E58E97dd0095A2BFb38ec1D;
    IPoolManager constant MANAGER = IPoolManager(0x000000000004444c5dc75cB358380D2e3dE08A90);
    uint256 constant ATTESTER_KEY = 0xA11CE;

    MetamorphMD md;
    address miner = makeAddr("miner");
    uint256 seat;
    address holder;

    function setUp() public {
        string memory rpc = vm.envOr("MAINNET_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);

        PoolKey memory pupateKey = PoolKey(CurrencyLibrary.ADDRESS_ZERO, Currency.wrap(address(PUPATE)), 12500, 60, IHooks(address(HOOK)));
        PoolKey memory imdKey = PoolKey(CurrencyLibrary.ADDRESS_ZERO, Currency.wrap(IMD), 10000, 200, IHooks(address(0)));
        md = new MetamorphMD(
            COCOON, HOOK, PUPATE, IERC20Minimal(IMD), IERC721Minimal(COLLECTION), MANAGER, pupateKey, imdKey,
            IMetamorphArt(address(new StubArt())), 1
        );

        // A fresh floor from a test attester, so the vault can adopt a seat.
        vm.prank(TIMELOCK);
        FEED.setAttester(vm.addr(ATTESTER_KEY));
        _report(2.5 ether);

        // Any seat whose holder is an EOA: hand it to the vault, then adopt.
        seat = _findSeat();
        vm.prank(holder);
        IERC721Minimal(COLLECTION).transferFrom(holder, address(COCOON), seat);
        COCOON.adopt(seat);
        md.noteSeat(seat);

        // The miner buys PUPATE from a whale: the pool itself is fine but a direct deal is simpler.
        deal(address(PUPATE), miner, 50_000_000 ether);
        vm.prank(miner);
        PUPATE.approve(address(md), type(uint256).max);
        vm.deal(miner, 1 ether);
        vm.roll(block.number + 1);
    }

    function test_mintConvertStakeEmergeOnMainnet() public {
        if (address(md) == address(0)) return;
        vm.fee(1 gwei);
        uint256 a = block.number - 1;
        bytes32 ah = blockhash(a);
        uint256 nonce = 1;
        while (uint256(md.workHash(ah, miner, nonce)) >= md.target()) nonce++;
        vm.prank(miner);
        uint256 id = md.mint(a, nonce);
        (uint32 s,,,,,,,) = md.cards(id);
        assertEq(s, seat);
        assertEq(md.stageOf(id), 0);

        // Stake, then convert through the real pools.
        uint256[] memory ids = new uint256[](1);
        ids[0] = id;
        vm.prank(miner);
        md.stake(ids);
        for (uint256 i; i < 2; i++) {
            vm.roll(block.number + 1);
            vm.warp(block.timestamp + 90);
            a = block.number - 1;
            ah = blockhash(a);
            nonce = 1;
            while (uint256(md.workHash(ah, miner, nonce)) >= md.target()) nonce++;
            vm.prank(miner);
            md.mint(a, nonce);
        }
        uint256 out = md.convert();
        assertGt(out, 0, "IMD bought on mainnet");
        vm.prank(miner);
        uint256 paid = md.claim(ids);
        assertGt(paid, 0, "the staker got IMD");
        assertEq(address(md).balance, md.ethPot());

        // The vault sells the seat: the card emerges.
        vm.prank(address(COCOON));
        IERC721Minimal(COLLECTION).transferFrom(address(COCOON), holder, seat);
        COCOON.settleSeat(seat);
        assertEq(md.stageOf(id), 1);
    }

    /// @dev Signs a floor report the way CocoonFixture does, against the real FloorFeed's domain.
    function _report(uint256 floorWei) private {
        OracleAttestation.Attestation memory att = OracleAttestation.Attestation({
            requestId: keccak256("fork"),
            questionHash: FEED.questionHash(),
            answerType: 3,
            answer: abi.encode(floorWei),
            chainId: FEED.EVIDENCE_CHAIN_ID(),
            fromBlock: uint64(block.number - 100),
            toBlock: uint64(block.number - 1),
            panelSize: 20,
            quorum: 11,
            agreed: 20,
            issuedAt: uint64(block.timestamp),
            validUntil: uint64(block.timestamp + 6 hours)
        });
        bytes32 digest = FEED.digest(att);
        (uint8 v, bytes32 r, bytes32 sVal) = vm.sign(ATTESTER_KEY, digest);
        FEED.report(att, abi.encodePacked(r, sVal, v));
    }

    /// @dev Walks token ids until one is held by an EOA.
    function _findSeat() private returns (uint256) {
        for (uint256 id = 1; id < 400; id++) {
            try IERC721Minimal(COLLECTION).ownerOf(id) returns (address o) {
                if (o.code.length == 0 && o != address(0)) {
                    holder = o;
                    return id;
                }
            } catch {}
        }
        revert("no seat");
    }
}
```

The attestation struct fields and `FEED.digest(...)`, `FEED.questionHash()`, `FEED.EVIDENCE_CHAIN_ID()` must match `src/FloorFeed.sol` and `src/oracle/OracleAttestation.sol`: open them and copy the exact field names and the digest helper the existing `CocoonFixture._setFloor` uses (it signs the same way); if the fixture signs through a helper, reuse that helper's code here verbatim.

- [ ] **Step 2: Run it**

Run: `forge test --match-contract MetamorphForkTest -vvv`
Expected: 1 passed against the fork (needs `MAINNET_RPC_URL` in the environment; `set -a; . ./.env; set +a` in Git Bash loads it without printing it). Without the variable the test passes trivially (it returns early).

- [ ] **Step 3: Commit**

```bash
git add test/fork/Metamorph.fork.t.sol
git commit -m "metamorph: the whole flow against the real vault and pools on a mainnet fork"
```

---

### Task 11: The deploy script

**Files:**
- Create: `script/DeployMetamorph.s.sol`
- Modify: `script/mainnet/README.md` (a section "Metamorph MD"), `keeper/addresses.mainnet.json` (fields `metamorph`, `metamorphArt` added after deployment, not now)

- [ ] **Step 1: Write the script**

```solidity
// script/DeployMetamorph.s.sol
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {Currency, CurrencyLibrary} from "v4-core/src/types/Currency.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Cocoon} from "../src/Cocoon.sol";
import {PupateHook} from "../src/PupateHook.sol";
import {PupateToken} from "../src/PupateToken.sol";
import {IERC20Minimal} from "../src/interfaces/IERC20Minimal.sol";
import {IERC721Minimal} from "../src/interfaces/IERC721Minimal.sol";
import {IMetamorphArt} from "../src/interfaces/IMetamorphArt.sol";
import {MetamorphMD} from "../src/metamorph/MetamorphMD.sol";

/// @notice Deploys Metamorph MD against the live contracts. Env: COCOON, HOOK, PUPATE, IMD, COLLECTION,
/// POOL_MANAGER, ART (the renderer, deployed first by its own script), MIN_BITS (20 on mainnet).
/// Pool keys: the launch pool (fee 12500, spacing 60, the hook) and the ETH/IMD pool (10000, 200, no hook).
contract DeployMetamorph is Script {
    function run() external returns (MetamorphMD md) {
        Cocoon cocoon = Cocoon(payable(vm.envAddress("COCOON")));
        PupateHook hook = PupateHook(payable(vm.envAddress("HOOK")));
        PupateToken pupate = PupateToken(vm.envAddress("PUPATE"));
        address imd = vm.envAddress("IMD");
        address collection = vm.envAddress("COLLECTION");
        IPoolManager manager = IPoolManager(vm.envAddress("POOL_MANAGER"));
        IMetamorphArt art = IMetamorphArt(vm.envAddress("ART"));
        uint8 minBits = uint8(vm.envUint("MIN_BITS"));
        require(minBits == 20, "mainnet floor is 20 bits");
        require(address(art).code.length != 0, "ART has no code");
        require(hook.sink() == address(cocoon), "hook sink is not the vault");

        PoolKey memory pupateKey = PoolKey(CurrencyLibrary.ADDRESS_ZERO, Currency.wrap(address(pupate)), 12500, 60, IHooks(address(hook)));
        PoolKey memory imdKey = PoolKey(CurrencyLibrary.ADDRESS_ZERO, Currency.wrap(imd), 10000, 200, IHooks(address(0)));

        vm.startBroadcast();
        md = new MetamorphMD(cocoon, hook, pupate, IERC20Minimal(imd), IERC721Minimal(collection), manager, pupateKey, imdKey, art, minBits);
        vm.stopBroadcast();

        console2.log("MetamorphMD", address(md));
        console2.log("target bits", md.bits());
        console2.log("mint price", md.mintPrice());
    }
}
```

- [ ] **Step 2: Dry-run it on a fork**

Run (Git Bash, with `.env` loaded): `COCOON=0x54993066369e57a49215f6fc2D9911a8e5a57a79 HOOK=0xb5e544166144a590e171bf0350e8f227858318cc PUPATE=0x59fb66660626a6a2c7e0e1a39af1367d09ed92b0 IMD=0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7 COLLECTION=0x0000eC93127BAA929E58E97dd0095A2BFb38ec1D POOL_MANAGER=0x000000000004444c5dc75cB358380D2e3dE08A90 ART=<a StubArt deployed on the fork, or any contract address for the dry run> MIN_BITS=20 forge script script/DeployMetamorph.s.sol --fork-url "$MAINNET_RPC_URL" -vv`
Expected: the script simulates, prints the address, bits 20 and the price 50000000000000000000000. No `--broadcast`: deployment waits for the art contract (next plan) and the review.

- [ ] **Step 3: Document and commit**

Add to `script/mainnet/README.md`:

```markdown
## Metamorph MD

After the art contract is deployed (its own script, next plan) and the review is clean:

    COCOON=… HOOK=… PUPATE=… IMD=… COLLECTION=… POOL_MANAGER=… ART=<art> MIN_BITS=20 \
    forge script script/DeployMetamorph.s.sol --rpc-url "$MAINNET_RPC_URL" --broadcast --private-key "$KEEPER_PRIVATE_KEY" -vv

Then record `metamorph` and `metamorphArt` in `keeper/addresses.mainnet.json` and `site/lib/addresses.ts`,
and call `noteSeat` for every seat the vault holds (the keeper does it on its next tick).
```

```bash
git add script/DeployMetamorph.s.sol script/mainnet/README.md
git commit -m "metamorph: the deploy script, dry-run on a fork"
```

---

### Task 12: Spec errata and the review

**Files:**
- Modify: `docs/superpowers/specs/2026-10-13-metamorph-md-design.md` (Interfaces section), `docs/REVIEW.md` (a new section after the review)

- [ ] **Step 1: Record what the implementation changed**

Under "Interfaces" in the spec, add a short "Errata from the implementation (2026-10-14)" list:

- `StaleWork` does not exist: a proof found against an older `prevWork` fails as `NotASolution`; the page tells the two apart by re-reading `prevWork`.
- `convertDuty(address)` is the self-call entry the mint uses for the conversion; `OnlySelf` guards it.
- `ethPot` holds ETH a conversion bought that the IMD pool could not absorb under the bound; the next conversion spends it first; the contract's ETH equals `ethPot` after every call.
- The art contract returns the whole token URI (`IMetamorphArt.tokenURI(View)`), not only the SVG.
- `noteSeat(seat)` and `notedSeats()`: Cocoon keeps no list of held seats, so the contract keeps a permissionless registry the page and the keeper feed.
- `Card.paid` stores the mint price for the attributes.
- Staking: `stake`, `unstake`, `claim(ids)`; `claim` settles only the ids given plus pays everything pending.

- [ ] **Step 2: Dispatch the independent review**

Use the Agent tool with a fresh general-purpose agent and this brief (no design reasoning, only the code): "Review `src/metamorph/*.sol` and `test/metamorph/*` in `C:\dev\imd project` as an adversarial auditor who has not seen the design. Focus: reentrancy across `mint` → duties → `convertDuty` → `unlockCallback`; the staking accumulator (rounding, reweigh, claim ordering); fee and pot accounting; the price-impact bounds; the seat pick and editions; anything a miner, a staker or a stranger can do to take funds or brick the contract. Write findings with severity and a PoC test for each HIGH/MEDIUM to `docs/REVIEW.md` under '## Metamorph MD (2026-10-14)'. Do not change `src/`." Fix every HIGH and MEDIUM, re-run the suite, and record the outcome in the same section.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-10-13-metamorph-md-design.md docs/REVIEW.md
git commit -m "metamorph: spec errata and the independent review's findings"
```

---

## Reference: the order of sections inside `MetamorphMD.sol` after Task 7

errors and events · constants · immutables · storage · modifier and constructor · `receive` · the work chain (reads) · the mint · stages, royalty, metadata · staking · the conversion · the vault's duties · internals (reads) · transient storage helpers. Keep `_duties` defined once (Task 7 replaces the Task 3 stub).

## Self-review (done while writing)

- Spec coverage: work chain ✓ (T3), seat pick ✓ (T3), fee split ✓ (T3), epochs/price/retarget ✓ (T3), gilt ✓ (T3), duties ✓ (T7), pot + convert ✓ (T6), staking + weights + no locks + lock-in-place ✓ (T5), stages + ceiling ✓ (T4), royalty ✓ (T4), tokenURI through the art ✓ (T4, renderer in the next plan), names ✓ (T2), no keys ✓ (T9), size ✓ (T9), invariants ✓ (T8), fork ✓ (T10), deploy ✓ (T11), review ✓ (T12). Not in this plan, by design: the renderer and the trait system (next plan), the miner and the page (third plan), the keeper's convert duty (third plan).
- Review Focus 1–5 are pinned: T3 `test_proofFromBeforeAnotherMintIsRefused`, T3 `test_reboughtSeatStartsItsOwnEditions` and `test_noMineableSeatMeansNoMint`, T5 `test_stakedCardCannotMoveByAnyPath`, T6 `test_convertLeavesWhatTheBoundRefuses`, T7 `test_failingDutyNeverRevertsTheMint`.
- Type consistency: `cards(id)` returns `(uint32 seat, uint16 round, uint16 edition, bool gilt, uint40 mintedAt, address miner, bytes32 work, uint96 paid)` everywhere; `stakeOf(id)` returns `(address, uint8, uint256)`; `dutiesDue()` returns three bools; `claim` returns the amount paid.
