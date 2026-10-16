// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {Currency, CurrencyLibrary} from "v4-core/src/types/Currency.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Cocoon} from "../../src/Cocoon.sol";
import {FloorFeed} from "../../src/FloorFeed.sol";
import {PupateHook} from "../../src/PupateHook.sol";
import {PupateToken} from "../../src/PupateToken.sol";
import {IERC20Minimal} from "../../src/interfaces/IERC20Minimal.sol";
import {IERC721Minimal} from "../../src/interfaces/IERC721Minimal.sol";
import {IMetamorphArt} from "../../src/interfaces/IMetamorphArt.sol";
import {MetamorphMD} from "../../src/metamorph/MetamorphMD.sol";
import {OracleAttestation} from "../../src/oracle/OracleAttestation.sol";
import {StubArt} from "../mocks/StubArt.sol";

/// @dev The whole flow on a fork of mainnet: the real vault, hook, token, IMD, collection and both
/// pools. Skipped without MAINNET_RPC_URL. The vault is given a seat (a holder hands it over and the
/// vault adopts it after a fresh floor from a test attester), a card is mined and minted with duties,
/// the pot is converted through the real pools by anyone and, once it holds a hundred prices, by a mint's
/// duty, a staker claims IMD, the seat is sold, the card emerges. A second test mints before the seat is
/// noted, from the commons: the real collection answers `totalSupply()`.
contract MetamorphForkTest is Test {
    Cocoon constant COCOON = Cocoon(payable(0x54993066369e57a49215f6fc2D9911a8e5a57a79));
    PupateHook constant HOOK = PupateHook(payable(0xb5e544166144A590E171bF0350e8F227858318CC));
    PupateToken constant PUPATE = PupateToken(0x59fB66660626A6a2C7E0e1a39Af1367d09eD92B0);
    FloorFeed constant FEED = FloorFeed(0x5A215aa9883cEfE5fa74085ba66288388b83700C);
    address constant TIMELOCK = 0x8bE826082c0FbAeC485048aA26ef42aC147898EC;
    address constant IMD = 0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7;
    address constant COLLECTION = 0x0000eC93127BAA929E58E97dd0095A2BFb38ec1D;
    IPoolManager constant MANAGER = IPoolManager(0x000000000004444c5dc75cB358380D2e3dE08A90);
    uint256 constant ATTESTER_KEY = 0xA11CE;

    MetamorphMD md;
    address miner = makeAddr("miner");
    uint256 seat;
    address holder;

    function setUp() public {
        string memory rpc = vm.envOr("MAINNET_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);

        PoolKey memory pupateKey = PoolKey(
            CurrencyLibrary.ADDRESS_ZERO, Currency.wrap(address(PUPATE)), 12500, 60, IHooks(address(HOOK))
        );
        PoolKey memory imdKey =
            PoolKey(CurrencyLibrary.ADDRESS_ZERO, Currency.wrap(IMD), 10000, 200, IHooks(address(0)));
        md = new MetamorphMD(
            COCOON,
            HOOK,
            PUPATE,
            IERC20Minimal(IMD),
            IERC721Minimal(COLLECTION),
            MANAGER,
            pupateKey,
            imdKey,
            IMetamorphArt(address(new StubArt())),
            1
        );

        // A fresh floor from a test attester, so the vault can adopt a seat. Once the real feed has a
        // report, its own value is reported again, which the feed's rise limit always admits.
        vm.prank(TIMELOCK);
        FEED.setAttester(vm.addr(ATTESTER_KEY));
        (uint256 floor,) = FEED.latest();
        _report(floor == 0 ? 2.5 ether : floor);

        // Any seat whose holder is an EOA: hand it to the vault, then adopt.
        seat = _findSeat();
        vm.prank(holder);
        IERC721Minimal(COLLECTION).transferFrom(holder, address(COCOON), seat);
        COCOON.adopt(seat);

        // The miner is funded with a deal: buying in the pool would work too, but a deal is simpler.
        deal(address(PUPATE), miner, 50_000_000 ether);
        vm.prank(miner);
        PUPATE.approve(address(md), type(uint256).max);
        vm.deal(miner, 1 ether);
        vm.roll(block.number + 1);
    }

    function test_mintConvertStakeEmergeOnMainnet() public {
        if (address(md) == address(0)) {
            vm.skip(true);
            return;
        }
        vm.fee(1 gwei);
        md.noteSeat(seat);
        uint256 id = _mint();
        (uint32 s,,,,,,,,) = md.cards(id);
        assertEq(s, seat);
        assertFalse(md.commons(id));
        assertEq(md.stageOf(id), 0);

        // Stake, then two more mints: three fees are far under the hundred prices the conversion duty waits
        // for, so the third mint's duties leave the pot alone and pay the miner no IMD.
        uint256[] memory ids = new uint256[](1);
        ids[0] = id;
        vm.prank(miner);
        md.stake(ids);
        uint256 imdBefore = IERC20Minimal(IMD).balanceOf(miner);
        uint256 lastConvert = md.lastConvertBlock();
        for (uint256 i; i < 2; i++) {
            vm.roll(block.number + 1);
            vm.warp(block.timestamp + 90);
            _mint();
        }
        (,, bool convertDue) = md.dutiesDue();
        assertFalse(convertDue, "three fees do not make the conversion due");
        assertEq(md.lastConvertBlock(), lastConvert, "the third mint did not convert the pot");
        assertEq(IERC20Minimal(IMD).balanceOf(miner), imdBefore, "nor paid the miner");

        // Past the spacing a fourth fee joins the three in the pot, and anyone converts the four through the
        // real pools: the caller is paid 0.5% of the IMD bought.
        vm.roll(block.number + md.CONVERT_SPACING());
        vm.warp(block.timestamp + 90);
        _mint();
        uint256 callerBefore = IERC20Minimal(IMD).balanceOf(address(this));
        uint256 out = md.convert();
        assertGt(out, 0, "IMD bought on mainnet");
        uint256 reward = IERC20Minimal(IMD).balanceOf(address(this)) - callerBefore;
        assertEq(reward, out * md.CALLER_REWARD_BPS() / 10_000, "the caller is paid 0.5% of the IMD bought");
        assertGt(reward, 0, "the caller earned IMD");
        vm.prank(miner);
        uint256 paid = md.claim(ids);
        assertGt(paid, 0, "the staker got IMD");
        assertEq(address(md).balance, md.ethPot());
        assertLe(md.imdOwed(), IERC20Minimal(IMD).balanceOf(address(md)), "what is owed is held");

        // A hundred prices in the pot convert inside a mint, as its duty, through the real pools.
        _dutyConvertsAHundredPrices();

        // The vault sells the seat: the card emerges.
        vm.prank(address(COCOON));
        IERC721Minimal(COLLECTION).transferFrom(address(COCOON), holder, seat);
        COCOON.settleSeat(seat);
        assertEq(md.stageOf(id), 1);
    }

    /// The vault holds a seat nobody has noted: the mint draws from the commons, the whole collection as the
    /// real contract counts it (2,000 seats on 2026-10-16), and the card emerges by time only.
    function test_aMintBeforeTheFirstNotedSeatDrawsFromTheRealCollection() public {
        if (address(md) == address(0)) {
            vm.skip(true);
            return;
        }
        assertEq(md.mineableSeats().length, 0, "nothing noted");
        uint256 supply = IERC721Minimal(COLLECTION).totalSupply();
        assertGe(supply, 2000, "the collection counts its seats");
        uint256 a = block.number - 1;
        uint256 nonce = _nonce(a);
        uint256 work = uint256(md.workHash(blockhash(a), miner, nonce));
        vm.prank(miner);
        uint256 id = md.mint(a, nonce);
        (uint32 s, uint16 round, uint16 edition,, bool commons,,,,) = md.cards(id);
        assertEq(s, 1 + work % supply, "one plus the work modulo the real supply");
        (,,,,,, uint16 recorded) = COCOON.seats(s);
        assertEq(round, recorded, "the round Cocoon records for that seat");
        assertEq(edition, 1);
        assertTrue(commons);
        assertTrue(md.commons(id));
        assertEq(md.stageOf(id), 0, "a chrysalis whether or not the vault holds that seat");
        vm.warp(block.timestamp + 90 days);
        assertEq(md.stageOf(id), 1, "a butterfly at 90 days");
    }

    /// @dev Mints at dear gas leave their duties alone while the pot fills to a hundred prices; then one
    /// cheap mint converts it as its duty through the real pools and pays the miner, and a second cheap mint
    /// right after leaves the conversion alone. The cheap mint's gas is measured here, where the earlier
    /// calls left much of the state warm, so the bound is loose: the conversion's allowance plus 400,000.
    function _dutyConvertsAHundredPrices() private {
        vm.fee(3 gwei);
        while (md.pot() < md.CONVERT_PRICES() * md.mintPrice()) {
            vm.roll(block.number + 1);
            vm.warp(block.timestamp + 90);
            _mint();
        }
        vm.fee(1 gwei);
        vm.roll(block.number + 1);
        vm.warp(block.timestamp + 90);
        uint256 a = block.number - 1;
        uint256 nonce = _nonce(a);
        uint256 imdBefore = IERC20Minimal(IMD).balanceOf(miner);
        vm.recordLogs();
        vm.prank(miner);
        uint256 gasUsed = gasleft();
        md.mint(a, nonce);
        gasUsed -= gasleft();
        uint256 paid = _dutyPaid(vm.getRecordedLogs(), 2);
        assertEq(md.lastConvertBlock(), block.number, "the cheap mint converted the hundred prices");
        uint256 reward = IERC20Minimal(IMD).balanceOf(miner) - imdBefore;
        assertGt(reward, 0, "and paid the miner IMD");
        assertEq(reward, paid, "as its DutyRun reports");
        assertLt(gasUsed, md.CONVERT_GAS() + 400_000, "the mint, its conversion with it, fits the allowance");
        uint256 converted = block.number;
        vm.roll(block.number + 1);
        vm.warp(block.timestamp + 90);
        _mint();
        assertEq(md.lastConvertBlock(), converted, "the next cheap mint leaves the conversion alone");
    }

    /// @dev Mines a proof on the previous block as the miner, the way the browser does, and mints it.
    function _mint() private returns (uint256) {
        uint256 a = block.number - 1;
        uint256 nonce = _nonce(a);
        vm.prank(miner);
        return md.mint(a, nonce);
    }

    /// @dev The first nonce whose proof is under the effective target, for the miner at anchor `a`.
    function _nonce(uint256 a) private view returns (uint256 nonce) {
        bytes32 ah = blockhash(a);
        nonce = 1;
        while (uint256(md.workHash(ah, miner, nonce)) >= md.effectiveTarget()) nonce++;
    }

    /// @dev What the DutyRun of `kind` among `logs` reports paid; fails when there is none.
    function _dutyPaid(Vm.Log[] memory logs, uint8 kind) private view returns (uint256) {
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter != address(md) || logs[i].topics[0] != MetamorphMD.DutyRun.selector) {
                continue;
            }
            (uint8 k, uint256 paid) = abi.decode(logs[i].data, (uint8, uint256));
            if (k == kind) return paid;
        }
        revert("no DutyRun of that kind");
    }

    /// @dev CocoonFixture's `_setFloor`, against the real feed: its question, its evidence chain, its
    /// domain, and an issue time newer than its last report.
    function _report(uint256 floorWei) private {
        if (block.timestamp <= FEED.issuedAt()) vm.warp(FEED.issuedAt() + 1);
        uint64 issuedAt = uint64(block.timestamp);
        OracleAttestation.Attestation memory a;
        a.requestId = bytes32(uint256(issuedAt));
        a.chainId = FEED.EVIDENCE_CHAIN_ID();
        a.questionHash = FEED.questionHash();
        a.answerType = OracleAttestation.ANSWER_TYPE_UINT256;
        a.answer = abi.encode(floorWei);
        a.panelSize = 5;
        a.quorum = 4;
        a.agreed = 4;
        a.issuedAt = issuedAt;
        a.expiresAt = issuedAt + 24 hours;
        bytes32 sep = OracleAttestation.domainSeparator(block.chainid, address(FEED));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ATTESTER_KEY, OracleAttestation.digest(sep, a));
        FEED.report(a, abi.encodePacked(r, s, v));
    }

    /// @dev Walks token ids until one is held by an EOA.
    function _findSeat() private returns (uint256) {
        for (uint256 id = 1; id < 400; id++) {
            try IERC721Minimal(COLLECTION).ownerOf(id) returns (address o) {
                if (o.code.length == 0 && o != address(0)) {
                    holder = o;
                    return id;
                }
            } catch {}
        }
        revert("no seat");
    }
}
