// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {Cocoon} from "../../src/Cocoon.sol";
import {PupateToken} from "../../src/PupateToken.sol";
import {MetamorphMD} from "../../src/metamorph/MetamorphMD.sol";
import {MockERC721} from "../mocks/MockERC721.sol";

/// @dev Drives Metamorph MD with valid actions only (the suite fails on revert): mints with real
/// proofs, stakes, unstakes, claims, converts, sells seats and forgets them, pays the vault tax, and moves
/// the clock and the chain.
contract MetamorphHandler is Test {
    MetamorphMD public md;
    Cocoon public cocoon;
    PupateToken public token;
    MockERC721 public collection;
    address[] public actors;
    uint256[] public seats;
    address public sink;

    uint256 public feesPaid;
    uint256 public pupateSold;
    uint256 public seatsForgotten;
    mapping(uint256 id => uint8) public lastStage;
    uint256[] public minted;

    constructor(
        MetamorphMD md_,
        Cocoon cocoon_,
        PupateToken token_,
        MockERC721 collection_,
        address[] memory actors_,
        uint256[] memory seats_,
        address sink_
    ) {
        md = md_;
        cocoon = cocoon_;
        token = token_;
        collection = collection_;
        actors = actors_;
        seats = seats_;
        sink = sink_;
    }

    /// @dev A mint with the first nonce under the target, as the browser finds it. Gas is cheap, so the
    /// mint also runs the vault's due duties; when a conversion among them runs, what its `Converted` event
    /// reports sold is counted as sold. Nothing else excuses a drop of the pot.
    function mint(uint256 who, uint256 dt) external {
        address a = actors[who % actors.length];
        if (md.totalMinted() >= md.MAX_SUPPLY() || md.mineableSeats().length == 0) return;
        if (token.balanceOf(a) < md.mintPrice()) return;
        vm.roll(block.number + 1);
        vm.warp(block.timestamp + bound(dt, 1, 600));
        uint256 anchor = block.number - 1;
        bytes32 ah = blockhash(anchor);
        uint256 t = md.target();
        uint256 nonce = 1;
        while (uint256(md.workHash(ah, a, nonce)) >= t) nonce++;
        uint256 price = md.mintPrice();
        vm.recordLogs();
        vm.prank(a);
        uint256 id = md.mint(anchor, nonce);
        feesPaid += price;
        pupateSold += _sold(vm.getRecordedLogs());
        minted.push(id);
        lastStage[id] = md.stageOf(id);
    }

    function stake(uint256 who, uint256 pick) external {
        address a = actors[who % actors.length];
        if (minted.length == 0) return;
        uint256 id = minted[pick % minted.length];
        if (md.ownerOf(id) != a) return;
        (address staker,,) = md.stakeOf(id);
        if (staker != address(0)) return;
        uint256[] memory ids = new uint256[](1);
        ids[0] = id;
        vm.prank(a);
        md.stake(ids);
    }

    function unstake(uint256 pick) external {
        if (minted.length == 0) return;
        uint256 id = minted[pick % minted.length];
        (address staker,,) = md.stakeOf(id);
        if (staker == address(0)) return;
        uint256[] memory ids = new uint256[](1);
        ids[0] = id;
        vm.prank(staker);
        md.unstake(ids);
    }

    function claim(uint256 pick) external {
        if (minted.length == 0) return;
        uint256 id = minted[pick % minted.length];
        (address staker,,) = md.stakeOf(id);
        uint256[] memory ids = new uint256[](staker == address(0) ? 0 : 1);
        if (staker != address(0)) ids[0] = id;
        address who = staker == address(0) ? actors[pick % actors.length] : staker;
        vm.prank(who);
        md.claim(ids);
    }

    /// @dev The chain first moves past the conversion spacing, so the call is never refused as too soon.
    function convert(uint256 who) external {
        if (md.pot() == 0 && md.ethPot() == 0) return;
        vm.roll(block.number + md.CONVERT_SPACING());
        vm.recordLogs();
        vm.prank(actors[who % actors.length]);
        try md.convert() {
            pupateSold += _sold(vm.getRecordedLogs());
        } catch (bytes memory reason) {
            // Nothing to convert, or nothing bought under an exhausted bound, is a legitimate outcome;
            // anything else is a bug.
            bytes4 e = bytes4(reason);
            require(
                e == MetamorphMD.NothingToConvert.selector || e == MetamorphMD.NothingBought.selector,
                "convert reverted"
            );
        }
    }

    /// @dev A settled sale, as the fixture's `_sell`: the seat leaves the vault's wallet for the sink and
    /// the vault settles it. A sold seat never goes back to the vault, so no card's stage falls back. Then
    /// the seat is forgotten, as the page and the keeper do after a sale: every seat of the campaign is
    /// noted in its setup and sold once at most, so it is noted here, and no longer held.
    function sellSeat(uint256 pick) external {
        uint256 seat = seats[pick % seats.length];
        (,,,,, bool held,) = cocoon.seats(seat);
        if (!held || collection.ownerOf(seat) != address(cocoon)) return;
        vm.prank(address(cocoon));
        collection.transferFrom(address(cocoon), sink, seat);
        cocoon.settleSeat(seat);
        md.forgetSeat(seat);
        seatsForgotten++;
        _refreshStages();
    }

    /// @dev Tax reaches the vault, as the hook's flush delivers it; 0.05 ETH puts the burn minimum in the
    /// burn pot whatever the vault's mode. Cheap mints then run burns, and each burn's ETH reward passes
    /// through the contract to the miner. Without it no burn would ever come due.
    function tax(uint256 amount) external {
        amount = bound(amount, 0.05 ether, 2 ether);
        vm.deal(address(this), amount);
        cocoon.depositTax{value: amount}();
    }

    function pass(uint256 dt) external {
        vm.warp(block.timestamp + bound(dt, 1, 30 days));
        vm.roll(block.number + 1);
        _refreshStages();
    }

    function mintedCount() external view returns (uint256) {
        return minted.length;
    }

    /// @dev Raises each card's recorded stage to the one it has now, so the suite checks it never falls.
    function _refreshStages() private {
        for (uint256 i; i < minted.length; i++) {
            uint8 s = md.stageOf(minted[i]);
            if (s > lastStage[minted[i]]) lastStage[minted[i]] = s;
        }
    }

    /// @dev The PUPATE the conversions among `logs` sold, as the contract's own `Converted` events report.
    function _sold(Vm.Log[] memory logs) private view returns (uint256 sold) {
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter != address(md) || logs[i].topics[0] != MetamorphMD.Converted.selector) {
                continue;
            }
            (uint256 s,,,) = abi.decode(logs[i].data, (uint256, uint256, uint256, uint256));
            sold += s;
        }
    }
}
