// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {Currency, CurrencyLibrary} from "v4-core/src/types/Currency.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Cocoon} from "../src/Cocoon.sol";
import {FloorFeed} from "../src/FloorFeed.sol";
import {IERC20Minimal} from "../src/interfaces/IERC20Minimal.sol";
import {PupateToken} from "../src/PupateToken.sol";
import {PupateVesting} from "../src/PupateVesting.sol";

/// @notice Step 2 of the deployment, run by the same wallet that paid for the launch, once IMD has
/// deployed the token and the hook and opened the pool. Wires Cocoon to the launch pool, moves the
/// developer's allocation into a fresh vesting contract, pins the oracle question, and hands
/// FloorFeed and Cocoon to the timelock. The hook was given the timelock at construction.
///
/// Environment:
///   COCOON, FEED, TIMELOCK   from DeployPreLaunch
///   TOKEN, HOOK              from the launch
///   DEVELOPER                beneficiary of the vesting
///   QUESTION_HASH            `questionHash` of the oracle request made with FloorFeed as consumer
///   VESTING_START            unix time the 12-month vesting starts (defaults to now)
///   VESTING                  a vesting contract an earlier, interrupted run already deployed (optional)
///   POOL_FEE, TICK_SPACING   the launch pool's (default 12500 and 60)
contract PostLaunch is Script {
    function run() external {
        Cocoon cocoon = Cocoon(payable(vm.envAddress("COCOON")));
        FloorFeed feed = FloorFeed(vm.envAddress("FEED"));
        address timelock = vm.envAddress("TIMELOCK");
        PupateToken token = PupateToken(vm.envAddress("TOKEN"));
        address hook = vm.envAddress("HOOK");
        address developer = vm.envAddress("DEVELOPER");
        bytes32 questionHash = vm.envBytes32("QUESTION_HASH");
        uint64 vestingStart = uint64(vm.envOr("VESTING_START", block.timestamp));
        uint24 fee = uint24(vm.envOr("POOL_FEE", uint256(12500)));
        int24 tickSpacing = int24(int256(vm.envOr("TICK_SPACING", uint256(60))));

        vm.startBroadcast();
        address deployer = msg.sender;

        // Every step checks the chain first, so a run that stopped halfway (a lagging node, a dropped
        // transaction) is simply run again and continues where it left off.
        PoolKey memory key = PoolKey(
            CurrencyLibrary.ADDRESS_ZERO, Currency.wrap(address(token)), fee, tickSpacing, IHooks(hook)
        );
        if (!cocoon.wired()) cocoon.wire(key);

        // VESTING reuses the contract an earlier attempt deployed; otherwise a fresh one.
        address existing = vm.envOr("VESTING", address(0));
        PupateVesting vesting = existing != address(0)
            ? PupateVesting(existing)
            : new PupateVesting(IERC20Minimal(address(token)), developer, vestingStart, 365 days);
        uint256 allocation = token.balanceOf(deployer);
        if (allocation != 0) token.transfer(address(vesting), allocation);

        if (feed.questionHash() == bytes32(0)) feed.setQuestion(questionHash);
        if (feed.owner() == deployer) feed.transferOwnership(timelock);
        if (cocoon.owner() == deployer) cocoon.transferOwnership(timelock);
        vm.stopBroadcast();

        console2.log("PupateVesting     ", address(vesting));
        console2.log("vested allocation ", allocation);
        console2.log("FloorFeed and Cocoon are now owned by the timelock", timelock);
        console2.log("Next: submit the first floor report, start the keeper, publish the site.");
    }
}
