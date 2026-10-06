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
    /// @dev afterInitialize, beforeSwap, afterSwap, beforeSwapReturnDelta, afterSwapReturnDelta.
    uint160 internal constant HOOK_FLAGS = 0x10CC;

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
        return abi.encodeWithSelector(
            CustomRevert.WrappedError.selector,
            address(hook),
            callback,
            abi.encodeWithSelector(reason),
            abi.encodeWithSelector(Hooks.HookCallFailed.selector)
        );
    }
}
