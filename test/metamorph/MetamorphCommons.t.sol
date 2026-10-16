// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {StdStorage, stdStorage} from "forge-std/StdStorage.sol";
import {MetamorphFixture} from "./MetamorphFixture.sol";
import {ERC721Lite} from "../../src/metamorph/ERC721Lite.sol";
import {MetamorphMD} from "../../src/metamorph/MetamorphMD.sol";
import {IERC721Minimal} from "../../src/interfaces/IERC721Minimal.sol";

/// @dev The commons (2026-10-16): while no noted seat is held by the vault with editions left, a mint draws
/// its seat from the whole identity.md collection, `work % totalSupply()` (the collection numbers its seats
/// from 0), in the round Cocoon records for that seat, and the card emerges by time only. The fixture's vault holds seat 1376, noted, so every
/// test starts by selling it; the mock collection then counts one seat, and a test mints more into it when
/// the pick needs room.
contract MetamorphCommonsTest is MetamorphFixture {
    using stdStorage for StdStorage;

    function setUp() public override {
        super.setUp();
        _sell(1376);
        vm.roll(block.number + 1);
    }

    function test_noMineableSeatDrawsFromTheCommons() public {
        _grow(20);
        assertEq(md.mineableSeats().length, 0, "the vault holds no seat");
        uint256 a = _anchor();
        uint256 n = _proof(miner, a);
        bytes32 work = md.workHash(blockhash(a), miner, n);
        uint256 expected = uint256(work) % 20;
        uint256 price = md.mintPrice();
        bool gilt = uint256(work) < md.target() >> 4;
        vm.expectEmit(true, true, true, true, address(md));
        emit MetamorphMD.Minted(1, expected, 0, 1, miner, work, gilt, price, 1);
        vm.prank(miner);
        uint256 id = md.mint(a, n);
        (uint32 seat, uint16 round, uint16 edition,, bool commons,,,,) = md.cards(id);
        assertEq(seat, expected, "the work modulo the collection's supply");
        assertEq(round, 0, "a seat the vault never held is in round 0");
        assertEq(edition, 1);
        assertTrue(commons, "the card is marked");
        assertTrue(md.commons(id));
        assertEq(md.editionsMinted(expected, 0), 1, "counted in the seat's bucket as any card");
        assertEq(md.pot(), price * 7000 / 10_000, "the fee splits as always");
        assertEq(md.ownerOf(id), miner);
    }

    function test_theCommonsPickIsTheWorkModuloTheSupply() public {
        _grow(5);
        for (uint256 residue; residue < 5; residue++) {
            vm.roll(block.number + 1);
            vm.warp(block.timestamp + 90);
            (uint256 id,) = _mintCommons(residue, 5);
            (uint32 seat,,,,,,,,) = md.cards(id);
            assertEq(seat, residue, "seat = work % totalSupply");
            assertTrue(md.commons(id));
        }
        for (uint256 seat; seat < 5; seat++) {
            assertEq(md.editionsMinted(seat, 0), 1);
        }
    }

    /// The round is Cocoon's record for the seat, whatever the vault does now: a seat it bought twice and
    /// sold twice is in round 1, so its commons cards never share (seat, round, edition) with the round-0
    /// cards of its first stay; a seat it never held is in round 0.
    function test_theRoundIsCocoonsRecordForTheSeat() public {
        _giveSeat(2);
        collection.mint(other, 3);
        assertEq(collection.totalSupply(), 3);
        _sell(2);
        vm.prank(other);
        collection.transferFrom(other, address(cocoon), 2);
        cocoon.adopt(2);
        _sell(2);
        (,,,,, bool held, uint16 recorded) = cocoon.seats(2);
        assertFalse(held);
        assertEq(recorded, 1);
        assertEq(md.mineableSeats().length, 0);

        (uint256 id,) = _mintCommons(2, 3);
        (uint32 seat, uint16 round, uint16 edition,,,,,,) = md.cards(id);
        assertEq(seat, 2);
        assertEq(round, 1, "Cocoon's round for the seat");
        assertEq(edition, 1);
        assertEq(md.editionsMinted(2, 1), 1);
        assertEq(md.editionsMinted(2, 0), 0, "the old round's bucket is untouched");

        vm.roll(block.number + 1);
        (id,) = _mintCommons(1, 3);
        (seat, round,,,,,,,) = md.cards(id);
        assertEq(seat, 1);
        assertEq(round, 0, "never held: round 0");
    }

    function test_aFullBucketStepsToTheNextSeat() public {
        _grow(3);
        _fill(1, 0, 303);
        (uint256 id,) = _mintCommons(1, 3);
        (uint32 seat, uint16 round, uint16 edition,, bool commons,,,,) = md.cards(id);
        assertEq(seat, 2, "seat 1's bucket is full: the next seat");
        assertEq(round, 0);
        assertEq(edition, 1);
        assertTrue(commons);
        assertEq(md.editionsMinted(1, 0), 303, "the full bucket is left as it is");

        // The step wraps from the last seat, totalSupply() - 1, to seat 0.
        _fill(2, 0, 303);
        vm.roll(block.number + 1);
        (id,) = _mintCommons(2, 3);
        (seat,,,,,,,,) = md.cards(id);
        assertEq(seat, 0, "past the last seat comes seat 0");
    }

    /// The walk is the seat the hash picks and at most sixteen steps after it: with seventeen full buckets
    /// in a row there is nothing to mine, and with sixteen the mint lands on the seventeenth seat.
    function test_sixteenFullStepsLeaveNothingMineable() public {
        _grow(20);
        for (uint256 seat; seat <= 16; seat++) {
            _fill(seat, 0, 303);
        }
        uint256 a = _anchor();
        uint256 nonce = _proofWithResidue(miner, a, 0, 20);
        uint256 before = token.balanceOf(miner);
        vm.prank(miner);
        vm.expectRevert(MetamorphMD.NothingMineable.selector);
        md.mint(a, nonce);
        assertEq(token.balanceOf(miner), before, "no fee");
        assertEq(md.totalMinted(), 0);

        _fill(16, 0, 302);
        vm.prank(miner);
        uint256 id = md.mint(a, nonce);
        (uint32 seat,, uint16 edition,,,,,,) = md.cards(id);
        assertEq(seat, 16, "sixteen steps from seat 0");
        assertEq(edition, 303, "the bucket's last edition");
    }

    /// The commons is the fallback, never a choice: the moment the vault holds a noted seat, the picks come
    /// from the mineable seats, and when that seat is sold they come from the commons again.
    function test_aNotedHeldSeatTakesPrecedenceFromTheNextMintOn() public {
        uint256 first = _mintAs(miner);
        assertTrue(md.commons(first));

        _giveSeat(42);
        md.noteSeat(42);
        vm.roll(block.number + 1);
        uint256 second = _mintAs(miner);
        (uint32 seat,,,, bool commons,,,,) = md.cards(second);
        assertEq(seat, 42, "the held seat, whatever the hash");
        assertFalse(commons);
        assertFalse(md.commons(second));
        assertEq(md.stageOf(second), 0);
        _sell(42);
        assertEq(md.stageOf(second), 1, "a vault card emerges when the vault sells its seat");
        assertEq(md.stageOf(first), 0, "a commons card does not");

        vm.roll(block.number + 1);
        uint256 third = _mintAs(miner);
        assertTrue(md.commons(third), "the seat sold, the commons again");
    }

    function test_commonsOfUnmintedReverts() public {
        vm.expectRevert(ERC721Lite.NotMinted.selector);
        md.commons(1);
    }

    /// A commons card's seat was never held by the vault for it, so the vault-holds rule would make it a
    /// butterfly at once; it emerges by the 90 days only, whether the vault holds its seat meanwhile or not.
    function test_aCommonsCardEmergesByTimeOnly() public {
        // One seat in the collection: every pick is seat 0, which the vault never held.
        uint256 id = _mintAs(miner);
        (uint32 seat, uint16 round,,, bool commons,,,,) = md.cards(id);
        assertEq(seat, 0);
        assertEq(round, 0);
        assertTrue(commons);
        assertEq(md.stageOf(id), 0, "a chrysalis, though the vault does not hold seat 0");
        assertEq(md.tokenURI(id), _stub(id, 0), "the art is handed stage 0");

        _giveSeat(0);
        assertEq(md.stageOf(id), 0, "still a chrysalis while the vault holds seat 0 in round 0");
        _sell(0);
        assertEq(md.stageOf(id), 0, "and still one after the vault sold it");

        vm.warp(block.timestamp + 90 days - 1);
        assertEq(md.stageOf(id), 0);
        vm.warp(block.timestamp + 1);
        assertEq(md.stageOf(id), 1, "a butterfly at 90 days");
        assertEq(md.tokenURI(id), _stub(id, 1), "the art is handed stage 1");
        vm.prank(other);
        collection.transferFrom(other, address(cocoon), 0);
        assertEq(md.stageOf(id), 1, "and for good");
    }

    function test_aCommonsCardStakesAsAChrysalisAndReweighsAtNinetyDays() public {
        uint256 id = _mintAs(miner);
        uint256[] memory ids = new uint256[](1);
        ids[0] = id;
        vm.prank(miner);
        md.stake(ids);
        (, uint8 weight,) = md.stakeOf(id);
        assertEq(weight, 1);
        vm.warp(block.timestamp + 90 days);
        vm.expectEmit(true, false, false, true, address(md));
        emit MetamorphMD.Reweighed(id, 2);
        md.poke(ids);
        (, weight,) = md.stakeOf(id);
        assertEq(weight, 2);
        assertEq(md.totalWeight(), 2);
    }

    /// A collection that cannot say how many seats it has, or says none, leaves nothing to mine: the mint
    /// refuses without a fee, as it did before the commons whenever the vault held no seat.
    function test_aCollectionThatCannotCountItsSeatsLeavesNothingToMine() public {
        bytes memory totalSupply = abi.encodeWithSelector(IERC721Minimal.totalSupply.selector);
        uint256 a = _anchor();
        uint256 nonce = _proof(miner, a);
        uint256 before = token.balanceOf(miner);

        vm.mockCallRevert(address(collection), totalSupply, "");
        vm.prank(miner);
        vm.expectRevert(MetamorphMD.NothingMineable.selector);
        md.mint(a, nonce);

        vm.clearMockedCalls();
        vm.mockCall(address(collection), totalSupply, abi.encode(uint256(0)));
        vm.prank(miner);
        vm.expectRevert(MetamorphMD.NothingMineable.selector);
        md.mint(a, nonce);
        assertEq(token.balanceOf(miner), before, "no fee either time");
        assertEq(md.totalMinted(), 0);

        vm.clearMockedCalls();
        vm.prank(miner);
        uint256 id = md.mint(a, nonce);
        assertTrue(md.commons(id), "the same proof mints once the collection answers");
    }

    /// A card keeps its seat in 32 bits (audit L-4): a collection past 2^32 - 1 seats is drawn from its
    /// first 2^32 - 1, so the seat is stored whole.
    function test_aSupplyPast32BitsIsDrawnFromTheFirst32Bits() public {
        uint256 largest = type(uint32).max;
        vm.mockCall(
            address(collection),
            abi.encodeWithSelector(IERC721Minimal.totalSupply.selector),
            abi.encode(largest + 7)
        );
        uint256 a = _anchor();
        uint256 nonce = _proof(miner, a);
        uint256 work = uint256(md.workHash(blockhash(a), miner, nonce));
        vm.prank(miner);
        uint256 id = md.mint(a, nonce);
        (uint32 seat,,,,,,,,) = md.cards(id);
        assertEq(seat, work % largest);
    }

    // ------------------------------------------------------------------ helpers

    /// @dev Mints seats 2 to `n` into the mock collection, so that it counts `n` with the fixture's 1376.
    function _grow(uint256 n) private {
        for (uint256 id = 2; id <= n; id++) {
            collection.mint(other, id);
        }
        assertEq(collection.totalSupply(), n);
    }

    function _fill(uint256 seat, uint16 round, uint256 count) private {
        stdstore.target(address(md)).sig(md.editionsMinted.selector).with_key(seat).with_key(uint256(round))
            .checked_write(count);
    }

    /// @dev The first proof for `who` at `anchor` whose work is `residue` modulo `n`: the commons then picks
    /// seat `residue`.
    function _proofWithResidue(address who, uint256 anchor, uint256 residue, uint256 n)
        private
        view
        returns (uint256 nonce)
    {
        bytes32 ah = blockhash(anchor);
        uint256 t = md.effectiveTarget();
        for (nonce = 1;; nonce++) {
            uint256 w = uint256(md.workHash(ah, who, nonce));
            if (w < t && w % n == residue) return nonce;
        }
    }

    function _mintCommons(uint256 residue, uint256 n) private returns (uint256 id, bytes32 work) {
        uint256 a = _anchor();
        uint256 nonce = _proofWithResidue(miner, a, residue, n);
        work = md.workHash(blockhash(a), miner, nonce);
        vm.prank(miner);
        id = md.mint(a, nonce);
    }

    /// @dev What the stub art says for card `id` of seat 0, round 0, edition 1, in epoch 1 at 50,000 PUPATE.
    function _stub(uint256 id, uint8 stage) private view returns (string memory) {
        (,,, bool gilt,,,,,) = md.cards(id);
        return string.concat(
            "stub:",
            vm.toString(id),
            ":0:0:1:",
            vm.toString(uint256(stage)),
            ":",
            gilt ? "gilt" : "plain",
            ":1:50000000000000000000000"
        );
    }
}
