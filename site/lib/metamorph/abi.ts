// Metamorph MD (src/metamorph/MetamorphMD.sol) and its art (src/metamorph/art/MetamorphArt.sol), the
// slices the mine page, the workspace and the keeper read and call, in viem's human-readable form. Each
// signature is copied from the contract; `npm run mine-check` (scripts/mine-logic.mjs) holds every
// selector, topic, output and indexed flag against forge's and the compiled ABI.
// Twin: keeper/lib/abi.mjs `metamorphAbi` carries the same strings in the same order; change both.

import { parseAbi } from "viem";
import type { ContractErrorName, ContractEventName } from "viem";

export const METAMORPH_SIGNATURES = [
  // The work chain: what a miner hashes and what the hash must beat.
  "function DOMAIN() view returns (bytes32)",
  "function prevWork() view returns (bytes32)",
  "function effectiveTarget() view returns (uint256 t)",
  "function bits() view returns (uint8 n)",
  "function anchorHash(uint256 blockNumber) view returns (bytes32)",
  "function workHash(bytes32 anchorHash_, address miner_, uint256 nonce) view returns (bytes32)",
  "function ANCHOR_WINDOW() view returns (uint256)",
  // Supply, epochs, the price.
  "function totalMinted() view returns (uint16)",
  "function lastMintAt() view returns (uint40)",
  "function epoch() view returns (uint16)",
  "function mintPrice() view returns (uint256)",
  "function MAX_SUPPLY() view returns (uint16)",
  "function EPOCH() view returns (uint16)",
  // The seats a mint picks from.
  "function notedSeats() view returns (uint256[])",
  "function mineableSeats() view returns (uint256[] open)",
  "function noteSeat(uint256 seat)",
  "function forgetSeat(uint256 seat)",
  // The mint and the duties it runs.
  "function mint(uint256 anchor, uint256 nonce) returns (uint256 id)",
  "function dutiesDue() view returns (bool flushDue, bool burnDue, bool convertDue)",
  // The cards.
  "function cards(uint256 id) view returns (uint32 seat, uint16 round, uint16 edition, bool gilt, bool commons, uint40 mintedAt, uint96 paid, address miner, bytes32 work)",
  "function commons(uint256 id) view returns (bool)",
  "function stageOf(uint256 id) view returns (uint8)",
  "function tokenURI(uint256 id) view returns (string)",
  "function ownerOf(uint256 id) view returns (address owner)",
  "function balanceOf(address owner) view returns (uint256)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  // Staking.
  "function stakeOf(uint256 id) view returns (address staker, uint8 weight, uint256 debt)",
  "function accIMDPerWeight() view returns (uint256)",
  "function pendingIMD(address staker) view returns (uint256)",
  "function stake(uint256[] ids)",
  "function unstake(uint256[] ids)",
  "function claim(uint256[] ids) returns (uint256 paid)",
  "function poke(uint256[] ids)",
  // The conversion of the pot.
  "function convert() returns (uint256 imdOut)",
  "function pot() view returns (uint256)",
  "function ethPot() view returns (uint256)",
  "function lastConvertBlock() view returns (uint256)",
  "function convertBackoffUntil() view returns (uint256)",
  "function CONVERT_SPACING() view returns (uint16)",
  "function CONVERT_PRICES() view returns (uint256)",
  // Events.
  "event Minted(uint256 indexed id, uint256 indexed seat, uint16 round, uint16 edition, address indexed miner, bytes32 work, bool gilt, uint256 price, uint16 epoch)",
  "event DutyRun(uint8 kind, uint256 paid)",
  "event Retargeted(uint256 target)",
  "event SeatNoted(uint256 indexed seat)",
  "event SeatForgotten(uint256 indexed seat)",
  "event Converted(uint256 pupateSold, uint256 ethBought, uint256 imdBought, address indexed caller, uint256 reward)",
  "event StakedCard(uint256 indexed id, address indexed staker, uint8 weight)",
  "event Unstaked(uint256 indexed id, address indexed staker)",
  "event Claimed(address indexed staker, uint256 imd)",
  "event Reweighed(uint256 indexed id, uint8 weight)",
  "event MetadataUpdate(uint256 _tokenId)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed id)",
  // Every custom error the token can raise (its own and ERC721Lite's), so a simulated revert decodes to its name.
  "error SupplyExhausted()",
  "error NothingMineable()",
  "error BadAnchor()",
  "error BadBits()",
  "error BadPoolKey()",
  "error BadWiring()",
  "error NotASolution()",
  "error SeatNotHeld()",
  "error SeatTooLarge()",
  "error SeatNotNoted()",
  "error SeatHeld()",
  "error Staked()",
  "error NotStaked()",
  "error NotCardOwner()",
  "error NothingToConvert()",
  "error NothingBought()",
  "error TooSoon()",
  "error OnlyPoolManager()",
  "error OnlySelf()",
  "error UnexpectedCallback()",
  "error Reentrancy()",
  "error TransferFailed()",
  "error NotOwner()",
  "error NotAuthorized()",
  "error ZeroAddress()",
  "error AlreadyMinted()",
  "error NotMinted()",
  "error UnsafeRecipient()",
] as const;

export const metamorphAbi = parseAbi(METAMORPH_SIGNATURES);

/// The art router: a card's whole token URI (and its SVG or JSON alone) from the card's facts, the
/// `IMetamorphArt.View` the token hands it. The page reads cards through the token's `tokenURI`.
export const METAMORPH_ART_SIGNATURES = [
  "struct View { uint256 id; uint256 seat; uint16 round; uint16 edition; uint8 stage; bool gilt; uint16 epoch; address miner; uint40 mintedAt; uint256 paid; }",
  "function tokenURI(View v) view returns (string)",
  "function svg(View v) view returns (string)",
  "function json(View v) view returns (string)",
  "function CHRYSALIS() view returns (address)",
  "function BUTTERFLY() view returns (address)",
  "error ZeroAddress()",
] as const;

export const metamorphArtAbi = parseAbi(METAMORPH_ART_SIGNATURES);

export type MetamorphEventName = ContractEventName<typeof metamorphAbi>;
export type MetamorphErrorName = ContractErrorName<typeof metamorphAbi>;

/// The token's events by name, for `getLogs`, `watchContractEvent` and `parseEventLogs`. The
/// `satisfies` keeps the list whole and spelled as the ABI spells it.
export const METAMORPH_EVENTS = {
  Minted: "Minted",
  DutyRun: "DutyRun",
  Retargeted: "Retargeted",
  SeatNoted: "SeatNoted",
  SeatForgotten: "SeatForgotten",
  Converted: "Converted",
  StakedCard: "StakedCard",
  Unstaked: "Unstaked",
  Claimed: "Claimed",
  Reweighed: "Reweighed",
  MetadataUpdate: "MetadataUpdate",
  Transfer: "Transfer",
} as const satisfies { [name in MetamorphEventName]: name };
