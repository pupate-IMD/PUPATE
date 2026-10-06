// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {BalanceDelta, toBalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {PoolId} from "v4-core/src/types/PoolId.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {PupateHook} from "../src/PupateHook.sol";
import {PupateToken} from "../src/PupateToken.sol";
import {HookFixture} from "./utils/HookFixture.sol";

contract PupateHookTest is HookFixture {
    // ------------------------------------------------------------------ construction

    function test_addressEncodesExactlyTheDeclaredPermissions() public view {
        assertEq(uint160(address(hook)) & Hooks.ALL_HOOK_MASK, HOOK_FLAGS);
        Hooks.Permissions memory p = hook.getHookPermissions();
        assertTrue(p.afterInitialize && p.beforeSwap && p.afterSwap);
        assertTrue(p.beforeSwapReturnDelta && p.afterSwapReturnDelta);
        assertFalse(p.beforeInitialize || p.beforeAddLiquidity || p.afterAddLiquidity);
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
    }

    function test_aSecondNativePoolIsNeitherTheLaunchPoolNorTaxed() public {
        _endLaunch();
        PupateToken other = new PupateToken();
        other.approve(address(router), type(uint256).max);
        PoolKey memory second = _ethPool(address(other), address(hook));
        _open(second, POOL_SHARE);

        assertEq(PoolId.unwrap(hook.launchPool()), PoolId.unwrap(key.toId()));
        assertEq(hook.openedAt(), T0);

        _swap(router, second, true, -1 ether);
        assertEq(_claims(), 0);
        assertEq(hook.totalTax(), 0);
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
}
