// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {Cocoon} from "../../src/Cocoon.sol";
import {CocoonFixture} from "../utils/CocoonFixture.sol";

contract CocoonBurnTest is CocoonFixture {
    function setUp() public override {
        super.setUp();
        _endLaunch();
    }

    function _price() internal view returns (uint160 sqrtPrice) {
        (sqrtPrice,,,) = StateLibrary.getSlot0(manager, key.toId());
    }

    function _ready() internal {
        vm.roll(block.number + 5);
    }

    function test_aSmallBurnSpendsTheWholeBudgetAndPaysTheCaller() public {
        _buyExactIn(5 ether); // puts ETH in the pool; the tax waits in the hook
        _deposit(0.2 ether); // burn pot 0.085 ETH
        uint256 pot = cocoon.burnPot();
        uint256 swapBudget = pot * 9950 / 10_000;
        uint256 supplyBefore = token.totalSupply();
        uint256 claimsBefore = _claims();
        _ready();

        vm.prank(keeper);
        cocoon.burn();

        uint256 burned = supplyBefore - token.totalSupply();
        assertGt(burned, 0);
        uint256 reward = swapBudget * 50 / 10_000;
        assertEq(keeper.balance, 100 ether + reward);
        assertEq(cocoon.burnPot(), pot - swapBudget - reward, "the whole budget was spent");
        assertEq(token.balanceOf(address(cocoon)), 0, "nothing is kept");
        assertEq(_claims(), claimsBefore, "the vault's own swap is not taxed");
        assertEq(cocoon.lastBurnBlock(), block.number);
        _assertBalanceIdentity();
    }

    function test_aLargeBurnStopsAtTheImpactLimitAndKeepsTheRest() public {
        _buyExactIn(5 ether);
        _deposit(4 ether); // burn pot 1.7 ETH, far more than 5% of the pool
        uint256 pot = cocoon.burnPot();
        uint160 before = _price();
        uint160 limit = uint160(uint256(before) * 9746 / 10_000);
        _ready();

        vm.prank(keeper);
        cocoon.burn();

        uint160 after_ = _price();
        assertGe(after_, limit, "never through the limit");
        assertApproxEqRel(uint256(after_), uint256(limit), 0.001e18, "stopped at the limit");
        assertGt(cocoon.burnPot(), pot / 2, "most of the pot is still there");
        _assertBalanceIdentity();
    }

    function test_burnsAreSpacedOut() public {
        _buyExactIn(5 ether);
        _deposit(0.2 ether);
        vm.expectRevert(Cocoon.TooSoon.selector);
        cocoon.burn();
        _ready();
        cocoon.burn();
        _deposit(0.2 ether);
        vm.expectRevert(Cocoon.TooSoon.selector);
        cocoon.burn();
        vm.roll(block.number + 4);
        vm.expectRevert(Cocoon.TooSoon.selector);
        cocoon.burn();
        vm.roll(block.number + 1);
        cocoon.burn();
    }

    function test_burnNeedsAPot() public {
        _ready();
        vm.expectRevert(Cocoon.NothingToBurn.selector);
        cocoon.burn();
    }

    function test_burnWithTheSpotAboveLiquidityBuysNothingAndReverts() public {
        // A 1-wei sell into a pool with no ETH walks the price to the top for free.
        _sellExactIn(1);
        assertEq(_price(), TickMath.MAX_SQRT_PRICE - 1);
        _deposit(1 ether);
        _ready();

        vm.expectRevert(Cocoon.NothingBought.selector);
        cocoon.burn();
        _assertBalanceIdentity();

        // The next real buy brings the price back, and the burn works.
        _buyExactIn(1 ether);
        uint256 supplyBefore = token.totalSupply();
        cocoon.burn();
        assertGt(supplyBefore - token.totalSupply(), 0);
    }

    function test_burnPupateBurnsWhatCocoonHolds() public {
        vm.expectRevert(Cocoon.NothingToBurn.selector);
        cocoon.burnPupate();
        token.transfer(address(cocoon), 1_000_000 ether);
        uint256 supplyBefore = token.totalSupply();
        vm.expectEmit(true, false, false, true, address(cocoon));
        emit Cocoon.Burned(0, 1_000_000 ether, address(this), 0);
        cocoon.burnPupate();
        assertEq(supplyBefore - token.totalSupply(), 1_000_000 ether);
    }

    function test_unlockCallbackIsOnlyForThePoolManagerDuringABurn() public {
        vm.expectRevert(Cocoon.OnlyPoolManager.selector);
        cocoon.unlockCallback("");
        vm.prank(address(manager));
        vm.expectRevert(Cocoon.UnexpectedCallback.selector);
        cocoon.unlockCallback(abi.encode(uint256(1), uint160(1)));
    }

    function test_theOwnerCanTightenOrLoosenTheLimitWithinBounds() public {
        Cocoon.Params memory p = cocoon.getParams();
        p.burnImpactBps = 100;
        vm.prank(owner);
        cocoon.setParams(p);
        _buyExactIn(5 ether);
        _deposit(4 ether);
        uint160 before = _price();
        _ready();
        cocoon.burn();
        assertGe(_price(), uint160(uint256(before) * 9949 / 10_000));
    }
}
