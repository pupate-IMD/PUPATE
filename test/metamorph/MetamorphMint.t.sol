// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MetamorphFixture} from "./MetamorphFixture.sol";
import {MetamorphMD} from "../../src/metamorph/MetamorphMD.sol";
import {PupateToken} from "../../src/PupateToken.sol";

/// @dev A miner that is a contract: while the card is delivered to it, it records what it can read of the
/// mint and tries to mint again.
contract ProbingMiner {
    MetamorphMD internal immutable md;
    uint256 internal anchor;
    uint256 internal nonce;
    bytes32 public seenPrevWork;
    uint256 public seenTarget;
    uint40 public seenLastMintAt;
    uint16 public seenTotalMinted;
    bool public reentered;
    bytes public reentryError;

    constructor(MetamorphMD md_, PupateToken token_) {
        md = md_;
        token_.approve(address(md_), type(uint256).max);
    }

    function mint(uint256 anchor_, uint256 nonce_) external returns (uint256) {
        anchor = anchor_;
        nonce = nonce_;
        return md.mint(anchor_, nonce_);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4) {
        seenPrevWork = md.prevWork();
        seenTarget = md.target();
        seenLastMintAt = md.lastMintAt();
        seenTotalMinted = md.totalMinted();
        try md.mint(anchor, nonce) {
            reentered = true;
        } catch (bytes memory err) {
            reentryError = err;
        }
        return this.onERC721Received.selector;
    }
}

contract MetamorphMintTest is MetamorphFixture {
    // The contract at the mainnet floor of 20 bits, deployed once for the fuzz test.
    MetamorphMD internal strict;

    function setUp() public override {
        super.setUp();
        strict = _deploy(20);
    }

    function test_aValidProofMintsCardOneOfSeat1376() public {
        uint256 a = _anchor();
        uint256 n = _proof(miner, a);
        uint256 price = md.mintPrice();
        uint256 devBefore = token.balanceOf(developer);
        _expectMintEvents(a, n, price);
        vm.prank(miner);
        uint256 id = md.mint(a, n);
        assertEq(id, 1);
        assertEq(md.ownerOf(1), miner);
        assertEq(md.totalMinted(), 1);
        (
            uint32 seat,
            uint16 round,
            uint16 edition,,
            uint40 mintedAt,
            uint96 paid,
            address who,
            bytes32 work
        ) = md.cards(1);
        assertEq(seat, 1376);
        assertEq(round, 0);
        assertEq(edition, 1);
        assertEq(mintedAt, block.timestamp);
        assertEq(who, miner);
        assertEq(work, md.prevWork(), "prevWork is the last proof");
        assertEq(paid, price);
        assertEq(md.pot(), price * 7000 / 10_000, "70% to the pot");
        assertEq(
            token.balanceOf(developer) - devBefore, price - price * 7000 / 10_000, "30% to the developer"
        );
        assertEq(token.balanceOf(address(md)), md.pot(), "the contract holds exactly the pot");
        assertEq(md.lastMintAt(), block.timestamp);
    }

    function test_badProofIsRefusedWithoutTakingAFee() public {
        uint256 a = _anchor();
        uint256 n = _proof(miner, a);
        bytes32 ah = blockhash(a);
        // Find a nonce that does NOT pass, so the refusal is about the proof, not the anchor.
        uint256 bad = n;
        while (uint256(md.workHash(ah, miner, bad)) < md.target()) bad++;
        uint256 before = token.balanceOf(miner);
        vm.prank(miner);
        vm.expectRevert(MetamorphMD.NotASolution.selector);
        md.mint(a, bad);
        assertEq(token.balanceOf(miner), before);
        assertEq(md.totalMinted(), 0);
    }

    function test_proofFromBeforeAnotherMintIsRefused() public {
        uint256 a = _anchor();
        bytes32 ah = blockhash(a);
        bytes32 oldPrev = md.prevWork();
        uint256 oldTarget = md.target();
        // Someone else mints first with their own proof: prevWork changes, and the target falls with the pace.
        token.transfer(other, 1_000_000 ether);
        vm.prank(other);
        token.approve(address(md), type(uint256).max);
        _mintAs(other);
        uint256 newTarget = md.target();
        assertTrue(md.prevWork() != oldPrev);
        // The miner's proof from before: a nonce that is under both targets with the old prevWork (so only the
        // moved chain can refuse it) and is not under the new target with the new one. Each nonce is a fresh
        // draw at each prevWork, so the first few hundred hold plenty of them.
        uint256 stale;
        for (uint256 n = 1; n <= 512 && stale == 0; n++) {
            uint256 was = _workAt(oldPrev, ah, miner, n);
            if (was < oldTarget && was < newTarget && uint256(md.workHash(ah, miner, n)) >= newTarget) {
                stale = n;
            }
        }
        assertTrue(stale != 0, "a proof from before the other mint exists");
        uint256 before = token.balanceOf(miner);
        vm.prank(miner);
        vm.expectRevert(MetamorphMD.NotASolution.selector);
        md.mint(a, stale);
        assertEq(token.balanceOf(miner), before, "no fee for a stale proof");
        assertEq(md.totalMinted(), 1);
    }

    function test_proofIsBoundToTheMiner() public {
        uint256 a = _anchor();
        bytes32 ah = blockhash(a);
        uint256 t = md.target();
        // At a one-bit floor half of all nonces are proofs for anyone, so look for one that is a proof for the
        // miner and not for `other`.
        uint256 n = 1;
        while (uint256(md.workHash(ah, miner, n)) >= t || uint256(md.workHash(ah, other, n)) < t) n++;
        token.transfer(other, 1_000_000 ether);
        vm.prank(other);
        token.approve(address(md), type(uint256).max);
        uint256 before = token.balanceOf(other);
        vm.prank(other);
        vm.expectRevert(MetamorphMD.NotASolution.selector);
        md.mint(a, n);
        assertEq(token.balanceOf(other), before, "no fee for someone else's proof");
        assertEq(md.totalMinted(), 0);
        // The same nonce is the miner's own proof.
        vm.prank(miner);
        uint256 id = md.mint(a, n);
        assertEq(id, 1);
        assertEq(md.ownerOf(1), miner);
    }

    function test_anchorMustBeRecentAndInThePast() public {
        uint256 n = _proof(miner, _anchor());
        vm.prank(miner);
        vm.expectRevert(MetamorphMD.BadAnchor.selector);
        md.mint(block.number, n);
        vm.prank(miner);
        vm.expectRevert(MetamorphMD.BadAnchor.selector);
        md.mint(block.number + 3, n);
        uint256 old = block.number - 51;
        uint256 n2 = _proof(miner, old);
        vm.prank(miner);
        vm.expectRevert(MetamorphMD.BadAnchor.selector);
        md.mint(old, n2);
        uint256 edge = block.number - 50;
        uint256 n3 = _proof(miner, edge);
        vm.prank(miner);
        md.mint(edge, n3);
    }

    function test_anAnchorWithoutAHashIsRefused() public {
        uint256 a = _anchor();
        uint256 n = _proof(miner, a);
        assertTrue(md.anchorHash(a) != bytes32(0));
        // Inside the window but with no hash to bind the proof to (a pruned block, an unusual chain).
        vm.setBlockhash(a, bytes32(0));
        assertEq(md.anchorHash(a), bytes32(0));
        vm.prank(miner);
        vm.expectRevert(MetamorphMD.BadAnchor.selector);
        md.mint(a, n);
    }

    function test_theHashPicksAmongTheMineableSeats() public {
        _giveSeat(42);
        md.noteSeat(42);
        _giveSeat(7);
        md.noteSeat(7);
        for (uint256 i; i < 12; i++) {
            vm.roll(block.number + 1);
            vm.warp(block.timestamp + 90);
            uint256[] memory open = md.mineableSeats();
            assertEq(open.length, 3);
            uint256 a = _anchor();
            bytes32 ah = blockhash(a);
            uint256 t = md.target();
            // Take the first proof whose hash indexes the next seat in turn, so each seat is picked four times
            // whatever the fixture's addresses are. The assertion below is the pick formula itself.
            uint256 n = 1;
            uint256 work = uint256(md.workHash(ah, miner, n));
            while (work >= t || work % open.length != i % open.length) {
                n++;
                work = uint256(md.workHash(ah, miner, n));
            }
            vm.prank(miner);
            uint256 id = md.mint(a, n);
            (uint32 seat,,,,,,,) = md.cards(id);
            assertEq(seat, open[work % open.length], "the hash indexes the mineable seats");
        }
        assertEq(md.editionsMinted(1376, 0), 4);
        assertEq(md.editionsMinted(42, 0), 4);
        assertEq(md.editionsMinted(7, 0), 4);
    }

    function test_noMineableSeatMeansNoMint() public {
        _sell(1376);
        uint256 a = _anchor();
        uint256 n = _proof(miner, a);
        vm.prank(miner);
        vm.expectRevert(MetamorphMD.NothingMineable.selector);
        md.mint(a, n);
    }

    function test_reboughtSeatStartsItsOwnEditions() public {
        _mintAs(miner);
        assertEq(md.editionsMinted(1376, 0), 1);
        _sell(1376);
        // The vault buys the same seat again: a new round.
        vm.prank(other);
        collection.transferFrom(other, address(cocoon), 1376);
        cocoon.adopt(1376);
        (,,,,,, uint16 round) = cocoon.seats(1376);
        assertEq(round, 1);
        vm.roll(block.number + 1);
        uint256 id = _mintAs(miner);
        (, uint16 r, uint16 edition,,,,,) = md.cards(id);
        assertEq(r, 1);
        assertEq(edition, 1, "the new round's first edition");
        assertEq(md.editionsMinted(1376, 1), 1);
    }

    function test_editionsRunOutAt303AndTheSupplyAt3333() public {
        // Mining all 3,333 cards for real takes over a million hashes in the test itself, far past forge's
        // per-test gas cap; this test is about supply, not gas.
        vm.pauseGasMetering();
        // Eleven seats, 303 cards each: the whole collection.
        uint256[11] memory seats = [uint256(1376), 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
        for (uint256 i = 1; i < seats.length; i++) {
            _giveSeat(seats[i]);
            md.noteSeat(seats[i]);
        }
        deal(address(token), miner, 1_000_000_000 ether);
        for (uint256 i; i < 3333; i++) {
            vm.roll(block.number + 1);
            vm.warp(block.timestamp + 90);
            _mintAs(miner);
        }
        assertEq(md.totalMinted(), 3333);
        assertEq(md.epoch(), 11, "the last epoch, clamped at sell-out");
        for (uint256 i; i < seats.length; i++) {
            assertEq(md.editionsMinted(seats[i], 0), 303);
        }
        assertEq(md.mineableSeats().length, 0);
        vm.roll(block.number + 1);
        uint256 a = _anchor();
        uint256 n = _proof(miner, a);
        vm.prank(miner);
        vm.expectRevert(MetamorphMD.SupplyExhausted.selector);
        md.mint(a, n);
    }

    function test_priceStepsAfter303Mints() public {
        _giveSeat(2);
        md.noteSeat(2);
        deal(address(token), miner, 300_000_000 ether);
        for (uint256 i; i < 303; i++) {
            vm.roll(block.number + 1);
            vm.warp(block.timestamp + 90);
            _mintAs(miner);
        }
        assertEq(md.epoch(), 2);
        assertEq(md.mintPrice(), 62_500 ether);
        assertEq(md.target(), type(uint256).max >> 2, "epoch two's ceiling binds on the 303rd mint");
        (,,,,, uint96 paidFirstEpoch,,) = md.cards(303);
        assertEq(paidFirstEpoch, 50_000 ether, "the 303rd mint still pays the first epoch's price");
        uint256 devBefore = token.balanceOf(developer);
        vm.roll(block.number + 1);
        _mintAs(miner);
        (,,,,, uint96 paidSecondEpoch,,) = md.cards(304);
        assertEq(paidSecondEpoch, 62_500 ether, "the 304th pays the second epoch's");
        assertEq(token.balanceOf(developer) - devBefore, 62_500 ether * 3000 / 10_000);
    }

    function test_retargetFollowsThePaceWithinTheClampAndTheCeiling() public {
        uint256 ceiling = type(uint256).max >> 1;
        // A fast mint (1 s) wants the target to fall by 90×, clamped to ÷4.
        vm.roll(block.number + 1);
        vm.warp(block.timestamp + 1);
        _mintAs(miner);
        assertApproxEqAbs(md.target(), ceiling / 4, 8);
        // A slow mint (20 min) wants ×13, clamped to ×4, and the ceiling caps it.
        vm.roll(block.number + 1);
        vm.warp(block.timestamp + 20 minutes);
        _mintAs(miner);
        assertApproxEqAbs(md.target(), ceiling, 8, "never above the epoch's ceiling");
        // Exactly the interval leaves the target alone (it was at the ceiling).
        vm.roll(block.number + 1);
        vm.warp(block.timestamp + 90);
        _mintAs(miner);
        assertApproxEqAbs(md.target(), ceiling, 8);
        // Twice the interval from below the ceiling doubles it.
        vm.roll(block.number + 1);
        vm.warp(block.timestamp + 1);
        _mintAs(miner); // ceiling / 4
        vm.roll(block.number + 1);
        vm.warp(block.timestamp + 180);
        _mintAs(miner);
        assertApproxEqAbs(md.target(), ceiling / 2, 8);
        // The cap binds exactly: a slow mint takes the target back up to the ceiling, and from the ceiling a
        // mint twice the interval after the last one wants double and gets the ceiling, to the unit.
        vm.roll(block.number + 1);
        vm.warp(block.timestamp + 20 minutes);
        _mintAs(miner);
        assertEq(md.target(), ceiling, "a slow mint from below lands on the ceiling");
        vm.roll(block.number + 1);
        vm.warp(block.timestamp + 180);
        _mintAs(miner);
        assertEq(md.target(), ceiling, "twice the interval from the ceiling lands on it");
    }

    function test_aSlowMintFromTheCeilingSaturatesInsteadOfReverting() public {
        // At a one-bit floor the ceiling is 2^255 - 1, so `target × elapsed / 90` reaches 2^256 once elapsed
        // passes 180 s. The retarget has to saturate and let the ceiling cap it, not revert a valid proof.
        uint256 ceiling = type(uint256).max >> 1;
        uint256[4] memory slow = [uint256(181), 300, 359, 360];
        for (uint256 i; i < slow.length; i++) {
            vm.roll(block.number + 1);
            vm.warp(md.lastMintAt() + slow[i]);
            _mintAs(miner);
            assertEq(md.target(), ceiling, "a slow mint from the ceiling stays on it");
        }
    }

    function test_giltIsFourMoreBitsThanTheTarget() public {
        // Gilt is a proof under target/16. Take one just under that line, in [target/32, target/16), and later
        // one just over it, in [target/16, target/8), so a shift that is off by one either way flips a tier.
        uint256 a = _anchor();
        bytes32 ah = blockhash(a);
        uint256 t = md.target();
        uint256 giltNonce;
        for (uint256 n = 1; giltNonce == 0; n++) {
            uint256 w = uint256(md.workHash(ah, miner, n));
            if (w >= t >> 5 && w < t >> 4) giltNonce = n;
        }
        vm.prank(miner);
        uint256 g = md.mint(a, giltNonce);
        (,,, bool giltFlag,,,,) = md.cards(g);
        assertTrue(giltFlag, "just under target/16 is gilt");
        // Every mint voids the open proofs: search again at the new chain state, for a plain one.
        vm.roll(block.number + 1);
        a = _anchor();
        ah = blockhash(a);
        t = md.target();
        uint256 plainNonce;
        for (uint256 n = 1; plainNonce == 0; n++) {
            uint256 w = uint256(md.workHash(ah, miner, n));
            if (w >= t >> 4 && w < t >> 3) plainNonce = n;
        }
        vm.prank(miner);
        uint256 p = md.mint(a, plainNonce);
        (,,, bool plainFlag,,,,) = md.cards(p);
        assertFalse(plainFlag, "just over target/16 is plain");
    }

    function test_aContractMinerSeesTheMintRecordedAndCannotReenter() public {
        ProbingMiner pm = new ProbingMiner(md, token);
        token.transfer(address(pm), 1_000_000 ether);
        // Mint a while after the deployment, so the clock and the pace both move.
        vm.warp(md.lastMintAt() + 10);
        uint256 a = _anchor();
        uint256 n = _proof(address(pm), a);
        bytes32 work = md.workHash(blockhash(a), address(pm), n);
        uint256 id = pm.mint(a, n);
        assertEq(md.ownerOf(id), address(pm));
        // By the time the card is delivered the whole mint is on the books, the chain of work included.
        assertEq(pm.seenTotalMinted(), 1);
        assertEq(pm.seenPrevWork(), work, "prevWork had already advanced");
        assertEq(pm.seenLastMintAt(), block.timestamp, "lastMintAt had already advanced");
        assertEq(pm.seenTarget(), md.target(), "the retarget had already run");
        // And the lock holds: the second mint the receiver tried was refused.
        assertFalse(pm.reentered());
        assertEq(bytes4(pm.reentryError()), MetamorphMD.Reentrancy.selector);
    }

    function testFuzz_randomNoncesNeverPassAtTwentyBits(uint256 nonce, address who) public view {
        assertEq(strict.target(), type(uint256).max >> 20, "twenty bits is the mainnet floor");
        // 2^-20 odds per try: a fuzz run practically never finds a proof, and one that does is genuine. Either
        // way a proof is exactly a hash under max >> 20.
        uint256 w = uint256(strict.workHash(blockhash(_anchor()), who, nonce));
        assertEq(w < type(uint256).max >> 20, w < strict.target());
    }

    /// @dev Expects the two events of the miner's first mint: the target falls to a quarter (a mint seconds
    /// after the deployment is far faster than the 90 s pace), then the card is announced.
    function _expectMintEvents(uint256 anchor, uint256 nonce, uint256 price) private {
        bytes32 work = md.workHash(blockhash(anchor), miner, nonce);
        uint256 quarter = md.target() / 4;
        bool gilt = uint256(work) < md.target() >> 4;
        vm.expectEmit(false, false, false, true, address(md));
        emit MetamorphMD.Retargeted(quarter);
        vm.expectEmit(true, true, true, true, address(md));
        emit MetamorphMD.Minted(1, 1376, 0, 1, miner, work, gilt, price, 1);
    }

    /// @dev The proof by hand, with the `prevWork` of a chain state that has since moved on.
    function _workAt(bytes32 prev, bytes32 ah, address who, uint256 nonce) private view returns (uint256) {
        return uint256(
            keccak256(
                abi.encode(
                    md.DOMAIN(), block.chainid, address(md), keccak256(abi.encode(ah, prev)), who, nonce
                )
            )
        );
    }
}
