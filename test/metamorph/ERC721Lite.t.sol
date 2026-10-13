// test/metamorph/ERC721Lite.t.sol
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {ERC721Lite} from "../../src/metamorph/ERC721Lite.sol";

contract Lite is ERC721Lite {
    bool public blockTransfers;

    constructor() ERC721Lite("Lite", "LT") {}

    function mint(address to, uint256 id) external {
        _mint(to, id);
    }

    function setBlock(bool v) external {
        blockTransfers = v;
    }

    function tokenURI(uint256) public pure override returns (string memory) {
        return "uri";
    }

    function _beforeTransfer(uint256) internal view override {
        require(!blockTransfers, "blocked");
    }
}

contract Receiver {
    bytes4 public answer = 0x150b7a02;

    function setAnswer(bytes4 a) external {
        answer = a;
    }

    function onERC721Received(address, address, uint256, bytes calldata) external view returns (bytes4) {
        return answer;
    }
}

contract ERC721LiteTest is Test {
    Lite lite;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        lite = new Lite();
    }

    function test_mintSetsOwnerBalanceAndEmits() public {
        vm.expectEmit(true, true, true, true);
        emit ERC721Lite.Transfer(address(0), alice, 1);
        lite.mint(alice, 1);
        assertEq(lite.ownerOf(1), alice);
        assertEq(lite.balanceOf(alice), 1);
    }

    function test_mintRefusesZeroAndDuplicates() public {
        vm.expectRevert(ERC721Lite.ZeroAddress.selector);
        lite.mint(address(0), 1);
        lite.mint(alice, 1);
        vm.expectRevert(ERC721Lite.AlreadyMinted.selector);
        lite.mint(bob, 1);
    }

    function test_ownerOfUnmintedReverts() public {
        vm.expectRevert(ERC721Lite.NotMinted.selector);
        lite.ownerOf(7);
    }

    function test_transferByOwnerApprovedAndOperator() public {
        lite.mint(alice, 1);
        lite.mint(alice, 2);
        lite.mint(alice, 3);
        vm.prank(alice);
        lite.transferFrom(alice, bob, 1);
        assertEq(lite.ownerOf(1), bob);
        vm.prank(alice);
        lite.approve(bob, 2);
        vm.prank(bob);
        lite.transferFrom(alice, bob, 2);
        assertEq(lite.getApproved(2), address(0), "approval cleared");
        vm.prank(alice);
        lite.setApprovalForAll(bob, true);
        vm.prank(bob);
        lite.transferFrom(alice, bob, 3);
        assertEq(lite.balanceOf(alice), 0);
        assertEq(lite.balanceOf(bob), 3);
    }

    function test_transferRefusesStrangersWrongFromAndZeroTo() public {
        lite.mint(alice, 1);
        vm.prank(bob);
        vm.expectRevert(ERC721Lite.NotAuthorized.selector);
        lite.transferFrom(alice, bob, 1);
        vm.prank(alice);
        vm.expectRevert(ERC721Lite.NotOwner.selector);
        lite.transferFrom(bob, alice, 1);
        vm.prank(alice);
        vm.expectRevert(ERC721Lite.ZeroAddress.selector);
        lite.transferFrom(alice, address(0), 1);
    }

    function test_safeTransferChecksTheReceiver() public {
        Receiver good = new Receiver();
        lite.mint(alice, 1);
        vm.prank(alice);
        lite.safeTransferFrom(alice, address(good), 1);
        assertEq(lite.ownerOf(1), address(good));
        Receiver bad = new Receiver();
        bad.setAnswer(0xdeadbeef);
        lite.mint(alice, 2);
        vm.prank(alice);
        vm.expectRevert(ERC721Lite.UnsafeRecipient.selector);
        lite.safeTransferFrom(alice, address(bad), 2);
        vm.prank(alice);
        vm.expectRevert(ERC721Lite.UnsafeRecipient.selector);
        lite.safeTransferFrom(alice, address(bad), 2, "x");
    }

    function test_mintToContractWithoutReceiverReverts() public {
        vm.expectRevert(ERC721Lite.UnsafeRecipient.selector);
        lite.mint(address(this), 1);
    }

    function test_hookRunsBeforeEveryTransferButNotOnMint() public {
        lite.setBlock(true);
        lite.mint(alice, 1);
        vm.prank(alice);
        vm.expectRevert("blocked");
        lite.transferFrom(alice, bob, 1);
        vm.prank(alice);
        vm.expectRevert("blocked");
        lite.safeTransferFrom(alice, bob, 1);
    }

    function test_supportsTheThreeInterfaces() public view {
        assertTrue(lite.supportsInterface(0x01ffc9a7));
        assertTrue(lite.supportsInterface(0x80ac58cd));
        assertTrue(lite.supportsInterface(0x5b5e139f));
        assertFalse(lite.supportsInterface(0xffffffff));
    }
}
