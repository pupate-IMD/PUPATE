// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolManager} from "v4-core/src/PoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {SeaportInterface} from "seaport-types/src/interfaces/SeaportInterface.sol";
import {Cocoon} from "../../src/Cocoon.sol";
import {PupateHook} from "../../src/PupateHook.sol";
import {PupateToken} from "../../src/PupateToken.sol";
import {IERC20Minimal} from "../../src/interfaces/IERC20Minimal.sol";
import {IERC721Minimal} from "../../src/interfaces/IERC721Minimal.sol";
import {IMetamorphArt} from "../../src/interfaces/IMetamorphArt.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockERC721} from "../mocks/MockERC721.sol";
import {MetamorphFixture} from "./MetamorphFixture.sol";
import {ERC721Lite} from "../../src/metamorph/ERC721Lite.sol";
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

    function test_forgettingASoldSeatTakesItOffTheList() public {
        _giveSeat(42);
        md.noteSeat(42);
        _giveSeat(7);
        md.noteSeat(7);
        _sell(1376);
        vm.expectEmit(true, false, false, true, address(md));
        emit MetamorphMD.SeatForgotten(1376);
        md.forgetSeat(1376);
        assertFalse(md.noted(1376));
        uint256[] memory list = md.notedSeats();
        assertEq(list.length, 2, "the list shrank");
        assertEq(list[0], 7, "the last seat took the place of the forgotten one");
        assertEq(list[1], 42);

        // A mint still finds the seats that are left, and the hash indexes them by the same formula.
        vm.roll(block.number + 1);
        uint256[] memory open = md.mineableSeats();
        assertEq(open.length, 2);
        uint256 a = _anchor();
        uint256 n = _proof(miner, a);
        uint256 work = uint256(md.workHash(blockhash(a), miner, n));
        vm.prank(miner);
        uint256 id = md.mint(a, n);
        (uint32 seat,,,,,,,) = md.cards(id);
        assertEq(seat, open[work % open.length], "the hash indexes the seats that are left");

        // The seat that moved is found at its new place, and the last one left can go too.
        _sell(7);
        md.forgetSeat(7);
        list = md.notedSeats();
        assertEq(list.length, 1);
        assertEq(list[0], 42);
        assertTrue(md.noted(42));
        _sell(42);
        md.forgetSeat(42);
        assertEq(md.notedSeats().length, 0);
        assertFalse(md.noted(7) || md.noted(42));
    }

    function test_forgetSeatRefusesAHeldSeatAndOneNotNoted() public {
        vm.expectRevert(MetamorphMD.SeatHeld.selector);
        md.forgetSeat(1376);
        vm.expectRevert(MetamorphMD.SeatNotNoted.selector);
        md.forgetSeat(99);
        _sell(1376);
        md.forgetSeat(1376);
        vm.expectRevert(MetamorphMD.SeatNotNoted.selector);
        md.forgetSeat(1376);
        assertEq(md.notedSeats().length, 0);
    }

    function test_aForgottenSeatTheVaultBuysAgainIsNotedInItsNewRound() public {
        _mintAs(miner);
        _sell(1376);
        md.forgetSeat(1376);
        // The vault buys the same seat again: a new round, off the list until someone notes it.
        vm.prank(other);
        collection.transferFrom(other, address(cocoon), 1376);
        cocoon.adopt(1376);
        assertEq(md.mineableSeats().length, 0, "not noted yet");
        md.noteSeat(1376);
        assertTrue(md.noted(1376));
        assertEq(md.notedSeats().length, 1);
        vm.roll(block.number + 1);
        uint256 id = _mintAs(miner);
        (uint32 seat, uint16 round, uint16 edition,,,,,) = md.cards(id);
        assertEq(seat, 1376);
        assertEq(round, 1, "the new round");
        assertEq(edition, 1, "the first edition of the new round");
        assertEq(md.editionsMinted(1376, 0), 1, "the count of the old round is untouched");
    }

    /// @dev Forgetting never resets a count. A seat that left the wallet before anyone settled the sale can be
    /// forgotten; when it comes straight back it is still in the same round, and noted again it goes on.
    function test_aSeatForgottenBeforeItsSaleSettledGoesOnWithItsEditions() public {
        _mintAs(miner);
        vm.prank(address(cocoon));
        collection.transferFrom(address(cocoon), other, 1376); // a fill, before anyone settles it
        md.forgetSeat(1376);
        vm.prank(other);
        collection.transferFrom(other, address(cocoon), 1376); // and straight back
        md.noteSeat(1376);
        vm.roll(block.number + 1);
        uint256 id = _mintAs(miner);
        (, uint16 round, uint16 edition,,,,,) = md.cards(id);
        assertEq(round, 0, "the same round");
        assertEq(edition, 2, "the next edition, not a repeat");
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

    function test_constructorRefusesEachZeroAddress() public {
        _deployFrom(_wiring(), key, imdKey); // the addresses of the fixture deploy
        for (uint256 i; i < 7; i++) {
            address[7] memory a = _wiring();
            a[i] = address(0);
            vm.expectRevert(ERC721Lite.ZeroAddress.selector);
            _deployFrom(a, key, imdKey);
        }
    }

    function test_minBitsRunsFromOneTo200() public {
        MetamorphMD hardest = _deploy(200);
        assertEq(hardest.MIN_BITS(), 200);
        assertEq(hardest.target(), type(uint256).max >> 200, "the ceiling of epoch one at 200 bits");
        assertEq(hardest.bits(), 200);
        vm.expectRevert(MetamorphMD.BadBits.selector);
        _deploy(201);
    }

    /// @dev Every input that names a contract the vault also names must be the vault's own, and the hook must
    /// pay this vault. Each case breaks one alone and passes every key rule, so only the wiring refuses it.
    function test_constructorRefusesWrongWiring() public {
        // Another token as IMD, with an initialised hookless ETH pool of its own at a 1% fee.
        MockERC20 fakeImd = new MockERC20("Not IMD", "NIMD");
        PoolKey memory fakeImdKey = imdKey;
        fakeImdKey.currency1 = Currency.wrap(address(fakeImd));
        manager.initialize(fakeImdKey, IMD_SQRT_PRICE);
        address[7] memory a = _wiring();
        a[3] = address(fakeImd);
        vm.expectRevert(MetamorphMD.BadWiring.selector);
        _deployFrom(a, key, fakeImdKey);

        // Another collection.
        a = _wiring();
        a[4] = address(new MockERC721());
        vm.expectRevert(MetamorphMD.BadWiring.selector);
        _deployFrom(a, key, imdKey);

        // Another PoolManager. Only the manager the hook answers to can initialise the launch pool, so the
        // storage reads of this one are mocked to show both pools initialised.
        IPoolManager elsewhere = IPoolManager(address(new PoolManager(address(this))));
        vm.mockCall(
            address(elsewhere),
            abi.encodeWithSignature("extsload(bytes32)"),
            abi.encode(bytes32(uint256(IMD_SQRT_PRICE)))
        );
        a = _wiring();
        a[5] = address(elsewhere);
        vm.expectRevert(MetamorphMD.BadWiring.selector);
        _deployFrom(a, key, imdKey);

        // Another vault on the same addresses, as the two abandoned before the launch were: the hook pays
        // the live one.
        Cocoon abandoned = new Cocoon(
            owner,
            developer,
            operator,
            IERC721Minimal(address(collection)),
            SeaportInterface(address(seaport)),
            manager,
            feed,
            IERC20Minimal(address(imd))
        );
        a = _wiring();
        a[0] = address(abandoned);
        vm.expectRevert(MetamorphMD.BadWiring.selector);
        _deployFrom(a, key, imdKey);

        // A hook that pays another sink, with a launch pool of its own.
        PupateHook stranger = _deployHook(other, owner);
        PoolKey memory strangerKey = _ethPool(address(token), address(stranger));
        manager.initialize(strangerKey, SQRT_PRICE_OPEN);
        a = _wiring();
        a[1] = address(stranger);
        vm.expectRevert(MetamorphMD.BadWiring.selector);
        _deployFrom(a, strangerKey, imdKey);
    }

    /// @dev The seven addresses of the fixture, in the order of the constructor: the vault, the hook, PUPATE,
    /// IMD, the collection, the PoolManager and the art.
    function _wiring() private view returns (address[7] memory) {
        return [
            address(cocoon),
            address(hook),
            address(token),
            address(imd),
            address(collection),
            address(manager),
            address(art)
        ];
    }

    function _deployFrom(address[7] memory a, PoolKey memory pupateKey_, PoolKey memory imdKey_)
        private
        returns (MetamorphMD)
    {
        return new MetamorphMD(
            Cocoon(payable(a[0])),
            PupateHook(payable(a[1])),
            PupateToken(a[2]),
            IERC20Minimal(a[3]),
            IERC721Minimal(a[4]),
            IPoolManager(a[5]),
            pupateKey_,
            imdKey_,
            IMetamorphArt(a[6]),
            1
        );
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
