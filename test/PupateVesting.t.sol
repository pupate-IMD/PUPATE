// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20Minimal} from "../src/interfaces/IERC20Minimal.sol";
import {PupateToken} from "../src/PupateToken.sol";
import {PupateVesting} from "../src/PupateVesting.sol";

contract PupateVestingTest is Test {
    uint64 constant T0 = 1_800_000_000;
    uint64 constant START = T0 + 1 days;
    uint64 constant DURATION = 365 days;
    uint256 constant GRANT = 50_000_000 ether;

    PupateToken token;
    PupateVesting vesting;
    address beneficiary = makeAddr("developer");

    function setUp() public {
        vm.warp(T0);
        token = new PupateToken();
        vesting = new PupateVesting(IERC20Minimal(address(token)), beneficiary, START, DURATION);
        token.transfer(address(vesting), GRANT);
    }

    function test_constructorRejectsBadArguments() public {
        vm.expectRevert(PupateVesting.ZeroAddress.selector);
        new PupateVesting(IERC20Minimal(address(0)), beneficiary, START, DURATION);
        vm.expectRevert(PupateVesting.ZeroAddress.selector);
        new PupateVesting(IERC20Minimal(address(token)), address(0), START, DURATION);
        vm.expectRevert(PupateVesting.BadSchedule.selector);
        new PupateVesting(IERC20Minimal(address(token)), beneficiary, START, 0);
    }

    function test_nothingVestsBeforeTheStart() public {
        assertEq(vesting.vested(), 0);
        assertEq(vesting.releasable(), 0);
        vesting.release();
        assertEq(token.balanceOf(beneficiary), 0);
        assertEq(token.balanceOf(address(vesting)), GRANT);
    }

    function test_halfVestsHalfway() public {
        vm.warp(START + DURATION / 2);
        assertEq(vesting.vested(), GRANT / 2);
        vm.expectEmit(false, false, false, true, address(vesting));
        emit PupateVesting.Released(GRANT / 2);
        vesting.release();
        assertEq(token.balanceOf(beneficiary), GRANT / 2);
        assertEq(vesting.released(), GRANT / 2);
    }

    function test_everythingVestsAtTheEnd() public {
        vm.warp(START + DURATION / 2);
        vesting.release();
        vm.warp(START + DURATION);
        assertEq(vesting.releasable(), GRANT / 2);
        vesting.release();
        assertEq(token.balanceOf(beneficiary), GRANT);
        assertEq(token.balanceOf(address(vesting)), 0);

        vm.warp(START + 10 * DURATION);
        assertEq(vesting.releasable(), 0);
    }

    function test_tokensAddedLaterVestOnTheSameCurve() public {
        vm.warp(START + DURATION / 2);
        vesting.release();
        token.transfer(address(vesting), 10_000_000 ether);
        assertEq(vesting.vested(), (GRANT + 10_000_000 ether) / 2);
        assertEq(vesting.releasable(), 5_000_000 ether);
    }

    function test_releaseIsIdempotent() public {
        vm.warp(START + DURATION / 4);
        vesting.release();
        uint256 got = token.balanceOf(beneficiary);
        vesting.release();
        assertEq(token.balanceOf(beneficiary), got);
    }

    function test_anyoneMayRelease() public {
        vm.warp(START + DURATION / 4);
        vm.prank(makeAddr("stranger"));
        vesting.release();
        assertEq(token.balanceOf(beneficiary), GRANT / 4);
        assertEq(token.balanceOf(makeAddr("stranger")), 0);
    }

    function test_onlyTheBeneficiaryChangesTheBeneficiary() public {
        address next = makeAddr("next");
        vm.expectRevert(PupateVesting.NotBeneficiary.selector);
        vesting.setBeneficiary(next);

        vm.prank(beneficiary);
        vm.expectRevert(PupateVesting.ZeroAddress.selector);
        vesting.setBeneficiary(address(0));

        vm.prank(beneficiary);
        vesting.setBeneficiary(next);
        assertEq(vesting.beneficiary(), next);

        vm.warp(START + DURATION);
        vesting.release();
        assertEq(token.balanceOf(next), GRANT);
    }

    function testFuzz_vestedNeverExceedsTheBalanceAndNeverFalls(uint256 a, uint256 b) public {
        a = bound(a, 0, 2 * DURATION);
        b = bound(b, a, 2 * DURATION);
        vm.warp(START + a);
        uint256 early = vesting.vested();
        vm.warp(START + b);
        uint256 late = vesting.vested();
        assertLe(early, late);
        assertLe(late, GRANT);
    }
}
