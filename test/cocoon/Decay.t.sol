// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {Decay} from "../../src/cocoon/Decay.sol";

contract DecayTest is Test {
    uint256 constant START = 1 ether;

    function test_startsAtTheStartPrice() public pure {
        assertEq(Decay.price(START, 0), START);
    }

    function test_halvesEveryHalfLife() public pure {
        assertEq(Decay.price(START, Decay.HALF_LIFE), START / 2);
        assertEq(Decay.price(START, 2 * Decay.HALF_LIFE), START / 4);
        assertEq(Decay.price(START, 10 * Decay.HALF_LIFE), START / 1024);
    }

    function test_fallsLinearlyInsideAHalfLife() public pure {
        assertEq(Decay.price(START, Decay.HALF_LIFE / 2), START * 3 / 4);
        assertEq(Decay.price(START, Decay.HALF_LIFE / 4), START * 7 / 8);
        assertEq(Decay.price(START, Decay.HALF_LIFE + Decay.HALF_LIFE / 2), START * 3 / 8);
    }

    function test_isZeroFromTheCutoff() public pure {
        assertGt(Decay.price(START, Decay.CUTOFF - 1), 0);
        assertEq(Decay.price(START, Decay.CUTOFF), 0);
        assertEq(Decay.price(START, 365 days), 0);
    }

    function test_constants() public pure {
        assertEq(Decay.HALF_LIFE, 2 hours);
        assertEq(Decay.CUTOFF, 48 hours);
    }

    function testFuzz_neverRises(uint256 start, uint256 a, uint256 b) public pure {
        start = bound(start, 0, type(uint128).max);
        a = bound(a, 0, 3 days);
        b = bound(b, a, 3 days);
        assertGe(Decay.price(start, a), Decay.price(start, b));
        assertLe(Decay.price(start, a), start);
    }
}
