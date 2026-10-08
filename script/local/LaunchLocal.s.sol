// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {Currency, CurrencyLibrary} from "v4-core/src/types/Currency.sol";
import {PoolId} from "v4-core/src/types/PoolId.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PupateHook} from "../../src/PupateHook.sol";
import {PupateToken} from "../../src/PupateToken.sol";
import {LocalLaunchFactory} from "./LocalLaunchFactory.sol";

/// @notice LOCAL ONLY. Plays IMD's launch of Pupate on an anvil fork of mainnet, between
/// `DeployPreLaunch` and `PostLaunch`, the way the IMD factory does it: the token (supply minted to the
/// deployer, as it is to the factory), the hook at a mined CREATE2 address carrying flags 0x18CC, and
/// the pool opened at 1 ETH = 100,000,000 PUPATE and seeded with 85% of supply in one transaction.
/// The hook deploys through the default CREATE2 factory 0x4e59b44847b379578588920cA78FbF26c0B4956C,
/// which exists on mainnet, so the address is predicted against it. The 10% swarm share leaves the
/// deployer so that, as on mainnet, exactly 5% is left for `PostLaunch` to vest.
///
/// Environment:
///   POOL_MANAGER, COCOON, TIMELOCK   the hook's constructor arguments (Cocoon, timelock from DeployPreLaunch)
///   POOL_FEE, TICK_SPACING           the launch pool's (default 12500 and 60, IMD policy v34)
///   SWARM_SHARE_TO                   where the 10% swarm share goes locally (default anvil account #8;
///                                    the zero address keeps it with the deployer)
contract LaunchLocal is Script {
    /// @dev afterInitialize, beforeAddLiquidity, beforeSwap, afterSwap, beforeSwapReturnDelta,
    /// afterSwapReturnDelta: the low 14 bits of the hook's address.
    uint160 internal constant HOOK_FLAGS = 0x18CC;
    /// @dev sqrt(1e8) * 2^96: 1 ETH buys 100,000,000 PUPATE, a 10 ETH valuation of the supply.
    uint160 internal constant SQRT_PRICE_OPEN = 792281625142643375935439503360000;
    uint256 internal constant POOL_SHARE = 850_000_000 ether;
    uint256 internal constant SWARM_SHARE = 100_000_000 ether;

    struct Config {
        address poolManager;
        address cocoon;
        address timelock;
        uint24 fee;
        int24 tickSpacing;
        address swarm;
    }

    struct Seed {
        int24 tick;
        int24 lower;
        int24 upper;
        uint256 liquidity;
        uint256 seeded;
    }

    struct Result {
        PupateToken token;
        PupateHook hook;
        LocalLaunchFactory factory;
        bytes32 salt;
        PoolKey key;
        Seed seed;
        address deployer;
    }

    function run() external {
        Config memory c = _config();
        Result memory r;

        // Off-chain part of the launch: the salt whose CREATE2 address carries exactly the hook's flags.
        bytes32 initHash = keccak256(
            abi.encodePacked(
                type(PupateHook).creationCode, abi.encode(IPoolManager(c.poolManager), c.cocoon, c.timelock)
            )
        );
        address predicted;
        (r.salt, predicted) = _mine(initHash);
        require(vm.computeCreate2Address(r.salt, initHash, CREATE2_FACTORY) == predicted, "prediction");

        vm.startBroadcast();
        r.deployer = msg.sender;

        r.token = new PupateToken();
        r.hook = new PupateHook{salt: r.salt}(IPoolManager(c.poolManager), c.cocoon, c.timelock);
        require(address(r.hook) == predicted, "CREATE2 address");

        r.factory = new LocalLaunchFactory(IPoolManager(c.poolManager));
        r.token.transfer(address(r.factory), POOL_SHARE);
        r.key = PoolKey(
            CurrencyLibrary.ADDRESS_ZERO,
            Currency.wrap(address(r.token)),
            c.fee,
            c.tickSpacing,
            IHooks(address(r.hook))
        );
        (r.seed.tick, r.seed.lower, r.seed.upper, r.seed.liquidity, r.seed.seeded) =
            r.factory.open(r.key, SQRT_PRICE_OPEN);

        if (c.swarm != address(0)) r.token.transfer(c.swarm, SWARM_SHARE);
        vm.stopBroadcast();

        _check(r, c);
        _log(r, c);
    }

    function _config() internal view returns (Config memory c) {
        c.poolManager = vm.envAddress("POOL_MANAGER");
        c.cocoon = vm.envAddress("COCOON");
        c.timelock = vm.envAddress("TIMELOCK");
        c.fee = uint24(vm.envOr("POOL_FEE", uint256(12500)));
        c.tickSpacing = int24(int256(vm.envOr("TICK_SPACING", uint256(60))));
        c.swarm = vm.envOr("SWARM_SHARE_TO", address(0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f));
    }

    function _check(Result memory r, Config memory c) internal view {
        require(r.hook.openedAt() != 0, "pool not opened");
        require(PoolId.unwrap(r.hook.launchPool()) == PoolId.unwrap(r.key.toId()), "wrong launch pool");
        require(r.hook.sink() == c.cocoon && r.hook.owner() == c.timelock, "hook wiring");
    }

    function _log(Result memory r, Config memory c) internal view {
        console2.log("PupateToken       ", address(r.token));
        console2.log("PupateHook        ", address(r.hook));
        console2.log("LocalLaunchFactory", address(r.factory));
        console2.log("hook salt         ", vm.toString(r.salt));
        console2.log("pool id           ", vm.toString(PoolId.unwrap(r.key.toId())));
        console2.log("opening tick      ", vm.toString(int256(r.seed.tick)));
        console2.log("seed lower tick   ", vm.toString(int256(r.seed.lower)));
        console2.log("seed upper tick   ", vm.toString(int256(r.seed.upper)));
        console2.log("seed liquidity    ", r.seed.liquidity);
        console2.log("seeded PUPATE wei ", r.seed.seeded);
        console2.log("swarm share to    ", c.swarm);
        console2.log("deployer PUPATE   ", r.token.balanceOf(r.deployer));
        console2.log("Next: PostLaunch with TOKEN and HOOK above, then ReportLocal.");
    }

    /// @dev Mines a CREATE2 salt, against the default CREATE2 factory, until the address carries exactly
    /// HOOK_FLAGS in its low 14 bits and nothing is deployed there. Same loop as test/utils/HookFixture.
    function _mine(bytes32 initHash) internal view returns (bytes32 salt, address predicted) {
        for (uint256 s; s < 1_000_000; ++s) {
            address p = address(
                uint160(
                    uint256(keccak256(abi.encodePacked(bytes1(0xff), CREATE2_FACTORY, bytes32(s), initHash)))
                )
            );
            if (uint160(p) & Hooks.ALL_HOOK_MASK != HOOK_FLAGS || p.code.length != 0) continue;
            return (bytes32(s), p);
        }
        revert("no salt");
    }
}
