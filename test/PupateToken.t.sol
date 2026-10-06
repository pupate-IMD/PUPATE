// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {PupateToken} from "../src/PupateToken.sol";

contract PupateTokenTest is Test {
    uint256 constant SUPPLY = 1_000_000_000 ether;

    PupateToken token;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        token = new PupateToken();
    }

    function test_metadata() public view {
        assertEq(token.name(), "Pupate");
        assertEq(token.symbol(), "PUPATE");
        assertEq(token.decimals(), 18);
    }

    function test_wholeSupplyIsMintedToTheDeployer() public view {
        assertEq(token.totalSupply(), SUPPLY);
        assertEq(token.balanceOf(address(this)), SUPPLY);
    }

    function test_transferMovesBalance() public {
        assertTrue(token.transfer(alice, 5 ether));
        assertEq(token.balanceOf(alice), 5 ether);
        assertEq(token.balanceOf(address(this)), SUPPLY - 5 ether);
        assertEq(token.totalSupply(), SUPPLY);
    }

    function test_transferOfMoreThanTheBalanceReverts() public {
        vm.prank(alice);
        vm.expectRevert(PupateToken.InsufficientBalance.selector);
        token.transfer(bob, 1);
    }

    function test_transferToTheZeroAddressReverts() public {
        vm.expectRevert(PupateToken.ZeroAddress.selector);
        token.transfer(address(0), 1);
    }

    function test_transferFromSpendsTheAllowance() public {
        token.approve(alice, 10 ether);
        vm.prank(alice);
        assertTrue(token.transferFrom(address(this), bob, 4 ether));
        assertEq(token.balanceOf(bob), 4 ether);
        assertEq(token.allowance(address(this), alice), 6 ether);
    }

    function test_transferFromBeyondTheAllowanceReverts() public {
        token.approve(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(PupateToken.InsufficientAllowance.selector);
        token.transferFrom(address(this), bob, 1 ether + 1);
    }

    function test_unlimitedAllowanceIsNotSpent() public {
        token.approve(alice, type(uint256).max);
        vm.prank(alice);
        token.transferFrom(address(this), bob, 4 ether);
        assertEq(token.allowance(address(this), alice), type(uint256).max);
    }

    function test_burnReducesBalanceAndSupply() public {
        token.burn(7 ether);
        assertEq(token.balanceOf(address(this)), SUPPLY - 7 ether);
        assertEq(token.totalSupply(), SUPPLY - 7 ether);
    }

    function test_burnOfMoreThanTheBalanceReverts() public {
        vm.prank(alice);
        vm.expectRevert(PupateToken.InsufficientBalance.selector);
        token.burn(1);
    }

    function test_burnFromSpendsTheAllowance() public {
        token.approve(alice, 10 ether);
        vm.prank(alice);
        token.burnFrom(address(this), 3 ether);
        assertEq(token.totalSupply(), SUPPLY - 3 ether);
        assertEq(token.allowance(address(this), alice), 7 ether);
    }

    function test_burnFromWithoutAllowanceReverts() public {
        vm.prank(alice);
        vm.expectRevert(PupateToken.InsufficientAllowance.selector);
        token.burnFrom(address(this), 1);
    }

    function testFuzz_transferNeverChangesTheSupply(address to, uint256 amount) public {
        vm.assume(to != address(0) && to != address(this));
        amount = bound(amount, 0, SUPPLY);
        token.transfer(to, amount);
        assertEq(token.balanceOf(to) + token.balanceOf(address(this)), SUPPLY);
        assertEq(token.totalSupply(), SUPPLY);
    }
}
