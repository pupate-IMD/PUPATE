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
    error TooSoon();
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
    /// @notice Blocks between two conversions: Cocoon's `burnSpacing` default, mirrored.
    uint16 public constant CONVERT_SPACING = 5;
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
    /// @notice The block of the last conversion; the next one waits `CONVERT_SPACING` blocks.
    uint256 public lastConvertBlock;
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

        prevWork = work;
        _retarget();
        lastMintAt = uint40(block.timestamp);

        // Everything is written before the card is delivered: a contract miner's receiver hook runs against
        // the finished mint, and the lock keeps it from minting again.
        _mint(msg.sender, id);
        emit Minted(id, seat, round, edition, msg.sender, work, gilt, price, epoch_);
        _duties(msg.sender);
    }

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
    /// epoch the next mint belongs to applies. FullMath keeps the product `target × elapsed` from
    /// overflowing, but the quotient itself reaches 2^256 when the target sits near the top and the mint
    /// came more than `TARGET_INTERVAL` late (the one-bit floor of the test suite; a mainnet floor of 20
    /// bits has the room). That case saturates to the maximum first and the ceiling then caps it, so a
    /// valid proof never reverts here.
    function _retarget() private {
        uint256 elapsed = block.timestamp - lastMintAt;
        uint256 next;
        if (elapsed >= 4 * TARGET_INTERVAL) {
            next = target > type(uint256).max / 4 ? type(uint256).max : target * 4;
        } else if (elapsed * 4 <= TARGET_INTERVAL) {
            next = target / 4;
        } else {
            next = elapsed > TARGET_INTERVAL && target > type(uint256).max / elapsed * TARGET_INTERVAL
                ? type(uint256).max
                : FullMath.mulDiv(target, elapsed, TARGET_INTERVAL);
        }
        uint256 cap = _ceiling(epoch());
        if (next > cap) next = cap;
        target = next;
        emit Retargeted(next);
    }

    function _pull(address from, address to, uint256 amount) private {
        if (!PUPATE.transferFrom(from, to, amount)) revert TransferFailed();
    }

    // ------------------------------------------------------------------ stages, royalty, metadata

    /// @notice 0 while the vault holds the card's seat in the card's round, 1 after it no longer does,
    /// or 90 days after the mint whatever happened. Computed, never stored.
    function stageOf(uint256 id) public view returns (uint8) {
        Card memory c = cards[id];
        if (c.mintedAt == 0) revert NotMinted();
        if (block.timestamp >= uint256(c.mintedAt) + BUTTERFLY_CEILING) return 1;
        return _vaultHoldsRound(c.seat, c.round) ? 0 : 1;
    }

    /// @notice ERC-2981: 5% of every resale to the developer Cocoon names today.
    function royaltyInfo(uint256, uint256 salePrice) external view returns (address, uint256) {
        return (COCOON.developer(), salePrice * ROYALTY_BPS / BPS);
    }

    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return interfaceId == 0x2a55205a || super.supportsInterface(interfaceId);
    }

    function tokenURI(uint256 id) public view override returns (string memory) {
        Card memory c = cards[id];
        if (c.mintedAt == 0) revert NotMinted();
        return ART.tokenURI(
            IMetamorphArt.View({
                id: id,
                seat: c.seat,
                round: c.round,
                edition: c.edition,
                stage: stageOf(id),
                gilt: c.gilt,
                epoch: _epochOf(id),
                miner: c.miner,
                mintedAt: c.mintedAt,
                paid: c.paid
            })
        );
    }

    /// @dev The epoch a card was minted in: ids count from 1, 303 per epoch.
    function _epochOf(uint256 id) private pure returns (uint16) {
        return uint16((id - 1) / EPOCH + 1);
    }

    function _vaultHoldsRound(uint256 seat, uint16 round) private view returns (bool) {
        (bool held, uint16 r) = _vaultHolds(seat);
        return held && r == round;
    }

    // ------------------------------------------------------------------ staking

    /// @notice Lock cards you own in your wallet and earn the stakers' IMD by weight: 1 for a chrysalis,
    /// 2 for a butterfly. No lock period, no custody change.
    function stake(uint256[] calldata ids) external nonReentrant {
        for (uint256 i; i < ids.length; i++) {
            uint256 id = ids[i];
            if (ownerOf(id) != msg.sender) revert NotCardOwner();
            Stake storage s = stakeOf[id];
            if (s.staker != address(0)) revert Staked();
            uint8 w = _weight(id);
            s.staker = msg.sender;
            s.weight = w;
            s.debt = uint256(w) * accIMDPerWeight;
            totalWeight += w;
            emit StakedCard(id, msg.sender, w);
        }
    }

    /// @notice Settle and unlock cards you staked.
    function unstake(uint256[] calldata ids) external nonReentrant {
        for (uint256 i; i < ids.length; i++) {
            uint256 id = ids[i];
            Stake storage s = stakeOf[id];
            if (s.staker != msg.sender) revert NotStaked();
            _settle(id, s);
            totalWeight -= s.weight;
            delete stakeOf[id];
            emit Unstaked(id, msg.sender);
        }
    }

    /// @notice Settle the given staked cards (an emerged card is reweighed to 2 here) and pay out
    /// everything pending for the caller.
    function claim(uint256[] calldata ids) external nonReentrant returns (uint256 paid) {
        for (uint256 i; i < ids.length; i++) {
            Stake storage s = stakeOf[ids[i]];
            if (s.staker != msg.sender) revert NotStaked();
            _settle(ids[i], s);
        }
        paid = pendingIMD[msg.sender];
        if (paid != 0) {
            pendingIMD[msg.sender] = 0;
            imdOwed -= paid;
            _payIMD(msg.sender, paid);
        }
        emit Claimed(msg.sender, paid);
    }

    /// @dev Books what a staked card earned since its last settlement, then re-reads its stage.
    function _settle(uint256 id, Stake storage s) private {
        uint256 acc = accIMDPerWeight;
        uint256 earned = (uint256(s.weight) * acc - s.debt) / ACC;
        if (earned != 0) pendingIMD[s.staker] += earned;
        uint8 w = _weight(id);
        if (w != s.weight) {
            totalWeight = totalWeight - s.weight + w;
            s.weight = w;
            emit Reweighed(id, w);
        }
        s.debt = uint256(w) * acc;
    }

    /// @dev IMD for the stakers: spread over the current weight, or to the developer when nobody stakes.
    function _credit(uint256 imdAmount) internal {
        if (imdAmount == 0) return;
        if (totalWeight == 0) {
            _payIMD(COCOON.developer(), imdAmount);
            return;
        }
        accIMDPerWeight += imdAmount * ACC / totalWeight;
        imdOwed += imdAmount;
    }

    function _weight(uint256 id) private view returns (uint8) {
        return stageOf(id) == 1 ? 2 : 1;
    }

    function _payIMD(address to, uint256 amount) private {
        if (!IMD.transfer(to, amount)) revert TransferFailed();
    }

    /// @dev A staked card does not move.
    function _beforeTransfer(uint256 id) internal view override {
        if (stakeOf[id].staker != address(0)) revert Staked();
    }

    // ------------------------------------------------------------------ the conversion

    /// @notice Sell the pot's PUPATE for ETH, then the ETH for IMD, each under a 5% price-impact bound,
    /// and credit the stakers. Anyone may call, once every `CONVERT_SPACING` blocks; the caller is paid
    /// 0.5% of the IMD bought. What the bound leaves unsold stays for the next call.
    function convert() external nonReentrant returns (uint256 imdOut) {
        return _convert(msg.sender);
    }

    /// @dev The conversion as a duty inside a mint: the mint holds the lock, so this entry has none,
    /// and only the contract itself may use it.
    function convertDuty(address miner_) external returns (uint256 imdOut) {
        if (msg.sender != address(this)) revert OnlySelf();
        return _convert(miner_);
    }

    function _convert(address caller) private returns (uint256 imdOut) {
        // The bound holds per call. The spacing keeps calls in a row from stacking it, as the vault
        // spaces its burns.
        if (block.number < lastConvertBlock + CONVERT_SPACING) revert TooSoon();
        uint256 pupateIn = pot;
        ethPot = address(this).balance;
        if (pupateIn == 0 && ethPot == 0) revert NothingToConvert();
        (uint160 saleLimit, uint160 buyLimit) = _limits();
        bytes memory result = POOL_MANAGER.unlock(abi.encode(pupateIn, ethPot, saleLimit, buyLimit));
        (uint256 sold, uint256 ethBought, uint256 bought) = abi.decode(result, (uint256, uint256, uint256));
        if (bought == 0) revert NothingBought();
        lastConvertBlock = block.number;
        pot -= sold;
        ethPot = address(this).balance;
        uint256 reward = bought * CALLER_REWARD_BPS / BPS;
        if (reward != 0) _payIMD(caller, reward);
        _credit(bought - reward);
        emit Converted(sold, ethBought, bought, caller, reward);
        return bought;
    }

    /// @inheritdoc IUnlockCallback
    /// @dev Reached only from `_convert`. Swap one: PUPATE for ETH in the launch pool, exact input,
    /// up to the sale limit. Swap two: all the ETH in hand for IMD, exact input, up to the buy limit.
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(POOL_MANAGER)) revert OnlyPoolManager();
        if (_tload(LOCK_SLOT) == 0) revert UnexpectedCallback();
        (uint256 pupateIn, uint256 ethHeld, uint160 saleLimit, uint160 buyLimit) =
            abi.decode(data, (uint256, uint256, uint160, uint160));

        uint256 sold;
        uint256 ethBought;
        if (pupateIn != 0) {
            BalanceDelta d = POOL_MANAGER.swap(pupateKey, SwapParams(false, -int256(pupateIn), saleLimit), "");
            sold = uint256(uint128(-d.amount1()));
            ethBought = uint256(uint128(d.amount0()));
            if (sold != 0) {
                POOL_MANAGER.sync(pupateKey.currency1);
                if (!PUPATE.transfer(address(POOL_MANAGER), sold)) revert TransferFailed();
                POOL_MANAGER.settle();
            }
            if (ethBought != 0) POOL_MANAGER.take(pupateKey.currency0, address(this), ethBought);
        }

        uint256 ethIn = ethHeld + ethBought;
        uint256 bought;
        if (ethIn != 0) {
            BalanceDelta d2 = POOL_MANAGER.swap(imdKey, SwapParams(true, -int256(ethIn), buyLimit), "");
            uint256 ethSpent = uint256(uint128(-d2.amount0()));
            bought = uint256(uint128(d2.amount1()));
            if (ethSpent != 0) POOL_MANAGER.settle{value: ethSpent}();
            if (bought != 0) POOL_MANAGER.take(imdKey.currency1, address(this), bought);
        }
        return abi.encode(sold, ethBought, bought);
    }

    /// @dev The price limits of one conversion: the sale may lift the launch pool's sqrt price by at
    /// most sqrt(1 + impact); the buy may lower the IMD pool's by at most sqrt(1 − impact).
    function _limits() private view returns (uint160 saleLimit, uint160 buyLimit) {
        (uint160 p1,,,) = POOL_MANAGER.getSlot0(pupateKey.toId());
        uint256 up = uint256(p1) * _sqrt((BPS + CONVERT_IMPACT_BPS) * BPS) / BPS;
        if (up >= TickMath.MAX_SQRT_PRICE) up = TickMath.MAX_SQRT_PRICE - 1;
        saleLimit = uint160(up);
        (uint160 p2,,,) = POOL_MANAGER.getSlot0(imdKey.toId());
        uint256 down = uint256(p2) * (_sqrt((BPS - CONVERT_IMPACT_BPS) * BPS) + 1) / BPS;
        if (down <= TickMath.MIN_SQRT_PRICE) down = TickMath.MIN_SQRT_PRICE + 1;
        buyLimit = uint160(down);
    }

    function _sqrt(uint256 x) private pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }

    // ------------------------------------------------------------------ the vault's duties

    /// @notice The duties due right now: the hook's flush, the vault's burn, the pot's conversion. A mint
    /// runs them when gas is cheap; the keeper reads the same. Like the burn, the conversion waits out its
    /// spacing.
    function dutiesDue() public view returns (bool flushDue, bool burnDue, bool convertDue) {
        flushDue = POOL_MANAGER.balanceOf(address(HOOK), 0) >= MIN_FLUSH;
        burnDue = COCOON.wired() && COCOON.burnPot() >= MIN_BURN
            && block.number >= COCOON.lastBurnBlock() + COCOON.getParams().burnSpacing;
        convertDue =
            (pot >= 2 * mintPrice() || ethPot != 0) && block.number >= lastConvertBlock + CONVERT_SPACING;
    }

    /// @dev Inside a mint, when gas is cheap: each duty in a try with a gas allowance, so none of them can
    /// fail the mint. The burn's ETH reward and the conversion's IMD reward go to the miner.
    function _duties(address miner_) internal {
        if (block.basefee > DUTY_MAX_BASEFEE) return;
        (bool flushDue, bool burnDue, bool convertDue) = dutiesDue();
        if (flushDue) {
            try HOOK.flush{gas: DUTY_GAS}() {
                emit DutyRun(0, 0);
            } catch {}
        }
        if (burnDue) {
            uint256 before = address(this).balance;
            try COCOON.burn{gas: DUTY_GAS}() {
                uint256 got = address(this).balance - before;
                if (got != 0) _pay(miner_, got);
                emit DutyRun(1, got);
            } catch {}
        }
        if (convertDue) {
            try this.convertDuty{gas: CONVERT_GAS}(miner_) returns (uint256 bought) {
                emit DutyRun(2, bought * CALLER_REWARD_BPS / BPS);
            } catch {}
        }
    }

    function _pay(address to, uint256 amount) private {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
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
}
