// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {OracleAttestation} from "../src/oracle/OracleAttestation.sol";

contract OracleAttestationTest is Test {
    address constant REAL_SIGNER = 0x5598Aa9146215Bc13eb26f2c692Ad1461Fd32982;
    address constant REAL_CONSUMER = 0x37Bfb8AC7C960E558657871D41Ca70E07e7DbfFf;
    bytes constant REAL_SIG =
        hex"bfd589bb67b89a4f2a44bfcd689d7eb10309c1cf1e84fa42c417c162a7baf2a91fdd5e18ef891b9ae9f63882fdb3dc1e14e2bd13305b984afcf0ceb0059acfe01c";

    function _real(uint8 answerType) internal pure returns (OracleAttestation.Attestation memory a) {
        a.requestId = 0x094326048c1a44078d8d6c66d775667900000000000000000000000000000000;
        a.chainId = 1;
        a.questionHash = 0x39eecf277118e4219d50e4352a2fcf943cf802239c546d54dd4baba53c72d787;
        a.answerType = answerType;
        a.answer = hex"00000000000000000000000000000000000000000000000000000000d588b5a0";
        a.figure = 0;
        a.fromBlock = 26122900;
        a.toBlock = 26122901;
        a.blockHash = 0x22cd78830715d67d27849123a084fe3b854a1af74b40cd7f73c727399eef3059;
        a.panelJobId = 0x4d78f9ab3839475ab2993602d0501de500000000000000000000000000000000;
        a.panelSize = 5;
        a.quorum = 4;
        a.agreed = 4;
        a.issuedAt = 1791254782;
        a.expiresAt = 1791276382;
    }

    /// Finds which uint8 the oracle signs for the "uint256" answer type.
    function test_discoverAnswerType() public pure {
        bytes32 sep = OracleAttestation.domainSeparator(1, REAL_CONSUMER);
        for (uint8 t = 0; t < 32; t++) {
            if (OracleAttestation.recover(OracleAttestation.digest(sep, _real(t)), REAL_SIG) == REAL_SIGNER) {
                console2.log("answerType for uint256 =", t);
                return;
            }
        }
        revert("no answerType in 0..31 recovers the real signer");
    }

    function test_realAttestationRecoversRealSigner() public pure {
        bytes32 sep = OracleAttestation.domainSeparator(1, REAL_CONSUMER);
        bytes32 d = OracleAttestation.digest(sep, _real(OracleAttestation.ANSWER_TYPE_UINT256));
        assertEq(OracleAttestation.recover(d, REAL_SIG), REAL_SIGNER);
    }

    function test_differentConsumerDoesNotRecoverRealSigner() public pure {
        bytes32 sep = OracleAttestation.domainSeparator(1, address(0xBEEF));
        bytes32 d = OracleAttestation.digest(sep, _real(OracleAttestation.ANSWER_TYPE_UINT256));
        assertTrue(OracleAttestation.recover(d, REAL_SIG) != REAL_SIGNER);
    }
}
