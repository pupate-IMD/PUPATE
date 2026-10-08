// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {FloorFeed} from "../../src/FloorFeed.sol";
import {OracleAttestation} from "../../src/oracle/OracleAttestation.sol";

/// @notice LOCAL ONLY. Signs a floor attestation with a local attester key and submits it to FloorFeed,
/// the way `test/fork/CocoonSeaport.fork.t.sol::_report` does: EIP-712 over
/// `OracleAttestation.domainSeparator(block.chainid, feed)`, a uint256 answer, a panel of 5 with quorum
/// 4 and 4 agreed, the evidence chain the feed was built with, issued now and valid for 24 hours. On
/// mainnet this is what IMD's oracle signs; here the attester is anvil account #9.
///
/// Environment:
///   FEED           the FloorFeed from DeployPreLaunch (its question must already be pinned)
///   ATTESTER_KEY   private key of the feed's attester
///   FLOOR_WEI      the floor to report (default 2.8 ether)
///   ISSUED_AT      unix time of the attestation (default now; each report must be newer than the last)
contract ReportLocal is Script {
    function run() external {
        FloorFeed feed = FloorFeed(vm.envAddress("FEED"));
        uint256 attesterKey = vm.envUint("ATTESTER_KEY");
        uint256 floorWei = vm.envOr("FLOOR_WEI", uint256(2.8 ether));
        uint64 issuedAt = uint64(vm.envOr("ISSUED_AT", block.timestamp));
        require(vm.addr(attesterKey) == feed.attester(), "ATTESTER_KEY is not the feed's attester");
        require(feed.questionHash() != bytes32(0), "question not pinned yet (run PostLaunch first)");

        OracleAttestation.Attestation memory a;
        a.requestId = keccak256(abi.encode("pupate-local", issuedAt));
        a.chainId = feed.EVIDENCE_CHAIN_ID();
        a.questionHash = feed.questionHash();
        a.answerType = OracleAttestation.ANSWER_TYPE_UINT256;
        a.answer = abi.encode(floorWei);
        a.fromBlock = uint64(block.number > 7200 ? block.number - 7200 : 0); // about 24 hours of blocks
        a.toBlock = uint64(block.number);
        a.blockHash = blockhash(block.number - 1);
        a.panelJobId = keccak256(abi.encode("pupate-local-panel", issuedAt));
        a.panelSize = 5;
        a.quorum = 4;
        a.agreed = 4;
        a.issuedAt = issuedAt;
        a.expiresAt = issuedAt + 24 hours;

        bytes32 sep = OracleAttestation.domainSeparator(block.chainid, address(feed));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(attesterKey, OracleAttestation.digest(sep, a));

        vm.startBroadcast();
        feed.report(a, abi.encodePacked(r, s, v));
        vm.stopBroadcast();

        (uint256 latest, bool fresh) = feed.latest();
        console2.log("FloorFeed         ", address(feed));
        console2.log("reported floorWei ", latest);
        console2.log("fresh             ", fresh);
        console2.log("issuedAt          ", uint256(issuedAt));
    }
}
