// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {WorkerAuthorization} from "../../src/cocoon/WorkerAuthorization.sol";

contract WorkerAuthorizationTest is Test {
    address constant COLLECTION = 0x0000eC93127BAA929E58E97dd0095A2BFb38ec1D;

    function _auth() internal pure returns (WorkerAuthorization.Auth memory a) {
        a.deviceKey = keccak256("device");
        a.wallet = address(0xC0C0);
        a.tokenId = 1376;
        a.nonce = keccak256("nonce");
        a.expiresAt = 1_800_000_000;
        a.relayOrigin = "https://api.imd.fun";
    }

    /// @dev Spelled out field by field, so the library's type string and domain are pinned here.
    function _expected(address collection, uint256 chainId, WorkerAuthorization.Auth memory a)
        internal
        pure
        returns (bytes32)
    {
        bytes32 domain = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256("IdentityMD Worker"),
                keccak256("2"),
                chainId,
                collection
            )
        );
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "WorkerAuthorization(bytes32 deviceKey,address wallet,uint256 tokenId,bytes32 nonce,uint64 expiresAt,string relayOrigin)"
                ),
                a.deviceKey,
                a.wallet,
                a.tokenId,
                a.nonce,
                a.expiresAt,
                keccak256(bytes(a.relayOrigin))
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domain, structHash));
    }

    function test_digestMatchesTheSpelledOutEncoding() public view {
        assertEq(
            WorkerAuthorization.digest(COLLECTION, _auth()), _expected(COLLECTION, block.chainid, _auth())
        );
    }

    function test_digestIsBoundToTheCollectionAndTheChain() public {
        bytes32 here = WorkerAuthorization.digest(COLLECTION, _auth());
        assertTrue(WorkerAuthorization.digest(address(0xBEEF), _auth()) != here);

        vm.chainId(1);
        assertEq(WorkerAuthorization.digest(COLLECTION, _auth()), _expected(COLLECTION, 1, _auth()));
        assertTrue(WorkerAuthorization.digest(COLLECTION, _auth()) != here);
    }

    function test_everyFieldChangesTheDigest() public view {
        bytes32 base = WorkerAuthorization.digest(COLLECTION, _auth());
        WorkerAuthorization.Auth memory a;

        a = _auth();
        a.deviceKey = keccak256("other device");
        assertTrue(WorkerAuthorization.digest(COLLECTION, a) != base);
        a = _auth();
        a.wallet = address(0xD0D0);
        assertTrue(WorkerAuthorization.digest(COLLECTION, a) != base);
        a = _auth();
        a.tokenId = 1377;
        assertTrue(WorkerAuthorization.digest(COLLECTION, a) != base);
        a = _auth();
        a.nonce = keccak256("other nonce");
        assertTrue(WorkerAuthorization.digest(COLLECTION, a) != base);
        a = _auth();
        a.expiresAt += 1;
        assertTrue(WorkerAuthorization.digest(COLLECTION, a) != base);
        a = _auth();
        a.relayOrigin = "https://example.com";
        assertTrue(WorkerAuthorization.digest(COLLECTION, a) != base);
    }
}
