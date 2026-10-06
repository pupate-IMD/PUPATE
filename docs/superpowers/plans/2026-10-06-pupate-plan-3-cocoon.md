# Pupate Plan 3: Cocoon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> This plan is executed in-session by its author, so it states interfaces, rules and tests precisely and leaves the Solidity bodies to the files themselves. The source under `src/` and `test/` is the record of what was built; `docs/REVIEW.md` records what was reviewed.

**Goal:** Build Cocoon, the vault that receives the tax, buys Identity MD seats on Seaport, lists them, burns PUPATE with the proceeds, auctions what the seats earn, and lets an operator pair the seats to IMD workers; plus PupateVesting and the timelock wiring.

**Architecture:** Cocoon is one contract with four concerns kept in separate files: pots and mode (`Cocoon.sol`), Seaport buying and listing (`cocoon/SeatListing.sol` builds the orders, `Cocoon.sol` submits them), falling-price auctions (`cocoon/Decay.sol`), and IMD pairing (`cocoon/WorkerAuthorization.sol`). Everything that moves ETH out is permissionless and bounded. The timelock is OpenZeppelin's `TimelockController`.

**Tech Stack:** Solidity 0.8.26, Foundry, Uniswap v4-core 1.0.2, seaport-types 1.6.0, OpenZeppelin 5.4.0 (vendored).

**Spec:** `docs/superpowers/specs/2026-10-06-pupate-design.md` (revision 3), sections Cocoon, PupateVesting, Timelock, Control, Deployment order, Testing.

## Global Constraints

- Everything in the repository is English.
- Solidity `0.8.26`; `cancun`; optimizer 200; no `via_ir`; no proxies, `delegatecall` or `selfdestruct`.
- Local commits only. No push.
- Vault ETH leaves Cocoon only to: Seaport (a seat purchase), the PoolManager (a buyback), a caller reward of at most 1%, the developer balance to the developer, an auction taker (the ETH lot of the IMD auction). Nothing else, ever.
- Seaport 1.6 mainnet `0x0000000000000068F116a894984e2DB1123eB395`; the collection `0x0000eC93127BAA929E58E97dd0095A2BFb38ec1D` (no ERC-2981 royalties).
- IMD pairing domain: name `IdentityMD Worker`, version `2`, `chainId`, `verifyingContract` = the collection; type `WorkerAuthorization(bytes32 deviceKey,address wallet,uint256 tokenId,bytes32 nonce,uint64 expiresAt,string relayOrigin)`. Taken from IMD's pairing page as quoted by IMD6900's source; confirmed on Sepolia in Plan 4.
- ERC-1271 returns valid only for digests built on-chain from that type, for seats Cocoon still holds. Any other digest is invalid, so the operator can never sign a Seaport order or anything else on Cocoon's behalf.

## Review Focus

1. Seaport refunds excess ETH to the fulfiller during `buySeat`; that ETH must return to the seat pot, not be counted as sale proceeds. Test: `test_buySeatRefundStaysInTheSeatPot`.
2. A seat the vault once sold is bought again later; the old flat listing must not be fulfillable at the old price. Test: `test_settleCancelsTheOldListingsSoARepurchaseCannotBeSoldAtTheOldPrice`.
3. A listing is filled while `heldCount` still counts the seat; the mode must not flip the wrong way for long, and `settleSeat` must be callable by anyone. Test: `test_settleSeatIsPermissionlessAndFixesTheAverage`.
4. `burn()` right after the open, when the spot price sits above all liquidity: it must either buy at the real price or revert, never record a burn with nothing bought. Test: `test_burnWithTheSpotAboveLiquidityBuysNothingAndReverts`.
5. The operator approves a digest for a seat and the seat is then sold: `isValidSignature` must turn invalid without any further call. Test: `test_pairingApprovalDiesWithTheSeat`.

---

### Task 1: Libraries

**Files:**
- Create: `src/interfaces/IERC721Minimal.sol`, `src/interfaces/IERC20Minimal.sol`, `src/cocoon/WorkerAuthorization.sol`, `src/cocoon/Decay.sol`, `src/cocoon/SeatListing.sol`
- Test: `test/cocoon/WorkerAuthorization.t.sol`, `test/cocoon/Decay.t.sol`, `test/cocoon/SeatListing.t.sol`

**Interfaces:**
- `library WorkerAuthorization { struct Auth { bytes32 deviceKey; address wallet; uint256 tokenId; bytes32 nonce; uint64 expiresAt; string relayOrigin; } function digest(address collection, Auth memory a) internal view returns (bytes32); }` using `block.chainid`.
- `library Decay { uint256 constant HALF_LIFE = 2 hours; uint256 constant CUTOFF = 48 hours; function price(uint256 start, uint256 elapsed) internal pure returns (uint256); }` Halves every `HALF_LIFE`, linear inside each half-life, zero at or after `CUTOFF`.
- `library SeatListing { struct Terms { uint256 cost; uint16 startX; uint16 endX; uint32 decay; uint40 boughtAt; } function orders(address offerer, address collection, uint256 tokenId, Terms memory t) internal pure returns (Order[2] memory); function components(address offerer, address collection, uint256 tokenId, Terms memory t, uint256 counter) internal pure returns (OrderComponents[2] memory); }` Order A: ETH consideration from `cost*startX/1e4` down to `cost*endX/1e4` between `boughtAt` and `boughtAt+decay`. Order B: flat `cost*endX/1e4` from `boughtAt+decay` for ten years. Both `FULL_OPEN`, zone zero, conduit zero, salt `uint256(keccak256(abi.encode(tokenId, boughtAt, index)))`, one consideration item paid to the offerer.

Tests: the digest matches a hand-computed EIP-712 digest and changes with the collection and chain id; `Decay.price` at 0, one half-life, between, and past the cutoff, and is monotone (fuzz); the two orders have the right item types, amounts, times and salts, and `components` matches `orders` field for field.

- [ ] Write tests, see them fail, write the libraries, see them pass, commit `feat: add Cocoon libraries`.

### Task 2: PupateVesting

**Files:**
- Create: `src/PupateVesting.sol`
- Test: `test/PupateVesting.t.sol`

**Interfaces:** `constructor(address token, address beneficiary, uint64 start, uint64 duration)`; `function vested() public view returns (uint256)` (linear over `duration` from `start`, over everything ever received); `function releasable() public view returns (uint256)`; `function release() external` (anyone; pays the beneficiary); `function setBeneficiary(address)` (beneficiary only); events `Released(uint256)`, `BeneficiarySet(address)`.

Tests: nothing before start; half at mid-way; all at the end; tokens added later vest on the same curve; release is idempotent; only the beneficiary changes the beneficiary; zero addresses rejected.

- [ ] TDD as above, commit `feat: add PupateVesting`.

### Task 3: Cocoon core

**Files:**
- Create: `src/Cocoon.sol`, `test/utils/CocoonFixture.sol`, `test/mocks/MockERC721.sol`, `test/mocks/MockERC20.sol`
- Test: `test/cocoon/CocoonCore.t.sol`

**Interfaces (Cocoon, this task's part):**
- `constructor(address owner_, address developer_, address operator_, IERC721Minimal collection, SeaportInterface seaport, IPoolManager poolManager, FloorFeed floor, IERC20Minimal imd)`; approves Seaport for the collection once.
- `struct Params { uint16 accumulateSeatBps; uint16 listStartX; uint16 listEndX; uint32 listDecay; uint16 toleranceBps; uint16 callerRewardBps; uint16 burnImpactBps; uint16 burnSpacing; uint128 harvestStartWei; uint128 imdStartPerEth; }` with defaults `7000, 15000, 11000, 14 days, 500, 50, 500, 5, 1 ether, 20_000e18` and bounds `3000–7000, 11000–30000, 10000–15000, 1–60 days, 0–1000, 0–100, 100–1000, 1–300, 0.01–100 ether, 100e18–1e7e18`; `setParams(Params)` owner only, every bound checked, `listEndX <= listStartX`.
- `enum Mode { NEUTRAL, ACCUMULATE, BURN }`; `function mode() public view returns (Mode, uint256 seatBps)` per the spec table.
- `depositTax() external payable`: 10% developer, 5% IMD burn, 85% split by `mode()`; emits `TaxDeposited`.
- `receive() external payable`: outside a Seaport call, credits the burn pot (sale proceeds and donations); inside one, credits nothing (the refund is settled by `buySeat`).
- `uint256 public seatPot, burnPot, developerBalance, imdBurnBalance; uint256 public heldCount, heldCost;`
- `claimDeveloper()` (anyone; pays the developer), `setDeveloper(address)` (developer only), `setOperator(address)` and `transferOwnership(address)` (owner only), `wire(PoolKey)` (owner, once).
- Invariant: `address(this).balance == seatPot + burnPot + developerBalance + imdBurnBalance`.

Tests: split arithmetic in each mode (fresh/stale feed, no seats, floor below and above the average), rounding leaves no wei unaccounted, developer claim and rotation, parameter bounds, owner-only and once-only `wire`, plain ETH goes to the burn pot, the balance identity after a random sequence (fuzz).

- [ ] TDD as above, commit `feat: add Cocoon pots, mode and tax split`.

### Task 4: Buying, listing and settling

**Files:**
- Create: `test/mocks/MockSeaport.sol`
- Modify: `src/Cocoon.sol`
- Test: `test/cocoon/CocoonMarket.t.sol`

**Interfaces:**
- `buySeat(AdvancedOrder calldata order, CriteriaResolver[] calldata resolvers) external` (anyone, non-reentrant). Checks: one offer item, `ERC721`, the collection, amount 1; every consideration item `NATIVE`; `numerator == denominator == 1`; `FULL_OPEN` or `FULL_RESTRICTED`; the feed is fresh and `max(startAmount, endAmount)` summed over consideration ≤ `floor * (1e4 + toleranceBps) / 1e4`; `seatPot >= price + reward`. Calls `fulfillAdvancedOrder{value: price}(order, resolvers, bytes32(0), address(this))`, requires it returned true and `ownerOf(tokenId) == this`. Spent = balance before − balance after (so a refund never leaves the seat pot). Records the seat (`cost`, `boughtAt`), updates `heldCount`/`heldCost`, validates the two listing orders, pays the reward. Emits `SeatBought`, `SeatListed`.
- `settleSeat(uint256 tokenId) external` (anyone): if recorded and no longer held, removes it from the held set, cancels both listing orders on Seaport, emits `SeatSold`.
- `onERC721Received` accepts the collection only, and only during `buySeat`.
- `MockSeaport`: `validate`, `cancel`, `getCounter`, `getOrderHash`, `getOrderStatus`, and `fulfillAdvancedOrder` for one-ERC721-for-native-ETH orders: checks validity (validated or signed-by-test flag), time window, cancellation, computes the current consideration with Seaport's rounding (up for consideration), pulls the NFT with `transferFrom` from the offerer, pays each consideration recipient, refunds the fulfiller's excess, marks the order filled.

Tests: a listing at the floor is bought and listed (two validated orders with the right prices); the caller gets 0.5%; refunds stay in the seat pot (Review Focus 1); rejections for each check (wrong collection, ERC20 consideration, criteria order, partial order, stale feed, price above tolerance, pot too small); a third party buys our listing through the mock at the descending price, the ETH lands in the burn pot, `settleSeat` fixes `heldCount`/`heldCost` and cancels the orders (Review Focus 2 and 3); an unsolicited NFT transfer is rejected; reentrancy from the mock into `buySeat` is rejected.

- [ ] TDD as above, commit `feat: Cocoon buys, lists and settles seats`.

### Task 5: Burning

**Files:**
- Modify: `src/Cocoon.sol`, `test/utils/HookFixture.sol` (a variant whose sink is Cocoon)
- Test: `test/cocoon/CocoonBurn.t.sol`

**Interfaces:**
- `burn() external` (anyone, non-reentrant): requires wired, `block.number >= lastBurnBlock + burnSpacing`, `burnPot > 0`. Reads the pool's sqrt price, sets the limit at `sqrtPrice * sqrt(1 - burnImpactBps/1e4)`, swaps exact-in `burnPot` ETH for PUPATE through `POOL_MANAGER.unlock`, settles the ETH actually taken by the pool and takes the PUPATE, burns it. Requires PUPATE received > 0. `burnPot -= spent + reward`; pays the reward on `spent`; emits `Burned(spent, burned, caller, reward)`.
- `burnPupate() external`: burns any PUPATE balance (harvest lots never include PUPATE).
- `unlockCallback` reached only from `burn`.

Tests, on a real PoolManager with PupateHook whose sink is Cocoon: a burn spends the pot, moves the price by at most the limit, burns the tokens, pays the reward and is untaxed; a partial fill leaves the rest in the pot; the spacing is enforced; the spot-above-liquidity case reverts with nothing bought (Review Focus 4); a stranger's sandwich around a burn loses money net of the tax (property test with the Trader).

- [ ] TDD as above, commit `feat: Cocoon burns PUPATE within a price-impact limit`.

### Task 6: Auctions

**Files:**
- Modify: `src/Cocoon.sol`
- Test: `test/cocoon/CocoonAuctions.t.sol`

**Interfaces:**
- Harvest: `startAuction(address token)` (anyone; not PUPATE, not zero, balance > 0, none running): lot = whole balance, start = now. `auctionPrice(token) view` = `Decay.price(harvestStartWei, elapsed)`. `takeAuction(address token) external payable`: `msg.value >= price`, pays the lot to the taker, refunds the excess, credits the price to the seat pot, clears the auction. Emits `AuctionStarted`, `AuctionTaken`.
- IMD: `startImdAuction()` (anyone; `imdBurnBalance > 0`, none running): lot = `imdBurnBalance` ETH. `imdDemand() view` = `Decay.price(imdStartPerEth * lot / 1e18, elapsed)`. `takeImdAuction()`: pulls `imdDemand()` IMD from the taker to the dead address, sends the lot to the taker, zeroes `imdBurnBalance` by the lot. Emits `ImdBurned`.

Tests: price curve at several times; the taker gets the lot and the excess back; a second start while running reverts; PUPATE cannot be auctioned; tokens received after a start go to the next lot; the IMD auction burns the demanded amount and pays the lot; the balance identity holds through both.

- [ ] TDD as above, commit `feat: Cocoon auctions seat earnings and the IMD share`.

### Task 7: Pairing

**Files:**
- Modify: `src/Cocoon.sol`
- Test: `test/cocoon/CocoonPairing.t.sol`

**Interfaces:**
- `authorizeWorker(WorkerAuthorization.Auth calldata a) external returns (bytes32 digest)` (operator only): `a.wallet == address(this)`, `a.expiresAt > block.timestamp`, the seat is held. Stores `tokenId + 1` under the digest. `revokeWorker(bytes32 digest)` (operator only). `isValidSignature(bytes32 hash, bytes calldata) external view returns (bytes4)`: `0x1626ba7e` only if the digest is stored and the seat is still held; otherwise `0xffffffff`; never reverts.

Tests: digest matches the library; wrong wallet, expired, unheld seat rejected; approval dies with the seat (Review Focus 5); revoke works; an arbitrary digest is invalid; only the operator may call.

- [ ] TDD as above, commit `feat: Cocoon pairs held seats to IMD workers`.

### Task 8: Invariants and the fork test

**Files:**
- Create: `test/cocoon/Cocoon.invariant.t.sol`, `test/utils/CocoonHandler.sol`, `test/fork/CocoonSeaport.fork.t.sol`

The handler deposits tax, trades, flushes, buys listings on the mock market, lets third parties buy our listings, settles, burns, runs auctions, and warps time and the feed. Invariants: the balance identity; `heldCount` equals the number of recorded seats Cocoon owns; pot ETH only leaves through the five allowed paths (tracked by the handler); the standing tax never rises.

The fork test runs only when `MAINNET_RPC_URL` is set (`vm.envOr`), forks mainnet, deploys FloorFeed and Cocoon against the real Seaport and collection, impersonates a holder to create a real Seaport listing, buys it through `buySeat`, checks the two validated orders with `getOrderStatus`, fulfills the descending order as a third party, and settles. It is the gate for Plan 4.

- [ ] Write, run, commit `test: Cocoon invariants and mainnet-fork Seaport test`.

### Task 9: Spec and review

- [ ] Update the spec with the decisions made here (two listing orders, settle-and-cancel, refund handling, auction curve and starts, donated NFTs rejected). Request an independent review of `src/Cocoon.sol` and the libraries as in Plan 2; record it in `docs/REVIEW.md`; fix what it finds.
