// The slices of each contract the site reads and calls, in viem's human-readable form. Kept in step
// with src/ by hand; the Foundry tests are the source of truth for the signatures.

import { parseAbi } from "viem";

export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

export const permit2Abi = parseAbi([
  "function allowance(address owner, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)",
  "function approve(address token, address spender, uint160 amount, uint48 expiration)",
]);

export const universalRouterAbi = parseAbi([
  "function execute(bytes commands, bytes[] inputs, uint256 deadline) payable",
]);

export const quoterAbi = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }",
  "function quoteExactInputSingle(QuoteExactSingleParams params) returns (uint256 amountOut, uint256 gasEstimate)",
]);

/// The PoolManager's ERC-6909 claims: the hook's uncollected tax is its balance of currency id 0 (ETH).
export const poolManagerAbi = parseAbi(["function balanceOf(address owner, uint256 id) view returns (uint256)"]);

export const hookAbi = parseAbi([
  "function buyTaxBps() view returns (uint256)",
  "function taxBps() view returns (uint16)",
  "function openedAt() view returns (uint40)",
  "function openedAtBlock() view returns (uint40)",
  "function totalTax() view returns (uint256)",
  "function sink() view returns (address)",
  "function owner() view returns (address)",
  "function flush() returns (uint256 amount)",
  "event Taxed(address indexed sender, bool buy, uint256 tax, uint256 rateBps)",
  "event Flushed(uint256 amount)",
  "event TaxLowered(uint256 taxBps)",
]);

export const feedAbi = parseAbi([
  "function latest() view returns (uint256 floorWei, bool fresh)",
  "function floorWei() view returns (uint256)",
  "function issuedAt() view returns (uint64)",
  "function expiresAt() view returns (uint64)",
  "function maxAge() view returns (uint64)",
  "function attester() view returns (address)",
  "event Reported(uint256 floorWei, uint64 issuedAt, uint64 freshUntil)",
]);

export const cocoonAbi = parseAbi([
  "struct Params { uint16 accumulateSeatBps; uint16 listStartX; uint16 listEndX; uint32 listDecay; uint16 toleranceBps; uint16 callerRewardBps; uint16 burnImpactBps; uint16 burnSpacing; uint128 harvestStartWei; uint128 imdStartPerEth; }",
  "function seatPot() view returns (uint256)",
  "function burnPot() view returns (uint256)",
  "function developerBalance() view returns (uint256)",
  "function imdBurnBalance() view returns (uint256)",
  "function heldCount() view returns (uint256)",
  "function heldCost() view returns (uint256)",
  "function lastBurnBlock() view returns (uint256)",
  "function wired() view returns (bool)",
  "function developer() view returns (address)",
  "function operator() view returns (address)",
  "function owner() view returns (address)",
  "function mode() view returns (uint8 mode, uint256 seatBps)",
  "function getParams() view returns (Params)",
  "function seats(uint256 tokenId) view returns (uint128 cost, uint40 boughtAt, uint16 startX, uint16 endX, uint32 decay, bool held, uint16 round)",
  "function auctions(address token) view returns (uint128 lot, uint128 start, uint40 startedAt)",
  "function auctionPrice(address token) view returns (uint256)",
  "function imdAuction() view returns (uint128 lot, uint128 start, uint40 startedAt)",
  "function imdDemand() view returns (uint256)",
  "function burn()",
  "function settleSeat(uint256 tokenId)",
  "function adopt(uint256 tokenId)",
  "function startAuction(address token)",
  "function takeAuction(address token) payable",
  "function startImdAuction()",
  "function takeImdAuction()",
  "function claimDeveloper()",
  "event TaxDeposited(uint256 amount, uint256 toSeatPot, uint256 toBurnPot, uint256 toDeveloper, uint256 toImdBurn, uint8 mode)",
  "event ProceedsReceived(address indexed from, uint256 amount)",
  "event SeatBought(uint256 indexed tokenId, uint256 cost, address indexed caller, uint256 reward)",
  "event SeatAdopted(uint256 indexed tokenId, uint256 cost)",
  "event SeatListed(uint256 indexed tokenId, uint256 startPrice, uint256 endPrice, uint256 startTime, uint256 decayEnd)",
  "event SeatSold(uint256 indexed tokenId, uint256 cost)",
  "event Burned(uint256 ethSpent, uint256 pupateBurned, address indexed caller, uint256 reward)",
  "event AuctionStarted(address indexed token, uint256 lot, uint256 startPrice)",
  "event AuctionTaken(address indexed token, address indexed taker, uint256 lot, uint256 price)",
  "event ImdAuctionStarted(uint256 lotWei, uint256 startDemand)",
  "event ImdBurned(address indexed taker, uint256 imdBurned, uint256 ethPaid)",
]);
