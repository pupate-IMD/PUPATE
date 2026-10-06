// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Where PupateHook delivers the tax it collects.
interface ITaxSink {
    /// @notice Accept tax in ETH.
    function depositTax() external payable;
}
