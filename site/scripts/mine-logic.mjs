// Logic checks of the Metamorph MD page, in Node, no browser: the ABI the page and the keeper share
// (site/lib/metamorph/abi.ts); then the live job and the mint (lib/metamorph/job.ts, mint.ts): the target
// words, the gas padding, the field-note lines, the receipt reading, the allowance re-checked at an epoch
// step, the refusals; then the same against the local stack when it is up (script/local/up.mjs: anvil on
// 8545 with Metamorph MD at one bit), where a real mint is mined and sent from anvil's account #2: the job
// against the contract's views, the folded word against workHash, an eth_call of mint, the padded limit,
// the receipt, the card's image, a race in one block, the anchor's window. Without the stack that part
// says SKIP. Then the workspace (lib/metamorph/cards.ts): the Transfer folding (a card sent away and back is
// the wallet's once), the pending-IMD formula against a model of the contract's staking (two stakers, one
// credit), the image cache (its key, one read per (id, stage, gilt), storage missing, refused or full), the
// leaderboard, the buttons' ids; and on the stack, anvil's account #5 mints two cards, sends one away and
// back, stakes the other, and after a credit to the stakers Claim IMD (every staked card) pays exactly the
// figure. Then useMiner itself, without React (a stand-in for its hooks, its Workers and the chain): the page
// left while a start's reads, a poll, a mint or the GPU's self-test are on their way; a mint whose answer went
// missing; Stop with a hash waiting; reverted receipts; the readings after a stop; a wallet that disconnects.
// Then the seat drawing (lib/seat.ts) against the contract's twin (script/art/mirror.mjs) for 64 seats and a
// few far ones; and the mine's numbers (lib/metamorph/live.ts): the arithmetic on a scenario (the rate, the
// percent, the seconds since the last mint, the hour's walk), loadMine against a stand-in chain (the card
// times read once, the clock, a mint dropped with its block), useMineNumbers without React (at once, every
// three seconds, skipped polls, a reload, a failed read, another token, the page left); and on the stack,
// loadMine against the contract's views at the same block, every card's mintedAt and the Minted logs.
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
import { keccak_256 } from "@noble/hashes/sha3";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  UserRejectedRequestError,
  createPublicClient,
  createWalletClient,
  custom,
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionResult,
  erc20Abi,
  getAddress,
  http,
  parseAbi,
  isAddressEqual,
  keccak256,
  maxUint256,
  multicall3Abi,
  toBytes,
  toEventSelector,
  toFunctionSelector,
  toHex,
} from "viem";
import { foundry } from "viem/chains";
import { formatAbiItem } from "viem/utils";

// The site's modules run here as they are. site/package.json names no module type, so Node would parse each
// .ts file as CommonJS first and warn (MODULE_TYPELESS_PACKAGE_JSON): the hook says they are TypeScript
// modules. It also adds the ".ts" the site's modules leave off their relative imports (the site's bundler
// resolves them; Node needs it spelled out). The modules are imported after the hook is in place: a static
// import is resolved before any hook.
registerHooks({
  resolve(specifier, context, nextResolve) {
    const bare = /^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier);
    const r = nextResolve(bare ? `${specifier}.ts` : specifier, context);
    return r.url.endsWith(".ts") ? { ...r, format: "module-typescript" } : r;
  },
});
const { METAMORPH_ART_SIGNATURES, METAMORPH_EVENTS, METAMORPH_SIGNATURES, metamorphAbi, metamorphArtAbi } = await import("../lib/metamorph/abi.ts");

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

// ------------------------------------------------------------------ live jobs and the mint (Task 2)

// lib/metamorph/job.ts and mint.ts import their neighbours without an extension; the hook at the top adds it.
const J = await import("../lib/metamorph/job.ts");
const M = await import("../lib/metamorph/mint.ts");
const { cocoonAbi } = await import("../lib/abi.ts");
const { buildSwap } = await import("../lib/swap.ts");
const { PRACTICE_BITS, practiceBitsFor, targetWords, targetWordsFrom } = await import("../lib/miner/job.ts");
const { preimage, bytesHex, hexBytes } = await import("../lib/miner/gpu/words.ts");

console.log("\n== live jobs and the mint (lib/metamorph/job.ts, lib/metamorph/mint.ts)");

const MAX = (1n << 256n) - 1n;
const words64 = (w) => (BigInt(w.targetHi) << 32n) | BigInt(w.targetLo);

// The engines' two words: the top 64 bits of the contract's target, never passing a hash it refuses.
{
  let same = true;
  for (let b = 1; b < 64; b++) {
    const a = targetWordsFrom(1n << BigInt(256 - b));
    const w = targetWords(b);
    same &&= a.targetHi === w.targetHi && a.targetLo === w.targetLo;
  }
  check("targetWordsFrom(2^(256-b)) equals the practice targetWords(b) for b = 1..63", same);
  let exact = true;
  let safe = true;
  for (let i = 0; i < 2000; i++) {
    const t = BigInt(bytesHex(crypto.getRandomValues(new Uint8Array(32)))) >> BigInt(i % 40);
    const w = words64(targetWordsFrom(t));
    exact &&= w === t >> 192n;
    // Any digest whose first eight bytes are below the words is below w * 2^192 <= t.
    safe &&= w << 192n <= t;
  }
  check("targetWordsFrom is the top 64 bits, and a hash it passes is below the whole target (2,000 random)", exact && safe);
  const ceil1 = targetWordsFrom(MAX >> 1n);
  let refused = 0;
  try {
    targetWordsFrom(1n << 256n);
  } catch {
    refused++;
  }
  try {
    targetWordsFrom(-1n);
  } catch {
    refused++;
  }
  check(
    "the one-bit ceiling (max >> 1) gives 0x7fffffff ffffffff; a uint256 out of range is refused",
    ceil1.targetHi === 0x7fffffff && ceil1.targetLo === 0xffffffff && refused === 2,
  );
}

// The practice target is untouched: the GPU's bits from its measured rate, as before this task.
{
  const table = [
    [0, 20],
    [-5, 20],
    [NaN, 20],
    [1e3, 20],
    [1e6, 22],
    [5e7, 28],
    [1e8, 29],
    [1e9, 32],
    [3e10, 37],
    [1e12, 40],
  ];
  const off = table.filter(([rate, want]) => practiceBitsFor(rate) !== want).map(([rate, want]) => `${rate}: ${practiceBitsFor(rate)} not ${want}`);
  check("practiceBitsFor unchanged (rate -> bits, 20..40) and PRACTICE_BITS is 20", off.length === 0 && PRACTICE_BITS === 20, off.join("; "));
}

// The gas rule: the estimate + 400,000 per due flush or burn + 1,000,000 for a due conversion.
{
  const est = 180_000n;
  const off = [];
  for (let k = 0; k < 8; k++) {
    const d = { flushDue: !!(k & 1), burnDue: !!(k & 2), convertDue: !!(k & 4) };
    const want = est + (d.flushDue ? 400_000n : 0n) + (d.burnDue ? 400_000n : 0n) + (d.convertDue ? 1_000_000n : 0n);
    if (M.paddedGas(est, d) !== want) off.push(`${JSON.stringify(d)}: ${M.paddedGas(est, d)}`);
  }
  check(
    "paddedGas: all eight duty combinations (180,000 -> 580,000 / 980,000 / 1,180,000 ... 1,980,000)",
    off.length === 0 && M.DUTY_PAD === 400_000n && M.CONVERT_PAD === 1_000_000n && M.paddedGas(est, { flushDue: true, burnDue: true, convertDue: true }) === 1_980_000n,
    off.join("; "),
  );
}

// The field notes: the spec's lines word for word, and the duty lines with their amounts.
{
  const e18 = 10n ** 18n;
  const got = [
    [M.LINES.found, "found a valid hash · sending the mint"],
    [M.LINES.lost, "someone minted first, your hash expired · mining again"],
    [M.LINES.short, "not enough PUPATE for the mint price"],
    [M.LINES.approving, "approving PUPATE once for every mint"],
    [M.mintedLine({ id: 212n, seat: 1376n, gilt: false }), "Metamorph.md #212 is yours · seat identity.md #1376 · mining the next one"],
    [M.mintedLine({ id: 212n, seat: 1376n, gilt: true }), "Metamorph.md #212 is yours · seat identity.md #1376 · gilt · mining the next one"],
    [M.mintedLine({ id: 3n, seat: 9n, gilt: false }, false), "Metamorph.md #3 is yours · seat identity.md #9"],
    [M.dutyLine({ kind: 1, paid: (23n * e18) / 100_000n, burned: (46n * e18) / 1000n }), "your mint also burned 0.046 ETH of tax for the vault · you earned 0.00023 ETH"],
    [M.dutyLine({ kind: 1, paid: (23n * e18) / 100_000n }), "your mint also burned the vault's tax · you earned 0.00023 ETH"],
    [M.dutyLine({ kind: 2, paid: (15n * e18) / 10n }), "your mint also turned the stakers' share into IMD · you earned 1.5 IMD"],
    [M.dutyLine({ kind: 0, paid: 0n }), "your mint also flushed the vault's tax"],
    [M.gasLine(580_000n, true), "sending with 580,000 gas, the vault's work included"],
    [M.gasLine(180_000n, false), "sending with 180,000 gas"],
  ];
  const off = got.filter(([a, b]) => a !== b).map(([a, b]) => `"${a}" is not "${b}"`);
  check(`the field-note lines are the spec's (${got.length})`, off.length === 0, off.join("; "));
  // The page's words (the spec's "Copy and words"): none of these in anything the notes print.
  const FORBIDDEN = /series|target|anchor|prevwork|retarget|\bpots?\b|convert|refresh|duties/i;
  const printed = [...Object.values(M.LINES), ...got.map(([a]) => a)];
  const bad = printed.filter((l) => FORBIDDEN.test(l));
  check("no line the notes print says series, target, anchor, prevWork, retarget, pot, convert, refresh or duties", bad.length === 0, bad.join(" | "));
  const zero = new ContractFunctionExecutionError(new ContractFunctionZeroDataError({ functionName: "anchorHash" }), { abi: metamorphAbi, functionName: "anchorHash", args: [1n] });
  const rev = new ContractFunctionExecutionError(new ContractFunctionRevertedError({ abi: metamorphAbi, data: toFunctionSelector("NotASolution()"), functionName: "prevWork" }), {
    abi: metamorphAbi,
    functionName: "prevWork",
    args: [],
  });
  const texts = [M.errorText(zero), M.errorText(rev)];
  check(
    "errorText keeps viem's reason and drops the contract function's name",
    texts[0] === 'a contract call returned no data ("0x").' && texts[1] === "a contract call reverted." && !texts.some((t) => FORBIDDEN.test(t)),
    texts.join(" | "),
  );
}

// The receipt, read from logs built as the contracts emit them: the card only from the token's own Minted
// for this miner, the duties from its DutyRun, a burn's ETH from Cocoon's Burned whose caller is the token.
const MD = "0x5bdc0de333c5e37f4a8f567c332bb1de6e669589";
const COCOON = "0xcb3bae124cbeefc23b678497a9547d4fcb5e7a03";
const ME = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc";
const THEM = "0x90f79bf6eb2c4f870365e785982e1f101e93b906";
function logOf(abi, address, eventName, args) {
  const item = abi.find((x) => x.type === "event" && x.name === eventName);
  const topics = encodeEventTopics({ abi: [item], eventName, args });
  const plain = item.inputs.filter((p) => !p.indexed);
  const data = encodeAbiParameters(plain, plain.map((p) => args[p.name]));
  return { address, topics, data, blockNumber: 1n, transactionHash: `0x${"ab".repeat(32)}`, logIndex: 0, blockHash: `0x${"cd".repeat(32)}`, transactionIndex: 0, removed: false };
}
const minted = (miner, id) =>
  logOf(metamorphAbi, MD, "Minted", { id, seat: 1376n, round: 1, edition: Number(id), miner, work: `0x${"0f".repeat(32)}`, gilt: id === 7n, price: 50_000n * 10n ** 18n, epoch: 1 });
const dutyRun = (address, kind, paid) => logOf(metamorphAbi, address, "DutyRun", { kind, paid });
const burned = (address, caller, ethSpent) => logOf(cocoonAbi, address, "Burned", { ethSpent, pupateBurned: 10n ** 24n, caller, reward: ethSpent / 200n });
{
  const a = { metamorph: MD, cocoon: COCOON };
  const spent = 46n * 10n ** 15n;
  const full = M.parseMintReceipt(
    {
      status: "success",
      logs: [burned(COCOON, THEM, 99n), burned(COCOON, MD, spent), minted(ME, 7n), dutyRun(MD, 0, 0n), dutyRun(MD, 1, spent / 200n), dutyRun(THEM, 2, 5n), dutyRun(MD, 2, 3n * 10n ** 18n)],
    },
    a,
    ME,
  );
  check(
    "parseMintReceipt: the card from Minted (id 7, gilt), the three duties from the token's DutyRun, the burn's ETH from Cocoon's Burned by the token",
    full.minted?.id === 7n && full.minted.gilt === true && !full.lost && full.duties.length === 3 && full.duties[1].kind === 1 && full.duties[1].burned === spent && full.duties[0].burned === undefined,
    JSON.stringify(full.duties, (k, v) => (typeof v === "bigint" ? v.toString() : v)),
  );
  const lines = M.outcomeLines(full);
  check(
    "outcomeLines: the success line, then each duty's line",
    lines.length === 4 &&
      lines[0] === "Metamorph.md #7 is yours · seat identity.md #1376 · gilt · mining the next one" &&
      lines[1] === "your mint also flushed the vault's tax" &&
      lines[2] === "your mint also burned 0.046 ETH of tax for the vault · you earned 0.00023 ETH" &&
      lines[3] === "your mint also turned the stakers' share into IMD · you earned 3 IMD",
    lines.join(" | "),
  );
  const other = M.parseMintReceipt({ status: "success", logs: [minted(THEM, 8n), dutyRun(MD, 0, 0n)] }, a, ME);
  const reverted = M.parseMintReceipt({ status: "reverted", logs: [] }, a, ME);
  const fake = M.parseMintReceipt({ status: "success", logs: [{ ...minted(ME, 9n), address: THEM }] }, a, ME);
  check(
    "parseMintReceipt: someone else's Minted, a reverted mint, or a Minted from another address is the lost race, never a card",
    other.lost && !other.minted && other.duties.length === 0 && reverted.lost && !reverted.minted && fake.lost && M.outcomeLines(reverted).join() === M.LINES.lost,
  );
}

// tokenImage: the SVG data URI out of the art's base64 JSON; anything else is null.
{
  const svg = "data:image/svg+xml;base64,PHN2Zy8+";
  const uri = `data:application/json;base64,${Buffer.from(JSON.stringify({ name: "Metamorph.md #1 — ü", image: svg })).toString("base64")}`;
  check(
    "tokenImage decodes the art's JSON (UTF-8 included) and refuses other shapes",
    M.tokenImage(uri) === svg && M.tokenImage("https://example.com/1.json") === null && M.tokenImage("data:application/json;base64,!!") === null,
  );
}

// prepareMint against a stand-in client, so each branch is pinned without a chain: the allowance re-checked
// at an epoch step (approved for epoch 1's price exactly, then the price of epoch 2), the short balance, and
// a refused estimate told apart by prevWork.
const E18 = 10n ** 18n;
const PRICE1 = 50_000n * E18;
const PRICE2 = 62_500n * E18;
const PREV = `0x${"11".repeat(32)}`;
const WORK = `0x${"22".repeat(32)}`;
function standIn(s) {
  const sent = [];
  const client = {
    multicall: async ({ contracts }) =>
      contracts.map((c) => (c.functionName === "mintPrice" ? s.price : c.functionName === "balanceOf" ? s.balance : c.functionName === "allowance" ? s.allowance : undefined)),
    readContract: async ({ functionName }) => (functionName === "dutiesDue" ? s.duties : functionName === "prevWork" ? s.prevWorkNow : undefined),
    estimateContractGas: async () => {
      if (s.revert) throw s.revert;
      return 200_000n;
    },
    waitForTransactionReceipt: async () => ({ status: "success" }),
  };
  const write = async (call) => {
    sent.push(call);
    if (call.functionName === "approve") s.allowance = call.args[1];
    return `0x${"ee".repeat(32)}`;
  };
  return { client, write, sent };
}
const reverted = (name) =>
  new ContractFunctionExecutionError(new ContractFunctionRevertedError({ abi: metamorphAbi, data: toFunctionSelector(`${name}()`), functionName: "mint" }), {
    abi: metamorphAbi,
    functionName: "mint",
    args: [1n, 2n],
    contractAddress: MD,
  });
{
  const a = { metamorph: MD, cocoon: COCOON, token: `0x${"77".repeat(20)}`, chainId: 31337 };
  const job = { anchor: 100n, prevWork: PREV };
  const s = { price: PRICE2, balance: 10n ** 6n * E18, allowance: PRICE1, duties: [true, false, false], prevWorkNow: PREV };
  const t = standIn(s);
  let told = 0;
  const first = await M.prepareMint(t.client, a, { wallet: ME, job, nonce: 5n, write: t.write, onApprove: () => told++ });
  const again = await M.prepareMint(t.client, a, { wallet: ME, job, nonce: 6n, write: t.write });
  check(
    "test_allowanceReCheckedAtAnEpochStep: allowed epoch 1's price, asked epoch 2's, approves once to the maximum, then never again",
    first.ok && first.approved && told === 1 && t.sent.length === 1 && t.sent[0].functionName === "approve" && t.sent[0].args[0] === MD && t.sent[0].args[1] === maxUint256 && again.ok && !again.approved,
    `${t.sent.length} write(s)`,
  );
  check("prepareMint pads the stand-in's estimate for the due flush (200,000 -> 600,000)", first.ok && first.estimate === 200_000n && first.gas === 600_000n);

  const poor = standIn({ ...s, balance: PRICE2 - 1n, allowance: 0n });
  const short = await M.prepareMint(poor.client, a, { wallet: ME, job, nonce: 5n, write: poor.write });
  check("prepareMint: a balance under the price is 'short', and nothing is approved or sent", !short.ok && short.why === "short" && poor.sent.length === 0);

  const why = async (revert, prevWorkNow, work) => {
    const r = await M.prepareMint(standIn({ ...s, allowance: maxUint256, revert, prevWorkNow }).client, a, { wallet: ME, job, nonce: 5n, work, write: async () => "0x" });
    return r.ok ? "ok" : r.why;
  };
  const read = [
    [await why(reverted("NotASolution"), `0x${"33".repeat(32)}`, WORK), "lost"],
    [await why(reverted("NotASolution"), PREV, WORK), "difficulty"],
    [await why(reverted("NotASolution"), WORK, WORK), "landed"],
    [await why(reverted("BadAnchor"), PREV, WORK), "expired"],
    [await why(reverted("NothingMineable"), PREV, WORK), "nothing"],
    [await why(reverted("SupplyExhausted"), PREV, WORK), "soldOut"],
  ];
  let other = "no throw";
  try {
    await why(new Error("connection reset"), PREV, WORK);
  } catch (e) {
    other = e.message;
  }
  check(
    "a refused estimate: NotASolution with prevWork moved is the lost race, unmoved the difficulty, equal to the hash its own landed mint; BadAnchor expired; other errors are thrown",
    read.every(([g, w]) => g === w) && other === "connection reset",
    read.map(([g, w]) => `${g}${g === w ? "" : ` (want ${w})`}`).join(", "),
  );
}

// A wallet's "no", however deep in the error; nothing else counts as one.
check(
  "isUserRejection: viem's UserRejectedRequestError, wrapped or bare, and code 4001; not a revert or a network error",
  M.isUserRejection(new UserRejectedRequestError(new Error("User rejected the request."))) &&
    M.isUserRejection(new ContractFunctionExecutionError(new UserRejectedRequestError(new Error("no")), { abi: metamorphAbi, functionName: "mint", args: [] })) &&
    M.isUserRejection({ code: 4001, message: "User denied" }) &&
    !M.isUserRejection(reverted("NotASolution")) &&
    !M.isUserRejection(new Error("fetch failed")),
);

// When the poller rebuilds the job.
{
  const base = { live: true, prevWork: PREV, target: MAX >> 20n, ...targetWordsFrom(MAX >> 20n), chainId: 1, contract: MD, miner: ME, anchor: 100n };
  check(
    "jobChanged on a new prevWork or target, not on a fresh read of the same state; anchorExpiring from age 40",
    !J.jobChanged(base, { ...base, anchor: 130n }) &&
      J.jobChanged(base, { ...base, prevWork: WORK }) &&
      J.jobChanged(base, { ...base, target: MAX >> 18n, ...targetWordsFrom(MAX >> 18n) }) &&
      J.jobChanged(base, { ...base, miner: THEM }) &&
      !J.anchorExpiring(base, 139n) &&
      J.anchorExpiring(base, 140n),
  );
}

// ------------------------------------------------------------------ the workspace (Task 3)

const C = await import("../lib/metamorph/cards.ts");

console.log("\n== the workspace (lib/metamorph/cards.ts)");

// The Transfer folding: a card is the wallet's when its last transfer went to it, however the logs come.
{
  const ZERO = "0x0000000000000000000000000000000000000000";
  const t = (id, from, to, block, logIndex) => ({ id: BigInt(id), from, to, blockNumber: BigInt(block), logIndex });
  const logs = [
    t(1, ZERO, ME, 10, 0), // minted to ME
    t(2, ZERO, THEM, 11, 0), // minted to THEM
    t(1, ME, THEM, 12, 3), // ME sends #1 away
    t(3, ZERO, ME, 13, 0),
    t(1, THEM, ME, 13, 1), // and #1 comes back
    t(4, ZERO, ME, 14, 0), // #4 goes back and forth in one block and ends with THEM
    t(4, ME, THEM, 14, 2),
    t(4, THEM, ME, 14, 5),
    t(4, ME, THEM, 14, 7),
    t(5, ZERO, ME, 15, 0),
    t(5, ME, ME, 16, 0), // a transfer to oneself keeps it
  ];
  const mine = C.heldIds(C.foldTransfers(logs, ME));
  const theirs = C.heldIds(C.foldTransfers(logs, THEM));
  // Any order, as a seeded Fisher-Yates (mulberry32) gives it: the same orders on every run, sixteen of them.
  const shuffle = (list, seed) => {
    let s = seed >>> 0;
    const next = () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let x = s;
      x = Math.imul(x ^ (x >>> 15), x | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  const orders = Array.from({ length: 16 }, (_, k) => shuffle([...logs, ...logs.slice(0, 5)], 1376 + k));
  const anyOrder = orders.every((o) => C.heldIds(C.foldTransfers(o, ME)).join() === "1,3,5") && new Set(orders.map((o) => o.map((l) => `${l.id}:${l.blockNumber}:${l.logIndex}`).join())).size > 1 ? "1,3,5" : "differs";
  // Two reads that overlap, as the poll re-reads its last blocks: the second folds onto the first.
  const inTwo = C.heldIds(C.foldTransfers(logs.slice(4), ME, C.foldTransfers(logs.slice(0, 6), ME)));
  check(
    "foldTransfers: minted, sent away and sent back is the wallet's once; two wallets; any order, logs twice, in two overlapping reads",
    mine.join() === "1,3,5" && theirs.join() === "2,4" && anyOrder === "1,3,5" && inTwo.join() === "1,3,5",
    `ME ${mine.join(",")} · THEM ${theirs.join(",")}`,
  );
}

// The pending-IMD formula against a model of the contract's staking (MetamorphMD.sol: stake, _credit,
// _settle): ME stakes a chrysalis, THEM a butterfly and a chrysalis; one credit (a conversion); ME stakes
// another card after it; then ME's first card is settled, as unstake and claim(ids) do.
{
  const ACC = 10n ** 18n;
  const s = { acc: 0n, total: 0n, stakes: new Map(), pending: new Map() };
  const stake = (id, who, weight) => {
    s.stakes.set(id, { who, weight, debt: BigInt(weight) * s.acc });
    s.total += BigInt(weight);
  };
  const credit = (imd) => (s.acc += (imd * ACC) / s.total);
  const settle = (id) => {
    const x = s.stakes.get(id);
    s.pending.set(x.who, (s.pending.get(x.who) ?? 0n) + (BigInt(x.weight) * s.acc - x.debt) / ACC);
    x.debt = BigInt(x.weight) * s.acc;
  };
  const figure = (who) =>
    C.earnedNotClaimed(
      s.pending.get(who) ?? 0n,
      s.acc,
      [...s.stakes.values()].filter((x) => x.who === who).map((x) => ({ staked: true, weight: x.weight, debt: x.debt })),
    );
  stake(1, ME, 1);
  stake(2, THEM, 2);
  stake(3, THEM, 1);
  const X = (35_000n * E18) / 7n + 12_345n;
  credit(X);
  const me1 = figure(ME);
  const them1 = figure(THEM);
  stake(4, ME, 1);
  const me2 = figure(ME);
  settle(1);
  const booked = s.pending.get(ME);
  const me3 = figure(ME);
  check(
    "the pending-IMD formula: pendingIMD + (weight × accIMDPerWeight − debt) / 1e18 per staked card; two stakers, one credit, the butterfly earns double",
    me1 === s.acc / ACC &&
      them1 === (2n * s.acc) / ACC + s.acc / ACC &&
      them1 - 3n * me1 <= 1n &&
      me1 + them1 <= X &&
      X - (me1 + them1) < 3n &&
      me2 === me1 &&
      booked === me1 &&
      me3 === me1 &&
      C.earnedNotClaimed(5n, s.acc, [{ staked: false, weight: 0, debt: 0n }]) === 5n,
    `credit ${X}: ME ${me1}, THEM ${them1}`,
  );
  check(
    "imd4: four decimals, rounded down, thousands separated",
    C.imd4(0n) === "0.0000" && C.imd4(123_456_789_012_345_678n) === "0.1234" && C.imd4(1234n * E18 + 5n * 10n ** 17n) === "1,234.5000" && C.imd4(99_999n * 10n ** 13n) === "0.9999",
  );
}

// The image cache: the key, one tokenURI read per (id, stage, gilt), the JSON's own stage, other deployments'
// entries, and storage missing, refused or full.
class FakeStorage {
  constructor(capacity = Infinity) {
    this.map = new Map();
    this.capacity = capacity;
    this.fail = false;
  }
  get length() {
    return this.map.size;
  }
  key(i) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k) {
    if (this.fail) throw new Error("SecurityError");
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    if (this.fail) throw new Error("SecurityError");
    let used = k.length + String(v).length;
    for (const [kk, vv] of this.map) if (kk !== k) used += kk.length + vv.length;
    if (used > this.capacity) throw Object.assign(new Error("the quota has been exceeded"), { name: "QuotaExceededError" });
    this.map.set(k, String(v));
  }
  removeItem(k) {
    this.map.delete(k);
  }
}
const useStorage = (value) => Object.defineProperty(globalThis, "localStorage", { value, configurable: true, writable: true });
{
  check("imageKey: metamorph:img:<id>:<stage>:<gilt>", C.imageKey(12, 1, true) === "metamorph:img:12:1:true" && C.imageKey(7n, 0, false) === "metamorph:img:7:0:false");
  const svg = (s) => `data:image/svg+xml;base64,${Buffer.from(s).toString("base64")}`;
  const uriOf = (id, stage, gilt) =>
    `data:application/json;base64,${Buffer.from(
      JSON.stringify({
        name: `Metamorph.md #${id}`,
        description: "Seat identity.md #1, edition 1 of 303 · ü",
        image: svg(`<svg id="c${id}-${stage}"/>`),
        attributes: [
          { trait_type: "Seat", value: "1" },
          { trait_type: "Round", value: 1 },
          { trait_type: "Stage", value: stage ? "Butterfly" : "Chrysalis" },
          { trait_type: "Gilt", value: gilt ? "Yes" : "No" },
        ],
      }),
    ).toString("base64")}`;
  const onChain = new Map();
  let reads = 0;
  let now = 0;
  let most = 0;
  const fake = {
    readContract: async ({ functionName, args }) => {
      if (functionName !== "tokenURI") throw new Error(`unexpected ${functionName}`);
      reads++;
      most = Math.max(most, ++now);
      await new Promise((r) => setTimeout(r, 5));
      now--;
      const x = onChain.get(Number(args[0])) ?? { stage: 0, gilt: false };
      return uriOf(Number(args[0]), x.stage, x.gilt);
    },
  };
  const A = { chainId: 31337, metamorph: "0x00000000000000000000000000000000000000aa" };
  const B = { chainId: 31337, metamorph: "0x00000000000000000000000000000000000000bb" };
  const store = new FakeStorage();
  useStorage(store);
  onChain.set(12, { stage: 0, gilt: true });
  const [i1, i2] = await Promise.all([C.tokenImage(fake, A, 12, 0, true), C.tokenImage(fake, A, 12, 0, true)]);
  const i3 = await C.tokenImage(fake, A, 12, 0, true);
  const kept = store.getItem("metamorph:img:12:0:true");
  check(
    "tokenImage: one tokenURI read for two tiles at once and none after; kept in localStorage under the key, tagged with the token",
    reads === 1 && i1 === i2 && i1 === i3 && i1 === svg('<svg id="c12-0"/>') && kept === `31337:${A.metamorph} ${i1}`,
    `${reads} read(s)`,
  );
  onChain.set(12, { stage: 1, gilt: true });
  const i4 = await C.tokenImage(fake, A, 12, 1, true);
  onChain.set(13, { stage: 1, gilt: false });
  const i5 = await C.tokenImage(fake, A, 13, 0, false);
  check(
    "an emerged card is read again under its new stage; a card that emerged before its read is kept under the stage its JSON states",
    reads === 3 && i4 === svg('<svg id="c12-1"/>') && !!store.getItem("metamorph:img:12:1:true") && i5 === svg('<svg id="c13-1"/>') && !!store.getItem("metamorph:img:13:1:false") && !store.getItem("metamorph:img:13:0:false"),
  );
  store.setItem("metamorph:img:99:0:false", `31337:${B.metamorph} ${svg("<svg/>")}`);
  check(
    "storage serves a later visit for its own token only: another deployment's card under the same key is not shown",
    C.cachedImage(B, 12, 0, true) === null && C.cachedImage(A, 99, 0, false) === null && C.cachedImage(B, 99, 0, false) === svg("<svg/>"),
  );
  // Ten tiles at once: four reads at a time.
  reads = 0;
  most = 0;
  const ten = await Promise.all(Array.from({ length: 10 }, (_, k) => C.tokenImage(fake, A, 200 + k, 0, false)));
  check("tokenImage reads four tokenURIs at a time, and every tile gets its image", reads === 10 && most === 4 && ten.every((x, k) => x === svg(`<svg id="c${200 + k}-0"/>`)), `at most ${most} at once`);
  // Storage refused on every access, a getter that throws, no storage at all: the images still come.
  store.fail = true;
  const r1 = await C.tokenImage(fake, A, 300, 0, false);
  Object.defineProperty(globalThis, "localStorage", {
    get() {
      throw new Error("SecurityError");
    },
    configurable: true,
  });
  const r2 = await C.tokenImage(fake, A, 301, 0, false);
  useStorage(undefined);
  const r3 = await C.tokenImage(fake, A, 302, 0, false);
  check("without storage (refused, throwing, absent) the image is read and shown all the same", r1 === svg('<svg id="c300-0"/>') && r2 === svg('<svg id="c301-0"/>') && r3 === svg('<svg id="c302-0"/>'));
  // A full storage makes room: another deployment's images go first, then half of this token's.
  const entry = (id) => `metamorph:img:${id}:0:false`.length + `31337:${A.metamorph} `.length + svg(`<svg id="c${id}-0"/>`).length;
  const full = new FakeStorage(entry(400) * 3 + "pupate-theme".length + "dark".length);
  useStorage(full);
  full.setItem("metamorph:img:401:0:false", `31337:${B.metamorph} ${svg('<svg id="c401-0"/>')}`);
  full.setItem("pupate-theme", "dark");
  for (const id of [402, 403]) await C.tokenImage(fake, A, id, 0, false);
  const before = [...full.map.keys()].join();
  await C.tokenImage(fake, A, 404, 0, false);
  const after = [...full.map.keys()];
  await C.tokenImage(fake, A, 405, 0, false);
  const later = [...full.map.keys()];
  check(
    "a full storage makes room for a new image: another deployment's images first, then half of this token's; the site's other keys stay",
    before.includes("401") &&
      after.join() === "pupate-theme,metamorph:img:402:0:false,metamorph:img:403:0:false,metamorph:img:404:0:false" &&
      later.join() === "pupate-theme,metamorph:img:404:0:false,metamorph:img:405:0:false",
    later.join(", "),
  );
  useStorage(undefined);
  const j = C.cardJSON(uriOf(7, 1, true));
  check(
    "cardJSON: the name, the image, the attributes as text, the stage and gilt the JSON states; no image, no card",
    j?.name === "Metamorph.md #7" &&
      j.description.endsWith("ü") &&
      j.stage === 1 &&
      j.gilt === true &&
      j.attributes.find((x) => x.trait === "Round")?.value === "1" &&
      C.cardJSON(`data:application/json;base64,${Buffer.from('{"name":"x"}').toString("base64")}`) === null &&
      C.cardJSON("https://example.com/7.json") === null,
  );
  check("the stage words are the page's: in the cocoon, emerged", C.stageWord(0) === "in the cocoon" && C.stageWord(1) === "emerged");
}

// The leaderboard, the buttons' ids, what a claim pays.
{
  const X3 = "0x00000000000000000000000000000000000000c3";
  const rows = [
    { id: 1, miner: ME, gilt: false },
    { id: 2, miner: THEM, gilt: true },
    { id: 3, miner: getAddress(THEM), gilt: false },
    { id: 4, miner: X3, gilt: true },
    { id: 5, miner: ME, gilt: true },
  ];
  const lead = C.leaderboard(rows);
  check(
    "leaderboard: miners by cards, gilt counted, the newest first on equal counts, one row per address whatever its case",
    lead.length === 3 && isAddressEqual(lead[0].miner, ME) && lead[0].cards === 2 && lead[0].gilt === 1 && isAddressEqual(lead[1].miner, THEM) && lead[1].cards === 2 && lead[1].newest === 3 && lead[2].cards === 1,
    lead.map((l) => `${l.miner.slice(0, 6)} ${l.cards}/${l.gilt}`).join(", "),
  );
  const cards = [
    { id: 1, staked: true, weight: 1, debt: 0n },
    { id: 2, staked: false, weight: 0, debt: 0n },
    { id: 3, staked: true, weight: 2, debt: E18 },
  ];
  const some = C.actionIds(cards, new Set([1, 2]));
  const none = C.actionIds(cards, new Set());
  const unstakedOnly = C.actionIds(cards, new Set([2]));
  const read = { cards, pending: 7n, accIMDPerWeight: E18 };
  check(
    "the buttons: Stake sends the selected unstaked cards, Unstake and Claim IMD the selected staked ones; with no staked card selected, Claim IMD sends every staked card and pays the whole figure",
    some.stake.join() === "2" &&
      some.unstake.join() === "1" &&
      some.claim.join() === "1" &&
      none.claim.join() === "1,3" &&
      none.stake.length === 0 &&
      none.unstake.length === 0 &&
      unstakedOnly.claim.join() === "1,3" &&
      unstakedOnly.stake.join() === "2" &&
      C.claimable(read, none.claim) === 7n + 1n + 1n &&
      C.claimable(read, none.claim) === C.earnedNotClaimed(read.pending, read.accIMDPerWeight, cards) &&
      C.claimable(read, some.claim) === 7n + 1n,
    `nothing selected: claim([${none.claim.join(", ")}]) pays ${C.claimable(read, none.claim)} of the figure ${C.earnedNotClaimed(read.pending, read.accIMDPerWeight, cards)}`,
  );
  const paid = C.claimedIn({ logs: [logOf(metamorphAbi, COCOON, "Claimed", { staker: ME, imd: 1n }), logOf(metamorphAbi, MD, "Claimed", { staker: ME, imd: 42n })] }, { metamorph: MD }, ME);
  check("claimedIn reads the token's Claimed for this wallet only", paid === 42n && C.claimedIn({ logs: [] }, { metamorph: MD }, ME) === null);
}

// The workspace's reads against a node in a few lines, behind viem's own client, so viem's multicall chunks
// as it would on the page: eth_chainId, eth_blockNumber, eth_getLogs of Transfer and Minted by the topics
// asked, and eth_call of Multicall3's aggregate3 into the token's views. Every eth_call and eth_getLogs is
// counted; a Transfer log can be held back from the first reads (a node that answered without it); a read can
// fail; an id the world does not hold reverts NotMinted.
const NOT_MINTED = Symbol("NotMinted");
function fakeNode(world) {
  const counts = { calls: 0, logs: 0 };
  const eventOf = (name) => metamorphAbi.find((x) => x.type === "event" && x.name === name);
  const rpcLog = (eventName, args, block, index) => {
    const item = eventOf(eventName);
    const plain = item.inputs.filter((p) => !p.indexed);
    return {
      address: world.token,
      topics: encodeEventTopics({ abi: [item], eventName, args }),
      data: plain.length ? encodeAbiParameters(plain, plain.map((p) => args[p.name])) : "0x",
      blockNumber: toHex(block),
      logIndex: toHex(index),
      transactionIndex: "0x0",
      transactionHash: toHex(block * 1000n + BigInt(index), { size: 32 }),
      blockHash: toHex(block, { size: 32 }),
      removed: false,
    };
  };
  const word = (a) => `0x${a.slice(2).toLowerCase().padStart(64, "0")}`;
  const logsFor = ({ topics, fromBlock, toBlock }) => {
    const from = BigInt(fromBlock);
    const to = BigInt(toBlock);
    const inRange = (b) => b >= from && b <= to;
    if (topics[0] === encodeEventTopics({ abi: [eventOf("Minted")], eventName: "Minted" })[0]) {
      return world.mints.filter((m) => inRange(m.block)).map((m, i) => rpcLog("Minted", { id: BigInt(m.id), seat: 1n, round: 0, edition: m.id, miner: m.miner, work: toHex(m.id, { size: 32 }), gilt: false, price: PRICE1, epoch: 1 }, m.block, i));
    }
    const hide = world.hideReads > 0 && topics[2] ? (world.hideReads--, world.hidden) : new Set();
    return world.transfers
      .filter((t) => inRange(t.block) && (!topics[1] || word(t.from) === topics[1].toLowerCase()) && (!topics[2] || word(t.to) === topics[2].toLowerCase()) && !hide.has(t.id))
      .map((t) => rpcLog("Transfer", { from: t.from, to: t.to, id: BigInt(t.id) }, t.block, t.index));
  };
  const view = (fn, args) => {
    const id = args?.[0] === undefined || typeof args[0] !== "bigint" ? null : Number(args[0]);
    switch (fn) {
      case "pendingIMD":
        return world.pending;
      case "accIMDPerWeight":
        return world.acc;
      case "balanceOf":
        return BigInt([...world.owner.values()].filter((o) => isAddressEqual(o, args[0])).length);
      case "ownerOf":
        return world.owner.get(id) ?? NOT_MINTED;
      case "stageOf":
        return world.owner.has(id) ? 0 : NOT_MINTED;
      case "cards":
        return world.owner.has(id) ? [1, 0, id, false, 1_700_000_000 + id, PRICE1, getAddress(ME), toHex(id, { size: 32 })] : [0, 0, 0, false, 0, 0n, "0x0000000000000000000000000000000000000000", toHex(0, { size: 32 })];
      case "stakeOf":
        return world.stakes.get(id) ?? ["0x0000000000000000000000000000000000000000", 0, 0n];
      default:
        throw new Error(`the fake node has no view ${fn}`);
    }
  };
  const transport = custom({
    async request({ method, params }) {
      if (method === "eth_chainId") return toHex(31337);
      if (method === "eth_blockNumber") return toHex(world.head);
      if (method === "eth_getLogs") {
        counts.logs++;
        return logsFor(params[0]);
      }
      if (method === "eth_call") {
        counts.calls++;
        if (world.down || counts.calls > world.callsAnswered) throw new Error("the node is not answering");
        const [calls] = decodeFunctionData({ abi: multicall3Abi, data: params[0].data ?? params[0].input }).args;
        const out = calls.map(({ callData }) => {
          const { functionName, args } = decodeFunctionData({ abi: metamorphAbi, data: callData });
          const v = view(functionName, args);
          return v === NOT_MINTED ? { success: false, returnData: toFunctionSelector("NotMinted()") } : { success: true, returnData: encodeFunctionResult({ abi: metamorphAbi, functionName, result: v }) };
        });
        return encodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", result: out });
      }
      throw new Error(`the fake node has no ${method}`);
    },
  }, { retryCount: 0 });
  return { client: createPublicClient({ chain: foundry, transport }), counts };
}
/// A world where the wallet minted cards 1..n (Transfer from 0x0 at blocks 100, 110, ...), and staked the odd ones.
function walletWorld(n, token) {
  const world = { token, head: 2_000n, transfers: [], mints: [], owner: new Map(), stakes: new Map(), pending: 3n, acc: 2n * E18, hidden: new Set(), hideReads: 0, down: false, callsAnswered: Infinity };
  for (let id = 1; id <= n; id++) {
    world.transfers.push({ from: "0x0000000000000000000000000000000000000000", to: getAddress(ME), id, block: 100n + 10n * BigInt(id), index: 0 });
    world.mints.push({ id, miner: getAddress(ME), block: 100n + 10n * BigInt(id) });
    world.owner.set(id, getAddress(ME));
    if (id % 2) world.stakes.set(id, [getAddress(ME), 1, E18]);
  }
  return world;
}
/// A token address of its own per check: the ledgers and the minted cards are kept per token.
const fakeToken = (n) => getAddress(`0x${(0xc0de000 + n).toString(16).padStart(40, "0")}`);
const addressesOf = (token) => ({ chainId: 31337, metamorph: token, token: getAddress("0x00000000000000000000000000000000000000d6"), cocoon: COCOON, fromBlock: 1 });
{
  const reads = [];
  for (const n of [7, 20]) {
    const token = fakeToken(n);
    const world = walletWorld(n, token);
    const { client, counts } = fakeNode(world);
    const read = await C.walletCards(client, addressesOf(token), getAddress(ME));
    reads.push({ n, calls: counts.calls, cards: read.cards.length, earned: read.earned, staked: read.cards.filter((c) => c.staked).length });
  }
  check(
    "walletCards reads the wallet in one eth_call, 7 cards or 20 (viem split it into 2 and 3 before), and the figure is pendingIMD plus each staked card's share",
    reads.every((x) => x.calls === 1 && x.cards === x.n && x.earned === 3n + BigInt(x.staked) * ((2n * E18 - E18) / E18)),
    reads.map((x) => `${x.n} cards: ${x.calls} eth_call, ${x.cards} cards, ${x.earned} wei`).join("; "),
  );
  // A node that answers the first eth_call of a read and fails the next: the read has no next one, so no card
  // goes missing for a poll (with chunks, the cards of the failed chunk did); a node that fails it all fails
  // the read as a whole, and the page keeps its last good one.
  const later = walletWorld(20, fakeToken(254));
  later.callsAnswered = 1;
  const partial = await C.walletCards(fakeNode(later).client, addressesOf(fakeToken(254)), getAddress(ME)).then(
    (r) => `${r.cards.length} cards`,
    (e) => `threw: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`,
  );
  const token = fakeToken(255);
  const world = walletWorld(20, token);
  world.down = true;
  const { client } = fakeNode(world);
  let failed = "";
  const got = await C.walletCards(client, addressesOf(token), getAddress(ME)).then(
    (r) => `${r.cards.length} cards`,
    (e) => ((failed = e instanceof Error ? e.message.split("\n")[0] : String(e)), null),
  );
  check(
    "a node that fails a read's second eth_call drops no card (there is none); one that fails it all fails the read, never a list with cards missing",
    partial === "20 cards" && got === null && failed !== "",
    `second call refused: ${partial}; all refused: ${failed || got}`,
  );
  check(
    "earnedNotClaimed never counts a share below zero (a debt above weight × accIMDPerWeight comes only from reads of two blocks)",
    C.earnedNotClaimed(5n, E18, [
      { staked: true, weight: 1, debt: 3n * E18 },
      { staked: true, weight: 2, debt: E18 },
    ]) === 6n && C.imd4(C.earnedNotClaimed(0n, E18, [{ staked: true, weight: 1, debt: 2n * E18 }])) === "0.0000",
  );
}
// The ledger heals: a node answered the first read without one Transfer, older than the blocks every read takes
// again. balanceOf counts one card more than the logs and ownerOf confirm, so the ledger is read again from
// fromBlock in the same call (and not again within the minute).
{
  const token = fakeToken(256);
  const world = walletWorld(3, token);
  world.hidden = new Set([2]);
  world.hideReads = 1;
  const { client, counts } = fakeNode(world);
  const a = addressesOf(token);
  const healed = await C.walletCards(client, a, getAddress(ME));
  const logsFirst = counts.logs;
  world.head += 5n;
  const later = await C.walletCards(client, a, getAddress(ME));
  check(
    "the ledger heals in-session: balanceOf 3 against 2 confirmed cards reads the Transfer logs again from fromBlock, and the missing card is there",
    healed.cards.map((c) => c.id).join() === "1,2,3" && logsFirst === 4 && later.cards.map((c) => c.id).join() === "1,2,3" && counts.logs === 6,
    `cards ${healed.cards.map((c) => `#${c.id}`).join(", ")}; ${logsFirst} log reads (two, then two from fromBlock), ${counts.logs - logsFirst} on the next poll`,
  );
}
// A reorganised mint: the gallery's stage read says NotMinted for an id the Minted logs gave; the id leaves the
// minted cards (and the page) instead of waiting for a stage forever, and a real mint of it brings it back.
{
  const token = fakeToken(257);
  const world = walletWorld(3, token);
  const { client } = fakeNode(world);
  const a = addressesOf(token);
  const before = (await C.mintedCards(client, a)).map((r) => r.id).join();
  world.owner.delete(3);
  world.mints = world.mints.filter((m) => m.id !== 3);
  const page = await C.stagesOf(client, a, [3, 2, 1]);
  const after = (await C.mintedCards(client, a)).map((r) => r.id).join();
  world.owner.set(3, getAddress(ME));
  world.mints.push({ id: 3, miner: getAddress(ME), block: world.head + 3n });
  world.head += 5n;
  const back = (await C.mintedCards(client, a)).map((r) => r.id).join();
  check(
    "a phantom mint (stageOf reverts NotMinted) is dropped from the minted cards and the page; a real mint of the id brings it back",
    before === "3,2,1" && page.gone.join() === "3" && page.stages.get(1) === 0 && page.stages.get(2) === 0 && !page.stages.has(3) && after === "2,1" && back === "3,2,1",
    `minted ${before} -> stages of 3,2,1 gone [${page.gone.join()}] -> minted ${after} -> after a real mint of #3: ${back}`,
  );
  world.down = true;
  const failed = await C.stagesOf(client, a, [2, 1]).then(
    () => false,
    () => true,
  );
  check("a stage read the node fails throws (the gallery keeps the stages it had), and drops nothing", failed && (await C.mintedCards(client, a)).length === 3);
}

// ------------------------------------------------------------------ the miner on the page (lib/miner/useMiner.ts)

// useMiner (and later useMineNumbers, lib/metamorph/live.ts) runs here without React or a browser. A few lines
// stand in for React's hooks (state by call order, effects after each render, every cleanup when the page is
// left), Workers are recorded, the GPU is a stand-in where a check needs one, and the timers are a clock the
// checks move by hand. The chain is a stand-in whose calls can be held or made to fail. The hook's callbacks
// read refs, so one render holds them; a render with new props is how the wallet changes, and a render reads
// the state.
const FAKE_REACT = `data:text/javascript,${encodeURIComponent(
  ["useState", "useRef", "useCallback", "useMemo", "useEffect"].map((n) => `export const ${n} = (...a) => globalThis.__fakeReact.${n}(...a);`).join("\n"),
)}`;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "react" && /\/lib\/(miner\/useMiner|metamorph\/live)\.ts$/.test(context.parentURL ?? "")) return { url: FAKE_REACT, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
const { useMiner } = await import("../lib/miner/useMiner.ts");
const { GpuMiner } = await import("../lib/miner/gpu/gpuMiner.ts");

console.log("\n== the miner on the page (lib/miner/useMiner.ts, without React)");

function renderHook(useHook, props) {
  const slots = [];
  let at = 0;
  let after = [];
  let alive = true;
  const same = (a, b) => !!a && !!b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
  const memo = (make, deps) => {
    const k = at++;
    if (!slots[k] || !same(slots[k].deps, deps)) slots[k] = { value: make(), deps };
    return slots[k].value;
  };
  const react = {
    useState(init) {
      const k = at++;
      if (!slots[k]) {
        const s = { value: typeof init === "function" ? init() : init };
        s.set = (x) => {
          if (alive) s.value = typeof x === "function" ? x(s.value) : x;
        };
        slots[k] = s;
      }
      return [slots[k].value, slots[k].set];
    },
    useRef(init) {
      const k = at++;
      return (slots[k] ??= { current: init });
    },
    useMemo: memo,
    useCallback: (fn, deps) => memo(() => fn, deps),
    useEffect(fn, deps) {
      const k = at++;
      const was = slots[k];
      if (was && same(was.deps, deps)) return;
      const slot = { effect: true, deps, cleanup: was?.cleanup };
      slots[k] = slot;
      after.push(() => {
        slot.cleanup?.();
        slot.cleanup = fn() ?? undefined;
      });
    },
  };
  const h = {
    result: null,
    render(next = props) {
      props = next;
      globalThis.__fakeReact = react;
      at = 0;
      after = [];
      h.result = useHook(props);
      for (const run of after) run();
      return h.result;
    },
    get state() {
      return h.render().state;
    },
    get notes() {
      return h.render().state.log.map((l) => l.text);
    },
    unmount() {
      for (const s of slots) if (s?.effect) s.cleanup?.();
      alive = false;
    },
  };
  h.render();
  return h;
}

/// Timers the checks move by hand: advance(ms) runs every timer due by then, in order, letting the promises
/// settle between them.
function handClock() {
  let now = 0;
  let seq = 0;
  const timers = new Map();
  const add = (fn, ms, every) => {
    const id = ++seq;
    timers.set(id, { at: now + Math.max(0, Number(ms) || 0), fn, every });
    return id;
  };
  const drop = (id) => void timers.delete(id);
  return {
    timers: { setTimeout: (fn, ms) => add(fn, ms, 0), setInterval: (fn, ms) => add(fn, ms, Math.max(1, Number(ms) || 1)), clearTimeout: drop, clearInterval: drop },
    intervals: () => [...timers.values()].filter((t) => t.every).length,
    async advance(ms) {
      const until = now + ms;
      for (;;) {
        await settled();
        let next = null;
        for (const [id, t] of timers) if (t.at <= until && (!next || t.at < next.t.at)) next = { id, t };
        if (!next) break;
        now = next.t.at;
        if (next.t.every) next.t.at += next.t.every;
        else timers.delete(next.id);
        next.t.fn();
      }
      now = until;
      await settled();
    },
  };
}
const settled = async () => {
  for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r));
};

/// A Worker that records what it is told; the checks post its finds.
class FakeWorker {
  static made = [];
  constructor() {
    this.inbox = [];
    this.dead = false;
    this.onmessage = null;
    FakeWorker.made.push(this);
  }
  postMessage(m) {
    this.inbox.push(m);
  }
  terminate() {
    this.dead = true;
  }
}
const gpuStarts = [];
const starts = () => FakeWorker.made.flatMap((w) => w.inbox.filter((m) => m.type === "start").map((m) => m.job));
/// The engines' activity from a mark on: workers made, jobs handed to the CPU or to the GPU.
const mark = () => ({ made: FakeWorker.made.length, cpu: starts().length, gpu: gpuStarts.length });
const since = (m) => ({ made: FakeWorker.made.length - m.made, cpu: starts().length - m.cpu, gpu: gpuStarts.length - m.gpu });
const quiet = (x) => x.made === 0 && x.cpu === 0 && x.gpu === 0;
const shown = (x) => `${x.made} worker(s) made, ${x.cpu} CPU job(s), ${x.gpu} GPU job(s)`;

const MD_SI = getAddress("0x00000000000000000000000000000000000000d5");
const A_SI = { chainId: 31337, metamorph: MD_SI, token: getAddress("0x00000000000000000000000000000000000000d6"), cocoon: COCOON };
const POLL = 3000;
const JOB_READ = "multicall:prevWork,effectiveTarget,bits,mintPrice,getBlockNumber,getChainId";
const PREP_READ = "multicall:mintPrice,balanceOf,allowance";
const txOf = (n) => `0x${n.toString(16).padStart(64, "0")}`;

/// The chain as the hook reads it, one bit, a wallet with PUPATE and the allowance; a call can be held until
/// released, or fail once. The wallet's sends are recorded and get the hashes 0x…01, 0x…02, …
function chainStandIn() {
  const s = {
    prevWork: PREV,
    target: MAX >> 1n,
    block: 1_000n,
    receipts: new Map(),
    minted: [],
    sent: [],
    sendError: null,
    receiptError: null,
    held: new Map(),
    fails: new Map(),
    /// mineableSeats(): the vault's one seat, or none (the commons).
    open: [1n],
  };
  const answer = (fn) =>
    ({
      prevWork: s.prevWork,
      effectiveTarget: s.target,
      bits: 1,
      mintPrice: PRICE1,
      getBlockNumber: s.block,
      getChainId: 31337n,
      balanceOf: 10n ** 24n,
      allowance: maxUint256,
      dutiesDue: [false, false, false],
      DOMAIN: keccak256(toBytes("Metamorph MD work v1")),
      anchorHash: `0x${"5a".repeat(32)}`,
      mineableSeats: s.open,
      tokenURI: "data:,",
    })[fn];
  const gate = async (name) => {
    const h = s.held.get(name);
    if (h) await h.promise;
    const e = s.fails.get(name);
    if (e) {
      s.fails.delete(name);
      throw e;
    }
  };
  const client = {
    multicall: async ({ contracts }) => {
      await gate(`multicall:${contracts.map((c) => c.functionName).join(",")}`);
      return contracts.map((c) => answer(c.functionName));
    },
    readContract: async ({ functionName }) => {
      await gate(functionName);
      return answer(functionName);
    },
    estimateContractGas: async () => {
      await gate("estimate");
      return 200_000n;
    },
    waitForTransactionReceipt: async ({ hash }) => {
      await gate("wait");
      if (s.receiptError) throw s.receiptError;
      const r = s.receipts.get(hash);
      if (!r) throw new Error("no receipt in the stand-in");
      return r;
    },
    getTransactionReceipt: async ({ hash }) => {
      await gate("receipt");
      const r = s.receipts.get(hash);
      if (!r) throw new Error(`Transaction receipt with hash "${hash}" could not be found.`);
      return r;
    },
    getContractEvents: async () => {
      await gate("events");
      return s.minted;
    },
  };
  const write = async (call) => {
    s.sent.push(call);
    await gate("send");
    if (s.sendError) throw s.sendError;
    return txOf(s.sent.length);
  };
  const hold = (name) => {
    let release;
    const promise = new Promise((r) => (release = r));
    s.held.set(name, { promise });
    return () => {
      s.held.delete(name);
      release();
    };
  };
  return { s, client, write, hold, link: { client, addresses: A_SI, write, wallet: ME } };
}

/// A nonce that solves a job at one bit, and its proof.
function solve(job) {
  for (let n = 1n; ; n++) {
    const work = J.workOf(job, n);
    if (J.meets(job, work)) return { nonce: toHex(n, { size: 32 }), digest: work };
  }
}
/// A worker reports a find for the job it was given last.
function find() {
  const job = starts().at(-1);
  const hit = solve(job);
  FakeWorker.made.findLast((w) => !w.dead).onmessage({ data: { type: "found", worker: 0, jobId: job.id, ...hit } });
  return { job, ...hit };
}
const mintedLog = (f, id, seat = 1376n, round = 1) => logOf(metamorphAbi, MD_SI, "Minted", { id, seat, round, edition: Number(id), miner: ME, work: f.digest, gilt: false, price: PRICE1, epoch: 1 });
const receiptOf = (hash, block, logs, status = "success") => ({ status, logs, blockNumber: block, transactionHash: hash });

const realTimers = { setTimeout, clearTimeout, setInterval, clearInterval };
const realGpu = { probe: GpuMiner.probe, selfTest: GpuMiner.selfTest, start: GpuMiner.prototype.start, stop: GpuMiner.prototype.stop, setPower: GpuMiner.prototype.setPower };
const clock = handClock();
globalThis.window = clock.timers;
Object.assign(globalThis, clock.timers);
globalThis.Worker = FakeWorker;
Object.defineProperty(navigator, "hardwareConcurrency", { value: 3, configurable: true });
GpuMiner.prototype.start = (job) => void gpuStarts.push(job);
GpuMiner.prototype.stop = () => {};
GpuMiner.prototype.setPower = () => {};
/// A live run on the stand-in chain, its first job handed to the engines.
async function liveRun(c, opts = {}) {
  FakeWorker.made = [];
  const h = renderHook(useMiner, c.link);
  if (opts.auto === false) {
    h.result.setAuto(false);
    h.render();
  }
  h.result.start({ live: true, wallet: ME });
  await clock.advance(0);
  return h;
}

try {
  // 1. The live run ends with the page. Left while the start's first reads, a poll's read, a mint's estimate
  // or its receipt were on their way, or while the GPU's self-test ran in a practice run: nothing is mined,
  // polled or sent after it.
  {
    FakeWorker.made = [];
    const c = chainStandIn();
    const release = c.hold(JOB_READ);
    const h = renderHook(useMiner, c.link);
    h.result.start({ live: true, wallet: ME });
    await clock.advance(0);
    const m0 = mark();
    h.unmount();
    release();
    await clock.advance(4 * POLL);
    const x = since(m0);
    check("left during the start's first reads: no engine, no poll, no wallet after it", quiet(x) && clock.intervals() === 0 && c.s.sent.length === 0, shown(x));
  }
  {
    const c = chainStandIn();
    const h = await liveRun(c);
    const ran = starts().length > 0;
    const release = c.hold(JOB_READ);
    await clock.advance(POLL);
    const m0 = mark();
    h.unmount();
    c.s.prevWork = WORK;
    release();
    await clock.advance(4 * POLL);
    const x = since(m0);
    check("left during a poll's read (and someone minted meanwhile): the read is dropped, nothing is dispatched", ran && quiet(x) && clock.intervals() === 0, shown(x));
  }
  {
    const c = chainStandIn();
    const h = await liveRun(c);
    const release = c.hold("estimate");
    find();
    await clock.advance(0);
    const m0 = mark();
    h.unmount();
    release();
    await clock.advance(10 * POLL);
    const x = since(m0);
    check("left while a mint was prepared: the wallet never opens, and nothing mines after it", c.s.sent.length === 0 && quiet(x) && clock.intervals() === 0, `${c.s.sent.length} send(s); ${shown(x)}`);
  }
  {
    const c = chainStandIn();
    const h = await liveRun(c);
    const release = c.hold("wait");
    const f = find();
    await clock.advance(0);
    c.s.receipts.set(txOf(1), receiptOf(txOf(1), c.s.block, [mintedLog(f, 3n)]));
    c.s.prevWork = f.digest;
    const m0 = mark();
    h.unmount();
    release();
    await clock.advance(10 * POLL);
    const x = since(m0);
    check("left while the mint's receipt was awaited: the receipt comes, and nothing is read or mined after it", c.s.sent.length === 1 && quiet(x) && clock.intervals() === 0, shown(x));
  }
  {
    FakeWorker.made = [];
    let finish;
    GpuMiner.probe = async () => ({ ok: true, name: "a stand-in GPU" });
    GpuMiner.selfTest = () => new Promise((r) => (finish = r));
    const h = renderHook(useMiner, null);
    await clock.advance(0);
    h.result.start({ miner: ME });
    void h.result.setEngine("gpu");
    await clock.advance(0);
    const testing = !!finish && h.state.gpu.selfTest?.running === true;
    const m0 = mark();
    h.unmount();
    finish({ ok: true, name: "a stand-in GPU", rate: 5e7, batch: 1 << 20, detail: "", dispatchMs: 10, dispatches: 50, compileMs: 5 });
    await clock.advance(4 * POLL);
    const x = since(m0);
    check("a practice run left while the GPU's self-test ran: the GPU is not switched to or handed a job after it", testing && quiet(x) && clock.intervals() === 0, shown(x));
    Object.assign(GpuMiner, { probe: realGpu.probe, selfTest: realGpu.selfTest });
  }

  // 2. An unknown outcome is never sent again, and nothing is mined on its prevWork until the chain shows it.
  {
    const c = chainStandIn();
    c.s.fails.set(PREP_READ, new Error("fetch failed"));
    const h = await liveRun(c);
    const f = find();
    c.s.receipts.set(txOf(1), receiptOf(txOf(1), c.s.block, [mintedLog(f, 4n)]));
    await clock.advance(5000);
    const n = h.notes;
    check(
      "a network error before the wallet is asked is tried once more: one send, one card",
      c.s.sent.length === 1 && n.some((l) => l.startsWith("the network stumbled: fetch failed · trying once more")) && n[0] === "Metamorph.md #4 is yours · seat identity.md #1376 · mining the next one",
      n.slice(0, 4).join(" | "),
    );
    h.unmount();
  }
  {
    const c = chainStandIn();
    c.s.fails.set(PREP_READ, new Error("fetch failed"));
    const h = await liveRun(c);
    find();
    await clock.advance(0);
    c.s.fails.set(PREP_READ, new Error("429 too many requests"));
    await clock.advance(5000);
    const st = h.state;
    const n = h.notes;
    check(
      "two network errors before the wallet is asked: nothing is sent, and the hash waits for the Mint button while the run is on",
      c.s.sent.length === 0 && !!st.pending?.live && st.running && !st.minting && n.some((l) => l.startsWith("the mint did not go through: 429 too many requests · your hash waits for Mint it now")),
      `${c.s.sent.length} send(s); pending ${!!st.pending?.live}; running ${st.running}; ${n.slice(0, 3).join(" | ")}`,
    );
    h.unmount();
  }
  {
    const c = chainStandIn();
    c.s.sendError = new Error("the wallet's connection dropped");
    const h = await liveRun(c);
    const f = find();
    await clock.advance(0);
    const m0 = mark();
    await clock.advance(5 * POLL);
    const held = since(m0);
    const st = h.state;
    const watching = st.minting && st.sent && c.s.sent.length === 1 && quiet(held) && h.notes.includes("the wallet did not say whether the mint was sent: the wallet's connection dropped · watching for it");
    c.s.block = f.job.anchor + 50n;
    await clock.advance(POLL);
    const atFifty = since(m0).cpu === 0;
    c.s.block = f.job.anchor + 51n;
    await clock.advance(POLL);
    const after = since(m0);
    check(
      "a wallet that fails once asked: never asked again, nothing mined on that prevWork while the mint could land; past the window, mining goes on",
      watching && atFifty && c.s.sent.length === 1 && h.notes[0] === M.LINES.unseen && after.cpu > 0 && starts().at(-1).anchor === c.s.block - 1n,
      `${c.s.sent.length} send(s); held: ${shown(held)}; then ${after.cpu} CPU job(s)`,
    );
    h.unmount();
  }
  {
    const c = chainStandIn();
    c.s.sendError = new Error("the wallet's connection dropped");
    const h = await liveRun(c);
    const f = find();
    await clock.advance(POLL);
    const m0 = mark();
    c.s.prevWork = f.digest;
    c.s.minted = [{ args: { id: 5n, seat: 1376n, round: 1, edition: 5, miner: ME, work: f.digest, gilt: true, price: PRICE1, epoch: 1 } }];
    await clock.advance(POLL);
    const n = h.notes;
    check(
      "the same, and the mint did land: prevWork shows its proof, its card is found again and told, mining goes on",
      c.s.sent.length === 1 && n.includes("Metamorph.md #5 is yours · seat identity.md #1376 · gilt · mining the next one") && h.state.lastMint?.id === 5 && since(m0).cpu > 0,
      n.slice(0, 3).join(" | "),
    );
    h.unmount();
  }
  {
    const c = chainStandIn();
    c.s.receiptError = new Error("Timed out while waiting for the transaction to be confirmed.");
    const h = await liveRun(c);
    const f = find();
    await clock.advance(0);
    const m0 = mark();
    await clock.advance(4 * POLL);
    const held = since(m0);
    const watching = h.state.minting && quiet(held) && h.notes.some((l) => l.startsWith("the mint was sent but its block is not seen yet: ") && l.endsWith(" · watching for it"));
    c.s.receipts.set(txOf(1), receiptOf(txOf(1), c.s.block, [mintedLog(f, 6n), dutyRun(MD_SI, 0, 0n)]));
    c.s.prevWork = f.digest;
    await clock.advance(POLL);
    const n = h.notes;
    check(
      "a receipt that does not come: the hash is watched, nothing is sent again or mined meanwhile; the late receipt gives the card and its duty line",
      watching && c.s.sent.length === 1 && n.includes("Metamorph.md #6 is yours · seat identity.md #1376 · mining the next one") && n.includes("your mint also flushed the vault's tax") && since(m0).cpu > 0,
      `held: ${shown(held)}; ${n.slice(0, 3).join(" | ")}`,
    );
    h.unmount();
  }

  // 3. Stop with a hash waiting for the Mint button: the hash goes with the run, said so, and the page offers
  // Start and the practice run again (nothing is pending, nothing runs).
  {
    const c = chainStandIn();
    const h = await liveRun(c, { auto: false });
    find();
    await clock.advance(0);
    const waiting = !!h.state.pending?.live;
    h.result.stop();
    const st = h.state;
    check(
      "Stop with a live hash waiting: the hash is dropped with the run, and nothing is left pending",
      waiting && !st.pending && !st.running && !st.minting && h.notes[0] === "stopped · the waiting hash was dropped" && c.s.sent.length === 0,
      h.notes[0],
    );
    h.unmount();
  }
  {
    const c = chainStandIn();
    const h = await liveRun(c);
    const release = c.hold("wait");
    const f = find();
    await clock.advance(0);
    h.result.stop();
    const m0 = mark();
    c.s.receipts.set(txOf(1), receiptOf(txOf(1), f.job.anchor + 2n, [], "reverted"));
    c.s.prevWork = WORK;
    release();
    await clock.advance(4 * POLL);
    const n = h.notes;
    check(
      "Stop while a mint is on its way: the mint finishes; its line does not promise mining again, and nothing mines after it",
      n[0] === "someone minted first, your hash expired" && n.includes("stopped") && quiet(since(m0)) && !h.state.minting,
      n.slice(0, 3).join(" | "),
    );
    h.unmount();
  }

  // 4. A reverted receipt is told apart by the chain.
  {
    const job = { anchor: 100n, prevWork: PREV };
    check(
      "revertReason: mined past the window is late (BadAnchor), else prevWork moved is the lost race, else another refusal; unsureMint waits out the window's last block",
      M.revertReason(job, 151n, PREV) === "late" &&
        M.revertReason(job, 150n, PREV) === "refused" &&
        M.revertReason(job, 150n, WORK) === "lost" &&
        M.revertReason(job, 150n, null) === "refused" &&
        M.unsureMint(job, WORK, { prevWork: WORK, block: 120n }) === "landed" &&
        M.unsureMint(job, WORK, { prevWork: `0x${"33".repeat(32)}`, block: 120n }) === "moved" &&
        M.unsureMint(job, WORK, { prevWork: PREV, block: 150n }) === "open" &&
        M.unsureMint(job, WORK, { prevWork: PREV, block: 151n }) === "late",
    );
    const said = [];
    for (const [block, moved] of [
      [2n, true],
      [51n, false],
      [2n, false],
    ]) {
      const c = chainStandIn();
      const h = await liveRun(c);
      const anchor = starts().at(-1).anchor;
      c.s.receipts.set(txOf(1), receiptOf(txOf(1), anchor + block, [], "reverted"));
      if (moved) c.s.prevWork = WORK;
      find();
      await clock.advance(POLL);
      said.push(h.notes.find((l) => l.endsWith("· mining again")));
      h.unmount();
    }
    check(
      "a reverted mint: prevWork moved reads as someone minted first; mined past the window as out of time; else as reverted",
      said[0] === M.LINES.lost && said[1] === "the mint ran out of time (the hash was older than 50 blocks) · mining again" && said[2] === "the mint reverted · mining again",
      said.join(" | "),
    );
  }

  // 5 and 6. Stop and halt put the readings back on the chain's; a disconnect or another wallet stops the run
  // at once, before any poll.
  {
    const c = chainStandIn();
    const h = await liveRun(c);
    const during = h.state;
    h.result.stop();
    const after = h.state;
    check("Stop: the readings leave the job (no live price, not live), so the page shows the chain's own", during.live && during.price === PRICE1 && !after.live && after.price === null && !after.running);
    h.unmount();
  }
  for (const [wallet, line] of [
    [null, M.LINES.walletGone],
    [THEM, M.LINES.walletChanged],
  ]) {
    const c = chainStandIn();
    const h = await liveRun(c);
    const m0 = mark();
    h.render({ ...c.link, wallet });
    const st = h.state;
    await clock.advance(2 * POLL);
    check(
      `${wallet ? "another wallet" : "a disconnect"} stops the live run at once, before any poll: "${line}"`,
      !st.running && !st.live && st.price === null && h.notes[0] === line && clock.intervals() === 0 && quiet(since(m0)),
      h.notes[0],
    );
    h.unmount();
  }

  // 7. The commons: with mineableSeats() empty (the vault holds no seat) the live run goes on as on any other
  // day. The job is read and handed to the engines, nothing halts, a find is minted, and the card's seat is
  // whatever the receipt says (the contract drew it from the whole collection: seat 777, round 0).
  {
    const c = chainStandIn();
    c.s.open = [];
    const h = await liveRun(c);
    const st = h.state;
    const job = starts().at(-1);
    // Without a job there is no find to post: the check then fails on its own terms, and the run goes on.
    if (job) {
      const f = find();
      c.s.receipts.set(txOf(1), receiptOf(txOf(1), c.s.block, [mintedLog(f, 9n, 777n, 0)]));
      c.s.prevWork = f.digest;
    }
    await clock.advance(POLL);
    const n = h.notes;
    check(
      "the commons: mineableSeats() empty, and the live run still gets its job, mines it and mints the find; the card's seat is the receipt's (777, round 0)",
      st.running && st.live && !!job?.live && c.s.sent.length === 1 && n.includes("Metamorph.md #9 is yours · seat identity.md #777 · mining the next one") && h.state.lastMint?.seat === 777 && !n.includes(M.LINES.nothing),
      `running ${st.running}, live ${st.live}, ${c.s.sent.length} send(s); ${n.slice(0, 3).join(" | ")}`,
    );
    h.unmount();
  }
} finally {
  Object.assign(globalThis, realTimers);
  delete globalThis.window;
  delete globalThis.Worker;
  delete navigator.hardwareConcurrency;
  Object.assign(GpuMiner, { probe: realGpu.probe, selfTest: realGpu.selfTest });
  Object.assign(GpuMiner.prototype, { start: realGpu.start, stop: realGpu.stop, setPower: realGpu.setPower });
}

// ------------------------------------------------------------------ the seat drawing (lib/seat.ts)

console.log("\n== the seat drawing (lib/seat.ts against script/art/mirror.mjs, the contract's twin)");
{
  const { traits } = await import("../lib/seat.ts");
  const { seatTraits, TONES } = await import(pathToFileURL(join(REPO, "script", "art", "mirror.mjs")).href);
  const TENTHS = ["span", "rise", "reach", "drop", "tilt"];
  const differences = (seat) => {
    const s = traits(seat);
    const m = seatTraits(seat);
    const fields = [
      ["veins", s.veins, m.veins],
      ["spots", s.spots, m.spots],
      ["dots", s.dots, m.dots],
      ["rings", s.rings, m.rings],
      ["tone", s.tone, TONES[m.tone]],
      // The site's number is the chain's tenths divided by ten: the same double, nothing rounded twice.
      ...TENTHS.map((k) => [k, s[k], Number(m[k]) / 10]),
    ];
    return fields.filter(([, x, y]) => x !== y).map(([k, x, y]) => `seat ${seat} ${k}: site ${x}, chain ${y}`);
  };
  const first = Array.from({ length: 64 }, (_, i) => differences(i + 1)).flat();
  check(
    "traits(seat) is the contract's seatTraits for seats 1..64: veins, spots, dots, rings and the tone, and span, rise, reach, drop and tilt as its tenths / 10",
    first.length === 0,
    first.slice(0, 3).join("; "),
  );
  // Past the range where the old float product (seat × 2654435761) stays exact, up to the largest seat a card
  // can name (a uint32).
  const far = [1376, 9_999, 3_400_000, 123_456_789, 2 ** 32 - 1].flatMap(differences);
  check("traits(seat) equals the chain for seats past the first 64, up to 2^32 − 1", far.length === 0, far.slice(0, 3).join("; "));
}

// ------------------------------------------------------------------ the mine, in numbers (lib/metamorph/live.ts)

console.log("\n== the mine, in numbers (lib/metamorph/live.ts)");
const L = await import("../lib/metamorph/live.ts");
{
  // The arithmetic, on a scenario: epoch 5 (1,234 minted), the price 50,000 × 1.25^4 as the contract steps it,
  // 20 bits, 12 mints in the last hour.
  let price5 = 50_000n * E18;
  for (let e = 1; e < 5; e++) price5 = (price5 * 125n) / 100n;
  const text = L.numbersText({ minted: 1234, epoch: 5, price: price5, bits: 20, lastHour: 12 });
  const want = { minted: "1,234", epoch: "5", price: "122,070 PUPATE", difficulty: "≈ 1.0M hashes", bits: "20 bits", rate: "3.5 kH/s", percent: "37.0%" };
  check(
    "the figures of a scenario: 1,234 minted, epoch 5 at 122,070 PUPATE, ≈ 1.0M hashes at 20 bits, 12 mints in the hour = 12 × 2^20 ÷ 3,600 = 3.5 kH/s, 37.0%",
    JSON.stringify(text) === JSON.stringify(want) && L.networkRate(12, 20) === (12 * 2 ** 20) / 3600,
    JSON.stringify(text),
  );
  check(
    "no mint in the hour: no network rate, a dash; under one hash a second (10 mints at 3 bits) it says so rather than 0 H/s",
    L.networkRate(0, 20) === null &&
      L.numbersText({ minted: 9, epoch: 1, price: 50_000n * E18, bits: 20, lastHour: 0 }).rate === "—" &&
      L.numbersText({ minted: 10, epoch: 1, price: 50_000n * E18, bits: 3, lastHour: 10 }).rate === "< 1 H/s" &&
      L.fmtNetworkRate(1) === "1 H/s",
  );
  const one = L.numbersText({ minted: 0, epoch: 1, price: 50_000n * E18, bits: 1, lastHour: 0 });
  check("one bit is \"1 bit\" (a local chain at MIN_BITS=1), ≈ 2 hashes", one.bits === "1 bit" && one.difficulty === "≈ 2 hashes", `${one.difficulty} · ${one.bits}`);
  const pct = [[0, "0%"], [1, "0.03%"], [33, "0.99%"], [34, "1.0%"], [1667, "50.0%"], [3332, "99.9%"], [3333, "100%"]];
  const pctOff = pct.filter(([n, s]) => L.fmtPercent(n) !== s).map(([n]) => `${n}: ${L.fmtPercent(n)}`);
  check("percent minted, rounded down to what it shows: 0%, 0.03%, 0.99%, 1.0%, 50.0%, 99.9%, and 100% only at 3,333", pctOff.length === 0, pctOff.join(", "));
  const MINT = 1_800_000_000;
  const at = (s) => (MINT + s) * 1000;
  const since = [
    [L.secondsSince({ lastMintAt: null, skew: 0 }, at(42)), null, "—"],
    [L.secondsSince({ lastMintAt: MINT, skew: 0 }, at(42) + 999), 42, "42 s"],
    [L.secondsSince({ lastMintAt: MINT, skew: 0 }, at(252)), 252, "4 min 12 s"],
    [L.secondsSince({ lastMintAt: MINT, skew: 0 }, at(7500)), 7500, "2 h 5 min"],
    [L.secondsSince({ lastMintAt: MINT, skew: 0 }, at(273_600)), 273_600, "3 d 4 h"],
    [L.secondsSince({ lastMintAt: MINT, skew: 100 }, at(42)), 142, "2 min 22 s"],
    [L.secondsSince({ lastMintAt: MINT, skew: 0 }, at(-30)), 0, "0 s"],
  ];
  const sinceOff = since.filter(([s, n, t]) => s !== n || L.fmtSince(s) !== t).map(([s]) => `${s}: ${L.fmtSince(s)}`);
  check(
    "seconds since the last mint: a dash before the first, 42 s, 4 min 12 s, 2 h 5 min, 3 d 4 h; on the chain's clock where it runs ahead; never below zero",
    sinceOff.length === 0,
    sinceOff.join(", "),
  );
  const T = 1_900_000_000;
  const byId = new Map([[1, T - 5000], [2, T - 4000], [3, T - 3600], [4, T - 3599], [5, T - 100], [6, T - 1]]);
  const full = L.hourWalk(6, T, (id) => byId.get(id));
  const part = L.hourWalk(6, T, (id) => (id >= 5 ? byId.get(id) : undefined));
  const small = L.hourWalk(6, T, (id) => (id >= 5 ? byId.get(id) : undefined), 2);
  check(
    "the hour's walk: from the newest card down, a card exactly an hour old ends it (3 in the hour); one it does not know stops it and names the ids from there down",
    full.count === 3 && full.missing.length === 0 && part.count === 2 && part.missing.join() === "4,3,2,1" && small.missing.join() === "4,3" && L.hourWalk(0, T, () => undefined).count === 0,
    `${full.count}; ${part.count} + [${part.missing}]`,
  );
}

/// The chain as loadMine reads it: the contract's numbers, Multicall3's block and timestamp, each card's
/// mintedAt. Every multicall is recorded by the functions it asked for; one can be held until released, or
/// fail.
function numbersWorld(over = {}) {
  const w = {
    minted: 0,
    epoch: 1,
    price: PRICE1,
    bits: 20,
    lastMintAt: 1_000_000,
    open: [1376n],
    block: 100n,
    stamp: 1_000_000n,
    times: new Map(),
    reads: [],
    hold: null,
    fail: 0,
    ...over,
  };
  w.cardReads = () => w.reads.filter((r) => r[0] === "cards");
  w.client = {
    async multicall({ contracts }) {
      w.reads.push(contracts.map((c) => c.functionName));
      if (w.fail > 0) {
        w.fail--;
        throw new Error("the node did not answer");
      }
      if (w.hold) await w.hold.promise;
      return contracts.map((c) => {
        switch (c.functionName) {
          case "totalMinted":
            return w.minted;
          case "epoch":
            return w.epoch;
          case "mintPrice":
            return w.price;
          case "bits":
            return w.bits;
          case "lastMintAt":
            return w.lastMintAt;
          case "mineableSeats":
            return w.open;
          case "getBlockNumber":
            return w.block;
          case "getCurrentBlockTimestamp":
            return w.stamp;
          case "cards": {
            const id = Number(c.args[0]);
            return [1376, 1, id, false, w.times.get(id) ?? 0, PRICE1, getAddress(ME), toHex(id, { size: 32 })];
          }
          default:
            throw new Error(`the stand-in has no ${c.functionName}`);
        }
      });
    },
  };
  /// A card minted at `t`, as the contract books it, in a block of its own.
  w.mint = (t) => {
    w.block++;
    w.minted++;
    w.times.set(w.minted, t);
    w.lastMintAt = t;
  };
  return w;
}
const numbersAt = (n) => ({ chainId: 31337, metamorph: getAddress(`0x${n.toString(16).padStart(40, "0")}`) });
const deferred = () => {
  let release;
  const promise = new Promise((r) => (release = r));
  return { promise, release };
};

{
  const T = 2_000_000_000;
  const ms = (s) => s * 1000;
  const a1 = numbersAt(0xe1);
  // Before the first mint: lastMintAt() is the deploy's time, and no card is read.
  const w = numbersWorld({ stamp: BigInt(T), lastMintAt: T - 50_000 });
  const n0 = await L.loadMine(w.client, a1, ms(T));
  check(
    "loadMine before the first mint: the figures as the contract gives them, no last mint (lastMintAt() is the deploy's time), nothing in the hour, one eth_call",
    n0.minted === 0 && n0.lastMintAt === null && n0.lastHour === 0 && n0.epoch === 1 && n0.price === PRICE1 && n0.bits === 20 && n0.mineable === 1 && n0.block === 100n && w.reads.length === 1 && w.reads[0].join() === "totalMinted,epoch,mintPrice,bits,lastMintAt,mineableSeats,getBlockNumber,getCurrentBlockTimestamp",
    w.reads.map((r) => r.join("+")).join(" | "),
  );
  // 70 cards over two hours, one every 100 s, the last 200 s ago: cards 37..70 are within the hour.
  for (let k = 1; k <= 70; k++) w.mint(T - 7200 + 100 * k);
  w.reads.length = 0;
  const n1 = await L.loadMine(w.client, a1, ms(T));
  check(
    "70 cards over two hours: 34 in the last hour (a card exactly an hour old is not), read in one eth_call of 64 card times after the numbers; the last mint is the newest card's",
    n1.minted === 70 && n1.lastHour === 34 && n1.lastMintAt === T - 200 && w.reads.length === 2 && w.cardReads().length === 1 && w.cardReads()[0].length === 64,
    `${n1.lastHour} in the hour, ${w.reads.length} eth_call(s)`,
  );
  w.reads.length = 0;
  const n2 = await L.loadMine(w.client, a1, ms(T + 1));
  check("the next reading reads no card again: each card's time is kept", n2.lastHour === 34 && w.reads.length === 1 && L.sameNumbers(n1, n2));
  w.mint(T + 10);
  w.stamp = BigInt(T + 10);
  w.reads.length = 0;
  const n3 = await L.loadMine(w.client, a1, ms(T + 10));
  check(
    "a new mint: one card read (the new one), 35 in the hour",
    n3.minted === 71 && n3.lastHour === 35 && w.cardReads().length === 1 && w.cardReads()[0].length === 1 && !L.sameNumbers(n2, n3),
  );
  w.reads.length = 0;
  const n4 = await L.loadMine(w.client, a1, ms(T + 1000));
  check("as the hour moves on, older cards leave it without a read: 25 in the hour 1,000 s later", n4.lastHour === 25 && w.cardReads().length === 0, `${n4.lastHour}`);
  // The chain's clock ahead of this machine's (a local chain moved on): the hour and the seconds since the
  // last mint run on the chain's. A node answers with its latest block's time, which stands still between
  // blocks: the lead is measured when the block is first seen and kept, so the seconds count on. Behind this
  // machine's clock (a block a few seconds old), the machine's.
  w.block++;
  w.stamp = BigInt(T + 10_000);
  const ahead = await L.loadMine(w.client, a1, ms(T + 1000));
  const still = await L.loadMine(w.client, a1, ms(T + 1003));
  w.block++;
  w.stamp = BigInt(T + 988);
  const behind = await L.loadMine(w.client, a1, ms(T + 1000));
  check(
    "the clock: the chain's where it runs ahead (skew 9,000 s, nothing in the hour, the last mint 9,990 s ago), kept while the block stands (3 s later, 9,993 s), this machine's once a block lags (skew 0)",
    ahead.skew === 9000 &&
      ahead.now === T + 10_000 &&
      ahead.lastHour === 0 &&
      L.secondsSince(ahead, ms(T + 1000)) === 9990 &&
      still.skew === 9000 &&
      L.secondsSince(still, ms(T + 1003)) === 9993 &&
      behind.skew === 0 &&
      behind.now === T + 1000 &&
      behind.lastHour === 25,
    `skew ${ahead.skew} / ${still.skew} / ${behind.skew}`,
  );
  // A card dropped with its block: totalMinted falls back, its time is forgotten, and the card that takes the
  // id later is read afresh.
  w.stamp = BigInt(T + 20);
  w.minted = 70;
  w.lastMintAt = T - 200;
  const n5 = await L.loadMine(w.client, a1, ms(T + 20));
  w.mint(T + 15);
  w.reads.length = 0;
  const n6 = await L.loadMine(w.client, a1, ms(T + 20));
  check(
    "a mint dropped with its block: the count falls back with totalMinted, and the card that takes its id is read again with its own time",
    n5.minted === 70 && n5.lastHour === 34 && n6.minted === 71 && n6.lastHour === 35 && w.cardReads().length === 1 && n6.lastMintAt === T + 15,
  );
  const empty = numbersWorld({ open: [] });
  check("no seat held: mineable 0 (the page's ready line: cards draw from the whole collection)", (await L.loadMine(empty.client, numbersAt(0xe2), ms(1_000_000))).mineable === 0);
}

// The hook, without React (renderHook's stand-in) and on the hand clock.
{
  const clock2 = handClock();
  globalThis.window = clock2.timers;
  try {
    const a1 = numbersAt(0xe3);
    const a2 = numbersAt(0xe4);
    const w = numbersWorld({ stamp: 1_000_000n });
    w.mint(999_000);
    const h = renderHook((p) => L.useMineNumbers(p.client, p.a), { client: w.client, a: a1 });
    await clock2.advance(0);
    const r0 = h.render().numbers;
    const first = w.reads.length;
    check("useMineNumbers reads at once: the reading of this token, before any poll", !!r0 && r0.minted === 1 && first >= 1 && clock2.intervals() === 1, `${first} eth_call(s)`);
    await clock2.advance(3000);
    const r1 = h.render().numbers;
    check("a poll every three seconds; the same figures keep the same reading, so the page does not render again", w.reads.length === first + 1 && r1 === r0);
    w.mint(1_000_000);
    await clock2.advance(3000);
    const r2 = h.render().numbers;
    check("a changed figure is a new reading", r2 !== r0 && r2.minted === 2 && r2.lastMintAt === 1_000_000);
    // A read held on the node: the polls meanwhile are skipped; a reload asked for then runs when it ends.
    w.hold = deferred();
    await clock2.advance(3000);
    const started = w.reads.length;
    await clock2.advance(6000);
    h.render().reload();
    await clock2.advance(0);
    const whileHeld = w.reads.length;
    const held = w.hold;
    w.hold = null;
    held.release();
    await clock2.advance(0);
    check(
      "a poll that finds a read on its way is skipped; a reload asked for meanwhile runs once it ends",
      whileHeld === started && w.reads.length === started + 1,
      `${started} → ${whileHeld} → ${w.reads.length}`,
    );
    const r3 = h.render().numbers;
    w.fail = 1;
    await clock2.advance(3000);
    const r4 = h.render().numbers;
    check("a failed read keeps the last reading", r4 === r3 && !!r4);
    // Another deployment: its reading is never mixed with this one's.
    const w2 = numbersWorld({ minted: 0 });
    w2.hold = deferred();
    h.render({ client: w2.client, a: a2 });
    await clock2.advance(0);
    const between = h.render().numbers;
    w2.hold.release();
    w2.hold = null;
    await clock2.advance(0);
    const other = h.render().numbers;
    check(
      "another token: nothing shows until its own reading lands, and the old one's poll stops",
      between === null && !!other && other.scope !== r4.scope && other.minted === 0 && clock2.intervals() === 1,
    );
    h.unmount();
    const after = w.reads.length + w2.reads.length;
    await clock2.advance(9000);
    check("the page left: no read and no timer after it", w.reads.length + w2.reads.length === after && clock2.intervals() === 0);
    const none = renderHook((p) => L.useMineNumbers(p.client, p.a), { client: null, a: null });
    await clock2.advance(6000);
    check("no client or no contracts (the preview): no reading, no read, no timer", none.render().numbers === null && clock2.intervals() === 0);
    none.unmount();
  } finally {
    delete globalThis.window;
  }
}

// ------------------------------------------------------------------ against the local stack

// The CPU worker's own 192 bytes and search (lib/miner/miner.worker.ts, run()), copied line for line: a Web
// Worker cannot be imported in Node, so this copy is what the contract is held against, next to the GPU
// engine's builder (gpu/words.ts) and viem's encoder (workOf).
function workerPreimage(job, nonceHex) {
  const buf = new Uint8Array(192);
  buf.set(hexBytes(job.domain), 0);
  let c = job.chainId;
  for (let i = 63; i >= 32 && c > 0; i--) {
    buf[i] = c & 255;
    c = Math.floor(c / 256);
  }
  buf.set(hexBytes(job.contract), 64 + 12);
  buf.set(hexBytes(job.folded), 96);
  buf.set(hexBytes(job.miner), 128 + 12);
  buf.set(hexBytes(nonceHex), 160);
  return buf;
}
function workerSearch(job, limit = 4_000_000) {
  const buf = workerPreimage(job, bytesHex(crypto.getRandomValues(new Uint8Array(32))));
  const nonce = buf.subarray(160, 192);
  nonce[24] = 0; // worker 0's lane
  for (let i = 25; i < 32; i++) nonce[i] = 0;
  for (let t = 1; t <= limit; t++) {
    let k = 31;
    while (k >= 25) {
      nonce[k] = (nonce[k] + 1) & 255;
      if (nonce[k] !== 0) break;
      k--;
    }
    const h = keccak_256(buf);
    const hi = ((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0;
    if (hi < job.targetHi || (hi === job.targetHi && ((h[4] << 24) | (h[5] << 16) | (h[6] << 8) | h[7]) >>> 0 < job.targetLo)) {
      return { nonce: bytesHex(nonce), digest: bytesHex(h), tries: t };
    }
  }
  throw new Error(`no hash under the target in ${limit} tries`);
}

const RPC = `http://127.0.0.1:${process.env.ANVIL_PORT || 8545}`;
const LOCAL = join(REPO, "site", "public", "addresses.local.json");
async function rpc(method, params = []) {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}
async function stackUp() {
  try {
    return Number(await rpc("eth_chainId")) === 31337 && existsSync(LOCAL) && !!JSON.parse(readFileSync(LOCAL, "utf8")).metamorph;
  } catch {
    return false;
  }
}

if (!(await stackUp())) {
  skip("live jobs and a real mint on the local stack", `nothing answers on ${RPC} with Metamorph MD: start it with node script/local/up.mjs`);
} else {
  try {
    await onTheStack();
  } catch (e) {
    check("the local stack's checks ran to the end", false, e instanceof Error ? e.message.split("\n")[0] : String(e));
  }
  try {
    await cardsOnTheStack();
  } catch (e) {
    check("the workspace's checks on the stack ran to the end", false, e instanceof Error ? e.message.split("\n")[0] : String(e));
  }
  try {
    await numbersOnTheStack();
  } catch (e) {
    check("the numbers' checks on the stack ran to the end", false, e instanceof Error ? e.message.split("\n")[0] : String(e));
  }
}

async function onTheStack() {
  console.log(`\n== the same, against the local stack (${RPC}, Metamorph MD at one bit)`);
  const a = JSON.parse(readFileSync(LOCAL, "utf8"));
  const pub = createPublicClient({ chain: foundry, transport: http(RPC), pollingInterval: 200 });
  // anvil's unlocked default accounts, signed by the node: #2 mines, #3 races it, #8 (the swarm share's
  // stand-in, 100M PUPATE after up.mjs) pays them their PUPATE.
  const MINER = getAddress("0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC");
  const RIVAL = getAddress("0x90F79bf6EB2c4f870365E785982E1f101E93b906");
  const FUNDER = getAddress("0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f");
  const walletOf = (account) => createWalletClient({ chain: foundry, transport: http(RPC), account });
  const writes = [];
  const writer = (account) => async (call) => {
    writes.push({ account, fn: call.functionName });
    return walletOf(account).writeContract(call);
  };
  const mined = async (hashPromise) => pub.waitForTransactionReceipt({ hash: await hashPromise });
  const md = { address: a.metamorph, abi: metamorphAbi };
  const view = (functionName, args) => pub.readContract({ ...md, functionName, args });
  const [seat] = await view("notedSeats");
  // Mints in quick succession quarter the target each (a GPU run on this stack leaves it at 20 bits and
  // more); silence eases it by four per DECAY_INTERVAL (360 s). The stack is a fixture, so its clock is
  // moved on until a CPU search in Node takes a moment again.
  const bitsNow = await view("bits");
  if (bitsNow > 12) {
    const wait = 360 * Math.ceil((bitsNow - 1) / 2) + 1;
    await rpc("evm_increaseTime", [wait]);
    await rpc("evm_mine");
    console.log(`        the stack was at ${bitsNow} bits after quick mints; its clock moved on ${wait} s, now ${await view("bits")}`);
  }

  // The job, field by field, against the contract's own views at the same block.
  const job1 = await J.liveJob(pub, a, MINER, 1);
  const [domain, prevWork, target, bits, price, anchorHash] = await Promise.all([
    view("DOMAIN"),
    view("prevWork"),
    view("effectiveTarget"),
    view("bits"),
    view("mintPrice"),
    view("anchorHash", [job1.anchor]),
  ]);
  check(
    "liveJob: DOMAIN, prevWork, effectiveTarget, bits and mintPrice as the contract reads them; chain 31337; the anchor is block - 1 with the contract's anchorHash",
    job1.live === true &&
      job1.domain === domain &&
      domain === keccak256(toBytes("Metamorph MD work v1")) &&
      job1.prevWork === prevWork &&
      job1.target === target &&
      job1.bits === bits &&
      job1.price === price &&
      job1.chainId === 31337 &&
      job1.anchor === job1.block - 1n &&
      job1.anchorHash === anchorHash &&
      BigInt(anchorHash) !== 0n &&
      isAddressEqual(job1.contract, a.metamorph) &&
      isAddressEqual(job1.miner, MINER),
    `block ${job1.block}, ${bits} bit(s), price ${Number(price / E18).toLocaleString("en-US")} PUPATE`,
  );
  check(
    "liveJob: folded = keccak256(abi.encode(anchorHash, prevWork)); the two words are effectiveTarget's top 64 bits",
    job1.folded === keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [anchorHash, prevWork])) && words64(job1) === target >> 192n,
  );

  // One proof four ways: the worker's bytes, the GPU engine's bytes, viem's encoder, the contract's workHash.
  let agree = 0;
  for (let i = 0; i < 8; i++) {
    const nonce = bytesHex(crypto.getRandomValues(new Uint8Array(32)));
    const w = bytesHex(keccak_256(workerPreimage(job1, nonce)));
    const g = bytesHex(keccak_256(preimage(job1, hexBytes(nonce))));
    const v = J.workOf(job1, BigInt(nonce));
    const c = await view("workHash", [job1.anchorHash, MINER, BigInt(nonce)]);
    if (w === g && g === v && v === c) agree++;
  }
  check("the CPU worker's 192 bytes, the GPU engine's, viem's abi.encode and the contract's workHash give one proof (8 random nonces)", agree === 8, `${agree} of 8`);

  // PUPATE for the two miners, their allowances back to zero (so a second run of this script starts as a
  // first visit does), and a buy through the Universal Router (the site's own swap) so the hook holds tax
  // and the next mint has a flush to run.
  for (const to of [MINER, RIVAL]) {
    await mined(walletOf(FUNDER).writeContract({ address: a.token, abi: erc20Abi, functionName: "transfer", args: [to, 1_000_000n * E18] }));
    await mined(walletOf(to).writeContract({ address: a.token, abi: erc20Abi, functionName: "approve", args: [a.metamorph, 0n] }));
  }
  const head = await pub.getBlock();
  const buy = buildSwap(a, true, E18 / 5n, 0n, head.timestamp + 1200n);
  await mined(walletOf(MINER).sendTransaction({ to: buy.to, data: buy.data, value: buy.value }));

  // A real mint from the miner's wallet, every step the page takes.
  const job2 = await J.liveJob(pub, a, MINER, 2);
  const hit = workerSearch(job2);
  check(
    "the worker's search finds a hash under the contract's two words, and it passes the whole target (viem's proof is the digest)",
    J.meets(job2, hit.digest) && J.workOf(job2, BigInt(hit.nonce)) === hit.digest,
    `${hit.tries} hash(es) at ${job2.bits} bit(s)`,
  );
  const dueBefore = await view("dutiesDue");
  let told = 0;
  const w0 = writes.length;
  const prep = await M.prepareMint(pub, a, { wallet: MINER, job: job2, nonce: BigInt(hit.nonce), work: hit.digest, write: writer(MINER), onApprove: () => told++ });
  check(
    "prepareMint: the first mint approves PUPATE once, to the maximum (the allowance was 0)",
    prep.ok && prep.approved && told === 1 && writes.slice(w0).map((x) => x.fn).join() === "approve" && (await pub.readContract({ address: a.token, abi: erc20Abi, functionName: "allowance", args: [MINER, a.metamorph] })) === maxUint256,
  );
  const [fl, bu, co] = dueBefore;
  check(
    "prepareMint: the limit is the estimate + 400,000 per due flush or burn + 1,000,000 for a due conversion, as dutiesDue() reads",
    prep.ok && prep.duties.flushDue === fl && prep.duties.burnDue === bu && prep.duties.convertDue === co && prep.gas === prep.estimate + 400_000n * (BigInt(fl) + BigInt(bu)) + (co ? 1_000_000n : 0n),
    prep.ok ? `dutiesDue (${fl}, ${bu}, ${co}); estimate ${prep.estimate} -> limit ${prep.gas}` : prep.why,
  );
  const minted0 = await view("totalMinted");
  const sim = await pub.simulateContract({ ...md, functionName: "mint", args: [job2.anchor, BigInt(hit.nonce)], account: MINER });
  check("eth_call mint(anchor, nonce) from the miner succeeds on the page's job: its folded word is the one workHash needs", sim.result === BigInt(minted0) + 1n, `returns id ${sim.result}`);
  const hash = await M.sendMint(writer(MINER), a, job2.anchor, BigInt(hit.nonce), prep.gas);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  const tx = await pub.getTransaction({ hash });
  const out = M.parseMintReceipt(receipt, a, MINER);
  check("the mint lands, sent with prepareMint's padded limit", receipt.status === "success" && tx.gas === prep.gas, `limit ${tx.gas}, used ${receipt.gasUsed}`);
  check(
    "parseMintReceipt on the real receipt: Minted for this miner, the noted seat, the find's proof",
    !!out.minted && !out.lost && out.minted.id === BigInt(minted0) + 1n && out.minted.seat === seat && out.minted.work === hit.digest && isAddressEqual(out.minted.miner, MINER),
  );
  if (fl) check("the flush that was due ran inside the mint, and the notes say so (DutyRun kind 0)", out.duties.some((d) => d.kind === 0) && M.outcomeLines(out).includes("your mint also flushed the vault's tax"));
  else skip("the flush inside the mint", "no flush was due before the mint");
  const lines1 = M.outcomeLines(out);
  console.log(`        block ${receipt.blockNumber}, tx ${hash}\n        ${lines1.join("\n        ")}`);
  const image = await M.cardImage(pub, a, out.minted.id);
  check("the card's image is read from tokenURI: an SVG data URI", typeof image === "string" && image.startsWith("data:image/svg+xml;base64,"), image ? `${image.length} characters` : "none");

  const job3 = await J.liveJob(pub, a, MINER, 3);
  check("after the mint the job moves: prevWork is the mint's proof, and jobChanged says so", job3.prevWork === hit.digest && J.jobChanged(job2, job3), `${job2.bits} -> ${job3.bits} bit(s)`);
  const status = await M.mintStatus(pub, a, MINER);
  check(
    "mintStatus: the price, the epoch, the difficulty, the wallet's PUPATE and its allowance",
    status.price === job3.price && status.epoch === 1 && status.bits === job3.bits && status.allowance === maxUint256 && status.balance === (await pub.readContract({ address: a.token, abi: erc20Abi, functionName: "balanceOf", args: [MINER] })),
  );

  // A burn, when the flush left the burn pot full enough: a second mint runs it and pays the miner.
  const [, burnDue] = await view("dutiesDue");
  if (burnDue) {
    const hitB = workerSearch(job3);
    const prepB = await M.prepareMint(pub, a, { wallet: MINER, job: job3, nonce: BigInt(hitB.nonce), work: hitB.digest, write: writer(MINER) });
    const rB = await pub.waitForTransactionReceipt({ hash: await M.sendMint(writer(MINER), a, job3.anchor, BigInt(hitB.nonce), prepB.gas) });
    const oB = M.parseMintReceipt(rB, a, MINER);
    const burn = oB.duties.find((d) => d.kind === 1);
    check(
      "a due burn runs inside the next mint: DutyRun kind 1 with the ETH Cocoon's Burned spent, and the spec's line",
      prepB.ok &&
        prepB.duties.burnDue &&
        prepB.gas === M.paddedGas(prepB.estimate, prepB.duties) &&
        !!burn &&
        burn.burned > 0n &&
        /^your mint also burned [\d.,]+ ETH of tax for the vault · you earned [\d.,]+ ETH$/.test(M.dutyLine(burn)),
      burn ? M.dutyLine(burn) : "no burn ran",
    );
  } else {
    skip("a burn inside a mint", "no burn is due after that flush (the burn pot under MIN_BURN, or within its spacing); the line is pinned on built logs above");
  }

  // A race in one block: two wallets with valid hashes for the same prevWork. One mint lands; the other
  // reverts in the same block and must read as the lost race, never as a card. The contract hashes a nonce
  // again against whatever prevWork it meets, and at a few bits a stale nonce solves the new job by chance
  // (one in 2^bits): the second mint of the block would land too, and a resend would read as a fresh
  // solution. So the two hashes are drawn until each one's proof, folded again with either winner's proof as
  // prevWork, has its top bit set, which no target takes (the easiest, one bit, is below 2^255): the race,
  // the refusal of the losing hash and the landed read of the winning one never turn on luck.
  const jobM = await J.liveJob(pub, a, MINER, 4);
  const jobR = await J.liveJob(pub, a, RIVAL, 5);
  const takenNowhere = (job, nonce, prev) => BigInt(J.workOf({ ...job, folded: J.fold(job.anchorHash, prev) }, BigInt(nonce))) > MAX >> 1n;
  let hitM;
  let hitR;
  let draws = 0;
  do {
    draws++;
    hitM = workerSearch(jobM);
    hitR = workerSearch(jobR);
  } while (![hitM.digest, hitR.digest].every((p) => takenNowhere(jobM, hitM.nonce, p) && takenNowhere(jobR, hitR.nonce, p)));
  const prepR = await M.prepareMint(pub, a, { wallet: RIVAL, job: jobR, nonce: BigInt(hitR.nonce), work: hitR.digest, write: writer(RIVAL) });
  const prepM = await M.prepareMint(pub, a, { wallet: MINER, job: jobM, nonce: BigInt(hitM.nonce), work: hitM.digest, write: writer(MINER) });
  let hM;
  let hR;
  await rpc("evm_setAutomine", [false]);
  try {
    hM = await M.sendMint(writer(MINER), a, jobM.anchor, BigInt(hitM.nonce), prepM.gas);
    hR = await M.sendMint(writer(RIVAL), a, jobR.anchor, BigInt(hitR.nonce), prepR.gas);
    await rpc("evm_mine");
  } finally {
    await rpc("evm_setAutomine", [true]);
  }
  const rM = await pub.waitForTransactionReceipt({ hash: hM });
  const rR = await pub.waitForTransactionReceipt({ hash: hR });
  const oM = M.parseMintReceipt(rM, a, MINER);
  const oR = M.parseMintReceipt(rR, a, RIVAL);
  const won = oM.minted ? { who: MINER, job: jobM, hit: hitM, out: oM } : { who: RIVAL, job: jobR, hit: hitR, out: oR };
  const lost = oM.minted ? { who: RIVAL, job: jobR, hit: hitR, out: oR, r: rR } : { who: MINER, job: jobM, hit: hitM, out: oM, r: rM };
  check(
    "a race in one block: one mint lands, the other reverts and reads as the lost race with the spec's line",
    prepM.ok && prepR.ok && rM.blockNumber === rR.blockNumber && !!won.out.minted && lost.out.lost && !lost.out.minted && lost.r.status === "reverted" && M.outcomeLines(lost.out).join() === M.LINES.lost,
    `block ${rM.blockNumber}: ${won.who === MINER ? "the miner" : "the rival"} won #${won.out.minted?.id} at ${jobM.bits} bit(s); ${draws} draw(s) for two hashes no new prevWork takes`,
  );
  const retry = await M.prepareMint(pub, a, { wallet: lost.who, job: lost.job, nonce: BigInt(lost.hit.nonce), work: lost.hit.digest, write: writer(lost.who) });
  const resent = await M.prepareMint(pub, a, { wallet: won.who, job: won.job, nonce: BigInt(won.hit.nonce), work: won.hit.digest, write: writer(won.who) });
  const found = await M.findMinted(pub, a, won.who, won.hit.digest, won.job.block - 1n);
  check(
    "the losing hash is refused before the wallet as the lost race (NotASolution, prevWork moved); the winning one reads as landed and findMinted finds its card",
    !retry.ok && retry.why === "lost" && !resent.ok && resent.why === "landed" && found?.id === won.out.minted?.id,
  );

  // The allowance re-checked before every mint, on the chain: one wei under the price is approved again.
  await mined(walletOf(MINER).writeContract({ address: a.token, abi: erc20Abi, functionName: "approve", args: [a.metamorph, (await view("mintPrice")) - 1n] }));
  const job7 = await J.liveJob(pub, a, MINER, 7);
  const hit7 = workerSearch(job7);
  const w7 = writes.length;
  const prep7 = await M.prepareMint(pub, a, { wallet: MINER, job: job7, nonce: BigInt(hit7.nonce), work: hit7.digest, write: writer(MINER) });
  check(
    "on the stack, an allowance one wei under the price is approved again, to the maximum, before the mint",
    prep7.ok && prep7.approved && writes.slice(w7).map((x) => x.fn).join() === "approve" && (await pub.readContract({ address: a.token, abi: erc20Abi, functionName: "allowance", args: [MINER, a.metamorph] })) === maxUint256,
  );

  // The anchor's window: the poller rebuilds the job from age 40; past age 50 the mint is refused.
  const mineTo = async (age) => {
    const now = await pub.getBlockNumber({ cacheTime: 0 });
    const want = job7.anchor + BigInt(age);
    if (want > now) await rpc("anvil_mine", [`0x${(want - now).toString(16)}`]);
    return J.liveJob(pub, a, MINER, 8);
  };
  const at39 = await mineTo(39);
  const at40 = await mineTo(40);
  await mineTo(52);
  const late = await M.prepareMint(pub, a, { wallet: MINER, job: job7, nonce: BigInt(hit7.nonce), work: hit7.digest, write: writer(MINER) });
  check(
    "the anchor: a read at age 39 keeps the job, at 40 rebuilds it; past the window the mint is refused as expired (BadAnchor)",
    !J.anchorExpiring(job7, at39.block) && J.anchorExpiring(job7, at40.block) && !late.ok && late.why === "expired",
    `ages ${at39.block - job7.anchor} and ${at40.block - job7.anchor}`,
  );
  check("mineableSeats lists the noted seat", (await J.mineableSeats(pub, a)).join() === String(seat));
}

// The workspace on the stack: anvil's account #5 mints two cards the way the page does, sends one to #6 and
// back, stakes the other; a conversion called by #7 credits the stakers; then Claim IMD with nothing selected
// (claim of every staked card) pays exactly the figure the page shows, and an unstake after it books nothing
// more. A run starts by unstaking and claiming whatever an earlier run left.
async function cardsOnTheStack() {
  console.log(`\n== the workspace against the local stack (${RPC})`);
  const a = JSON.parse(readFileSync(LOCAL, "utf8"));
  const pub = createPublicClient({ chain: foundry, transport: http(RPC), pollingInterval: 200 });
  const WALLET = getAddress("0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc");
  const OTHER = getAddress("0x976EA74026E726554dB657fA54763abd0C3a0aa9");
  const CALLER = getAddress("0x14dC79964da2C08b23698B3D3cc7Ca32193d9955");
  const FUNDER = getAddress("0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f");
  const MOVE = parseAbi(["function transferFrom(address from, address to, uint256 id)"]);
  const walletOf = (account) => createWalletClient({ chain: foundry, transport: http(RPC), account });
  const writer = (account) => (call) => walletOf(account).writeContract(call);
  const mined = async (hashPromise) => {
    const r = await pub.waitForTransactionReceipt({ hash: await hashPromise });
    if (r.status !== "success") throw new Error(`a transaction reverted: ${r.transactionHash}`);
    return r;
  };
  const md = { address: a.metamorph, abi: metamorphAbi };
  const view = (functionName, args) => pub.readContract({ ...md, functionName, args });
  const imdOf = (who) => pub.readContract({ address: a.imd, abi: erc20Abi, functionName: "balanceOf", args: [who] });
  const got = (read, id) => read.cards.filter((c) => c.id === id);

  const left = await C.walletCards(pub, a, WALLET);
  const stuck = left.cards.filter((c) => c.staked).map((c) => c.id);
  if (stuck.length) await mined(C.sendCards(writer(WALLET), a, "unstake", stuck));
  if ((await view("pendingIMD", [WALLET])) > 0n) await mined(C.sendCards(writer(WALLET), a, "claim", []));

  // Two cards, mined and sent as the page sends them.
  await mined(walletOf(FUNDER).writeContract({ address: a.token, abi: erc20Abi, functionName: "transfer", args: [WALLET, 1_000_000n * E18] }));
  const ids = [];
  for (let k = 0; k < 2; k++) {
    const bits = await view("bits");
    if (bits > 12) {
      await rpc("evm_increaseTime", [360 * Math.ceil((bits - 1) / 2) + 1]);
      await rpc("evm_mine");
    }
    const job = await J.liveJob(pub, a, WALLET, 100 + k);
    const hit = workerSearch(job);
    const prep = await M.prepareMint(pub, a, { wallet: WALLET, job, nonce: BigInt(hit.nonce), work: hit.digest, write: writer(WALLET) });
    if (!prep.ok) throw new Error(`the mint was refused: ${prep.why}`);
    const out = M.parseMintReceipt(await mined(M.sendMint(writer(WALLET), a, job.anchor, BigInt(hit.nonce), prep.gas)), a, WALLET);
    if (!out.minted) throw new Error("the mint read as a lost race");
    ids.push(Number(out.minted.id));
  }
  const [A, B] = ids;
  const read1 = await C.walletCards(pub, a, WALLET);
  const balance = Number(await view("balanceOf", [WALLET]));
  check(
    "walletCards: the two new cards, each once, in the cocoon and not staked, mined by the wallet; as many cards as balanceOf",
    read1.cards.length === balance &&
      [A, B].every((id) => {
        const c = got(read1, id);
        return c.length === 1 && c[0].stage === 0 && !c[0].staked && isAddressEqual(c[0].miner, WALLET) && c[0].seat > 0 && c[0].paid > 0n;
      }),
    `#${A}, #${B}; ${read1.cards.length} card(s) in the wallet`,
  );

  // B sent to #6 and back: the logs are read on from the last block seen.
  await mined(walletOf(WALLET).writeContract({ address: a.metamorph, abi: MOVE, functionName: "transferFrom", args: [WALLET, OTHER, BigInt(B)] }));
  const away = await C.walletCards(pub, a, WALLET);
  const there = await C.walletCards(pub, a, OTHER);
  await mined(walletOf(OTHER).writeContract({ address: a.metamorph, abi: MOVE, functionName: "transferFrom", args: [OTHER, WALLET, BigInt(B)] }));
  const back = await C.walletCards(pub, a, WALLET);
  const thereAfter = await C.walletCards(pub, a, OTHER);
  check(
    "a card sent away and back: gone from the wallet and held by the other, then the wallet's once again with its stage, and the other's no more",
    got(away, B).length === 0 && got(there, B).length === 1 && got(back, B).length === 1 && got(back, B)[0].stage === 0 && back.cards.length === balance && got(thereAfter, B).length === 0,
  );

  // Stake A.
  await mined(C.sendCards(writer(WALLET), a, "stake", [A]));
  const staked = await C.walletCards(pub, a, WALLET);
  const sa = got(staked, A)[0];
  check("stake([A]): A is marked staked with weight 1 (a chrysalis), B is not", !!sa && sa.staked && sa.weight === 1 && !got(staked, B)[0].staked);

  // The images, read once per (id, stage, gilt) through tokenURI.
  let uris = 0;
  const counting = {
    readContract: (x) => {
      if (x.functionName === "tokenURI") uris++;
      return pub.readContract(x);
    },
  };
  const img1 = await C.tokenImage(counting, a, A, sa.stage, sa.gilt);
  const img2 = await C.tokenImage(counting, a, A, sa.stage, sa.gilt);
  const page = await C.tokenCard(pub, a, A);
  check(
    "tokenImage on the stack: the card's SVG data URI from tokenURI, read once; tokenCard gives its JSON's attributes",
    !!img1 && img1.startsWith("data:image/svg+xml;base64,") && img1 === img2 && uris === 1 && page?.image === img1 && page.stage === 0 && page.attributes.some((x) => x.trait === "Seat"),
    `${img1?.length} characters, ${page?.attributes.length} attributes`,
  );

  // The gallery and the leaderboard.
  const total = Number(await view("totalMinted"));
  const all = await C.mintedCards(pub, a);
  const me = C.leaderboard(all).find((l) => isAddressEqual(l.miner, WALLET));
  check(
    "mintedCards: every Minted log, newest first, the two new cards as minted by the wallet; the leaderboard counts them",
    all.length === total && all[0].id === total && all.every((r, i) => i === 0 || all[i - 1].id > r.id) && [A, B].every((id) => all.some((r) => r.id === id && isAddressEqual(r.miner, WALLET))) && !!me && me.cards >= 2 && me.newest >= B,
    `${all.length} minted`,
  );
  const facts = await C.cardFacts(pub, a, A);
  const stages = await C.stagesOf(pub, a, [A, B]);
  check(
    "cardFacts: the card, its stage, its stake and its owner; an id not minted is null; stagesOf reads a gallery page's stages",
    !!facts && facts.id === A && facts.staked && isAddressEqual(facts.owner, WALLET) && (await C.cardFacts(pub, a, total + 1)) === null && stages.stages.get(A) === 0 && stages.stages.get(B) === 0 && stages.gone.length === 0,
  );

  // A credit to the stakers: the pot holds 70% of each mint price; convert() (anyone, every CONVERT_SPACING
  // blocks) sells it for IMD and spreads it over the staked weight.
  const spacing = BigInt(await view("CONVERT_SPACING"));
  const last = await view("lastConvertBlock");
  const head = await pub.getBlockNumber({ cacheTime: 0 });
  if (head < last + spacing) await rpc("anvil_mine", [`0x${(last + spacing - head).toString(16)}`]);
  const accBefore = await view("accIMDPerWeight");
  let why = "";
  try {
    await mined(walletOf(CALLER).writeContract({ ...md, functionName: "convert" }));
    if ((await view("accIMDPerWeight")) <= accBefore) why = "the conversion credited nothing to the stakers";
  } catch (e) {
    why = `convert() was refused: ${M.revertName(e) ?? M.errorText(e)}`;
  }
  if (!why) {
    const read2 = await C.walletCards(pub, a, WALLET);
    const figure = await C.pendingIMD(pub, a, WALLET, read2.cards.map((c) => c.id));
    const [pending, acc, stakeA] = await Promise.all([view("pendingIMD", [WALLET]), view("accIMDPerWeight"), view("stakeOf", [BigInt(A)])]);
    const direct = pending + (BigInt(stakeA[1]) * acc - stakeA[2]) / E18;
    check(
      "after one credit: IMD earned, not claimed = pendingIMD + (weight × accIMDPerWeight − debt) / 1e18, from pendingIMD() and walletCards alike",
      figure > 0n && figure === direct && read2.earned === figure,
      `${C.imd4(figure)} IMD`,
    );
    // Claim IMD with nothing selected, as the page sends it: every staked card, settled, so the figure is paid.
    const ids = C.actionIds(read2.cards, new Set()).claim;
    const imdBefore = await imdOf(WALLET);
    const receipt = await mined(C.sendCards(writer(WALLET), a, "claim", ids));
    const paid = C.claimedIn(receipt, a, WALLET);
    const imdAfter = await imdOf(WALLET);
    const read3 = await C.walletCards(pub, a, WALLET);
    check(
      "Claim IMD with nothing selected sends claim(every staked card) and pays exactly the figure (the Claimed log and the IMD balance agree); the card stays staked and the figure is back to zero",
      ids.join() === String(A) && paid === figure && imdAfter - imdBefore === figure && got(read3, A)[0].staked && read3.earned === 0n && (await view("pendingIMD", [WALLET])) === 0n,
      `claim([${ids.join(", ")}]) paid ${C.imd4(paid ?? 0n)} IMD`,
    );
    await mined(C.sendCards(writer(WALLET), a, "unstake", [A]));
    const read4 = await C.walletCards(pub, a, WALLET);
    check("unstake([A]) after it books nothing more: the claim had settled the card", !got(read4, A)[0].staked && read4.earned === 0n && (await view("pendingIMD", [WALLET])) === 0n);
  } else {
    skip("the figure after a credit, and a claim that pays it", why);
    const read2 = await C.walletCards(pub, a, WALLET);
    const receipt = await mined(C.sendCards(writer(WALLET), a, "claim", C.actionIds(read2.cards, new Set()).claim));
    await mined(C.sendCards(writer(WALLET), a, "unstake", [A]));
    const read3 = await C.walletCards(pub, a, WALLET);
    check("Claim IMD with nothing selected (every staked card) and unstake([A]) go through without a credit", !got(read3, A)[0].staked && C.claimedIn(receipt, a, WALLET) !== null);
  }
}

async function numbersOnTheStack() {
  console.log(`\n== the mine, in numbers, against the local stack (${RPC})`);
  const a = JSON.parse(readFileSync(LOCAL, "utf8"));
  const pub = createPublicClient({ chain: foundry, transport: http(RPC), pollingInterval: 200 });
  const md = { address: a.metamorph, abi: metamorphAbi };
  const n = await L.loadMine(pub, a);
  // The contract's own views at the block the reading ran at.
  const view = (functionName, args) => pub.readContract({ ...md, functionName, args, blockNumber: n.block });
  const [minted, epoch, price, bits, lastMintAt, open] = await Promise.all(["totalMinted", "epoch", "mintPrice", "bits", "lastMintAt", "mineableSeats"].map((f) => view(f)));
  check(
    "loadMine on the stack: totalMinted, epoch, mintPrice, bits and the mineable seats as the contract's views give them at the block it read",
    n.minted === minted && n.epoch === epoch && n.price === price && n.bits === bits && n.mineable === open.length,
    `${n.minted} minted, epoch ${n.epoch}, ${M.amount(n.price)} PUPATE, ${n.bits} bits, ${n.mineable} mineable`,
  );
  // The hour, counted again from every card's mintedAt read one by one.
  const cards = await Promise.all(Array.from({ length: minted }, (_, i) => view("cards", [BigInt(i + 1)])));
  const inHour = cards.filter((c) => c[4] > n.now - L.HOUR).length;
  const text = L.numbersText(n);
  check(
    "the mints of the last hour = the cards whose mintedAt is within the hour, every card read; the rate is that × 2^bits ÷ 3,600",
    n.lastHour === inHour && text.rate === L.fmtNetworkRate(inHour ? (inHour * 2 ** n.bits) / 3600 : null),
    `${n.lastHour} in the hour, ${text.rate}`,
  );
  const block = await pub.getBlock({ blockNumber: n.block });
  check(
    "the last mint: lastMintAt(), the newest card's mintedAt (none before the first mint); the reading's clock is no earlier than its block's",
    (minted > 0 ? n.lastMintAt === lastMintAt && cards[minted - 1][4] === lastMintAt : n.lastMintAt === null) && n.now >= Number(block.timestamp) && L.secondsSince(n, Date.now()) >= 0,
    `${L.fmtSince(L.secondsSince(n, Date.now()))} since the last mint, skew ${n.skew} s`,
  );
  // The same hour as the Minted logs tell it: each log's block timestamp is its card's mintedAt, so the walk
  // over the cards counts what the logs count.
  const logs = await pub.getContractEvents({ ...md, eventName: "Minted", fromBlock: BigInt(a.fromBlock), toBlock: n.block });
  const stamps = new Map();
  for (const l of logs) if (!stamps.has(l.blockNumber)) stamps.set(l.blockNumber, Number((await pub.getBlock({ blockNumber: l.blockNumber })).timestamp));
  const logHour = logs.filter((l) => stamps.get(l.blockNumber) > n.now - L.HOUR).length;
  const newest = logs.length ? stamps.get(logs[logs.length - 1].blockNumber) : null;
  check(
    "the Minted logs agree: one per card, the logs of the last hour (by their blocks' timestamps) are the hour's mints, and the newest log's block is the last mint",
    logs.length === minted && logHour === n.lastHour && newest === n.lastMintAt,
    `${logs.length} Minted logs, ${logHour} in the hour, the newest at ${newest}`,
  );
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
