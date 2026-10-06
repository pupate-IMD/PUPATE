// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {ItemType, OrderType} from "seaport-types/src/lib/ConsiderationEnums.sol";
import {Order, OrderComponents, OrderParameters} from "seaport-types/src/lib/ConsiderationStructs.sol";
import {SeatListing} from "../../src/cocoon/SeatListing.sol";

contract SeatListingTest is Test {
    address constant OFFERER = address(0xC0C0);
    address constant COLLECTION = 0x0000eC93127BAA929E58E97dd0095A2BFb38ec1D;
    uint256 constant TOKEN = 1376;
    uint40 constant T = 1_800_000_000;

    function _terms() internal pure returns (SeatListing.Terms memory t) {
        t.cost = 2.8 ether;
        t.startX = 15_000;
        t.endX = 11_000;
        t.decay = 14 days;
        t.boughtAt = T;
    }

    function test_prices() public pure {
        assertEq(SeatListing.startPrice(_terms()), 4.2 ether);
        assertEq(SeatListing.endPrice(_terms()), 3.08 ether);
    }

    function test_theDescendingOrder() public pure {
        Order[] memory o = SeatListing.orders(OFFERER, COLLECTION, TOKEN, _terms());
        assertEq(o.length, 2);
        OrderParameters memory p = o[0].parameters;

        assertEq(p.offerer, OFFERER);
        assertEq(p.zone, address(0));
        assertEq(p.offer.length, 1);
        assertEq(uint8(p.offer[0].itemType), uint8(ItemType.ERC721));
        assertEq(p.offer[0].token, COLLECTION);
        assertEq(p.offer[0].identifierOrCriteria, TOKEN);
        assertEq(p.offer[0].startAmount, 1);
        assertEq(p.offer[0].endAmount, 1);

        assertEq(p.consideration.length, 1);
        assertEq(uint8(p.consideration[0].itemType), uint8(ItemType.NATIVE));
        assertEq(p.consideration[0].token, address(0));
        assertEq(p.consideration[0].identifierOrCriteria, 0);
        assertEq(p.consideration[0].startAmount, 4.2 ether);
        assertEq(p.consideration[0].endAmount, 3.08 ether);
        assertEq(p.consideration[0].recipient, OFFERER);

        assertEq(uint8(p.orderType), uint8(OrderType.FULL_OPEN));
        assertEq(p.startTime, T);
        assertEq(p.endTime, T + 14 days);
        assertEq(p.zoneHash, bytes32(0));
        assertEq(p.salt, uint256(keccak256(abi.encode(TOKEN, T, uint256(0)))));
        assertEq(p.conduitKey, bytes32(0));
        assertEq(p.totalOriginalConsiderationItems, 1);
        assertEq(o[0].signature.length, 0);
    }

    function test_theFlatTailOrder() public pure {
        Order[] memory o = SeatListing.orders(OFFERER, COLLECTION, TOKEN, _terms());
        OrderParameters memory p = o[1].parameters;

        assertEq(p.consideration[0].startAmount, 3.08 ether);
        assertEq(p.consideration[0].endAmount, 3.08 ether);
        assertEq(p.startTime, T + 14 days);
        assertEq(p.endTime, T + 14 days + 3650 days);
        assertEq(p.salt, uint256(keccak256(abi.encode(TOKEN, T, uint256(1)))));
        assertEq(p.offer[0].identifierOrCriteria, TOKEN);
        assertEq(uint8(p.orderType), uint8(OrderType.FULL_OPEN));
        assertEq(o[1].signature.length, 0);
    }

    function test_componentsMatchTheOrdersFieldForField() public pure {
        Order[] memory o = SeatListing.orders(OFFERER, COLLECTION, TOKEN, _terms());
        OrderComponents[] memory c = SeatListing.components(OFFERER, COLLECTION, TOKEN, _terms(), 7);
        assertEq(c.length, 2);
        for (uint256 i; i < 2; i++) {
            OrderParameters memory p = o[i].parameters;
            assertEq(c[i].offerer, p.offerer);
            assertEq(c[i].zone, p.zone);
            assertEq(keccak256(abi.encode(c[i].offer)), keccak256(abi.encode(p.offer)));
            assertEq(keccak256(abi.encode(c[i].consideration)), keccak256(abi.encode(p.consideration)));
            assertEq(uint8(c[i].orderType), uint8(p.orderType));
            assertEq(c[i].startTime, p.startTime);
            assertEq(c[i].endTime, p.endTime);
            assertEq(c[i].zoneHash, p.zoneHash);
            assertEq(c[i].salt, p.salt);
            assertEq(c[i].conduitKey, p.conduitKey);
            assertEq(c[i].counter, 7);
        }
    }

    function test_differentPurchasesOfTheSameSeatGetDifferentSalts() public pure {
        SeatListing.Terms memory later = _terms();
        later.boughtAt = T + 1;
        Order[] memory a = SeatListing.orders(OFFERER, COLLECTION, TOKEN, _terms());
        Order[] memory b = SeatListing.orders(OFFERER, COLLECTION, TOKEN, later);
        assertTrue(a[0].parameters.salt != b[0].parameters.salt);
        assertTrue(a[1].parameters.salt != b[1].parameters.salt);
        assertTrue(a[0].parameters.salt != a[1].parameters.salt);
    }
}
