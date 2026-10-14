// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title Base64
/// @notice Standard base64 (RFC 4648: the `+/` alphabet with `=` padding), what wallets and marketplaces
/// decode in a `data:` URI. No dependency, no state.
library Base64 {
    function encode(bytes memory data) internal pure returns (string memory result) {
        uint256 len = data.length;
        if (len == 0) return "";
        result = new string(4 * ((len + 2) / 3));
        bytes memory table = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        assembly ("memory-safe") {
            // A word loaded at tablePtr + x ends with the x-th character.
            let tablePtr := add(table, 1)
            let out := add(result, 0x20)
            let ptr := data
            let end := add(data, len)
            // The last group may read up to two bytes past the data: the word right after the data is zeroed
            // while the groups are read, and put back after.
            let afterPtr := add(end, 0x20)
            let afterWord := mload(afterPtr)
            mstore(afterPtr, 0)
            for {} lt(ptr, end) {} {
                // The word loaded at ptr + 3 ends with the next three bytes of the data.
                ptr := add(ptr, 3)
                let input := mload(ptr)
                mstore8(out, mload(add(tablePtr, and(shr(18, input), 0x3f))))
                mstore8(add(out, 1), mload(add(tablePtr, and(shr(12, input), 0x3f))))
                mstore8(add(out, 2), mload(add(tablePtr, and(shr(6, input), 0x3f))))
                mstore8(add(out, 3), mload(add(tablePtr, and(input, 0x3f))))
                out := add(out, 4)
            }
            mstore(afterPtr, afterWord)
            // One byte in the last group gives two characters and "==", two bytes give three and "=".
            switch mod(len, 3)
            case 1 {
                mstore8(sub(out, 1), 0x3d)
                mstore8(sub(out, 2), 0x3d)
            }
            case 2 { mstore8(sub(out, 1), 0x3d) }
        }
    }
}
