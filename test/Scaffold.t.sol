// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

contract ScaffoldTest is Test {
    function test_toolchainIsCancun() public {
        // TSTORE/TLOAD only exist from cancun onwards.
        bytes32 slot = bytes32(uint256(1));
        uint256 out;
        assembly {
            tstore(slot, 42)
            out := tload(slot)
        }
        assertEq(out, 42);
    }
}
