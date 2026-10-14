// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {Colours, SeatTraits, Traits} from "../../../src/interfaces/IMetamorphFigure.sol";
import {MetamorphChrysalis} from "../../../src/metamorph/art/MetamorphChrysalis.sol";
import {ArtTraitsHarness} from "./ArtTraits.t.sol";

/// @dev The expected figures are pasted from `node script/art/mirror.mjs figure chrysalis <seat> <round>
/// <edition> <gilt>`, cut before each element: the mirror is written first, and when it and the contract
/// disagree, the side that deviates from the spec's rule is fixed, never the string.
contract ChrysalisTest is Test {
    ArtTraitsHarness internal h;
    MetamorphChrysalis internal chrysalis;

    function setUp() public {
        h = new ArtTraitsHarness();
        chrysalis = new MetamorphChrysalis();
    }

    /// (1376, 0, 1), plain: a spindle, bold, classic, tilted -3 degrees, four segment rings (2836 bytes).
    function test_plainClassicCardMatchesTheMirror() public view {
        string memory want = string.concat(
            '<g transform="translate(540 584) rotate(-3) scale(7.1) translate(-32 -52)" font-family="Consolas, \'Courier New\', monospace" letter-spacing="0.25"><defs>',
            '<path id="shell" d="M32 11C23.3 23.1 16.7 43.3 16.7 58.5C18.9 73.6 25.5 87.8 32 93.8C38.5 87.8 45.1 73.6 47.3 58.5C47.3 43.3 40.7 23.1 32 11Z"/>',
            '<path id="shell2" d="M32 13.5C24.5 24.8 18.9 43.6 18.9 57.6C20.8 71.7 26.4 84.9 32 90.5C37.6 84.9 43.2 71.7 45.1 57.6C45.1 43.6 39.5 24.8 32 13.5Z"/>',
            '<path id="wing" d="M32 30C23.4 39.9 19.6 53.8 24.4 73.6C28.2 67.6 31 60.7 32 53.8C33 60.7 35.8 67.6 39.6 73.6C44.4 53.8 40.6 39.9 32 30Z"/>',
            '<path id="wing2" d="M32 34C25.8 42.1 23 53.5 26.5 69.7C29.2 64.8 31.3 59.2 32 53.5C32.7 59.2 34.8 64.8 37.5 69.7C41 53.5 38.2 42.1 32 34Z"/>',
            '<path id="band" d="M23.2 29C26.6 26.4 37.4 26.4 40.8 29"/>',
            '<path id="vein" d="M32 30v43.6"/></defs>'
        );
        want = string.concat(
            want,
            '<text font-size="2.8" fill="#e9e6da" ><textPath href="#shell">1111100011100100111010000001100001000001110101111110010101001010001111010100100001001001100101001010110111011000001101111101011111000110010111010101000110001110011110110101010001000000010001</textPath></text>',
            '<text font-size="1.8" fill="#e9e6da" opacity="0.45"><textPath href="#shell2">111110001011101111110011011111101011110100101000000100100011010010110111111001111110001110011000110101111000100111101011110111110111110010000100010100000000000011000001101101100001000000011111011111101001011100</textPath></text>',
            '<text font-size="2.5" fill="#5fd0a3" filter="url(#soft)"><textPath href="#wing">1100111111101011101101100110110100011110110110101010111100001011100110110011001101100101000111111010100011111100011100000100001010</textPath></text>',
            '<text font-size="1.7" fill="#5fd0a3" opacity="0.55"><textPath href="#wing2">01101111001001011111111001101110001001101111100010000110001101000110000011000001010001110101011011110111110011110011010101110000100100010001</textPath></text>',
            '<text font-size="1.9" fill="#5fd0a3" opacity="0.8"><textPath href="#vein">0010101011111001011101111000111010000110</textPath></text>',
            '<text font-size="2.7" fill="#d9a94b" ><textPath href="#band">011101101110111110011101010001</textPath></text>',
            '<path d="M16.7 64.5q15.3 4 30.5 0" stroke="#e9e6da" stroke-width="0.5" fill="none" opacity="0.45" stroke-dasharray="0.8 1.2"/>'
        );
        want = string.concat(
            want,
            '<path d="M20 71.6q12 4 24 0" stroke="#e9e6da" stroke-width="0.5" fill="none" opacity="0.45" stroke-dasharray="0.8 1.2"/>',
            '<path d="M23.3 78.7q8.7 4 17.4 0" stroke="#e9e6da" stroke-width="0.5" fill="none" opacity="0.45" stroke-dasharray="0.8 1.2"/>',
            '<path d="M26.5 85.7q5.5 4 10.9 0" stroke="#e9e6da" stroke-width="0.5" fill="none" opacity="0.45" stroke-dasharray="0.8 1.2"/>',
            '<path transform="translate(0 -0.4)" d="M24.9 73c1.9-3.6 4.6-6.6 7.1-9.4 2.6 2.8 5.2 5.8 7.1 9.4" stroke="#d9a94b" stroke-width="0.9" fill="none" stroke-linecap="round"/>',
            '<path d="M32 2v9" stroke="#e9e6da" stroke-width="0.8" fill="none"/>',
            "</g>"
        );
        assertEq(_figure(1376, 0, 1, false), want);
    }

    /// (42, 0, 17), gilt: a round shell, standard density, the gilt colours, three segment rings, the tick at
    /// translate(0 0) (2665 bytes).
    function test_giltCardMatchesTheMirror() public view {
        string memory want = string.concat(
            '<g transform="translate(540 584) rotate(-2.7) scale(6.3) translate(-32 -52)" font-family="Consolas, \'Courier New\', monospace" letter-spacing="0.25"><defs>',
            '<path id="shell" d="M32 11C12.8 18.8 9.9 50.2 15.7 71.8C20.5 83.5 26.2 89.4 32 91.4C37.8 89.4 43.5 83.5 48.3 71.8C54.1 50.2 51.2 18.8 32 11Z"/>',
            '<path id="shell2" d="M32 13.5C15.5 20.8 13 50 18 70C22.1 80.9 27 86.4 32 88.2C37 86.4 41.9 80.9 46 70C51 50 48.5 20.8 32 13.5Z"/>',
            '<path id="wing" d="M32 30C22.8 40 18.7 54 23.8 74C27.9 68 31 61 32 54C33 61 36.1 68 40.2 74C45.3 54 41.2 40 32 30Z"/>',
            '<path id="wing2" d="M32 34C25.3 42.2 22.3 53.7 26 70.1C29 65.2 31.3 59.4 32 53.7C32.7 59.4 35 65.2 38 70.1C41.7 53.7 38.7 42.2 32 34Z"/>',
            '<path id="band" d="M19.8 29C24.5 26.4 39.5 26.4 44.2 29"/>',
            '<path id="vein" d="M32 30v44"/></defs>'
        );
        want = string.concat(
            want,
            '<text font-size="2.3" fill="#d9a94b" ><textPath href="#shell">0111111011111010110011000101110110100101110101111001110111100110010100111001010100011000111100111100100001110101010001110110110100001010010110001111101111011001011100100001001110011111011110</textPath></text>',
            '<text font-size="1.5" fill="#d9a94b" opacity="0.45"><textPath href="#shell2">110111111101001101101110000011010010001011010111110011111010011100011010110000011111001001000110011001101100001000010010010010110100111111001010011101001011010001101101101101001101000001010000100011001000100010</textPath></text>',
            '<text font-size="2.1" fill="#37b59a" filter="url(#soft)"><textPath href="#wing">1000000101001111111100111111111011101101001010011011001001110101100011111101001000110000000011010101010000011000000111011101011100</textPath></text>',
            '<text font-size="1.4" fill="#37b59a" opacity="0.55"><textPath href="#wing2">10111110100001100101000101001110111101000011101101110000010001111111000111010000101011000001100111001111011011000111101001111001010101111011</textPath></text>',
            '<text font-size="1.6" fill="#37b59a" opacity="0.8"><textPath href="#vein">1001000101111111010011001110011010101010</textPath></text>',
            '<text font-size="2.2" fill="#e9e6da" ><textPath href="#band">101101001011100001000000111010</textPath></text>',
            '<path d="M18.6 62.9q13.4 4 26.9 0" stroke="#d9a94b" stroke-width="0.5" fill="none" opacity="0.45" stroke-dasharray="0.8 1.2"/>'
        );
        want = string.concat(
            want,
            '<path d="M21.4 69.8q10.6 4 21.1 0" stroke="#d9a94b" stroke-width="0.5" fill="none" opacity="0.45" stroke-dasharray="0.8 1.2"/>',
            '<path d="M24.3 76.7q7.7 4 15.4 0" stroke="#d9a94b" stroke-width="0.5" fill="none" opacity="0.45" stroke-dasharray="0.8 1.2"/>',
            '<path transform="translate(0 0)" d="M24.3 73c2-3.6 4.9-6.6 7.7-9.4 2.8 2.8 5.6 5.8 7.7 9.4" stroke="#e9e6da" stroke-width="0.9" fill="none" stroke-linecap="round"/>',
            '<path d="M32 2v9" stroke="#d9a94b" stroke-width="0.8" fill="none"/>',
            "</g>"
        );
        assertEq(_figure(42, 0, 17, true), want);
    }

    /// (1376, 0, 2), plain: a teardrop, fine, classic, three segment rings. With the pear below and the two
    /// cards above, every form's control points and band fit are pinned (2715 bytes).
    function test_teardropMatchesTheMirror() public view {
        string memory want = string.concat(
            '<g transform="translate(540 584) rotate(-5.8) scale(6.7) translate(-32 -52)" font-family="Consolas, \'Courier New\', monospace" letter-spacing="0.25"><defs>',
            '<path id="shell" d="M32 11C15.2 17.7 9.9 36.7 13.1 55.7C16.2 71.8 23.6 84.2 32 88.9C40.4 84.2 47.8 71.8 50.9 55.7C54.1 36.7 48.8 17.7 32 11Z"/>',
            '<path id="shell2" d="M32 13.4C17.6 19.6 13 37.3 15.7 54.9C18.5 69.9 24.8 81.4 32 85.8C39.2 81.4 45.5 69.9 48.3 54.9C51 37.3 46.4 19.6 32 13.4Z"/>',
            '<path id="wing" d="M32 30C24 40.1 20.4 54.2 24.9 74.4C28.4 68.4 31.1 61.3 32 54.2C32.9 61.3 35.6 68.4 39.1 74.4C43.6 54.2 40 40.1 32 30Z"/>',
            '<path id="wing2" d="M32 34C26.2 42.3 23.6 53.9 26.8 70.4C29.4 65.5 31.4 59.7 32 53.9C32.6 59.7 34.6 65.5 37.2 70.4C40.4 53.9 37.8 42.3 32 34Z"/>',
            '<path id="band" d="M17.8 29C23.3 26.4 40.7 26.4 46.2 29"/>',
            '<path id="vein" d="M32 30v44.4"/></defs>'
        );
        want = string.concat(
            want,
            '<text font-size="1.9" fill="#e9e6da" ><textPath href="#shell">0011101001010100011101110101000011000010101010011011111100010110011001010000011011001001111001010111101100010010010101011100011011000011000111110110000011001110101101000111111110100110100110</textPath></text>',
            '<text font-size="1.2" fill="#e9e6da" opacity="0.45"><textPath href="#shell2">100011001100100100010111101101101010101110011000110000110111011101000100111101110000100110100011000011111100000010011010011110001001001001011000100100100001010011100101101111101100010010000010000010010101110001</textPath></text>',
            '<text font-size="1.7" fill="#5fd0a3" filter="url(#soft)"><textPath href="#wing">1100001011001011110110000001011100000001111111111101110101001001011110011000100011011000101111110100101010001011101110111011101011</textPath></text>',
            '<text font-size="1.1" fill="#5fd0a3" opacity="0.55"><textPath href="#wing2">01101111011001001011011000000011000001110111110000111001000001110001101000100001101011101001100110000111111111110111000100111111001100100110</textPath></text>',
            '<text font-size="1.3" fill="#5fd0a3" opacity="0.8"><textPath href="#vein">0010110010001001001110110101100111000000</textPath></text>',
            '<text font-size="1.8" fill="#d9a94b" ><textPath href="#band">011100110100100111100000110110</textPath></text>',
            '<path d="M17.3 61.4q14.7 4 29.4 0" stroke="#e9e6da" stroke-width="0.5" fill="none" opacity="0.45" stroke-dasharray="0.8 1.2"/>'
        );
        want = string.concat(
            want,
            '<path d="M20.4 68q11.6 4 23.1 0" stroke="#e9e6da" stroke-width="0.5" fill="none" opacity="0.45" stroke-dasharray="0.8 1.2"/>',
            '<path d="M23.6 74.7q8.4 4 16.8 0" stroke="#e9e6da" stroke-width="0.5" fill="none" opacity="0.45" stroke-dasharray="0.8 1.2"/>',
            '<path transform="translate(0 0.4)" d="M25.3 73c1.8-3.6 4.3-6.6 6.7-9.4 2.4 2.8 4.9 5.8 6.7 9.4" stroke="#d9a94b" stroke-width="0.9" fill="none" stroke-linecap="round"/>',
            '<path d="M32 2v9" stroke="#e9e6da" stroke-width="0.8" fill="none"/>',
            "</g>"
        );
        assertEq(_figure(1376, 0, 2, false), want);
    }

    /// (1376, 1, 303), plain: a pear, fine, inverted, two segment rings (2590 bytes).
    function test_pearMatchesTheMirror() public view {
        string memory want = string.concat(
            '<g transform="translate(540 584) rotate(-11.3) scale(7.1) translate(-32 -52)" font-family="Consolas, \'Courier New\', monospace" letter-spacing="0.25"><defs>',
            '<path id="shell" d="M32 11C21.8 17.2 10.5 48.4 9.4 71.3C12.8 85.9 21.8 95.2 32 98.4C42.2 95.2 51.2 85.9 54.6 71.3C53.5 48.4 42.2 17.2 32 11Z"/>',
            '<path id="shell2" d="M32 13.6C23.3 19.4 13.5 48.4 12.6 69.7C15.5 83.2 23.3 91.9 32 94.8C40.7 91.9 48.5 83.2 51.4 69.7C50.5 48.4 40.7 19.4 32 13.6Z"/>',
            '<path id="wing" d="M32 30C23.4 39.8 19.5 53.5 24.3 73.1C28.2 67.2 31 60.4 32 53.5C33 60.4 35.8 67.2 39.7 73.1C44.5 53.5 40.6 39.8 32 30Z"/>',
            '<path id="wing2" d="M32 34C25.7 42 22.9 53.3 26.4 69.4C29.2 64.5 31.3 58.9 32 53.3C32.7 58.9 34.8 64.5 37.6 69.4C41.1 53.3 38.3 42 32 34Z"/>',
            '<path id="band" d="M22 29C25.8 26.4 38.2 26.4 42 29"/>',
            '<path id="vein" d="M32 30v43.1"/></defs>'
        );
        want = string.concat(
            want,
            '<text font-size="1.9" fill="#5fd0a3" ><textPath href="#shell">0001110010110001100101101110101010001111101011000101101111001011001000110100110100111000000100001000001111110011011001010010000110101000101101010101101010011100000000011110011001000110100110</textPath></text>',
            '<text font-size="1.2" fill="#5fd0a3" opacity="0.45"><textPath href="#shell2">110010011101101100110110011010110011110101110000110010011000001110100101100001110001011111110101011001100110111000010110010000110111110011101000110101000001011001000110111000111000111010111000000110110101101000</textPath></text>',
            '<text font-size="1.7" fill="#e9e6da" filter="url(#soft)"><textPath href="#wing">1111101010010010110111111100011000111100101011100001001111011111001110101000001011101010111011000110010111000001100100000001110100</textPath></text>',
            '<text font-size="1.1" fill="#e9e6da" opacity="0.55"><textPath href="#wing2">11010010011110010011111001101100010001011110110011011011110100100011011111001111010100110000000000110000100010111100001001001100110110110001</textPath></text>',
            '<text font-size="1.3" fill="#e9e6da" opacity="0.8"><textPath href="#vein">1101101000111000110011000110011111111011</textPath></text>',
            '<text font-size="1.8" fill="#d9a94b" ><textPath href="#band">011111011100100011000000111011</textPath></text>',
            '<path d="M16.2 66.1q15.8 4 31.6 0" stroke="#5fd0a3" stroke-width="0.5" fill="none" opacity="0.45" stroke-dasharray="0.8 1.2"/>'
        );
        want = string.concat(
            want,
            '<path d="M19.6 73.4q12.4 4 24.9 0" stroke="#5fd0a3" stroke-width="0.5" fill="none" opacity="0.45" stroke-dasharray="0.8 1.2"/>',
            '<path transform="translate(0 -0.9)" d="M24.8 73c1.9-3.6 4.6-6.6 7.2-9.4 2.6 2.8 5.3 5.8 7.2 9.4" stroke="#d9a94b" stroke-width="0.9" fill="none" stroke-linecap="round"/>',
            '<path d="M32 2v9" stroke="#5fd0a3" stroke-width="0.8" fill="none"/>',
            "</g>"
        );
        assertEq(_figure(1376, 1, 303, false), want);
    }

    /// The seat traits change nothing: the chrysalis is drawn from the card traits, the colours and the seed.
    function test_seatTraitsAreIgnored() public view {
        Traits memory t = h.cardTraits(1376, 0, 1);
        SeatTraits memory st = h.seatTraits(1376);
        Colours memory c = h.colours(t.palette, false, st.tone);
        bytes32 s = h.seed(1376, 0, 1, 11);
        SeatTraits memory none;
        assertEq(chrysalis.figure(t, none, c, s), chrysalis.figure(t, st, c, s));
    }

    /// Random cards draw: each fuzz run (256 by default, a sample of the cards and not all of them) draws the
    /// figure of a random seat, round, edition and proof without a revert, so no coordinate went below zero
    /// (the arithmetic is unsigned and would revert), and the figure is one group.
    function testFuzz_randomCardsDraw(uint256 seat, uint16 round, uint16 edition, bool gilt) public view {
        bytes memory f = bytes(_figure(seat, round, edition, gilt));
        bytes memory head = bytes('<g transform="translate(540 584) rotate(');
        for (uint256 k; k < head.length; k++) {
            assertEq(f[k], head[k]);
        }
        bytes memory tail = bytes("</g>");
        for (uint256 k; k < tail.length; k++) {
            assertEq(f[f.length - tail.length + k], tail[k]);
        }
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
        return chrysalis.figure(t, st, c, h.seed(seat, round, edition, 11));
    }
}
