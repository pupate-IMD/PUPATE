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
/// product rounds half up on its magnitude, `(a × b + 50) / 100`. Drawn for the traits `ArtTraits.cardTraits`
/// gives (a form past 3 reads as the teardrop); a trait far outside its range can take a coordinate below
/// zero, and the unsigned arithmetic then reverts.
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
            _f(_m(66, scale)),
            ') translate(-32 -52)" font-family="',
            MONO,
            '" letter-spacing="0.25">'
        );
    }

    /// The prototype's shellDefs: the shell; the inner shell at 0.86 / 0.93 from 11 + 2.5 × shellL; the wing;
    /// the inner wing at 0.73 / 0.82 from 34; the band, bandW × BAND_FIT × shellW wide; the vein, 44 × wingL.
    function _defs(Traits calldata t) private pure returns (string memory) {
        (uint256[12] memory p, uint256 fit) = _form(t.form);
        return string.concat(
            string.concat(
                '<defs><path id="shell" d="',
                _shell(p, t.shellW, t.shellL, 110),
                '"/><path id="shell2" d="',
                _shell(p, _m(t.shellW, 86), _m(t.shellL, 93), 110 + _m(25, t.shellL))
            ),
            string.concat(
                '"/><path id="wing" d="',
                _wing(t.wingW, t.wingL, 300),
                '"/><path id="wing2" d="',
                _wing(_m(t.wingW, 73), _m(t.wingL, 82), 340),
                '"/><path id="band" d="',
                _band(_m(_m(t.bandW, fit), t.shellW)),
                '"/><path id="vein" d="M32 30v',
                _f(_m(440, t.wingL)),
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
    /// point on the axis, the right side back up in two cubics. w and L in hundredths, top in tenths.
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
            _c(_pt(true, p[6], w, p[7], L, top), _pt(true, p[8], w, p[9], L, top), _axis(top + _d(p[11], L)))
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

    /// The prototype's wingPath: the folded wing's fixed control points, ww across and wl down from `top`.
    function _wing(uint256 ww, uint256 wl, uint256 top) private pure returns (string memory) {
        string memory down = string.concat(
            _c(_pt(true, 9, ww, 10, wl, top), _pt(true, 13, ww, 24, wl, top), _pt(true, 8, ww, 44, wl, top)),
            _c(_pt(true, 4, ww, 38, wl, top), _pt(true, 1, ww, 31, wl, top), _axis(top + _d(24, wl)))
        );
        string memory up = string.concat(
            _c(
                _pt(false, 1, ww, 31, wl, top), _pt(false, 4, ww, 38, wl, top), _pt(false, 8, ww, 44, wl, top)
            ),
            _c(_pt(false, 13, ww, 24, wl, top), _pt(false, 9, ww, 10, wl, top), _axis(top))
        );
        return string.concat("M32 ", _f(top), down, up, "Z");
    }

    /// The prototype's bandPath: the arc across the shell at y 29, its ends 13 units of w from the axis.
    function _band(uint256 w) private pure returns (string memory) {
        uint256 a = _d(13, w);
        uint256 b = _d(8, w);
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
            _tp("wing", _m(outer, 90), c.wing, ArtTraits.bits(seed, 11003, 130), 'filter="url(#soft)"'),
            _tp("wing2", _m(inner, 95), c.wing2, ArtTraits.bits(seed, 11004, 140), 'opacity="0.55"'),
            _tp("vein", _m(inner, 105), c.vein, ArtTraits.bits(seed, 11005, 40), 'opacity="0.8"'),
            _tp("band", _m(outer, 95), c.band, ArtTraits.bits(seed, 11006, 30), "")
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

    /// The prototype's segmentRings: ring j at y = 11 + (53 + 7j) × shellL, (14 − 3j) × shellW to each side.
    function _rings(uint8 rings, uint256 shellW, uint256 shellL, string memory stroke)
        private
        pure
        returns (string memory s)
    {
        for (uint256 j; j < rings; j++) {
            uint256 w = _m(140 - 30 * j, shellW);
            s = string.concat(
                s,
                string.concat('<path d="M', _f(320 - w), " ", _f(110 + _m(530 + 70 * j, shellL)), "q", _f(w)),
                string.concat(" 4 ", _f(2 * w), ' 0" stroke="', stroke, '" stroke-width="0.5" fill="none"'),
                ' opacity="0.45" stroke-dasharray="0.8 1.2"/>'
            );
        }
    }

    /// The prototype's gold tick, moved down to the end of the vein: translate(0 tickY − 73) with
    /// tickY = 30 + 44 × wingL − 1; its offsets are 7.5, 2, 4.8, 2.7 and 5.5 × wingW.
    function _tick(uint256 wingW, uint256 wingL, string memory stroke) private pure returns (string memory) {
        uint256 tickY = 300 + _m(440, wingL) - 10;
        return string.concat(
            string.concat(
                '<path transform="translate(0 ',
                ArtTraits.f1(int256(tickY) - 730),
                ')" d="M',
                _f(320 - _m(75, wingW)),
                " 73c",
                _f(_m(20, wingW)),
                "-3.6 ",
                _f(_m(48, wingW))
            ),
            string.concat("-6.6 ", _f(_m(75, wingW)), "-9.4 ", _f(_m(27, wingW)), " 2.8 ", _f(_m(55, wingW))),
            string.concat(
                " 5.8 ", _f(_m(75, wingW)), ' 9.4" stroke="', stroke, '" stroke-width="0.9" fill="none"'
            ),
            ' stroke-linecap="round"/>'
        );
    }

    /// "Ca b c": a cubic curve through the control points a and b to c.
    function _c(string memory a, string memory b, string memory c) private pure returns (string memory) {
        return string.concat("C", a, " ", b, " ", c);
    }

    /// "x y": the point k units of w across the axis x = 32 (left of it when `left`) and j units of L below
    /// `top`: x = 320 ∓ (k × w × 10 + 50) / 100, y = top + (j × L × 10 + 50) / 100, in tenths.
    function _pt(bool left, uint256 k, uint256 w, uint256 j, uint256 L, uint256 top)
        private
        pure
        returns (string memory)
    {
        uint256 dx = _d(k, w);
        return string.concat(_f(left ? 320 - dx : 320 + dx), " ", _f(top + _d(j, L)));
    }

    /// "32 y": the point at height y on the axis.
    function _axis(uint256 y) private pure returns (string memory) {
        return string.concat("32 ", _f(y));
    }

    /// (a × b + 50) / 100: a times a factor b in hundredths, rounded half up (a and b are never negative).
    function _m(uint256 a, uint256 b) private pure returns (uint256) {
        return (a * b + 50) / 100;
    }

    /// (k × w × 10 + 50) / 100: k units of a factor w (hundredths), in tenths, rounded half up.
    function _d(uint256 k, uint256 w) private pure returns (uint256) {
        return (k * w * 10 + 50) / 100;
    }

    /// Tenths as the prototype's f1 prints them (`ArtTraits.f1`), for a value that is never negative.
    function _f(uint256 tenths) private pure returns (string memory) {
        return ArtTraits.f1(int256(tenths));
    }
}
