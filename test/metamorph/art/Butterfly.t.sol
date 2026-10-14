// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {Colours, SeatTraits, Traits} from "../../../src/interfaces/IMetamorphFigure.sol";
import {ArtTraits} from "../../../src/metamorph/art/ArtTraits.sol";
import {MetamorphButterfly} from "../../../src/metamorph/art/MetamorphButterfly.sol";
import {ArtTraitsHarness} from "./ArtTraits.t.sol";

/// @dev The table of sines and the interpolated sine the figure reads from the trait library, and its vein
/// angles.
contract ButterflyHarness is MetamorphButterfly {
    function sines() external pure returns (uint16[91] memory) {
        return ArtTraits.sines();
    }

    function sinT(uint256 t) external pure returns (uint256) {
        return ArtTraits.sinT(ArtTraits.sines(), t);
    }

    function angle(uint256 i, uint256 n) external pure returns (int256) {
        return _angle(i, n);
    }
}

/// @dev The expected figures are pasted from `node script/art/mirror.mjs figure butterfly <seat> <round>
/// <edition> <gilt>`, cut before each element; the sines from `node script/art/mirror.mjs sines`; the angles and
/// the interpolated sines from the mirror's `veinAngle` and `sinT`. The mirror is written first, and when it and
/// the contract disagree, the side that deviates from the spec's rule is fixed, never the string.
contract ButterflyTest is Test {
    ArtTraitsHarness internal h;
    MetamorphButterfly internal butterfly;
    ButterflyHarness internal inside;

    function setUp() public {
        h = new ArtTraitsHarness();
        butterfly = new MetamorphButterfly();
        inside = new ButterflyHarness();
    }

    /// (1376, 0, 1), plain: bold, classic, the seat's jade #5fd0a3, tilt -3, scale 2.4; five veins less one (four,
    /// at -62, -38.7, -15.3 and 8 degrees), no spot plus one (4172 bytes).
    function test_plainClassicCardMatchesTheMirror() public view {
        string memory want = string.concat(
            '<g transform="translate(540 596) rotate(-3) scale(2.4)" font-family="Consolas, \'Courier New\', monospace">\n<defs>',
            '<path id="up" d="M4 -22C57.4 -124.4 122.7 -119.3 122.7 -52.7C120.4 -4 69.3 16 4 10Z"/>',
            '<path id="lo" d="M4 10C90.6 6 109.9 75.8 52.1 119.6C28.1 110.9 10 64.8 4 30Z"/>',
            '<path id="up2" transform="translate(4 -6) scale(0.82)" d="M4 -22C57.4 -124.4 122.7 -119.3 122.7 -52.7C120.4 -4 69.3 16 4 10Z"/>\n<clipPath id="cu">',
            '<path d="M4 -22C57.4 -124.4 122.7 -119.3 122.7 -52.7C120.4 -4 69.3 16 4 10Z"/></clipPath><clipPath id="cl">',
            '<path d="M4 10C90.6 6 109.9 75.8 52.1 119.6C28.1 110.9 10 64.8 4 30Z"/></clipPath>',
            '<path id="body" d="M0 -36V40"/></defs>\n<g>'
        );
        want = string.concat(
            want,
            '<text font-size="10.9" fill="#5fd0a3" letter-spacing="0.6"><textPath href="#up">101010011011011101101100101001000101111100001011110000000101010110001011010111100110101001001010001010001011011001110001</textPath></text>',
            '<text font-size="10.4" fill="#5fd0a3" letter-spacing="0.6"><textPath href="#lo">1110001100110110100110111100010010000011100110011010001000110100000101001000100111110101001101100011</textPath></text>',
            '<text font-size="6.7" fill="#e9e6da" opacity="0.35" letter-spacing="0.5"><textPath href="#up2">00111011010101111101111101000001000011111010111010101101110101011010010010010110100100001010010000100000111110101101111011110110001011010011</textPath></text>',
            '<path d="M6 -8L57.3 -104.4" stroke="#5fd0a3" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cu)"/>',
            '<path d="M6 -8L91.2 -76.3" stroke="#5fd0a3" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cu)"/>',
            '<path d="M6 -8L111.4 -36.8" stroke="#5fd0a3" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cu)"/>',
            '<path d="M6 -8L114.2 7.2" stroke="#5fd0a3" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cu)"/>'
        );
        want = string.concat(
            want,
            '<path d="M6 16L97.5 53" stroke="#5fd0a3" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cl)"/>',
            '<path d="M6 16L72 89.3" stroke="#5fd0a3" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cl)"/>',
            '<path d="M6 16L33.2 110.8" stroke="#5fd0a3" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cl)"/>',
            '<circle cx="99" cy="-85.5" r="5" fill="#d9a94b"/></g><g transform="scale(-1 1)"><g>',
            '<text font-size="10.9" fill="#5fd0a3" letter-spacing="0.6"><textPath href="#up">101010011011011101101100101001000101111100001011110000000101010110001011010111100110101001001010001010001011011001110001</textPath></text>',
            '<text font-size="10.4" fill="#5fd0a3" letter-spacing="0.6"><textPath href="#lo">1110001100110110100110111100010010000011100110011010001000110100000101001000100111110101001101100011</textPath></text>',
            '<text font-size="6.7" fill="#e9e6da" opacity="0.35" letter-spacing="0.5"><textPath href="#up2">00111011010101111101111101000001000011111010111010101101110101011010010010010110100100001010010000100000111110101101111011110110001011010011</textPath></text>'
        );
        want = string.concat(
            want,
            '<path d="M6 -8L57.3 -104.4" stroke="#5fd0a3" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cu)"/>',
            '<path d="M6 -8L91.2 -76.3" stroke="#5fd0a3" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cu)"/>',
            '<path d="M6 -8L111.4 -36.8" stroke="#5fd0a3" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cu)"/>',
            '<path d="M6 -8L114.2 7.2" stroke="#5fd0a3" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cu)"/>',
            '<path d="M6 16L97.5 53" stroke="#5fd0a3" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cl)"/>',
            '<path d="M6 16L72 89.3" stroke="#5fd0a3" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cl)"/>',
            '<path d="M6 16L33.2 110.8" stroke="#5fd0a3" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cl)"/>'
        );
        want = string.concat(
            want,
            '<circle cx="99" cy="-85.5" r="5" fill="#d9a94b"/></g></g>\n',
            '<path d="M-2 -52C-8 -76 -22 -90 -32 -93M2 -52C8 -76 22 -90 32 -93" stroke="#e9e6da" stroke-width="1.4" fill="none" stroke-linecap="round"/>\n',
            '<circle cx="-32" cy="-93" r="2.2" fill="#e9e6da"/>',
            '<circle cx="32" cy="-93" r="2.2" fill="#e9e6da"/>\n',
            '<circle cx="0" cy="-48" r="6.5" fill="#e9e6da"/>',
            '<ellipse cx="0" cy="2" rx="5.5" ry="44" fill="#e9e6da"/>\n',
            '<text font-size="5.5" fill="#0b1410" letter-spacing="0.3" writing-mode="tb"><textPath href="#body">11110000101001</textPath></text>\n</g>'
        );
        assertEq(_figure(1376, 0, 1, false), want);
    }

    /// (2345, 0, 5), gilt: standard, the gilt colours with the jade #3ec28f, tilt 3.4, scale 2; three veins plus
    /// one (four), two spots (4277 bytes).
    function test_giltCardMatchesTheMirror() public view {
        string memory want = string.concat(
            '<g transform="translate(540 596) rotate(3.4) scale(2)" font-family="Consolas, \'Courier New\', monospace">\n<defs>',
            '<path id="up" d="M4 -22C73.6 -133.1 158.8 -127.5 158.8 -55.3C155.7 -4 89.1 16 4 10Z"/>',
            '<path id="lo" d="M4 10C87.8 6 106.4 69.3 50.5 108.8C27.3 100.9 10 59.4 4 30Z"/>',
            '<path id="up2" transform="translate(4 -6) scale(0.82)" d="M4 -22C73.6 -133.1 158.8 -127.5 158.8 -55.3C155.7 -4 89.1 16 4 10Z"/>\n<clipPath id="cu">',
            '<path d="M4 -22C73.6 -133.1 158.8 -127.5 158.8 -55.3C155.7 -4 89.1 16 4 10Z"/></clipPath><clipPath id="cl">',
            '<path d="M4 10C87.8 6 106.4 69.3 50.5 108.8C27.3 100.9 10 59.4 4 30Z"/></clipPath>',
            '<path id="body" d="M0 -36V40"/></defs>\n<g>'
        );
        want = string.concat(
            want,
            '<text font-size="9" fill="#3ec28f" letter-spacing="0.6"><textPath href="#up">101010000110101110010110001110110010110010011111000100011011000001001111110000001100100001110111101010000010100000000100</textPath></text>',
            '<text font-size="8.5" fill="#3ec28f" letter-spacing="0.6"><textPath href="#lo">0101011000100110110110011011111001110010011000111110110001111001111110100000100101010100111010101100</textPath></text>',
            '<text font-size="5.6" fill="#d9a94b" opacity="0.35" letter-spacing="0.5"><textPath href="#up2">01000111011001111101101010100111110101111110101001000010101111100101011101110010100111100101000100101111111110100000010110100011100100011101</textPath></text>',
            '<path d="M6 -8L72.9 -133.7" stroke="#3ec28f" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cu)"/>',
            '<path d="M6 -8L117.1 -97" stroke="#3ec28f" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cu)"/>',
            '<path d="M6 -8L143.3 -45.6" stroke="#3ec28f" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cu)"/>',
            '<path d="M6 -8L147 11.8" stroke="#3ec28f" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cu)"/>'
        );
        want = string.concat(
            want,
            '<path d="M6 16L88.4 49.3" stroke="#3ec28f" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cl)"/>',
            '<path d="M6 16L65.5 82.1" stroke="#3ec28f" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cl)"/>',
            '<path d="M6 16L30.5 101.5" stroke="#3ec28f" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cl)"/>',
            '<circle cx="127.8" cy="-90.9" r="5" fill="#e9e6da"/>',
            '<circle cx="117" cy="-73.9" r="4.4" fill="#e9e6da"/></g><g transform="scale(-1 1)"><g>',
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
            '<text font-size="5.5" fill="#0b1410" letter-spacing="0.3" writing-mode="tb"><textPath href="#body">01010100100110</textPath></text>\n</g>'
        );
        assertEq(_figure(2345, 0, 5, true), want);
    }

    /// (2345, 0, 8), plain: three veins less one, two, the clamp's floor (at -62 and 8 degrees); fine,
    /// inverted, one spot (3713 bytes).
    function test_twoVeinsMatchTheMirror() public view {
        string memory want = string.concat(
            '<g transform="translate(540 596) rotate(4.1) scale(2.2)" font-family="Consolas, \'Courier New\', monospace">\n<defs>',
            '<path id="up" d="M4 -22C66 -140.5 141.9 -134.5 141.9 -57.5C139.1 -4 79.8 16 4 10Z"/>',
            '<path id="lo" d="M4 10C83.9 6 101.7 59.1 48.4 91.9C26.2 85.3 10 50.9 4 30Z"/>',
            '<path id="up2" transform="translate(4 -6) scale(0.82)" d="M4 -22C66 -140.5 141.9 -134.5 141.9 -57.5C139.1 -4 79.8 16 4 10Z"/>\n<clipPath id="cu">',
            '<path d="M4 -22C66 -140.5 141.9 -134.5 141.9 -57.5C139.1 -4 79.8 16 4 10Z"/></clipPath><clipPath id="cl">',
            '<path d="M4 10C83.9 6 101.7 59.1 48.4 91.9C26.2 85.3 10 50.9 4 30Z"/></clipPath>',
            '<path id="body" d="M0 -36V40"/></defs>\n<g>'
        );
        want = string.concat(
            want,
            '<text font-size="7.4" fill="#e9e6da" letter-spacing="0.6"><textPath href="#up">101010010101101000100110100110100011010110100100110101111011111100100111000010010010011110001110100010111101011010101010</textPath></text>',
            '<text font-size="7" fill="#e9e6da" letter-spacing="0.6"><textPath href="#lo">0000000100111000000001011000101010001010110111011101100100010011100111101101111111100110010100001110</textPath></text>',
            '<text font-size="4.4" fill="#3ec28f" opacity="0.35" letter-spacing="0.5"><textPath href="#up2">01000000001000111100111101001101001111000001110000110101101100010101101101000010011111101001100000010001001101011011001101000110010000000000</textPath></text>',
            '<path d="M6 -8L65.6 -120" stroke="#e9e6da" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cu)"/>',
            '<path d="M6 -8L131.6 9.7" stroke="#e9e6da" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cu)"/>',
            '<path d="M6 16L74.3 43.6" stroke="#e9e6da" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cl)"/>',
            '<path d="M6 16L55.3 70.8" stroke="#e9e6da" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cl)"/>'
        );
        want = string.concat(
            want,
            '<path d="M6 16L26.3 86.8" stroke="#e9e6da" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cl)"/>',
            '<circle cx="114.3" cy="-95.4" r="5" fill="#d9a94b"/></g><g transform="scale(-1 1)"><g>',
            '<text font-size="7.4" fill="#e9e6da" letter-spacing="0.6"><textPath href="#up">101010010101101000100110100110100011010110100100110101111011111100100111000010010010011110001110100010111101011010101010</textPath></text>',
            '<text font-size="7" fill="#e9e6da" letter-spacing="0.6"><textPath href="#lo">0000000100111000000001011000101010001010110111011101100100010011100111101101111111100110010100001110</textPath></text>',
            '<text font-size="4.4" fill="#3ec28f" opacity="0.35" letter-spacing="0.5"><textPath href="#up2">01000000001000111100111101001101001111000001110000110101101100010101101101000010011111101001100000010001001101011011001101000110010000000000</textPath></text>',
            '<path d="M6 -8L65.6 -120" stroke="#e9e6da" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cu)"/>',
            '<path d="M6 -8L131.6 9.7" stroke="#e9e6da" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cu)"/>'
        );
        want = string.concat(
            want,
            '<path d="M6 16L74.3 43.6" stroke="#e9e6da" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cl)"/>',
            '<path d="M6 16L55.3 70.8" stroke="#e9e6da" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cl)"/>',
            '<path d="M6 16L26.3 86.8" stroke="#e9e6da" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cl)"/>',
            '<circle cx="114.3" cy="-95.4" r="5" fill="#d9a94b"/></g></g>\n',
            '<path d="M-2 -52C-8 -76 -22 -90 -32 -93M2 -52C8 -76 22 -90 32 -93" stroke="#e9e6da" stroke-width="1.4" fill="none" stroke-linecap="round"/>\n',
            '<circle cx="-32" cy="-93" r="2.2" fill="#e9e6da"/>',
            '<circle cx="32" cy="-93" r="2.2" fill="#e9e6da"/>\n'
        );
        want = string.concat(
            want,
            '<circle cx="0" cy="-48" r="6.5" fill="#e9e6da"/>',
            '<ellipse cx="0" cy="2" rx="5.5" ry="44" fill="#e9e6da"/>\n',
            '<text font-size="5.5" fill="#0b1410" letter-spacing="0.3" writing-mode="tb"><textPath href="#body">01101101010111</textPath></text>\n</g>'
        );
        assertEq(_figure(2345, 0, 8, false), want);
    }

    /// (1376, 0, 4), plain: five veins plus one, six, the clamp's ceiling (-62, -48, -34, -20, -6, 8); no spot
    /// less one, clamped at zero; fine, ember (4524 bytes).
    function test_sixVeinsMatchTheMirror() public view {
        string memory want = string.concat(
            '<g transform="translate(540 596) rotate(-0.2) scale(2.4)" font-family="Consolas, \'Courier New\', monospace">\n<defs>',
            '<path id="up" d="M4 -22C67.6 -121.3 145.4 -116.3 145.4 -51.8C142.6 -4 81.8 16 4 10Z"/>',
            '<path id="lo" d="M4 10C94.4 6 114.4 72 54.2 113.4C29.1 105.1 10 61.7 4 30Z"/>',
            '<path id="up2" transform="translate(4 -6) scale(0.82)" d="M4 -22C67.6 -121.3 145.4 -116.3 145.4 -51.8C142.6 -4 81.8 16 4 10Z"/>\n<clipPath id="cu">',
            '<path d="M4 -22C67.6 -121.3 145.4 -116.3 145.4 -51.8C142.6 -4 81.8 16 4 10Z"/></clipPath><clipPath id="cl">',
            '<path d="M4 10C94.4 6 114.4 72 54.2 113.4C29.1 105.1 10 61.7 4 30Z"/></clipPath>',
            '<path id="body" d="M0 -36V40"/></defs>\n<g>'
        );
        want = string.concat(
            want,
            '<text font-size="7.4" fill="#d9a94b" letter-spacing="0.6"><textPath href="#up">000100001010000111000101101001100000001001101101111110001100000001110011010100110001011110010111000101101011001000001001</textPath></text>',
            '<text font-size="7" fill="#d9a94b" letter-spacing="0.6"><textPath href="#lo">1011001001101000001011000101000110011000001111010110111011110110110110111011100100011011011010011001</textPath></text>',
            '<text font-size="4.4" fill="#e9e6da" opacity="0.35" letter-spacing="0.5"><textPath href="#up2">10011011011000110111111111010010111110000000000111110101101001000000110101111010010000111011101110100111000100110100001001000011101001100011</textPath></text>',
            '<path d="M6 -8L67.1 -122.9" stroke="#d9a94b" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cu)"/>',
            '<path d="M6 -8L93 -104.7" stroke="#d9a94b" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cu)"/>',
            '<path d="M6 -8L113.8 -80.7" stroke="#d9a94b" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cu)"/>',
            '<path d="M6 -8L128.2 -52.5" stroke="#d9a94b" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cu)"/>'
        );
        want = string.concat(
            want,
            '<path d="M6 -8L135.4 -21.6" stroke="#d9a94b" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cu)"/>',
            '<path d="M6 -8L134.8 10.1" stroke="#d9a94b" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cu)"/>',
            '<path d="M6 16L92.2 50.8" stroke="#d9a94b" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cl)"/>',
            '<path d="M6 16L68.2 85.1" stroke="#d9a94b" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cl)"/>',
            '<path d="M6 16L31.6 105.4" stroke="#d9a94b" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cl)"/></g><g transform="scale(-1 1)"><g>',
            '<text font-size="7.4" fill="#d9a94b" letter-spacing="0.6"><textPath href="#up">000100001010000111000101101001100000001001101101111110001100000001110011010100110001011110010111000101101011001000001001</textPath></text>',
            '<text font-size="7" fill="#d9a94b" letter-spacing="0.6"><textPath href="#lo">1011001001101000001011000101000110011000001111010110111011110110110110111011100100011011011010011001</textPath></text>'
        );
        want = string.concat(
            want,
            '<text font-size="4.4" fill="#e9e6da" opacity="0.35" letter-spacing="0.5"><textPath href="#up2">10011011011000110111111111010010111110000000000111110101101001000000110101111010010000111011101110100111000100110100001001000011101001100011</textPath></text>',
            '<path d="M6 -8L67.1 -122.9" stroke="#d9a94b" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cu)"/>',
            '<path d="M6 -8L93 -104.7" stroke="#d9a94b" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cu)"/>',
            '<path d="M6 -8L113.8 -80.7" stroke="#d9a94b" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cu)"/>',
            '<path d="M6 -8L128.2 -52.5" stroke="#d9a94b" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cu)"/>',
            '<path d="M6 -8L135.4 -21.6" stroke="#d9a94b" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cu)"/>',
            '<path d="M6 -8L134.8 10.1" stroke="#d9a94b" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cu)"/>'
        );
        want = string.concat(
            want,
            '<path d="M6 16L92.2 50.8" stroke="#d9a94b" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cl)"/>',
            '<path d="M6 16L68.2 85.1" stroke="#d9a94b" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cl)"/>',
            '<path d="M6 16L31.6 105.4" stroke="#d9a94b" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cl)"/></g></g>\n',
            '<path d="M-2 -52C-8 -76 -22 -90 -32 -93M2 -52C8 -76 22 -90 32 -93" stroke="#e9e6da" stroke-width="1.4" fill="none" stroke-linecap="round"/>\n',
            '<circle cx="-32" cy="-93" r="2.2" fill="#e9e6da"/>',
            '<circle cx="32" cy="-93" r="2.2" fill="#e9e6da"/>\n',
            '<circle cx="0" cy="-48" r="6.5" fill="#e9e6da"/>'
        );
        want = string.concat(
            want,
            '<ellipse cx="0" cy="2" rx="5.5" ry="44" fill="#e9e6da"/>\n',
            '<text font-size="5.5" fill="#0b1410" letter-spacing="0.3" writing-mode="tb"><textPath href="#body">00110101100001</textPath></text>\n</g>'
        );
        assertEq(_figure(1376, 0, 4, false), want);
    }

    /// (42, 0, 10), plain: three spots plus one, four, the clamp's ceiling; five veins, at -62, -44.5, -27, -9.5
    /// and 8 degrees (the half degrees interpolated); fine, classic (4695 bytes).
    function test_fourSpotsMatchTheMirror() public view {
        string memory want = string.concat(
            '<g transform="translate(540 596) rotate(5.9) scale(2.1)" font-family="Consolas, \'Courier New\', monospace">\n<defs>',
            '<path id="up" d="M4 -22C57.8 -124 123.6 -118.9 123.6 -52.6C121.2 -4 69.8 16 4 10Z"/>',
            '<path id="lo" d="M4 10C86.2 6 104.4 65.5 49.7 102.6C26.8 95.2 10 56.3 4 30Z"/>',
            '<path id="up2" transform="translate(4 -6) scale(0.82)" d="M4 -22C57.8 -124 123.6 -118.9 123.6 -52.6C121.2 -4 69.8 16 4 10Z"/>\n<clipPath id="cu">',
            '<path d="M4 -22C57.8 -124 123.6 -118.9 123.6 -52.6C121.2 -4 69.8 16 4 10Z"/></clipPath><clipPath id="cl">',
            '<path d="M4 10C86.2 6 104.4 65.5 49.7 102.6C26.8 95.2 10 56.3 4 30Z"/></clipPath>',
            '<path id="body" d="M0 -36V40"/></defs>\n<g>'
        );
        want = string.concat(
            want,
            '<text font-size="7.4" fill="#37b59a" letter-spacing="0.6"><textPath href="#up">010111000001000101001000011110100111000010010110100010111111110100111001110001010100010110011110001111101110000100101010</textPath></text>',
            '<text font-size="7" fill="#37b59a" letter-spacing="0.6"><textPath href="#lo">1111001001110110101010110001010110010111010010100001011100010101110001110101100111010001000010110010</textPath></text>',
            '<text font-size="4.4" fill="#e9e6da" opacity="0.35" letter-spacing="0.5"><textPath href="#up2">11000111111000000000110110110100000001101101100000101001111110000101111110101011001111111100010001011010110000110011001011101110010110010100</textPath></text>',
            '<path d="M6 -8L57.7 -105.1" stroke="#37b59a" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cu)"/>',
            '<path d="M6 -8L84.5 -85.1" stroke="#37b59a" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cu)"/>',
            '<path d="M6 -8L104 -58" stroke="#37b59a" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cu)"/>',
            '<path d="M6 -8L114.5 -26.2" stroke="#37b59a" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cu)"/>'
        );
        want = string.concat(
            want,
            '<path d="M6 -8L115 7.3" stroke="#37b59a" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cu)"/>',
            '<path d="M6 16L83.2 47.2" stroke="#37b59a" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cl)"/>',
            '<path d="M6 16L61.7 77.9" stroke="#37b59a" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cl)"/>',
            '<path d="M6 16L29 96.1" stroke="#37b59a" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cl)"/>',
            '<circle cx="99.7" cy="-85.2" r="5" fill="#d9a94b"/>',
            '<circle cx="91.3" cy="-68.2" r="4.4" fill="#d9a94b"/>',
            '<circle cx="82.9" cy="-51.2" r="3.8" fill="#d9a94b"/>'
        );
        want = string.concat(
            want,
            '<circle cx="74.6" cy="-34.2" r="3.2" fill="#d9a94b"/></g><g transform="scale(-1 1)"><g>',
            '<text font-size="7.4" fill="#37b59a" letter-spacing="0.6"><textPath href="#up">010111000001000101001000011110100111000010010110100010111111110100111001110001010100010110011110001111101110000100101010</textPath></text>',
            '<text font-size="7" fill="#37b59a" letter-spacing="0.6"><textPath href="#lo">1111001001110110101010110001010110010111010010100001011100010101110001110101100111010001000010110010</textPath></text>',
            '<text font-size="4.4" fill="#e9e6da" opacity="0.35" letter-spacing="0.5"><textPath href="#up2">11000111111000000000110110110100000001101101100000101001111110000101111110101011001111111100010001011010110000110011001011101110010110010100</textPath></text>',
            '<path d="M6 -8L57.7 -105.1" stroke="#37b59a" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cu)"/>',
            '<path d="M6 -8L84.5 -85.1" stroke="#37b59a" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cu)"/>',
            '<path d="M6 -8L104 -58" stroke="#37b59a" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cu)"/>'
        );
        want = string.concat(
            want,
            '<path d="M6 -8L114.5 -26.2" stroke="#37b59a" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cu)"/>',
            '<path d="M6 -8L115 7.3" stroke="#37b59a" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cu)"/>',
            '<path d="M6 16L83.2 47.2" stroke="#37b59a" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cl)"/>',
            '<path d="M6 16L61.7 77.9" stroke="#37b59a" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cl)"/>',
            '<path d="M6 16L29 96.1" stroke="#37b59a" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#cl)"/>',
            '<circle cx="99.7" cy="-85.2" r="5" fill="#d9a94b"/>',
            '<circle cx="91.3" cy="-68.2" r="4.4" fill="#d9a94b"/>'
        );
        want = string.concat(
            want,
            '<circle cx="82.9" cy="-51.2" r="3.8" fill="#d9a94b"/>',
            '<circle cx="74.6" cy="-34.2" r="3.2" fill="#d9a94b"/></g></g>\n',
            '<path d="M-2 -52C-8 -76 -22 -90 -32 -93M2 -52C8 -76 22 -90 32 -93" stroke="#e9e6da" stroke-width="1.4" fill="none" stroke-linecap="round"/>\n',
            '<circle cx="-32" cy="-93" r="2.2" fill="#e9e6da"/>',
            '<circle cx="32" cy="-93" r="2.2" fill="#e9e6da"/>\n',
            '<circle cx="0" cy="-48" r="6.5" fill="#e9e6da"/>',
            '<ellipse cx="0" cy="2" rx="5.5" ry="44" fill="#e9e6da"/>\n'
        );
        want = string.concat(
            want,
            '<text font-size="5.5" fill="#0b1410" letter-spacing="0.3" writing-mode="tb"><textPath href="#body">11011011001110</textPath></text>\n</g>'
        );
        assertEq(_figure(42, 0, 10, false), want);
    }

    /// The 91 sines, sin(0°)..sin(90°) in ten-thousandths, are the mirror's Math.round(Math.sin(d × π / 180) ×
    /// 10000), every one.
    function test_sineTableMatchesTheMirror() public view {
        // forgefmt: disable-start
        uint16[91] memory want = [
            uint16(0), 175, 349, 523, 698, 872, 1045, 1219, 1392, 1564, // 0..9
            1736, 1908, 2079, 2250, 2419, 2588, 2756, 2924, 3090, 3256, // 10..19
            3420, 3584, 3746, 3907, 4067, 4226, 4384, 4540, 4695, 4848, // 20..29
            5000, 5150, 5299, 5446, 5592, 5736, 5878, 6018, 6157, 6293, // 30..39
            6428, 6561, 6691, 6820, 6947, 7071, 7193, 7314, 7431, 7547, // 40..49
            7660, 7771, 7880, 7986, 8090, 8192, 8290, 8387, 8480, 8572, // 50..59
            8660, 8746, 8829, 8910, 8988, 9063, 9135, 9205, 9272, 9336, // 60..69
            9397, 9455, 9511, 9563, 9613, 9659, 9703, 9744, 9781, 9816, // 70..79
            9848, 9877, 9903, 9925, 9945, 9962, 9976, 9986, 9994, 9998, // 80..89
            10000 // 90
        ];
        // forgefmt: disable-end
        uint16[91] memory got = inside.sines();
        for (uint256 d; d < 91; d++) {
            assertEq(got[d], want[d]);
        }
    }

    /// The upper veins of every count the clamp allows, in tenths of a degree: -620 + 700 i / (n - 1), rounded
    /// half up once (four veins: -38.67 and -15.33 degrees are -387 and -153; five: -44.5 and -9.5 are exact).
    function test_veinAnglesMatchTheMirror() public view {
        _angles(2, [int256(-620), 80, 0, 0, 0, 0]);
        _angles(3, [int256(-620), -270, 80, 0, 0, 0]);
        _angles(4, [int256(-620), -387, -153, 80, 0, 0]);
        _angles(5, [int256(-620), -445, -270, -95, 80, 0]);
        _angles(6, [int256(-620), -480, -340, -200, -60, 80]);
    }

    /// The sine between two whole degrees, in hundred-thousandths: the two entries interpolated linearly and kept
    /// unrounded, at the table's ends, next to a whole degree, at the angles the veins use (38.7, 15.3, 44.5, 9.5
    /// degrees) and at their complements (the cosines); 90 degrees reads no entry past the table.
    function test_sineInterpolationMatchesTheMirror() public view {
        _sine(0, 0);
        _sine(1, 175);
        _sine(5, 875);
        _sine(9, 1575);
        _sine(95, 16500);
        _sine(153, 26384);
        _sine(270, 45400);
        _sine(280, 46950);
        _sine(387, 62522);
        _sine(445, 70090);
        _sine(455, 71320);
        _sine(513, 78037);
        _sine(620, 88290);
        _sine(747, 96452);
        _sine(805, 98625);
        _sine(899, 99998);
        _sine(900, 100000);
    }

    /// (42, 0, 10), five veins: the first upper ray, at -62 degrees, and the second, at -44.5 degrees (between two
    /// entries of the table), end where the mirror's do.
    function test_fiveVeinRaysEndWhereTheMirrorsDo() public view {
        string memory f = _figure(42, 0, 10, false);
        assertEq(_upperRay(f, 0), "M6 -8L57.7 -105.1");
        assertEq(_upperRay(f, 1), "M6 -8L84.5 -85.1");
    }

    /// Random cards draw: each fuzz run (256 by default, a sample of the cards and not all of them) draws the
    /// figure of a random seat, round, edition and proof without a revert, and the figure is one group.
    function testFuzz_randomCardsDraw(uint256 seat, uint16 round, uint16 edition, bool gilt) public view {
        bytes memory f = bytes(_figure(seat, round, edition, gilt));
        bytes memory head = bytes('<g transform="translate(540 596)');
        for (uint256 k; k < head.length; k++) {
            assertEq(f[k], head[k]);
        }
        bytes memory tail = bytes("</g>");
        for (uint256 k; k < tail.length; k++) {
            assertEq(f[f.length - tail.length + k], tail[k]);
        }
    }

    function _angles(uint256 n, int256[6] memory want) internal view {
        for (uint256 i; i < n; i++) {
            assertEq(inside.angle(i, n), want[i]);
        }
    }

    function _sine(uint256 t, uint256 want) internal view {
        assertEq(inside.sinT(t), want);
    }

    /// The d attribute of a figure's nth upper ray, counting from 0: from its "M6 -8L" to the closing quote.
    function _upperRay(string memory fig, uint256 nth) internal pure returns (string memory) {
        bytes memory f = bytes(fig);
        bytes memory key = bytes("M6 -8L");
        for (uint256 k; k + key.length <= f.length; k++) {
            uint256 j;
            while (j < key.length && f[k + j] == key[j]) {
                j++;
            }
            if (j < key.length) continue;
            if (nth > 0) {
                nth--;
                continue;
            }
            uint256 end = k;
            while (f[end] != '"') {
                end++;
            }
            bytes memory d = new bytes(end - k);
            for (j = 0; j < d.length; j++) {
                d[j] = f[k + j];
            }
            return string(d);
        }
        revert("no such ray");
    }

    /// The figure of a card as the router asks for it: the card traits, the seat traits, the colours (the
    /// palette or the gilt row, with the seat's jade) and the drawing seed, line 11.
    function _figure(uint256 seat, uint16 round, uint16 edition, bool gilt)
        internal
        view
        returns (string memory)
    {
        Traits memory t = h.cardTraits(seat, round, edition);
        SeatTraits memory st = h.seatTraits(seat);
        Colours memory c = h.colours(t.palette, gilt, st.tone);
        return butterfly.figure(t, st, c, h.seed(seat, round, edition, 11));
    }
}
