// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MetamorphFixture} from "./MetamorphFixture.sol";
import {ERC721Lite} from "../../src/metamorph/ERC721Lite.sol";

contract MetamorphStagesTest is MetamorphFixture {
    function test_aNewCardIsAChrysalis() public {
        uint256 id = _mintAs(miner);
        assertEq(md.stageOf(id), 0);
    }

    function test_butterflyWhenTheVaultSellsTheSeat() public {
        uint256 id = _mintAs(miner);
        _sell(1376);
        assertEq(md.stageOf(id), 1);
    }

    function test_butterflyWhenTheVaultBuysTheSeatAgain() public {
        uint256 id = _mintAs(miner);
        _sell(1376);
        vm.prank(other);
        collection.transferFrom(other, address(cocoon), 1376);
        cocoon.adopt(1376);
        assertEq(md.stageOf(id), 1, "round 0 is over even though the vault holds the seat");
        vm.roll(block.number + 1);
        uint256 id2 = _mintAs(miner);
        assertEq(md.stageOf(id2), 0, "a round-1 card is a chrysalis");
    }

    function test_butterflyAfterNinetyDaysWhateverHappened() public {
        uint256 id = _mintAs(miner);
        vm.warp(block.timestamp + 90 days - 1);
        assertEq(md.stageOf(id), 0);
        vm.warp(block.timestamp + 1);
        assertEq(md.stageOf(id), 1);
    }

    function test_butterflyWhenTheSeatLeavesTheVaultWithoutSettling() public {
        uint256 id = _mintAs(miner);
        vm.prank(address(cocoon));
        collection.transferFrom(address(cocoon), other, 1376);
        assertEq(md.stageOf(id), 1, "the wallet, not only the books, decides");
    }

    function test_stageOfUnmintedReverts() public {
        vm.expectRevert(ERC721Lite.NotMinted.selector);
        md.stageOf(5);
    }

    function test_royaltyIsFivePercentToTheDeveloperOfTheMoment() public {
        _mintAs(miner);
        (address to, uint256 amount) = md.royaltyInfo(1, 1 ether);
        assertEq(to, developer);
        assertEq(amount, 0.05 ether);
        vm.prank(developer);
        cocoon.setDeveloper(other);
        (to,) = md.royaltyInfo(1, 1 ether);
        assertEq(to, other);
        assertTrue(md.supportsInterface(0x2a55205a));
    }

    function test_tokenURIHandsTheArtEveryFact() public {
        uint256 id = _mintAs(miner);
        assertEq(md.tokenURI(id), "stub:1:1376:0:1:0:plain:1:50000000000000000000000");
        _sell(1376);
        assertEq(md.tokenURI(id), "stub:1:1376:0:1:1:plain:1:50000000000000000000000");
    }
}
