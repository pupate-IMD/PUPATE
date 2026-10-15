// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IMetamorphArt} from "../src/interfaces/IMetamorphArt.sol";
import {MetamorphArt} from "../src/metamorph/art/MetamorphArt.sol";
import {MetamorphButterfly} from "../src/metamorph/art/MetamorphButterfly.sol";
import {MetamorphChrysalis} from "../src/metamorph/art/MetamorphChrysalis.sol";
import {MetamorphRehearsal} from "./rehearsal/MetamorphRehearsal.sol";

/// @notice TESTNET ONLY. The art of Metamorph MD on a testnet beside a throwaway ERC-721 that wears it, so the
/// owner can look at a card where collectors will see it (a testnet marketplace's item page, a wallet) before
/// the mainnet deployment, which cannot be corrected; `script/mainnet/README.md`, "Metamorph MD", step 1, says
/// why (`<textPath>`). Deploys the two figures and the router exactly as `DeployMetamorphArt` does, then
/// `MetamorphRehearsal` with eight cards of the parity sample (`node script/art/mirror.mjs sample`), minted to
/// the deployer: four chrysalises and four butterflies, plain and gilt, every form and every halo among them
/// and every halo in each stage. No env and no constructor argument but the cards: the four contracts have no
/// owner and no setter. The run, a dry run included, ends by reading every token's URI through the rehearsal
/// and prints the length of each. Nothing from this run belongs in the address book.
contract RehearseMetamorphArt is Script {
    function run() external returns (MetamorphRehearsal rehearsal) {
        IMetamorphArt.View[] memory views = _views();

        vm.startBroadcast();
        MetamorphChrysalis chrysalis = new MetamorphChrysalis();
        MetamorphButterfly butterfly = new MetamorphButterfly();
        MetamorphArt art = new MetamorphArt(chrysalis, butterfly);
        rehearsal = new MetamorphRehearsal(art, views);
        vm.stopBroadcast();

        console2.log("MetamorphChrysalis", address(chrysalis));
        console2.log("MetamorphButterfly", address(butterfly));
        console2.log("MetamorphArt", address(art));
        console2.log("MetamorphRehearsal", address(rehearsal));

        // Every card through the rehearsal, reads that are never broadcast.
        for (uint256 id = 1; id <= views.length; id++) {
            IMetamorphArt.View memory v = views[id - 1];
            console2.log(
                string.concat(
                    "token ",
                    vm.toString(id),
                    " stage ",
                    vm.toString(uint256(v.stage)),
                    " gilt ",
                    vm.toString(v.gilt),
                    " tokenURI bytes ",
                    vm.toString(bytes(rehearsal.tokenURI(id)).length)
                )
            );
        }
    }

    /// The eight cards, each a view of the parity sample with its epoch and its price (`node script/art/mirror.mjs
    /// sample` prints them with the features each shows), mined by the deployer now. Tokens 1 to 4 are
    /// chrysalises, 5 to 8 butterflies; 1 and 5 are seat 1376's holotype, the deploy script's sample card, in
    /// its two stages, and 2 and 6 the heaviest card of all (`node script/art/mirror.mjs worst`), gilt.
    function _views() private view returns (IMetamorphArt.View[] memory views) {
        views = new IMetamorphArt.View[](8);
        // Chrysalises: spindle with no halo (the notes), classic; teardrop, double halo, rain, bold, gilt;
        // pear, orbit, band, ember; round, ring, fine, mono, a paratype.
        views[0] = _card(1376, 0, 1, 0, false, 1, 50_000 ether);
        views[1] = _card(8296, 2, 1, 0, true, 11, 1_000_000_000 ether);
        views[2] = _card(107, 0, 1, 0, false, 8, 48_638_000_000_006_913_580_247);
        views[3] = _card(64, 0, 2, 0, false, 2, 54_808_000_000_011_851_851_852);
        // Butterflies: spindle with no halo, classic; teardrop, double halo, rain, bold, gilt; round, orbit,
        // fine, inverted, a series card; round, ring, classic, a series card.
        views[4] = _card(1376, 0, 1, 1, false, 1, 50_000 ether);
        views[5] = _card(8296, 2, 1, 1, true, 11, 1_000_000_000 ether);
        views[6] = _card(35, 0, 279, 1, false, 7, 47_404_000_000_005_925_925_926);
        views[7] = _card(2, 0, 48, 1, false, 11, 65_914_000_000_020_740_740_741);
    }

    /// One card, mined by the deployer at the chain's current time; the rehearsal numbers its tokens itself.
    function _card(
        uint256 seat,
        uint16 round,
        uint16 edition,
        uint8 stage,
        bool gilt,
        uint16 epoch,
        uint256 paid
    ) private view returns (IMetamorphArt.View memory) {
        return IMetamorphArt.View({
            id: 0,
            seat: seat,
            round: round,
            edition: edition,
            stage: stage,
            gilt: gilt,
            epoch: epoch,
            miner: msg.sender,
            mintedAt: uint40(block.timestamp),
            paid: paid
        });
    }
}
