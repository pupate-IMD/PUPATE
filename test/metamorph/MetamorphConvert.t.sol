// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MetamorphFixture} from "./MetamorphFixture.sol";
import {MetamorphMD} from "../../src/metamorph/MetamorphMD.sol";

contract MetamorphConvertTest is MetamorphFixture {
    function _ids(uint256 a) private pure returns (uint256[] memory ids) {
        ids = new uint256[](1);
        ids[0] = a;
    }

    function _mintMany(uint256 n) private {
        for (uint256 i; i < n; i++) {
            vm.roll(block.number + 1);
            vm.warp(block.timestamp + 90);
            _mintAs(miner);
        }
    }

    /// @dev A pot one conversion cannot take: 1,212 mints over the first four epochs (four seats of 303)
    /// put about 61M PUPATE in it, while a 5% move of the launch pool's price absorbs about 19M.
    function _bigPot() private {
        for (uint256 seat = 2; seat <= 4; seat++) {
            _giveSeat(seat);
            md.noteSeat(seat);
        }
        deal(address(token), miner, 100_000_000 ether); // the 1,212 mints cost 87.3M
        _mintMany(1212);
    }

    function test_nothingToConvertReverts() public {
        vm.expectRevert(MetamorphMD.NothingToConvert.selector);
        md.convert();
    }

    function test_convertSellsThePotForIMDPaysTheCallerAndTheDeveloperWhenNobodyStakes() public {
        _mintMany(3);
        uint256 potBefore = md.pot();
        assertEq(potBefore, 3 * 50_000 ether * 7000 / 10_000);
        uint256 devBefore = imd.balanceOf(developer);
        (uint256 seatPot, uint256 burnPot, uint256 dev, uint256 imdBurn) = _pots();
        uint256 vaultBefore = seatPot + burnPot + dev + imdBurn;
        vm.prank(keeper);
        uint256 out = md.convert();
        assertGt(out, 0);
        assertEq(md.pot(), 0, "the whole pot fit under the bound");
        assertEq(token.balanceOf(address(md)), 0);
        uint256 reward = imd.balanceOf(keeper);
        assertEq(reward, out * 50 / 10_000, "0.5% to the caller");
        assertEq(
            imd.balanceOf(developer) - devBefore, out - reward, "nobody staked: the rest to the developer"
        );
        assertEq(address(md).balance, md.ethPot(), "ETH equals the ETH pot");
        // The hook holds the tax as claims until a flush hands it to the vault; the fixture left none.
        hook.flush();
        (seatPot, burnPot, dev, imdBurn) = _pots();
        assertGt(seatPot + burnPot + dev + imdBurn, vaultBefore, "the sale paid the vault its tax");
    }

    function test_convertCreditsStakersByWeight() public {
        uint256 a = _mintAs(miner);
        vm.prank(miner);
        md.stake(_ids(a));
        _mintMany(2);
        vm.prank(keeper);
        uint256 out = md.convert();
        uint256 credited = out - out * 50 / 10_000;
        assertEq(md.imdOwed(), credited);
        vm.prank(miner);
        uint256 paid = md.claim(_ids(a));
        assertEq(paid, credited);
        assertEq(imd.balanceOf(miner), credited);
    }

    function test_convertStaysWithinTheImpactBound() public {
        _bigPot();
        uint160 pupateBefore = _sqrtPrice(key);
        uint160 imdBefore = _sqrtPrice(imdKey);
        vm.prank(keeper);
        md.convert();
        // Selling PUPATE lifts its sqrt price by at most sqrt(1.05); buying IMD lowers that pool's by at most sqrt(0.95).
        assertLe(uint256(_sqrtPrice(key)), uint256(pupateBefore) * 10_247 / 10_000 + 1);
        assertGe(uint256(_sqrtPrice(imdKey)), uint256(imdBefore) * 9_746 / 10_000 - 1);
    }

    function test_convertLeavesWhatTheBoundRefuses() public {
        _bigPot();
        uint256 potBefore = md.pot();
        vm.prank(keeper);
        md.convert();
        assertGt(md.pot(), 0, "part of the pot waits");
        assertLt(md.pot(), potBefore);
        assertEq(token.balanceOf(address(md)), md.pot(), "the contract holds exactly the pot");
        assertEq(address(md).balance, md.ethPot(), "and exactly the ETH pot");
        // The next call, after the pools recover a step, converts more.
        vm.roll(block.number + 1);
        uint256 again = md.pot();
        vm.prank(keeper);
        md.convert();
        assertLt(md.pot(), again);
    }

    function test_callbackOnlyFromThePoolManagerAndOnlyDuringAConversion() public {
        vm.expectRevert(MetamorphMD.OnlyPoolManager.selector);
        md.unlockCallback("");
        vm.prank(address(manager));
        vm.expectRevert(MetamorphMD.UnexpectedCallback.selector);
        md.unlockCallback("");
    }

    function test_convertDutyIsSelfOnly() public {
        vm.expectRevert(MetamorphMD.OnlySelf.selector);
        md.convertDuty(keeper);
    }
}
