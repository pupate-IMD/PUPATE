// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {DeployMetamorph} from "../../../script/DeployMetamorph.s.sol";
import {IMetamorphArt} from "../../../src/interfaces/IMetamorphArt.sol";
import {IMetamorphFigure} from "../../../src/interfaces/IMetamorphFigure.sol";
import {MetamorphArt} from "../../../src/metamorph/art/MetamorphArt.sol";
import {MetamorphButterfly} from "../../../src/metamorph/art/MetamorphButterfly.sol";
import {MetamorphChrysalis} from "../../../src/metamorph/art/MetamorphChrysalis.sol";
import {StubArt} from "../../mocks/StubArt.sol";

/// @dev `DeployMetamorph` with the read it makes of the art, `_checkArt`, exposed.
contract DeployMetamorphCheck is DeployMetamorph {
    function checkArt(IMetamorphArt art) external view {
        _checkArt(art);
    }
}

/// @dev An art that answers every card with one string.
contract FixedArt is IMetamorphArt {
    string internal answer;

    constructor(string memory answer_) {
        answer = answer_;
    }

    function tokenURI(View calldata) external view returns (string memory) {
        return answer;
    }
}

/// @dev What `DeployMetamorph` asks of `ART` before it deploys the token, which keeps the art's address as an
/// immutable: a card of each stage, at least 100 bytes of `data:application/json;base64,…`. The run itself
/// needs the live vault and its pools; this reaches the check alone.
contract ArtDeployCheckTest is Test {
    string internal constant PREFIX = "data:application/json;base64,";
    bytes1 internal constant FILLER = "A";

    DeployMetamorphCheck internal script;

    function setUp() public {
        script = new DeployMetamorphCheck();
    }

    /// The real art, as `DeployMetamorphArt` deploys it, passes.
    function test_theRealArtPasses() public {
        script.checkArt(new MetamorphArt(new MetamorphChrysalis(), new MetamorphButterfly()));
    }

    /// An art that is not the renderer (here the tests' stub, whose answer is short and no data URI) is
    /// refused at the first stage.
    function test_aContractOfAnotherKindIsRefused() public {
        IMetamorphArt art = new StubArt();
        vm.expectRevert("ART chrysalis tokenURI is under 100 bytes");
        script.checkArt(art);
    }

    /// An answer of 100 bytes passes and one of 99 does not, both with the right prefix: the floor is exactly
    /// a hundred bytes.
    function test_theLengthFloorIsOneHundredBytes() public {
        script.checkArt(new FixedArt(_answer(PREFIX, 100)));
        IMetamorphArt short = new FixedArt(_answer(PREFIX, 99));
        vm.expectRevert("ART chrysalis tokenURI is under 100 bytes");
        script.checkArt(short);
    }

    /// A long answer that is not a base64 JSON data URI is refused, whatever its length: a link, an SVG data
    /// URI, and a prefix that lacks its last comma.
    function test_theAnswerMustBeABase64JsonDataUri() public {
        IMetamorphArt link = new FixedArt(_answer("https://example.org/card/1?", 400));
        vm.expectRevert("ART chrysalis tokenURI is not a base64 JSON data URI");
        script.checkArt(link);
        IMetamorphArt svg = new FixedArt(_answer("data:image/svg+xml;base64,", 400));
        vm.expectRevert("ART chrysalis tokenURI is not a base64 JSON data URI");
        script.checkArt(svg);
        IMetamorphArt nearly = new FixedArt(_answer("data:application/json;base64", 400));
        vm.expectRevert("ART chrysalis tokenURI is not a base64 JSON data URI");
        script.checkArt(nearly);
    }

    /// A router that was built on a missing butterfly draws a chrysalis and then reverts: the check reads
    /// the butterfly too.
    function test_aRouterWithoutItsButterflyIsRefused() public {
        IMetamorphArt art =
            new MetamorphArt(new MetamorphChrysalis(), IMetamorphFigure(makeAddr("no butterfly here")));
        vm.expectRevert("ART butterfly tokenURI reverts");
        script.checkArt(art);
    }

    /// And one built on a missing chrysalis is refused at the first stage, with a message and not an empty
    /// revert.
    function test_aRouterWithoutItsChrysalisIsRefused() public {
        IMetamorphArt art =
            new MetamorphArt(IMetamorphFigure(makeAddr("no chrysalis here")), new MetamorphButterfly());
        vm.expectRevert("ART chrysalis tokenURI reverts");
        script.checkArt(art);
    }

    /// `head` and then filler up to `total` bytes.
    function _answer(string memory head, uint256 total) internal pure returns (string memory) {
        bytes memory h = bytes(head);
        bytes memory b = new bytes(total);
        for (uint256 i; i < total; i++) {
            b[i] = i < h.length ? h[i] : FILLER;
        }
        return string(b);
    }
}
