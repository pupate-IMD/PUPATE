// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {SeaportInterface} from "seaport-types/src/interfaces/SeaportInterface.sol";
import {
    AdvancedOrder,
    CriteriaResolver,
    Order,
    OrderComponents,
    OrderParameters
} from "seaport-types/src/lib/ConsiderationStructs.sol";
import {Cocoon} from "../../src/Cocoon.sol";
import {FloorFeed} from "../../src/FloorFeed.sol";
import {IERC20Minimal} from "../../src/interfaces/IERC20Minimal.sol";
import {IERC721Minimal} from "../../src/interfaces/IERC721Minimal.sol";
import {OracleAttestation} from "../../src/oracle/OracleAttestation.sol";
import {SeatListing} from "../../src/cocoon/SeatListing.sol";

/// @dev Runs only with MAINNET_RPC_URL set. Proves Cocoon against the live Seaport 1.6 and the
/// live collection: buys a real listing, publishes its two orders, and sells through the falling
/// one. This is the gate for Plan 4.
contract CocoonSeaportForkTest is Test {
    address constant SEAPORT = 0x0000000000000068F116a894984e2DB1123eB395;
    address constant COLLECTION = 0x0000eC93127BAA929E58E97dd0095A2BFb38ec1D;
    address constant POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    address constant IMD = 0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7;
    uint256 constant SEAT = 1376;
    uint256 constant ATTESTER_KEY = 0xA11CE;
    bytes32 constant QUESTION = keccak256("floor question");

    bool ready;
    FloorFeed feed;
    Cocoon cocoon;
    IERC721Minimal collection = IERC721Minimal(COLLECTION);
    SeaportInterface seaport = SeaportInterface(SEAPORT);
    address owner = makeAddr("timelock");
    address keeper = makeAddr("keeper");
    address buyer = makeAddr("buyer");
    CriteriaResolver[] noResolvers;

    function setUp() public {
        string memory url = vm.envOr("MAINNET_RPC_URL", string(""));
        if (bytes(url).length == 0) return;
        vm.createSelectFork(url);
        ready = true;

        feed = new FloorFeed(owner, vm.addr(ATTESTER_KEY), 1);
        vm.prank(owner);
        feed.setQuestion(QUESTION);
        cocoon = new Cocoon(
            owner,
            makeAddr("developer"),
            makeAddr("operator"),
            collection,
            seaport,
            IPoolManager(POOL_MANAGER),
            feed,
            IERC20Minimal(IMD)
        );
        vm.deal(keeper, 10 ether);
        vm.deal(buyer, 10 ether);
        vm.deal(address(this), 100 ether);
    }

    function test_buysARealListingPublishesItsOrdersAndSellsThroughOne() public {
        if (!ready) {
            vm.skip(true);
            return;
        }
        address holder = collection.ownerOf(SEAT);
        OrderParameters memory listing = _holderLists(holder, 2.8 ether);

        _report(2.8 ether);
        cocoon.depositTax{value: 10 ether}();
        uint256 holderBefore = holder.balance;

        vm.prank(keeper);
        cocoon.buySeat(AdvancedOrder(listing, 1, 1, "", ""), noResolvers);

        assertEq(collection.ownerOf(SEAT), address(cocoon));
        assertEq(holder.balance, holderBefore + 2.8 ether);
        (uint128 cost,,,,, bool held,) = cocoon.seats(SEAT);
        assertEq(cost, 2.8 ether);
        assertTrue(held);
        _assertOurOrdersAreValidated();

        // A week later a buyer takes the falling order at its current price.
        vm.warp(block.timestamp + 7 days);
        uint256 burnBefore = cocoon.burnPot();
        _buyerTakesTheFallingOrder();
        assertEq(collection.ownerOf(SEAT), buyer);
        assertGt(cocoon.burnPot(), burnBefore + 3.6 ether);

        cocoon.settleSeat(SEAT);
        assertEq(cocoon.heldCount(), 0);
        _assertTheTailIsCancelled();
    }

    // ------------------------------------------------------------------ helpers

    function _holderLists(address holder, uint256 price) internal returns (OrderParameters memory) {
        Order[] memory listing = new Order[](1);
        listing[0] = Order(
            SeatListing.parameters(
                holder,
                COLLECTION,
                SEAT,
                SeatListing.Terms(price, 10_000, 10_000, 7 days, uint40(block.timestamp), 0),
                0
            ),
            ""
        );
        vm.startPrank(holder);
        collection.setApprovalForAll(SEAPORT, true);
        assertTrue(seaport.validate(listing));
        vm.stopPrank();
        return listing[0].parameters;
    }

    function _ourTerms() internal view returns (SeatListing.Terms memory) {
        (uint128 cost, uint40 boughtAt, uint16 startX, uint16 endX, uint32 decay,, uint16 round) =
            cocoon.seats(SEAT);
        return SeatListing.Terms(cost, startX, endX, decay, boughtAt, round);
    }

    function _assertOurOrdersAreValidated() internal view {
        OrderComponents[] memory ours =
            SeatListing.components(address(cocoon), COLLECTION, SEAT, _ourTerms(), 0);
        for (uint256 i; i < 2; i++) {
            (bool isValidated, bool isCancelled,,) = seaport.getOrderStatus(seaport.getOrderHash(ours[i]));
            assertTrue(isValidated, "validated on the live Seaport");
            assertFalse(isCancelled);
        }
    }

    function _buyerTakesTheFallingOrder() internal {
        Order[] memory orders = SeatListing.orders(address(cocoon), COLLECTION, SEAT, _ourTerms());
        vm.prank(buyer);
        assertTrue(
            seaport.fulfillAdvancedOrder{value: 3.65 ether}(
                AdvancedOrder(orders[0].parameters, 1, 1, "", ""), noResolvers, bytes32(0), buyer
            )
        );
    }

    function _assertTheTailIsCancelled() internal view {
        OrderComponents[] memory ours =
            SeatListing.components(address(cocoon), COLLECTION, SEAT, _ourTerms(), 0);
        (, bool cancelled,,) = seaport.getOrderStatus(seaport.getOrderHash(ours[1]));
        assertTrue(cancelled, "the flat tail is cancelled");
    }

    function _report(uint256 floorWei) internal {
        OracleAttestation.Attestation memory a;
        a.requestId = bytes32(block.timestamp);
        a.chainId = 1;
        a.questionHash = QUESTION;
        a.answerType = OracleAttestation.ANSWER_TYPE_UINT256;
        a.answer = abi.encode(floorWei);
        a.panelSize = 5;
        a.quorum = 4;
        a.agreed = 4;
        a.issuedAt = uint64(block.timestamp);
        a.expiresAt = uint64(block.timestamp + 24 hours);
        bytes32 sep = OracleAttestation.domainSeparator(block.chainid, address(feed));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ATTESTER_KEY, OracleAttestation.digest(sep, a));
        feed.report(a, abi.encodePacked(r, s, v));
    }
}
