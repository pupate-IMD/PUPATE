// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {Currency, CurrencyLibrary} from "v4-core/src/types/Currency.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Cocoon} from "../../src/Cocoon.sol";
import {PupateHook} from "../../src/PupateHook.sol";
import {PupateToken} from "../../src/PupateToken.sol";
import {IERC20Minimal} from "../../src/interfaces/IERC20Minimal.sol";
import {IERC721Minimal} from "../../src/interfaces/IERC721Minimal.sol";
import {IMetamorphArt} from "../../src/interfaces/IMetamorphArt.sol";
import {MetamorphMD} from "../../src/metamorph/MetamorphMD.sol";
import {MetamorphArt} from "../../src/metamorph/art/MetamorphArt.sol";
import {MetamorphButterfly} from "../../src/metamorph/art/MetamorphButterfly.sol";
import {MetamorphChrysalis} from "../../src/metamorph/art/MetamorphChrysalis.sol";

/// @notice LOCAL ONLY. Metamorph MD on the anvil fork, after `ReportLocal`: the art as
/// `DeployMetamorphArt` deploys it (the two figures, then the router), the token as `DeployMetamorph`
/// deploys it (the same pool keys, the vault's own IMD, collection and PoolManager) but at a floor of
/// MIN_BITS, default 1 bit where the mainnet script insists on 20, and then the vault's first seat:
/// `adopt` at the fresh floor and `noteSeat`, so that a mint can pick it. The seat must already be in the
/// vault's wallet: a broadcast cannot prank, so up.mjs hands it over beforehand from its mainnet holder,
/// impersonated on the fork, as test/fork/Metamorph.fork.t.sol does with `vm.prank`.
///
/// Environment:
///   COCOON, HOOK, PUPATE           the local stack's vault, hook and token
///   IMD, COLLECTION, POOL_MANAGER  the mainnet contracts the vault names (the token's constructor checks)
///   SEAT                           the seat the vault was handed
///   MIN_BITS                       the difficulty floor of epoch one (default 1)
///   POOL_FEE, TICK_SPACING         the launch pool's, as LaunchLocal took them (default 12500 and 60)
contract DeployMetamorphLocal is Script {
    /// What a token URI of the art begins with.
    bytes private constant DATA_URI = "data:application/json;base64,";

    struct Config {
        Cocoon cocoon;
        PupateHook hook;
        PupateToken pupate;
        address imd;
        address collection;
        IPoolManager manager;
        uint256 seat;
        uint8 minBits;
        uint24 fee;
        int24 tickSpacing;
    }

    function run() external returns (MetamorphMD md, MetamorphArt art) {
        Config memory c = _config();
        require(c.hook.sink() == address(c.cocoon), "hook sink is not the vault");
        require(
            IERC721Minimal(c.collection).ownerOf(c.seat) == address(c.cocoon),
            "SEAT is not in the vault's wallet: hand it over first (up.mjs does)"
        );

        vm.startBroadcast();
        MetamorphChrysalis chrysalis = new MetamorphChrysalis();
        MetamorphButterfly butterfly = new MetamorphButterfly();
        art = new MetamorphArt(chrysalis, butterfly);
        vm.stopBroadcast();

        // Reads, never broadcast: the router draws the seat's first card in both stages before the token,
        // which keeps the router's address for good, is deployed against it.
        _checkArt(art, c.seat);

        vm.startBroadcast();
        md = new MetamorphMD(
            c.cocoon,
            c.hook,
            c.pupate,
            IERC20Minimal(c.imd),
            IERC721Minimal(c.collection),
            c.manager,
            PoolKey(
                CurrencyLibrary.ADDRESS_ZERO,
                Currency.wrap(address(c.pupate)),
                c.fee,
                c.tickSpacing,
                IHooks(address(c.hook))
            ),
            PoolKey(CurrencyLibrary.ADDRESS_ZERO, Currency.wrap(c.imd), 10000, 200, IHooks(address(0))),
            art,
            c.minBits
        );
        (,,,,, bool onBooks,) = c.cocoon.seats(c.seat);
        if (!onBooks) c.cocoon.adopt(c.seat);
        md.noteSeat(c.seat);
        vm.stopBroadcast();

        uint256[] memory open = md.mineableSeats();
        require(md.bits() == c.minBits, "bits() is not MIN_BITS");
        require(open.length == 1 && open[0] == c.seat, "the seat is not the one mineable seat");

        console2.log("MetamorphChrysalis", address(chrysalis));
        console2.log("MetamorphButterfly", address(butterfly));
        console2.log("METAMORPH_ART     ", address(art));
        console2.log("METAMORPH         ", address(md));
        console2.log("SEAT              ", c.seat);
        console2.log("target bits       ", md.bits());
        console2.log("mint price        ", md.mintPrice());
    }

    function _config() internal view returns (Config memory c) {
        c.cocoon = Cocoon(payable(vm.envAddress("COCOON")));
        c.hook = PupateHook(payable(vm.envAddress("HOOK")));
        c.pupate = PupateToken(vm.envAddress("PUPATE"));
        c.imd = vm.envAddress("IMD");
        c.collection = vm.envAddress("COLLECTION");
        c.manager = IPoolManager(vm.envAddress("POOL_MANAGER"));
        c.seat = vm.envUint("SEAT");
        // Checked whole, before it is narrowed to the constructor's uint8, as DeployMetamorph does.
        uint256 minBits = vm.envOr("MIN_BITS", uint256(1));
        require(minBits >= 1 && minBits <= 200, "MIN_BITS is 1 to 200");
        c.minBits = uint8(minBits);
        c.fee = uint24(vm.envOr("POOL_FEE", uint256(12500)));
        c.tickSpacing = int24(int256(vm.envOr("TICK_SPACING", uint256(60))));
    }

    /// `DeployMetamorph._checkArt` for the seat at hand: its first card, plain, epoch 1, mined by the sender
    /// for 50,000 PUPATE, as a chrysalis and as a butterfly; each token URI at least 100 bytes and a base64
    /// JSON data URI.
    function _checkArt(IMetamorphArt art, uint256 seat) internal view {
        for (uint8 stage; stage < 2; stage++) {
            bytes memory uri = bytes(
                art.tokenURI(
                    IMetamorphArt.View({
                        id: 1,
                        seat: seat,
                        round: 0,
                        edition: 1,
                        stage: stage,
                        gilt: false,
                        epoch: 1,
                        miner: msg.sender,
                        mintedAt: uint40(block.timestamp),
                        paid: 50_000 ether
                    })
                )
            );
            require(
                uri.length >= 100 && _startsWith(uri, DATA_URI),
                stage == 0
                    ? "ART chrysalis tokenURI is not a data URI"
                    : "ART butterfly tokenURI is not a data URI"
            );
            console2.log(stage == 0 ? "chrysalis tokenURI bytes" : "butterfly tokenURI bytes", uri.length);
        }
    }

    function _startsWith(bytes memory data, bytes memory prefix) private pure returns (bool) {
        if (data.length < prefix.length) return false;
        for (uint256 i; i < prefix.length; i++) {
            if (data[i] != prefix[i]) return false;
        }
        return true;
    }
}
