// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20Minimal} from "./interfaces/IERC20Minimal.sol";

/// @notice Holds the developer's PUPATE and releases it in a straight line over `DURATION` from
/// `START`. Tokens sent later join the same curve. Anyone may trigger a release; it always pays
/// the beneficiary.
contract PupateVesting {
    error ZeroAddress();
    error BadSchedule();
    error NotBeneficiary();
    error TransferFailed();

    event Released(uint256 amount);
    event BeneficiarySet(address beneficiary);

    IERC20Minimal public immutable TOKEN;
    uint64 public immutable START;
    uint64 public immutable DURATION;

    address public beneficiary;
    uint256 public released;

    constructor(IERC20Minimal token, address beneficiary_, uint64 start, uint64 duration) {
        if (address(token) == address(0) || beneficiary_ == address(0)) revert ZeroAddress();
        if (duration == 0) revert BadSchedule();
        TOKEN = token;
        START = start;
        DURATION = duration;
        beneficiary = beneficiary_;
        emit BeneficiarySet(beneficiary_);
    }

    /// @notice Everything vested so far, released or not.
    function vested() public view returns (uint256) {
        uint256 total = TOKEN.balanceOf(address(this)) + released;
        if (block.timestamp < START) return 0;
        if (block.timestamp >= uint256(START) + DURATION) return total;
        return total * (block.timestamp - START) / DURATION;
    }

    function releasable() public view returns (uint256) {
        return vested() - released;
    }

    /// @notice Pays the beneficiary whatever has vested and not been released. Does nothing if
    /// that is zero.
    function release() external {
        uint256 amount = releasable();
        if (amount == 0) return;
        released += amount;
        if (!TOKEN.transfer(beneficiary, amount)) revert TransferFailed();
        emit Released(amount);
    }

    function setBeneficiary(address to) external {
        if (msg.sender != beneficiary) revert NotBeneficiary();
        if (to == address(0)) revert ZeroAddress();
        beneficiary = to;
        emit BeneficiarySet(to);
    }
}
