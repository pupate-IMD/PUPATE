// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice The part of ERC-721 that Cocoon and Metamorph MD use. `totalSupply` is ERC721Enumerable's, which the
/// identity.md collection answers; only Metamorph MD reads it, for the commons.
interface IERC721Minimal {
    function ownerOf(uint256 tokenId) external view returns (address);
    function totalSupply() external view returns (uint256);
    function balanceOf(address owner) external view returns (uint256);
    function transferFrom(address from, address to, uint256 tokenId) external;
    function safeTransferFrom(address from, address to, uint256 tokenId) external;
    function setApprovalForAll(address operator, bool approved) external;
    function isApprovedForAll(address owner, address operator) external view returns (bool);
}
