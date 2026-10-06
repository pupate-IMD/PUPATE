// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {OracleAttestation} from "./oracle/OracleAttestation.sol";

/// @notice Latest Identity MD floor price, as attested by the IMD oracle for one fixed question.
contract FloorFeed {
    error NotOwner();
    error ZeroAddress();
    error OutOfBounds();
    error BadSigner();
    error WrongQuestion();
    error WrongChain();
    error NoQuorum();
    error Expired();
    error NotNewer();
    error BadAnswer();
    error MoveTooLarge();

    event Reported(uint256 floorWei, uint64 issuedAt, uint64 freshUntil);
    event AttesterSet(address attester);
    event MaxAgeSet(uint64 maxAge);
    event OwnershipTransferred(address indexed from, address indexed to);

    uint256 public constant MAX_MOVE_BPS = 2500;
    uint64 public constant MIN_MAX_AGE = 1 hours;
    uint64 public constant MAX_MAX_AGE = 24 hours;

    bytes32 public immutable QUESTION_HASH;

    address public owner;
    address public attester;
    uint64 public maxAge = 6 hours;

    uint256 public floorWei;
    uint64 public issuedAt;
    uint64 public expiresAt;

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address owner_, address attester_, bytes32 questionHash_) {
        if (owner_ == address(0) || attester_ == address(0)) revert ZeroAddress();
        owner = owner_;
        attester = attester_;
        QUESTION_HASH = questionHash_;
    }

    /// @notice Store a new floor report. Callable by anyone holding a valid attestation.
    function report(OracleAttestation.Attestation calldata a, bytes calldata sig) external {
        bytes32 sep = OracleAttestation.domainSeparator(block.chainid, address(this));
        if (OracleAttestation.recover(OracleAttestation.digest(sep, a), sig) != attester) revert BadSigner();
        if (a.questionHash != QUESTION_HASH) revert WrongQuestion();
        if (a.chainId != block.chainid) revert WrongChain();
        if (a.agreed < a.quorum || a.quorum == 0) revert NoQuorum();
        if (a.issuedAt > block.timestamp || block.timestamp > a.expiresAt) revert Expired();
        if (block.timestamp > uint256(a.issuedAt) + maxAge) revert Expired();
        if (a.issuedAt <= issuedAt) revert NotNewer();
        if (a.answerType != OracleAttestation.ANSWER_TYPE_UINT256 || a.answer.length != 32) {
            revert BadAnswer();
        }
        uint256 next = abi.decode(a.answer, (uint256));
        if (next == 0) revert BadAnswer();

        if (_fresh()) {
            uint256 prev = floorWei;
            uint256 band = (prev * MAX_MOVE_BPS) / 10_000;
            if (next > prev + band || next < prev - band) revert MoveTooLarge();
        }

        floorWei = next;
        issuedAt = a.issuedAt;
        expiresAt = a.expiresAt;
        emit Reported(next, a.issuedAt, _freshUntil());
    }

    /// @return floorWei_ the last reported floor, and whether it is still fresh.
    function latest() external view returns (uint256 floorWei_, bool fresh) {
        return (floorWei, _fresh());
    }

    function setAttester(address attester_) external onlyOwner {
        if (attester_ == address(0)) revert ZeroAddress();
        attester = attester_;
        emit AttesterSet(attester_);
    }

    function setMaxAge(uint64 maxAge_) external onlyOwner {
        if (maxAge_ < MIN_MAX_AGE || maxAge_ > MAX_MAX_AGE) revert OutOfBounds();
        maxAge = maxAge_;
        emit MaxAgeSet(maxAge_);
    }

    function transferOwnership(address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, to);
        owner = to;
    }

    function _freshUntil() private view returns (uint64) {
        uint64 byAge = issuedAt + maxAge;
        return byAge < expiresAt ? byAge : expiresAt;
    }

    function _fresh() private view returns (bool) {
        return issuedAt != 0 && block.timestamp <= _freshUntil();
    }
}
