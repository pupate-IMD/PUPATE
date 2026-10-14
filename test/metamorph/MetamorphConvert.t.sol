// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {FixedPoint96} from "v4-core/src/libraries/FixedPoint96.sol";
import {FullMath} from "v4-core/src/libraries/FullMath.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams, SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {MetamorphFixture} from "./MetamorphFixture.sol";
import {MetamorphMD} from "../../src/metamorph/MetamorphMD.sol";
import {PupateToken} from "../../src/PupateToken.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {PoolRouter} from "../utils/PoolRouter.sol";

/// @dev A miner that sandwiches the conversion its own mint runs (audit M-1): it buys IMD while the card is
/// delivered, before the duties run, and sells the same IMD back once the mint returns.
contract SandwichMiner {
    MetamorphMD internal immutable md;
    PoolRouter internal immutable router;
    MockERC20 internal immutable imdToken;
    PoolKey internal imdKey;
    uint256 internal front;
    uint256 internal got;

    constructor(
        MetamorphMD md_,
        PoolRouter router_,
        PupateToken pupate_,
        MockERC20 imd_,
        PoolKey memory imdKey_
    ) {
        md = md_;
        router = router_;
        imdToken = imd_;
        imdKey = imdKey_;
        pupate_.approve(address(md_), type(uint256).max);
        imd_.approve(address(router_), type(uint256).max);
    }

    function run(uint256 anchor, uint256 nonce, uint256 front_) external {
        front = front_;
        md.mint(anchor, nonce); // the duties convert inside, after the front-run
        router.swap(imdKey, SwapParams(false, -int256(got), TickMath.MAX_SQRT_PRICE - 1)); // back-run
    }

    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4) {
        uint256 before = imdToken.balanceOf(address(this));
        router.swap{value: front}(imdKey, SwapParams(true, -int256(front), TickMath.MIN_SQRT_PRICE + 1));
        got = imdToken.balanceOf(address(this)) - before;
        return this.onERC721Received.selector;
    }

    receive() external payable {}
}

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

    function test_convertSpendsTheEthItHoldsAlone() public {
        // An empty pot and 1 ETH in hand: the sale is skipped and the ETH alone buys IMD, as far as the buy
        // bound lets it. A 1.5% move of the IMD pool's price absorbs about 0.76 ETH of its 100, a 5% move
        // about 2.6. The fixture has never converted, so the spacing is no obstacle.
        assertEq(md.pot(), 0);
        vm.deal(address(md), 1 ether);
        uint256 devBefore = imd.balanceOf(developer);
        // The amounts the event must report, from a copy of the state: the same buy, limited to sqrt(0.985)
        // of the price rounded in the contract's favour, 0.9925.
        uint256 copy = vm.snapshotState();
        uint160 limit = uint160(uint256(_sqrtPrice(imdKey)) * 9_925 / 10_000);
        BalanceDelta d = router.swap{value: 1 ether}(imdKey, SwapParams(true, -1 ether, limit));
        uint256 ethIn = uint256(uint128(-d.amount0()));
        uint256 imdOut = uint256(uint128(d.amount1()));
        vm.revertToState(copy);
        assertLt(ethIn, 1 ether, "the bound refuses part of the ETH");
        vm.expectEmit(true, false, false, true, address(md));
        emit MetamorphMD.Converted(0, 0, imdOut, keeper, imdOut * 50 / 10_000);
        vm.prank(keeper);
        uint256 out = md.convert();
        assertEq(out, imdOut);
        assertEq(md.pot(), 0);
        assertEq(md.ethPot(), 1 ether - ethIn, "what the bound refused waits in the ETH pot");
        assertEq(address(md).balance, md.ethPot(), "ETH equals the ETH pot");
        assertEq(_sqrtPrice(imdKey), limit, "the buy stopped at its bound");
        uint256 reward = imd.balanceOf(keeper);
        assertEq(reward, out * 50 / 10_000, "0.5% to the caller");
        assertEq(
            imd.balanceOf(developer) - devBefore, out - reward, "nobody staked: the rest to the developer"
        );
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
        // And 2 ETH waits from earlier conversions: with what the sale brings, more than a 1.5% move of the IMD
        // pool absorbs and less than a 5% one would, so the buy bound binds as well.
        vm.deal(address(md), 2 ether);
        uint160 pupateBefore = _sqrtPrice(key);
        uint160 imdBefore = _sqrtPrice(imdKey);
        vm.prank(keeper);
        md.convert();
        // Selling PUPATE lifts its sqrt price by at most sqrt(1.05); buying IMD lowers that pool's by at most
        // sqrt(0.985), which the contract rounds in its own favour to 0.9925.
        assertLe(uint256(_sqrtPrice(key)), uint256(pupateBefore) * 10_247 / 10_000 + 1);
        assertGe(uint256(_sqrtPrice(imdKey)), uint256(imdBefore) * 9_925 / 10_000);
        assertGt(md.ethPot(), 0, "the buy bound held ETH back");
    }

    function test_convertLeavesWhatTheBoundRefuses() public {
        _bigPot();
        vm.prank(miner);
        md.stake(_ids(1));
        // Thin the IMD pool to 2% of its depth: a 1.5% move of its price then absorbs about 0.015 ETH, less
        // than the sale brings, so both bounds refuse part of what is offered.
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
        assertEq(
            uint256(_sqrtPrice(imdKey)),
            uint256(imdBefore) * 9_925 / 10_000,
            "the buy stopped at its bound: sqrt(0.985), rounded in the contract's favour"
        );
        uint256 credited = out - out * 50 / 10_000;
        assertEq(md.imdOwed(), credited, "the stakers are credited only what was bought");
        assertEq(imd.balanceOf(address(md)), credited);
        // Nothing moves the pools back between the calls. Once the spacing has passed and the IMD pool
        // is deep again, the next call sells another 5% window of the launch pool from the price the
        // first one left and spends the waiting ETH together with the new.
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

    /// @dev Audit M-1: the IMD leg's bound is taken from the spot of the moment, which a caller can move
    /// first. With 3 ETH waiting (3% of the IMD pool's depth), a 60 ETH front-run netted the attacker
    /// 0.826 ETH under a 500 bps bound. Under `BUY_IMPACT_BPS` a conversion moves the pool's ETH depth by at
    /// most 0.76%, less than the 1% fee the attacker pays the pool's liquidity on each side, so no front-run
    /// size pays.
    function test_sandwichingAPublicConvertDoesNotPay() public {
        vm.deal(address(md), 3 ether);
        // The honest conversion, on a copy of the state: 192 IMD for 0.763 ETH.
        uint256 copy = vm.snapshotState();
        uint256 bought = md.convert();
        uint256 honestRate = bought * 1e18 / (3 ether - address(md).balance);
        vm.revertToState(copy);
        uint256[7] memory fronts =
            [uint256(1 ether), 3 ether, 10 ether, 30 ether, 60 ether, 100 ether, 400 ether];
        for (uint256 i; i < fronts.length; i++) {
            copy = vm.snapshotState();
            uint256 eth0 = address(this).balance;
            uint256 imd0 = imd.balanceOf(address(this));
            _swap(router, imdKey, true, -int256(fronts[i])); // front-run: buy IMD (flash-borrowed ETH would do)
            uint256 got = imd.balanceOf(address(this)) - imd0;
            // Anyone may call; the caller's 0.5% IMD reward is the attacker's, as it would be any caller's.
            bought = md.convert();
            uint256 rate = bought * 1e18 / (3 ether - address(md).balance);
            _swap(router, imdKey, false, -int256(got)); // back-run: sell the same IMD
            assertLe(address(this).balance, eth0, "the sandwich costs the attacker ETH");
            if (fronts[i] == 60 ether) {
                // The audit's case. The stakers' rate in a sandwiched conversion is set by the size of the
                // front-run, not by the bound: 39.6% of the honest IMD per ETH under 500 bps, 39.35% now. The
                // bound caps the ETH exposed to it (1.22 of the 3 ETH here; all 3 before), and the rest waits.
                assertGe(rate * 100, honestRate * 39, "the stakers' rate the run justifies");
                assertGt(md.ethPot(), 1.7 ether, "most of the ETH waits for a conversion nobody sandwiched");
            }
            vm.revertToState(copy);
        }
    }

    /// @dev Audit M-1, inside a mint: a contract miner front-runs from its receiver hook, which runs before
    /// the duties, so it sandwiches the conversion its own mint runs. It netted 0.827 ETH under 500 bps.
    function test_aMinerSandwichingItsOwnDutyConversionDoesNotPay() public {
        _mintMany(3); // gas is dear: 105,000 PUPATE wait in the pot, a conversion is due
        vm.deal(address(md), 3 ether); // and ETH waits, as above
        SandwichMiner sm = new SandwichMiner(md, router, token, imd, imdKey);
        deal(address(token), address(sm), 1_000_000 ether);
        vm.deal(address(sm), 60 ether);
        vm.fee(1 gwei); // gas is cheap: the mint runs its duties
        vm.roll(block.number + 1);
        vm.warp(block.timestamp + 90);
        uint256 a = _anchor();
        uint256 n = _proof(address(sm), a);
        sm.run(a, n, 60 ether);
        assertEq(md.lastConvertBlock(), block.number, "the duty converted inside the mint");
        assertLe(address(sm).balance, 60 ether, "the miner ends with no more ETH than it started with");
    }
}
