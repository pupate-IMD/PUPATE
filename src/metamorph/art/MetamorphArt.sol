// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IMetamorphArt} from "../../interfaces/IMetamorphArt.sol";
import {Colours, IMetamorphFigure, SeatTraits, Traits} from "../../interfaces/IMetamorphFigure.sol";
import {ArtTraits} from "./ArtTraits.sol";
import {Base64} from "./Base64.sol";

/// @title MetamorphArt
/// @notice The art behind Metamorph MD: a card's whole token URI from the card's facts alone. It derives the
/// traits, draws the frame (the grid, the edge, the corners, the notes, the signal, the halo, the glow dots),
/// places the figure of the card's stage (drawn by `CHRYSALIS` or `BUTTERFLY`), writes the labels, and wraps
/// the SVG and the attributes in JSON, each in base64: the prototype's `renderCard` with the minimal labels.
/// No state but the two figures, fixed at deployment; no owner, no setter. `script/art/mirror.mjs`
/// (`renderSVG`, `tokenJSON`, `tokenURI`) is its twin, byte for byte.
/// @dev The digits come from the drawing seed S = seed(seat, round, edition, 11): the halo rings' from line
/// 11000 + R, the notes' from 11100 + i, the signal's from 11200 + x + y (the prototype's seed + k is line
/// 11000 + k); the rain's runs and the glow dots are placed by the words of seeds 11300 and 11050. Every
/// printed number is an integer, or one product of its factors divided once, rounded half up on its magnitude
/// (`_mulDiv`), the sign put on after. The miner, the price, the epoch and the time never reach the picture.
contract MetamorphArt is IMetamorphArt {
    /// @notice The figure of a chrysalis (stage 0) and of a butterfly (stage 1; a larger stage reads as the
    /// butterfly).
    IMetamorphFigure public immutable CHRYSALIS;
    IMetamorphFigure public immutable BUTTERFLY;

    error ZeroAddress();

    /// The prototype's MONO, the font of the digits and the labels.
    string private constant MONO = "Consolas, 'Courier New', monospace";

    /// The SVG's opening: the 1080 × 1080 canvas, the two filters (glow and soft, the prototype's lines and
    /// indentation verbatim), the paper.
    string private constant HEAD = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1080" width="1080" height="1080">\n<defs>\n'
        '  <filter id="glow" x="-200%" y="-200%" width="500%" height="500%"><feGaussianBlur stdDeviation="1.6"/></filter>\n'
        '  <filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="0.6"/></filter>\n'
        '</defs>\n<rect width="1080" height="1080" fill="#0b1410"/>\n';

    bytes16 private constant HEX = "0123456789abcdef";

    constructor(IMetamorphFigure chrysalis, IMetamorphFigure butterfly) {
        if (address(chrysalis) == address(0) || address(butterfly) == address(0)) revert ZeroAddress();
        CHRYSALIS = chrysalis;
        BUTTERFLY = butterfly;
    }

    /// @notice The card's token URI: `data:application/json;base64,` and the JSON in base64.
    function tokenURI(View calldata v) external view returns (string memory) {
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json(v))));
    }

    /// @notice The card's JSON: the name, the description, the SVG as a base64 data URI, and the attributes
    /// in the spec's order (numbers bare, strings quoted).
    function json(View calldata v) public view returns (string memory) {
        Traits memory t = ArtTraits.cardTraits(v.seat, v.round, v.edition);
        SeatTraits memory st = ArtTraits.seatTraits(v.seat);
        return string.concat(
            _head(v),
            Base64.encode(bytes(_svg(v, t, st))),
            '","attributes":[',
            _facts(v),
            _looks(t, st.tone, v.gilt),
            "]}"
        );
    }

    /// @notice The card's SVG, 1080 × 1080.
    function svg(View calldata v) public view returns (string memory) {
        return _svg(v, ArtTraits.cardTraits(v.seat, v.round, v.edition), ArtTraits.seatTraits(v.seat));
    }

    // ------------------------------------------------------------------ the SVG

    /// The prototype's order: the head, then the grid, the edge, the corners, the notes, the signal, the halo
    /// and the glow dots on one line, the figure, the labels.
    function _svg(View calldata v, Traits memory t, SeatTraits memory st)
        private
        view
        returns (string memory)
    {
        Colours memory c = ArtTraits.colours(t.palette, v.gilt, st.tone);
        bytes32 s = ArtTraits.seed(v.seat, v.round, v.edition, 11);
        return string.concat(
            HEAD,
            _back(v, t, c.glow, s),
            "\n",
            (v.stage == 0 ? CHRYSALIS : BUTTERFLY).figure(t, st, c, s),
            "\n",
            _labels(v),
            "\n</svg>"
        );
    }

    /// Everything behind the figure. The notes only on a chrysalis without a halo.
    function _back(View calldata v, Traits memory t, string memory glow, bytes32 s)
        private
        pure
        returns (string memory)
    {
        return string.concat(
            string.concat(
                _grid(), _edge(t.tier), _corner(t.tier), t.halo == 0 && v.stage == 0 ? _notes(s) : ""
            ),
            string.concat(
                _signal(v, t.signal, s), _halo(t.halo, t.orbitDeg, glow, s), _dots(v, t.density, glow)
            )
        );
    }

    /// The grid: a hairline both ways every 60 px, 60..1020.
    function _grid() private pure returns (string memory out) {
        for (uint256 i = 60; i < 1080; i += 60) {
            string memory n = ArtTraits.u(i);
            out = string.concat(
                out,
                '<path d="M',
                n,
                " 0V1080M0 ",
                n,
                'H1080" stroke="#223029" stroke-width="1" opacity="0.45"/>'
            );
        }
    }

    /// The edge: the holotype's double gold frame, a hairline frame otherwise.
    function _edge(uint8 tier) private pure returns (string memory) {
        if (tier == 0) {
            return string.concat(
                '<rect x="48" y="48" width="984" height="984" fill="none" stroke="#d9a94b" stroke-width="3"/>',
                '<rect x="60" y="60" width="960" height="960" fill="none" stroke="#d9a94b" stroke-width="1" opacity="0.6"/>'
            );
        }
        return '<rect x="48" y="48" width="984" height="984" fill="none" stroke="#223029" stroke-width="2"/>';
    }

    /// The corners: the paratype's gold corner at the bottom right and its ink one at the top left, the two
    /// ink corners otherwise.
    function _corner(uint8 tier) private pure returns (string memory) {
        if (tier == 1) {
            return string.concat(
                '<path d="M1032 1002V1032H1002" fill="none" stroke="#d9a94b" stroke-width="4"/>',
                '<path d="M48 78V48H78" fill="none" stroke="#e9e6da" stroke-width="4"/>'
            );
        }
        return '<path d="M48 78V48H78M1032 1002V1032H1002" fill="none" stroke="#e9e6da" stroke-width="4"/>';
    }

    /// The notes: nine dashed lines 56 apart from y 300, each labelled with six digits of line 11100 + i.
    function _notes(bytes32 s) private pure returns (string memory out) {
        for (uint256 i; i < 9; i++) {
            uint256 y = 300 + i * 56;
            out = string.concat(
                out,
                string.concat(
                    '<path d="M300 ',
                    ArtTraits.u(y),
                    'H780" stroke="#223029" stroke-width="1" stroke-dasharray="2 6"/><text x="792" y="',
                    ArtTraits.u(y + 4)
                ),
                string.concat(
                    '" font-family="',
                    MONO,
                    '" font-size="12" fill="#9aa89f">',
                    ArtTraits.bits(s, 11100 + i, 6),
                    "</text>"
                )
            );
        }
    }

    /// The signal: two columns, two bands, or nine runs of rain; nothing otherwise. The rain's runs are drawn
    /// from the words of seed 11300, three per run in the prototype's order: x = 100 + count(u, 860),
    /// y = 240 + count(u, 420), n = 8 + count(u, 14).
    function _signal(View calldata v, uint8 kind, bytes32 s) private pure returns (string memory out) {
        if (kind == 1) return string.concat(_sig(s, 150, 250, 56, true), _sig(s, 176, 250, 56, true));
        if (kind == 2) return string.concat(_sig(s, 92, 826, 92, false), _sig(s, 92, 844, 92, false));
        if (kind != 3) return "";
        bytes32 rain = ArtTraits.seed(v.seat, v.round, v.edition, 11300);
        for (uint256 k; k < 27; k += 3) {
            uint256 x = 100 + ArtTraits.count(ArtTraits.word(rain, k), 860);
            uint256 y = 240 + ArtTraits.count(ArtTraits.word(rain, k + 1), 420);
            out =
                string.concat(out, _sig(s, x, y, 8 + ArtTraits.count(ArtTraits.word(rain, k + 2), 14), true));
        }
    }

    /// One run of the signal: n digits of line 11200 + x + y at (x, y), turned a quarter about it when
    /// `turned`.
    function _sig(bytes32 s, uint256 x, uint256 y, uint256 n, bool turned)
        private
        pure
        returns (string memory)
    {
        string memory xs = ArtTraits.u(x);
        string memory ys = ArtTraits.u(y);
        return string.concat(
            string.concat('<text x="', xs, '" y="', ys, '" font-family="', MONO),
            '" font-size="13" letter-spacing="1" fill="#9aa89f" opacity="0.5"',
            turned ? string.concat(' transform="rotate(90 ', xs, " ", ys, ')"') : "",
            ">",
            ArtTraits.bits(s, 11200 + x + y, n),
            "</text>"
        );
    }

    /// The halo: one ring of 306 (ring, orbit), two of 292 and 330 (double), and the orbit's dashed circle
    /// and gold dot; nothing otherwise.
    function _halo(uint8 kind, uint256 deg, string memory glow, bytes32 s)
        private
        pure
        returns (string memory out)
    {
        if (kind == 1 || kind == 3) out = _ring(s, 306, "14", 260, glow, "0.5");
        if (kind == 2) {
            out = string.concat(
                _ring(s, 292, "13", 250, glow, "0.5"), _ring(s, 330, "11", 320, ArtTraits.DIM, "0.45")
            );
        }
        if (kind == 3) {
            out = string.concat(
                out,
                '<circle cx="540" cy="584" r="338" fill="none" stroke="#223029" stroke-width="1" stroke-dasharray="3 9"/>',
                _orbitDot(deg)
            );
        }
    }

    /// A halo ring: the circle of radius r round the figure's centre (540, 584) as a path, and n digits of
    /// line 11000 + r written along it.
    function _ring(
        bytes32 s,
        uint256 r,
        string memory size,
        uint256 n,
        string memory fill,
        string memory opacity
    ) private pure returns (string memory) {
        string memory id = ArtTraits.u(r);
        string memory arc = string.concat(id, " ", id, " 0 1 1 ");
        string memory across = ArtTraits.u(2 * r);
        return string.concat(
            string.concat('<path id="h', id, '" d="M', ArtTraits.u(540 - r), " 584a", arc),
            string.concat(across, " 0a", arc, "-", across, ' 0" fill="none"/>'),
            string.concat(
                '<text font-family="', MONO, '" font-size="', size, '" letter-spacing="2" fill="', fill
            ),
            string.concat('" opacity="', opacity, '"><textPath href="#h', id, '">'),
            string.concat(ArtTraits.bits(s, 11000 + r, n), "</textPath></text>")
        );
    }

    /// The orbit's gold dot at deg tenths of a degree on the circle of radius 338 round (540, 584): in
    /// tenths, cx = 5400 ± cos × 338 and cy = 5840 ± sin × 338, each offset one product of the interpolated
    /// sine (`ArtTraits.sinCircle`, hundred-thousandths) and 338 divided once by 10000, its magnitude rounded
    /// half up, the sign put on after.
    function _orbitDot(uint256 deg) private pure returns (string memory) {
        uint16[91] memory table = ArtTraits.sines();
        (bool cosNeg, uint256 cos) = ArtTraits.sinCircle(table, deg + 900);
        (bool sinNeg, uint256 sin) = ArtTraits.sinCircle(table, deg);
        uint256 dx = _mulDiv(cos, 338, 10000);
        uint256 dy = _mulDiv(sin, 338, 10000);
        return string.concat(
            '<circle cx="',
            _f(cosNeg ? 5400 - dx : 5400 + dx),
            '" cy="',
            _f(sinNeg ? 5840 - dy : 5840 + dy),
            '" r="7" fill="#d9a94b"/>'
        );
    }

    /// The glow dots: the density's count, each from four words of seed 11050.
    function _dots(View calldata v, uint8 density, string memory glow)
        private
        pure
        returns (string memory out)
    {
        (,, uint256 n) = ArtTraits.densityOf(density);
        bytes32 d = ArtTraits.seed(v.seat, v.round, v.edition, 11050);
        for (uint256 k; k < 4 * n; k += 4) {
            out = string.concat(out, _dot(d, k, glow));
        }
    }

    /// A glow dot from words k..k + 3, in the prototype's order: x = 90 + count(u, 900),
    /// y = 240 + count(u, 600), the radius 1.5..2.7 and the opacity 0.4..0.8 in tenths.
    function _dot(bytes32 d, uint256 k, string memory glow) private pure returns (string memory) {
        return string.concat(
            string.concat(
                '<circle cx="',
                ArtTraits.u(90 + ArtTraits.count(ArtTraits.word(d, k), 900)),
                '" cy="',
                ArtTraits.u(240 + ArtTraits.count(ArtTraits.word(d, k + 1), 600))
            ),
            string.concat(
                '" r="',
                ArtTraits.f1(ArtTraits.between(ArtTraits.word(d, k + 2), 15, 27, 1)),
                '" fill="',
                glow,
                '" opacity="',
                ArtTraits.f1(ArtTraits.between(ArtTraits.word(d, k + 3), 4, 8, 1)),
                '" filter="url(#glow)"/>'
            )
        );
    }

    /// The labels, minimal: the mark and the number at the top left, the stage at the top right (jade in the
    /// cocoon, gold emerged, " · GILT" after it on a gilt card), the seat and the edition at the bottom. The
    /// newlines, and their absence before the last line, are the prototype's.
    function _labels(View calldata v) private pure returns (string memory) {
        bool emerged = v.stage != 0;
        return string.concat(
            string.concat(
                '<text x="92" y="122" font-family="',
                MONO,
                unicode'" font-size="24" letter-spacing="3" fill="#9aa89f">METAMORPH.MD · PUPATE</text>\n',
                '<text x="92" y="204" font-family="Georgia, \'Times New Roman\', serif" font-size="76" fill="#e9e6da">#',
                ArtTraits.u(v.id),
                "</text>\n"
            ),
            string.concat(
                '<text x="988" y="122" font-family="',
                MONO,
                '" font-size="24" letter-spacing="3" text-anchor="end" fill="',
                emerged ? string(ArtTraits.GOLD) : string(ArtTraits.JADE),
                emerged ? string('">EMERGED') : string('">IN THE COCOON'),
                v.gilt ? string(unicode" · GILT</text>") : string("</text>")
            ),
            string.concat(
                '<text x="92" y="984" font-family="',
                MONO,
                '" font-size="24" letter-spacing="2" fill="#9aa89f">seat identity.md #',
                ArtTraits.u(v.seat),
                unicode" · edition ",
                ArtTraits.u(v.edition),
                " of 303</text>"
            )
        );
    }

    // ------------------------------------------------------------------ the JSON

    /// The name, the description, and the image's data URI up to its base64.
    function _head(View calldata v) private pure returns (string memory) {
        return string.concat(
            string.concat(
                '{"name":"Metamorph.md #', ArtTraits.u(v.id), '","description":"Seat identity.md #'
            ),
            string.concat(ArtTraits.u(v.seat), ", edition ", ArtTraits.u(v.edition), " of 303, "),
            v.stage == 0 ? string("in the cocoon") : string("emerged"),
            v.gilt ? string(", a gilt proof") : string(""),
            '.","image":"data:image/svg+xml;base64,'
        );
    }

    /// The facts: the seat (a string), the round, the edition, the stage, gilt, the epoch, the miner (0x and
    /// forty lowercase hex digits), the price in whole PUPATE rounded down.
    function _facts(View calldata v) private pure returns (string memory) {
        return string.concat(
            string.concat(
                _str("Seat", ArtTraits.u(v.seat)),
                _num("Round", ArtTraits.u(v.round)),
                _num("Edition", ArtTraits.u(v.edition)),
                _str("Stage", v.stage == 0 ? string("Chrysalis") : string("Butterfly"))
            ),
            string.concat(
                _str("Gilt", v.gilt ? string("Yes") : string("No")),
                _num("Epoch", ArtTraits.u(v.epoch)),
                _str("Miner", _hex(v.miner)),
                _num("Price paid (PUPATE)", ArtTraits.u(v.paid / 1e18))
            )
        );
    }

    /// The looks: the tier, the form, the palette (Gilt on a gilt card), the halo, the signal, the density,
    /// the seat's jade; the last attribute closes without a comma.
    function _looks(Traits memory t, uint8 toneIndex, bool gilt) private pure returns (string memory) {
        return string.concat(
            string.concat(
                _str("Tier", _tierName(t.tier)),
                _str("Form", _formName(t.form)),
                _str("Palette", gilt ? string("Gilt") : _paletteName(t.palette)),
                _str("Halo", _haloName(t.halo))
            ),
            string.concat(
                _str("Signal", _signalName(t.signal)),
                _str("Density", _densityName(t.density)),
                '{"trait_type":"Tone","value":"',
                ArtTraits.tone(toneIndex),
                '"}'
            )
        );
    }

    /// A string attribute and a number attribute, each followed by a comma.
    function _str(string memory name, string memory value) private pure returns (string memory) {
        return string.concat('{"trait_type":"', name, '","value":"', value, '"},');
    }

    function _num(string memory name, string memory value) private pure returns (string memory) {
        return string.concat('{"trait_type":"', name, '","value":', value, "},");
    }

    /// An address as 0x and forty lowercase hex digits (no checksum on the chain).
    function _hex(address a) private pure returns (string memory) {
        bytes memory out = new bytes(42);
        out[0] = "0";
        out[1] = "x";
        uint160 x = uint160(a);
        for (uint256 k = 41; k > 1; k--) {
            out[k] = HEX[x & 15];
            x >>= 4;
        }
        return string(out);
    }

    /// The traits' names, with the drawing's fallbacks for a number past the table (never drawn).
    function _tierName(uint8 k) private pure returns (string memory) {
        if (k == 0) return "Holotype";
        if (k == 1) return "Paratype";
        return "Series";
    }

    function _formName(uint8 k) private pure returns (string memory) {
        if (k == 1) return "Pear";
        if (k == 2) return "Spindle";
        if (k == 3) return "Round";
        return "Teardrop";
    }

    function _paletteName(uint8 k) private pure returns (string memory) {
        if (k == 1) return "Inverted";
        if (k == 2) return "Ember";
        if (k == 3) return "Mono";
        return "Classic";
    }

    function _haloName(uint8 k) private pure returns (string memory) {
        if (k == 1) return "Ring";
        if (k == 2) return "Double";
        if (k == 3) return "Orbit";
        return "None";
    }

    function _signalName(uint8 k) private pure returns (string memory) {
        if (k == 1) return "Column";
        if (k == 2) return "Band";
        if (k == 3) return "Rain";
        return "None";
    }

    function _densityName(uint8 k) private pure returns (string memory) {
        if (k == 0) return "Fine";
        if (k == 1) return "Standard";
        return "Bold";
    }

    // ------------------------------------------------------------------ arithmetic

    /// The one rounding, the figures': the product divided once by `den`, rounded half up. The factors are
    /// never negative; a coordinate below its base is the base minus a rounded magnitude.
    function _mulDiv(uint256 a, uint256 b, uint256 den) private pure returns (uint256) {
        return (a * b + den / 2) / den;
    }

    /// Tenths as the prototype's f1 prints them (`ArtTraits.f1`), for a value that is never negative.
    function _f(uint256 tenths) private pure returns (string memory) {
        return ArtTraits.f1(int256(tenths));
    }
}
