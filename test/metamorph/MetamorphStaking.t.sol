// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Vm} from "forge-std/Vm.sol";
import {MetamorphFixture} from "./MetamorphFixture.sol";
import {MetamorphHarness} from "./MetamorphHarness.sol";
import {MetamorphMD} from "../../src/metamorph/MetamorphMD.sol";
import {IERC20Minimal} from "../../src/interfaces/IERC20Minimal.sol";
import {IERC721Minimal} from "../../src/interfaces/IERC721Minimal.sol";
import {IMetamorphArt} from "../../src/interfaces/IMetamorphArt.sol";

contract MetamorphStakingTest is MetamorphFixture {
    MetamorphHarness h;

    function _deploy(uint8 minBits) internal override returns (MetamorphMD) {
        h = new MetamorphHarness(
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
        return MetamorphMD(payable(address(h)));
    }

    function _credit(uint256 amount) private {
        imd.mint(address(h), amount);
        h.creditForTests(amount);
    }

    function _ids(uint256 a) private pure returns (uint256[] memory ids) {
        ids = new uint256[](1);
        ids[0] = a;
    }

    function _seatOf(uint256 id) private view returns (uint32 seat) {
        (seat,,,,,,,) = md.cards(id);
    }

    function test_stakeLocksAndWeighsOne() public {
        uint256 id = _mintAs(miner);
        vm.prank(miner);
        md.stake(_ids(id));
        (address staker, uint8 weight,) = md.stakeOf(id);
        assertEq(staker, miner);
        assertEq(weight, 1);
        assertEq(md.totalWeight(), 1);
        assertEq(md.ownerOf(id), miner, "the card stays in the wallet");
    }

    function test_onlyTheOwnerStakesAndOnlyOnce() public {
        uint256 id = _mintAs(miner);
        vm.prank(other);
        vm.expectRevert(MetamorphMD.NotCardOwner.selector);
        md.stake(_ids(id));
        vm.prank(miner);
        md.stake(_ids(id));
        vm.prank(miner);
        vm.expectRevert(MetamorphMD.Staked.selector);
        md.stake(_ids(id));
    }

    function test_stakedCardCannotMoveByAnyPath() public {
        uint256 id = _mintAs(miner);
        vm.prank(miner);
        md.stake(_ids(id));
        vm.prank(miner);
        vm.expectRevert(MetamorphMD.Staked.selector);
        md.transferFrom(miner, other, id);
        vm.prank(miner);
        md.setApprovalForAll(other, true);
        vm.prank(other);
        vm.expectRevert(MetamorphMD.Staked.selector);
        md.safeTransferFrom(miner, other, id);
        vm.prank(other);
        vm.expectRevert(MetamorphMD.Staked.selector);
        md.safeTransferFrom(miner, other, id, "");
        vm.prank(miner);
        md.unstake(_ids(id));
        vm.prank(miner);
        md.transferFrom(miner, other, id);
        assertEq(md.ownerOf(id), other);
    }

    function test_creditWithNoStakersGoesToTheDeveloper() public {
        uint256 before = imd.balanceOf(developer);
        _credit(1000 ether);
        assertEq(imd.balanceOf(developer) - before, 1000 ether);
        assertEq(md.imdOwed(), 0);
    }

    function test_twoStakersSplitByWeightAcrossTime() public {
        uint256 a = _mintAs(miner);
        vm.roll(block.number + 1);
        token.transfer(other, 1_000_000 ether);
        vm.prank(other);
        token.approve(address(md), type(uint256).max);
        uint256 b = _mintAs(other);
        vm.prank(miner);
        md.stake(_ids(a));
        _credit(100 ether); // miner alone: 100
        vm.prank(other);
        md.stake(_ids(b));
        _credit(100 ether); // both: 50 / 50
        assertEq(md.imdOwed(), 200 ether);
        vm.prank(miner);
        uint256 paid = md.claim(_ids(a));
        assertEq(paid, 150 ether);
        assertEq(imd.balanceOf(miner), 150 ether);
        vm.prank(other);
        paid = md.claim(_ids(b));
        assertEq(paid, 50 ether);
        assertEq(md.imdOwed(), 0);
        // Nothing more to claim until the next credit.
        vm.prank(miner);
        assertEq(md.claim(_ids(a)), 0);
    }

    function test_unstakeSettlesFirst() public {
        uint256 a = _mintAs(miner);
        vm.prank(miner);
        md.stake(_ids(a));
        _credit(40 ether);
        vm.prank(miner);
        md.unstake(_ids(a));
        assertEq(md.totalWeight(), 0);
        assertEq(md.pendingIMD(miner), 40 ether);
        // A later credit with nobody staked goes to the developer, not to the former staker.
        _credit(10 ether);
        assertEq(md.pendingIMD(miner), 40 ether);
        vm.prank(miner);
        assertEq(md.claim(new uint256[](0)), 40 ether);
    }

    function test_butterflyWeighsTwoOnTheNextTouch() public {
        uint256 a = _mintAs(miner);
        vm.prank(miner);
        md.stake(_ids(a));
        _sell(1376);
        (, uint8 weight,) = md.stakeOf(a);
        assertEq(weight, 1, "not until touched");
        _credit(30 ether); // still weight 1 while earning this
        vm.prank(miner);
        vm.expectEmit(true, false, false, true);
        emit MetamorphMD.Reweighed(a, 2);
        md.claim(_ids(a));
        (, weight,) = md.stakeOf(a);
        assertEq(weight, 2);
        assertEq(md.totalWeight(), 2);
        assertEq(imd.balanceOf(miner), 30 ether);
    }

    /// A stranger pokes a staked card: its staker's pending grows, the stranger's does not, and an emerged
    /// card reaches weight 2 without its staker's touch.
    function test_anyoneCanPokeAndOnlyTheStakerEarns() public {
        uint256 id = _mintAs(miner);
        uint256[] memory ids = new uint256[](1);
        ids[0] = id;
        vm.prank(miner);
        md.stake(ids);
        _credit(30 ether);
        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        md.poke(ids);
        assertEq(md.pendingIMD(miner), 30 ether, "the staker was credited");
        assertEq(md.pendingIMD(stranger), 0, "the stranger was not");
        (, uint8 w,) = md.stakeOf(id);
        assertEq(w, 1, "still a chrysalis");
        _sell(uint256(_seatOf(id))); // the seat leaves the vault: the card emerges
        vm.expectEmit(true, false, false, true, address(md));
        emit MetamorphMD.MetadataUpdate(id);
        vm.prank(stranger);
        md.poke(ids);
        (, w,) = md.stakeOf(id);
        assertEq(w, 2, "reweighed to butterfly by a stranger's poke");
        assertEq(md.totalWeight(), 2);
    }

    /// An unstaked id in a batch is skipped, so one unstake cannot void a keeper's batch: the staked card
    /// beside it is settled, and the unstaked one gains no weight. An empty batch does nothing.
    function test_pokeSkipsUnstakedCardsAndAnEmptyList() public {
        uint256 loose = _mintAs(miner);
        vm.roll(block.number + 1);
        uint256 held = _mintAs(miner);
        vm.prank(miner);
        md.stake(_ids(held));
        _credit(30 ether);
        uint256[] memory ids = new uint256[](2);
        ids[0] = loose;
        ids[1] = held;
        md.poke(ids);
        assertEq(md.pendingIMD(miner), 30 ether, "the staked card in the batch was settled");
        (address staker, uint8 w,) = md.stakeOf(loose);
        assertEq(staker, address(0), "the unstaked card stays unstaked");
        assertEq(w, 0, "and weighs nothing");
        assertEq(md.totalWeight(), 1, "only the staked card weighs");
        md.poke(new uint256[](0)); // no-op
    }

    /// A poke that does not change the weight emits no MetadataUpdate.
    function test_pokeWithoutAStageChangeIsSilent() public {
        uint256 id = _mintAs(miner);
        uint256[] memory ids = new uint256[](1);
        ids[0] = id;
        vm.prank(miner);
        md.stake(ids);
        vm.recordLogs();
        md.poke(ids);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; i++) {
            assertTrue(logs[i].topics[0] != MetamorphMD.MetadataUpdate.selector, "no MetadataUpdate");
        }
    }

    function test_claimOnlyTouchesYourOwnStakes() public {
        uint256 a = _mintAs(miner);
        vm.prank(miner);
        md.stake(_ids(a));
        vm.prank(other);
        vm.expectRevert(MetamorphMD.NotStaked.selector);
        md.claim(_ids(a));
        vm.prank(other);
        vm.expectRevert(MetamorphMD.NotStaked.selector);
        md.unstake(_ids(a));
    }

    function testFuzz_neverPaysMoreThanItHolds(uint96 c1, uint96 c2, uint96 c3) public {
        uint256 a = _mintAs(miner);
        vm.roll(block.number + 1);
        token.transfer(other, 1_000_000 ether);
        vm.prank(other);
        token.approve(address(md), type(uint256).max);
        uint256 b = _mintAs(other);
        vm.prank(miner);
        md.stake(_ids(a));
        _credit(c1);
        vm.prank(other);
        md.stake(_ids(b));
        _credit(c2);
        vm.prank(miner);
        md.unstake(_ids(a));
        _credit(c3);
        vm.prank(miner);
        uint256 p1 = md.claim(new uint256[](0));
        vm.prank(other);
        uint256 p2 = md.claim(_ids(b));
        assertLe(p1 + p2, uint256(c1) + c2 + c3);
        assertLe(md.imdOwed(), imd.balanceOf(address(md)));
    }
}
