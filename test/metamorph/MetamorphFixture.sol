// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {FixedPoint96} from "v4-core/src/libraries/FixedPoint96.sol";
import {FullMath} from "v4-core/src/libraries/FullMath.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {Currency, CurrencyLibrary} from "v4-core/src/types/Currency.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {IERC20Minimal} from "../../src/interfaces/IERC20Minimal.sol";
import {IERC721Minimal} from "../../src/interfaces/IERC721Minimal.sol";
import {IMetamorphArt} from "../../src/interfaces/IMetamorphArt.sol";
import {MetamorphMD} from "../../src/metamorph/MetamorphMD.sol";
import {StubArt} from "../mocks/StubArt.sol";
import {CocoonFixture} from "../utils/CocoonFixture.sol";

/// @dev The vault fixture plus an ETH/IMD pool (1 ETH = 256 IMD, 100 ETH deep, no hook), the stub
/// art, and Metamorph MD at a one-bit floor so a proof is found in a handful of hashes. The vault holds
/// seat 1376 from the start and the miner holds 100M PUPATE, approved.
abstract contract MetamorphFixture is CocoonFixture {
    uint24 internal constant IMD_FEE = 10_000;
    int24 internal constant IMD_SPACING = 200;
    /// sqrt(256) * 2^96
    uint160 internal constant IMD_SQRT_PRICE = uint160(16 * FixedPoint96.Q96);

    StubArt internal art;
    MetamorphMD internal md;
    PoolKey internal imdKey;
    address internal miner = makeAddr("miner");
    address internal other = makeAddr("other");

    function setUp() public virtual override {
        super.setUp();
        vm.roll(block.number + 60);
        // The launch pool has no liquidity above its opening tick, so a later sale from the opening price
        // would buy nothing. Buy once after the launch window, let the vault take and spend its tax, and
        // leave the price inside the seeded range with no duty due.
        _endLaunch();
        _buyExactIn(1 ether);
        hook.flush();
        vm.roll(block.number + 6);
        cocoon.burn();
        vm.roll(block.number + 60);

        imdKey = PoolKey(
            CurrencyLibrary.ADDRESS_ZERO,
            Currency.wrap(address(imd)),
            IMD_FEE,
            IMD_SPACING,
            IHooks(address(0))
        );
        imd.mint(address(this), 10_000_000 ether);
        imd.approve(address(router), type(uint256).max);
        int24 lower = TickMath.minUsableTick(IMD_SPACING);
        int24 upper = TickMath.maxUsableTick(IMD_SPACING);
        // Full range: about 100 ETH on one side and 25,600 IMD on the other at the opening price.
        uint256 liquidity = FullMath.mulDiv(100 ether, IMD_SQRT_PRICE, FixedPoint96.Q96);
        router.open{value: 101 ether}(
            imdKey, IMD_SQRT_PRICE, ModifyLiquidityParams(lower, upper, int256(liquidity), bytes32(0))
        );

        art = new StubArt();
        md = _deploy(1);

        _setFloor(2 ether);
        _giveSeat(1376);
        md.noteSeat(1376);

        token.transfer(miner, 100_000_000 ether);
        vm.prank(miner);
        token.approve(address(md), type(uint256).max);
        vm.deal(miner, 10 ether);

        // Gas is dear by default, above the base fee under which a mint runs the vault's duties, so each suite
        // tests its own concern; the suites about the duties make gas cheap. Under `forge test --isolate`,
        // `vm.fee` does not reach the isolated calls, so mints run their duties whatever it says and 9 of the
        // metamorph tests fail there. The default mode is the supported one.
        vm.fee(3 gwei);
    }

    function _deploy(uint8 minBits) internal virtual returns (MetamorphMD) {
        return new MetamorphMD(
            cocoon,
            hook,
            token,
            IERC20Minimal(address(imd)),
            IERC721Minimal(address(collection)),
            manager,
            key,
            imdKey,
            IMetamorphArt(address(art)),
            minBits
        );
    }

    function _anchor() internal view returns (uint256) {
        return block.number - 1;
    }

    /// @dev The first nonce whose proof is under the effective target, for `who` at `anchor`, as the
    /// browser does.
    function _proof(address who, uint256 anchor) internal view returns (uint256 nonce) {
        bytes32 ah = blockhash(anchor);
        uint256 t = md.effectiveTarget();
        for (nonce = 1;; nonce++) {
            if (uint256(md.workHash(ah, who, nonce)) < t) return nonce;
        }
    }

    function _mintAs(address who) internal returns (uint256 id) {
        uint256 a = _anchor();
        uint256 n = _proof(who, a);
        vm.prank(who);
        id = md.mint(a, n);
    }

    /// @dev The vault "sells" a seat: it leaves the vault and the books, the way a filled listing ends.
    function _sell(uint256 seat) internal {
        vm.prank(address(cocoon));
        collection.transferFrom(address(cocoon), other, seat);
        cocoon.settleSeat(seat);
    }
}
