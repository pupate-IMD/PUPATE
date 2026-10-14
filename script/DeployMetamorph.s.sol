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
contract DeployMetamorph is Script {
    function run() external returns (MetamorphMD md) {
        Cocoon cocoon = Cocoon(payable(vm.envAddress("COCOON")));
        PupateHook hook = PupateHook(payable(vm.envAddress("HOOK")));
        PupateToken pupate = PupateToken(vm.envAddress("PUPATE"));
        address imd = vm.envAddress("IMD");
        address collection = vm.envAddress("COLLECTION");
        IPoolManager manager = IPoolManager(vm.envAddress("POOL_MANAGER"));
        IMetamorphArt art = IMetamorphArt(vm.envAddress("ART"));
        uint8 minBits = uint8(vm.envUint("MIN_BITS"));
        require(minBits == 20, "mainnet floor is 20 bits");
        require(address(art).code.length != 0, "ART has no code");
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
            minBits
        );
        vm.stopBroadcast();

        console2.log("MetamorphMD", address(md));
        console2.log("target bits", md.bits());
        console2.log("mint price", md.mintPrice());
    }
}
