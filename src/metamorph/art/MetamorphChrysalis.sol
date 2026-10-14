// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Colours, IMetamorphFigure, SeatTraits, Traits} from "../../interfaces/IMetamorphFigure.sol";
import {ArtTraits} from "./ArtTraits.sol";

/// @title MetamorphChrysalis
/// @notice The chrysalis figure of a Metamorph MD card: the prototype's `chrysalisStage` inside its
/// `figureGroup`, minimal layout, drawn in integer tenths. The shell and the inner shell, the folded wing and
/// the inner wing, the vein and the band carry six digit strings of the drawing seed; then come the segment
/// rings, the gold tick and the stem. No state, no owner, no setter: `figure` is pure.
/// `script/art/mirror.mjs` (`chrysalisFigure`) is its twin, byte for byte.
/// @dev Lengths and font sizes in tenths, factors in hundredths, the tilt in tenths of a degree. Every
/// printed coordinate, size and length is the integer product of all its factors divided once, at the end,
/// rounded half up on its magnitude (`_mulDiv`); intermediate values are never rounded, with one exception:
/// the inner shell's top, 11 + 2.5 × shellL, is rounded to a tenth and printed, and each y value of that
/// shell adds one rounded product to the rounded top. Drawn for the traits `ArtTraits.cardTraits` gives (a
/// form past 3 reads as the teardrop); a trait far outside its range can take a coordinate below zero, and
/// the unsigned arithmetic then reverts.
contract MetamorphChrysalis is IMetamorphFigure {
    /// The prototype's MONO, the figure's font.
    string private constant MONO = "Consolas, 'Courier New', monospace";

    /// @notice The chrysalis `<g>` of a card from its traits, its colours and its drawing seed (line 11); the
    /// seat traits are not used.
    function figure(Traits calldata t, SeatTraits calldata, Colours calldata c, bytes32 seed)
        external
        pure
        returns (string memory)
    {
        return string.concat(
            _open(t.tilt, t.scale),
            _defs(t),
            _texts(t.density, c, seed),
            _rings(t.rings, t.shellW, t.shellL, c.shell),
            _tick(t.wingW, t.wingL, c.band),
            '<path d="M32 2v9" stroke="',
            c.shell,
            '" stroke-width="0.8" fill="none"/></g>'
        );
    }

    /// The prototype's figureGroup, minimal layout: translate(540 584) rotate(tilt) scale(6.6 × scale)
    /// translate(-32 -52), the font and the letter spacing.
    function _open(int256 tilt, uint256 scale) private pure returns (string memory) {
        return string.concat(
            '<g transform="translate(540 584) rotate(',
            ArtTraits.f1(tilt),
            ") scale(",
            _f(_mulDiv(66, scale, 100)),
            ') translate(-32 -52)" font-family="',
            MONO,
            '" letter-spacing="0.25">'
        );
    }

    /// The prototype's shellDefs: the shell; the inner shell at shellW × 0.86, shellL × 0.93 from 11 + 2.5 ×
    /// shellL; the wing; the inner wing at wingW × 0.73, wingL × 0.82 from 34; the band, bandW × BAND_FIT ×
    /// shellW wide; the vein, 44 × wingL. The path factors are carried unrounded: ten-thousandths for the
    /// shells and the wings (the outer ones × 100), millionths for the band.
    function _defs(Traits calldata t) private pure returns (string memory) {
        (uint256[12] memory p, uint256 fit) = _form(t.form);
        return string.concat(
            string.concat(
                '<defs><path id="shell" d="',
                _shell(p, t.shellW * 100, t.shellL * 100, 110),
                '"/><path id="shell2" d="',
                _shell(p, t.shellW * 86, t.shellL * 93, 110 + _mulDiv(25, t.shellL, 100))
            ),
            string.concat(
                '"/><path id="wing" d="',
                _wing(t.wingW * 100, t.wingL * 100, 300),
                '"/><path id="wing2" d="',
                _wing(t.wingW * 73, t.wingL * 82, 340),
                '"/><path id="band" d="',
                _band(t.bandW * fit * t.shellW),
                '"/><path id="vein" d="M32 30v',
                _f(_mulDiv(440, t.wingL, 100)),
                '"/></defs>'
            )
        );
    }

    /// The prototype's FORMS, each form's six [x, y] control points flattened (the left side of the shell
    /// from the top to the bottom point), and its BAND_FIT in hundredths; a form past 3 reads as the
    /// teardrop, the prototype's own path.
    function _form(uint8 form) private pure returns (uint256[12] memory, uint256) {
        if (form == 1) return ([uint256(9), 6, 19, 36, 20, 58, 17, 72, 9, 81, 0, 84], 74); // pear
        if (form == 2) return ([uint256(8), 12, 14, 32, 14, 47, 12, 62, 6, 76, 0, 82], 66); // spindle
        if (form == 3) return ([uint256(20), 8, 23, 40, 17, 62, 12, 74, 6, 80, 0, 82], 105); // round
        return ([uint256(16), 7, 21, 27, 18, 47, 15, 64, 8, 77, 0, 82], 100); // teardrop
    }

    /// The prototype's shellPath: from the top on the axis, the left side down in two cubics to the bottom
    /// point on the axis, the right side back up in two cubics. w and L in ten-thousandths, top in tenths.
    function _shell(uint256[12] memory p, uint256 w, uint256 L, uint256 top)
        private
        pure
        returns (string memory)
    {
        string memory down = string.concat(
            _c(
                _pt(true, p[0], w, p[1], L, top),
                _pt(true, p[2], w, p[3], L, top),
                _pt(true, p[4], w, p[5], L, top)
            ),
            _c(
                _pt(true, p[6], w, p[7], L, top),
                _pt(true, p[8], w, p[9], L, top),
                _axis(top + _mulDiv(p[11], L, 10, 10000))
            )
        );
        string memory up = string.concat(
            _c(
                _pt(false, p[8], w, p[9], L, top),
                _pt(false, p[6], w, p[7], L, top),
                _pt(false, p[4], w, p[5], L, top)
            ),
            _c(_pt(false, p[2], w, p[3], L, top), _pt(false, p[0], w, p[1], L, top), _axis(top))
        );
        return string.concat("M32 ", _f(top), down, up, "Z");
    }

    /// The prototype's wingPath: the folded wing's fixed control points, ww across and wl down from `top`
    /// (ww and wl in ten-thousandths).
    function _wing(uint256 ww, uint256 wl, uint256 top) private pure returns (string memory) {
        string memory down = string.concat(
            _c(_pt(true, 9, ww, 10, wl, top), _pt(true, 13, ww, 24, wl, top), _pt(true, 8, ww, 44, wl, top)),
            _c(
                _pt(true, 4, ww, 38, wl, top),
                _pt(true, 1, ww, 31, wl, top),
                _axis(top + _mulDiv(24, wl, 10, 10000))
            )
        );
        string memory up = string.concat(
            _c(
                _pt(false, 1, ww, 31, wl, top), _pt(false, 4, ww, 38, wl, top), _pt(false, 8, ww, 44, wl, top)
            ),
            _c(_pt(false, 13, ww, 24, wl, top), _pt(false, 9, ww, 10, wl, top), _axis(top))
        );
        return string.concat("M32 ", _f(top), down, up, "Z");
    }

    /// The prototype's bandPath: the arc across the shell at y 29, its ends 13 units of w from the axis (w in
    /// millionths: bandW × BAND_FIT × shellW).
    function _band(uint256 w) private pure returns (string memory) {
        uint256 a = _mulDiv(13, w, 10, 1000000);
        uint256 b = _mulDiv(8, w, 10, 1000000);
        return string.concat(
            "M", _f(320 - a), " 29C", _f(320 - b), " 26.4 ", _f(320 + b), " 26.4 ", _f(320 + a), " 29"
        );
    }

    /// The six digit strings: the prototype's bits(seed + k, n) is line 11000 + k; the sizes are the
    /// density's outer and inner sizes, then 0.9, 0.95, 1.05 and 0.95 of them.
    function _texts(uint8 density, Colours calldata c, bytes32 seed) private pure returns (string memory) {
        (uint256 outer, uint256 inner,) = ArtTraits.densityOf(density);
        return string.concat(
            _tp("shell", outer, c.shell, ArtTraits.bits(seed, 11001, 190), ""),
            _tp("shell2", inner, c.inner, ArtTraits.bits(seed, 11002, 210), 'opacity="0.45"'),
            _tp(
                "wing",
                _mulDiv(outer, 90, 100),
                c.wing,
                ArtTraits.bits(seed, 11003, 130),
                'filter="url(#soft)"'
            ),
            _tp(
                "wing2", _mulDiv(inner, 95, 100), c.wing2, ArtTraits.bits(seed, 11004, 140), 'opacity="0.55"'
            ),
            _tp("vein", _mulDiv(inner, 105, 100), c.vein, ArtTraits.bits(seed, 11005, 40), 'opacity="0.8"'),
            _tp("band", _mulDiv(outer, 95, 100), c.band, ArtTraits.bits(seed, 11006, 30), "")
        );
    }

    /// The prototype's tp: a digit string on a path, its size in tenths. `more` follows a space even when it
    /// is empty, as in the prototype (`fill="…" >`).
    function _tp(string memory href, uint256 size, string memory fill, string memory text, string memory more)
        private
        pure
        returns (string memory)
    {
        return string.concat(
            string.concat('<text font-size="', _f(size), '" fill="', fill, '" ', more),
            string.concat('><textPath href="#', href, '">', text, "</textPath></text>")
        );
    }

    /// The prototype's segmentRings: ring j at y = 11 + (53 + 7j) × shellL, w = (14 − 3j) × shellW to each
    /// side, its arc 2w wide (2 × (14 − 3j) × shellW, rounded once like every printed value).
    function _rings(uint8 rings, uint256 shellW, uint256 shellL, string memory stroke)
        private
        pure
        returns (string memory s)
    {
        for (uint256 j; j < rings; j++) {
            uint256 w = _mulDiv(140 - 30 * j, shellW, 100);
            s = string.concat(
                s,
                string.concat(
                    '<path d="M', _f(320 - w), " ", _f(110 + _mulDiv(530 + 70 * j, shellL, 100)), "q", _f(w)
                ),
                string.concat(
                    " 4 ",
                    _f(_mulDiv(2, 140 - 30 * j, shellW, 100)),
                    ' 0" stroke="',
                    stroke,
                    '" stroke-width="0.5" fill="none"'
                ),
                ' opacity="0.45" stroke-dasharray="0.8 1.2"/>'
            );
        }
    }

    /// The prototype's gold tick, moved down to the end of the vein: translate(0 tickY − 73) with
    /// tickY = 30 + 44 × wingL − 1; its offsets are 7.5, 2, 4.8, 2.7 and 5.5 × wingW.
    function _tick(uint256 wingW, uint256 wingL, string memory stroke) private pure returns (string memory) {
        uint256 tickY = 300 + _mulDiv(440, wingL, 100) - 10;
        return string.concat(
            string.concat(
                '<path transform="translate(0 ',
                ArtTraits.f1(int256(tickY) - 730),
                ')" d="M',
                _f(320 - _mulDiv(75, wingW, 100)),
                " 73c",
                _f(_mulDiv(20, wingW, 100)),
                "-3.6 ",
                _f(_mulDiv(48, wingW, 100))
            ),
            string.concat(
                "-6.6 ",
                _f(_mulDiv(75, wingW, 100)),
                "-9.4 ",
                _f(_mulDiv(27, wingW, 100)),
                " 2.8 ",
                _f(_mulDiv(55, wingW, 100))
            ),
            string.concat(
                " 5.8 ",
                _f(_mulDiv(75, wingW, 100)),
                ' 9.4" stroke="',
                stroke,
                '" stroke-width="0.9" fill="none"'
            ),
            ' stroke-linecap="round"/>'
        );
    }

    /// "Ca b c": a cubic curve through the control points a and b to c.
    function _c(string memory a, string memory b, string memory c) private pure returns (string memory) {
        return string.concat("C", a, " ", b, " ", c);
    }

    /// "x y": the point k units of w across the axis x = 32 (left of it when `left`) and j units of L below
    /// `top`, in tenths: x = 320 ∓ k × w × 10 / 10000 and y = top + j × L × 10 / 10000, each rounded once.
    /// w and L in ten-thousandths.
    function _pt(bool left, uint256 k, uint256 w, uint256 j, uint256 L, uint256 top)
        private
        pure
        returns (string memory)
    {
        uint256 dx = _mulDiv(k, w, 10, 10000);
        return string.concat(_f(left ? 320 - dx : 320 + dx), " ", _f(top + _mulDiv(j, L, 10, 10000)));
    }

    /// "32 y": the point at height y on the axis.
    function _axis(uint256 y) private pure returns (string memory) {
        return string.concat("32 ", _f(y));
    }

    /// The figure's one rounding: the product of the integer factors, divided once by `den` (a power of ten),
    /// rounded half up. Every printed coordinate, size and length goes through it with all of its factors at
    /// once: intermediate values are never rounded (shellW × 0.86 is carried unrounded as shellW × 86), but
    /// for one. The inner shell's top, 11 + 2.5 × shellL (`_defs`), is rounded to a tenth and printed, and
    /// each y value of that shell (`_pt`, `_axis`) adds one rounded product to the rounded top. The factors
    /// are never negative. The mirror's `mulDiv` is the same function.
    function _mulDiv(uint256 a, uint256 b, uint256 den) private pure returns (uint256) {
        return (a * b + den / 2) / den;
    }

    /// The same with three factors.
    function _mulDiv(uint256 a, uint256 b, uint256 c, uint256 den) private pure returns (uint256) {
        return (a * b * c + den / 2) / den;
    }

    /// Tenths as the prototype's f1 prints them (`ArtTraits.f1`), for a value that is never negative.
    function _f(uint256 tenths) private pure returns (string memory) {
        return ArtTraits.f1(int256(tenths));
    }
}
