// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ItemType, OrderType} from "seaport-types/src/lib/ConsiderationEnums.sol";
import {
    ConsiderationItem,
    OfferItem,
    Order,
    OrderComponents,
    OrderParameters
} from "seaport-types/src/lib/ConsiderationStructs.sol";

/// @notice Builds the two Seaport orders Cocoon publishes for every seat it buys: a price that falls
/// from `startX` to `endX` times the purchase cost over `decay`, then a flat tail at `endX` for ten
/// years. Both are signature-free orders that the offerer validates on-chain.
library SeatListing {
    struct Terms {
        uint256 cost;
        uint16 startX;
        uint16 endX;
        uint32 decay;
        uint40 boughtAt;
    }

    uint256 internal constant BPS = 10_000;
    uint256 internal constant TAIL = 3650 days;

    function startPrice(Terms memory t) internal pure returns (uint256) {
        return t.cost * t.startX / BPS;
    }

    function endPrice(Terms memory t) internal pure returns (uint256) {
        return t.cost * t.endX / BPS;
    }

    function salt(uint256 tokenId, uint40 boughtAt, uint256 index) internal pure returns (uint256) {
        return uint256(keccak256(abi.encode(tokenId, boughtAt, index)));
    }

    /// @param index 0 for the falling order, 1 for the flat tail.
    function parameters(address offerer, address collection, uint256 tokenId, Terms memory t, uint256 index)
        internal
        pure
        returns (OrderParameters memory p)
    {
        OfferItem[] memory offer = new OfferItem[](1);
        offer[0] = OfferItem(ItemType.ERC721, collection, tokenId, 1, 1);

        uint256 startAmount;
        uint256 endAmount;
        uint256 startTime;
        uint256 endTime;
        if (index == 0) {
            startAmount = startPrice(t);
            endAmount = endPrice(t);
            startTime = t.boughtAt;
            endTime = uint256(t.boughtAt) + t.decay;
        } else {
            startAmount = endPrice(t);
            endAmount = startAmount;
            startTime = uint256(t.boughtAt) + t.decay;
            endTime = startTime + TAIL;
        }

        ConsiderationItem[] memory consideration = new ConsiderationItem[](1);
        consideration[0] =
            ConsiderationItem(ItemType.NATIVE, address(0), 0, startAmount, endAmount, payable(offerer));

        p = OrderParameters({
            offerer: offerer,
            zone: address(0),
            offer: offer,
            consideration: consideration,
            orderType: OrderType.FULL_OPEN,
            startTime: startTime,
            endTime: endTime,
            zoneHash: bytes32(0),
            salt: salt(tokenId, t.boughtAt, index),
            conduitKey: bytes32(0),
            totalOriginalConsiderationItems: 1
        });
    }

    /// @notice The two orders to pass to `Seaport.validate`.
    function orders(address offerer, address collection, uint256 tokenId, Terms memory t)
        internal
        pure
        returns (Order[] memory out)
    {
        out = new Order[](2);
        out[0] = Order(parameters(offerer, collection, tokenId, t, 0), "");
        out[1] = Order(parameters(offerer, collection, tokenId, t, 1), "");
    }

    /// @notice The same two orders as `OrderComponents`, to pass to `Seaport.cancel`.
    function components(address offerer, address collection, uint256 tokenId, Terms memory t, uint256 counter)
        internal
        pure
        returns (OrderComponents[] memory out)
    {
        out = new OrderComponents[](2);
        for (uint256 i; i < 2; i++) {
            OrderParameters memory p = parameters(offerer, collection, tokenId, t, i);
            out[i] = OrderComponents(
                p.offerer,
                p.zone,
                p.offer,
                p.consideration,
                p.orderType,
                p.startTime,
                p.endTime,
                p.zoneHash,
                p.salt,
                p.conduitKey,
                counter
            );
        }
    }
}
