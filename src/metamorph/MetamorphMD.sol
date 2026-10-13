// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {FullMath} from "v4-core/src/libraries/FullMath.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {Cocoon} from "../Cocoon.sol";
import {PupateHook} from "../PupateHook.sol";
import {PupateToken} from "../PupateToken.sol";
import {IERC20Minimal} from "../interfaces/IERC20Minimal.sol";
import {IERC721Minimal} from "../interfaces/IERC721Minimal.sol";
import {IMetamorphArt} from "../interfaces/IMetamorphArt.sol";
import {ERC721Lite} from "./ERC721Lite.sol";

/// @title Metamorph MD
/// @notice 3,333 cards of the identity.md seats Pupate's vault holds, mined in the browser. One valid
/// proof is one mint; the hash picks the seat; the fee is PUPATE, 70% to a pot converted to IMD for the
/// stakers and 30% to the developer; a mint also runs the vault's due duties and pays the miner their
/// rewards. A card is a chrysalis until the vault no longer holds its seat, then a butterfly. No keys.
contract MetamorphMD is ERC721Lite, IUnlockCallback {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    // ------------------------------------------------------------------ errors and events

    error SupplyExhausted();
    error NothingMineable();
    error BadAnchor();
    error BadBits();
    error BadPoolKey();
    error NotASolution();
    error SeatNotHeld();
    error Staked();
    error NotStaked();
    error NotCardOwner();
    error NothingToConvert();
    error NothingBought();
    error OnlyPoolManager();
    error OnlySelf();
    error UnexpectedCallback();
    error Reentrancy();
    error TransferFailed();

    event Minted(
        uint256 indexed id,
        uint256 indexed seat,
        uint16 round,
        uint16 edition,
        address indexed miner,
        bytes32 work,
        bool gilt,
        uint256 price,
        uint16 epoch
    );
    event Retargeted(uint256 target);
    event SeatNoted(uint256 indexed seat);
    event Converted(
        uint256 pupateSold, uint256 ethBought, uint256 imdBought, address indexed caller, uint256 reward
    );
    event StakedCard(uint256 indexed id, address indexed staker, uint8 weight);
    event Unstaked(uint256 indexed id, address indexed staker);
    event Claimed(address indexed staker, uint256 imd);
    event Reweighed(uint256 indexed id, uint8 weight);
    /// kind: 0 flush, 1 burn, 2 convert; paid: what the miner received for it (ETH wei or IMD wei)
    event DutyRun(uint8 kind, uint256 paid);

    // ------------------------------------------------------------------ constants

    bytes32 public constant DOMAIN = keccak256("Metamorph MD work v1");
    uint16 public constant EDITIONS = 303;
    uint16 public constant MAX_SUPPLY = 3333;
    uint16 public constant EPOCH = 303;
    uint256 public constant BASE_PRICE = 50_000 ether;
    uint256 public constant TARGET_INTERVAL = 90;
    uint256 public constant ANCHOR_WINDOW = 50;
    uint256 public constant STAKER_BPS = 7000;
    uint256 public constant CONVERT_IMPACT_BPS = 500;
    uint256 public constant CALLER_REWARD_BPS = 50;
    uint256 public constant DUTY_MAX_BASEFEE = 2 gwei;
    uint256 public constant MIN_FLUSH = 0.005 ether;
    uint256 public constant MIN_BURN = 0.01 ether;
    uint256 public constant BUTTERFLY_CEILING = 90 days;
    uint256 public constant ROYALTY_BPS = 500;
    uint256 public constant DUTY_GAS = 400_000;
    uint256 public constant CONVERT_GAS = 900_000;
    uint256 private constant BPS = 10_000;
    uint256 private constant ACC = 1e18;
    uint256 private constant LOCK_SLOT = 1;

    // ------------------------------------------------------------------ immutables

    Cocoon public immutable COCOON;
    PupateHook public immutable HOOK;
    PupateToken public immutable PUPATE;
    IERC20Minimal public immutable IMD;
    IERC721Minimal public immutable COLLECTION;
    IPoolManager public immutable POOL_MANAGER;
    IMetamorphArt public immutable ART;
    /// @notice The difficulty floor of epoch one, in bits; it rises one bit per epoch.
    uint8 public immutable MIN_BITS;

    PoolKey internal pupateKey;
    PoolKey internal imdKey;

    // ------------------------------------------------------------------ storage

    struct Card {
        uint32 seat;
        uint16 round;
        uint16 edition;
        bool gilt;
        uint40 mintedAt;
        uint96 paid;
        address miner;
        bytes32 work;
    }

    struct Stake {
        address staker;
        uint8 weight;
        /// weight × accIMDPerWeight at the last settlement (ACC units)
        uint256 debt;
    }

    bytes32 public prevWork;
    uint256 public target;
    uint40 public lastMintAt;
    uint16 public totalMinted;
    mapping(uint256 id => Card) public cards;
    mapping(uint256 seat => mapping(uint16 round => uint16)) public editionsMinted;

    uint256[] private _seats;
    mapping(uint256 seat => bool) public noted;

    /// @notice PUPATE waiting to be converted for the stakers.
    uint256 public pot;
    /// @notice ETH a conversion bought but the IMD pool could not absorb yet; spent by the next one.
    uint256 public ethPot;
    uint256 public accIMDPerWeight;
    uint256 public totalWeight;
    /// @notice IMD credited to stakers and not yet paid out.
    uint256 public imdOwed;
    mapping(uint256 id => Stake) public stakeOf;
    mapping(address staker => uint256) public pendingIMD;

    // ------------------------------------------------------------------ construction

    modifier nonReentrant() {
        if (_tload(LOCK_SLOT) != 0) revert Reentrancy();
        _tstore(LOCK_SLOT, 1);
        _;
        _tstore(LOCK_SLOT, 0);
    }

    constructor(
        Cocoon cocoon_,
        PupateHook hook_,
        PupateToken pupate_,
        IERC20Minimal imd_,
        IERC721Minimal collection_,
        IPoolManager poolManager_,
        PoolKey memory pupateKey_,
        PoolKey memory imdKey_,
        IMetamorphArt art_,
        uint8 minBits_
    ) ERC721Lite("Metamorph MD", "MMD") {
        if (
            address(cocoon_) == address(0) || address(hook_) == address(0) || address(pupate_) == address(0)
                || address(imd_) == address(0) || address(collection_) == address(0)
                || address(poolManager_) == address(0) || address(art_) == address(0)
        ) revert ZeroAddress();
        if (minBits_ == 0 || minBits_ > 200) revert BadBits();
        // The conversion trades in two pools: ETH/PUPATE on the launch hook, and ETH/IMD, which has no hook.
        if (
            !pupateKey_.currency0.isAddressZero() || Currency.unwrap(pupateKey_.currency1) != address(pupate_)
                || address(pupateKey_.hooks) != address(hook_) || !imdKey_.currency0.isAddressZero()
                || Currency.unwrap(imdKey_.currency1) != address(imd_) || address(imdKey_.hooks) != address(0)
        ) revert BadPoolKey();
        COCOON = cocoon_;
        HOOK = hook_;
        PUPATE = pupate_;
        IMD = imd_;
        COLLECTION = collection_;
        POOL_MANAGER = poolManager_;
        ART = art_;
        MIN_BITS = minBits_;
        pupateKey = pupateKey_;
        imdKey = imdKey_;
        prevWork = DOMAIN;
        target = _ceiling(1);
        lastMintAt = uint40(block.timestamp);
    }

    receive() external payable {}

    // ------------------------------------------------------------------ the work chain, read

    /// @notice The proof the contract computes for a miner's nonce at an anchor; the miner's self-test.
    function workHash(bytes32 anchorHash_, address miner_, uint256 nonce) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                DOMAIN,
                block.chainid,
                address(this),
                keccak256(abi.encode(anchorHash_, prevWork)),
                miner_,
                nonce
            )
        );
    }

    /// @notice `blockhash` of a block, zero when it is not available.
    function anchorHash(uint256 blockNumber) public view returns (bytes32) {
        return blockhash(blockNumber);
    }

    /// @notice The current epoch, 1 to 11: one per 303 mints; a sold-out collection stays in the last.
    function epoch() public view returns (uint16) {
        if (totalMinted >= MAX_SUPPLY) return uint16(MAX_SUPPLY / EPOCH);
        return totalMinted / EPOCH + 1;
    }

    /// @notice The mint price of an epoch: 50,000 PUPATE, ×1.25 per epoch.
    function priceAt(uint16 epoch_) public pure returns (uint256 price) {
        price = BASE_PRICE;
        for (uint16 i = 1; i < epoch_; i++) {
            price = price * 125 / 100;
        }
    }

    function mintPrice() public view returns (uint256) {
        return priceAt(epoch());
    }

    /// @notice Leading zero bits a proof needs right now, for display.
    function bits() public view returns (uint8 n) {
        uint256 t = target;
        while (n < 255 && (t >> (255 - n)) == 0) n++;
    }

    function notedSeats() external view returns (uint256[] memory) {
        return _seats;
    }

    /// @notice The seats a mint may pick from, in the order the hash indexes them: noted, still held by
    /// the vault in their current round, and with editions left.
    function mineableSeats() public view returns (uint256[] memory open) {
        uint256 n = _seats.length;
        uint256[] memory buf = new uint256[](n);
        uint256 k;
        for (uint256 i; i < n; i++) {
            uint256 seat = _seats[i];
            (bool held, uint16 round) = _vaultHolds(seat);
            if (held && editionsMinted[seat][round] < EDITIONS) buf[k++] = seat;
        }
        open = new uint256[](k);
        for (uint256 i; i < k; i++) {
            open[i] = buf[i];
        }
    }

    /// @notice Tell the contract about a seat the vault holds. Anyone may; the page and the keeper do.
    function noteSeat(uint256 seat) external {
        (bool held,) = _vaultHolds(seat);
        if (!held) revert SeatNotHeld();
        if (noted[seat]) return;
        noted[seat] = true;
        _seats.push(seat);
        emit SeatNoted(seat);
    }

    // ------------------------------------------------------------------ the mint

    /// @notice Mint with a proof for `anchor` (a block 1 to 50 behind) and `nonce`. The hash picks the
    /// seat; the fee is `mintPrice()` in PUPATE, 70% to the pot and 30% to the developer; then the
    /// vault's due duties run and pay the caller.
    function mint(uint256 anchor, uint256 nonce) external nonReentrant returns (uint256 id) {
        if (totalMinted >= MAX_SUPPLY) revert SupplyExhausted();
        bytes32 work = workHash(_anchor(anchor), msg.sender, nonce);
        uint256 t = target;
        if (uint256(work) >= t) revert NotASolution();
        (uint256 seat, uint16 round) = _pick(uint256(work));
        uint16 edition = ++editionsMinted[seat][round];

        uint16 epoch_ = epoch();
        uint256 price = priceAt(epoch_);
        uint256 toPot = price * STAKER_BPS / BPS;
        _pull(msg.sender, address(this), toPot);
        _pull(msg.sender, COCOON.developer(), price - toPot);
        pot += toPot;

        id = ++totalMinted;
        bool gilt = uint256(work) < (t >> 4);
        cards[id] = Card(
            uint32(seat), round, edition, gilt, uint40(block.timestamp), uint96(price), msg.sender, work
        );
        _mint(msg.sender, id);
        emit Minted(id, seat, round, edition, msg.sender, work, gilt, price, epoch_);

        prevWork = work;
        _retarget();
        lastMintAt = uint40(block.timestamp);
        _duties(msg.sender);
    }

    /// @dev Runs the vault's due duties for a miner. Filled in by a later task.
    function _duties(address) internal virtual {}

    // ------------------------------------------------------------------ internals (mint)

    function _anchor(uint256 anchor) private view returns (bytes32 h) {
        if (anchor >= block.number || block.number - anchor > ANCHOR_WINDOW) revert BadAnchor();
        h = blockhash(anchor);
        if (h == bytes32(0)) revert BadAnchor();
    }

    function _pick(uint256 work) private view returns (uint256 seat, uint16 round) {
        uint256[] memory open = mineableSeats();
        if (open.length == 0) revert NothingMineable();
        seat = open[work % open.length];
        (,,,,,, round) = COCOON.seats(seat);
    }

    /// @dev Every mint moves the target toward one mint per `TARGET_INTERVAL`, by at most ×4 or ÷4, and
    /// never above the epoch's ceiling. Reads `epoch()` after `totalMinted` moved, so the ceiling of the
    /// epoch the next mint belongs to applies. FullMath keeps `target × elapsed` from overflowing at a
    /// low floor (the test suite runs at one bit).
    function _retarget() private {
        uint256 elapsed = block.timestamp - lastMintAt;
        uint256 next;
        if (elapsed >= 4 * TARGET_INTERVAL) {
            next = target > type(uint256).max / 4 ? type(uint256).max : target * 4;
        } else if (elapsed * 4 <= TARGET_INTERVAL) {
            next = target / 4;
        } else {
            next = FullMath.mulDiv(target, elapsed, TARGET_INTERVAL);
        }
        uint256 cap = _ceiling(epoch());
        if (next > cap) next = cap;
        target = next;
        emit Retargeted(next);
    }

    function _pull(address from, address to, uint256 amount) private {
        if (!PUPATE.transferFrom(from, to, amount)) revert TransferFailed();
    }

    // ------------------------------------------------------------------ internals (reads)

    /// @dev Held by the vault right now: on its books and in its wallet. Returns the current round.
    function _vaultHolds(uint256 seat) internal view returns (bool held, uint16 round) {
        (,,,,, bool onBooks, uint16 r) = COCOON.seats(seat);
        if (!onBooks) return (false, r);
        try COLLECTION.ownerOf(seat) returns (address holder) {
            return (holder == address(COCOON), r);
        } catch {
            return (false, r);
        }
    }

    /// @dev The largest target of an epoch: `MIN_BITS + epoch − 1` leading zero bits.
    function _ceiling(uint16 epoch_) internal view returns (uint256) {
        uint256 shift = uint256(MIN_BITS) + epoch_ - 1;
        if (shift > 255) shift = 255;
        return type(uint256).max >> shift;
    }

    function _tload(uint256 slot) private view returns (uint256 value) {
        assembly ("memory-safe") {
            value := tload(slot)
        }
    }

    function _tstore(uint256 slot, uint256 value) private {
        assembly ("memory-safe") {
            tstore(slot, value)
        }
    }

    // The stages, the staking, the conversion and the duties follow in later tasks.

    function tokenURI(uint256) public pure override returns (string memory) {
        return "";
    }

    function unlockCallback(bytes calldata) external pure returns (bytes memory) {
        revert UnexpectedCallback();
    }
}
