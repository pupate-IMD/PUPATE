// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Cocoon} from "../../src/Cocoon.sol";
import {PupateHook} from "../../src/PupateHook.sol";
import {PupateToken} from "../../src/PupateToken.sol";
import {IERC20Minimal} from "../../src/interfaces/IERC20Minimal.sol";
import {IERC721Minimal} from "../../src/interfaces/IERC721Minimal.sol";
import {IMetamorphArt} from "../../src/interfaces/IMetamorphArt.sol";
import {MetamorphMD} from "../../src/metamorph/MetamorphMD.sol";

/// @dev The contract with one test-only door: credit IMD to the stakers as a conversion would, so the
/// staking arithmetic is tested apart from the pools.
contract MetamorphHarness is MetamorphMD {
    constructor(
        Cocoon c,
        PupateHook h,
        PupateToken p,
        IERC20Minimal i,
        IERC721Minimal col,
        IPoolManager pm,
        PoolKey memory pk,
        PoolKey memory ik,
        IMetamorphArt a,
        uint8 bits_
    ) MetamorphMD(c, h, p, i, col, pm, pk, ik, a, bits_) {}

    /// @dev The caller must have transferred `imd` to this contract first.
    function creditForTests(uint256 imd) external {
        _credit(imd);
    }
}
