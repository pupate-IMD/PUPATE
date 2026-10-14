// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {Colours, SeatTraits, Traits} from "../../../src/interfaces/IMetamorphFigure.sol";
import {ArtTraits} from "../../../src/metamorph/art/ArtTraits.sol";
import {Base64} from "../../../src/metamorph/art/Base64.sol";

/// @dev The trait library's internal functions behind external calls, for these tests and the figure suites.
contract ArtTraitsHarness {
    function seed(uint256 seat, uint16 round, uint16 edition, uint256 line) external pure returns (bytes32) {
        return ArtTraits.seed(seat, round, edition, line);
    }

    function word(bytes32 s, uint256 k) external pure returns (uint32) {
        return ArtTraits.word(s, k);
    }

    function between(uint32 x, int256 lo, int256 hi, uint256 unit) external pure returns (int256) {
        return ArtTraits.between(x, lo, hi, unit);
    }

    function count(uint32 x, uint256 n) external pure returns (uint256) {
        return ArtTraits.count(x, n);
    }

    function pick(uint32 x, uint16[4] memory w) external pure returns (uint8) {
        return ArtTraits.pick(x, w);
    }

    function bits(bytes32 s, uint256 line, uint256 n) external pure returns (string memory) {
        return ArtTraits.bits(s, line, n);
    }

    function f1(int256 tenths) external pure returns (string memory) {
        return ArtTraits.f1(tenths);
    }

    function u(uint256 x) external pure returns (string memory) {
        return ArtTraits.u(x);
    }

    function i(int256 x) external pure returns (string memory) {
        return ArtTraits.i(x);
    }

    function seatTraits(uint256 seat) external pure returns (SeatTraits memory) {
        return ArtTraits.seatTraits(seat);
    }

    function cardTraits(uint256 seat, uint16 round, uint16 edition) external pure returns (Traits memory) {
        return ArtTraits.cardTraits(seat, round, edition);
    }

    function formWeights() external pure returns (uint16[4] memory) {
        return ArtTraits.formWeights();
    }

    function signalWeights() external pure returns (uint16[4] memory) {
        return ArtTraits.signalWeights();
    }

    function densityWeights() external pure returns (uint16[4] memory) {
        return ArtTraits.densityWeights();
    }

    function haloWeights() external pure returns (uint16[4] memory) {
        return ArtTraits.haloWeights();
    }

    function paletteWeights() external pure returns (uint16[4] memory) {
        return ArtTraits.paletteWeights();
    }

    function tone(uint8 index) external pure returns (string memory) {
        return ArtTraits.tone(index);
    }

    function colours(uint8 palette, bool gilt, uint8 toneIndex) external pure returns (Colours memory) {
        return ArtTraits.colours(palette, gilt, toneIndex);
    }

    function densityOf(uint8 density) external pure returns (uint256 outer, uint256 inner, uint256 dots) {
        return ArtTraits.densityOf(density);
    }

    function encode(bytes memory data) external pure returns (string memory) {
        return Base64.encode(data);
    }

    function sinCircle(uint256 t) external pure returns (bool neg, uint256 mag) {
        return ArtTraits.sinCircle(ArtTraits.sines(), t);
    }
}

/// @dev The vectors are pasted from `node script/art/mirror.mjs vectors`: the mirror is written from the spec
/// first, and when it and the contract disagree, the side that deviates from the spec's rule is fixed, never a
/// vector. The site's numbers are pasted from `node script/art/seatParity.mjs`.
contract ArtTraitsTest is Test {
    ArtTraitsHarness internal h;

    function setUp() public {
        h = new ArtTraitsHarness();
    }

    /// Seeds are keccak of the abi-encoded card fields and a line; words are eight 32-bit slices per hash,
    /// the lowest first.
    function test_seedsAndWords() public view {
        assertEq(
            h.seed(1376, 0, 1, 7), bytes32(0xa58ab7138a0abf8d9d6b24241745c187c92f00cbd1e76f4a38956dad2666e30d)
        );
        assertEq(
            h.seed(1376, 0, 1, 11),
            bytes32(0xdb194f1233607197255fee509a92885cbb70aa400e088cd0dd7cc572f2806818)
        );
        assertEq(
            h.seed(42, 0, 17, 7), bytes32(0xed8e5a06b68cf3bbede46541613d54ab43325097543099890ce5b5f509232095)
        );
        assertEq(
            h.word(bytes32(0xa58ab7138a0abf8d9d6b24241745c187c92f00cbd1e76f4a38956dad2666e30d), 0), 2987535440
        );
        assertEq(
            h.word(bytes32(0xa58ab7138a0abf8d9d6b24241745c187c92f00cbd1e76f4a38956dad2666e30d), 1), 2760239472
        );
        assertEq(
            h.word(bytes32(0xa58ab7138a0abf8d9d6b24241745c187c92f00cbd1e76f4a38956dad2666e30d), 7), 2245948925
        );
        assertEq(
            h.word(bytes32(0xa58ab7138a0abf8d9d6b24241745c187c92f00cbd1e76f4a38956dad2666e30d), 8), 4153977843
        );
        assertEq(
            h.word(bytes32(0xa58ab7138a0abf8d9d6b24241745c187c92f00cbd1e76f4a38956dad2666e30d), 19),
            4205935531
        );
    }

    /// `between` rounds half up (toward +infinity, as Math.round) and reaches both ends; `count` floors.
    function test_betweenAndCount() public view {
        assertEq(h.between(0, 118, 152, 10), 1180);
        assertEq(h.between(4294967295, 118, 152, 10), 1520);
        assertEq(h.between(2147483648, 0, 1, 1), 1);
        assertEq(h.between(2147483647, 0, 1, 1), 0);
        assertEq(h.between(2147483648, -1, 0, 1), 0);
        assertEq(h.between(2147483647, -1, 0, 1), -1);
        assertEq(h.between(0, -12, 12, 10), -120);
        assertEq(h.between(4294967295, -12, 12, 10), 120);
        assertEq(h.between(2654435769, 85, 120, 1), 107);
        assertEq(h.between(2654435769, 0, 360, 10), 2225);
        assertEq(h.count(0, 3), 0);
        assertEq(h.count(1431655765, 3), 0);
        assertEq(h.count(1431655766, 3), 1);
        assertEq(h.count(4294967295, 3), 2);
        assertEq(h.count(4294967295, 5), 4);
        assertEq(h.count(2654435769, 4), 2);
    }

    function test_seatTraitsVectors() public view {
        _seat(
            1,
            SeatTraits({
                span: 1366,
                rise: 1067,
                reach: 844,
                drop: 1017,
                veins: 5,
                spots: 2,
                dots: 5,
                rings: 4,
                tilt: 20,
                tone: 1
            })
        );
        _seat(
            1376,
            SeatTraits({
                span: 1334,
                rise: 1045,
                reach: 1035,
                drop: 1044,
                veins: 5,
                spots: 0,
                dots: 4,
                rings: 5,
                tilt: -31,
                tone: 2
            })
        );
        _seat(
            2345,
            SeatTraits({
                span: 1407,
                rise: 1234,
                reach: 854,
                drop: 890,
                veins: 3,
                spots: 2,
                dots: 3,
                rings: 5,
                tilt: 46,
                tone: 0
            })
        );
        _seat(
            4096,
            SeatTraits({
                span: 1297,
                rise: 999,
                reach: 902,
                drop: 1029,
                veins: 5,
                spots: 0,
                dots: 4,
                rings: 4,
                tilt: 9,
                tone: 1
            })
        );
    }

    /// The integer seat traits equal site/lib/seat.ts's traits(seat): 8 of the 64 seats the parity script
    /// compares, chosen so that every value of every integer trait appears.
    function test_seatTraitsIntegerPartsMatchTheSite() public view {
        _siteIntegers(1, 5, 2, 5, 4, 1);
        _siteIntegers(2, 5, 1, 4, 4, 1);
        _siteIntegers(3, 3, 0, 5, 5, 2);
        _siteIntegers(4, 3, 3, 4, 4, 2);
        _siteIntegers(5, 3, 0, 4, 3, 3);
        _siteIntegers(12, 4, 1, 7, 5, 2);
        _siteIntegers(14, 5, 1, 6, 4, 2);
        _siteIntegers(45, 3, 3, 3, 5, 0);
    }

    function test_cardTraitsVectors() public view {
        _card(
            1376,
            0,
            1,
            Traits({
                form: 2,
                signal: 1,
                tilt: -30,
                scale: 107,
                shellW: 109,
                shellL: 101,
                wingW: 95,
                wingL: 99,
                density: 2,
                halo: 0,
                palette: 0,
                bandW: 94,
                rings: 4,
                orbitDeg: 2293,
                dSpan: 89,
                dRise: 98,
                dReach: 93,
                dDrop: 105,
                dVeins: -1,
                dSpots: 1,
                tier: 0
            })
        );
        _card(
            1376,
            0,
            2,
            Traits({
                form: 0,
                signal: 0,
                tilt: -58,
                scale: 102,
                shellW: 105,
                shellL: 95,
                wingW: 89,
                wingL: 101,
                density: 0,
                halo: 0,
                palette: 0,
                bandW: 104,
                rings: 3,
                orbitDeg: 680,
                dSpan: 99,
                dRise: 90,
                dReach: 107,
                dDrop: 104,
                dVeins: -1,
                dSpots: 1,
                tier: 1
            })
        );
        _card(
            1376,
            1,
            303,
            Traits({
                form: 1,
                signal: 1,
                tilt: -113,
                scale: 108,
                shellW: 113,
                shellL: 104,
                wingW: 96,
                wingL: 98,
                density: 0,
                halo: 1,
                palette: 1,
                bandW: 92,
                rings: 2,
                orbitDeg: 3171,
                dSpan: 111,
                dRise: 103,
                dReach: 88,
                dDrop: 109,
                dVeins: -1,
                dSpots: 1,
                tier: 2
            })
        );
        _card(
            42,
            0,
            17,
            Traits({
                form: 3,
                signal: 0,
                tilt: -27,
                scale: 96,
                shellW: 96,
                shellL: 98,
                wingW: 102,
                wingL: 100,
                density: 1,
                halo: 0,
                palette: 0,
                bandW: 93,
                rings: 3,
                orbitDeg: 2239,
                dSpan: 103,
                dRise: 109,
                dReach: 94,
                dDrop: 94,
                dVeins: -1,
                dSpots: 0,
                tier: 1
            })
        );
        _card(
            1376,
            0,
            4,
            Traits({
                form: 3,
                signal: 0,
                tilt: -2,
                scale: 107,
                shellW: 95,
                shellL: 101,
                wingW: 105,
                wingL: 94,
                density: 0,
                halo: 0,
                palette: 2,
                bandW: 93,
                rings: 2,
                orbitDeg: 8,
                dSpan: 106,
                dRise: 95,
                dReach: 97,
                dDrop: 99,
                dVeins: 1,
                dSpots: -1,
                tier: 1
            })
        );
        _card(
            1376,
            0,
            20,
            Traits({
                form: 3,
                signal: 0,
                tilt: 14,
                scale: 106,
                shellW: 87,
                shellL: 93,
                wingW: 96,
                wingL: 102,
                density: 2,
                halo: 2,
                palette: 0,
                bandW: 114,
                rings: 2,
                orbitDeg: 852,
                dSpan: 111,
                dRise: 95,
                dReach: 93,
                dDrop: 112,
                dVeins: 0,
                dSpots: 1,
                tier: 1
            })
        );
    }

    /// wingW = min(draw, (shellW × 110 + 50) / 100): for (1376, 0, 4) and (1376, 0, 20) the draw (word 6) is
    /// above the cap, and the card gets the cap.
    function test_wingWIsCappedByTheShell() public view {
        _capped(1376, 0, 4);
        _capped(1376, 0, 20);
    }

    function test_f1PrintsTenths() public view {
        assertEq(h.f1(-123), "-12.3");
        assertEq(h.f1(-4), "-0.4");
        assertEq(h.f1(0), "0");
        assertEq(h.f1(7), "0.7");
        assertEq(h.f1(120), "12");
        assertEq(h.f1(1234), "123.4");
    }

    function test_integersPrintInDecimal() public view {
        assertEq(h.u(0), "0");
        assertEq(h.u(7), "7");
        assertEq(h.u(1234567890), "1234567890");
        assertEq(
            h.u(type(uint256).max),
            "115792089237316195423570985008687907853269984665640564039457584007913129639935"
        );
        assertEq(h.i(-5), "-5");
        assertEq(h.i(0), "0");
        assertEq(h.i(42), "42");
        assertEq(
            h.i(type(int256).min),
            "-57896044618658097711785492504343953926634992332820282019728792003956564819968"
        );
    }

    function test_bitsVectors() public view {
        assertEq(
            h.bits(bytes32(0xdb194f1233607197255fee509a92885cbb70aa400e088cd0dd7cc572f2806818), 11001, 30),
            "111110001110010011101000000110"
        );
        assertEq(
            h.bits(bytes32(0xdb194f1233607197255fee509a92885cbb70aa400e088cd0dd7cc572f2806818), 11001, 190),
            "1111100011100100111010000001100001000001110101111110010101001010001111010100100001001001100101001010110111011000001101111101011111000110010111010101000110001110011110110101010001000000010001"
        );
        assertEq(
            h.bits(bytes32(0xdb194f1233607197255fee509a92885cbb70aa400e088cd0dd7cc572f2806818), 11001, 320),
            "11111000111001001110100000011000010000011101011111100101010010100011110101001000010010011001010010101101110110000011011111010111110001100101110101010001100011100111101101010100010000000100011100111011100111000101001001110010010001101100100101001100000100100101001000111001001011100111100100011100011010101000010011011111"
        );
        assertEq(
            h.bits(bytes32(0x7ce9acf33481d85948996e8d0fb44648845758371f270395c0d750ff9b40beaf), 11006, 30),
            "101101001011100001000000111010"
        );
        assertEq(
            h.bits(bytes32(0x7ce9acf33481d85948996e8d0fb44648845758371f270395c0d750ff9b40beaf), 11006, 190),
            "1011010010111000010000001110101110100000101001100011100011010000110001011000101011011001001011010010010100010110111001000011001111111011010111110111111101011100001001101111001100000011110011"
        );
        assertEq(
            h.bits(bytes32(0x7ce9acf33481d85948996e8d0fb44648845758371f270395c0d750ff9b40beaf), 11006, 320),
            "10110100101110000100000011101011101000001010011000111000110100001100010110001010110110010010110100100101000101101110010000110011111110110101111101111111010111000010011011110011000000111100111110010000000110100101101110110100110000011100111000010000001111110101001001010001011011011111100111010011000011011111011110001001"
        );
    }

    /// n bits are the first n of any longer run on the same seed and line, across the 256-bit hash
    /// boundaries; zero bits are the empty string; another line gives other bits.
    function test_bitsAreThePrefixOfALongerRun() public view {
        bytes32 s = h.seed(1376, 0, 1, 11);
        bytes memory run = bytes(h.bits(s, 11001, 600));
        assertEq(run.length, 600);
        assertEq(h.bits(s, 11001, 0), "");
        uint256[6] memory ns = [uint256(1), 255, 256, 257, 512, 513];
        for (uint256 k; k < ns.length; k++) {
            assertEq(h.bits(s, 11001, ns[k]), string(_prefix(run, ns[k])));
        }
        assertNotEq(h.bits(s, 11001, 256), h.bits(s, 11002, 256));
    }

    /// The boundaries run on the library's own tables, the ones `cardTraits` draws with, each pinned first to
    /// the spec's weights: two weights swapped in the library fail here.
    function test_pickAtTheTableBoundaries() public view {
        uint16[4] memory w = h.formWeights();
        _weights(w, [uint16(40), 22, 22, 16]);
        assertEq(h.pick(0, w), 0);
        assertEq(h.pick(1717986918, w), 0);
        assertEq(h.pick(1717986919, w), 1);
        assertEq(h.pick(2662879723, w), 1);
        assertEq(h.pick(2662879724, w), 2);
        assertEq(h.pick(3607772528, w), 2);
        assertEq(h.pick(3607772529, w), 3);
        assertEq(h.pick(type(uint32).max, w), 3);
        w = h.signalWeights();
        _weights(w, [uint16(45), 25, 20, 10]);
        assertEq(h.pick(0, w), 0);
        assertEq(h.pick(1932735283, w), 0);
        assertEq(h.pick(1932735284, w), 1);
        assertEq(h.pick(3006477107, w), 1);
        assertEq(h.pick(3006477108, w), 2);
        assertEq(h.pick(3865470566, w), 2);
        assertEq(h.pick(3865470567, w), 3);
        assertEq(h.pick(type(uint32).max, w), 3);
        w = h.densityWeights();
        _weights(w, [uint16(30), 50, 20, 0]);
        assertEq(h.pick(0, w), 0);
        assertEq(h.pick(1288490188, w), 0);
        assertEq(h.pick(1288490189, w), 1);
        assertEq(h.pick(3435973836, w), 1);
        assertEq(h.pick(3435973837, w), 2);
        assertEq(h.pick(type(uint32).max, w), 2);
        w = h.haloWeights();
        _weights(w, [uint16(50), 30, 15, 5]);
        assertEq(h.pick(0, w), 0);
        assertEq(h.pick(2147483647, w), 0);
        assertEq(h.pick(2147483648, w), 1);
        assertEq(h.pick(3435973836, w), 1);
        assertEq(h.pick(3435973837, w), 2);
        assertEq(h.pick(4080218931, w), 2);
        assertEq(h.pick(4080218932, w), 3);
        assertEq(h.pick(type(uint32).max, w), 3);
        w = h.paletteWeights();
        _weights(w, [uint16(58), 20, 12, 10]);
        assertEq(h.pick(0, w), 0);
        assertEq(h.pick(2491081031, w), 0);
        assertEq(h.pick(2491081032, w), 1);
        assertEq(h.pick(3350074490, w), 1);
        assertEq(h.pick(3350074491, w), 2);
        assertEq(h.pick(3865470566, w), 2);
        assertEq(h.pick(3865470567, w), 3);
        assertEq(h.pick(type(uint32).max, w), 3);
    }

    function test_tonesAreTheFourJades() public view {
        assertEq(h.tone(0), "#3ec28f");
        assertEq(h.tone(1), "#2aa87a");
        assertEq(h.tone(2), "#5fd0a3");
        assertEq(h.tone(3), "#37b59a");
        assertEq(h.tone(4), "#3ec28f");
        assertEq(h.tone(255), "#3ec28f");
    }

    function test_coloursFollowThePrototypeTable() public view {
        _colours(
            0,
            false,
            0,
            Colours({
                shell: "#e9e6da",
                inner: "#e9e6da",
                wing: "#3ec28f",
                wing2: "#3ec28f",
                vein: "#3ec28f",
                band: "#d9a94b",
                glow: "#3ec28f",
                spots: "#d9a94b",
                body: "#e9e6da"
            })
        );
        _colours(
            1,
            false,
            1,
            Colours({
                shell: "#2aa87a",
                inner: "#2aa87a",
                wing: "#e9e6da",
                wing2: "#e9e6da",
                vein: "#e9e6da",
                band: "#d9a94b",
                glow: "#2aa87a",
                spots: "#d9a94b",
                body: "#e9e6da"
            })
        );
        _colours(
            2,
            false,
            2,
            Colours({
                shell: "#e9e6da",
                inner: "#e9e6da",
                wing: "#d9a94b",
                wing2: "#d9a94b",
                vein: "#d9a94b",
                band: "#5fd0a3",
                glow: "#d9a94b",
                spots: "#5fd0a3",
                body: "#e9e6da"
            })
        );
        _colours(
            3,
            false,
            3,
            Colours({
                shell: "#e9e6da",
                inner: "#e9e6da",
                wing: "#e9e6da",
                wing2: "#e9e6da",
                vein: "#e9e6da",
                band: "#d9a94b",
                glow: "#e9e6da",
                spots: "#d9a94b",
                body: "#e9e6da"
            })
        );
        _colours(
            2,
            true,
            1,
            Colours({
                shell: "#d9a94b",
                inner: "#d9a94b",
                wing: "#2aa87a",
                wing2: "#2aa87a",
                vein: "#2aa87a",
                band: "#e9e6da",
                glow: "#d9a94b",
                spots: "#e9e6da",
                body: "#d9a94b"
            })
        );
        _colours(
            0,
            true,
            3,
            Colours({
                shell: "#d9a94b",
                inner: "#d9a94b",
                wing: "#37b59a",
                wing2: "#37b59a",
                vein: "#37b59a",
                band: "#e9e6da",
                glow: "#d9a94b",
                spots: "#e9e6da",
                body: "#d9a94b"
            })
        );
        _colours(
            7,
            false,
            2,
            Colours({
                shell: "#e9e6da",
                inner: "#e9e6da",
                wing: "#5fd0a3",
                wing2: "#5fd0a3",
                vein: "#5fd0a3",
                band: "#d9a94b",
                glow: "#5fd0a3",
                spots: "#d9a94b",
                body: "#e9e6da"
            })
        );
        _colours(
            0,
            false,
            9,
            Colours({
                shell: "#e9e6da",
                inner: "#e9e6da",
                wing: "#3ec28f",
                wing2: "#3ec28f",
                vein: "#3ec28f",
                band: "#d9a94b",
                glow: "#3ec28f",
                spots: "#d9a94b",
                body: "#e9e6da"
            })
        );
    }

    function test_densityTable() public view {
        _density(0, 19, 12, 12);
        _density(1, 23, 15, 26);
        _density(2, 28, 18, 42);
        _density(3, 28, 18, 42);
    }

    function test_base64RoundTrips() public view {
        assertEq(h.encode(bytes("")), "");
        assertEq(h.encode(bytes("f")), "Zg==");
        assertEq(h.encode(bytes("fo")), "Zm8=");
        assertEq(h.encode(bytes("foo")), "Zm9v");
        assertEq(h.encode(bytes("foob")), "Zm9vYg==");
        assertEq(h.encode(bytes("fooba")), "Zm9vYmE=");
        assertEq(h.encode(bytes("foobar")), "Zm9vYmFy");
        assertEq(
            h.encode(_blob(300)),
            "KQ3s2VSLYqjWA0WpiDhvyEumvJVIQAj2Ni+TFg7z5WOxDi1SdhIHOybuzf1xfmoyDPRLSvrCsHMtn8vit/oM9kBXh/oSqCPg8rdjHMQbO6iCizMhyoEREfp1zTqju1rOwldaDp5ZPAD5WfjJLxLbKGnDOVo7BQLQXiUWRG9x+FuKNaz7wV/4GjmufTRP1wnyjoYAtKqMZca2S/5/42vRmwNrY4S17KeRxidhFS0MebsGBMEEpftvTrBwPzFUuz2w9lIiIxPihFlSjZILZRFcFsBPPvyCqu3Je+WfPzd8DT+mbMkote24Kvm9SZIpVBVat7CUJpS+pM5EZh2ahzbGiPP3qf42T6q5OyFtpQoyFBVPIqCitBWyOoTIFp6LY27jbhVAFxtsDJYLcacC"
        );
        assertEq(
            h.encode(_blob(301)),
            "KQ3s2VSLYqjWA0WpiDhvyEumvJVIQAj2Ni+TFg7z5WOxDi1SdhIHOybuzf1xfmoyDPRLSvrCsHMtn8vit/oM9kBXh/oSqCPg8rdjHMQbO6iCizMhyoEREfp1zTqju1rOwldaDp5ZPAD5WfjJLxLbKGnDOVo7BQLQXiUWRG9x+FuKNaz7wV/4GjmufTRP1wnyjoYAtKqMZca2S/5/42vRmwNrY4S17KeRxidhFS0MebsGBMEEpftvTrBwPzFUuz2w9lIiIxPihFlSjZILZRFcFsBPPvyCqu3Je+WfPzd8DT+mbMkote24Kvm9SZIpVBVat7CUJpS+pM5EZh2ahzbGiPP3qf42T6q5OyFtpQoyFBVPIqCitBWyOoTIFp6LY27jbhVAFxtsDJYLcacCDQ=="
        );
        assertEq(
            h.encode(_blob(302)),
            "KQ3s2VSLYqjWA0WpiDhvyEumvJVIQAj2Ni+TFg7z5WOxDi1SdhIHOybuzf1xfmoyDPRLSvrCsHMtn8vit/oM9kBXh/oSqCPg8rdjHMQbO6iCizMhyoEREfp1zTqju1rOwldaDp5ZPAD5WfjJLxLbKGnDOVo7BQLQXiUWRG9x+FuKNaz7wV/4GjmufTRP1wnyjoYAtKqMZca2S/5/42vRmwNrY4S17KeRxidhFS0MebsGBMEEpftvTrBwPzFUuz2w9lIiIxPihFlSjZILZRFcFsBPPvyCqu3Je+WfPzd8DT+mbMkote24Kvm9SZIpVBVat7CUJpS+pM5EZh2ahzbGiPP3qf42T6q5OyFtpQoyFBVPIqCitBWyOoTIFp6LY27jbhVAFxtsDJYLcacCDZ8="
        );
    }

    /// The sine on the whole circle, a sign and a magnitude in hundred-thousandths: the quarter turns, a
    /// tenth on each side of them, the middle of each quadrant, a whole turn and past it, and the orbit of
    /// (2345, 0, 5) at 328.5 degrees with its cosine's angle, 418.5. Between two whole degrees the table is
    /// interpolated (31.5 degrees is 52245, 58.5 is 85260).
    function test_sinTurnsTheWholeCircle() public view {
        _sin(0, false, 0);
        _sin(1, false, 175);
        _sin(450, false, 70710);
        _sin(899, false, 99998);
        _sin(900, false, 100000);
        _sin(901, false, 99998);
        _sin(1350, false, 70710);
        _sin(1799, false, 175);
        _sin(1800, true, 0);
        _sin(1801, true, 175);
        _sin(2250, true, 70710);
        _sin(2699, true, 99998);
        _sin(2700, true, 100000);
        _sin(2701, true, 99998);
        _sin(3150, true, 70710);
        _sin(3285, true, 52245);
        _sin(3599, true, 175);
        _sin(3600, false, 0);
        _sin(4185, false, 85260);
        _sin(4500, false, 100000);
    }

    /// The last chunk reads up to two bytes past the data. `_blob` cuts a 320-byte buffer in place, so the
    /// bytes past the cut are still in memory and nonzero; the encoding must not see them.
    function test_base64IgnoresTheBytesAfterTheData() public view {
        for (uint256 n = 298; n <= 302; n++) {
            bytes memory b = _blob(n);
            bytes32 next;
            assembly ("memory-safe") {
                next := mload(add(add(b, 0x20), n))
            }
            assertTrue(next != bytes32(0), "dirty tail");
            assertEq(Base64.encode(b), h.encode(b));
        }
    }

    function testFuzz_traitsStayInTheirRanges(uint256 seat, uint16 round, uint16 edition) public view {
        SeatTraits memory s = h.seatTraits(seat);
        assertGe(s.span, 1180);
        assertLe(s.span, 1520);
        assertGe(s.rise, 920);
        assertLe(s.rise, 1240);
        assertGe(s.reach, 780);
        assertLe(s.reach, 1040);
        assertGe(s.drop, 840);
        assertLe(s.drop, 1180);
        assertGe(s.veins, 3);
        assertLe(s.veins, 5);
        assertLe(s.spots, 3);
        assertGe(s.dots, 3);
        assertLe(s.dots, 7);
        assertGe(s.rings, 3);
        assertLe(s.rings, 5);
        assertGe(s.tilt, -50);
        assertLe(s.tilt, 50);
        assertLe(s.tone, 3);

        Traits memory t = h.cardTraits(seat, round, edition);
        assertLe(t.form, 3);
        assertLe(t.signal, 3);
        assertGe(t.tilt, -120);
        assertLe(t.tilt, 120);
        assertGe(t.scale, 90);
        assertLe(t.scale, 110);
        assertGe(t.shellW, 85);
        assertLe(t.shellW, 120);
        assertGe(t.shellL, 92);
        assertLe(t.shellL, 110);
        assertGe(t.wingW, 80);
        assertLe(t.wingW, 120);
        assertLe(t.wingW, (t.shellW * 110 + 50) / 100);
        assertGe(t.wingL, 90);
        assertLe(t.wingL, 108);
        assertLe(t.density, 2);
        assertLe(t.halo, 3);
        assertLe(t.palette, 3);
        assertGe(t.bandW, 80);
        assertLe(t.bandW, 115);
        assertGe(t.rings, 2);
        assertLe(t.rings, 5);
        assertLe(t.orbitDeg, 3600);
        uint256[4] memory deltas = [t.dSpan, t.dRise, t.dReach, t.dDrop];
        for (uint256 k; k < 4; k++) {
            assertGe(deltas[k], 88);
            assertLe(deltas[k], 112);
        }
        assertGe(t.dVeins, -1);
        assertLe(t.dVeins, 1);
        assertGe(t.dSpots, -1);
        assertLe(t.dSpots, 1);
        assertEq(t.tier, _tier(edition));
    }

    // ---- helpers

    function _seat(uint256 seat, SeatTraits memory want) internal view {
        SeatTraits memory got = h.seatTraits(seat);
        assertEq(got.span, want.span, "span");
        assertEq(got.rise, want.rise, "rise");
        assertEq(got.reach, want.reach, "reach");
        assertEq(got.drop, want.drop, "drop");
        assertEq(got.veins, want.veins, "veins");
        assertEq(got.spots, want.spots, "spots");
        assertEq(got.dots, want.dots, "dots");
        assertEq(got.rings, want.rings, "rings");
        assertEq(got.tilt, want.tilt, "tilt");
        assertEq(got.tone, want.tone, "tone");
    }

    function _siteIntegers(uint256 seat, uint8 veins, uint8 spots, uint8 dots, uint8 rings, uint8 toneIndex)
        internal
        view
    {
        SeatTraits memory got = h.seatTraits(seat);
        assertEq(got.veins, veins, "veins");
        assertEq(got.spots, spots, "spots");
        assertEq(got.dots, dots, "dots");
        assertEq(got.rings, rings, "rings");
        assertEq(got.tone, toneIndex, "tone");
    }

    function _card(uint256 seat, uint16 round, uint16 edition, Traits memory want) internal view {
        Traits memory got = h.cardTraits(seat, round, edition);
        assertEq(got.form, want.form, "form");
        assertEq(got.signal, want.signal, "signal");
        assertEq(got.tilt, want.tilt, "tilt");
        assertEq(got.scale, want.scale, "scale");
        assertEq(got.shellW, want.shellW, "shellW");
        assertEq(got.shellL, want.shellL, "shellL");
        assertEq(got.wingW, want.wingW, "wingW");
        assertEq(got.wingL, want.wingL, "wingL");
        assertEq(got.density, want.density, "density");
        assertEq(got.halo, want.halo, "halo");
        assertEq(got.palette, want.palette, "palette");
        assertEq(got.bandW, want.bandW, "bandW");
        assertEq(got.rings, want.rings, "rings");
        assertEq(got.orbitDeg, want.orbitDeg, "orbitDeg");
        assertEq(got.dSpan, want.dSpan, "dSpan");
        assertEq(got.dRise, want.dRise, "dRise");
        assertEq(got.dReach, want.dReach, "dReach");
        assertEq(got.dDrop, want.dDrop, "dDrop");
        assertEq(got.dVeins, want.dVeins, "dVeins");
        assertEq(got.dSpots, want.dSpots, "dSpots");
        assertEq(got.tier, want.tier, "tier");
    }

    function _colours(uint8 palette, bool gilt, uint8 toneIndex, Colours memory want) internal view {
        Colours memory got = h.colours(palette, gilt, toneIndex);
        assertEq(got.shell, want.shell, "shell");
        assertEq(got.inner, want.inner, "inner");
        assertEq(got.wing, want.wing, "wing");
        assertEq(got.wing2, want.wing2, "wing2");
        assertEq(got.vein, want.vein, "vein");
        assertEq(got.band, want.band, "band");
        assertEq(got.glow, want.glow, "glow");
        assertEq(got.spots, want.spots, "spots");
        assertEq(got.body, want.body, "body");
    }

    function _density(uint8 density, uint256 outer, uint256 inner, uint256 dots) internal view {
        (uint256 o, uint256 n, uint256 d) = h.densityOf(density);
        assertEq(o, outer, "outer");
        assertEq(n, inner, "inner");
        assertEq(d, dots, "dots");
    }

    function _sin(uint256 t, bool neg, uint256 mag) internal view {
        (bool n, uint256 m) = h.sinCircle(t);
        assertEq(n, neg, "sign");
        assertEq(m, mag, "magnitude");
    }

    function _weights(uint16[4] memory got, uint16[4] memory want) internal pure {
        for (uint256 k; k < 4; k++) {
            assertEq(got[k], want[k], "weight");
        }
    }

    function _capped(uint256 seat, uint16 round, uint16 edition) internal view {
        Traits memory t = h.cardTraits(seat, round, edition);
        uint256 draw = uint256(h.between(h.word(h.seed(seat, round, edition, 7), 6), 80, 120, 1));
        uint256 cap = (t.shellW * 110 + 50) / 100;
        assertGt(draw, cap, "the draw is above the cap");
        assertEq(t.wingW, cap, "wingW is the cap");
    }

    /// Holotype for edition 1, paratype for 2..33, series otherwise (edition 0 included).
    function _tier(uint16 edition) internal pure returns (uint8) {
        if (edition == 1) return 0;
        if (edition >= 2 && edition <= 33) return 1;
        return 2;
    }

    /// keccak256(abi.encode(uint256 j)) for j = 0..9, cut in place to n bytes (the mirror's `blob`).
    function _blob(uint256 n) internal pure returns (bytes memory b) {
        for (uint256 j; j < 10; j++) {
            b = bytes.concat(b, keccak256(abi.encode(j)));
        }
        assembly ("memory-safe") {
            mstore(b, n)
        }
    }

    function _prefix(bytes memory run, uint256 n) internal pure returns (bytes memory out) {
        out = new bytes(n);
        for (uint256 k; k < n; k++) {
            out[k] = run[k];
        }
    }
}
