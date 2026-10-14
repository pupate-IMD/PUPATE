// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MetamorphFixture} from "./MetamorphFixture.sol";

contract MetamorphSizeTest is MetamorphFixture {
    function test_underTheContractSizeLimit() public view {
        assertLe(address(md).code.length, 24_576, "MetamorphMD runtime");
        assertLe(address(art).code.length, 24_576, "art runtime");
    }

    function test_noOwnerNoSetters() public {
        // The ABI has no owner, setter, pause, upgrade or withdraw: these selectors do not exist.
        bytes4[6] memory selectors = [
            bytes4(keccak256("owner()")),
            bytes4(keccak256("setArt(address)")),
            bytes4(keccak256("setPrice(uint256)")),
            bytes4(keccak256("pause()")),
            bytes4(keccak256("withdraw(uint256)")),
            bytes4(keccak256("sweep(address)"))
        ];
        for (uint256 i; i < selectors.length; i++) {
            (bool ok,) = address(md).call(abi.encodeWithSelector(selectors[i]));
            assertFalse(ok);
        }
    }
}
