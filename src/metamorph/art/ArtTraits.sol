// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Colours, SeatTraits, Traits} from "../../interfaces/IMetamorphFigure.sol";

/// @title ArtTraits
/// @notice The deterministic foundation of the Metamorph MD art: keccak seeds, 32-bit words, fixed-point draws
/// rounded half up, weighted picks, digit strings, the number formatter, the site's seat generator, the seat
/// and card traits, the palette and the density table. Everything is internal and pure: no owner, no setter,
/// no storage. `script/art/mirror.mjs` is the JavaScript twin and the tests pin both to the same vectors.
/// @dev Fixed point: lengths in tenths, factors in hundredths, angles in tenths of a degree.
library ArtTraits {
    // The brand constants.
    string internal constant PAPER = "#0b1410";
    string internal constant INK = "#e9e6da";
    string internal constant DIM = "#9aa89f";
    string internal constant HAIR = "#223029";
    string internal constant JADE = "#3ec28f";
    string internal constant GOLD = "#d9a94b";

    // ------------------------------------------------------------------ determinism

    /// @notice The seed of one use of a card: line 7 is the card traits, line 11 the drawing, and the
    /// prototype's `seed + k` is line 11000 + k. Never the miner, the price or the time.
    function seed(uint256 seat, uint16 round, uint16 edition, uint256 line) internal pure returns (bytes32) {
        return keccak256(abi.encode(seat, round, edition, line));
    }

    /// @notice The k-th 32-bit word of a seed, eight per hash, the lowest first.
    function word(bytes32 s, uint256 k) internal pure returns (uint32) {
        return uint32(uint256(keccak256(abi.encode(s, k / 8))) >> (32 * (k % 8)));
    }

    /// lo + u * (hi - lo) in `unit`ths, rounded half up.
    /// @dev Tenths take the prototype's bounds and unit 10 (118..152 is `between(u, 118, 152, 10)`); a factor in
    /// hundredths takes its bounds in hundredths and unit 1 (0.85..1.2 is `between(u, 85, 120, 1)`).
    function between(uint32 u_, int256 lo, int256 hi, uint256 unit) internal pure returns (int256) {
        return lo * int256(unit) + int256((uint256(u_) * uint256(hi - lo) * unit + (1 << 31)) >> 32);
    }

    /// @notice floor(u * n / 2^32): the prototype's `Math.floor(r() * n)`.
    function count(uint32 u_, uint256 n) internal pure returns (uint256) {
        return (uint256(u_) * n) >> 32;
    }

    /// @notice A weighted pick: the index into four weights summing to 100 (a three-entry table ends in a
    /// zero weight).
    function pick(uint32 u_, uint16[4] memory w) internal pure returns (uint8) {
        uint256 x = (uint256(u_) * 100) >> 32;
        for (uint8 k; k < 4; k++) {
            if (x < w[k]) return k;
            x -= w[k];
        }
        return 3;
    }

    /// @notice The first n bits of keccak256(abi.encode(s, line)), then of keccak256(abi.encode(s, line, 1)),
    /// (..., 2) and so on, most significant bit first, as the characters 0 and 1.
    function bits(bytes32 s, uint256 line, uint256 n) internal pure returns (string memory) {
        bytes memory out = new bytes(n);
        uint256 h;
        for (uint256 k; k < n; k++) {
            if (k % 256 == 0) {
                h = k == 0
                    ? uint256(keccak256(abi.encode(s, line)))
                    : uint256(keccak256(abi.encode(s, line, k / 256)));
            }
            out[k] = ((h >> (255 - (k % 256))) & 1) == 1 ? bytes1("1") : bytes1("0");
        }
        return string(out);
    }

    /// Tenths as the prototype's f1 prints them: -12.3, 12, 0, -0.4.
    function f1(int256 tenths) internal pure returns (string memory) {
        bool neg = tenths < 0;
        uint256 a = uint256(neg ? -tenths : tenths);
        string memory whole = u(a / 10);
        string memory s = a % 10 == 0 ? whole : string.concat(whole, ".", u(a % 10));
        return neg ? string.concat("-", s) : s;
    }

    /// @notice An unsigned integer in decimal.
    function u(uint256 x) internal pure returns (string memory) {
        if (x == 0) return "0";
        uint256 len;
        for (uint256 y = x; y != 0; y /= 10) {
            len++;
        }
        bytes memory out = new bytes(len);
        for (; x != 0; x /= 10) {
            out[--len] = bytes1(uint8(48 + x % 10));
        }
        return string(out);
    }

    /// @notice A signed integer in decimal: "-" for a negative one, no sign for zero.
    function i(int256 x) internal pure returns (string memory) {
        if (x >= 0) return u(uint256(x));
        unchecked {
            // -x wraps for type(int256).min, whose two's complement read as a uint256 is its magnitude.
            return string.concat("-", u(uint256(-x)));
        }
    }

    // ------------------------------------------------------------------ the seat

    /// @notice Per seat: the site's generator (site/lib/seat.ts) in uint32 arithmetic, drawn in the site's
    /// order: span, rise, reach, drop (tenths), veins, spots, dots, rings, tilt (tenths of a degree), tone. The
    /// site divides each 32-bit draw by 2^32; the integers here equal the site's for every seat.
    function seatTraits(uint256 seat) internal pure returns (SeatTraits memory st) {
        uint32[10] memory d;
        unchecked {
            uint32 a = uint32(seat * 2654435761);
            for (uint256 k; k < 10; k++) {
                a += 0x6d2b79f5;
                uint32 t = a;
                t = (t ^ (t >> 15)) * (t | 1);
                t ^= t + ((t ^ (t >> 7)) * (t | 61));
                d[k] = t ^ (t >> 14);
            }
        }
        st.span = between(d[0], 118, 152, 10);
        st.rise = between(d[1], 92, 124, 10);
        st.reach = between(d[2], 78, 104, 10);
        st.drop = between(d[3], 84, 118, 10);
        st.veins = uint8(3 + count(d[4], 3));
        st.spots = uint8(count(d[5], 4));
        st.dots = uint8(3 + count(d[6], 5));
        st.rings = uint8(3 + count(d[7], 3));
        st.tilt = between(d[8], -5, 5, 10);
        st.tone = uint8(count(d[9], 4));
    }

    // ------------------------------------------------------------------ the card

    /// @notice The weight tables `cardTraits` draws with, the main spec's, verbatim, named once so that the
    /// tests run the pick boundaries on these very tables. Each sums to 100; the palette has no gilt entry
    /// (gilt comes from the proof, never from the seed).
    function formWeights() internal pure returns (uint16[4] memory) {
        return [uint16(40), 22, 22, 16]; // teardrop, pear, spindle, round
    }

    function signalWeights() internal pure returns (uint16[4] memory) {
        return [uint16(45), 25, 20, 10]; // none, column, band, rain
    }

    function densityWeights() internal pure returns (uint16[4] memory) {
        return [uint16(30), 50, 20, 0]; // fine, standard, bold
    }

    function haloWeights() internal pure returns (uint16[4] memory) {
        return [uint16(50), 30, 15, 5]; // none, ring, double, orbit
    }

    function paletteWeights() internal pure returns (uint16[4] memory) {
        return [uint16(58), 20, 12, 10]; // classic, inverted, ember, mono
    }

    /// @notice Per edition: seed line 7, one word per draw (picks and counts included), words 0, 1, 2, ... in
    /// the spec's order, the picks on the tables above.
    function cardTraits(uint256 seat, uint16 round, uint16 edition) internal pure returns (Traits memory t) {
        bytes32 s = seed(seat, round, edition, 7);
        t.form = pick(word(s, 0), formWeights());
        t.signal = pick(word(s, 1), signalWeights());
        t.tilt = between(word(s, 2), -12, 12, 10);
        t.scale = uint256(between(word(s, 3), 90, 110, 1));
        t.shellW = uint256(between(word(s, 4), 85, 120, 1));
        t.shellL = uint256(between(word(s, 5), 92, 110, 1));
        // min(0.8..1.2, shellW * 1.1), the cap rounded half up
        uint256 wing = uint256(between(word(s, 6), 80, 120, 1));
        uint256 cap = (t.shellW * 110 + 50) / 100;
        t.wingW = wing < cap ? wing : cap;
        t.wingL = uint256(between(word(s, 7), 90, 108, 1));
        t.density = pick(word(s, 8), densityWeights());
        t.halo = pick(word(s, 9), haloWeights());
        t.palette = pick(word(s, 10), paletteWeights());
        t.bandW = uint256(between(word(s, 11), 80, 115, 1));
        t.rings = uint8(2 + count(word(s, 12), 4));
        t.orbitDeg = uint256(between(word(s, 13), 0, 360, 10));
        t.dSpan = uint256(between(word(s, 14), 88, 112, 1));
        t.dRise = uint256(between(word(s, 15), 88, 112, 1));
        t.dReach = uint256(between(word(s, 16), 88, 112, 1));
        t.dDrop = uint256(between(word(s, 17), 88, 112, 1));
        t.dVeins = int8(uint8(count(word(s, 18), 3))) - 1;
        t.dSpots = int8(uint8(count(word(s, 19), 3))) - 1;
        // holotype (0) for edition 1, paratype (1) for 2..33, series (2) otherwise, edition 0 included
        if (edition >= 2 && edition <= 33) t.tier = 1;
        else if (edition != 1) t.tier = 2;
    }

    // ------------------------------------------------------------------ the palette

    /// @notice The seat's jade, one of four; an index past 3 reads as the first (the brand's jade).
    function tone(uint8 index) internal pure returns (string memory) {
        if (index == 1) return "#2aa87a";
        if (index == 2) return "#5fd0a3";
        if (index == 3) return "#37b59a";
        return "#3ec28f";
    }

    /// @notice The prototype's colours(palette, tone) table. A gilt card takes the prototype's gilt row
    /// whatever its palette; a palette past 3 reads as classic (the prototype's default branch).
    function colours(uint8 palette, bool gilt, uint8 toneIndex) internal pure returns (Colours memory) {
        string memory t = tone(toneIndex);
        if (gilt) {
            return Colours({
                shell: GOLD,
                inner: GOLD,
                wing: t,
                wing2: t,
                vein: t,
                band: INK,
                glow: GOLD,
                spots: INK,
                body: GOLD
            });
        }
        if (palette == 1) {
            // inverted
            return Colours({
                shell: t,
                inner: t,
                wing: INK,
                wing2: INK,
                vein: INK,
                band: GOLD,
                glow: t,
                spots: GOLD,
                body: INK
            });
        }
        if (palette == 2) {
            // ember
            return Colours({
                shell: INK,
                inner: INK,
                wing: GOLD,
                wing2: GOLD,
                vein: GOLD,
                band: t,
                glow: GOLD,
                spots: t,
                body: INK
            });
        }
        if (palette == 3) {
            // mono
            return Colours({
                shell: INK,
                inner: INK,
                wing: INK,
                wing2: INK,
                vein: INK,
                band: GOLD,
                glow: INK,
                spots: GOLD,
                body: INK
            });
        }
        // classic
        return Colours({
            shell: INK, inner: INK, wing: t, wing2: t, vein: t, band: GOLD, glow: t, spots: GOLD, body: INK
        });
    }

    /// @notice Font sizes in tenths and the glow dot count: fine 1.9 / 1.2 / 12, standard 2.3 / 1.5 / 26,
    /// bold 2.8 / 1.8 / 42; a density past 2 reads as bold.
    function densityOf(uint8 density) internal pure returns (uint256 outer, uint256 inner, uint256 dots) {
        if (density == 0) return (19, 12, 12);
        if (density == 1) return (23, 15, 26);
        return (28, 18, 42);
    }
}
