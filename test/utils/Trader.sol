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
