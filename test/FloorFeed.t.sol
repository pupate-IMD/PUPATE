// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {FloorFeed} from "../src/FloorFeed.sol";
import {OracleAttestation} from "../src/oracle/OracleAttestation.sol";

contract FloorFeedTest is Test {
    uint256 constant ATTESTER_KEY = 0xA11CE;
    bytes32 constant QUESTION = keccak256("floor question");
    uint64 constant T0 = 1_800_000_000;

    address attester;
    address owner = address(0x0A);
    FloorFeed feed;

    function setUp() public {
        attester = vm.addr(ATTESTER_KEY);
        vm.warp(T0);
        feed = new FloorFeed(owner, attester);
        vm.prank(owner);
        feed.setQuestion(QUESTION);
    }

    function _att(uint256 floorWei, uint64 issuedAt)
        internal
        view
        returns (OracleAttestation.Attestation memory a)
    {
        a.requestId = bytes32(uint256(issuedAt));
        a.chainId = block.chainid;
        a.questionHash = QUESTION;
        a.answerType = OracleAttestation.ANSWER_TYPE_UINT256;
        a.answer = abi.encode(floorWei);
        a.panelSize = 5;
        a.quorum = 4;
        a.agreed = 4;
        a.issuedAt = issuedAt;
        a.expiresAt = issuedAt + 6 hours;
    }

    function _sign(OracleAttestation.Attestation memory a, uint256 key, address consumer)
        internal
        view
        returns (bytes memory)
    {
        bytes32 sep = OracleAttestation.domainSeparator(block.chainid, consumer);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, OracleAttestation.digest(sep, a));
        return abi.encodePacked(r, s, v);
    }

    function _report(uint256 floorWei, uint64 issuedAt) internal {
        OracleAttestation.Attestation memory a = _att(floorWei, issuedAt);
        feed.report(a, _sign(a, ATTESTER_KEY, address(feed)));
    }

    function test_startsEmptyAndNotFresh() public view {
        (uint256 floorWei, bool fresh) = feed.latest();
        assertEq(floorWei, 0);
        assertFalse(fresh);
    }

    function test_acceptsValidReport() public {
        _report(2.84 ether, T0);
        (uint256 floorWei, bool fresh) = feed.latest();
        assertEq(floorWei, 2.84 ether);
        assertTrue(fresh);
    }

    function test_reportGoesStaleAfterSixHours() public {
        _report(2 ether, T0);
        vm.warp(T0 + 6 hours + 1);
        (uint256 floorWei, bool fresh) = feed.latest();
        assertEq(floorWei, 2 ether);
        assertFalse(fresh);
    }

    function test_rejectsWrongSigner() public {
        OracleAttestation.Attestation memory a = _att(2 ether, T0);
        bytes memory sig = _sign(a, 0xBAD, address(feed));
        vm.expectRevert(FloorFeed.BadSigner.selector);
        feed.report(a, sig);
    }

    function test_rejectsAttestationForAnotherConsumer() public {
        OracleAttestation.Attestation memory a = _att(2 ether, T0);
        bytes memory sig = _sign(a, ATTESTER_KEY, address(0xBEEF));
        vm.expectRevert(FloorFeed.BadSigner.selector);
        feed.report(a, sig);
    }

    function test_rejectsWrongQuestion() public {
        OracleAttestation.Attestation memory a = _att(2 ether, T0);
        a.questionHash = keccak256("another question");
        bytes memory sig = _sign(a, ATTESTER_KEY, address(feed));
        vm.expectRevert(FloorFeed.WrongQuestion.selector);
        feed.report(a, sig);
    }

    function test_rejectsWrongChain() public {
        OracleAttestation.Attestation memory a = _att(2 ether, T0);
        a.chainId = block.chainid + 1;
        bytes memory sig = _sign(a, ATTESTER_KEY, address(feed));
        vm.expectRevert(FloorFeed.WrongChain.selector);
        feed.report(a, sig);
    }

    function test_rejectsWrongAnswerType() public {
        OracleAttestation.Attestation memory a = _att(2 ether, T0);
        a.answerType = OracleAttestation.ANSWER_TYPE_UINT256 + 1;
        bytes memory sig = _sign(a, ATTESTER_KEY, address(feed));
        vm.expectRevert(FloorFeed.BadAnswer.selector);
        feed.report(a, sig);
    }

    function test_rejectsBelowQuorum() public {
        OracleAttestation.Attestation memory a = _att(2 ether, T0);
        a.agreed = 3;
        bytes memory sig = _sign(a, ATTESTER_KEY, address(feed));
        vm.expectRevert(FloorFeed.NoQuorum.selector);
        feed.report(a, sig);
    }

    function test_rejectsExpired() public {
        OracleAttestation.Attestation memory a = _att(2 ether, T0 - 7 hours);
        bytes memory sig = _sign(a, ATTESTER_KEY, address(feed));
        vm.expectRevert(FloorFeed.Expired.selector);
        feed.report(a, sig);
    }

    function test_rejectsIssuedInTheFuture() public {
        OracleAttestation.Attestation memory a = _att(2 ether, T0 + 1);
        bytes memory sig = _sign(a, ATTESTER_KEY, address(feed));
        vm.expectRevert(FloorFeed.Expired.selector);
        feed.report(a, sig);
    }

    function test_rejectsReplayAndOlderReports() public {
        _report(2 ether, T0);
        OracleAttestation.Attestation memory same = _att(2 ether, T0);
        bytes memory sameSig = _sign(same, ATTESTER_KEY, address(feed));
        vm.expectRevert(FloorFeed.NotNewer.selector);
        feed.report(same, sameSig);

        OracleAttestation.Attestation memory older = _att(2 ether, T0 - 1);
        bytes memory olderSig = _sign(older, ATTESTER_KEY, address(feed));
        vm.expectRevert(FloorFeed.NotNewer.selector);
        feed.report(older, olderSig);
    }

    function test_rejectsZeroAnswer() public {
        OracleAttestation.Attestation memory a = _att(0, T0);
        bytes memory sig = _sign(a, ATTESTER_KEY, address(feed));
        vm.expectRevert(FloorFeed.BadAnswer.selector);
        feed.report(a, sig);
    }

    function test_rejectsAnswerOfWrongLength() public {
        OracleAttestation.Attestation memory a = _att(2 ether, T0);
        a.answer = abi.encodePacked(uint128(2 ether));
        bytes memory sig = _sign(a, ATTESTER_KEY, address(feed));
        vm.expectRevert(FloorFeed.BadAnswer.selector);
        feed.report(a, sig);
    }

    function test_rejectsHighS() public {
        OracleAttestation.Attestation memory a = _att(2 ether, T0);
        bytes32 sep = OracleAttestation.domainSeparator(block.chainid, address(feed));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ATTESTER_KEY, OracleAttestation.digest(sep, a));
        uint256 n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        bytes memory sig = abi.encodePacked(r, bytes32(n - uint256(s)), v == 27 ? uint8(28) : uint8(27));
        vm.expectRevert(OracleAttestation.BadSignatureS.selector);
        feed.report(a, sig);
    }

    function test_rejectsShortSignature() public {
        OracleAttestation.Attestation memory a = _att(2 ether, T0);
        vm.expectRevert(OracleAttestation.BadSignatureLength.selector);
        feed.report(a, hex"1234");
    }

    function test_rejectsMoveAboveCapWhilePreviousIsFresh() public {
        _report(2 ether, T0);
        vm.warp(T0 + 1 hours);
        OracleAttestation.Attestation memory up = _att(2.5 ether + 1, T0 + 1 hours);
        bytes memory upSig = _sign(up, ATTESTER_KEY, address(feed));
        vm.expectRevert(FloorFeed.MoveTooLarge.selector);
        feed.report(up, upSig);

        OracleAttestation.Attestation memory down = _att(1.5 ether - 1, T0 + 1 hours);
        bytes memory downSig = _sign(down, ATTESTER_KEY, address(feed));
        vm.expectRevert(FloorFeed.MoveTooLarge.selector);
        feed.report(down, downSig);

        (uint256 floorWei,) = feed.latest();
        assertEq(floorWei, 2 ether);
    }

    function test_acceptsMoveAtExactlyTheCap() public {
        _report(2 ether, T0);
        vm.warp(T0 + 1 hours);
        _report(2.5 ether, T0 + 1 hours);
        vm.warp(T0 + 2 hours);
        _report(1.875 ether, T0 + 2 hours);
        (uint256 floorWei,) = feed.latest();
        assertEq(floorWei, 1.875 ether);
    }

    function test_acceptsLargeMoveOncePreviousIsStale() public {
        _report(2 ether, T0);
        vm.warp(T0 + 7 hours);
        _report(5 ether, T0 + 7 hours);
        (uint256 floorWei, bool fresh) = feed.latest();
        assertEq(floorWei, 5 ether);
        assertTrue(fresh);
    }

    function test_maxAgeShortensFreshness() public {
        vm.prank(owner);
        feed.setMaxAge(1 hours);
        _report(2 ether, T0);
        vm.warp(T0 + 1 hours + 1);
        (, bool fresh) = feed.latest();
        assertFalse(fresh);
    }

    function test_setMaxAgeIsBounded() public {
        vm.startPrank(owner);
        vm.expectRevert(FloorFeed.OutOfBounds.selector);
        feed.setMaxAge(1 hours - 1);
        vm.expectRevert(FloorFeed.OutOfBounds.selector);
        feed.setMaxAge(24 hours + 1);
        vm.stopPrank();
    }

    function test_onlyOwnerCanAdminister() public {
        vm.expectRevert(FloorFeed.NotOwner.selector);
        feed.setAttester(address(1));
        vm.expectRevert(FloorFeed.NotOwner.selector);
        feed.setMaxAge(2 hours);
        vm.expectRevert(FloorFeed.NotOwner.selector);
        feed.transferOwnership(address(1));
        vm.expectRevert(FloorFeed.NotOwner.selector);
        feed.setQuestion(keccak256("mine"));
    }

    function test_rejectsEveryReportBeforeAQuestionIsSet() public {
        FloorFeed fresh = new FloorFeed(owner, attester);
        OracleAttestation.Attestation memory a = _att(2 ether, T0);
        a.questionHash = bytes32(0);
        bytes memory sig = _sign(a, ATTESTER_KEY, address(fresh));
        vm.expectRevert(FloorFeed.WrongQuestion.selector);
        fresh.report(a, sig);
    }

    function test_questionCannotBeSetToZero() public {
        vm.prank(owner);
        vm.expectRevert(FloorFeed.WrongQuestion.selector);
        feed.setQuestion(bytes32(0));
    }

    function test_changingTheQuestionRejectsReportsForTheOldOne() public {
        bytes32 next = keccak256("a better floor question");
        vm.prank(owner);
        feed.setQuestion(next);

        OracleAttestation.Attestation memory old = _att(2 ether, T0);
        bytes memory oldSig = _sign(old, ATTESTER_KEY, address(feed));
        vm.expectRevert(FloorFeed.WrongQuestion.selector);
        feed.report(old, oldSig);

        OracleAttestation.Attestation memory fresh = _att(2 ether, T0);
        fresh.questionHash = next;
        feed.report(fresh, _sign(fresh, ATTESTER_KEY, address(feed)));
        (uint256 floorWei,) = feed.latest();
        assertEq(floorWei, 2 ether);
    }

    function test_ownerCanRotateAttester() public {
        vm.prank(owner);
        feed.setAttester(vm.addr(0xB0B));
        OracleAttestation.Attestation memory a = _att(2 ether, T0);
        bytes memory oldSig = _sign(a, ATTESTER_KEY, address(feed));
        vm.expectRevert(FloorFeed.BadSigner.selector);
        feed.report(a, oldSig);
        feed.report(a, _sign(a, 0xB0B, address(feed)));
    }
}
