// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice The price curve of Cocoon's falling auctions: the price halves every HALF_LIFE, falling
/// in a straight line inside each half-life, and is zero from CUTOFF on.
library Decay {
    uint256 internal constant HALF_LIFE = 2 hours;
    uint256 internal constant CUTOFF = 48 hours;

    function price(uint256 start, uint256 elapsed) internal pure returns (uint256) {
        if (elapsed >= CUTOFF) return 0;
        uint256 p = start >> (elapsed / HALF_LIFE);
        uint256 into = elapsed % HALF_LIFE;
        return p - p * into / (2 * HALF_LIFE);
    }
}
