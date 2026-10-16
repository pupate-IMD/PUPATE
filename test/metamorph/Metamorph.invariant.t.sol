// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {StdStorage, stdStorage} from "forge-std/StdStorage.sol";
import {MetamorphFixture} from "./MetamorphFixture.sol";
import {MetamorphHandler} from "./MetamorphHandler.sol";

contract MetamorphInvariantTest is MetamorphFixture {
    using stdStorage for StdStorage;

    /// @dev Seat 1376 starts its round one edition short of the cap of 303, so a campaign mints it out and
    /// keeps minting the other seats after that.
    uint256 internal constant SEEDED_EDITIONS = 302;

    MetamorphHandler handler;
    uint256[] seatList;

    function setUp() public override {
        super.setUp();
        _endLaunch();
        // Gas is cheap: every mint also runs the vault's due duties.
        vm.fee(1 gwei);
        address[] memory actors = new address[](3);
        actors[0] = miner;
        actors[1] = makeAddr("actor1");
        actors[2] = makeAddr("actor2");
        seatList.push(1376);
        stdstore.target(address(md)).sig(md.editionsMinted.selector).with_key(uint256(1376))
            .with_key(uint256(0)).checked_write(SEEDED_EDITIONS);
        for (uint256 s = 2; s <= 4; s++) {
            _giveSeat(s);
            md.noteSeat(s);
            seatList.push(s);
        }
        for (uint256 i; i < actors.length; i++) {
            deal(address(token), actors[i], 200_000_000 ether);
            vm.prank(actors[i]);
            token.approve(address(md), type(uint256).max);
            vm.deal(actors[i], 1 ether);
        }
        handler = new MetamorphHandler(md, cocoon, token, collection, actors, seatList, other);
        targetContract(address(handler));
    }

    /// @dev A handler whose actions all return early would make every invariant below hold for nothing.
    function test_theHandlerActuallyActs() public {
        handler.mint(0, 90);
        handler.stake(0, 0);
        (address staker,,) = md.stakeOf(1);
        assertEq(staker, miner, "the miner minted card 1 and staked it");
        handler.mint(1, 90);
        assertEq(md.pot(), 70_000 ether, "two fees put 70% each in the pot");
        handler.convert(2);
        assertEq(md.pot(), 0, "the conversion sold the whole pot");
        assertEq(handler.pupateSold(), 70_000 ether, "as its Converted event reports");
        handler.claim(0);
        assertGt(imd.balanceOf(miner), 0, "the staker claimed IMD");
        handler.tax(1 ether);
        uint256 balance = miner.balance;
        handler.mint(0, 90);
        assertGt(miner.balance, balance, "the mint burned for the vault and paid the miner");
        for (uint256 i; i < seatList.length; i++) {
            handler.sellSeat(i);
        }
        assertEq(md.mineableSeats().length, 0, "every seat sold");
        assertEq(handler.seatsForgotten(), seatList.length, "and forgotten");
        assertEq(md.notedSeats().length, 0, "the list is empty");
        assertEq(handler.lastStage(1), 1, "card 1 is a butterfly");
        handler.mint(2, 90);
        uint256 last = md.totalMinted();
        assertTrue(md.commons(last), "with every seat sold, the mint drew from the commons");
        assertEq(handler.lastStage(last), 0, "a commons card is a chrysalis");
        handler.pass(1 days);
        handler.unstake(0);
        (staker,,) = md.stakeOf(1);
        assertEq(staker, address(0), "unstaked");
    }

    function invariant_prevWorkIsTheLastProof() public view {
        uint256 n = md.totalMinted();
        if (n == 0) {
            assertEq(md.prevWork(), md.DOMAIN());
            return;
        }
        (,,,,,,,, bytes32 work) = md.cards(n);
        assertEq(md.prevWork(), work);
    }

    /// @dev Seat 1376 starts at `SEEDED_EDITIONS`, so the cap and the mineable filter are crossed inside a run.
    /// The supply cap of 3,333 is out of a campaign's reach; `test_editionsRunOutAt303AndTheSupplyAt3333`
    /// (MetamorphMint.t.sol) mints the whole collection. The commons draws seats outside the list, so every
    /// card's own bucket is checked too.
    function invariant_editionsNeverExceedTheCap() public view {
        for (uint256 i; i < seatList.length; i++) {
            for (uint16 r; r < 3; r++) {
                assertLe(md.editionsMinted(seatList[i], r), 303);
            }
        }
        uint256 n = handler.mintedCount();
        for (uint256 i; i < n; i++) {
            (uint32 seat, uint16 round,,,,,,,) = md.cards(handler.minted(i));
            assertLe(md.editionsMinted(seat, round), 303);
        }
    }

    function invariant_potIsSeventyPercentOfFeesLessWhatWasSold() public view {
        assertEq(md.pot(), handler.feesPaid() * 7000 / 10_000 - handler.pupateSold());
        assertEq(token.balanceOf(address(md)), md.pot());
    }

    function invariant_imdOwedIsCovered() public view {
        assertLe(md.imdOwed(), imd.balanceOf(address(md)));
    }

    /// @dev Exact because every actor is an EOA: a burn duty's reward always reaches the miner, and a
    /// conversion sets the ETH pot to the balance it leaves. Only a contract miner that refuses ETH could
    /// leave a reward here above the ETH pot, until the next conversion spends it.
    function invariant_ethEqualsTheEthPot() public view {
        assertEq(address(md).balance, md.ethPot());
    }

    /// @dev Audit I-9: the weight the accumulator divides by is exactly the weight staked. A card that is not
    /// staked has no entry, so the sum runs over every card minted.
    function invariant_totalWeightIsTheSumOfStakedWeights() public view {
        uint256 n = handler.mintedCount();
        uint256 sum;
        for (uint256 i; i < n; i++) {
            (, uint8 weight,) = md.stakeOf(handler.minted(i));
            sum += weight;
        }
        assertEq(md.totalWeight(), sum);
    }

    function invariant_stagesNeverGoBack() public view {
        uint256 n = handler.mintedCount();
        for (uint256 i; i < n; i++) {
            uint256 id = handler.minted(i);
            uint8 now_ = md.stageOf(id);
            assertGe(now_, handler.lastStage(id));
        }
    }

    /// @dev The effective target too, the one proofs are checked against: silence eases the stored target up
    /// to the ceiling and never past it, and never makes it harder.
    function invariant_targetIsNeverAboveTheCeiling() public view {
        uint256 epoch_ = md.epoch();
        uint256 shift = uint256(md.MIN_BITS()) + epoch_ - 1;
        uint256 ceiling = type(uint256).max >> shift;
        assertLe(md.target(), ceiling);
        assertLe(md.effectiveTarget(), ceiling, "the eased target never passes the ceiling");
        assertGe(md.effectiveTarget(), md.target(), "silence never makes the target harder");
    }
}
