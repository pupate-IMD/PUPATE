// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {Currency, CurrencyLibrary} from "v4-core/src/types/Currency.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Cocoon} from "../src/Cocoon.sol";
import {PupateHook} from "../src/PupateHook.sol";
import {PupateToken} from "../src/PupateToken.sol";
import {IERC20Minimal} from "../src/interfaces/IERC20Minimal.sol";
import {IERC721Minimal} from "../src/interfaces/IERC721Minimal.sol";
import {IMetamorphArt} from "../src/interfaces/IMetamorphArt.sol";
import {MetamorphMD} from "../src/metamorph/MetamorphMD.sol";

/// @notice Deploys Metamorph MD against the live contracts. Env: COCOON, HOOK, PUPATE, IMD, COLLECTION,
/// POOL_MANAGER, ART (the renderer, deployed first by its own script), MIN_BITS (20 on mainnet).
/// Pool keys: the launch pool (fee 12500, spacing 60, the hook) and the ETH/IMD pool (10000, 200, no hook).
/// A dry run (no `--broadcast`) takes the same env and needs a node that has the vault, the hook, the pools
/// and the art, so the art is broadcast first; the run reads a card of each stage through `ART` and fails in
/// the simulation, before anything is sent, when the router cannot draw them.
contract DeployMetamorph is Script {
    /// What a token URI of the art begins with.
    bytes private constant DATA_URI = "data:application/json;base64,";

    function run() external returns (MetamorphMD md) {
        Cocoon cocoon = Cocoon(payable(vm.envAddress("COCOON")));
        PupateHook hook = PupateHook(payable(vm.envAddress("HOOK")));
        PupateToken pupate = PupateToken(vm.envAddress("PUPATE"));
        address imd = vm.envAddress("IMD");
        address collection = vm.envAddress("COLLECTION");
        IPoolManager manager = IPoolManager(vm.envAddress("POOL_MANAGER"));
        IMetamorphArt art = IMetamorphArt(vm.envAddress("ART"));
        // Checked whole, before it is narrowed to the constructor's uint8: 276 must not pass for 20.
        uint256 minBits = vm.envUint("MIN_BITS");
        require(minBits == 20, "mainnet floor is 20 bits");
        require(address(art).code.length != 0, "ART has no code");
        _checkArt(art);
        // The constructor also refuses a wrong wiring (`BadWiring`): IMD, the collection and the PoolManager
        // must be the ones the vault names, and the hook must pay the vault.
        require(hook.sink() == address(cocoon), "hook sink is not the vault");

        PoolKey memory pupateKey = PoolKey(
            CurrencyLibrary.ADDRESS_ZERO, Currency.wrap(address(pupate)), 12500, 60, IHooks(address(hook))
        );
        PoolKey memory imdKey =
            PoolKey(CurrencyLibrary.ADDRESS_ZERO, Currency.wrap(imd), 10000, 200, IHooks(address(0)));

        vm.startBroadcast();
        md = new MetamorphMD(
            cocoon,
            hook,
            pupate,
            IERC20Minimal(imd),
            IERC721Minimal(collection),
            manager,
            pupateKey,
            imdKey,
            art,
            uint8(minBits)
        );
        vm.stopBroadcast();

        console2.log("MetamorphMD", address(md));
        console2.log("target bits", md.bits());
        console2.log("mint price", md.mintPrice());
    }

    /// The token keeps the art's address as an immutable, so a router that cannot draw cannot be replaced.
    /// The simulation reads token 1 through `art` once as a chrysalis and once as a butterfly (seat 1376's
    /// first edition in round 0, plain, epoch 1, mined by the sender for 50,000 PUPATE) and refuses unless each
    /// token URI is at least 100 bytes and begins `data:application/json;base64,`: a wrong address, a router
    /// whose figure is missing or broken, or a contract of another kind fails here and nothing is sent.
    function _checkArt(IMetamorphArt art) internal view {
        for (uint8 stage; stage < 2; stage++) {
            string memory what = stage == 0 ? "ART chrysalis tokenURI " : "ART butterfly tokenURI ";
            IMetamorphArt.View memory v = IMetamorphArt.View({
                id: 1,
                seat: 1376,
                round: 0,
                edition: 1,
                stage: stage,
                gilt: false,
                epoch: 1,
                miner: msg.sender,
                mintedAt: uint40(block.timestamp),
                paid: 50_000 ether
            });
            bytes memory uri;
            try art.tokenURI(v) returns (string memory s) {
                uri = bytes(s);
            } catch {
                revert(string.concat(what, "reverts"));
            }
            require(uri.length >= 100, string.concat(what, "is under 100 bytes"));
            require(_startsWith(uri, DATA_URI), string.concat(what, "is not a base64 JSON data URI"));
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
