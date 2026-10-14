// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {MetamorphArt} from "../../../src/metamorph/art/MetamorphArt.sol";
import {MetamorphButterfly} from "../../../src/metamorph/art/MetamorphButterfly.sol";
import {MetamorphChrysalis} from "../../../src/metamorph/art/MetamorphChrysalis.sol";

contract ArtSizeTest is Test {
    MetamorphChrysalis internal chrysalis;
    MetamorphButterfly internal butterfly;
    MetamorphArt internal art;

    function setUp() public {
        chrysalis = new MetamorphChrysalis();
        butterfly = new MetamorphButterfly();
        art = new MetamorphArt(chrysalis, butterfly);
    }

    /// Each of the three art contracts deploys under the EIP-170 limit of 24,576 bytes of runtime code.
    function test_eachContractIsUnderTheSizeLimit() public {
        emit log_named_uint("MetamorphChrysalis runtime", address(chrysalis).code.length);
        emit log_named_uint("MetamorphButterfly runtime", address(butterfly).code.length);
        emit log_named_uint("MetamorphArt runtime", address(art).code.length);
        assertLe(address(chrysalis).code.length, 24_576, "MetamorphChrysalis");
        assertLe(address(butterfly).code.length, 24_576, "MetamorphButterfly");
        assertLe(address(art).code.length, 24_576, "MetamorphArt");
    }

    /// No owner and no setter: each probe is a selector and 64 zero bytes of arguments, so a call cannot fail
    /// merely for want of its arguments, and every one fails. The router's whole surface is CHRYSALIS(),
    /// BUTTERFLY(), svg(View), json(View) and tokenURI(View), all views.
    function test_noOwnerNoSetters() public {
        bytes4[6] memory selectors = [
            bytes4(keccak256("owner()")),
            bytes4(keccak256("setChrysalis(address)")),
            bytes4(keccak256("setButterfly(address)")),
            bytes4(keccak256("setArt(address)")),
            bytes4(keccak256("transferOwnership(address)")),
            bytes4(keccak256("renounceOwnership()"))
        ];
        address[3] memory contracts = [address(art), address(chrysalis), address(butterfly)];
        for (uint256 c; c < contracts.length; c++) {
            for (uint256 i; i < selectors.length; i++) {
                (bool ok,) = contracts[c].call(abi.encodePacked(selectors[i], bytes32(0), bytes32(0)));
                assertFalse(ok);
            }
        }
    }
}
