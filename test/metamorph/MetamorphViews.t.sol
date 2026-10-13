// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MetamorphFixture} from "./MetamorphFixture.sol";
import {MetamorphMD} from "../../src/metamorph/MetamorphMD.sol";

contract MetamorphViewsTest is MetamorphFixture {
    function test_constantsMatchTheSpec() public view {
        assertEq(md.EDITIONS(), 303);
        assertEq(md.MAX_SUPPLY(), 3333);
        assertEq(md.EPOCH(), 303);
        assertEq(md.BASE_PRICE(), 50_000 ether);
        assertEq(md.TARGET_INTERVAL(), 90);
        assertEq(md.ANCHOR_WINDOW(), 50);
        assertEq(md.DOMAIN(), keccak256("Metamorph MD work v1"));
        assertEq(md.MIN_BITS(), 1);
        assertEq(md.name(), "Metamorph MD");
        assertEq(md.symbol(), "MMD");
    }

    function test_startsAtTheFirstEpochCeiling() public view {
        assertEq(md.target(), type(uint256).max >> 1);
        assertEq(md.bits(), 1);
        assertEq(md.prevWork(), md.DOMAIN());
        assertEq(md.lastMintAt(), block.timestamp);
        assertEq(md.totalMinted(), 0);
        assertEq(md.epoch(), 1);
    }

    function test_priceStepsOnceEveryEpoch() public view {
        assertEq(md.priceAt(1), 50_000 ether);
        assertEq(md.priceAt(2), 62_500 ether);
        assertEq(md.priceAt(3), 78_125 ether);
        assertEq(md.priceAt(11), 465_661_287_307_739_257_812_500);
        assertEq(md.mintPrice(), 50_000 ether);
    }

    function test_workHashIsTheSpecsPreimage() public view {
        bytes32 ah = blockhash(block.number - 1);
        assertTrue(ah != bytes32(0), "forge gives recent blocks a hash");
        bytes32 expected = keccak256(
            abi.encode(
                md.DOMAIN(),
                block.chainid,
                address(md),
                keccak256(abi.encode(ah, md.prevWork())),
                miner,
                uint256(7)
            )
        );
        assertEq(md.workHash(ah, miner, 7), expected);
        assertEq(md.anchorHash(block.number - 1), ah);
        assertEq(md.anchorHash(block.number), bytes32(0), "the current block has no hash yet");
    }

    function test_seatRegistryOnlyTakesSeatsTheVaultHolds() public {
        assertEq(md.notedSeats().length, 1);
        assertEq(md.mineableSeats()[0], 1376);
        vm.expectRevert(MetamorphMD.SeatNotHeld.selector);
        md.noteSeat(99);
        collection.mint(seller, 99);
        vm.expectRevert(MetamorphMD.SeatNotHeld.selector);
        md.noteSeat(99);
        _giveSeat(42);
        md.noteSeat(42);
        md.noteSeat(42); // twice is fine, noted once
        assertEq(md.notedSeats().length, 2);
        assertEq(md.mineableSeats().length, 2);
    }

    function test_soldSeatLeavesTheMineableListButStaysNoted() public {
        _sell(1376);
        assertEq(md.notedSeats().length, 1);
        assertEq(md.mineableSeats().length, 0);
    }
}
