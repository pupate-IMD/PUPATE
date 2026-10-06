// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {SeaportInterface} from "seaport-types/src/interfaces/SeaportInterface.sol";
import {Cocoon} from "../src/Cocoon.sol";
import {FloorFeed} from "../src/FloorFeed.sol";
import {IERC20Minimal} from "../src/interfaces/IERC20Minimal.sol";
import {IERC721Minimal} from "../src/interfaces/IERC721Minimal.sol";

/// @notice Step 1 of the deployment: everything that must exist before the IMD launch, because the
/// hook takes Cocoon and the timelock as constructor arguments. FloorFeed and Cocoon stay owned by
/// the deployer until `PostLaunch` has set the question and wired the pool; then they go to the
/// timelock. See docs/deployment.md.
///
/// Environment:
///   DEVELOPER        address that claims the developer share and proposes timelock operations
///   OPERATOR         address that approves IMD worker pairings
///   ORACLE_ATTESTER  IMD's oracle signer (0x5598Aa9146215Bc13eb26f2c692Ad1461Fd32982 on mainnet)
///   COLLECTION       identity.md (0x0000eC93127BAA929E58E97dd0095A2BFb38ec1D on mainnet)
///   POOL_MANAGER     Uniswap v4 PoolManager on the launch chain
///   IMD              the IMD token on the launch chain
///   SEAPORT          Seaport 1.6 (defaults to 0x0000000000000068F116a894984e2DB1123eB395)
///   EVIDENCE_CHAIN_ID chain the oracle question reads (defaults to 1)
contract DeployPreLaunch is Script {
    function run() external {
        address developer = vm.envAddress("DEVELOPER");
        address operator = vm.envAddress("OPERATOR");
        address attester = vm.envAddress("ORACLE_ATTESTER");
        address collection = vm.envAddress("COLLECTION");
        address poolManager = vm.envAddress("POOL_MANAGER");
        address imd = vm.envAddress("IMD");
        address seaport = vm.envOr("SEAPORT", address(0x0000000000000068F116a894984e2DB1123eB395));
        uint256 evidenceChain = vm.envOr("EVIDENCE_CHAIN_ID", uint256(1));

        vm.startBroadcast();
        address deployer = msg.sender;

        address[] memory proposers = new address[](1);
        proposers[0] = developer;
        address[] memory executors = new address[](1);
        executors[0] = address(0); // anyone may execute a matured operation
        TimelockController timelock = new TimelockController(48 hours, proposers, executors, address(0));

        FloorFeed feed = new FloorFeed(deployer, attester, evidenceChain);
        Cocoon cocoon = new Cocoon(
            deployer,
            developer,
            operator,
            IERC721Minimal(collection),
            SeaportInterface(seaport),
            IPoolManager(poolManager),
            feed,
            IERC20Minimal(imd)
        );
        vm.stopBroadcast();

        console2.log("TimelockController", address(timelock));
        console2.log("FloorFeed         ", address(feed));
        console2.log("Cocoon            ", address(cocoon));
        console2.log("launch.json hook.constructorArgs:");
        console2.log("  [\"$poolManager\", \"%s\", \"%s\"]", address(cocoon), address(timelock));
        console2.log("Next: request the floor question from the IMD oracle with FloorFeed as its consumer,");
        console2.log("then pay for the launch with the manifest above.");
    }
}
