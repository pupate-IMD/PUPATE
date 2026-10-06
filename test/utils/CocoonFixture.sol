// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {SeaportInterface} from "seaport-types/src/interfaces/SeaportInterface.sol";
import {Cocoon} from "../../src/Cocoon.sol";
import {FloorFeed} from "../../src/FloorFeed.sol";
import {IERC20Minimal} from "../../src/interfaces/IERC20Minimal.sol";
import {IERC721Minimal} from "../../src/interfaces/IERC721Minimal.sol";
import {OracleAttestation} from "../../src/oracle/OracleAttestation.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockERC721} from "../mocks/MockERC721.sol";
import {MockSeaport} from "../mocks/MockSeaport.sol";
import {HookFixture} from "./HookFixture.sol";
import {PoolSetup} from "./PoolSetup.sol";

/// @dev The whole system as the tests see it: FloorFeed with a test attester, a mock collection, a mock
/// Seaport, Cocoon as the hook's sink, the hook, and the launch pool wired into Cocoon.
abstract contract CocoonFixture is HookFixture {
    uint256 internal constant ATTESTER_KEY = 0xA11CE;
    bytes32 internal constant QUESTION = keccak256("floor question");
    uint256 internal constant EVIDENCE_CHAIN = 1;

    address internal developer = makeAddr("developer");
    address internal operator = makeAddr("operator");
    address internal keeper = makeAddr("keeper");
    address internal seller = makeAddr("seller");

    FloorFeed internal feed;
    MockERC721 internal collection;
    MockSeaport internal seaport;
    MockERC20 internal imd;
    Cocoon internal cocoon;

    uint64 internal lastIssuedAt;

    function setUp() public virtual override {
        PoolSetup.setUp();

        feed = new FloorFeed(owner, vm.addr(ATTESTER_KEY), EVIDENCE_CHAIN);
        vm.prank(owner);
        feed.setQuestion(QUESTION);

        collection = new MockERC721();
        seaport = new MockSeaport();
        imd = new MockERC20("Identity.md", "IMD");

        cocoon = new Cocoon(
            owner,
            developer,
            operator,
            IERC721Minimal(address(collection)),
            SeaportInterface(address(seaport)),
            manager,
            feed,
            IERC20Minimal(address(imd))
        );

        hook = _deployHook(address(cocoon), owner);
        key = _ethPool(address(token), address(hook));
        _open(key, POOL_SHARE);

        vm.prank(owner);
        cocoon.wire(key);

        vm.deal(keeper, 100 ether);
        vm.deal(seller, 100 ether);
    }

    // ------------------------------------------------------------------ the floor

    /// @dev Reports `floorWei` as issued now. Each report must be newer than the last, so the clock
    /// moves one second when needed.
    function _setFloor(uint256 floorWei) internal {
        if (block.timestamp <= lastIssuedAt) vm.warp(lastIssuedAt + 1);
        uint64 issuedAt = uint64(block.timestamp);
        OracleAttestation.Attestation memory a;
        a.requestId = bytes32(uint256(issuedAt));
        a.chainId = EVIDENCE_CHAIN;
        a.questionHash = QUESTION;
        a.answerType = OracleAttestation.ANSWER_TYPE_UINT256;
        a.answer = abi.encode(floorWei);
        a.panelSize = 5;
        a.quorum = 4;
        a.agreed = 4;
        a.issuedAt = issuedAt;
        a.expiresAt = issuedAt + 24 hours;
        bytes32 sep = OracleAttestation.domainSeparator(block.chainid, address(feed));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ATTESTER_KEY, OracleAttestation.digest(sep, a));
        feed.report(a, abi.encodePacked(r, s, v));
        lastIssuedAt = issuedAt;
    }

    function _letTheFloorGoStale() internal {
        vm.warp(block.timestamp + 6 hours + 1);
    }

    // ------------------------------------------------------------------ pots

    function _pots() internal view returns (uint256 seat, uint256 burn, uint256 dev, uint256 imdBurn) {
        return (cocoon.seatPot(), cocoon.burnPot(), cocoon.developerBalance(), cocoon.imdBurnBalance());
    }

    function _assertBalanceIdentity() internal view {
        (uint256 seat, uint256 burn, uint256 dev, uint256 imdBurn) = _pots();
        assertEq(address(cocoon).balance, seat + burn + dev + imdBurn, "balance identity");
    }

    function _deposit(uint256 amount) internal {
        cocoon.depositTax{value: amount}();
    }

    /// @dev Gives Cocoon a seat without Seaport: mints it to Cocoon and adopts it at the floor.
    function _giveSeat(uint256 tokenId) internal {
        collection.mint(address(cocoon), tokenId);
        cocoon.adopt(tokenId);
    }
}
