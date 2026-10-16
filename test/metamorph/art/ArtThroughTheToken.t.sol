// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20Minimal} from "../../../src/interfaces/IERC20Minimal.sol";
import {IERC721Minimal} from "../../../src/interfaces/IERC721Minimal.sol";
import {IMetamorphArt} from "../../../src/interfaces/IMetamorphArt.sol";
import {MetamorphMD} from "../../../src/metamorph/MetamorphMD.sol";
import {MetamorphArt} from "../../../src/metamorph/art/MetamorphArt.sol";
import {MetamorphButterfly} from "../../../src/metamorph/art/MetamorphButterfly.sol";
import {MetamorphChrysalis} from "../../../src/metamorph/art/MetamorphChrysalis.sol";
import {MetamorphFixture} from "../MetamorphFixture.sol";
import {ArtReading} from "./MetamorphArt.t.sol";

/// @dev The token with the real art behind it: the fixture's deployment, with `MetamorphArt` and its two
/// figures in place of the stub. A minted card's `tokenURI` is a finished card: base64 JSON with a base64 SVG
/// inside.
contract ArtThroughTheTokenTest is MetamorphFixture {
    using ArtReading for string;

    MetamorphArt internal realArt;

    function _deploy(uint8 minBits) internal override returns (MetamorphMD) {
        realArt = new MetamorphArt(new MetamorphChrysalis(), new MetamorphButterfly());
        return new MetamorphMD(
            cocoon,
            hook,
            token,
            IERC20Minimal(address(imd)),
            IERC721Minimal(address(collection)),
            manager,
            key,
            imdKey,
            IMetamorphArt(address(realArt)),
            minBits
        );
    }

    /// A new card reads as a chrysalis: the name, the seat, the stage, and an image that is a base64 SVG.
    function test_aNewCardIsAChrysalisCard() public {
        uint256 id = _mintAs(miner);
        string memory uri = md.tokenURI(id);
        assertTrue(uri.startsWith("data:application/json;base64,"), "the JSON's data URI");
        string memory json = uri.jsonOf();
        assertEq(json.field("name"), "Metamorph.md #1");
        assertTrue(json.contains('{"trait_type":"Seat","value":"1376"}'));
        assertTrue(json.contains('{"trait_type":"Stage","value":"Chrysalis"}'));
        assertTrue(json.contains('{"trait_type":"Gilt","value":"No"}'));
        assertTrue(json.field("image").startsWith("data:image/svg+xml;base64,"), "the image's data URI");
        string memory svg = json.svgOf();
        assertTrue(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'), "an SVG");
        assertTrue(svg.contains(">IN THE COCOON</text>"));
        assertEq(uri, realArt.tokenURI(_viewOf(id)), "the token hands the art every fact");
    }

    /// When the vault sells the seat, the same card reads as a butterfly.
    function test_aSoldSeatsCardIsAButterflyCard() public {
        uint256 id = _mintAs(miner);
        _sell(1376);
        string memory json = md.tokenURI(id).jsonOf();
        assertTrue(json.contains('{"trait_type":"Stage","value":"Butterfly"}'));
        assertTrue(json.svgOf().contains(">EMERGED</text>"));
        assertEq(md.tokenURI(id), realArt.tokenURI(_viewOf(id)));
    }

    /// A gilt proof's card says so in its picture and in its attributes.
    function test_aGiltCardShowsItsGilt() public {
        uint256 a = _anchor();
        bytes32 ah = blockhash(a);
        uint256 line = md.effectiveTarget() >> 4;
        uint256 nonce = 1;
        while (uint256(md.workHash(ah, miner, nonce)) >= line) {
            nonce++;
        }
        vm.prank(miner);
        uint256 id = md.mint(a, nonce);
        (,,, bool gilt,,,,,) = md.cards(id);
        assertTrue(gilt, "a gilt proof");
        string memory json = md.tokenURI(id).jsonOf();
        assertTrue(json.contains('{"trait_type":"Gilt","value":"Yes"}'));
        assertTrue(json.contains('{"trait_type":"Palette","value":"Gilt"}'));
        assertTrue(json.svgOf().contains(unicode"IN THE COCOON · GILT</text>"));
    }

    /// The view the token builds for a card, from its public reads.
    function _viewOf(uint256 id) internal view returns (IMetamorphArt.View memory) {
        (uint32 seat, uint16 round, uint16 edition, bool gilt,, uint40 mintedAt, uint96 paid, address who,) =
            md.cards(id);
        return IMetamorphArt.View({
            id: id,
            seat: seat,
            round: round,
            edition: edition,
            stage: md.stageOf(id),
            gilt: gilt,
            epoch: uint16((id - 1) / 303 + 1),
            miner: who,
            mintedAt: mintedAt,
            paid: paid
        });
    }
}
