// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Colours, IMetamorphFigure, SeatTraits, Traits} from "../../interfaces/IMetamorphFigure.sol";
import {ArtTraits} from "./ArtTraits.sol";

/// @title MetamorphButterfly
/// @notice The butterfly figure of a Metamorph MD card: the prototype's `butterflyStage`, minimal layout, drawn
/// in integer tenths. The seat's wings (span, rise, reach, drop) scaled by the edition's deltas; one half of the
/// figure with its three digit washes, its vein rays and its spots, then the same half mirrored; the antennae,
/// the head and the body with its fourteen digits. No state, no owner, no setter: `figure` is pure.
/// `script/art/mirror.mjs` (`butterflyFigure`) is its twin, byte for byte.
/// @dev Lengths and font sizes in tenths, factors in hundredths, the tilt in tenths of a degree; a seat length
/// times its edition's delta (thousandths of a unit) is carried unrounded. Every printed coordinate, size and
/// length is the integer product of all its factors divided once, at the end, rounded half up on its magnitude
/// (`_mulDiv`); a coordinate below zero is its base minus a rounded magnitude. The vein angles are tenths of a
/// degree, their sines and cosines interpolated between the whole degrees of `ArtTraits.sines`
/// (`ArtTraits.sinT`) and carried unrounded into the endpoint's one division. Drawn for the traits
/// `ArtTraits` gives: a seat length below zero is outside them, and the unsigned arithmetic then reverts.
contract MetamorphButterfly is IMetamorphFigure {
    /// The prototype's MONO, the figure's font.
    string private constant MONO = "Consolas, 'Courier New', monospace";

    /// @notice The butterfly `<g>` of a card from its traits, its seat's traits, its colours and its drawing seed
    /// (line 11).
    function figure(Traits calldata t, SeatTraits calldata s, Colours calldata c, bytes32 seed)
        external
        pure
        returns (string memory)
    {
        // The seat's geometry scaled by the edition's deltas, unrounded: tenths × hundredths.
        uint256 span = uint256(s.span) * t.dSpan;
        uint256 rise = uint256(s.rise) * t.dRise;
        uint256 drop = uint256(s.drop) * t.dDrop;
        string memory half = _half(t, s, c, seed, span, rise, drop);
        return string.concat(
            _open(t.tilt, t.scale),
            _defs(_upper(span, rise), _lower(uint256(s.reach) * t.dReach, drop)),
            string.concat(half, '<g transform="scale(-1 1)">', half, "</g>\n"),
            _body(c.body, seed)
        );
    }

    /// The prototype's group, minimal layout: translate(540 584 + 12) rotate(tilt) scale(2.2 × scale), the font.
    function _open(int256 tilt, uint256 scale) private pure returns (string memory) {
        return string.concat(
            '<g transform="translate(540 596) rotate(',
            ArtTraits.f1(tilt),
            ") scale(",
            _f(_mulDiv(22, scale, 100)),
            ')" font-family="',
            MONO,
            '">\n'
        );
    }

    /// The defs: the upper wing, the lower wing, the inner upper wing (the upper one at 0.82 from (4, -6)), the
    /// two wings again as the veins' clip paths, and the body's axis.
    function _defs(string memory upper, string memory lower) private pure returns (string memory) {
        return string.concat(
            string.concat('<defs><path id="up" d="', upper, '"/><path id="lo" d="', lower, '"/>'),
            string.concat('<path id="up2" transform="translate(4 -6) scale(0.82)" d="', upper, '"/>\n'),
            string.concat('<clipPath id="cu"><path d="', upper, '"/></clipPath>'),
            string.concat('<clipPath id="cl"><path d="', lower, '"/></clipPath>'),
            '<path id="body" d="M0 -36V40"/></defs>\n'
        );
    }

    /// The prototype's upper wing from (4, -22): 4 + k × span across and -22 - k × rise up, k in hundredths.
    function _upper(uint256 span, uint256 rise) private pure returns (string memory) {
        return string.concat(
            string.concat(
                "M4 -22C", _plus(40, span, 45), " ", _minus(220, rise, 100), " ", _plus(40, span, 100)
            ),
            string.concat(" ", _minus(220, rise, 95), " ", _plus(40, span, 100), " ", _minus(220, rise, 30)),
            string.concat("C", _plus(40, span, 98), " -4 ", _plus(40, span, 55), " 16 4 10Z")
        );
    }

    /// The prototype's lower wing from (4, 10): 4 + k × reach across and 10 + k × drop down, k in hundredths.
    function _lower(uint256 reach, uint256 drop) private pure returns (string memory) {
        return string.concat(
            string.concat(
                "M4 10C", _plus(40, reach, 90), " 6 ", _plus(40, reach, 110), " ", _plus(100, drop, 60)
            ),
            string.concat(" ", _plus(40, reach, 50), " ", _plus(100, drop, 100), "C", _plus(40, reach, 25)),
            string.concat(" ", _plus(100, drop, 92), " 10 ", _plus(100, drop, 50), " 4 30Z")
        );
    }

    /// One half of the figure: the three digit washes, the veins and the spots. The veins and the spots are the
    /// seat's counts plus the edition's deltas, clamped to 2..6 and 0..4.
    function _half(
        Traits calldata t,
        SeatTraits calldata s,
        Colours calldata c,
        bytes32 seed,
        uint256 span,
        uint256 rise,
        uint256 drop
    ) private pure returns (string memory) {
        return string.concat(
            "<g>",
            _washes(t.density, c, seed),
            _veins(_clamp(int256(uint256(s.veins)) + t.dVeins, 2, 6), span, drop, c.vein),
            _spots(_clamp(int256(uint256(s.spots)) + t.dSpots, 0, 4), span, rise, c.spots),
            "</g>"
        );
    }

    /// The three digit washes, sized by the density: the upper wing's at outer × 3.9, the lower wing's at outer ×
    /// 3.7, the inner upper wing's at inner × 3.7. The prototype's bits(seed + k, n) is line 11000 + k.
    function _washes(uint8 density, Colours calldata c, bytes32 seed) private pure returns (string memory) {
        (uint256 outer, uint256 inner,) = ArtTraits.densityOf(density);
        return string.concat(
            _wash(_mulDiv(outer, 39, 10), c.wing, "", "0.6", "up", ArtTraits.bits(seed, 11011, 120)),
            _wash(_mulDiv(outer, 37, 10), c.wing, "", "0.6", "lo", ArtTraits.bits(seed, 11012, 100)),
            _wash(
                _mulDiv(inner, 37, 10),
                c.inner,
                ' opacity="0.35"',
                "0.5",
                "up2",
                ArtTraits.bits(seed, 11013, 140)
            )
        );
    }

    /// A digit wash: a digit string on a wing path, its size in tenths; `more` is an attribute with its leading
    /// space, or nothing.
    function _wash(
        uint256 size,
        string calldata fill,
        string memory more,
        string memory spacing,
        string memory href,
        string memory digits
    ) private pure returns (string memory) {
        return string.concat(
            string.concat(
                '<text font-size="', _f(size), '" fill="', fill, '"', more, ' letter-spacing="', spacing
            ),
            string.concat('"><textPath href="#', href, '">', digits, "</textPath></text>")
        );
    }

    /// The vein rays: `n` upper ones from (6, -8) at `_angle(i, n)`, span × 0.92 long, clipped to the upper wing;
    /// three lower ones from (6, 16) at 22, 48 and 74 degrees (tenths: 220, 480, 740), drop × 0.9 long, clipped
    /// to the lower wing. A length is carried unrounded into the ray (span × 92: its tenths are that over 10000).
    function _veins(uint256 n, uint256 span, uint256 drop, string calldata stroke)
        private
        pure
        returns (string memory s)
    {
        uint16[91] memory sines = ArtTraits.sines();
        for (uint256 i; i < n; i++) {
            s = string.concat(s, _vein(_ray(sines, 60, -80, _angle(i, n), span * 92), stroke, "cu"));
        }
        int256[3] memory lower = [int256(220), 480, 740];
        for (uint256 k; k < 3; k++) {
            s = string.concat(s, _vein(_ray(sines, 60, 160, lower[k], drop * 90), stroke, "cl"));
        }
    }

    /// A vein: a ray stroked in the vein's colour, clipped to a wing.
    function _vein(string memory d, string calldata stroke, string memory clip)
        private
        pure
        returns (string memory)
    {
        return string.concat(
            '<path d="',
            d,
            '" stroke="',
            stroke,
            '" stroke-width="0.9" fill="none" opacity="0.55" clip-path="url(#',
            clip,
            ')"/>'
        );
    }

    /// The prototype's ray, "Mx yLx' y'": from (x, y) in tenths at an angle a in tenths of a degree (-900..900),
    /// its length len / 10000 tenths (len the unrounded product of its factors). The end is x + cos(a) × len and
    /// y + sin(a) × len, each offset one product of the interpolated sine (`ArtTraits.sinT`,
    /// hundred-thousandths) and len divided once by 10^9, its magnitude rounded half up; cos(a) =
    /// sin(90° - |a|) is never negative, and the sign of the angle goes on the rounded y offset.
    function _ray(uint16[91] memory sines, int256 x, int256 y, int256 a, uint256 len)
        private
        pure
        returns (string memory)
    {
        uint256 m = uint256(a < 0 ? -a : a);
        int256 dx = int256(_mulDiv(ArtTraits.sinT(sines, 900 - m), len, 1e9));
        int256 dy = int256(_mulDiv(ArtTraits.sinT(sines, m), len, 1e9));
        return string.concat(
            string.concat("M", ArtTraits.f1(x), " ", ArtTraits.f1(y)),
            string.concat("L", ArtTraits.f1(x + dx), " ", ArtTraits.f1(a < 0 ? y - dy : y + dy))
        );
    }

    /// The angle of upper vein i of n (n >= 2, after the clamp) in tenths of a degree: -62 + 70 × i / (n - 1)
    /// degrees, its 700 × i / (n - 1) tenths one product divided once (-38.67° is -387, -44.5° is -445).
    function _angle(uint256 i, uint256 n) internal pure returns (int256) {
        return int256(_mulDiv(700, i, n - 1)) - 620;
    }

    /// The spots: spot i at 4 + span × (0.8 - 0.07 i) across and -22 - rise × 0.62 + 17 i down, its radius
    /// 5 - 0.6 i.
    function _spots(uint256 n, uint256 span, uint256 rise, string calldata fill)
        private
        pure
        returns (string memory s)
    {
        for (uint256 i; i < n; i++) {
            s = string.concat(s, _spot(i, span, rise, fill));
        }
    }

    /// Spot i: the across and down coordinates each one product divided once; the radius 50 - 6i tenths.
    function _spot(uint256 i, uint256 span, uint256 rise, string calldata fill)
        private
        pure
        returns (string memory)
    {
        return string.concat(
            string.concat('<circle cx="', _f(40 + _mulDiv(span, 80 - 7 * i, 10000)), '" cy="'),
            string.concat(ArtTraits.f1(-220 - int256(_mulDiv(rise, 62, 10000)) + int256(170 * i)), '" r="'),
            string.concat(_f(50 - 6 * i), '" fill="', fill, '"/>')
        );
    }

    /// The antennae and their tips, the head, the body, and the body's fourteen digits in the paper's colour.
    function _body(string calldata fill, bytes32 seed) private pure returns (string memory) {
        return string.concat(
            string.concat(
                '<path d="M-2 -52C-8 -76 -22 -90 -32 -93M2 -52C8 -76 22 -90 32 -93" stroke="',
                fill,
                '" stroke-width="1.4" fill="none" stroke-linecap="round"/>\n'
            ),
            string.concat(
                '<circle cx="-32" cy="-93" r="2.2" fill="',
                fill,
                '"/><circle cx="32" cy="-93" r="2.2" fill="',
                fill,
                '"/>\n<circle cx="0" cy="-48" r="6.5" fill="',
                fill,
                '"/><ellipse cx="0" cy="2" rx="5.5" ry="44" fill="'
            ),
            string.concat(
                fill,
                '"/>\n<text font-size="5.5" fill="',
                ArtTraits.PAPER,
                '" letter-spacing="0.3" writing-mode="tb"><textPath href="#body">',
                ArtTraits.bits(seed, 11014, 14),
                "</textPath></text>\n</g>"
            )
        );
    }

    /// base + k × p in tenths: k hundredths of p (thousandths of a unit), one product divided once by 10000.
    function _plus(uint256 base, uint256 p, uint256 k) private pure returns (string memory) {
        return _f(base + _mulDiv(p, k, 10000));
    }

    /// -base - k × p in tenths: the magnitude rounded half up, then the sign.
    function _minus(uint256 base, uint256 p, uint256 k) private pure returns (string memory) {
        return ArtTraits.f1(-int256(base + _mulDiv(p, k, 10000)));
    }

    /// The prototype's clamp(v, lo, hi), for a count (lo is never negative).
    function _clamp(int256 v, int256 lo, int256 hi) private pure returns (uint256) {
        return uint256(v < lo ? lo : v > hi ? hi : v);
    }

    /// The figure's one rounding, the chrysalis's: the product of the integer factors, divided once by `den`,
    /// rounded half up. Every printed coordinate, size and length goes through it with all of its factors at
    /// once (a factor may itself be an unrounded product, as span × 92); intermediate values are never rounded.
    /// The factors are never negative: a coordinate below zero is its base minus a rounded magnitude. The
    /// mirror's `mulDiv` is the same function.
    function _mulDiv(uint256 a, uint256 b, uint256 den) private pure returns (uint256) {
        return (a * b + den / 2) / den;
    }

    /// Tenths as the prototype's f1 prints them (`ArtTraits.f1`), for a value that is never negative.
    function _f(uint256 tenths) private pure returns (string memory) {
        return ArtTraits.f1(int256(tenths));
    }
}
