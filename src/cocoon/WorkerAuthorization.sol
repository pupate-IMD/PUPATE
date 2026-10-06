// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice IMD's pairing message. The network pairs a device to a seat by verifying an EIP-712
/// signature over this struct from the seat's holder, and accepts ERC-1271 when the holder is a
/// contract. The domain is bound to the collection, not to the holder.
library WorkerAuthorization {
    struct Auth {
        bytes32 deviceKey;
        address wallet;
        uint256 tokenId;
        bytes32 nonce;
        uint64 expiresAt;
        string relayOrigin;
    }

    bytes32 internal constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 internal constant NAME_HASH = keccak256("IdentityMD Worker");
    bytes32 internal constant VERSION_HASH = keccak256("2");
    bytes32 internal constant TYPEHASH = keccak256(
        "WorkerAuthorization(bytes32 deviceKey,address wallet,uint256 tokenId,bytes32 nonce,uint64 expiresAt,string relayOrigin)"
    );

    function domainSeparator(address collection) internal view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, collection));
    }

    /// @notice The digest IMD verifies for `a`, as signed by the holder of a seat in `collection`.
    function digest(address collection, Auth memory a) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                TYPEHASH,
                a.deviceKey,
                a.wallet,
                a.tokenId,
                a.nonce,
                a.expiresAt,
                keccak256(bytes(a.relayOrigin))
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(collection), structHash));
    }
}
