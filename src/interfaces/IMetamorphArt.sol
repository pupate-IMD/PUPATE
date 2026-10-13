// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice What Metamorph MD hands its art contract for one card, and what it gets back: the whole
/// token URI (JSON with the image inside), so the card contract carries no drawing or JSON code.
interface IMetamorphArt {
    struct View {
        uint256 id;
        uint256 seat;
        uint16 round;
        uint16 edition;
        /// 0 chrysalis, 1 butterfly
        uint8 stage;
        bool gilt;
        uint16 epoch;
        address miner;
        uint40 mintedAt;
        /// the mint price paid, in PUPATE wei
        uint256 paid;
    }

    function tokenURI(View calldata v) external view returns (string memory);
}
