// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice A seat's butterfly geometry and jade (`ArtTraits.seatTraits`, the site's generator).
struct SeatTraits {
    int256 span; // tenths
    int256 rise;
    int256 reach;
    int256 drop;
    uint8 veins; // 3..5
    uint8 spots; // 0..3
    uint8 dots; // 3..7
    uint8 rings; // 3..5
    int256 tilt; // tenths of a degree, -50..50
    uint8 tone; // index into the four jades
}

/// @notice One edition's traits (`ArtTraits.cardTraits`, seed line 7).
struct Traits {
    uint8 form; // 0 teardrop, 1 pear, 2 spindle, 3 round
    uint8 signal; // 0 none, 1 column, 2 band, 3 rain
    int256 tilt; // tenths of a degree, -120..120
    uint256 scale; // hundredths, 90..110
    uint256 shellW; // hundredths, 85..120
    uint256 shellL; // hundredths, 92..110
    uint256 wingW; // hundredths, min(80..120, shellW * 110 / 100)
    uint256 wingL; // hundredths, 90..108
    uint8 density; // 0 fine, 1 standard, 2 bold
    uint8 halo; // 0 none, 1 ring, 2 double, 3 orbit
    uint8 palette; // 0 classic, 1 inverted, 2 ember, 3 mono
    uint256 bandW; // hundredths, 80..115
    uint8 rings; // 2..5
    uint256 orbitDeg; // tenths of a degree, 0..3600
    uint256 dSpan; // hundredths, 88..112
    uint256 dRise;
    uint256 dReach;
    uint256 dDrop;
    int8 dVeins; // -1..1
    int8 dSpots; // -1..1
    uint8 tier; // 0 holotype, 1 paratype, 2 series
}

/// @notice The colours a figure is painted with (`ArtTraits.colours`): the palette and the seat's jade.
struct Colours {
    string shell;
    string inner;
    string wing;
    string wing2;
    string vein;
    string band;
    string glow;
    string spots;
    string body;
}

/// @notice A stage's figure: the `<g>` element the art contract places on the card, drawn from the traits,
/// the colours and the card's drawing seed (line 11) alone.
interface IMetamorphFigure {
    function figure(Traits calldata t, SeatTraits calldata s, Colours calldata c, bytes32 seed)
        external
        pure
        returns (string memory);
}
