// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Cocoon} from "../../src/Cocoon.sol";
import {WorkerAuthorization} from "../../src/cocoon/WorkerAuthorization.sol";
import {CocoonFixture} from "../utils/CocoonFixture.sol";

contract CocoonPairingTest is CocoonFixture {
    bytes4 constant VALID = 0x1626ba7e;
    bytes4 constant INVALID = 0xffffffff;

    function setUp() public override {
        super.setUp();
        _setFloor(2.8 ether);
        _giveSeat(1);
    }

    function _auth(uint256 tokenId) internal view returns (WorkerAuthorization.Auth memory a) {
        a.deviceKey = keccak256("device");
        a.wallet = address(cocoon);
        a.tokenId = tokenId;
        a.nonce = keccak256("nonce");
        a.expiresAt = uint64(block.timestamp + 1 hours);
        a.relayOrigin = "https://api.imd.fun";
    }

    function test_operatorApprovesAPairingForAHeldSeat() public {
        WorkerAuthorization.Auth memory a = _auth(1);
        bytes32 expected = WorkerAuthorization.digest(address(collection), a);

        vm.expectEmit(true, true, false, true, address(cocoon));
        emit Cocoon.WorkerAuthorized(1, expected);
        vm.prank(operator);
        bytes32 digest = cocoon.authorizeWorker(a);

        assertEq(digest, expected);
        assertEq(cocoon.isValidSignature(digest, ""), VALID);
        assertEq(cocoon.isValidSignature(digest, hex"deadbeef"), VALID, "the signature bytes do not matter");
        assertEq(cocoon.isValidSignature(keccak256("anything else"), ""), INVALID);
    }

    function test_onlyTheOperator() public {
        vm.expectRevert(Cocoon.NotOperator.selector);
        cocoon.authorizeWorker(_auth(1));
        vm.expectRevert(Cocoon.NotOperator.selector);
        cocoon.revokeWorker(bytes32(0));
    }

    function test_rejectsTheWrongWalletAnExpiredMessageAndAnUnheldSeat() public {
        WorkerAuthorization.Auth memory a = _auth(1);
        a.wallet = operator;
        vm.prank(operator);
        vm.expectRevert(Cocoon.WrongWallet.selector);
        cocoon.authorizeWorker(a);

        a = _auth(1);
        a.expiresAt = uint64(block.timestamp);
        vm.prank(operator);
        vm.expectRevert(Cocoon.Expired.selector);
        cocoon.authorizeWorker(a);

        collection.mint(address(cocoon), 2); // held but never adopted: not on the books
        vm.prank(operator);
        vm.expectRevert(Cocoon.NotHeld.selector);
        cocoon.authorizeWorker(_auth(2));

        vm.prank(operator);
        vm.expectRevert(Cocoon.NotHeld.selector);
        cocoon.authorizeWorker(_auth(3));
    }

    function test_pairingApprovalDiesWithTheSeat() public {
        vm.prank(operator);
        bytes32 digest = cocoon.authorizeWorker(_auth(1));
        assertEq(cocoon.isValidSignature(digest, ""), VALID);

        vm.prank(address(cocoon));
        collection.transferFrom(address(cocoon), makeAddr("buyer"), 1);

        assertEq(cocoon.isValidSignature(digest, ""), INVALID);
    }

    function test_revokeTurnsAnApprovalInvalid() public {
        vm.prank(operator);
        bytes32 digest = cocoon.authorizeWorker(_auth(1));
        vm.expectEmit(true, false, false, true, address(cocoon));
        emit Cocoon.WorkerRevoked(digest);
        vm.prank(operator);
        cocoon.revokeWorker(digest);
        assertEq(cocoon.isValidSignature(digest, ""), INVALID);
    }

    function test_isValidSignatureNeverReverts() public {
        vm.prank(operator);
        bytes32 digest = cocoon.authorizeWorker(_auth(1));
        vm.prank(address(cocoon));
        collection.burn(1);
        assertEq(cocoon.isValidSignature(digest, ""), INVALID);
    }
}
