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
