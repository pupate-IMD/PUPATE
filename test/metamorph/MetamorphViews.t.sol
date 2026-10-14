// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolManager} from "v4-core/src/PoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {IERC20Minimal} from "../../src/interfaces/IERC20Minimal.sol";
import {IERC721Minimal} from "../../src/interfaces/IERC721Minimal.sol";
import {IMetamorphArt} from "../../src/interfaces/IMetamorphArt.sol";
import {MetamorphFixture} from "./MetamorphFixture.sol";
import {MetamorphMD} from "../../src/metamorph/MetamorphMD.sol";

contract MetamorphViewsTest is MetamorphFixture {
    function test_constantsMatchTheSpec() public view {
        assertEq(md.EDITIONS(), 303);
        assertEq(md.MAX_SUPPLY(), 3333);
        assertEq(md.EPOCH(), 303);
        assertEq(md.BASE_PRICE(), 50_000 ether);
        assertEq(md.TARGET_INTERVAL(), 90);
        assertEq(md.ANCHOR_WINDOW(), 50);
        assertEq(md.CONVERT_IMPACT_BPS(), 500);
        assertEq(md.BUY_IMPACT_BPS(), 150);
        assertEq(md.CONVERT_SPACING(), 5);
        assertEq(md.DOMAIN(), keccak256("Metamorph MD work v1"));
        assertEq(md.MIN_BITS(), 1);
        assertEq(md.name(), "Metamorph MD");
        assertEq(md.symbol(), "MMD");
    }

    function test_startsAtTheFirstEpochCeiling() public view {
        assertEq(md.target(), type(uint256).max >> 1);
        assertEq(md.bits(), 1);
        assertEq(md.prevWork(), md.DOMAIN());
        assertEq(md.lastMintAt(), block.timestamp);
        assertEq(md.totalMinted(), 0);
        assertEq(md.epoch(), 1);
    }

    function test_priceStepsOnceEveryEpoch() public view {
        assertEq(md.priceAt(1), 50_000 ether);
        assertEq(md.priceAt(2), 62_500 ether);
        assertEq(md.priceAt(3), 78_125 ether);
        assertEq(md.priceAt(11), 465_661_287_307_739_257_812_500);
        assertEq(md.mintPrice(), 50_000 ether);
        // The 3,333rd and last mint is made at totalMinted = 3,332, still in epoch 11, and a sold-out
        // collection stays in epoch 11 too: priceAt(11) is the last price the contract can ever charge.
        uint16 lastEpoch = (md.MAX_SUPPLY() - 1) / md.EPOCH() + 1;
        assertEq(lastEpoch, 11);
        assertEq(md.MAX_SUPPLY() / md.EPOCH(), lastEpoch);
        assertEq(md.priceAt(lastEpoch), 465_661_287_307_739_257_812_500);
    }

    function test_workHashIsTheSpecsPreimage() public view {
        bytes32 ah = blockhash(block.number - 1);
        assertTrue(ah != bytes32(0), "forge gives recent blocks a hash");
        bytes32 expected = keccak256(
            abi.encode(
                md.DOMAIN(),
                block.chainid,
                address(md),
                keccak256(abi.encode(ah, md.prevWork())),
                miner,
                uint256(7)
            )
        );
        assertEq(md.workHash(ah, miner, 7), expected);
        assertEq(md.anchorHash(block.number - 1), ah);
        assertEq(md.anchorHash(block.number), bytes32(0), "the current block has no hash yet");
    }

    function test_seatRegistryOnlyTakesSeatsTheVaultHolds() public {
        assertEq(md.notedSeats().length, 1);
        assertEq(md.mineableSeats()[0], 1376);
        vm.expectRevert(MetamorphMD.SeatNotHeld.selector);
        md.noteSeat(99);
        collection.mint(seller, 99);
        vm.expectRevert(MetamorphMD.SeatNotHeld.selector);
        md.noteSeat(99);
        _giveSeat(42);
        md.noteSeat(42);
        md.noteSeat(42); // twice is fine, noted once
        assertEq(md.notedSeats().length, 2);
        assertEq(md.mineableSeats().length, 2);
    }

    /// @dev Audit L-4: a card keeps its seat in 32 bits, so the registry refuses a seat id that does not
    /// fit. Noted and picked, such a seat would be stored cut, and the card would read another seat's stage.
    function test_noteSeatRefusesSeatIdsAbove32Bits() public {
        uint256 largest = type(uint32).max;
        _giveSeat(largest + 1);
        vm.expectRevert(MetamorphMD.SeatTooLarge.selector);
        md.noteSeat(largest + 1);
        assertFalse(md.noted(largest + 1));
        // The largest id that fits is noted, picked and stored whole.
        _giveSeat(largest);
        md.noteSeat(largest);
        _sell(1376);
        vm.roll(block.number + 1);
        uint256 id = _mintAs(miner);
        (uint32 seat,,,,,,,) = md.cards(id);
        assertEq(seat, largest);
        assertEq(md.stageOf(id), 0, "a chrysalis: the vault holds that seat");
    }

    function test_soldSeatLeavesTheMineableListButStaysNoted() public {
        _sell(1376);
        assertEq(md.notedSeats().length, 1);
        assertEq(md.mineableSeats().length, 0);
    }

    function test_filledButUnsettledSeatIsNotMineable() public {
        vm.prank(address(cocoon));
        collection.transferFrom(address(cocoon), other, 1376); // filled, nobody has settled
        assertEq(md.mineableSeats().length, 0);
        _giveSeat(42);
        vm.prank(address(cocoon));
        collection.transferFrom(address(cocoon), other, 42);
        vm.expectRevert(MetamorphMD.SeatNotHeld.selector);
        md.noteSeat(42);
    }

    function test_seatInTheWalletButOffTheBooksIsNotMineable() public {
        collection.mint(address(cocoon), 77); // donated, not adopted
        vm.expectRevert(MetamorphMD.SeatNotHeld.selector);
        md.noteSeat(77);
        _sell(1376);
        vm.prank(other);
        collection.transferFrom(other, address(cocoon), 1376); // sent straight back
        assertEq(md.mineableSeats().length, 0);
        cocoon.adopt(1376); // a new round
        assertEq(md.mineableSeats().length, 1);
    }

    function test_burnedSeatIsNotMineable() public {
        vm.prank(address(cocoon));
        collection.burn(1376);
        assertEq(md.mineableSeats().length, 0);
    }

    function test_constructorRefusesBadBitsAndBadKeys() public {
        vm.expectRevert(MetamorphMD.BadBits.selector);
        _deploy(0);
        vm.expectRevert(MetamorphMD.BadBits.selector);
        _deploy(201);

        // The facts the constructor checks about the two pool keys, each broken on its own.
        PoolKey memory launch = key;
        launch.hooks = IHooks(address(0)); // not the hook it was given
        vm.expectRevert(MetamorphMD.BadPoolKey.selector);
        _deployWithKeys(launch, imdKey);

        launch = key;
        launch.currency0 = Currency.wrap(address(imd)); // not quoted in ETH
        vm.expectRevert(MetamorphMD.BadPoolKey.selector);
        _deployWithKeys(launch, imdKey);

        launch = key;
        launch.currency1 = Currency.wrap(address(imd)); // not PUPATE
        vm.expectRevert(MetamorphMD.BadPoolKey.selector);
        _deployWithKeys(launch, imdKey);

        PoolKey memory imdPool = imdKey;
        imdPool.currency0 = Currency.wrap(address(token)); // not quoted in ETH
        vm.expectRevert(MetamorphMD.BadPoolKey.selector);
        _deployWithKeys(key, imdPool);

        imdPool = imdKey;
        imdPool.currency1 = Currency.wrap(address(token)); // not IMD
        vm.expectRevert(MetamorphMD.BadPoolKey.selector);
        _deployWithKeys(key, imdPool);

        imdPool = imdKey;
        imdPool.hooks = IHooks(address(hook)); // the ETH/IMD pool is hookless
        vm.expectRevert(MetamorphMD.BadPoolKey.selector);
        _deployWithKeys(key, imdPool);

        // Audit L-5: a launch key with another fee names another pool on the same hook. It is initialised
        // here, so only the rule that the key be the hook's launch pool refuses it.
        launch = key;
        launch.fee = 12_500;
        manager.initialize(launch, SQRT_PRICE_OPEN);
        vm.expectRevert(MetamorphMD.BadPoolKey.selector);
        _deployWithKeys(launch, imdKey);

        // An ETH/IMD key whose pool was never initialised (its 1% fee passes; only its spacing differs).
        imdPool = imdKey;
        imdPool.tickSpacing = 60;
        vm.expectRevert(MetamorphMD.BadPoolKey.selector);
        _deployWithKeys(key, imdPool);

        // An ETH/IMD pool that exists but charges 0.3%: the buy bound resists a sandwich only against a fee
        // of at least 1% a side (audit M-1).
        imdPool = imdKey;
        imdPool.fee = 3000;
        imdPool.tickSpacing = 60;
        manager.initialize(imdPool, IMD_SQRT_PRICE);
        vm.expectRevert(MetamorphMD.BadPoolKey.selector);
        _deployWithKeys(key, imdPool);

        // A PoolManager on which the ETH/IMD pool exists and the launch pool does not: the launch pool can
        // only be initialised by the manager its hook answers to.
        IPoolManager elsewhere = IPoolManager(address(new PoolManager(address(this))));
        elsewhere.initialize(imdKey, IMD_SQRT_PRICE);
        vm.expectRevert(MetamorphMD.BadPoolKey.selector);
        _deployOn(elsewhere, key, imdKey);
    }

    function _deployWithKeys(PoolKey memory pupateKey_, PoolKey memory imdKey_)
        private
        returns (MetamorphMD)
    {
        return _deployOn(manager, pupateKey_, imdKey_);
    }

    function _deployOn(IPoolManager manager_, PoolKey memory pupateKey_, PoolKey memory imdKey_)
        private
        returns (MetamorphMD)
    {
        return new MetamorphMD(
            cocoon,
            hook,
            token,
            IERC20Minimal(address(imd)),
            IERC721Minimal(address(collection)),
            manager_,
            pupateKey_,
            imdKey_,
            IMetamorphArt(address(art)),
            1
        );
    }
}
