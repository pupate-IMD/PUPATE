// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolId} from "v4-core/src/types/PoolId.sol";

/// @notice What Cocoon reads from PupateHook when it is wired to the launch pool.
interface ILaunchHook {
    function launchPool() external view returns (PoolId);
    function sink() external view returns (address);
}
