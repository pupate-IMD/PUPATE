// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice The part of ERC-20 that Cocoon uses.
interface IERC20Minimal {
    function balanceOf(address owner) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}
