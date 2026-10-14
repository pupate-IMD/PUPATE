// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IMetamorphArt} from "../../../src/interfaces/IMetamorphArt.sol";
import {IMetamorphFigure} from "../../../src/interfaces/IMetamorphFigure.sol";
import {Base64} from "../../../src/metamorph/art/Base64.sol";
import {MetamorphArt} from "../../../src/metamorph/art/MetamorphArt.sol";
import {MetamorphButterfly} from "../../../src/metamorph/art/MetamorphButterfly.sol";
import {MetamorphChrysalis} from "../../../src/metamorph/art/MetamorphChrysalis.sol";

/// @dev Reading a token URI back, for these tests and the token's: a base64 decoder written apart from the
/// contract's encoder, and the few string searches the tests need.
library ArtReading {
    /// Standard base64 with padding, back to bytes; a character outside the alphabet reverts.
    function decode(string memory text) internal pure returns (bytes memory out) {
        bytes memory b = bytes(text);
        require(b.length % 4 == 0, "base64: length");
        uint256 pad;
        if (b.length != 0 && b[b.length - 1] == "=") pad = b[b.length - 2] == "=" ? 2 : 1;
        out = new bytes(b.length / 4 * 3 - pad);
        uint256 k;
        for (uint256 i; i < b.length; i += 4) {
            uint256 n = (_sextet(b[i]) << 18) | (_sextet(b[i + 1]) << 12) | (_sextet(b[i + 2]) << 6)
                | _sextet(b[i + 3]);
            for (uint256 j; j < 3 && k < out.length; j++) {
                out[k++] = bytes1(uint8(n >> (16 - 8 * j)));
            }
        }
    }

    function _sextet(bytes1 c) private pure returns (uint256) {
        if (c >= "A" && c <= "Z") return uint8(c) - 65;
        if (c >= "a" && c <= "z") return uint8(c) - 71;
        if (c >= "0" && c <= "9") return uint8(c) + 4;
        if (c == "+") return 62;
        if (c == "/") return 63;
        if (c == "=") return 0;
        revert("base64: character");
    }

    /// Where `key` first occurs in `text` at or after `from`; type(uint256).max when it does not.
    function find(string memory text, string memory key, uint256 from) internal pure returns (uint256) {
        bytes memory t = bytes(text);
        bytes memory k = bytes(key);
        for (uint256 i = from; i + k.length <= t.length; i++) {
            uint256 j;
            while (j < k.length && t[i + j] == k[j]) {
                j++;
            }
            if (j == k.length) return i;
        }
        return type(uint256).max;
    }

    function contains(string memory text, string memory key) internal pure returns (bool) {
        return find(text, key, 0) != type(uint256).max;
    }

    function startsWith(string memory text, string memory prefix) internal pure returns (bool) {
        bytes memory t = bytes(text);
        bytes memory p = bytes(prefix);
        if (t.length < p.length) return false;
        for (uint256 i; i < p.length; i++) {
            if (t[i] != p[i]) return false;
        }
        return true;
    }

    function endsWith(string memory text, string memory suffix) internal pure returns (bool) {
        bytes memory t = bytes(text);
        bytes memory s = bytes(suffix);
        if (t.length < s.length) return false;
        for (uint256 i; i < s.length; i++) {
            if (t[t.length - s.length + i] != s[i]) return false;
        }
        return true;
    }

    /// The bytes of `text` from `from` up to, not including, `to`.
    function slice(string memory text, uint256 from, uint256 to) internal pure returns (string memory) {
        bytes memory t = bytes(text);
        bytes memory out = new bytes(to - from);
        for (uint256 i; i < out.length; i++) {
            out[i] = t[from + i];
        }
        return string(out);
    }

    /// What follows `prefix` in `text`, which must start with it.
    function rest(string memory text, string memory prefix) internal pure returns (string memory) {
        require(startsWith(text, prefix), "no such prefix");
        return slice(text, bytes(prefix).length, bytes(text).length);
    }

    /// The string value of `key` in `json`: from `"key":"` to the next quote (the values here hold no
    /// escapes).
    function field(string memory json, string memory key) internal pure returns (string memory) {
        string memory open = string.concat('"', key, '":"');
        uint256 from = find(json, open, 0);
        require(from != type(uint256).max, "no such field");
        from += bytes(open).length;
        return slice(json, from, find(json, '"', from));
    }

    /// The JSON a token URI holds.
    function jsonOf(string memory uri) internal pure returns (string memory) {
        return string(decode(rest(uri, "data:application/json;base64,")));
    }

    /// The SVG a token's JSON holds as its image.
    function svgOf(string memory json) internal pure returns (string memory) {
        return string(decode(rest(field(json, "image"), "data:image/svg+xml;base64,")));
    }
}

/// @dev The expected SVGs are pasted from `node script/art/mirror.mjs render <seat> <round> <edition> <stage>
/// <gilt> <id>`, cut before each element; the JSONs from `node script/art/mirror.mjs uri …` with the image
/// left to `svg(view)`, which the SVG test pins; the digests and the sizes from `digest …` and `worst`. The
/// mirror is written first, and when it and the contract disagree, the side that deviates from the spec's
/// rule is fixed, never the string.
contract MetamorphArtTest is Test {
    using ArtReading for string;

    /// The address of the private key 1, as a miner.
    address internal constant MINER = 0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf;

    MetamorphArt internal art;

    function setUp() public {
        art = new MetamorphArt(new MetamorphChrysalis(), new MetamorphButterfly());
    }

    /// The figures are fixed at deployment, and neither may be missing.
    function test_theFiguresAreFixedAndNeitherIsZero() public {
        MetamorphChrysalis chrysalis = new MetamorphChrysalis();
        MetamorphButterfly butterfly = new MetamorphButterfly();
        MetamorphArt a = new MetamorphArt(chrysalis, butterfly);
        assertEq(address(a.CHRYSALIS()), address(chrysalis));
        assertEq(address(a.BUTTERFLY()), address(butterfly));
        vm.expectRevert(MetamorphArt.ZeroAddress.selector);
        new MetamorphArt(IMetamorphFigure(address(0)), butterfly);
        vm.expectRevert(MetamorphArt.ZeroAddress.selector);
        new MetamorphArt(chrysalis, IMetamorphFigure(address(0)));
    }

    /// (1376, 0, 1) plain, id 1, in both stages: a spindle, bold, the column signal, no halo (so the
    /// chrysalis has the notes), the holotype's double frame. (2345, 0, 5) gilt, id 777, in both stages: a
    /// teardrop, standard, the rain, the orbit with its gold dot at 328.5 degrees, the paratype's corner,
    /// " · GILT".
    function test_svgMatchesTheMirror() public view {
        assertEq(art.svg(_card1(0)), _svg1376Chrysalis());
        assertEq(art.svg(_card1(1)), _svg1376Butterfly());
        assertEq(art.svg(_card777(0)), _svg2345Chrysalis());
        assertEq(art.svg(_card777(1)), _svg2345Butterfly());
    }

    /// The token URI is the JSON in base64 behind `data:application/json;base64,`; the JSON is the mirror's,
    /// name, description and every attribute, with the image `data:image/svg+xml;base64,` and the SVG in
    /// base64 (decoded here by the test's own decoder); `json(view)` is the same text.
    function test_jsonIsWellFormed() public view {
        IMetamorphArt.View memory v = _card1(0);
        _json(v, _json1376Chrysalis(Base64.encode(bytes(art.svg(v)))));
        v = _card777(1);
        _json(v, _json2345Butterfly(Base64.encode(bytes(art.svg(v)))));
    }

    /// The same view draws the same bytes. The facts the picture does not read (the miner, the price, the
    /// epoch, the time) change the JSON and never the SVG.
    function test_sameViewSameBytes() public view {
        IMetamorphArt.View memory v = _card777(1);
        assertEq(art.tokenURI(v), art.tokenURI(v));
        IMetamorphArt.View memory w = _card777(1);
        w.miner = address(0xBEEF);
        w.paid = 1 ether;
        w.epoch = 9;
        w.mintedAt = 1;
        assertEq(art.svg(w), art.svg(v));
        assertNotEq(art.json(w), art.json(v));
    }

    /// Two cards of one seat look different: another edition, another round.
    function test_twoCardsOfOneSeatDiffer() public view {
        string memory a = art.svg(_card(1376, 0, 1, 0, false, 1));
        assertNotEq(a, art.svg(_card(1376, 0, 2, 0, false, 1)), "another edition");
        assertNotEq(a, art.svg(_card(1376, 1, 1, 0, false, 1)), "another round");
    }

    /// Gilt changes the colours and the stage label and nothing else: the gilt SVG is the plain one with
    /// " · GILT" after the stage and some colours (#rrggbb) changed, in both stages of two cards.
    function test_giltChangesOnlyColoursAndLabel() public view {
        for (uint8 stage; stage < 2; stage++) {
            _onlyColoursAndLabel(_card(2345, 0, 5, stage, false, 777), _card(2345, 0, 5, stage, true, 777));
            _onlyColoursAndLabel(_card(1376, 0, 1, stage, false, 1), _card(1376, 0, 1, stage, true, 1));
        }
    }

    /// Views the token never sends still draw: seat 0, edition 0 (a series card) and stage 7 (drawn as the
    /// butterfly); and every field at its largest. Both are the mirror's.
    function test_oddViewsStillRender() public view {
        IMetamorphArt.View memory v = _card(0, 0, 0, 7, false, 0);
        string memory svg = art.svg(v);
        assertTrue(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'), "the SVG opens");
        assertTrue(svg.endsWith("\n</svg>"), "the SVG closes");
        assertTrue(svg.contains('<g transform="translate(540 596)'), "the butterfly figure");
        assertTrue(svg.contains(">EMERGED</text>"), "the butterfly's label");
        string memory json = art.tokenURI(v).jsonOf();
        assertTrue(json.contains('"description":"Seat identity.md #0, edition 0 of 303, emerged."'));
        assertTrue(json.contains('{"trait_type":"Stage","value":"Butterfly"}'));
        assertTrue(json.contains('{"trait_type":"Tier","value":"Series"}'));
        _digest(
            v,
            bytes32(0xd7eef70c4119ced141cf73c3e358de952cb1cea4e7cbcca0b70974920e637398),
            bytes32(0x02844496e1137623176e65265055e953c7a1e84b2994b60855a9c8153b7a9208)
        );
        v = IMetamorphArt.View({
            id: type(uint256).max,
            seat: type(uint256).max,
            round: type(uint16).max,
            edition: type(uint16).max,
            stage: type(uint8).max,
            gilt: true,
            epoch: type(uint16).max,
            miner: address(type(uint160).max),
            mintedAt: type(uint40).max,
            paid: type(uint256).max
        });
        json = art.tokenURI(v).jsonOf();
        assertTrue(
            json.contains(
                '{"trait_type":"Price paid (PUPATE)","value":115792089237316195423570985008687907853269984665640564039457}'
            )
        );
        _digest(
            v,
            bytes32(0x75dda7c9b4d792b85894683037dcf6e2aa8975ba8e5cefae7841d15442dddd33),
            bytes32(0x6484aca909a679299f65d4f2dbec3018d46ef0ad82ac18e05bbaea62a3e73552)
        );
    }

    /// More cards, pinned by the keccak of their SVG and their JSON (`node script/art/mirror.mjs digest …`):
    /// (14, 0, 34) the band, a ring, a series card, fine; (20, 0, 303) no signal, a double halo, ember, as
    /// the butterfly; (37, 0, 120) the orbit at 116.9 degrees (a negative cosine and a positive sine),
    /// inverted; (58, 0, 34) the orbit at 135.9 degrees, mono, round, bold, as the butterfly.
    function test_moreCardsMatchTheMirror() public view {
        _digest(
            _card(14, 0, 34, 0, false, 40),
            bytes32(0xe80106b76d9331db4d3e869837835b334dc301d7b07ed5ec0c9368d8e96c290d),
            bytes32(0x232a84660693334d2ee9a2b2be63811d348edb555e74d05cef0be1f9cdd607ce)
        );
        _digest(
            _card(20, 0, 303, 1, false, 41),
            bytes32(0x51b4248d3a6092d6f4114eb115dbf6a7aa79b6c955e08182d5826ca7fb892ef2),
            bytes32(0x8bcee10e24136584ab672380e4095053af903933bfd98a21fc5ac8385692d2ba)
        );
        _digest(
            _card(37, 0, 120, 0, false, 42),
            bytes32(0x53ce3e099c72d8390ac4b20fe7ed05f13b5b675f9986e857cc73ee20011bbecd),
            bytes32(0x0eb4762e66e2d99558a25ef03000b0d7d8a7d51786ee610ed19bd143219095cb)
        );
        _digest(
            _card(58, 0, 34, 1, false, 43),
            bytes32(0xcf35562eff0b1024c3442528e4a212609da0a72484d4910a353f5fb1b4f757b2),
            bytes32(0x21afcf22964105196af91ad2690556957839101b2db4998acb39893da1b9e3c3)
        );
    }

    /// The heaviest card (`node script/art/mirror.mjs worst`): (8296, 2, 1),
    /// a holotype with bold density, a double halo and the rain, whose butterfly has six veins and four
    /// spots; gilt, id 3333 (the last of the supply, epoch 11), a billion PUPATE paid. In both stages
    /// `tokenURI` costs under 20,000,000 gas, the SVG is under 24,576 bytes and the JSON under 40,960, and
    /// both are the mirror's.
    function test_worstCaseStaysUnderTheLimits() public {
        for (uint8 stage; stage < 2; stage++) {
            IMetamorphArt.View memory v = IMetamorphArt.View({
                id: 3333,
                seat: 8296,
                round: 2,
                edition: 1,
                stage: stage,
                gilt: true,
                epoch: 11,
                miner: address(type(uint160).max),
                mintedAt: 1_760_000_000,
                paid: 1e27
            });
            uint256 before = gasleft();
            string memory uri = art.tokenURI(v);
            uint256 used = before - gasleft();
            string memory svg = art.svg(v);
            string memory json = art.json(v);
            emit log_named_uint(stage == 0 ? "chrysalis: tokenURI gas" : "butterfly: tokenURI gas", used);
            emit log_named_uint("  svg bytes", bytes(svg).length);
            emit log_named_uint("  json bytes", bytes(json).length);
            emit log_named_uint("  uri bytes", bytes(uri).length);
            assertLt(used, 20_000_000, "gas");
            assertLt(bytes(svg).length, 24_576, "svg");
            assertLt(bytes(json).length, 40_960, "json");
            assertEq(uri.jsonOf(), json);
            assertEq(
                keccak256(bytes(svg)),
                stage == 0
                    ? bytes32(0xc8bf9d1ed1f8995f6e01e9fe16797a0c8cb695f5b83127f29abf9b5959506045)
                    : bytes32(0x3e226e57d672f277ca093a47c25ac57850118f052041b345503d92c9b6e86725)
            );
            assertEq(
                keccak256(bytes(json)),
                stage == 0
                    ? bytes32(0xc24087160bb370b7222329e28c5d0b5156d6bb6391dcc34300f448e44e358f3c)
                    : bytes32(0x8f28e3407a277344da743777f4a895c54e1ef821f30fab9b96df1a4314f2e4d0)
            );
        }
    }

    // ------------------------------------------------------------------ helpers

    /// A card with the mirror's defaults for the facts the picture does not read: nothing paid, the zero
    /// address, epoch 1.
    function _card(uint256 seat, uint16 round, uint16 edition, uint8 stage, bool gilt, uint256 id)
        internal
        pure
        returns (IMetamorphArt.View memory)
    {
        return IMetamorphArt.View({
            id: id,
            seat: seat,
            round: round,
            edition: edition,
            stage: stage,
            gilt: gilt,
            epoch: 1,
            miner: address(0),
            mintedAt: 0,
            paid: 0
        });
    }

    /// Card 1: (1376, 0, 1) plain, as the fixture's first mint has it (50,000 PUPATE, epoch 1).
    function _card1(uint8 stage) internal pure returns (IMetamorphArt.View memory) {
        return IMetamorphArt.View({
            id: 1,
            seat: 1376,
            round: 0,
            edition: 1,
            stage: stage,
            gilt: false,
            epoch: 1,
            miner: MINER,
            mintedAt: 1_760_000_000,
            paid: 50_000 ether
        });
    }

    /// Card 777: (2345, 0, 5) gilt, epoch 3, 61,234.5678 PUPATE paid (the JSON says 61234).
    function _card777(uint8 stage) internal pure returns (IMetamorphArt.View memory) {
        return IMetamorphArt.View({
            id: 777,
            seat: 2345,
            round: 0,
            edition: 5,
            stage: stage,
            gilt: true,
            epoch: 3,
            miner: MINER,
            mintedAt: 1_760_000_000,
            paid: 61_234.5678 ether
        });
    }

    function _json(IMetamorphArt.View memory v, string memory want) internal view {
        string memory uri = art.tokenURI(v);
        assertTrue(uri.startsWith("data:application/json;base64,"), "the JSON's data URI");
        string memory json = uri.jsonOf();
        assertEq(json, want);
        assertEq(json, art.json(v));
        assertTrue(json.field("image").startsWith("data:image/svg+xml;base64,"), "the image's data URI");
        assertEq(json.svgOf(), art.svg(v), "the image is the SVG");
    }

    function _digest(IMetamorphArt.View memory v, bytes32 svg, bytes32 json) internal view {
        assertEq(keccak256(bytes(art.svg(v))), svg, "svg");
        assertEq(keccak256(bytes(art.json(v))), json, "json");
    }

    /// The plain card's SVG against the gilt one's: the gilt one has " · GILT" once, after the stage label,
    /// and past that insertion the two differ only inside colours (seven bytes from a "#"), at least once.
    function _onlyColoursAndLabel(IMetamorphArt.View memory plain, IMetamorphArt.View memory gilt)
        internal
        view
    {
        bytes memory a = bytes(art.svg(plain));
        bytes memory b = bytes(art.svg(gilt));
        string memory label = unicode" · GILT</text>";
        uint256 at = string(b).find(label, 0);
        assertTrue(at != type(uint256).max, "the gilt label");
        assertEq(string(b).find(label, at + 1), type(uint256).max, "one gilt label");
        assertEq(b.length, a.length + 8, "eight bytes longer");
        uint256 changed;
        for (uint256 i; i < a.length;) {
            uint256 j = i < at ? i : i + 8;
            if (a[i] == b[j]) {
                i++;
                continue;
            }
            uint256 k = i;
            while (a[k] != "#") {
                assertLt(i - k, 6, "a difference outside a colour");
                k--;
            }
            assertTrue(b[k < at ? k : k + 8] == "#", "the same colour's place");
            i = k + 7;
            changed++;
        }
        assertGt(changed, 0, "some colours change");
    }

    // ------------------------------------------------------------------ the mirror's strings

    /// `node script/art/mirror.mjs render 1376 0 1 0 0 1` (11238 bytes).
    function _svg1376Chrysalis() internal pure returns (string memory want) {
        want = string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1080" width="1080" height="1080">\n',
            "<defs>\n  ",
            '<filter id="glow" x="-200%" y="-200%" width="500%" height="500%"><feGaussianBlur stdDeviation="1.6"/></filter>\n  ',
            '<filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="0.6"/></filter>\n</defs>\n',
            '<rect width="1080" height="1080" fill="#0b1410"/>\n',
            '<path d="M60 0V1080M0 60H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>',
            '<path d="M120 0V1080M0 120H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>'
        );
        want = string.concat(
            want,
            '<path d="M180 0V1080M0 180H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>',
            '<path d="M240 0V1080M0 240H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>',
            '<path d="M300 0V1080M0 300H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>',
            '<path d="M360 0V1080M0 360H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>',
            '<path d="M420 0V1080M0 420H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>',
            '<path d="M480 0V1080M0 480H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>',
            '<path d="M540 0V1080M0 540H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>'
        );
        want = string.concat(
            want,
            '<path d="M600 0V1080M0 600H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>',
            '<path d="M660 0V1080M0 660H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>',
            '<path d="M720 0V1080M0 720H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>',
            '<path d="M780 0V1080M0 780H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>',
            '<path d="M840 0V1080M0 840H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>',
            '<path d="M900 0V1080M0 900H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>',
            '<path d="M960 0V1080M0 960H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>'
        );
        want = string.concat(
            want,
            '<path d="M1020 0V1080M0 1020H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>',
            '<rect x="48" y="48" width="984" height="984" fill="none" stroke="#d9a94b" stroke-width="3"/>',
            '<rect x="60" y="60" width="960" height="960" fill="none" stroke="#d9a94b" stroke-width="1" opacity="0.6"/>',
            '<path d="M48 78V48H78M1032 1002V1032H1002" fill="none" stroke="#e9e6da" stroke-width="4"/>',
            '<path d="M300 300H780" stroke="#223029" stroke-width="1" stroke-dasharray="2 6"/>',
            '<text x="792" y="304" font-family="Consolas, \'Courier New\', monospace" font-size="12" fill="#9aa89f">111001</text>',
            '<path d="M300 356H780" stroke="#223029" stroke-width="1" stroke-dasharray="2 6"/>'
        );
        want = string.concat(
            want,
            '<text x="792" y="360" font-family="Consolas, \'Courier New\', monospace" font-size="12" fill="#9aa89f">100111</text>',
            '<path d="M300 412H780" stroke="#223029" stroke-width="1" stroke-dasharray="2 6"/>',
            '<text x="792" y="416" font-family="Consolas, \'Courier New\', monospace" font-size="12" fill="#9aa89f">111100</text>',
            '<path d="M300 468H780" stroke="#223029" stroke-width="1" stroke-dasharray="2 6"/>',
            '<text x="792" y="472" font-family="Consolas, \'Courier New\', monospace" font-size="12" fill="#9aa89f">011110</text>',
            '<path d="M300 524H780" stroke="#223029" stroke-width="1" stroke-dasharray="2 6"/>',
            '<text x="792" y="528" font-family="Consolas, \'Courier New\', monospace" font-size="12" fill="#9aa89f">100101</text>'
        );
        want = string.concat(
            want,
            '<path d="M300 580H780" stroke="#223029" stroke-width="1" stroke-dasharray="2 6"/>',
            '<text x="792" y="584" font-family="Consolas, \'Courier New\', monospace" font-size="12" fill="#9aa89f">010001</text>',
            '<path d="M300 636H780" stroke="#223029" stroke-width="1" stroke-dasharray="2 6"/>',
            '<text x="792" y="640" font-family="Consolas, \'Courier New\', monospace" font-size="12" fill="#9aa89f">110101</text>',
            '<path d="M300 692H780" stroke="#223029" stroke-width="1" stroke-dasharray="2 6"/>',
            '<text x="792" y="696" font-family="Consolas, \'Courier New\', monospace" font-size="12" fill="#9aa89f">110101</text>',
            '<path d="M300 748H780" stroke="#223029" stroke-width="1" stroke-dasharray="2 6"/>'
        );
        want = string.concat(
            want,
            '<text x="792" y="752" font-family="Consolas, \'Courier New\', monospace" font-size="12" fill="#9aa89f">001110</text>',
            '<text x="150" y="250" font-family="Consolas, \'Courier New\', monospace" font-size="13" letter-spacing="1" fill="#9aa89f" opacity="0.5" transform="rotate(90 150 250)">10011000001101000000001000100001101000100100111100000001</text>',
            '<text x="176" y="250" font-family="Consolas, \'Courier New\', monospace" font-size="13" letter-spacing="1" fill="#9aa89f" opacity="0.5" transform="rotate(90 176 250)">11001010100101000001011100001000000100010011111001100110</text>',
            '<circle cx="566" cy="240" r="1.7" fill="#5fd0a3" opacity="0.5" filter="url(#glow)"/>',
            '<circle cx="681" cy="628" r="1.7" fill="#5fd0a3" opacity="0.5" filter="url(#glow)"/>',
            '<circle cx="591" cy="661" r="2" fill="#5fd0a3" opacity="0.7" filter="url(#glow)"/>',
            '<circle cx="808" cy="772" r="1.8" fill="#5fd0a3" opacity="0.5" filter="url(#glow)"/>'
        );
        want = string.concat(
            want,
            '<circle cx="453" cy="531" r="2.7" fill="#5fd0a3" opacity="0.5" filter="url(#glow)"/>',
            '<circle cx="215" cy="247" r="2.7" fill="#5fd0a3" opacity="0.5" filter="url(#glow)"/>',
            '<circle cx="198" cy="726" r="2.7" fill="#5fd0a3" opacity="0.7" filter="url(#glow)"/>',
            '<circle cx="753" cy="574" r="1.5" fill="#5fd0a3" opacity="0.6" filter="url(#glow)"/>',
            '<circle cx="714" cy="242" r="2.1" fill="#5fd0a3" opacity="0.7" filter="url(#glow)"/>',
            '<circle cx="151" cy="625" r="1.5" fill="#5fd0a3" opacity="0.5" filter="url(#glow)"/>',
            '<circle cx="817" cy="473" r="2.2" fill="#5fd0a3" opacity="0.6" filter="url(#glow)"/>'
        );
        want = string.concat(
            want,
            '<circle cx="688" cy="271" r="2.7" fill="#5fd0a3" opacity="0.7" filter="url(#glow)"/>',
            '<circle cx="498" cy="372" r="2" fill="#5fd0a3" opacity="0.5" filter="url(#glow)"/>',
            '<circle cx="355" cy="478" r="2.3" fill="#5fd0a3" opacity="0.7" filter="url(#glow)"/>',
            '<circle cx="362" cy="679" r="2" fill="#5fd0a3" opacity="0.5" filter="url(#glow)"/>',
            '<circle cx="556" cy="686" r="2.1" fill="#5fd0a3" opacity="0.8" filter="url(#glow)"/>',
            '<circle cx="195" cy="794" r="1.9" fill="#5fd0a3" opacity="0.7" filter="url(#glow)"/>',
            '<circle cx="762" cy="388" r="1.7" fill="#5fd0a3" opacity="0.6" filter="url(#glow)"/>'
        );
        want = string.concat(
            want,
            '<circle cx="866" cy="775" r="2.4" fill="#5fd0a3" opacity="0.7" filter="url(#glow)"/>',
            '<circle cx="493" cy="715" r="2.2" fill="#5fd0a3" opacity="0.5" filter="url(#glow)"/>',
            '<circle cx="321" cy="645" r="1.5" fill="#5fd0a3" opacity="0.7" filter="url(#glow)"/>',
            '<circle cx="737" cy="577" r="1.7" fill="#5fd0a3" opacity="0.4" filter="url(#glow)"/>',
            '<circle cx="863" cy="358" r="1.8" fill="#5fd0a3" opacity="0.6" filter="url(#glow)"/>',
            '<circle cx="818" cy="291" r="2" fill="#5fd0a3" opacity="0.6" filter="url(#glow)"/>',
            '<circle cx="934" cy="824" r="1.8" fill="#5fd0a3" opacity="0.4" filter="url(#glow)"/>'
        );
        want = string.concat(
            want,
            '<circle cx="310" cy="752" r="2.3" fill="#5fd0a3" opacity="0.5" filter="url(#glow)"/>',
            '<circle cx="977" cy="284" r="1.9" fill="#5fd0a3" opacity="0.6" filter="url(#glow)"/>',
            '<circle cx="517" cy="474" r="2.6" fill="#5fd0a3" opacity="0.5" filter="url(#glow)"/>',
            '<circle cx="625" cy="337" r="1.6" fill="#5fd0a3" opacity="0.6" filter="url(#glow)"/>',
            '<circle cx="288" cy="834" r="1.9" fill="#5fd0a3" opacity="0.7" filter="url(#glow)"/>',
            '<circle cx="756" cy="301" r="2.5" fill="#5fd0a3" opacity="0.5" filter="url(#glow)"/>',
            '<circle cx="236" cy="520" r="2.3" fill="#5fd0a3" opacity="0.7" filter="url(#glow)"/>'
        );
        want = string.concat(
            want,
            '<circle cx="434" cy="676" r="2.6" fill="#5fd0a3" opacity="0.7" filter="url(#glow)"/>',
            '<circle cx="192" cy="491" r="2.1" fill="#5fd0a3" opacity="0.8" filter="url(#glow)"/>',
            '<circle cx="285" cy="639" r="2.3" fill="#5fd0a3" opacity="0.5" filter="url(#glow)"/>',
            '<circle cx="419" cy="671" r="2.2" fill="#5fd0a3" opacity="0.5" filter="url(#glow)"/>',
            '<circle cx="198" cy="447" r="2.2" fill="#5fd0a3" opacity="0.7" filter="url(#glow)"/>',
            '<circle cx="563" cy="365" r="2" fill="#5fd0a3" opacity="0.5" filter="url(#glow)"/>',
            '<circle cx="871" cy="377" r="1.7" fill="#5fd0a3" opacity="0.7" filter="url(#glow)"/>'
        );
        want = string.concat(
            want,
            '<circle cx="261" cy="806" r="2.2" fill="#5fd0a3" opacity="0.6" filter="url(#glow)"/>',
            '<circle cx="147" cy="445" r="2.2" fill="#5fd0a3" opacity="0.5" filter="url(#glow)"/>',
            '<circle cx="743" cy="575" r="1.9" fill="#5fd0a3" opacity="0.5" filter="url(#glow)"/>\n',
            '<g transform="translate(540 584) rotate(-3) scale(7.1) translate(-32 -52)" font-family="Consolas, \'Courier New\', monospace" letter-spacing="0.25">',
            "<defs>",
            '<path id="shell" d="M32 11C23.3 23.1 16.7 43.3 16.7 58.5C18.9 73.6 25.5 87.8 32 93.8C38.5 87.8 45.1 73.6 47.3 58.5C47.3 43.3 40.7 23.1 32 11Z"/>',
            '<path id="shell2" d="M32 13.5C24.5 24.8 18.9 43.6 18.9 57.6C20.8 71.7 26.4 84.9 32 90.5C37.6 84.9 43.2 71.7 45.1 57.6C45.1 43.6 39.5 24.8 32 13.5Z"/>'
        );
        want = string.concat(
            want,
            '<path id="wing" d="M32 30C23.4 39.9 19.6 53.8 24.4 73.6C28.2 67.6 31 60.7 32 53.8C33 60.7 35.8 67.6 39.6 73.6C44.4 53.8 40.6 39.9 32 30Z"/>',
            '<path id="wing2" d="M32 34C25.8 42.1 23 53.5 26.5 69.7C29.2 64.8 31.3 59.2 32 53.5C32.7 59.2 34.8 64.8 37.5 69.7C41 53.5 38.2 42.1 32 34Z"/>',
            '<path id="band" d="M23.2 29C26.6 26.4 37.4 26.4 40.8 29"/>',
            '<path id="vein" d="M32 30v43.6"/></defs>',
            '<text font-size="2.8" fill="#e9e6da" ><textPath href="#shell">1111100011100100111010000001100001000001110101111110010101001010001111010100100001001001100101001010110111011000001101111101011111000110010111010101000110001110011110110101010001000000010001</textPath></text>',
            '<text font-size="1.8" fill="#e9e6da" opacity="0.45"><textPath href="#shell2">111110001011101111110011011111101011110100101000000100100011010010110111111001111110001110011000110101111000100111101011110111110111110010000100010100000000000011000001101101100001000000011111011111101001011100</textPath></text>',
            '<text font-size="2.5" fill="#5fd0a3" filter="url(#soft)"><textPath href="#wing">1100111111101011101101100110110100011110110110101010111100001011100110110011001101100101000111111010100011111100011100000100001010</textPath></text>'
        );
        want = string.concat(
            want,
            '<text font-size="1.7" fill="#5fd0a3" opacity="0.55"><textPath href="#wing2">01101111001001011111111001101110001001101111100010000110001101000110000011000001010001110101011011110111110011110011010101110000100100010001</textPath></text>',
            '<text font-size="1.9" fill="#5fd0a3" opacity="0.8"><textPath href="#vein">0010101011111001011101111000111010000110</textPath></text>',
            '<text font-size="2.7" fill="#d9a94b" ><textPath href="#band">011101101110111110011101010001</textPath></text>',
            '<path d="M16.7 64.5q15.3 4 30.5 0" stroke="#e9e6da" stroke-width="0.5" fill="none" opacity="0.45" stroke-dasharray="0.8 1.2"/>',
            '<path d="M20 71.6q12 4 24 0" stroke="#e9e6da" stroke-width="0.5" fill="none" opacity="0.45" stroke-dasharray="0.8 1.2"/>',
            '<path d="M23.3 78.7q8.7 4 17.4 0" stroke="#e9e6da" stroke-width="0.5" fill="none" opacity="0.45" stroke-dasharray="0.8 1.2"/>',
            '<path d="M26.5 85.7q5.5 4 10.9 0" stroke="#e9e6da" stroke-width="0.5" fill="none" opacity="0.45" stroke-dasharray="0.8 1.2"/>'
        );
        want = string.concat(
            want,
            '<path transform="translate(0 -0.4)" d="M24.9 73c1.9-3.6 4.6-6.6 7.1-9.4 2.6 2.8 5.2 5.8 7.1 9.4" stroke="#d9a94b" stroke-width="0.9" fill="none" stroke-linecap="round"/>',
            '<path d="M32 2v9" stroke="#e9e6da" stroke-width="0.8" fill="none"/></g>\n',
            unicode'<text x="92" y="122" font-family="Consolas, \'Courier New\', monospace" font-size="24" letter-spacing="3" fill="#9aa89f">METAMORPH.MD · PUPATE</text>\n',
            '<text x="92" y="204" font-family="Georgia, \'Times New Roman\', serif" font-size="76" fill="#e9e6da">#1</text>\n',
            '<text x="988" y="122" font-family="Consolas, \'Courier New\', monospace" font-size="24" letter-spacing="3" text-anchor="end" fill="#3ec28f">IN THE COCOON</text>',
            unicode'<text x="92" y="984" font-family="Consolas, \'Courier New\', monospace" font-size="24" letter-spacing="2" fill="#9aa89f">seat identity.md #1376 · edition 1 of 303</text>\n</svg>'
        );
    }

    /// `node script/art/mirror.mjs render 1376 0 1 1 0 1` (10813 bytes).
    function _svg1376Butterfly() internal pure returns (string memory want) {
        want = string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1080" width="1080" height="1080">\n',
            "<defs>\n  ",
            '<filter id="glow" x="-200%" y="-200%" width="500%" height="500%"><feGaussianBlur stdDeviation="1.6"/></filter>\n  ',
            '<filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="0.6"/></filter>\n</defs>\n',
            '<rect width="1080" height="1080" fill="#0b1410"/>\n',
            '<path d="M60 0V1080M0 60H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>',
            '<path d="M120 0V1080M0 120H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>'
        );
        want = string.concat(
            want,
            '<path d="M180 0V1080M0 180H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>',
            '<path d="M240 0V1080M0 240H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>',
            '<path d="M300 0V1080M0 300H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>',
            '<path d="M360 0V1080M0 360H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>',
            '<path d="M420 0V1080M0 420H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>',
            '<path d="M480 0V1080M0 480H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>',
            '<path d="M540 0V1080M0 540H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>'
        );
        want = string.concat(
            want,
            '<path d="M600 0V1080M0 600H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>',
            '<path d="M660 0V1080M0 660H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>',
            '<path d="M720 0V1080M0 720H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>',
            '<path d="M780 0V1080M0 780H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>',
            '<path d="M840 0V1080M0 840H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>',
            '<path d="M900 0V1080M0 900H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>',
            '<path d="M960 0V1080M0 960H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>'
        );
        want = string.concat(
            want,
            '<path d="M1020 0V1080M0 1020H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>',
            '<rect x="48" y="48" width="984" height="984" fill="none" stroke="#d9a94b" stroke-width="3"/>',
            '<rect x="60" y="60" width="960" height="960" fill="none" stroke="#d9a94b" stroke-width="1" opacity="0.6"/>',
            '<path d="M48 78V48H78M1032 1002V1032H1002" fill="none" stroke="#e9e6da" stroke-width="4"/>',
            '<text x="150" y="250" font-family="Consolas, \'Courier New\', monospace" font-size="13" letter-spacing="1" fill="#9aa89f" opacity="0.5" transform="rotate(90 150 250)">10011000001101000000001000100001101000100100111100000001</text>',
            '<text x="176" y="250" font-family="Consolas, \'Courier New\', monospace" font-size="13" letter-spacing="1" fill="#9aa89f" opacity="0.5" transform="rotate(90 176 250)">11001010100101000001011100001000000100010011111001100110</text>',
            '<circle cx="566" cy="240" r="1.7" fill="#5fd0a3" opacity="0.5" filter="url(#glow)"/>'
        );
        want = string.concat(
            want,
            '<circle cx="681" cy="628" r="1.7" fill="#5fd0a3" opacity="0.5" filter="url(#glow)"/>',
            '<circle cx="591" cy="661" r="2" fill="#5fd0a3" opacity="0.7" filter="url(#glow)"/>',
            '<circle cx="808" cy="772" r="1.8" fill="#5fd0a3" opacity="0.5" filter="url(#glow)"/>',
            '<circle cx="453" cy="531" r="2.7" fill="#5fd0a3" opacity="0.5" filter="url(#glow)"/>',
            '<circle cx="215" cy="247" r="2.7" fill="#5fd0a3" opacity="0.5" filter="url(#glow)"/>',
            '<circle cx="198" cy="726" r="2.7" fill="#5fd0a3" opacity="0.7" filter="url(#glow)"/>',
            '<circle cx="753" cy="574" r="1.5" fill="#5fd0a3" opacity="0.6" filter="url(#glow)"/>'
        );
        want = string.concat(
            want,
            '<circle cx="714" cy="242" r="2.1" fill="#5fd0a3" opacity="0.7" filter="url(#glow)"/>',
            '<circle cx="151" cy="625" r="1.5" fill="#5fd0a3" opacity="0.5" filter="url(#glow)"/>',
            '<circle cx="817" cy="473" r="2.2" fill="#5fd0a3" opacity="0.6" filter="url(#glow)"/>',
            '<circle cx="688" cy="271" r="2.7" fill="#5fd0a3" opacity="0.7" filter="url(#glow)"/>',
            '<circle cx="498" cy="372" r="2" fill="#5fd0a3" opacity="0.5" filter="url(#glow)"/>',
            '<circle cx="355" cy="478" r="2.3" fill="#5fd0a3" opacity="0.7" filter="url(#glow)"/>',
            '<circle cx="362" cy="679" r="2" fill="#5fd0a3" opacity="0.5" filter="url(#glow)"/>'
        );
        want = string.concat(
            want,
            '<circle cx="556" cy="686" r="2.1" fill="#5fd0a3" opacity="0.8" filter="url(#glow)"/>',
            '<circle cx="195" cy="794" r="1.9" fill="#5fd0a3" opacity="0.7" filter="url(#glow)"/>',
            '<circle cx="762" cy="388" r="1.7" fill="#5fd0a3" opacity="0.6" filter="url(#glow)"/>',
            '<circle cx="866" cy="775" r="2.4" fill="#5fd0a3" opacity="0.7" filter="url(#glow)"/>',
            '<circle cx="493" cy="715" r="2.2" fill="#5fd0a3" opacity="0.5" filter="url(#glow)"/>',
            '<circle cx="321" cy="645" r="1.5" fill="#5fd0a3" opacity="0.7" filter="url(#glow)"/>',
            '<circle cx="737" cy="577" r="1.7" fill="#5fd0a3" opacity="0.4" filter="url(#glow)"/>'
        );
        want = string.concat(
            want,
            '<circle cx="863" cy="358" r="1.8" fill="#5fd0a3" opacity="0.6" filter="url(#glow)"/>',
            '<circle cx="818" cy="291" r="2" fill="#5fd0a3" opacity="0.6" filter="url(#glow)"/>',
            '<circle cx="934" cy="824" r="1.8" fill="#5fd0a3" opacity="0.4" filter="url(#glow)"/>',
            '<circle cx="310" cy="752" r="2.3" fill="#5fd0a3" opacity="0.5" filter="url(#glow)"/>',
            '<circle cx="977" cy="284" r="1.9" fill="#5fd0a3" opacity="0.6" filter="url(#glow)"/>',
            '<circle cx="517" cy="474" r="2.6" fill="#5fd0a3" opacity="0.5" filter="url(#glow)"/>',
            '<circle cx="625" cy="337" r="1.6" fill="#5fd0a3" opacity="0.6" filter="url(#glow)"/>'
        );
        want = string.concat(
            want,
            '<circle cx="288" cy="834" r="1.9" fill="#5fd0a3" opacity="0.7" filter="url(#glow)"/>',
            '<circle cx="756" cy="301" r="2.5" fill="#5fd0a3" opacity="0.5" filter="url(#glow)"/>',
            '<circle cx="236" cy="520" r="2.3" fill="#5fd0a3" opacity="0.7" filter="url(#glow)"/>',
            '<circle cx="434" cy="676" r="2.6" fill="#5fd0a3" opacity="0.7" filter="url(#glow)"/>',
            '<circle cx="192" cy="491" r="2.1" fill="#5fd0a3" opacity="0.8" filter="url(#glow)"/>',
            '<circle cx="285" cy="639" r="2.3" fill="#5fd0a3" opacity="0.5" filter="url(#glow)"/>',
            '<circle cx="419" cy="671" r="2.2" fill="#5fd0a3" opacity="0.5" filter="url(#glow)"/>'
        );
        want = string.concat(
            want,
            '<circle cx="198" cy="447" r="2.2" fill="#5fd0a3" opacity="0.7" filter="url(#glow)"/>',
            '<circle cx="563" cy="365" r="2" fill="#5fd0a3" opacity="0.5" filter="url(#glow)"/>',
            '<circle cx="871" cy="377" r="1.7" fill="#5fd0a3" opacity="0.7" filter="url(#glow)"/>',
            '<circle cx="261" cy="806" r="2.2" fill="#5fd0a3" opacity="0.6" filter="url(#glow)"/>',
            '<circle cx="147" cy="445" r="2.2" fill="#5fd0a3" opacity="0.5" filter="url(#glow)"/>',
            '<circle cx="743" cy="575" r="1.9" fill="#5fd0a3" opacity="0.5" filter="url(#glow)"/>\n',
            '<g transform="translate(540 596) rotate(-3) scale(2.4)" font-family="Consolas, \'Courier New\', monospace">\n'
        );
        want = string.concat(
            want,
            "<defs>",
            '<path id="up" d="M4 -22C57.4 -124.4 122.7 -119.3 122.7 -52.7C120.4 -4 69.3 16 4 10Z"/>',
            '<path id="lo" d="M4 10C90.6 6 109.9 75.8 52.1 119.6C28.1 110.9 10 64.8 4 30Z"/>',
            '<path id="up2" transform="translate(4 -6) scale(0.82)" d="M4 -22C57.4 -124.4 122.7 -119.3 122.7 -52.7C120.4 -4 69.3 16 4 10Z"/>\n',
            '<clipPath id="cu">',
            '<path d="M4 -22C57.4 -124.4 122.7 -119.3 122.7 -52.7C120.4 -4 69.3 16 4 10Z"/></clipPath>',
            '<clipPath id="cl">'
        );
        want = string.concat(
            want,
            '<path d="M4 10C90.6 6 109.9 75.8 52.1 119.6C28.1 110.9 10 64.8 4 30Z"/></clipPath>',
            '<path id="body" d="M0 -36V40"/></defs>\n',
            "<g>",
            '<text font-size="10.9" fill="#5fd0a3" letter-spacing="0.6"><textPath href="#up">101010011011011101101100101001000101111100001011110000000101010110001011010111100110101001001010001010001011011001110001</textPath></text>',
            '<text font-size="10.4" fill="#5fd0a3" letter-spacing="0.6"><textPath href="#lo">1110001100110110100110111100010010000011100110011010001000110100000101001000100111110101001101100011</textPath></text>',
            '<text font-size="6.7" fill="#e9e6da" opacity="0.35" letter-spacing="0.5"><textPath href="#up2">00111011010101111101111101000001000011111010111010101101110101011010010010010110100100001010010000100000111110101101111011110110001011010011</textPath></text>',
            '<path d="M6 -8L57.3 -104.4" stroke="#5fd0a3" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cu)"/>'
        );
        want = string.concat(
            want,
            '<path d="M6 -8L91.2 -76.3" stroke="#5fd0a3" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cu)"/>',
            '<path d="M6 -8L111.4 -36.8" stroke="#5fd0a3" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cu)"/>',
            '<path d="M6 -8L114.2 7.2" stroke="#5fd0a3" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cu)"/>',
            '<path d="M6 16L97.5 53" stroke="#5fd0a3" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cl)"/>',
            '<path d="M6 16L72 89.3" stroke="#5fd0a3" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cl)"/>',
            '<path d="M6 16L33.2 110.8" stroke="#5fd0a3" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cl)"/>',
            '<circle cx="99" cy="-85.5" r="5" fill="#d9a94b"/></g>'
        );
        want = string.concat(
            want,
            '<g transform="scale(-1 1)">',
            "<g>",
            '<text font-size="10.9" fill="#5fd0a3" letter-spacing="0.6"><textPath href="#up">101010011011011101101100101001000101111100001011110000000101010110001011010111100110101001001010001010001011011001110001</textPath></text>',
            '<text font-size="10.4" fill="#5fd0a3" letter-spacing="0.6"><textPath href="#lo">1110001100110110100110111100010010000011100110011010001000110100000101001000100111110101001101100011</textPath></text>',
            '<text font-size="6.7" fill="#e9e6da" opacity="0.35" letter-spacing="0.5"><textPath href="#up2">00111011010101111101111101000001000011111010111010101101110101011010010010010110100100001010010000100000111110101101111011110110001011010011</textPath></text>',
            '<path d="M6 -8L57.3 -104.4" stroke="#5fd0a3" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cu)"/>',
            '<path d="M6 -8L91.2 -76.3" stroke="#5fd0a3" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cu)"/>'
        );
        want = string.concat(
            want,
            '<path d="M6 -8L111.4 -36.8" stroke="#5fd0a3" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cu)"/>',
            '<path d="M6 -8L114.2 7.2" stroke="#5fd0a3" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cu)"/>',
            '<path d="M6 16L97.5 53" stroke="#5fd0a3" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cl)"/>',
            '<path d="M6 16L72 89.3" stroke="#5fd0a3" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cl)"/>',
            '<path d="M6 16L33.2 110.8" stroke="#5fd0a3" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cl)"/>',
            '<circle cx="99" cy="-85.5" r="5" fill="#d9a94b"/></g></g>\n',
            '<path d="M-2 -52C-8 -76 -22 -90 -32 -93M2 -52C8 -76 22 -90 32 -93" stroke="#e9e6da" stroke-width="1.4" fill="none" stroke-linecap="round"/>\n'
        );
        want = string.concat(
            want,
            '<circle cx="-32" cy="-93" r="2.2" fill="#e9e6da"/>',
            '<circle cx="32" cy="-93" r="2.2" fill="#e9e6da"/>\n',
            '<circle cx="0" cy="-48" r="6.5" fill="#e9e6da"/>',
            '<ellipse cx="0" cy="2" rx="5.5" ry="44" fill="#e9e6da"/>\n',
            '<text font-size="5.5" fill="#0b1410" letter-spacing="0.3" writing-mode="tb"><textPath href="#body">11110000101001</textPath></text>\n</g>\n',
            unicode'<text x="92" y="122" font-family="Consolas, \'Courier New\', monospace" font-size="24" letter-spacing="3" fill="#9aa89f">METAMORPH.MD · PUPATE</text>\n',
            '<text x="92" y="204" font-family="Georgia, \'Times New Roman\', serif" font-size="76" fill="#e9e6da">#1</text>\n'
        );
        want = string.concat(
            want,
            '<text x="988" y="122" font-family="Consolas, \'Courier New\', monospace" font-size="24" letter-spacing="3" text-anchor="end" fill="#d9a94b">EMERGED</text>',
            unicode'<text x="92" y="984" font-family="Consolas, \'Courier New\', monospace" font-size="24" letter-spacing="2" fill="#9aa89f">seat identity.md #1376 · edition 1 of 303</text>\n</svg>'
        );
    }

    /// `node script/art/mirror.mjs render 2345 0 5 0 1 777` (10104 bytes).
    function _svg2345Chrysalis() internal pure returns (string memory want) {
        want = string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1080" width="1080" height="1080">\n',
            "<defs>\n  ",
            '<filter id="glow" x="-200%" y="-200%" width="500%" height="500%"><feGaussianBlur stdDeviation="1.6"/></filter>\n  ',
            '<filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="0.6"/></filter>\n</defs>\n',
            '<rect width="1080" height="1080" fill="#0b1410"/>\n',
            '<path d="M60 0V1080M0 60H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>',
            '<path d="M120 0V1080M0 120H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>'
        );
        want = string.concat(
            want,
            '<path d="M180 0V1080M0 180H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>',
            '<path d="M240 0V1080M0 240H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>',
            '<path d="M300 0V1080M0 300H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>',
            '<path d="M360 0V1080M0 360H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>',
            '<path d="M420 0V1080M0 420H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>',
            '<path d="M480 0V1080M0 480H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>',
            '<path d="M540 0V1080M0 540H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>'
        );
        want = string.concat(
            want,
            '<path d="M600 0V1080M0 600H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>',
            '<path d="M660 0V1080M0 660H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>',
            '<path d="M720 0V1080M0 720H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>',
            '<path d="M780 0V1080M0 780H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>',
            '<path d="M840 0V1080M0 840H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>',
            '<path d="M900 0V1080M0 900H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>',
            '<path d="M960 0V1080M0 960H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>'
        );
        want = string.concat(
            want,
            '<path d="M1020 0V1080M0 1020H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>',
            '<rect x="48" y="48" width="984" height="984" fill="none" stroke="#223029" stroke-width="2"/>',
            '<path d="M1032 1002V1032H1002" fill="none" stroke="#d9a94b" stroke-width="4"/>',
            '<path d="M48 78V48H78" fill="none" stroke="#e9e6da" stroke-width="4"/>',
            '<text x="113" y="328" font-family="Consolas, \'Courier New\', monospace" font-size="13" letter-spacing="1" fill="#9aa89f" opacity="0.5" transform="rotate(90 113 328)">01000101</text>',
            '<text x="164" y="541" font-family="Consolas, \'Courier New\', monospace" font-size="13" letter-spacing="1" fill="#9aa89f" opacity="0.5" transform="rotate(90 164 541)">111011100001</text>',
            '<text x="761" y="414" font-family="Consolas, \'Courier New\', monospace" font-size="13" letter-spacing="1" fill="#9aa89f" opacity="0.5" transform="rotate(90 761 414)">11011010101000</text>'
        );
        want = string.concat(
            want,
            '<text x="186" y="581" font-family="Consolas, \'Courier New\', monospace" font-size="13" letter-spacing="1" fill="#9aa89f" opacity="0.5" transform="rotate(90 186 581)">00001000010000111100</text>',
            '<text x="930" y="443" font-family="Consolas, \'Courier New\', monospace" font-size="13" letter-spacing="1" fill="#9aa89f" opacity="0.5" transform="rotate(90 930 443)">10011010010001</text>',
            '<text x="553" y="458" font-family="Consolas, \'Courier New\', monospace" font-size="13" letter-spacing="1" fill="#9aa89f" opacity="0.5" transform="rotate(90 553 458)">11111001111100</text>',
            '<text x="196" y="256" font-family="Consolas, \'Courier New\', monospace" font-size="13" letter-spacing="1" fill="#9aa89f" opacity="0.5" transform="rotate(90 196 256)">1000010001100</text>',
            '<text x="288" y="332" font-family="Consolas, \'Courier New\', monospace" font-size="13" letter-spacing="1" fill="#9aa89f" opacity="0.5" transform="rotate(90 288 332)">111110010111000010</text>',
            '<text x="936" y="371" font-family="Consolas, \'Courier New\', monospace" font-size="13" letter-spacing="1" fill="#9aa89f" opacity="0.5" transform="rotate(90 936 371)">0100011110001010</text>',
            '<path id="h306" d="M234 584a306 306 0 1 1 612 0a306 306 0 1 1 -612 0" fill="none"/>'
        );
        want = string.concat(
            want,
            '<text font-family="Consolas, \'Courier New\', monospace" font-size="14" letter-spacing="2" fill="#d9a94b" opacity="0.5"><textPath href="#h306">01111011100001000000111100110010010110111110101100100101101000101001000011110011100101011011011110111000111010010000101111001001101100110001011001010101001111100001001101111110010110000101101011000110110101011001101011011100011101100101111011001111111101001010</textPath></text>',
            '<circle cx="540" cy="584" r="338" fill="none" stroke="#223029" stroke-width="1" stroke-dasharray="3 9"/>',
            '<circle cx="828.2" cy="407.4" r="7" fill="#d9a94b"/>',
            '<circle cx="763" cy="785" r="2" fill="#d9a94b" opacity="0.5" filter="url(#glow)"/>',
            '<circle cx="626" cy="722" r="1.8" fill="#d9a94b" opacity="0.4" filter="url(#glow)"/>',
            '<circle cx="590" cy="530" r="2.3" fill="#d9a94b" opacity="0.5" filter="url(#glow)"/>',
            '<circle cx="601" cy="620" r="2.1" fill="#d9a94b" opacity="0.7" filter="url(#glow)"/>'
        );
        want = string.concat(
            want,
            '<circle cx="758" cy="633" r="2" fill="#d9a94b" opacity="0.7" filter="url(#glow)"/>',
            '<circle cx="565" cy="484" r="2.2" fill="#d9a94b" opacity="0.5" filter="url(#glow)"/>',
            '<circle cx="594" cy="765" r="1.6" fill="#d9a94b" opacity="0.5" filter="url(#glow)"/>',
            '<circle cx="597" cy="246" r="2.6" fill="#d9a94b" opacity="0.6" filter="url(#glow)"/>',
            '<circle cx="580" cy="284" r="1.7" fill="#d9a94b" opacity="0.8" filter="url(#glow)"/>',
            '<circle cx="921" cy="738" r="2" fill="#d9a94b" opacity="0.6" filter="url(#glow)"/>',
            '<circle cx="593" cy="613" r="2.1" fill="#d9a94b" opacity="0.7" filter="url(#glow)"/>'
        );
        want = string.concat(
            want,
            '<circle cx="802" cy="585" r="2" fill="#d9a94b" opacity="0.4" filter="url(#glow)"/>',
            '<circle cx="979" cy="559" r="1.7" fill="#d9a94b" opacity="0.5" filter="url(#glow)"/>',
            '<circle cx="731" cy="784" r="1.7" fill="#d9a94b" opacity="0.8" filter="url(#glow)"/>',
            '<circle cx="692" cy="316" r="2.3" fill="#d9a94b" opacity="0.8" filter="url(#glow)"/>',
            '<circle cx="484" cy="535" r="1.8" fill="#d9a94b" opacity="0.6" filter="url(#glow)"/>',
            '<circle cx="197" cy="384" r="1.8" fill="#d9a94b" opacity="0.6" filter="url(#glow)"/>',
            '<circle cx="854" cy="773" r="2.3" fill="#d9a94b" opacity="0.6" filter="url(#glow)"/>'
        );
        want = string.concat(
            want,
            '<circle cx="440" cy="613" r="1.8" fill="#d9a94b" opacity="0.5" filter="url(#glow)"/>',
            '<circle cx="380" cy="835" r="2.5" fill="#d9a94b" opacity="0.7" filter="url(#glow)"/>',
            '<circle cx="816" cy="626" r="2.7" fill="#d9a94b" opacity="0.6" filter="url(#glow)"/>',
            '<circle cx="944" cy="347" r="2.4" fill="#d9a94b" opacity="0.5" filter="url(#glow)"/>',
            '<circle cx="368" cy="777" r="2.3" fill="#d9a94b" opacity="0.5" filter="url(#glow)"/>',
            '<circle cx="795" cy="819" r="1.9" fill="#d9a94b" opacity="0.5" filter="url(#glow)"/>',
            '<circle cx="512" cy="425" r="1.7" fill="#d9a94b" opacity="0.6" filter="url(#glow)"/>'
        );
        want = string.concat(
            want,
            '<circle cx="886" cy="707" r="2.5" fill="#d9a94b" opacity="0.6" filter="url(#glow)"/>\n',
            '<g transform="translate(540 584) rotate(3.4) scale(6) translate(-32 -52)" font-family="Consolas, \'Courier New\', monospace" letter-spacing="0.25">',
            "<defs>",
            '<path id="shell" d="M32 11C14.7 17.6 9.3 36.4 12.6 55.2C15.8 71.2 23.4 83.4 32 88.1C40.6 83.4 48.2 71.2 51.4 55.2C54.7 36.4 49.3 17.6 32 11Z"/>',
            '<path id="shell2" d="M32 13.4C17.1 19.5 12.5 37 15.3 54.5C18.1 69.3 24.6 80.7 32 85.1C39.4 80.7 45.9 69.3 48.7 54.5C51.5 37 46.9 19.5 32 13.4Z"/>',
            '<path id="wing" d="M32 30C21.3 39.7 16.5 53.3 22.5 72.7C27.2 66.9 30.8 60.1 32 53.3C33.2 60.1 36.8 66.9 41.5 72.7C47.5 53.3 42.7 39.7 32 30Z"/>',
            '<path id="wing2" d="M32 34C24.2 42 20.7 53.1 25.1 69C28.5 64.2 31.1 58.7 32 53.1C32.9 58.7 35.5 64.2 38.9 69C43.3 53.1 39.8 42 32 34Z"/>'
        );
        want = string.concat(
            want,
            '<path id="band" d="M16.8 29C22.7 26.4 41.3 26.4 47.2 29"/>',
            '<path id="vein" d="M32 30v42.7"/></defs>',
            '<text font-size="2.3" fill="#d9a94b" ><textPath href="#shell">1011001110010010010010111100010101011100101100010010001111100010001000010100111101101000011101110000000001011010001100011100111011000001000101110101000111001100010111001111111010111011110010</textPath></text>',
            '<text font-size="1.5" fill="#d9a94b" opacity="0.45"><textPath href="#shell2">101010110001101110101011101101010011111000000100010110010011010011100100000010110100100110011111001000011110010011010100000111110011100000100100001111101001110100100011100000101101110001110111101011100001111001</textPath></text>',
            '<text font-size="2.1" fill="#3ec28f" filter="url(#soft)"><textPath href="#wing">0111111111010100110110101010100111010011000111011001001110010010100100101010010110100111110000001011111011100110110100011011100101</textPath></text>',
            '<text font-size="1.4" fill="#3ec28f" opacity="0.55"><textPath href="#wing2">00100010101001100101010000100010110101001001111011100000010101111000001011011001110100110101011001110110011110110001000100001011110010011111</textPath></text>',
            '<text font-size="1.6" fill="#3ec28f" opacity="0.8"><textPath href="#vein">1110001010000000001100101001100010010110</textPath></text>'
        );
        want = string.concat(
            want,
            '<text font-size="2.2" fill="#e9e6da" ><textPath href="#band">000001001101001010011011001000</textPath></text>',
            '<path d="M16.9 60.8q15.1 4 30.2 0" stroke="#d9a94b" stroke-width="0.5" fill="none" opacity="0.45" stroke-dasharray="0.8 1.2"/>',
            '<path d="M20.1 67.4q11.9 4 23.8 0" stroke="#d9a94b" stroke-width="0.5" fill="none" opacity="0.45" stroke-dasharray="0.8 1.2"/>',
            '<path d="M23.4 74q8.6 4 17.3 0" stroke="#d9a94b" stroke-width="0.5" fill="none" opacity="0.45" stroke-dasharray="0.8 1.2"/>',
            '<path d="M26.6 80.6q5.4 4 10.8 0" stroke="#d9a94b" stroke-width="0.5" fill="none" opacity="0.45" stroke-dasharray="0.8 1.2"/>',
            '<path d="M29.8 87.1q2.2 4 4.3 0" stroke="#d9a94b" stroke-width="0.5" fill="none" opacity="0.45" stroke-dasharray="0.8 1.2"/>',
            '<path transform="translate(0 -1.3)" d="M23.1 73c2.4-3.6 5.7-6.6 8.9-9.4 3.2 2.8 6.5 5.8 8.9 9.4" stroke="#e9e6da" stroke-width="0.9" fill="none" stroke-linecap="round"/>'
        );
        want = string.concat(
            want,
            '<path d="M32 2v9" stroke="#d9a94b" stroke-width="0.8" fill="none"/></g>\n',
            unicode'<text x="92" y="122" font-family="Consolas, \'Courier New\', monospace" font-size="24" letter-spacing="3" fill="#9aa89f">METAMORPH.MD · PUPATE</text>\n',
            '<text x="92" y="204" font-family="Georgia, \'Times New Roman\', serif" font-size="76" fill="#e9e6da">#777</text>\n',
            unicode'<text x="988" y="122" font-family="Consolas, \'Courier New\', monospace" font-size="24" letter-spacing="3" text-anchor="end" fill="#3ec28f">IN THE COCOON · GILT</text>',
            unicode'<text x="92" y="984" font-family="Consolas, \'Courier New\', monospace" font-size="24" letter-spacing="2" fill="#9aa89f">seat identity.md #2345 · edition 5 of 303</text>\n</svg>'
        );
    }

    /// `node script/art/mirror.mjs render 2345 0 5 1 1 777` (11417 bytes).
    function _svg2345Butterfly() internal pure returns (string memory want) {
        want = string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1080" width="1080" height="1080">\n',
            "<defs>\n  ",
            '<filter id="glow" x="-200%" y="-200%" width="500%" height="500%"><feGaussianBlur stdDeviation="1.6"/></filter>\n  ',
            '<filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="0.6"/></filter>\n</defs>\n',
            '<rect width="1080" height="1080" fill="#0b1410"/>\n',
            '<path d="M60 0V1080M0 60H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>',
            '<path d="M120 0V1080M0 120H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>'
        );
        want = string.concat(
            want,
            '<path d="M180 0V1080M0 180H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>',
            '<path d="M240 0V1080M0 240H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>',
            '<path d="M300 0V1080M0 300H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>',
            '<path d="M360 0V1080M0 360H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>',
            '<path d="M420 0V1080M0 420H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>',
            '<path d="M480 0V1080M0 480H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>',
            '<path d="M540 0V1080M0 540H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>'
        );
        want = string.concat(
            want,
            '<path d="M600 0V1080M0 600H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>',
            '<path d="M660 0V1080M0 660H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>',
            '<path d="M720 0V1080M0 720H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>',
            '<path d="M780 0V1080M0 780H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>',
            '<path d="M840 0V1080M0 840H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>',
            '<path d="M900 0V1080M0 900H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>',
            '<path d="M960 0V1080M0 960H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>'
        );
        want = string.concat(
            want,
            '<path d="M1020 0V1080M0 1020H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>',
            '<rect x="48" y="48" width="984" height="984" fill="none" stroke="#223029" stroke-width="2"/>',
            '<path d="M1032 1002V1032H1002" fill="none" stroke="#d9a94b" stroke-width="4"/>',
            '<path d="M48 78V48H78" fill="none" stroke="#e9e6da" stroke-width="4"/>',
            '<text x="113" y="328" font-family="Consolas, \'Courier New\', monospace" font-size="13" letter-spacing="1" fill="#9aa89f" opacity="0.5" transform="rotate(90 113 328)">01000101</text>',
            '<text x="164" y="541" font-family="Consolas, \'Courier New\', monospace" font-size="13" letter-spacing="1" fill="#9aa89f" opacity="0.5" transform="rotate(90 164 541)">111011100001</text>',
            '<text x="761" y="414" font-family="Consolas, \'Courier New\', monospace" font-size="13" letter-spacing="1" fill="#9aa89f" opacity="0.5" transform="rotate(90 761 414)">11011010101000</text>'
        );
        want = string.concat(
            want,
            '<text x="186" y="581" font-family="Consolas, \'Courier New\', monospace" font-size="13" letter-spacing="1" fill="#9aa89f" opacity="0.5" transform="rotate(90 186 581)">00001000010000111100</text>',
            '<text x="930" y="443" font-family="Consolas, \'Courier New\', monospace" font-size="13" letter-spacing="1" fill="#9aa89f" opacity="0.5" transform="rotate(90 930 443)">10011010010001</text>',
            '<text x="553" y="458" font-family="Consolas, \'Courier New\', monospace" font-size="13" letter-spacing="1" fill="#9aa89f" opacity="0.5" transform="rotate(90 553 458)">11111001111100</text>',
            '<text x="196" y="256" font-family="Consolas, \'Courier New\', monospace" font-size="13" letter-spacing="1" fill="#9aa89f" opacity="0.5" transform="rotate(90 196 256)">1000010001100</text>',
            '<text x="288" y="332" font-family="Consolas, \'Courier New\', monospace" font-size="13" letter-spacing="1" fill="#9aa89f" opacity="0.5" transform="rotate(90 288 332)">111110010111000010</text>',
            '<text x="936" y="371" font-family="Consolas, \'Courier New\', monospace" font-size="13" letter-spacing="1" fill="#9aa89f" opacity="0.5" transform="rotate(90 936 371)">0100011110001010</text>',
            '<path id="h306" d="M234 584a306 306 0 1 1 612 0a306 306 0 1 1 -612 0" fill="none"/>'
        );
        want = string.concat(
            want,
            '<text font-family="Consolas, \'Courier New\', monospace" font-size="14" letter-spacing="2" fill="#d9a94b" opacity="0.5"><textPath href="#h306">01111011100001000000111100110010010110111110101100100101101000101001000011110011100101011011011110111000111010010000101111001001101100110001011001010101001111100001001101111110010110000101101011000110110101011001101011011100011101100101111011001111111101001010</textPath></text>',
            '<circle cx="540" cy="584" r="338" fill="none" stroke="#223029" stroke-width="1" stroke-dasharray="3 9"/>',
            '<circle cx="828.2" cy="407.4" r="7" fill="#d9a94b"/>',
            '<circle cx="763" cy="785" r="2" fill="#d9a94b" opacity="0.5" filter="url(#glow)"/>',
            '<circle cx="626" cy="722" r="1.8" fill="#d9a94b" opacity="0.4" filter="url(#glow)"/>',
            '<circle cx="590" cy="530" r="2.3" fill="#d9a94b" opacity="0.5" filter="url(#glow)"/>',
            '<circle cx="601" cy="620" r="2.1" fill="#d9a94b" opacity="0.7" filter="url(#glow)"/>'
        );
        want = string.concat(
            want,
            '<circle cx="758" cy="633" r="2" fill="#d9a94b" opacity="0.7" filter="url(#glow)"/>',
            '<circle cx="565" cy="484" r="2.2" fill="#d9a94b" opacity="0.5" filter="url(#glow)"/>',
            '<circle cx="594" cy="765" r="1.6" fill="#d9a94b" opacity="0.5" filter="url(#glow)"/>',
            '<circle cx="597" cy="246" r="2.6" fill="#d9a94b" opacity="0.6" filter="url(#glow)"/>',
            '<circle cx="580" cy="284" r="1.7" fill="#d9a94b" opacity="0.8" filter="url(#glow)"/>',
            '<circle cx="921" cy="738" r="2" fill="#d9a94b" opacity="0.6" filter="url(#glow)"/>',
            '<circle cx="593" cy="613" r="2.1" fill="#d9a94b" opacity="0.7" filter="url(#glow)"/>'
        );
        want = string.concat(
            want,
            '<circle cx="802" cy="585" r="2" fill="#d9a94b" opacity="0.4" filter="url(#glow)"/>',
            '<circle cx="979" cy="559" r="1.7" fill="#d9a94b" opacity="0.5" filter="url(#glow)"/>',
            '<circle cx="731" cy="784" r="1.7" fill="#d9a94b" opacity="0.8" filter="url(#glow)"/>',
            '<circle cx="692" cy="316" r="2.3" fill="#d9a94b" opacity="0.8" filter="url(#glow)"/>',
            '<circle cx="484" cy="535" r="1.8" fill="#d9a94b" opacity="0.6" filter="url(#glow)"/>',
            '<circle cx="197" cy="384" r="1.8" fill="#d9a94b" opacity="0.6" filter="url(#glow)"/>',
            '<circle cx="854" cy="773" r="2.3" fill="#d9a94b" opacity="0.6" filter="url(#glow)"/>'
        );
        want = string.concat(
            want,
            '<circle cx="440" cy="613" r="1.8" fill="#d9a94b" opacity="0.5" filter="url(#glow)"/>',
            '<circle cx="380" cy="835" r="2.5" fill="#d9a94b" opacity="0.7" filter="url(#glow)"/>',
            '<circle cx="816" cy="626" r="2.7" fill="#d9a94b" opacity="0.6" filter="url(#glow)"/>',
            '<circle cx="944" cy="347" r="2.4" fill="#d9a94b" opacity="0.5" filter="url(#glow)"/>',
            '<circle cx="368" cy="777" r="2.3" fill="#d9a94b" opacity="0.5" filter="url(#glow)"/>',
            '<circle cx="795" cy="819" r="1.9" fill="#d9a94b" opacity="0.5" filter="url(#glow)"/>',
            '<circle cx="512" cy="425" r="1.7" fill="#d9a94b" opacity="0.6" filter="url(#glow)"/>'
        );
        want = string.concat(
            want,
            '<circle cx="886" cy="707" r="2.5" fill="#d9a94b" opacity="0.6" filter="url(#glow)"/>\n',
            '<g transform="translate(540 596) rotate(3.4) scale(2)" font-family="Consolas, \'Courier New\', monospace">\n',
            "<defs>",
            '<path id="up" d="M4 -22C73.6 -133.1 158.8 -127.5 158.8 -55.3C155.7 -4 89.1 16 4 10Z"/>',
            '<path id="lo" d="M4 10C87.8 6 106.4 69.3 50.5 108.8C27.3 100.9 10 59.4 4 30Z"/>',
            '<path id="up2" transform="translate(4 -6) scale(0.82)" d="M4 -22C73.6 -133.1 158.8 -127.5 158.8 -55.3C155.7 -4 89.1 16 4 10Z"/>\n',
            '<clipPath id="cu">'
        );
        want = string.concat(
            want,
            '<path d="M4 -22C73.6 -133.1 158.8 -127.5 158.8 -55.3C155.7 -4 89.1 16 4 10Z"/></clipPath>',
            '<clipPath id="cl">',
            '<path d="M4 10C87.8 6 106.4 69.3 50.5 108.8C27.3 100.9 10 59.4 4 30Z"/></clipPath>',
            '<path id="body" d="M0 -36V40"/></defs>\n',
            "<g>",
            '<text font-size="9" fill="#3ec28f" letter-spacing="0.6"><textPath href="#up">101010000110101110010110001110110010110010011111000100011011000001001111110000001100100001110111101010000010100000000100</textPath></text>',
            '<text font-size="8.5" fill="#3ec28f" letter-spacing="0.6"><textPath href="#lo">0101011000100110110110011011111001110010011000111110110001111001111110100000100101010100111010101100</textPath></text>'
        );
        want = string.concat(
            want,
            '<text font-size="5.6" fill="#d9a94b" opacity="0.35" letter-spacing="0.5"><textPath href="#up2">01000111011001111101101010100111110101111110101001000010101111100101011101110010100111100101000100101111111110100000010110100011100100011101</textPath></text>',
            '<path d="M6 -8L72.9 -133.7" stroke="#3ec28f" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cu)"/>',
            '<path d="M6 -8L117.1 -97" stroke="#3ec28f" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cu)"/>',
            '<path d="M6 -8L143.3 -45.6" stroke="#3ec28f" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cu)"/>',
            '<path d="M6 -8L147 11.8" stroke="#3ec28f" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cu)"/>',
            '<path d="M6 16L88.4 49.3" stroke="#3ec28f" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cl)"/>',
            '<path d="M6 16L65.5 82.1" stroke="#3ec28f" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cl)"/>'
        );
        want = string.concat(
            want,
            '<path d="M6 16L30.5 101.5" stroke="#3ec28f" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cl)"/>',
            '<circle cx="127.8" cy="-90.9" r="5" fill="#e9e6da"/>',
            '<circle cx="117" cy="-73.9" r="4.4" fill="#e9e6da"/></g>',
            '<g transform="scale(-1 1)">',
            "<g>",
            '<text font-size="9" fill="#3ec28f" letter-spacing="0.6"><textPath href="#up">101010000110101110010110001110110010110010011111000100011011000001001111110000001100100001110111101010000010100000000100</textPath></text>',
            '<text font-size="8.5" fill="#3ec28f" letter-spacing="0.6"><textPath href="#lo">0101011000100110110110011011111001110010011000111110110001111001111110100000100101010100111010101100</textPath></text>'
        );
        want = string.concat(
            want,
            '<text font-size="5.6" fill="#d9a94b" opacity="0.35" letter-spacing="0.5"><textPath href="#up2">01000111011001111101101010100111110101111110101001000010101111100101011101110010100111100101000100101111111110100000010110100011100100011101</textPath></text>',
            '<path d="M6 -8L72.9 -133.7" stroke="#3ec28f" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cu)"/>',
            '<path d="M6 -8L117.1 -97" stroke="#3ec28f" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cu)"/>',
            '<path d="M6 -8L143.3 -45.6" stroke="#3ec28f" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cu)"/>',
            '<path d="M6 -8L147 11.8" stroke="#3ec28f" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cu)"/>',
            '<path d="M6 16L88.4 49.3" stroke="#3ec28f" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cl)"/>',
            '<path d="M6 16L65.5 82.1" stroke="#3ec28f" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cl)"/>'
        );
        want = string.concat(
            want,
            '<path d="M6 16L30.5 101.5" stroke="#3ec28f" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cl)"/>',
            '<circle cx="127.8" cy="-90.9" r="5" fill="#e9e6da"/>',
            '<circle cx="117" cy="-73.9" r="4.4" fill="#e9e6da"/></g></g>\n',
            '<path d="M-2 -52C-8 -76 -22 -90 -32 -93M2 -52C8 -76 22 -90 32 -93" stroke="#d9a94b" stroke-width="1.4" fill="none" stroke-linecap="round"/>\n',
            '<circle cx="-32" cy="-93" r="2.2" fill="#d9a94b"/>',
            '<circle cx="32" cy="-93" r="2.2" fill="#d9a94b"/>\n',
            '<circle cx="0" cy="-48" r="6.5" fill="#d9a94b"/>'
        );
        want = string.concat(
            want,
            '<ellipse cx="0" cy="2" rx="5.5" ry="44" fill="#d9a94b"/>\n',
            '<text font-size="5.5" fill="#0b1410" letter-spacing="0.3" writing-mode="tb"><textPath href="#body">01010100100110</textPath></text>\n</g>\n',
            unicode'<text x="92" y="122" font-family="Consolas, \'Courier New\', monospace" font-size="24" letter-spacing="3" fill="#9aa89f">METAMORPH.MD · PUPATE</text>\n',
            '<text x="92" y="204" font-family="Georgia, \'Times New Roman\', serif" font-size="76" fill="#e9e6da">#777</text>\n',
            unicode'<text x="988" y="122" font-family="Consolas, \'Courier New\', monospace" font-size="24" letter-spacing="3" text-anchor="end" fill="#d9a94b">EMERGED · GILT</text>',
            unicode'<text x="92" y="984" font-family="Consolas, \'Courier New\', monospace" font-size="24" letter-spacing="2" fill="#9aa89f">seat identity.md #2345 · edition 5 of 303</text>\n</svg>'
        );
    }

    /// `node script/art/mirror.mjs uri 1376 0 1 0 0 1 50000000000000000000000
    /// 0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf 1`, the image left out.
    function _json1376Chrysalis(string memory image) internal pure returns (string memory) {
        return string.concat(
            '{"name":"Metamorph.md #1",',
            '"description":"Seat identity.md #1376, edition 1 of 303, in the cocoon.",',
            '"image":"data:image/svg+xml;base64,',
            image,
            '","attributes":[',
            string.concat(
                '{"trait_type":"Seat","value":"1376"},',
                '{"trait_type":"Round","value":0},',
                '{"trait_type":"Edition","value":1},',
                '{"trait_type":"Stage","value":"Chrysalis"},',
                '{"trait_type":"Gilt","value":"No"},',
                '{"trait_type":"Epoch","value":1},',
                '{"trait_type":"Miner","value":"0x7e5f4552091a69125d5dfcb7b8c2659029395bdf"},'
            ),
            string.concat(
                '{"trait_type":"Price paid (PUPATE)","value":50000},',
                '{"trait_type":"Tier","value":"Holotype"},',
                '{"trait_type":"Form","value":"Spindle"},',
                '{"trait_type":"Palette","value":"Classic"},',
                '{"trait_type":"Halo","value":"None"},',
                '{"trait_type":"Signal","value":"Column"},',
                '{"trait_type":"Density","value":"Bold"},'
            ),
            '{"trait_type":"Tone","value":"#5fd0a3"}',
            "]}"
        );
    }

    /// `node script/art/mirror.mjs uri 2345 0 5 1 1 777 61234567800000000000000
    /// 0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf 3`, the image left out.
    function _json2345Butterfly(string memory image) internal pure returns (string memory) {
        return string.concat(
            '{"name":"Metamorph.md #777",',
            '"description":"Seat identity.md #2345, edition 5 of 303, emerged, a gilt proof.",',
            '"image":"data:image/svg+xml;base64,',
            image,
            '","attributes":[',
            string.concat(
                '{"trait_type":"Seat","value":"2345"},',
                '{"trait_type":"Round","value":0},',
                '{"trait_type":"Edition","value":5},',
                '{"trait_type":"Stage","value":"Butterfly"},',
                '{"trait_type":"Gilt","value":"Yes"},',
                '{"trait_type":"Epoch","value":3},',
                '{"trait_type":"Miner","value":"0x7e5f4552091a69125d5dfcb7b8c2659029395bdf"},'
            ),
            string.concat(
                '{"trait_type":"Price paid (PUPATE)","value":61234},',
                '{"trait_type":"Tier","value":"Paratype"},',
                '{"trait_type":"Form","value":"Teardrop"},',
                '{"trait_type":"Palette","value":"Gilt"},',
                '{"trait_type":"Halo","value":"Orbit"},',
                '{"trait_type":"Signal","value":"Rain"},',
                '{"trait_type":"Density","value":"Standard"},'
            ),
            '{"trait_type":"Tone","value":"#3ec28f"}',
            "]}"
        );
    }
}
