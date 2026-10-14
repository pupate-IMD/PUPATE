// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {FixedPoint96} from "v4-core/src/libraries/FixedPoint96.sol";
import {FullMath} from "v4-core/src/libraries/FullMath.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
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

    /// @dev A change to the fixture's IMD position: full range, held by the router at salt 0.
    function _imdPosition(int256 liquidityDelta) private pure returns (ModifyLiquidityParams memory) {
        return ModifyLiquidityParams(
            TickMath.minUsableTick(IMD_SPACING),
            TickMath.maxUsableTick(IMD_SPACING),
            liquidityDelta,
            bytes32(0)
        );
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
        // The amounts the event must report: both legs run through the router on a copy of the state, then
        // the copy is dropped. The pot is far inside the bound, so neither limit changes the outcome.
        uint256 copy = vm.snapshotState();
        uint256 ethOut = uint256(uint128(_sellExactIn(potBefore).amount0()));
        uint256 imdOut = uint256(uint128(_swap(router, imdKey, true, -int256(ethOut)).amount1()));
        vm.revertToState(copy);
        vm.expectEmit(true, false, false, true, address(md));
        emit MetamorphMD.Converted(potBefore, ethOut, imdOut, keeper, imdOut * 50 / 10_000);
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
        vm.prank(miner);
        md.stake(_ids(1));
        // Thin the IMD pool to 2% of its depth: a 5% move of its price then absorbs about 0.05 ETH, less than
        // the sale brings, so both bounds refuse part of what is offered.
        int256 thinned = int256(FullMath.mulDiv(100 ether, IMD_SQRT_PRICE, FixedPoint96.Q96) * 98 / 100);
        router.addLiquidity(imdKey, _imdPosition(-thinned));
        uint256 potBefore = md.pot();
        uint160 imdBefore = _sqrtPrice(imdKey);
        vm.prank(keeper);
        uint256 out = md.convert();
        assertGt(md.pot(), 0, "the PUPATE the sale bound refused waits in the pot");
        assertLt(md.pot(), potBefore);
        assertEq(token.balanceOf(address(md)), md.pot(), "the contract holds exactly the pot");
        uint256 waiting = md.ethPot();
        assertGt(waiting, 0, "the ETH the buy bound refused waits in the ETH pot");
        assertEq(address(md).balance, waiting, "and exactly the ETH pot");
        assertGe(
            uint256(_sqrtPrice(imdKey)),
            uint256(imdBefore) * 9_746 / 10_000 - 1,
            "the buy stopped at its bound"
        );
        uint256 credited = out - out * 50 / 10_000;
        assertEq(md.imdOwed(), credited, "the stakers are credited only what was bought");
        assertEq(imd.balanceOf(address(md)), credited);
        // Nothing moves the pools back between the calls. Once the spacing has passed and the IMD pool
        // is deep again, the next call sells another 5% window from the price the first one left and
        // spends the waiting ETH together with the new.
        router.addLiquidity{value: 200 ether}(imdKey, _imdPosition(thinned));
        vm.roll(block.number + md.CONVERT_SPACING());
        uint256 potAgain = md.pot();
        vm.prank(keeper);
        uint256 out2 = md.convert();
        assertLt(md.pot(), potAgain, "more of the pot sold");
        assertEq(md.ethPot(), 0, "the waiting ETH was spent");
        assertEq(address(md).balance, 0);
        assertEq(md.imdOwed(), credited + out2 - out2 * 50 / 10_000, "and the IMD it bought credited");
    }

    function test_convertIsSpacedLikeTheVaultsBurns() public {
        _mintMany(3);
        vm.prank(keeper);
        md.convert();
        // A mint in the same block refills the pot; the next conversion still waits out the spacing.
        _mintAs(miner);
        vm.expectRevert(MetamorphMD.TooSoon.selector);
        md.convert();
        vm.roll(block.number + md.CONVERT_SPACING() - 1);
        vm.expectRevert(MetamorphMD.TooSoon.selector);
        md.convert();
        vm.roll(block.number + 1);
        vm.prank(keeper);
        assertGt(md.convert(), 0, "it runs once the spacing has passed");
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
