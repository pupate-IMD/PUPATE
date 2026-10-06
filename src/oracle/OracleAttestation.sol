// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice EIP-712 encoding of an IMD oracle attestation.
library OracleAttestation {
    struct Attestation {
        bytes32 requestId;
        uint256 chainId;
        bytes32 questionHash;
        uint8 answerType;
        bytes answer;
        uint256 figure;
        uint64 fromBlock;
        uint64 toBlock;
        bytes32 blockHash;
        bytes32 panelJobId;
        uint16 panelSize;
        uint16 quorum;
        uint16 agreed;
        uint64 issuedAt;
        uint64 expiresAt;
    }

    error BadSignatureLength();
    error BadSignatureS();

    // Confirmed against a live attestation: the oracle signs 3 for a "uint256" answer.
    uint8 internal constant ANSWER_TYPE_UINT256 = 3;

    bytes32 internal constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 internal constant NAME_HASH = keccak256("IdentityMD Oracle");
    bytes32 internal constant VERSION_HASH = keccak256("2");
    bytes32 internal constant TYPEHASH = keccak256(
        "OracleAttestation(bytes32 requestId,uint256 chainId,bytes32 questionHash,uint8 answerType,bytes answer,uint256 figure,uint64 fromBlock,uint64 toBlock,bytes32 blockHash,bytes32 panelJobId,uint16 panelSize,uint16 quorum,uint16 agreed,uint64 issuedAt,uint64 expiresAt)"
    );
    // secp256k1n / 2; signatures with a larger s are malleable and rejected.
    uint256 private constant HALF_N = 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    function domainSeparator(uint256 chainId, address verifyingContract) internal pure returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, chainId, verifyingContract));
    }

    function digest(bytes32 domainSep, Attestation memory a) internal pure returns (bytes32) {
        // Encoded in two halves to stay within the stack limit without via_ir.
        bytes memory head = abi.encode(
            TYPEHASH,
            a.requestId,
            a.chainId,
            a.questionHash,
            a.answerType,
            keccak256(a.answer),
            a.figure,
            a.fromBlock
        );
        bytes memory tail = abi.encode(
            a.toBlock, a.blockHash, a.panelJobId, a.panelSize, a.quorum, a.agreed, a.issuedAt, a.expiresAt
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSep, keccak256(bytes.concat(head, tail))));
    }

    function recover(bytes32 digest_, bytes memory sig) internal pure returns (address) {
        if (sig.length != 65) revert BadSignatureLength();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(sig, 0x20))
            s := mload(add(sig, 0x40))
            v := byte(0, mload(add(sig, 0x60)))
        }
        if (uint256(s) > HALF_N) revert BadSignatureS();
        return ecrecover(digest_, v, r, s);
    }
}
