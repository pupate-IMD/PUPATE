// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ItemType, OrderType} from "seaport-types/src/lib/ConsiderationEnums.sol";
import {
    AdvancedOrder,
    CriteriaResolver,
    Order,
    OrderParameters
} from "seaport-types/src/lib/ConsiderationStructs.sol";
import {Cocoon} from "../../src/Cocoon.sol";
import {SeatListing} from "../../src/cocoon/SeatListing.sol";
import {MockERC721} from "../mocks/MockERC721.sol";
import {CocoonFixture} from "../utils/CocoonFixture.sol";

contract CocoonMarketTest is CocoonFixture {
    uint256 constant SEAT = 7;
    CriteriaResolver[] internal noResolvers;

    function setUp() public override {
        super.setUp();
        collection.mint(seller, SEAT);
        vm.prank(seller);
        collection.setApprovalForAll(address(seaport), true);
        _setFloor(2.8 ether);
        _deposit(10 ether); // seat pot 5.95 ETH
    }

    // ------------------------------------------------------------------ helpers

    /// @dev A third party's listing, built with the same library: flat when startX == endX.
    function _listing(
        address offerer,
        uint256 tokenId,
        uint256 price,
        uint16 startX,
        uint16 endX,
        uint32 decay
    ) internal returns (AdvancedOrder memory) {
        SeatListing.Terms memory t = SeatListing.Terms(
            price, startX, endX, decay, uint40(block.timestamp), uint16(block.number)
        );
        Order[] memory orders = new Order[](1);
        orders[0] = Order(SeatListing.parameters(offerer, address(collection), tokenId, t, 0), "");
        vm.prank(offerer);
        seaport.validate(orders);
        return AdvancedOrder(orders[0].parameters, 1, 1, "", "");
    }

    function _flat(uint256 price) internal returns (AdvancedOrder memory) {
        return _listing(seller, SEAT, price, 10_000, 10_000, 7 days);
    }

    function _ourOrders(uint256 tokenId) internal view returns (Order[] memory) {
        (uint128 cost, uint40 boughtAt, uint16 startX, uint16 endX, uint32 decay,, uint16 round) =
            cocoon.seats(tokenId);
        return SeatListing.orders(
            address(cocoon),
            address(collection),
            tokenId,
            SeatListing.Terms(cost, startX, endX, decay, boughtAt, round)
        );
    }

    function _buy(AdvancedOrder memory order) internal {
        vm.prank(keeper);
        cocoon.buySeat(order, noResolvers);
    }

    // ------------------------------------------------------------------ buying

    function test_buysAListingAtTheFloorListsItAndPaysTheCaller() public {
        AdvancedOrder memory order = _flat(2.8 ether);
        uint256 potBefore = cocoon.seatPot();
        uint256 reward = 2.8 ether * 50 / 10_000;

        vm.expectEmit(true, true, false, true, address(cocoon));
        emit Cocoon.SeatBought(SEAT, 2.8 ether, keeper, reward);
        _buy(order);

        assertEq(collection.ownerOf(SEAT), address(cocoon));
        assertEq(seller.balance, 100 ether + 2.8 ether);
        assertEq(keeper.balance, 100 ether + reward);
        assertEq(cocoon.seatPot(), potBefore - 2.8 ether - reward);
        assertEq(cocoon.heldCount(), 1);
        assertEq(cocoon.heldCost(), 2.8 ether);
        (uint128 cost, uint40 boughtAt, uint16 startX, uint16 endX, uint32 decay, bool held, uint16 round) =
            cocoon.seats(SEAT);
        assertEq(cost, 2.8 ether);
        assertEq(boughtAt, block.timestamp);
        assertEq(startX, 15_000);
        assertEq(endX, 11_000);
        assertEq(decay, 14 days);
        assertTrue(held);
        assertEq(round, 0);
        _assertBalanceIdentity();

        Order[] memory ours = _ourOrders(SEAT);
        assertTrue(seaport.validated(seaport.hashOf(ours[0].parameters)), "falling order validated");
        assertTrue(seaport.validated(seaport.hashOf(ours[1].parameters)), "flat tail validated");
        assertEq(ours[0].parameters.consideration[0].startAmount, 4.2 ether);
        assertEq(ours[0].parameters.consideration[0].endAmount, 3.08 ether);
    }

    function test_buySeatRefundStaysInTheSeatPot() public {
        // A listing falling from 2.88 to 2.4 ETH over 7 days. The vault sends the higher end, which
        // is what the tolerance is checked against, and gets the difference back.
        AdvancedOrder memory order = _listing(seller, SEAT, 2.4 ether, 12_000, 10_000, 7 days);
        vm.warp(block.timestamp + 3.5 days);
        _setFloor(2.8 ether); // the earlier report has lapsed by now
        uint256 current = seaport.currentAmount(
            2.88 ether, 2.4 ether, order.parameters.startTime, order.parameters.endTime, true
        );
        assertLt(current, 2.88 ether);
        uint256 potBefore = cocoon.seatPot();
        uint256 burnBefore = cocoon.burnPot();
        uint256 reward = current * 50 / 10_000; // on what was spent, not on the ceiling

        _buy(order);

        (uint128 cost,,,,,,) = cocoon.seats(SEAT);
        assertEq(cost, current, "the seat costs what Seaport took, not what was sent");
        assertEq(cocoon.seatPot(), potBefore - current - reward);
        assertEq(cocoon.burnPot(), burnBefore, "the refund is not sale proceeds");
        _assertBalanceIdentity();
    }

    function test_rejectsOrdersThatAreNotOneSeatForEth() public {
        MockERC721 other = new MockERC721();
        other.mint(seller, 1);
        AdvancedOrder memory order;

        order = _flat(2.8 ether);
        order.parameters.offer[0].token = address(other);
        _expectBad(order, Cocoon.BadOrder.selector);

        order = _flat(2.8 ether);
        order.parameters.offer[0].itemType = ItemType.ERC721_WITH_CRITERIA;
        _expectBad(order, Cocoon.BadOrder.selector);

        order = _flat(2.8 ether);
        order.parameters.consideration[0].itemType = ItemType.ERC20;
        order.parameters.consideration[0].token = address(imd);
        _expectBad(order, Cocoon.BadOrder.selector);

        order = _flat(2.8 ether);
        order.denominator = 2;
        _expectBad(order, Cocoon.BadOrder.selector);

        order = _flat(2.8 ether);
        order.parameters.orderType = OrderType.PARTIAL_OPEN;
        _expectBad(order, Cocoon.BadOrder.selector);

        order = _flat(2.8 ether);
        order.parameters.offer[0].endAmount = 2;
        _expectBad(order, Cocoon.BadOrder.selector);
    }

    function test_rejectsPricesAboveTheToleranceAndStaleFloors() public {
        _expectBad(_flat(2.94 ether + 1), Cocoon.PriceAboveFloor.selector);

        _letTheFloorGoStale();
        _expectBad(_flat(2.8 ether), Cocoon.FloorNotFresh.selector);
    }

    function test_buysRightAtTheTolerance() public {
        _buy(_flat(2.94 ether));
        assertEq(collection.ownerOf(SEAT), address(cocoon));
    }

    function test_rejectsAPurchaseThePotCannotCover() public {
        // The seat pot holds 5.95 ETH: two seats at 2.8 plus rewards fit, a third does not.
        _buy(_flat(2.8 ether));
        collection.mint(seller, SEAT + 1);
        _buy(_listing(seller, SEAT + 1, 2.8 ether, 10_000, 10_000, 7 days));
        collection.mint(seller, SEAT + 2);
        _expectBad(_listing(seller, SEAT + 2, 2.8 ether, 10_000, 10_000, 7 days), Cocoon.PotTooSmall.selector);
        assertLt(cocoon.seatPot(), 2.8 ether);
    }

    function test_reentryDuringThePurchaseIsRejected() public {
        AdvancedOrder memory order = _flat(2.8 ether);
        seaport.setReentry(address(cocoon), abi.encodeCall(Cocoon.buySeat, (order, noResolvers)));
        vm.prank(keeper);
        vm.expectRevert();
        cocoon.buySeat(order, noResolvers);
        assertEq(collection.ownerOf(SEAT), seller);
    }

    function test_unsolicitedSafeTransfersAreRejected() public {
        vm.prank(seller);
        vm.expectRevert();
        collection.safeTransferFrom(seller, address(cocoon), SEAT);
        assertEq(collection.ownerOf(SEAT), seller);
    }

    function test_adoptNeedsAHeldUnrecordedSeatAndAFreshFloor() public {
        vm.expectRevert(Cocoon.NotHeld.selector);
        cocoon.adopt(SEAT);

        vm.prank(seller);
        collection.transferFrom(seller, address(cocoon), SEAT);
        _letTheFloorGoStale();
        vm.expectRevert(Cocoon.FloorNotFresh.selector);
        cocoon.adopt(SEAT);

        _setFloor(2.8 ether);
        vm.expectEmit(true, false, false, true, address(cocoon));
        emit Cocoon.SeatAdopted(SEAT, 2.8 ether);
        cocoon.adopt(SEAT);
        assertEq(cocoon.heldCount(), 1);

        vm.expectRevert(Cocoon.AlreadyHeld.selector);
        cocoon.adopt(SEAT);
    }

    // ------------------------------------------------------------------ selling and settling

    function test_aThirdPartyBuysOurListingAndSettleFixesTheBooks() public {
        _buy(_flat(2.8 ether));
        Order[] memory ours = _ourOrders(SEAT);
        address buyer = makeAddr("buyer");
        vm.deal(buyer, 10 ether);

        vm.expectRevert(Cocoon.StillHeld.selector);
        cocoon.settleSeat(SEAT);

        vm.warp(block.timestamp + 7 days);
        uint256 price = seaport.currentAmount(
            4.2 ether, 3.08 ether, ours[0].parameters.startTime, ours[0].parameters.endTime, true
        );
        assertApproxEqAbs(price, 3.64 ether, 1);
        uint256 burnBefore = cocoon.burnPot();

        vm.prank(buyer);
        seaport.fulfillAdvancedOrder{value: price}(
            AdvancedOrder(ours[0].parameters, 1, 1, "", ""), noResolvers, bytes32(0), buyer
        );

        assertEq(collection.ownerOf(SEAT), buyer);
        assertEq(cocoon.burnPot(), burnBefore + price, "sale proceeds go to the burn pot");
        assertEq(cocoon.heldCount(), 1, "not yet settled");

        vm.expectEmit(true, false, false, true, address(cocoon));
        emit Cocoon.SeatSold(SEAT, 2.8 ether);
        vm.prank(makeAddr("anyone"));
        cocoon.settleSeat(SEAT);

        assertEq(cocoon.heldCount(), 0);
        assertEq(cocoon.heldCost(), 0);
        (,,,,, bool held,) = cocoon.seats(SEAT);
        assertFalse(held);
        assertTrue(seaport.cancelled(seaport.hashOf(ours[0].parameters)));
        assertTrue(seaport.cancelled(seaport.hashOf(ours[1].parameters)));
        _assertBalanceIdentity();

        vm.expectRevert(Cocoon.NotHeld.selector);
        cocoon.settleSeat(SEAT);
        vm.expectRevert(Cocoon.NotHeld.selector);
        cocoon.settleSeat(999);
    }

    function test_settleAlsoWorksWhenTheSeatWasBurned() public {
        _buy(_flat(2.8 ether));
        vm.prank(address(cocoon));
        collection.burn(SEAT);
        cocoon.settleSeat(SEAT);
        assertEq(cocoon.heldCount(), 0);
    }

    function test_settleCancelsTheOldListingsSoARepurchaseCannotBeSoldAtTheOldPrice() public {
        _buy(_flat(2.8 ether));
        Order[] memory first = _ourOrders(SEAT);
        address buyer = makeAddr("buyer");
        vm.deal(buyer, 10 ether);

        // Sold at the tail price after the decay, then settled.
        vm.warp(block.timestamp + 20 days);
        vm.prank(buyer);
        seaport.fulfillAdvancedOrder{value: 3.08 ether}(
            AdvancedOrder(first[1].parameters, 1, 1, "", ""), noResolvers, bytes32(0), buyer
        );
        cocoon.settleSeat(SEAT);

        // The buyer relists at the floor and the vault buys the same seat back.
        vm.prank(buyer);
        collection.setApprovalForAll(address(seaport), true);
        _setFloor(2.8 ether);
        _deposit(10 ether);
        _buy(_listing(buyer, SEAT, 2.8 ether, 10_000, 10_000, 7 days));
        (,,,,,, uint16 round) = cocoon.seats(SEAT);
        assertEq(round, 1);

        Order[] memory second = _ourOrders(SEAT);
        assertTrue(second[0].parameters.salt != first[0].parameters.salt);
        assertTrue(seaport.validated(seaport.hashOf(second[0].parameters)));

        // The first purchase's flat tail is dead, even though we hold the seat again.
        vm.prank(buyer);
        vm.expectRevert(bytes("mock: not fulfillable"));
        seaport.fulfillAdvancedOrder{value: 3.08 ether}(
            AdvancedOrder(first[1].parameters, 1, 1, "", ""), noResolvers, bytes32(0), buyer
        );
        assertEq(collection.ownerOf(SEAT), address(cocoon));
    }

    function test_settleSeatIsPermissionlessAndFixesTheAverage() public {
        _buy(_flat(2.8 ether));
        collection.mint(seller, SEAT + 1);
        _buy(_listing(seller, SEAT + 1, 2.6 ether, 10_000, 10_000, 7 days));
        assertEq(cocoon.heldCost(), 5.4 ether);

        Order[] memory ours = _ourOrders(SEAT);
        address buyer = makeAddr("buyer");
        vm.deal(buyer, 10 ether);
        vm.warp(block.timestamp + 1 days);
        uint256 price = seaport.currentAmount(
            4.2 ether, 3.08 ether, ours[0].parameters.startTime, ours[0].parameters.endTime, true
        );
        vm.prank(buyer);
        seaport.fulfillAdvancedOrder{value: price}(
            AdvancedOrder(ours[0].parameters, 1, 1, "", ""), noResolvers, bytes32(0), buyer
        );

        vm.prank(makeAddr("a stranger"));
        cocoon.settleSeat(SEAT);
        assertEq(cocoon.heldCount(), 1);
        assertEq(cocoon.heldCost(), 2.6 ether);
    }

    function _expectBad(AdvancedOrder memory order, bytes4 err) internal {
        vm.prank(keeper);
        vm.expectRevert(err);
        cocoon.buySeat(order, noResolvers);
    }
}
