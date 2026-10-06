// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {FullMath} from "v4-core/src/libraries/FullMath.sol";
import {OracleAttestation} from "./oracle/OracleAttestation.sol";

/// @notice Latest reference price of the Identity MD collection, as attested by the IMD oracle for one
/// pinned question.
/// @dev The stored price may rise by at most MAX_RISE_BPS per RISE_WINDOW between two reports, measured
/// between their issue times and applied whether or not the earlier report is still fresh. Falls are
/// not limited: a lower reference only makes the vault buy less. The first report after the question
/// is set is not limited either.
contract FloorFeed {
    error NotOwner();
    error ZeroAddress();
    error OutOfBounds();
    error BadSigner();
    error WrongQuestion();
    error WrongChain();
    error NoQuorum();
    error ShortLived();
    error Expired();
    error NotNewer();
    error BadAnswer();
    error MoveTooLarge();

    event Reported(uint256 floorWei, uint64 issuedAt, uint64 freshUntil);
    event AttesterSet(address attester);
    event MaxAgeSet(uint64 maxAge);
    event QuestionSet(bytes32 questionHash);
    event OwnershipTransferred(address indexed from, address indexed to);

    uint256 public constant BPS = 10_000;
    /// @notice The stored price may rise by at most this share per RISE_WINDOW.
    uint256 public constant MAX_RISE_BPS = 2500;
    uint256 public constant RISE_WINDOW = 6 hours;
    uint64 public constant MIN_MAX_AGE = 1 hours;
    uint64 public constant MAX_MAX_AGE = 24 hours;
    /// @notice Smallest panel quorum accepted. The quorum must also be a majority of the panel.
    uint16 public constant MIN_QUORUM = 4;

    /// @notice The chain whose sales the question reads. Attestations name it in `chainId`.
    uint256 public immutable EVIDENCE_CHAIN_ID;

    address public owner;
    address public attester;
    /// @notice Hash of the only oracle question whose attestations are accepted. Zero until set.
    bytes32 public questionHash;
    /// @notice How long a report stays fresh after it was issued.
    uint64 public maxAge = 6 hours;

    uint256 public floorWei;
    uint64 public issuedAt;
    uint64 public expiresAt;

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address owner_, address attester_, uint256 evidenceChainId_) {
        if (owner_ == address(0) || attester_ == address(0)) revert ZeroAddress();
        if (evidenceChainId_ == 0) revert WrongChain();
        owner = owner_;
        attester = attester_;
        EVIDENCE_CHAIN_ID = evidenceChainId_;
        emit OwnershipTransferred(address(0), owner_);
    }

    /// @notice Store a new report. Callable by anyone holding a valid attestation.
    function report(OracleAttestation.Attestation calldata a, bytes calldata sig) external {
        bytes32 sep = OracleAttestation.domainSeparator(block.chainid, address(this));
        if (OracleAttestation.recover(OracleAttestation.digest(sep, a), sig) != attester) revert BadSigner();
        bytes32 pinned = questionHash;
        if (pinned == bytes32(0) || a.questionHash != pinned) revert WrongQuestion();
        if (a.chainId != EVIDENCE_CHAIN_ID) revert WrongChain();
        if (
            a.quorum < MIN_QUORUM || uint256(a.quorum) * 2 <= a.panelSize || a.agreed < a.quorum
                || a.agreed > a.panelSize
        ) revert NoQuorum();
        // A report must stay valid for at least the freshness window, so a short-lived attestation
        // cannot cut a good report short. With that, "past its own expiry" cannot happen on arrival.
        uint64 age = maxAge;
        if (a.expiresAt < a.issuedAt || a.expiresAt - a.issuedAt < age) revert ShortLived();
        if (a.issuedAt > block.timestamp || block.timestamp > uint256(a.issuedAt) + age) revert Expired();
        uint64 previousIssuedAt = issuedAt;
        if (a.issuedAt <= previousIssuedAt) revert NotNewer();
        if (a.answerType != OracleAttestation.ANSWER_TYPE_UINT256 || a.answer.length != 32) {
            revert BadAnswer();
        }
        uint256 next = abi.decode(a.answer, (uint256));
        if (next == 0) revert BadAnswer();

        uint256 prev = floorWei;
        if (previousIssuedAt != 0 && next > prev) {
            uint256 gap = a.issuedAt - previousIssuedAt;
            uint256 allowedRise = FullMath.mulDiv(prev, MAX_RISE_BPS * gap, RISE_WINDOW * BPS);
            if (next - prev > allowedRise) revert MoveTooLarge();
        }

        floorWei = next;
        issuedAt = a.issuedAt;
        expiresAt = a.expiresAt;
        emit Reported(next, a.issuedAt, _freshUntil());
    }

    /// @return floorWei_ the last reported price, and whether it is still fresh.
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

    /// @notice Pin the oracle question. Its hash is only known once the first request has been made.
    /// @dev Clears the stored report, so the next one is not rate-limited. Setting the same hash
    /// again is the way to clear a bad value.
    function setQuestion(bytes32 questionHash_) external onlyOwner {
        if (questionHash_ == bytes32(0)) revert WrongQuestion();
        questionHash = questionHash_;
        delete floorWei;
        delete issuedAt;
        delete expiresAt;
        emit QuestionSet(questionHash_);
        emit Reported(0, 0, 0);
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
