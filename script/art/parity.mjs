// Parity on anvil: the art as deployed draws what the mirror draws, byte for byte. The script starts anvil on
// port 8546 and deploys the three art contracts with script/DeployMetamorphArt.s.sol, as the runbook will on
// mainnet. It reads the router's address from the script's logs, checked against forge's broadcast record and
// against the router's own CHRYSALIS and BUTTERFLY.
//
// Then, for each view of the mirror's parity sample (sampleViews: 24 cards, the heaviest of each stage among
// them, that show every form, halo, signal, density, palette and tier, both stages, gilt and plain;
// `node script/art/mirror.mjs sample` prints them), it:
//   - calls tokenURI through eth_call with 30,000,000 gas and records eth_estimateGas;
//   - decodes the data URIs, refusing any base64 that is not canonical and any text that is not UTF-8;
//   - compares the JSON with the mirror's tokenJSON and the SVG with its renderSVG, byte for byte;
//   - checks that the JSON parses, that the SVG is well-formed XML (parseXML below, no dependency) and that
//     every href="#…" and url(#…) in it names an element of the document;
//   - checks the spec's limits: gas under 20,000,000, the SVG under 24,576 bytes, the JSON under 40,960;
//   - writes the SVG to out/art/<seat>-<round>-<edition>-<chrysalis|butterfly>[-gilt].svg (git-ignored, emptied
//     first) for the eye; script/art/thumbs.mjs rasterises them.
// It prints a table (card, stage, gas, bytes, ok), stops anvil, also on an error or on SIGINT, SIGTERM and
// SIGHUP (exit codes 130, 143 and 129), and exits 1 on any difference.
//
// Usage: node script/art/parity.mjs
// Needs forge and anvil (on the PATH, or in ~/.foundry/bin where foundryup puts them) and site/node_modules
// (as the mirror does). Port 8546 must be free. The only RPC it talks to is the anvil it started.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  decodeFunctionResult,
  encodeFunctionData,
  http,
} from "../../site/node_modules/viem/_esm/index.js";
import { coverageOf, renderSVG, SAMPLE_FEATURES, sampleViews, tokenJSON } from "./mirror.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "out", "art");
const PORT = 8546;
const RPC = `http://127.0.0.1:${PORT}`;
const CHAIN_ID = 31337;
// Anvil's first default private key. It is PUBLIC: anvil prints it at every start, and it holds test ether on
// local chains only. It is never a real key and must never hold anything.
const ANVIL_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const CALL_GAS = 30_000_000n;
const LIMIT = { gas: 20_000_000n, svg: 24_576, json: 40_960 };

/// forge or anvil: the one on the PATH if it runs, else the one in ~/.foundry/bin.
function tool(name) {
  if (spawnSync(name, ["--version"], { stdio: "ignore" }).status === 0) return name;
  const home = join(homedir(), ".foundry", "bin", process.platform === "win32" ? `${name}.exe` : name);
  if (existsSync(home)) return home;
  throw new Error(`${name} is neither on the PATH nor in ~/.foundry/bin`);
}

/// The router's ABI: tokenURI(View) and the two figures it was built with.
const VIEW = {
  type: "tuple",
  name: "v",
  components: [
    { name: "id", type: "uint256" },
    { name: "seat", type: "uint256" },
    { name: "round", type: "uint16" },
    { name: "edition", type: "uint16" },
    { name: "stage", type: "uint8" },
    { name: "gilt", type: "bool" },
    { name: "epoch", type: "uint16" },
    { name: "miner", type: "address" },
    { name: "mintedAt", type: "uint40" },
    { name: "paid", type: "uint256" },
  ],
};
const ABI = [
  { type: "function", name: "tokenURI", stateMutability: "view", inputs: [VIEW], outputs: [{ type: "string" }] },
  { type: "function", name: "CHRYSALIS", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "BUTTERFLY", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
];

/// A sample view as the ABI takes it.
const viewArg = (v) => ({
  id: BigInt(v.id),
  seat: BigInt(v.seat),
  round: Number(v.round),
  edition: Number(v.edition),
  stage: Number(v.stage),
  gilt: Boolean(v.gilt),
  epoch: Number(v.epoch),
  miner: v.miner,
  mintedAt: Number(v.mintedAt),
  paid: BigInt(v.paid),
});

/// The file a view's SVG is written to, without the directory.
const fileOf = (v) =>
  `${v.seat}-${v.round}-${v.edition}-${Number(v.stage) === 0 ? "chrysalis" : "butterfly"}${v.gilt ? "-gilt" : ""}.svg`;

// ------------------------------------------------------------------ the checks

/// A character XML allows: tab, newline, carriage return, and the rest of Unicode but the C0 controls, the
/// surrogates, U+FFFE and U+FFFF.
const xmlChar = (c) =>
  c === 9 || c === 10 || c === 13 || (c >= 0x20 && c <= 0xd7ff) || (c >= 0xe000 && c <= 0xfffd) ||
  (c >= 0x10000 && c <= 0x10ffff);

/// A strict well-formedness check of an XML document, with no dependency: one root element; every element
/// closed by its own name, in order; names as XML spells them; every attribute quoted, unique and free of '<';
/// every '&' one of the five predefined entities or a reference to an allowed character; text free of '<' and
/// ']]>'; no character XML forbids. The art writes no comment, CDATA, processing instruction or DOCTYPE, so
/// each of them is refused as well. Returns the root as { tag, attrs, children }, the children elements and
/// strings; throws with the offset and the text around it.
export function parseXML(text) {
  let p = 0;
  const fail = (why) => {
    throw new Error(`${why} at ${p}: ${JSON.stringify(text.slice(Math.max(0, p - 40), p + 40))}`);
  };
  for (let k = 0; k < text.length; ) {
    const c = text.codePointAt(k);
    p = k;
    if (!xmlChar(c)) fail(`the character U+${c.toString(16)}`);
    k += c > 0xffff ? 2 : 1;
  }
  p = 0;
  const space = () => {
    const at = p;
    while ([9, 10, 13, 32].includes(text.charCodeAt(p))) p++;
    return p > at;
  };
  const NAME = /[A-Za-z_:][-A-Za-z0-9._:]*/y;
  const name = () => {
    NAME.lastIndex = p;
    const m = NAME.exec(text);
    if (m === null) fail("a name expected");
    p += m[0].length;
    return m[0];
  };
  const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  // The characters up to `stop` (a quote, or the '<' after text), references replaced.
  const chars = (stop) => {
    let out = "";
    while (p < text.length && text[p] !== stop) {
      if (text[p] === "<") fail("a '<' inside a value");
      if (text[p] !== "&") {
        out += text[p++];
        continue;
      }
      const end = text.indexOf(";", p);
      const ref = end < 0 ? "" : text.slice(p + 1, end);
      const code = /^#[0-9]{1,7}$/.test(ref)
        ? Number(ref.slice(1))
        : /^#x[0-9a-fA-F]{1,6}$/.test(ref)
          ? parseInt(ref.slice(2), 16)
          : -1;
      if (Object.hasOwn(ENTITIES, ref)) out += ENTITIES[ref];
      else if (xmlChar(code)) out += String.fromCodePoint(code);
      else fail("a '&' that starts no reference XML allows");
      p = end + 1;
    }
    return out;
  };
  const element = () => {
    if (text[p] !== "<") fail("'<' expected");
    p++;
    const tag = name();
    const attrs = {};
    for (;;) {
      const spaced = space();
      if (text.startsWith("/>", p)) {
        p += 2;
        return { tag, attrs, children: [] };
      }
      if (text[p] === ">") {
        p++;
        break;
      }
      if (!spaced) fail("a space expected before an attribute");
      const key = name();
      if (Object.hasOwn(attrs, key)) fail(`the attribute ${key} twice`);
      space();
      if (text[p] !== "=") fail("'=' expected");
      p++;
      space();
      const quote = text[p];
      if (quote !== '"' && quote !== "'") fail(`the attribute ${key} unquoted`);
      p++;
      attrs[key] = chars(quote);
      if (text[p] !== quote) fail(`the attribute ${key} never closed`);
      p++;
    }
    const children = [];
    for (;;) {
      if (p >= text.length) fail(`<${tag}> never closed`);
      if (text.startsWith("</", p)) {
        p += 2;
        const end = name();
        if (end !== tag) fail(`</${end}> closes <${tag}>`);
        space();
        if (text[p] !== ">") fail("'>' expected");
        p++;
        return { tag, attrs, children };
      }
      if (text[p] === "<") {
        if (text[p + 1] === "!" || text[p + 1] === "?") fail("a comment, CDATA, DOCTYPE or instruction");
        children.push(element());
      } else {
        const at = p;
        children.push(chars("<"));
        if (text.slice(at, p).includes("]]>")) fail("']]>' in text");
      }
    }
  };
  space();
  const root = element();
  space();
  if (p !== text.length) fail("content after the root element");
  return root;
}

/// The SVG's root and its references: the root is <svg> in the SVG namespace; every id is given once; every
/// href="#…" and url(#…) names one of them. Returns how many ids and references there are.
function references(root) {
  if (root.tag !== "svg" || root.attrs.xmlns !== "http://www.w3.org/2000/svg") {
    throw new Error("the root is not an <svg> in the SVG namespace");
  }
  const ids = new Set(), refs = [];
  const walk = (e) => {
    for (const [k, v] of Object.entries(e.attrs)) {
      if (k === "id") {
        if (ids.has(v)) throw new Error(`the id ${v} given twice`);
        ids.add(v);
      }
      if ((k === "href" || k === "xlink:href") && v.startsWith("#")) refs.push(v.slice(1));
      for (const m of v.matchAll(/url[(]#([^)]*)[)]/g)) refs.push(m[1]);
    }
    for (const c of e.children) if (typeof c !== "string") walk(c);
  };
  walk(root);
  const dangling = [...new Set(refs.filter((r) => !ids.has(r)))];
  if (dangling.length > 0) throw new Error(`references to nothing: ${dangling.join(", ")}`);
  return { ids: ids.size, refs: refs.length };
}

/// The bytes a base64 data URI carries after its prefix. Anything but canonical, padded base64 is refused:
/// Buffer.from alone would skip a stray character.
function dataBytes(uri, prefix) {
  if (!uri.startsWith(prefix)) throw new Error(`no ${prefix} prefix`);
  const b64 = uri.slice(prefix.length);
  const bytes = Buffer.from(b64, "base64");
  if (b64.length % 4 !== 0 || bytes.toString("base64") !== b64) throw new Error(`${prefix} carries no canonical base64`);
  return bytes;
}

/// UTF-8 or an error, never a replacement character.
const utf8 = new TextDecoder("utf-8", { fatal: true });

/// "" when the chain's bytes are the mirror's; else where they first differ, with the text around it.
function differs(what, chain, mirror) {
  if (chain.equals(mirror)) return "";
  let k = 0;
  while (k < chain.length && k < mirror.length && chain[k] === mirror[k]) k++;
  const around = (b) => JSON.stringify(b.subarray(Math.max(0, k - 30), k + 30).toString("utf8"));
  return (
    `${what} differs from the mirror's at byte ${k} (${chain.length} B on the chain, ${mirror.length} B in the ` +
    `mirror): chain ${around(chain)}, mirror ${around(mirror)}`
  );
}

/// One sample view through the router: tokenURI by eth_call, its gas estimate, the JSON and the SVG against the
/// mirror's, the JSON parsed, the SVG parsed and its references resolved, the limits. Returns the view's row;
/// row.errors is empty when the view passes.
async function check(client, art, v) {
  const stage = `${Number(v.stage) === 0 ? "chrysalis" : "butterfly"}${v.gilt ? ", gilt" : ""}`;
  const row = { card: `(${v.seat}, ${v.round}, ${v.edition})`, stage, gas: 0n, svg: 0, json: 0, errors: [] };
  const fail = (why) => row.errors.push(why);
  try {
    const data = encodeFunctionData({ abi: ABI, functionName: "tokenURI", args: [viewArg(v)] });
    const reply = await client.call({ to: art, data, gas: CALL_GAS });
    row.gas = await client.estimateGas({ to: art, data });
    const uri = decodeFunctionResult({ abi: ABI, functionName: "tokenURI", data: reply.data });
    const json = dataBytes(uri, "data:application/json;base64,");
    row.json = json.length;
    const svg = dataBytes(JSON.parse(utf8.decode(json)).image, "data:image/svg+xml;base64,");
    row.svg = svg.length;
    writeFileSync(join(OUT, fileOf(v)), svg);
    const svgDiff = differs("the SVG", svg, Buffer.from(renderSVG(v), "utf8"));
    if (svgDiff !== "") fail(svgDiff);
    const jsonDiff = differs("the JSON", json, Buffer.from(tokenJSON(v), "utf8"));
    if (jsonDiff !== "") fail(jsonDiff);
    try {
      references(parseXML(utf8.decode(svg)));
    } catch (e) {
      fail(`the SVG is not well-formed: ${e.message}`);
    }
  } catch (e) {
    fail(e.shortMessage ?? e.message);
  }
  if (row.gas >= LIMIT.gas) fail(`gas ${row.gas} is not under ${LIMIT.gas}`);
  if (row.svg >= LIMIT.svg) fail(`the SVG's ${row.svg} bytes are not under ${LIMIT.svg}`);
  if (row.json >= LIMIT.json) fail(`the JSON's ${row.json} bytes are not under ${LIMIT.json}`);
  return row;
}

// ------------------------------------------------------------------ anvil and the deployment

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/// The chain id of whatever answers JSON-RPC on the port, or null when nothing does.
async function chainId() {
  try {
    const reply = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      signal: AbortSignal.timeout(2000),
    });
    return Number((await reply.json()).result);
  } catch {
    return null;
  }
}

let anvil = null;
/// Stops the anvil this script started, if it still runs. Called on every way out.
function stopAnvil() {
  if (anvil !== null && anvil.exitCode === null && anvil.signalCode === null) anvil.kill();
}

/// Starts anvil on PORT, refusing a port something already answers on, and waits until it answers.
async function startAnvil() {
  if ((await chainId()) !== null) throw new Error(`port ${PORT} already answers JSON-RPC: stop that node first`);
  anvil = spawn(tool("anvil"), ["--port", String(PORT), "--silent"], { stdio: "ignore" });
  let failed = null;
  anvil.on("error", (e) => (failed = e));
  for (let k = 0; k < 80; k++) {
    if (failed !== null) throw new Error(`anvil did not start: ${failed.message}`);
    if (anvil.exitCode !== null) throw new Error(`anvil exited with ${anvil.exitCode} (is port ${PORT} taken?)`);
    const id = await chainId();
    if (id === CHAIN_ID) return;
    if (id !== null) throw new Error(`port ${PORT} answers as chain ${id}, not anvil's ${CHAIN_ID}`);
    await sleep(250);
  }
  throw new Error(`anvil did not answer on port ${PORT} within 20 s`);
}

/// Deploys the art with its own script, as the runbook does, signed with anvil's public test key. Returns the
/// three addresses from the script's logs (lowercase) once forge's broadcast record names the same ones, each
/// has code, and the router's CHRYSALIS and BUTTERFLY are the two figures; and the lengths of the two sample
/// token URIs the script logs, as text.
async function deploy(client) {
  const args = ["script", "script/DeployMetamorphArt.s.sol", "--rpc-url", RPC, "--broadcast"];
  const forge = spawnSync(tool("forge"), [...args, "--private-key", ANVIL_KEY, "--color", "never"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 1 << 26,
  });
  const log = `${forge.stdout ?? ""}${forge.stderr ?? ""}`.split(ANVIL_KEY).join("<anvil key>");
  if (forge.status !== 0) throw new Error(`forge script failed (exit ${forge.status}):\n${log}`);
  const logged = (name) => {
    const m = new RegExp(`${name} (0x[0-9a-fA-F]{40})`).exec(log);
    if (m === null) throw new Error(`forge script logged no ${name}:\n${log}`);
    return m[1].toLowerCase();
  };
  const at = {
    MetamorphChrysalis: logged("MetamorphChrysalis"),
    MetamorphButterfly: logged("MetamorphButterfly"),
    MetamorphArt: logged("MetamorphArt"),
  };
  const record = JSON.parse(
    readFileSync(join(ROOT, "broadcast", "DeployMetamorphArt.s.sol", String(CHAIN_ID), "run-latest.json"), "utf8"),
  );
  for (const [name, address] of Object.entries(at)) {
    const sent = record.transactions.find((t) => t.contractName === name && t.transactionType === "CREATE");
    if (sent?.contractAddress?.toLowerCase() !== address) throw new Error(`the broadcast record has another ${name}`);
    if ((await client.getCode({ address })) === undefined) throw new Error(`${name} has no code at ${address}`);
  }
  for (const [fn, name] of [["CHRYSALIS", "MetamorphChrysalis"], ["BUTTERFLY", "MetamorphButterfly"]]) {
    const figure = await client.readContract({ address: at.MetamorphArt, abi: ABI, functionName: fn });
    if (figure.toLowerCase() !== at[name]) throw new Error(`the router's ${fn} is not the ${name} just deployed`);
  }
  const sample = (stage) => {
    const m = new RegExp(`sample ${stage} tokenURI bytes ([0-9]+)`).exec(log);
    return m === null ? "not logged" : `${Number(m[1]).toLocaleString("en-US")} B`;
  };
  return { ...at, sample: `${sample("chrysalis")} chrysalis, ${sample("butterfly")} butterfly` };
}

// ------------------------------------------------------------------ the run

const comma = (x) => Number(x).toLocaleString("en-US");

async function main() {
  const views = sampleViews();
  const { missing, pairs, pairsTotal } = coverageOf(views);
  if (missing.length > 0) throw new Error(`the sample never shows ${missing.join(", ")}`);
  if (new Set(views.map(fileOf)).size !== views.length) throw new Error("two sample views share a file name");

  await startAnvil();
  const client = createPublicClient({ transport: http(RPC) });
  const at = await deploy(client);
  console.log(`deployed on anvil (chain ${CHAIN_ID}, port ${PORT}) by script/DeployMetamorphArt.s.sol:`);
  console.log(`  MetamorphChrysalis ${at.MetamorphChrysalis}`);
  console.log(`  MetamorphButterfly ${at.MetamorphButterfly}`);
  console.log(`  MetamorphArt       ${at.MetamorphArt} (the router; its sample tokenURIs: ${at.sample})`);

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const rows = [];
  for (const v of views) rows.push(await check(client, at.MetamorphArt, v));
  stopAnvil();

  const head = `${"#".padStart(3)}  ${"card".padEnd(17)}${"stage".padEnd(17)}${"gas".padStart(10)}`;
  console.log(`\n${head}${"svg B".padStart(9)}${"json B".padStart(9)}  ok`);
  rows.forEach((r, k) => {
    const cells = `${String(k + 1).padStart(3)}  ${r.card.padEnd(17)}${r.stage.padEnd(17)}${comma(r.gas).padStart(10)}`;
    const ok = r.errors.length === 0 ? "OK" : "FAIL";
    console.log(`${cells}${comma(r.svg).padStart(9)}${comma(r.json).padStart(9)}  ${ok}`);
    for (const e of r.errors) console.log(`       ${e}`);
  });
  const passed = rows.filter((r) => r.errors.length === 0).length;
  const most = (key) => rows.reduce((m, r) => (r[key] > m ? r[key] : m), 0);
  console.log(
    `\n${passed} of ${rows.length} OK; at most ${comma(most("gas"))} gas (limit ${comma(LIMIT.gas)}), ` +
      `an SVG of ${comma(most("svg"))} B (${comma(LIMIT.svg)}), a JSON of ${comma(most("json"))} B ` +
      `(${comma(LIMIT.json)})`,
  );
  console.log(`the sample shows all ${SAMPLE_FEATURES.length} features and ${pairs} of the ${pairsTotal} stage pairs`);
  console.log(`the SVGs are in out/art/; node script/art/thumbs.mjs rasterises them`);
  return passed === rows.length ? 0 : 1;
}

const isMain = (() => {
  try {
    const self = realpathSync(fileURLToPath(import.meta.url));
    const run = realpathSync(resolve(process.argv[1] ?? ""));
    return process.platform === "win32" ? self.toLowerCase() === run.toLowerCase() : self === run;
  } catch {
    return false;
  }
})();

if (isMain) {
  process.on("exit", stopAnvil);
  // Ctrl-C, a plain `kill` and a closing terminal end the run as an error does: anvil stopped, a non-zero exit
  // (128 plus the signal's number, as a shell reports it).
  for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143], ["SIGHUP", 129]]) {
    process.on(signal, () => {
      stopAnvil();
      process.exit(code);
    });
  }
  main().then(
    (code) => {
      stopAnvil();
      process.exitCode = code;
    },
    (e) => {
      stopAnvil();
      console.error(`parity: ${e.message}`);
      process.exitCode = 1;
    },
  );
}
