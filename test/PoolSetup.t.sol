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
