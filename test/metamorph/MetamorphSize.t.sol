// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MetamorphFixture} from "./MetamorphFixture.sol";

contract MetamorphSizeTest is MetamorphFixture {
    function test_underTheContractSizeLimit() public view {
        assertLe(address(md).code.length, 24_576, "MetamorphMD runtime");
        assertLe(address(art).code.length, 24_576, "art runtime");
    }

    function test_noOwnerNoSetters() public {
        // Each probe is the selector plus 64 zero bytes of arguments, so a call cannot fail merely because
        // its arguments are missing: an unguarded owner(), setArt(address), setPrice(uint256), pause(),
        // withdraw(uint256) or sweep(address) would succeed here and fail this test. A pass means that no
        // such function exists, or that it refuses even with arguments. The authoritative list is
        // `forge inspect MetamorphMD methodIdentifiers` (at this commit: 75 functions, 14 state-changing,
        // none privileged).
        bytes4[6] memory selectors = [
            bytes4(keccak256("owner()")),
            bytes4(keccak256("setArt(address)")),
            bytes4(keccak256("setPrice(uint256)")),
            bytes4(keccak256("pause()")),
            bytes4(keccak256("withdraw(uint256)")),
            bytes4(keccak256("sweep(address)"))
        ];
        for (uint256 i; i < selectors.length; i++) {
            (bool ok,) = address(md).call(abi.encodePacked(selectors[i], bytes32(0), bytes32(0)));
            assertFalse(ok);
        }
    }
}
