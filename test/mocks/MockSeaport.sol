// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ItemType} from "seaport-types/src/lib/ConsiderationEnums.sol";
import {
    AdvancedOrder,
    ConsiderationItem,
    CriteriaResolver,
    Order,
    OrderComponents,
    OrderParameters
} from "seaport-types/src/lib/ConsiderationStructs.sol";

interface IERC721Like {
    function transferFrom(address from, address to, uint256 tokenId) external;
}

/// @dev Test-only stand-in for Seaport 1.6, enough for one-ERC721-for-native-ETH orders: offerers
/// validate without a signature, anyone fulfils a validated order at its current price (Seaport's
/// interpolation, rounding consideration up), recipients are paid, the excess is refunded, and the
/// offerer may cancel. Nothing here proves compatibility with the live contract; the fork test does.
contract MockSeaport {
    mapping(bytes32 => bool) public validated;
    mapping(bytes32 => bool) public cancelled;
    mapping(bytes32 => bool) public filled;
    mapping(address => uint256) private _counter;

    /// @dev When set, fulfilment re-enters this address with this calldata before paying, so a test
    /// can prove the buyer's reentrancy lock holds.
    address public reenterTarget;
    bytes public reenterData;

    event OrderValidated(bytes32 orderHash, address offerer);
    event OrderCancelled(bytes32 orderHash, address offerer);
    event OrderFulfilled(bytes32 orderHash, address offerer, address fulfiller, uint256 paid);

    function setReentry(address target, bytes calldata data) external {
        reenterTarget = target;
        reenterData = data;
    }

    function getCounter(address offerer) external view returns (uint256) {
        return _counter[offerer];
    }

    function getOrderHash(OrderComponents calldata c) external pure returns (bytes32) {
        return keccak256(abi.encode(c));
    }

    function getOrderStatus(bytes32 orderHash)
        external
        view
        returns (bool isValidated, bool isCancelled, uint256 totalFilled, uint256 totalSize)
    {
        bool f = filled[orderHash];
        return (validated[orderHash], cancelled[orderHash], f ? 1 : 0, f ? 1 : 0);
    }

    function hashOf(OrderParameters memory p) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                OrderComponents(
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
                    _counter[p.offerer]
                )
            )
        );
    }

    function validate(Order[] calldata orders) external returns (bool) {
        for (uint256 i; i < orders.length; i++) {
            require(msg.sender == orders[i].parameters.offerer, "mock: only the offerer validates");
            bytes32 h = hashOf(orders[i].parameters);
            validated[h] = true;
            emit OrderValidated(h, msg.sender);
        }
        return true;
    }

    function cancel(OrderComponents[] calldata orders) external returns (bool) {
        for (uint256 i; i < orders.length; i++) {
            require(msg.sender == orders[i].offerer, "mock: only the offerer cancels");
            bytes32 h = keccak256(abi.encode(orders[i]));
            cancelled[h] = true;
            emit OrderCancelled(h, msg.sender);
        }
        return true;
    }

    function fulfillAdvancedOrder(
        AdvancedOrder calldata order,
        CriteriaResolver[] calldata,
        bytes32,
        address recipient
    ) external payable returns (bool) {
        OrderParameters calldata p = order.parameters;
        bytes32 h = hashOf(p);
        require(validated[h], "mock: not validated");
        require(!cancelled[h] && !filled[h], "mock: not fulfillable");
        require(block.timestamp >= p.startTime && block.timestamp < p.endTime, "mock: outside the window");
        require(p.offer.length == 1 && p.offer[0].itemType == ItemType.ERC721, "mock: one ERC721 only");
        filled[h] = true;

        if (reenterTarget != address(0)) {
            (bool ok, bytes memory why) = reenterTarget.call(reenterData);
            require(ok, string(why));
        }

        IERC721Like(p.offer[0].token).transferFrom(p.offerer, recipient, p.offer[0].identifierOrCriteria);

        uint256 total;
        for (uint256 i; i < p.consideration.length; i++) {
            ConsiderationItem calldata c = p.consideration[i];
            require(c.itemType == ItemType.NATIVE, "mock: ETH consideration only");
            uint256 amount = currentAmount(c.startAmount, c.endAmount, p.startTime, p.endTime, true);
            total += amount;
            (bool paid,) = c.recipient.call{value: amount}("");
            require(paid, "mock: recipient refused");
        }
        require(msg.value >= total, "mock: insufficient value");
        if (msg.value > total) {
            (bool refunded,) = msg.sender.call{value: msg.value - total}("");
            require(refunded, "mock: refund refused");
        }
        emit OrderFulfilled(h, p.offerer, msg.sender, total);
        return true;
    }

    /// @dev Seaport's `_locateCurrentAmount`: linear between the two amounts over the window.
    function currentAmount(
        uint256 startAmount,
        uint256 endAmount,
        uint256 startTime,
        uint256 endTime,
        bool roundUp
    ) public view returns (uint256) {
        if (startAmount == endAmount) return endAmount;
        uint256 duration = endTime - startTime;
        uint256 elapsed = block.timestamp - startTime;
        uint256 remaining = duration - elapsed;
        uint256 total = startAmount * remaining + endAmount * elapsed;
        if (roundUp) total += duration - 1;
        return total / duration;
    }
}
