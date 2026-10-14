// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Vm} from "forge-std/Vm.sol";
import {FixedPoint96} from "v4-core/src/libraries/FixedPoint96.sol";
import {FullMath} from "v4-core/src/libraries/FullMath.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {MetamorphFixture} from "./MetamorphFixture.sol";
import {Cocoon} from "../../src/Cocoon.sol";
import {PupateHook} from "../../src/PupateHook.sol";
import {PupateToken} from "../../src/PupateToken.sol";
import {IERC721TokenReceiver} from "../../src/metamorph/ERC721Lite.sol";
import {MetamorphMD} from "../../src/metamorph/MetamorphMD.sol";

/// @dev A miner that is a contract with no way to take ETH: no `receive`, no `fallback`. It accepts the
/// card, which the mint delivers with the receiver check.
contract EthRejectingMiner {
    MetamorphMD internal immutable md;

    constructor(MetamorphMD md_, PupateToken token_) {
        md = md_;
        token_.approve(address(md_), type(uint256).max);
    }

    function mint(uint256 anchor, uint256 nonce) external returns (uint256) {
        return md.mint(anchor, nonce);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721TokenReceiver.onERC721Received.selector;
    }
}

contract MetamorphDutiesTest is MetamorphFixture {
    function setUp() public override {
        super.setUp();
        _endLaunch();
        vm.fee(1 gwei);
    }

    function _mintMany(uint256 n) private {
        for (uint256 i; i < n; i++) {
            vm.roll(block.number + 1);
            vm.warp(block.timestamp + 90);
            _mintAs(miner);
        }
    }

    /// @dev Three mints put 105,000 PUPATE in the pot, over twice the price of 50,000. A mint runs its
    /// duties once its own fee is in the pot, so cheap mints would convert it on the third; while gas is
    /// dear they leave it whole. Gas is cheap again afterwards.
    function _fillThePot() private {
        vm.fee(3 gwei);
        _mintMany(3);
        vm.fee(1 gwei);
    }

    function test_nothingDueRunsNothing() public {
        (bool f, bool b, bool c) = md.dutiesDue();
        assertFalse(f || b || c);
        vm.recordLogs();
        _mintAs(miner);
        // No DutyRun event among the logs. Reading the logs consumes them, so they are read once.
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertGt(logs.length, 0);
        bytes32 sig = keccak256("DutyRun(uint8,uint256)");
        for (uint256 i; i < logs.length; i++) {
            assertTrue(logs[i].topics[0] != sig);
        }
    }

    function test_mintFlushesTheHookWhenClaimsAreDue() public {
        _buyExactIn(1 ether); // 6% tax waits in the hook
        assertGe(_claims(), 0.005 ether);
        (bool f,,) = md.dutiesDue();
        assertTrue(f);
        uint256 burnPot = cocoon.burnPot();
        vm.expectEmit(false, false, false, true);
        emit MetamorphMD.DutyRun(0, 0);
        _mintAs(miner);
        assertEq(_claims(), 0);
        assertGt(cocoon.burnPot(), burnPot, "the tax reached the vault");
    }

    function test_claimsUnderTheMinimumWaitInTheHook() public {
        _buyExactIn(0.05 ether); // 6% tax: 0.003 ETH of claims, under the 0.005 minimum
        uint256 claims = _claims();
        assertGt(claims, 0);
        (bool f,,) = md.dutiesDue();
        assertFalse(f);
        _mintAs(miner);
        assertEq(_claims(), claims, "the mint left them");
    }

    function test_mintBurnsForTheVaultAndPaysTheMinerTheReward() public {
        _deposit(1 ether); // the vault is accumulating: 0.255 ETH of it reaches the burn pot
        vm.roll(block.number + 10);
        (, bool b,) = md.dutiesDue();
        assertTrue(b);
        uint256 before = miner.balance;
        uint256 potBefore = cocoon.burnPot();
        vm.recordLogs();
        _mintAs(miner);
        assertLt(cocoon.burnPot(), potBefore, "the vault burned");
        assertGt(miner.balance, before, "the miner got the caller reward");
        assertEq(miner.balance - before, _paid(vm.getRecordedLogs(), 1), "as the duty reports");
        assertEq(address(md).balance, md.ethPot(), "nothing stays behind");
    }

    function test_burnIsNotDueInsideTheVaultsSpacing() public {
        _deposit(1 ether);
        cocoon.burn(); // anyone may burn; the vault's next burn waits out its spacing
        _deposit(1 ether); // and the burn pot is deep again
        (, bool b,) = md.dutiesDue();
        assertFalse(b, "the vault burned in this block");
        vm.roll(block.number + cocoon.getParams().burnSpacing - 1);
        (, b,) = md.dutiesDue();
        assertFalse(b, "one block short");
        vm.roll(block.number + 1);
        (, b,) = md.dutiesDue();
        assertTrue(b, "due once the vault's spacing has passed");
    }

    function test_mintConvertsWhenThePotIsTwoPricesDeep() public {
        _fillThePot();
        (,, bool c) = md.dutiesDue();
        assertTrue(c, "pot of 105k PUPATE is over twice the price");
        vm.roll(block.number + 1);
        vm.warp(block.timestamp + 90);
        vm.recordLogs();
        _mintAs(miner);
        assertLt(md.pot(), 50_000 ether, "the pot was converted inside the mint");
        assertGt(imd.balanceOf(miner), 0, "the miner got the conversion reward");
        assertEq(imd.balanceOf(miner), _paid(vm.getRecordedLogs(), 2), "as the duty reports");
    }

    /// @dev A conversion inside the spacing reverts `TooSoon`, so the view waits the spacing out too and a
    /// mint never tries one.
    function test_convertIsNotDueUntilTheSpacingHasPassed() public {
        _mintMany(2);
        vm.prank(keeper);
        md.convert();
        uint256 last = md.lastConvertBlock();
        // Three mints refill the pot past twice the price inside the spacing; none of them tries to convert.
        vm.expectCall(address(md), abi.encodeCall(md.convertDuty, (miner)), 0);
        _mintMany(3);
        assertGe(md.pot(), 2 * md.mintPrice(), "deep enough");
        (,, bool c) = md.dutiesDue();
        assertFalse(c, "but the spacing has not passed");
        vm.roll(last + md.CONVERT_SPACING() - 1);
        (,, c) = md.dutiesDue();
        assertFalse(c, "one block short");
        vm.roll(last + md.CONVERT_SPACING());
        (,, c) = md.dutiesDue();
        assertTrue(c, "due once the spacing has passed");
    }

    function test_ethWaitingFromARefusedBuyMakesTheConversionDue() public {
        _mintMany(2); // 70,000 PUPATE, under twice the price
        // Thin the IMD pool to 0.01% of its depth: a 1.5% move of its price then absorbs less ETH than the
        // sale brings, so the buy leaves ETH waiting.
        router.addLiquidity(imdKey, _imdPosition(-int256(_imdLiquidity() * 9999 / 10_000)));
        vm.prank(keeper);
        md.convert();
        assertEq(md.pot(), 0, "the whole pot was sold");
        assertGt(md.ethPot(), 0, "ETH waits");
        vm.roll(block.number + md.CONVERT_SPACING());
        (,, bool c) = md.dutiesDue();
        assertTrue(c, "the waiting ETH alone makes the conversion due");
    }

    function test_expensiveGasSkipsEveryDuty() public {
        _buyExactIn(1 ether);
        vm.fee(3 gwei);
        _mintAs(miner);
        assertGt(_claims(), 0, "flush skipped at 3 gwei");
    }

    function test_theBaseFeeLimitItselfIsCheap() public {
        _buyExactIn(1 ether);
        vm.fee(md.DUTY_MAX_BASEFEE());
        _mintAs(miner);
        assertEq(_claims(), 0, "flushed at exactly 2 gwei");
    }

    function test_failingDutyNeverRevertsTheMint() public {
        // A conversion that finds nothing to buy reverts: once the pot is due, drain the IMD pool's
        // liquidity so swap two buys nothing.
        _fillThePot();
        router.addLiquidity(imdKey, _imdPosition(-int256(_imdLiquidity())));
        (,, bool c) = md.dutiesDue();
        assertTrue(c);
        uint256 potBefore = md.pot();
        // The conversion is tried, with its gas allowance.
        vm.expectCall(address(md), 0, uint64(md.CONVERT_GAS()), abi.encodeCall(md.convertDuty, (miner)));
        vm.roll(block.number + 1);
        vm.warp(block.timestamp + 90);
        uint256 id = _mintAs(miner); // must not revert
        assertEq(md.ownerOf(id), miner);
        assertEq(md.pot(), potBefore + 35_000 ether, "the failed conversion left the pot whole");
    }

    function test_aFlushOrABurnThatRevertsNeverRevertsTheMint() public {
        _buyExactIn(1 ether);
        _deposit(1 ether);
        (bool f, bool b,) = md.dutiesDue();
        assertTrue(f && b, "the flush and the burn are due");
        // Both revert when called: the hook as if its claims were gone, the vault as if it had just burned.
        vm.mockCallRevert(
            address(hook),
            abi.encodeCall(hook.flush, ()),
            abi.encodeWithSelector(PupateHook.NothingToFlush.selector)
        );
        vm.mockCallRevert(
            address(cocoon), abi.encodeCall(cocoon.burn, ()), abi.encodeWithSelector(Cocoon.TooSoon.selector)
        );
        // Each is tried, with its gas allowance.
        vm.expectCall(address(hook), 0, uint64(md.DUTY_GAS()), abi.encodeCall(hook.flush, ()));
        vm.expectCall(address(cocoon), 0, uint64(md.DUTY_GAS()), abi.encodeCall(cocoon.burn, ()));
        uint256 claims = _claims();
        uint256 burnPot = cocoon.burnPot();
        uint256 balance = miner.balance;
        uint256 id = _mintAs(miner);
        assertEq(md.ownerOf(id), miner, "the miner still got the card");
        assertEq(_claims(), claims, "the claims wait in the hook");
        assertEq(cocoon.burnPot(), burnPot, "the burn pot is whole");
        assertEq(miner.balance, balance, "and nothing was paid");
    }

    function test_aMinerThatRejectsEthStillGetsTheCard() public {
        EthRejectingMiner cm = new EthRejectingMiner(md, token);
        deal(address(token), address(cm), 100_000 ether);
        _deposit(1 ether);
        (, bool b,) = md.dutiesDue();
        assertTrue(b, "a burn is due");
        uint256 burnPot = cocoon.burnPot();
        uint256 held = address(md).balance;
        uint256 a = _anchor();
        uint256 n = _proof(address(cm), a);
        vm.recordLogs();
        uint256 id = cm.mint(a, n);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(md.ownerOf(id), address(cm), "the miner got the card");
        assertLt(cocoon.burnPot(), burnPot, "the vault burned");
        assertEq(_paid(logs, 1), 0, "the duty reports nothing paid");
        uint256 reward = _burnReward(logs);
        assertGt(reward, 0);
        assertEq(address(md).balance - held, reward, "the reward stays in the contract");
        // And the next conversion spends it with the rest of the ETH it holds.
        vm.prank(keeper);
        md.convert();
        assertEq(address(md).balance, 0, "spent by the next conversion");
    }

    /// @dev The caller reward of the vault's burn among `logs`; fails when there is none.
    function _burnReward(Vm.Log[] memory logs) private view returns (uint256 reward) {
        bytes32 sig = keccak256("Burned(uint256,uint256,address,uint256)");
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter != address(cocoon) || logs[i].topics[0] != sig) continue;
            (,, reward) = abi.decode(logs[i].data, (uint256, uint256, uint256));
            return reward;
        }
        revert("no Burned");
    }

    /// @dev What the DutyRun of `kind` among `logs` reports paid; fails when there is none.
    function _paid(Vm.Log[] memory logs, uint8 kind) private view returns (uint256) {
        bytes32 sig = keccak256("DutyRun(uint8,uint256)");
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter != address(md) || logs[i].topics[0] != sig) continue;
            (uint8 k, uint256 paid) = abi.decode(logs[i].data, (uint8, uint256));
            if (k == kind) return paid;
        }
        revert("no DutyRun of that kind");
    }

    /// @dev A change to the fixture's IMD position: full range, held by the router at salt 0.
    function _imdPosition(int256 liquidityDelta) private pure returns (ModifyLiquidityParams memory) {
        return ModifyLiquidityParams(
            TickMath.minUsableTick(IMD_SPACING),
            TickMath.maxUsableTick(IMD_SPACING),
            liquidityDelta,
            bytes32(0)
        );
    }

    /// @dev The fixture's IMD position: about 100 ETH deep at the opening price.
    function _imdLiquidity() private pure returns (uint256) {
        return FullMath.mulDiv(100 ether, IMD_SQRT_PRICE, FixedPoint96.Q96);
    }
}
