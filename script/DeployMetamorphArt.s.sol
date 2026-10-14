// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IMetamorphArt} from "../src/interfaces/IMetamorphArt.sol";
import {MetamorphArt} from "../src/metamorph/art/MetamorphArt.sol";
import {MetamorphButterfly} from "../src/metamorph/art/MetamorphButterfly.sol";
import {MetamorphChrysalis} from "../src/metamorph/art/MetamorphChrysalis.sol";

/// @notice Deploys the art behind Metamorph MD: the two figure contracts, then the router `MetamorphArt` with
/// their addresses. No env and no constructor argument but the figures: the three contracts have no owner and
/// no setter, so nothing is configured now and nothing can change later. The router is what `DeployMetamorph`
/// takes as `ART` (`metamorphArt` in the address book). The run, a dry run included, ends by reading one card
/// through the router, seat 1376's holotype chrysalis, and prints the length of its token URI.
contract DeployMetamorphArt is Script {
    function run() external returns (MetamorphArt art) {
        vm.startBroadcast();
        MetamorphChrysalis chrysalis = new MetamorphChrysalis();
        MetamorphButterfly butterfly = new MetamorphButterfly();
        art = new MetamorphArt(chrysalis, butterfly);
        vm.stopBroadcast();

        console2.log("MetamorphChrysalis", address(chrysalis));
        console2.log("MetamorphButterfly", address(butterfly));
        console2.log("MetamorphArt", address(art));

        // The sample card: token 1, seat 1376's first edition in round 0, a plain chrysalis of epoch 1, mined
        // by the deployer for 50,000 PUPATE. A read, never broadcast.
        IMetamorphArt.View memory sample = IMetamorphArt.View({
            id: 1,
            seat: 1376,
            round: 0,
            edition: 1,
            stage: 0,
            gilt: false,
            epoch: 1,
            miner: msg.sender,
            mintedAt: uint40(block.timestamp),
            paid: 50_000 ether
        });
        console2.log("sample tokenURI bytes", bytes(art.tokenURI(sample)).length);
    }
}
