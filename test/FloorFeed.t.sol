// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {FullMath} from "v4-core/src/libraries/FullMath.sol";
import {FloorFeed} from "../src/FloorFeed.sol";
import {OracleAttestation} from "../src/oracle/OracleAttestation.sol";

contract FloorFeedTest is Test {
    uint256 constant ATTESTER_KEY = 0xA11CE;
    bytes32 constant QUESTION = keccak256("floor question");
    /// @dev The collection lives on mainnet. The tests run on chain 31337, as a Sepolia rehearsal
    /// would run on 11155111, so the evidence chain and the consumer chain differ here on purpose.
    uint256 constant EVIDENCE_CHAIN = 1;
    uint64 constant T0 = 1_800_000_000;
    uint64 constant VALIDITY = 24 hours;

    address attester;
    address owner = makeAddr("owner");
    FloorFeed feed;

    function setUp() public {
        attester = vm.addr(ATTESTER_KEY);
        vm.warp(T0);
        feed = new FloorFeed(owner, attester, EVIDENCE_CHAIN);
        vm.prank(owner);
        feed.setQuestion(QUESTION);
    }

    // ------------------------------------------------------------------ helpers

    function _att(uint256 floorWei, uint64 issuedAt)
        internal
        pure
        returns (OracleAttestation.Attestation memory a)
    {
        a.requestId = bytes32(uint256(issuedAt));
        a.chainId = EVIDENCE_CHAIN;
        a.questionHash = QUESTION;
        a.answerType = OracleAttestation.ANSWER_TYPE_UINT256;
        a.answer = abi.encode(floorWei);
        a.panelSize = 5;
        a.quorum = 4;
        a.agreed = 4;
        a.issuedAt = issuedAt;
        a.expiresAt = issuedAt + VALIDITY;
    }

    function _signFor(OracleAttestation.Attestation memory a, uint256 key, uint256 chainId, address consumer)
        internal
        view
        returns (bytes memory)
    {
        bytes32 sep = OracleAttestation.domainSeparator(chainId, consumer);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, OracleAttestation.digest(sep, a));
        return abi.encodePacked(r, s, v);
    }

    function _sign(OracleAttestation.Attestation memory a, uint256 key, address consumer)
        internal
        view
        returns (bytes memory)
    {
        return _signFor(a, key, block.chainid, consumer);
    }

    function _report(uint256 floorWei, uint64 issuedAt) internal {
        OracleAttestation.Attestation memory a = _att(floorWei, issuedAt);
        feed.report(a, _sign(a, ATTESTER_KEY, address(feed)));
    }

    function _expectRejected(OracleAttestation.Attestation memory a, bytes4 err) internal {
        bytes memory sig = _sign(a, ATTESTER_KEY, address(feed));
        vm.expectRevert(err);
        feed.report(a, sig);
    }

    function _allowedRise(uint256 prev, uint256 gap) internal view returns (uint256) {
        return FullMath.mulDiv(prev, feed.MAX_RISE_BPS() * gap, feed.RISE_WINDOW() * feed.BPS());
    }

    // ------------------------------------------------------------------ basics

    function test_startsEmptyAndNotFresh() public view {
        (uint256 floorWei, bool fresh) = feed.latest();
        assertEq(floorWei, 0);
        assertFalse(fresh);
    }

    function test_acceptsValidReport() public {
        vm.expectEmit(false, false, false, true, address(feed));
        emit FloorFeed.Reported(2.84 ether, T0, T0 + 6 hours);
        _report(2.84 ether, T0);

        (uint256 floorWei, bool fresh) = feed.latest();
        assertEq(floorWei, 2.84 ether);
        assertTrue(fresh);
    }

    function test_reportGoesStaleAfterMaxAge() public {
        _report(2 ether, T0);
        vm.warp(T0 + 6 hours);
        (, bool fresh) = feed.latest();
        assertTrue(fresh, "the boundary is inclusive");
        vm.warp(T0 + 6 hours + 1);
        uint256 floorWei;
        (floorWei, fresh) = feed.latest();
        assertEq(floorWei, 2 ether, "a stale price is still readable");
        assertFalse(fresh);
    }

    function test_freshnessIsBoundedByTheAttestationsOwnExpiry() public {
        OracleAttestation.Attestation memory a = _att(2 ether, T0);
        a.expiresAt = T0 + 6 hours;
        feed.report(a, _sign(a, ATTESTER_KEY, address(feed)));

        vm.prank(owner);
        feed.setMaxAge(24 hours);

        vm.warp(T0 + 6 hours + 1);
        (, bool fresh) = feed.latest();
        assertFalse(fresh);
    }

    function test_raisingMaxAgeRevivesAnOlderReport() public {
        _report(2 ether, T0);
        vm.warp(T0 + 7 hours);
        (, bool fresh) = feed.latest();
        assertFalse(fresh);

        vm.prank(owner);
        feed.setMaxAge(12 hours);
        (, fresh) = feed.latest();
        assertTrue(fresh);
    }

    // ------------------------------------------------------------------ signature and binding

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

    function test_rejectsAttestationSignedForAnotherChainsDomain() public {
        OracleAttestation.Attestation memory a = _att(2 ether, T0);
        bytes memory sig = _signFor(a, ATTESTER_KEY, block.chainid + 1, address(feed));
        vm.expectRevert(FloorFeed.BadSigner.selector);
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

    // ------------------------------------------------------------------ question

    function test_rejectsWrongQuestion() public {
        OracleAttestation.Attestation memory a = _att(2 ether, T0);
        a.questionHash = keccak256("another question");
        _expectRejected(a, FloorFeed.WrongQuestion.selector);
    }

    function test_rejectsEveryReportBeforeAQuestionIsSet() public {
        FloorFeed fresh = new FloorFeed(owner, attester, EVIDENCE_CHAIN);
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

    function test_settingTheQuestionClearsTheStoredReport() public {
        _report(2 ether, T0);
        bytes32 next = keccak256("a better floor question");

        vm.expectEmit(false, false, false, true, address(feed));
        emit FloorFeed.QuestionSet(next);
        vm.expectEmit(false, false, false, true, address(feed));
        emit FloorFeed.Reported(0, 0, 0);
        vm.prank(owner);
        feed.setQuestion(next);

        (uint256 floorWei, bool fresh) = feed.latest();
        assertEq(floorWei, 0);
        assertFalse(fresh);

        vm.warp(T0 + 1);
        OracleAttestation.Attestation memory old = _att(2 ether, T0 + 1);
        _expectRejected(old, FloorFeed.WrongQuestion.selector);

        OracleAttestation.Attestation memory a = _att(100 ether, T0 + 1);
        a.questionHash = next;
        feed.report(a, _sign(a, ATTESTER_KEY, address(feed)));
        (floorWei,) = feed.latest();
        assertEq(floorWei, 100 ether, "the first report after a reset is not rate-limited");
    }

    function test_settingTheSameQuestionAgainClearsTheStoredReport() public {
        _report(2 ether, T0);
        vm.prank(owner);
        feed.setQuestion(QUESTION);
        (uint256 floorWei,) = feed.latest();
        assertEq(floorWei, 0);
    }

    // ------------------------------------------------------------------ evidence chain

    function test_rejectsEvidenceFromAnotherChain() public {
        OracleAttestation.Attestation memory a = _att(2 ether, T0);
        a.chainId = block.chainid;
        _expectRejected(a, FloorFeed.WrongChain.selector);
    }

    function test_constructorRejectsAZeroEvidenceChain() public {
        vm.expectRevert(FloorFeed.WrongChain.selector);
        new FloorFeed(owner, attester, 0);
    }

    // ------------------------------------------------------------------ panel

    function test_rejectsAgreementBelowQuorum() public {
        OracleAttestation.Attestation memory a = _att(2 ether, T0);
        a.agreed = 3;
        _expectRejected(a, FloorFeed.NoQuorum.selector);
    }

    function test_rejectsQuorumBelowTheMinimum() public {
        OracleAttestation.Attestation memory a = _att(2 ether, T0);
        a.quorum = 3;
        a.agreed = 3;
        _expectRejected(a, FloorFeed.NoQuorum.selector);
    }

    function test_rejectsQuorumThatIsNotAMajority() public {
        OracleAttestation.Attestation memory a = _att(2 ether, T0);
        a.panelSize = 100;
        a.quorum = 4;
        a.agreed = 4;
        _expectRejected(a, FloorFeed.NoQuorum.selector);

        a.panelSize = 8;
        a.quorum = 4;
        _expectRejected(a, FloorFeed.NoQuorum.selector);

        a.panelSize = 7;
        feed.report(a, _sign(a, ATTESTER_KEY, address(feed)));
    }

    function test_rejectsMoreAgreementThanPanel() public {
        OracleAttestation.Attestation memory a = _att(2 ether, T0);
        a.agreed = 9;
        _expectRejected(a, FloorFeed.NoQuorum.selector);
    }

    // ------------------------------------------------------------------ time

    function test_rejectsAShortLivedAttestation() public {
        OracleAttestation.Attestation memory a = _att(2 ether, T0);
        a.expiresAt = T0 + 6 hours - 1;
        _expectRejected(a, FloorFeed.ShortLived.selector);

        a.expiresAt = T0 - 1;
        _expectRejected(a, FloorFeed.ShortLived.selector);

        a.expiresAt = T0 + 6 hours;
        feed.report(a, _sign(a, ATTESTER_KEY, address(feed)));
    }

    function test_rejectsIssuedInTheFuture() public {
        _expectRejected(_att(2 ether, T0 + 1), FloorFeed.Expired.selector);
    }

    function test_rejectsAReportOlderThanMaxAge() public {
        OracleAttestation.Attestation memory a = _att(2 ether, T0 - 6 hours - 1);
        assertGt(a.expiresAt, T0, "still within its own validity");
        _expectRejected(a, FloorFeed.Expired.selector);

        OracleAttestation.Attestation memory edge = _att(2 ether, T0 - 6 hours);
        feed.report(edge, _sign(edge, ATTESTER_KEY, address(feed)));
    }

    function test_rejectsReplayAndOlderReports() public {
        _report(2 ether, T0);
        _expectRejected(_att(2 ether, T0), FloorFeed.NotNewer.selector);
        _expectRejected(_att(2 ether, T0 - 1), FloorFeed.NotNewer.selector);
    }

    // ------------------------------------------------------------------ answer

    function test_rejectsWrongAnswerType() public {
        OracleAttestation.Attestation memory a = _att(2 ether, T0);
        a.answerType = OracleAttestation.ANSWER_TYPE_UINT256 + 1;
        _expectRejected(a, FloorFeed.BadAnswer.selector);
    }

    function test_rejectsZeroAnswer() public {
        _expectRejected(_att(0, T0), FloorFeed.BadAnswer.selector);
    }

    function test_rejectsAnswerOfWrongLength() public {
        OracleAttestation.Attestation memory a = _att(2 ether, T0);
        a.answer = abi.encodePacked(uint128(2 ether));
        _expectRejected(a, FloorFeed.BadAnswer.selector);
    }

    // ------------------------------------------------------------------ rise limit

    function test_theFirstReportIsNotRateLimited() public {
        _report(100 ether, T0);
        (uint256 floorWei,) = feed.latest();
        assertEq(floorWei, 100 ether);
    }

    function test_aRiseOfAQuarterOverSixHoursIsAccepted() public {
        _report(2 ether, T0);
        vm.warp(T0 + 6 hours);
        _report(2.5 ether, T0 + 6 hours);
        (uint256 floorWei,) = feed.latest();
        assertEq(floorWei, 2.5 ether);
    }

    function test_aRiseAboveTheAllowanceIsRejected() public {
        _report(2 ether, T0);
        vm.warp(T0 + 6 hours);
        _expectRejected(_att(2.5 ether + 1, T0 + 6 hours), FloorFeed.MoveTooLarge.selector);
        (uint256 floorWei,) = feed.latest();
        assertEq(floorWei, 2 ether);
    }

    function test_theAllowanceGrowsWithTheGapBetweenReports() public {
        _report(2 ether, T0);

        vm.warp(T0 + 1 hours);
        _expectRejected(_att(2.1 ether, T0 + 1 hours), FloorFeed.MoveTooLarge.selector);
        _report(2.08 ether, T0 + 1 hours);

        vm.warp(T0 + 13 hours);
        _report(3.12 ether, T0 + 13 hours);
        (uint256 floorWei,) = feed.latest();
        assertEq(floorWei, 3.12 ether);
    }

    function test_theAllowanceStillAppliesAfterTheReportHasGoneStale() public {
        _report(2 ether, T0);
        vm.warp(T0 + 7 hours);
        (, bool fresh) = feed.latest();
        assertFalse(fresh);

        _expectRejected(_att(6 ether, T0 + 7 hours), FloorFeed.MoveTooLarge.selector);
        _report(2.5 ether, T0 + 7 hours);
        (uint256 floorWei,) = feed.latest();
        assertEq(floorWei, 2.5 ether);
    }

    function test_holdingAnAttestationBackGainsNothing() public {
        _report(2 ether, T0);
        OracleAttestation.Attestation memory held = _att(6 ether, T0 + 6 hours - 60);

        vm.warp(T0 + 6 hours - 60);
        _expectRejected(held, FloorFeed.MoveTooLarge.selector);

        vm.warp(T0 + 6 hours + 1);
        _expectRejected(held, FloorFeed.MoveTooLarge.selector);
    }

    function test_reportsInQuickSuccessionCannotCompound() public {
        _report(2 ether, T0);
        for (uint64 i = 1; i <= 8; i++) {
            vm.warp(T0 + i);
            _expectRejected(_att(2.5 ether, T0 + i), FloorFeed.MoveTooLarge.selector);
        }
        (uint256 floorWei,) = feed.latest();
        assertEq(floorWei, 2 ether);
    }

    function test_fallsAreNotLimited() public {
        _report(2 ether, T0);
        vm.warp(T0 + 1);
        _report(0.1 ether, T0 + 1);
        (uint256 floorWei,) = feed.latest();
        assertEq(floorWei, 0.1 ether);
    }

    function testFuzz_aRiseAboveTheAllowanceNeverChangesTheStoredPrice(uint256 next, uint256 gap) public {
        _report(2 ether, T0);
        gap = bound(gap, 1, 365 days);
        vm.warp(T0 + gap);
        uint256 allowed = _allowedRise(2 ether, gap);
        next = bound(next, 2 ether + allowed + 1, type(uint128).max);

        _expectRejected(_att(next, uint64(T0 + gap)), FloorFeed.MoveTooLarge.selector);

        (uint256 floorWei,) = feed.latest();
        assertEq(floorWei, 2 ether);
        assertEq(feed.issuedAt(), T0);
    }

    function testFuzz_aReportWithinTheAllowanceIsStored(uint256 next, uint256 gap) public {
        _report(2 ether, T0);
        gap = bound(gap, 1, 365 days);
        vm.warp(T0 + gap);
        next = bound(next, 1, 2 ether + _allowedRise(2 ether, gap));

        _report(next, uint64(T0 + gap));

        (uint256 floorWei, bool fresh) = feed.latest();
        assertEq(floorWei, next);
        assertTrue(fresh);
    }

    // ------------------------------------------------------------------ administration

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
        feed.setQuestion(keccak256("mine"));
        vm.expectRevert(FloorFeed.NotOwner.selector);
        feed.transferOwnership(address(1));
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

    function test_ownershipCanBeHandedOver() public {
        address next = makeAddr("timelock");
        vm.prank(owner);
        feed.transferOwnership(next);
        assertEq(feed.owner(), next);

        vm.prank(owner);
        vm.expectRevert(FloorFeed.NotOwner.selector);
        feed.setMaxAge(2 hours);

        vm.prank(next);
        feed.setMaxAge(2 hours);
        assertEq(feed.maxAge(), 2 hours);
    }

    function test_zeroAddressesAreRejected() public {
        vm.expectRevert(FloorFeed.ZeroAddress.selector);
        new FloorFeed(address(0), attester, EVIDENCE_CHAIN);
        vm.expectRevert(FloorFeed.ZeroAddress.selector);
        new FloorFeed(owner, address(0), EVIDENCE_CHAIN);

        vm.startPrank(owner);
        vm.expectRevert(FloorFeed.ZeroAddress.selector);
        feed.setAttester(address(0));
        vm.expectRevert(FloorFeed.ZeroAddress.selector);
        feed.transferOwnership(address(0));
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ hardening: a rejected report changes nothing

    /// Whatever the reason a report is rejected, the stored price and issue time must be left exactly
    /// as the last good report left them, so the vault keeps reading the last trusted floor.
    function test_aRejectedReportNeverChangesTheStoredValue() public {
        _report(2 ether, T0);
        uint256 floor0 = 2 ether;
        uint64 issued0 = T0;
        _assertStored(floor0, issued0);

        // Bad signer.
        OracleAttestation.Attestation memory a = _att(2.2 ether, T0 + 1 hours);
        bytes memory wrongSig = _sign(a, 0xB0B, address(feed));
        vm.expectRevert(FloorFeed.BadSigner.selector);
        feed.report(a, wrongSig);
        _assertStored(floor0, issued0);

        // Wrong question.
        a = _att(2.2 ether, T0 + 1 hours);
        a.questionHash = keccak256("some other question");
        _expectRejected(a, FloorFeed.WrongQuestion.selector);
        _assertStored(floor0, issued0);

        // Too large a rise (10 ETH in an hour against a ~0.08 ETH budget).
        vm.warp(T0 + 1 hours); // so the report is not read before it is issued
        a = _att(10 ether, T0 + 1 hours);
        _expectRejected(a, FloorFeed.MoveTooLarge.selector);
        _assertStored(floor0, issued0);

        // Stale: issued within the window but only read long after it lapsed.
        vm.warp(T0 + 10 hours);
        a = _att(2.2 ether, T0 + 2 hours); // now (T0+10h) > issuedAt+maxAge (T0+8h)
        _expectRejected(a, FloorFeed.Expired.selector);
        _assertStored(floor0, issued0);
    }

    function _assertStored(uint256 floor0, uint64 issued0) internal view {
        assertEq(feed.floorWei(), floor0, "stored floor unchanged");
        assertEq(feed.issuedAt(), issued0, "stored issue time unchanged");
    }
}
