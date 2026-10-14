// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MetamorphFixture} from "./MetamorphFixture.sol";
import {MetamorphHandler} from "./MetamorphHandler.sol";

contract MetamorphInvariantTest is MetamorphFixture {
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
        handler.convert(2);
        assertEq(handler.pupateSold(), 70_000 ether, "the pot of two fees was converted");
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
        assertEq(handler.lastStage(1), 1, "card 1 is a butterfly");
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
        (,,,,,,, bytes32 work) = md.cards(n);
        assertEq(md.prevWork(), work);
    }

    function invariant_editionsAndSupplyHold() public view {
        assertLe(md.totalMinted(), 3333);
        for (uint256 i; i < seatList.length; i++) {
            for (uint16 r; r < 3; r++) {
                assertLe(md.editionsMinted(seatList[i], r), 303);
            }
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

    function invariant_stagesNeverGoBack() public view {
        uint256 n = handler.mintedCount();
        for (uint256 i; i < n; i++) {
            uint256 id = handler.minted(i);
            uint8 now_ = md.stageOf(id);
            assertGe(now_, handler.lastStage(id));
        }
    }

    function invariant_targetIsNeverAboveTheCeiling() public view {
        uint256 epoch_ = md.epoch();
        uint256 shift = uint256(md.MIN_BITS()) + epoch_ - 1;
        assertLe(md.target(), type(uint256).max >> shift);
    }
}
