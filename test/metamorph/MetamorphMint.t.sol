// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MetamorphFixture} from "./MetamorphFixture.sol";
import {MetamorphMD} from "../../src/metamorph/MetamorphMD.sol";

contract MetamorphMintTest is MetamorphFixture {
    function test_aValidProofMintsCardOneOfSeat1376() public {
        uint256 a = _anchor();
        uint256 n = _proof(miner, a);
        uint256 price = md.mintPrice();
        uint256 devBefore = token.balanceOf(developer);
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
        uint256 mine = _proof(miner, a);
        // Someone else mints first with their own proof: prevWork changes.
        token.transfer(other, 1_000_000 ether);
        vm.prank(other);
        token.approve(address(md), type(uint256).max);
        _mintAs(other);
        uint256 before = token.balanceOf(miner);
        vm.prank(miner);
        vm.expectRevert(MetamorphMD.NotASolution.selector);
        md.mint(a, mine);
        assertEq(token.balanceOf(miner), before, "no fee for a stale proof");
        assertEq(md.totalMinted(), 1);
    }

    function test_proofIsBoundToTheMiner() public {
        uint256 a = _anchor();
        uint256 n = _proof(miner, a);
        token.transfer(other, 1_000_000 ether);
        vm.prank(other);
        token.approve(address(md), type(uint256).max);
        vm.prank(other);
        vm.expectRevert(MetamorphMD.NotASolution.selector);
        md.mint(a, n);
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

    function test_theHashPicksAmongTheMineableSeats() public {
        _giveSeat(42);
        md.noteSeat(42);
        _giveSeat(7);
        md.noteSeat(7);
        bool saw1376;
        bool sawOther;
        for (uint256 i; i < 12; i++) {
            vm.roll(block.number + 1);
            vm.warp(block.timestamp + 90);
            uint256 id = _mintAs(miner);
            (uint32 seat,,,,,,,) = md.cards(id);
            if (seat == 1376) saw1376 = true;
            else sawOther = true;
            assertTrue(seat == 1376 || seat == 42 || seat == 7);
        }
        assertTrue(saw1376 && sawOther, "twelve picks spread over the seats");
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
        uint256 devBefore = token.balanceOf(developer);
        vm.roll(block.number + 1);
        _mintAs(miner);
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
    }

    function test_giltIsFourMoreBitsThanTheTarget() public {
        // Search nonces for one proof under target/16 (gilt) and one between target/16 and target (plain);
        // at a one-bit floor both come up within a few dozen tries.
        uint256 a = _anchor();
        bytes32 ah = blockhash(a);
        uint256 t = md.target();
        uint256 giltNonce;
        uint256 plainNonce;
        for (uint256 n = 1; giltNonce == 0 || plainNonce == 0; n++) {
            uint256 w = uint256(md.workHash(ah, miner, n));
            if (w < t >> 4) {
                if (giltNonce == 0) giltNonce = n;
            } else if (w < t) {
                if (plainNonce == 0) plainNonce = n;
            }
        }
        vm.prank(miner);
        uint256 g = md.mint(a, giltNonce);
        (,,, bool gilt,,,,) = md.cards(g);
        assertTrue(gilt, "four more bits than the target");
        // The second proof was found against the old prevWork; search again at the new one, plain only.
        vm.roll(block.number + 1);
        a = _anchor();
        ah = blockhash(a);
        t = md.target();
        plainNonce = 0;
        for (uint256 n = 1; plainNonce == 0; n++) {
            uint256 w = uint256(md.workHash(ah, miner, n));
            if (w >= t >> 4 && w < t) plainNonce = n;
        }
        vm.prank(miner);
        uint256 p = md.mint(a, plainNonce);
        (,,, bool plain,,,,) = md.cards(p);
        assertFalse(plain);
    }

    function testFuzz_randomNoncesNeverPassAtTwentyBits(uint256 nonce, address who) public {
        MetamorphMD strict = _deployAt(20);
        bytes32 ah = blockhash(_anchor());
        // 2^-20 odds per try: a fuzz run of a few hundred never finds one; if it does, the proof is genuine
        // and the assertion below says so instead of failing.
        bool passes = uint256(strict.workHash(ah, who, nonce)) < strict.target();
        if (passes) assertLt(uint256(strict.workHash(ah, who, nonce)), type(uint256).max >> 20);
        else assertGe(uint256(strict.workHash(ah, who, nonce)), type(uint256).max >> 20);
    }

    function _deployAt(uint8 minBits) private returns (MetamorphMD) {
        return _deploy(minBits);
    }
}
