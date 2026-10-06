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
