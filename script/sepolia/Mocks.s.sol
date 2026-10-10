// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {MockERC20} from "../../test/mocks/MockERC20.sol";
import {MockERC721} from "../../test/mocks/MockERC721.sol";

/// @notice TESTNET ONLY. What Sepolia does not have and the rehearsal needs: a stand-in for the
/// identity.md collection and one for the IMD token. Mints a few seats and some IMD to the deployer
/// so the Seaport and auction paths can be tried by hand. Never deployed on mainnet, where the real
/// contracts are used.
contract Mocks is Script {
    function run() external {
        vm.startBroadcast();
        address deployer = msg.sender;
        MockERC721 collection = new MockERC721();
        MockERC20 imd = new MockERC20("Identity.md (Sepolia stand-in)", "IMD");
        for (uint256 id = 1; id <= 3; id++) {
            collection.mint(deployer, id);
        }
        imd.mint(deployer, 1_000 ether);
        vm.stopBroadcast();

        console2.log("MockERC721        ", address(collection));
        console2.log("MockERC20         ", address(imd));
        console2.log("seats 1, 2, 3 and 1,000 IMD minted to", deployer);
    }
}
