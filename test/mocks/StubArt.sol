// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IMetamorphArt} from "../../src/interfaces/IMetamorphArt.sol";

/// @dev Stands in for the renderer: echoes the facts it was given so tests can read them back.
contract StubArt is IMetamorphArt {
    function tokenURI(View calldata v) external pure returns (string memory) {
        return string.concat(
            "stub:",
            _u(v.id),
            ":",
            _u(v.seat),
            ":",
            _u(v.round),
            ":",
            _u(v.edition),
            ":",
            _u(v.stage),
            ":",
            v.gilt ? "gilt" : "plain",
            ":",
            _u(v.epoch),
            ":",
            _u(v.paid)
        );
    }

    function _u(uint256 x) private pure returns (string memory s) {
        if (x == 0) return "0";
        bytes memory b;
        while (x != 0) {
            b = abi.encodePacked(uint8(48 + x % 10), b);
            x /= 10;
        }
        return string(b);
    }
}
