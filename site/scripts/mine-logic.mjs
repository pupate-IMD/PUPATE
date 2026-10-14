// Pure-logic checks of the Metamorph MD page, in Node: no chain, no browser. It starts with the ABI the
// page and the keeper share (site/lib/metamorph/abi.ts); the job builder, the gas padding, the
// pending-IMD formula and the Transfer folding join it as they are written.
//
//   cd site && npm run mine-check        (or: node scripts/mine-logic.mjs)
//
// viem resolves from site/node_modules through Node's own lookup (a bare import, as keccak-kat.mjs does),
// and the ABI module is imported as TypeScript, which Node 22.18 or later (23.6 or later on the 23 line)
// runs without a flag. The expected selectors and topics are forge's, pasted as printed (forge 1.7.1) by
//   forge inspect src/metamorph/MetamorphMD.sol:MetamorphMD methodIdentifiers --json   (and events, errors)
//   forge inspect src/metamorph/art/MetamorphArt.sol:MetamorphArt methodIdentifiers --json   (and errors)
// so re-paste them when a contract changes. Outputs, mutability and indexed flags are held against the
// compiled ABI in ../out when `forge build` has run, and keeper/lib/abi.mjs's metamorphAbi against the
// site's when the keeper's dependencies are installed; each of those two says SKIP otherwise.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { toEventSelector, toFunctionSelector } from "viem";
import { formatAbiItem } from "viem/utils";
import {
  METAMORPH_ART_SIGNATURES,
  METAMORPH_EVENTS,
  METAMORPH_SIGNATURES,
  metamorphAbi,
  metamorphArtAbi,
} from "../lib/metamorph/abi.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}
function skip(name, why) {
  console.log(`SKIP  ${name}  (${why})`);
}

// ------------------------------------------------------------------ forge's selectors, pasted

const MD_METHODS = {
  "ANCHOR_WINDOW()": "14d0c338",
  "ART()": "9cb84a01",
  "BASE_PRICE()": "f86325ed",
  "BUTTERFLY_CEILING()": "a60242a7",
  "BUY_IMPACT_BPS()": "482c7246",
  "CALLER_REWARD_BPS()": "bac0a7d6",
  "COCOON()": "d64c637b",
  "COLLECTION()": "697b2365",
  "CONVERT_BACKOFF()": "2ddee746",
  "CONVERT_GAS()": "7696e1a5",
  "CONVERT_IMPACT_BPS()": "5dc7dc9b",
  "CONVERT_PRICES()": "f7d5535e",
  "CONVERT_SPACING()": "e9132c67",
  "DECAY_INTERVAL()": "95ffd7f7",
  "DOMAIN()": "52a9674b",
  "DUTY_GAS()": "de6f95ad",
  "DUTY_MAX_BASEFEE()": "e0d63bb8",
  "EDITIONS()": "c1a2f7b2",
  "EPOCH()": "a0dc2758",
  "HOOK()": "a54eb242",
  "IMD()": "d0abb693",
  "MAX_SUPPLY()": "32cb6b0c",
  "MIN_BITS()": "d3091615",
  "MIN_BURN()": "49844b1c",
  "MIN_FLUSH()": "84fe8bed",
  "POOL_MANAGER()": "62308e85",
  "PUPATE()": "5086eac5",
  "ROYALTY_BPS()": "49c657db",
  "STAKER_BPS()": "dfa3e8ac",
  "TARGET_INTERVAL()": "34d57492",
  "accIMDPerWeight()": "a76291a2",
  "anchorHash(uint256)": "98d57bc6",
  "approve(address,uint256)": "095ea7b3",
  "balanceOf(address)": "70a08231",
  "bits()": "4f9640de",
  "cards(uint256)": "8dc10768",
  "claim(uint256[])": "6ba4c138",
  "convert()": "91bbdcc7",
  "convertBackoffUntil()": "25e319d9",
  "convertDuty(address)": "1a095b9e",
  "dutiesDue()": "87c14c66",
  "editionsMinted(uint256,uint16)": "4f369b8d",
  "effectiveTarget()": "4c675669",
  "epoch()": "900cf0cf",
  "ethPot()": "117a1b75",
  "forgetSeat(uint256)": "22da918e",
  "getApproved(uint256)": "081812fc",
  "imdOwed()": "0b799389",
  "isApprovedForAll(address,address)": "e985e9c5",
  "lastConvertBlock()": "2588f2c6",
  "lastMintAt()": "da444f0b",
  "mineableSeats()": "3e9a09c7",
  "mint(uint256,uint256)": "1b2ef1ca",
  "mintPrice()": "6817c76c",
  "name()": "06fdde03",
  "noteSeat(uint256)": "92f400ae",
  "noted(uint256)": "b877af00",
  "notedSeats()": "fea619a3",
  "ownerOf(uint256)": "6352211e",
  "pendingIMD(address)": "0138ca6d",
  "poke(uint256[])": "f5e7f5d9",
  "pot()": "4ba2363a",
  "prevWork()": "a4da5da2",
  "priceAt(uint16)": "0cbdf889",
  "royaltyInfo(uint256,uint256)": "2a55205a",
  "safeTransferFrom(address,address,uint256)": "42842e0e",
  "safeTransferFrom(address,address,uint256,bytes)": "b88d4fde",
  "setApprovalForAll(address,bool)": "a22cb465",
  "stageOf(uint256)": "c7d25b15",
  "stake(uint256[])": "0fbf0a93",
  "stakeOf(uint256)": "24a66539",
  "supportsInterface(bytes4)": "01ffc9a7",
  "symbol()": "95d89b41",
  "target()": "d4b83992",
  "tokenURI(uint256)": "c87b56dd",
  "totalMinted()": "a2309ff8",
  "totalWeight()": "96c82e57",
  "transferFrom(address,address,uint256)": "23b872dd",
  "unlockCallback(bytes)": "91dd7346",
  "unstake(uint256[])": "e449f341",
  "workHash(bytes32,address,uint256)": "c7808137",
};

const MD_EVENTS = {
  "Approval(address,address,uint256)": "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925",
  "ApprovalForAll(address,address,bool)": "0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31",
  "Claimed(address,uint256)": "0xd8138f8a3f377c5259ca548e70e4c2de94f129f5a11036a15b69513cba2b426a",
  "Converted(uint256,uint256,uint256,address,uint256)": "0xab7165e90f5d120e8457fdc27fd044d12fd1c5346ca9c5c9180522790d8882e6",
  "DutyRun(uint8,uint256)": "0xd5927b4b385e6161a9aa467935eef313eb03d8f705c3221a39eaed57adb086c8",
  "MetadataUpdate(uint256)": "0xf8e1a15aba9398e019f0b49df1a4fde98ee17ae345cb5f6b5e2c27f5033e8ce7",
  "Minted(uint256,uint256,uint16,uint16,address,bytes32,bool,uint256,uint16)": "0x4048a264f7d89208c883630d99d648a44ecc58cb83dfb41d3ecc716ffba6a5cc",
  "Retargeted(uint256)": "0xdfe52b9a29e01e962fb46fe8a182e2828c02d16dfa91b26ca0dceffa68834199",
  "Reweighed(uint256,uint8)": "0xeedf988cea0d6ef2be92f83c8b51ffe8b6e1f6af4ff89bdac88025098b438f52",
  "SeatForgotten(uint256)": "0x8147b646b5cab188a097fe2cb8679d01f8bb1dd89e9b12ac15425ea9328fd804",
  "SeatNoted(uint256)": "0xaa0210490aca876d86fe3cfe3e859419ea6e62faeb843ed45cdca246b2837fa0",
  "StakedCard(uint256,address,uint8)": "0x5d3f39a9c85b9f3dcbaf318c4c1e75d64d0800e038b7323421a1f06d9dacd3f4",
  "Transfer(address,address,uint256)": "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
  "Unstaked(uint256,address)": "0x81b0ac4b13aab1ab3b86d524dd62924e99a9d694e94e235f627bb41589717ff7",
};

const MD_ERRORS = {
  "AlreadyMinted()": "ddefae28",
  "BadAnchor()": "6e84ebb5",
  "BadBits()": "8dfb52ad",
  "BadPoolKey()": "9ab330c6",
  "BadWiring()": "e70b4a41",
  "NotASolution()": "6ca3ff4a",
  "NotAuthorized()": "ea8e4eb5",
  "NotCardOwner()": "8f0f029b",
  "NotMinted()": "4d5e5fb3",
  "NotOwner()": "30cd7471",
  "NotStaked()": "039f2e18",
  "NothingBought()": "87f36a18",
  "NothingMineable()": "f632d020",
  "NothingToConvert()": "3019b3f8",
  "OnlyPoolManager()": "f655705d",
  "OnlySelf()": "14d4a4e8",
  "Reentrancy()": "ab143c06",
  "SeatHeld()": "f7a1c4ad",
  "SeatNotHeld()": "f28ad437",
  "SeatNotNoted()": "d0d4cc42",
  "SeatTooLarge()": "ea1ad1c7",
  "Staked()": "7c8034b0",
  "SupplyExhausted()": "ed227a69",
  "TooSoon()": "6fed7d85",
  "TransferFailed()": "90b8ec18",
  "UnexpectedCallback()": "dab1e993",
  "UnsafeRecipient()": "3da63931",
  "ZeroAddress()": "d92e233d",
};

const ART_METHODS = {
  "BUTTERFLY()": "2d65ba61",
  "CHRYSALIS()": "5305e043",
  "json((uint256,uint256,uint16,uint16,uint8,bool,uint16,address,uint40,uint256))": "c5323541",
  "svg((uint256,uint256,uint16,uint16,uint8,bool,uint16,address,uint40,uint256))": "2ee1a4ea",
  "tokenURI((uint256,uint256,uint16,uint16,uint8,bool,uint16,address,uint40,uint256))": "a131d9b6",
};

const ART_ERRORS = { "ZeroAddress()": "d92e233d" };

// ------------------------------------------------------------------ helpers

/// The canonical signature: how forge keys its maps, and what viem hashes for an error (decodeErrorResult).
const sig = (item) => formatAbiItem(item);
const ofType = (abi, type) => abi.filter((x) => x.type === type);
const fnSelector = (x) => toFunctionSelector(sig(x)).slice(2);
/// The signatures whose selector is not the one forge printed, or that forge does not know.
const selectorMisses = (items, expected, selector) => items.filter((x) => expected[sig(x)] !== selector(x)).map(sig);
const listed = (names) => names.join(", ");

// ------------------------------------------------------------------ the ABI

console.log("== the Metamorph ABI (lib/metamorph/abi.ts)");

for (const [name, strings, abi] of [
  ["metamorphAbi", METAMORPH_SIGNATURES, metamorphAbi],
  ["metamorphArtAbi", METAMORPH_ART_SIGNATURES, metamorphArtAbi],
]) {
  const items = strings.filter((s) => !s.startsWith("struct ")).length;
  const keys = abi.map((x) => `${x.type} ${sig(x)}`);
  check(
    `${name}: parseAbi took every signature, none twice`,
    abi.length === items && new Set(keys).size === keys.length,
    `${abi.length} items from ${strings.length} strings`,
  );
}

{
  const fns = ofType(metamorphAbi, "function");
  const miss = selectorMisses(fns, MD_METHODS, fnSelector);
  check(`metamorphAbi: the ${fns.length} function selectors are forge's`, miss.length === 0, listed(miss));

  const events = ofType(metamorphAbi, "event");
  const missE = selectorMisses(events, MD_EVENTS, (x) => toEventSelector(x));
  check(`metamorphAbi: the ${events.length} event topics are forge's`, missE.length === 0, listed(missE));

  const errors = ofType(metamorphAbi, "error");
  const missR = selectorMisses(errors, MD_ERRORS, fnSelector);
  const absent = Object.keys(MD_ERRORS).filter((s) => !errors.some((x) => sig(x) === s));
  check(
    `metamorphAbi: the ${errors.length} error selectors are forge's, and every error of the contract is there`,
    missR.length === 0 && absent.length === 0,
    listed([...missR, ...absent.map((s) => `${s} missing`)]),
  );

  const named = Object.keys(METAMORPH_EVENTS).sort().join(",");
  check("METAMORPH_EVENTS names every event of the ABI", named === events.map((x) => x.name).sort().join(","), named);
}

{
  const fns = ofType(metamorphArtAbi, "function");
  const miss = selectorMisses(fns, ART_METHODS, fnSelector);
  const missR = selectorMisses(ofType(metamorphArtAbi, "error"), ART_ERRORS, fnSelector);
  check(
    `metamorphArtAbi: the ${fns.length} function selectors and the error are forge's`,
    miss.length === 0 && missR.length === 0 && fns.length === Object.keys(ART_METHODS).length,
    listed([...miss, ...missR]),
  );
}

// What a selector does not cover (outputs, mutability, indexed flags), against what forge compiled.
const canon = (p) => (p.type.startsWith("tuple") ? `(${p.components.map(canon).join(",")})${p.type.slice(5)}` : p.type);
const shape = (x) =>
  x.type === "function"
    ? `${x.stateMutability} returns (${x.outputs.map(canon).join(",")})`
    : x.type === "event"
      ? `${x.inputs.map((p) => `${canon(p)}${p.indexed ? " indexed" : ""}`).join(",")}${x.anonymous ? " anonymous" : ""}`
      : "";
for (const [name, abi, artifact] of [
  ["metamorphAbi", metamorphAbi, "out/MetamorphMD.sol/MetamorphMD.json"],
  ["metamorphArtAbi", metamorphArtAbi, "out/MetamorphArt.sol/MetamorphArt.json"],
]) {
  const file = join(REPO, artifact);
  const what = `${name}: outputs, mutability and indexed flags equal the compiled ABI`;
  if (!existsSync(file)) {
    skip(what, `${artifact} is missing: run forge build at the repository root`);
    continue;
  }
  const compiled = JSON.parse(readFileSync(file, "utf8")).abi;
  const off = abi
    .filter((x) => {
      const twin = compiled.find((c) => c.type === x.type && sig(c) === sig(x));
      return !twin || shape(twin) !== shape(x);
    })
    .map(sig);
  check(what, off.length === 0, off.length ? listed(off) : `${abi.length} items`);
}

// The keeper's copy: the same strings, so the same parsed ABI.
{
  const what = "keeper/lib/abi.mjs metamorphAbi is the site's, item for item";
  try {
    const keeper = await import(pathToFileURL(join(REPO, "keeper", "lib", "abi.mjs")).href);
    const same = JSON.stringify(keeper.metamorphAbi) === JSON.stringify(metamorphAbi);
    check(what, same, same ? `${metamorphAbi.length} items` : "the twins differ: change both files together");
  } catch (e) {
    skip(what, `keeper/lib/abi.mjs did not load (npm ci in keeper/): ${e.code ?? e.message}`);
  }
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
