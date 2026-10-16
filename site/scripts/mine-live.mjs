// The end-to-end run of the live mine page: the local stack (script/local/up.mjs: Metamorph MD at one bit,
// the vault's one seat noted), the dev server, and headless Edge driven over the DevTools protocol with a dev
// wallet, through what a visitor does. Open /mine/, connect through RainbowKit's modal (the dev wallet is
// offered there as an installed, EIP-6963 wallet), approve PUPATE, start mining on the CPU at one bit, see the
// success line, the card in the drawer with its tokenURI image and the numbers move, stop. Open /cards/, find
// the card, stake it, see it marked, claim IMD after a credit (convert() sent from another anvil key),
// unstake it. Back on /mine/, force the race once: a find waits with auto-mint off, a rival's mint of the same
// prevWork lands from another anvil key, and only then is the Mint button pressed; the page must say the
// lost-race line. Stop. Every step prints ✓ or ✗ with what it saw, and the script exits non-zero at the first
// line that does not come.
//
//   cd site && npm run mine-live                             the stack is up already (node script/local/up.mjs)
//   set -a; . <checkout>/.env; set +a; npm run mine-live     the stack is down: the script brings it up, and
//                                                            down again at the end; that needs MAINNET_RPC_URL
//
// Options: --account <n> (the anvil account the dev wallet is, 1 by default; 3, 6, 7 and 8 have parts of their
// own), --port <n> (the dev server's; a free one by default), --browser <path to msedge or chrome>,
// --no-build (look through the out/ already there instead of building it first), --timeout <seconds> (the
// whole run, default 1500).
//
// The dev wallet is this script's, not the site's. An EIP-1193 provider is put into every page the browser
// opens (Page.addScriptToEvaluateOnNewDocument) and announced through EIP-6963; it hands each request to this
// process over a DevTools binding, and here reads go to anvil while transactions are signed with anvil's
// public key #<account> through viem's privateKeyToAccount and sent raw. The site carries no dev-wallet code
// and no flag for one, so no build of it can carry a key; the first step builds the production export
// anyway (as `npm run build` does) and looks through out/ for every anvil key and for the mnemonic.
//
// The race is made certain, not likely. The contract re-hashes a nonce against whatever prevWork it meets,
// and at a few bits a stale nonce would solve the rival's new job by chance. So the waiting nonce is read
// where the page's engines report it (the probe beside the dev wallet keeps the live job a Worker is handed and
// its finds), and the rival's nonce is drawn until the page's proof, folded again with the rival's proof as
// prevWork, has its top bit set, which no target takes (the easiest, one bit, is below 2^255). While the
// rival's mint lands and the button is pressed, the page's reads wait at the browser's door (the DevTools
// Fetch domain), so its own three-second poll cannot see the rival first and drop the hash another way.
//
// Every wait is bounded. Whatever the script started (the stack, the build, the dev server, the browser and
// its temporary profile) is stopped on every way out; a stack that was up already is left up, with the
// run's cards and transactions on it.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  decodeFunctionData,
  erc20Abi,
  http,
  isAddressEqual,
  maxUint256,
  parseEventLogs,
  toHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { ADDRESSES_FILE, CHAIN_ID, DEFAULT_ACCOUNTS, RPC_URL, readDotEnv } from "../../script/local/common.mjs";

// The site's modules run here as they are, through the hook of scripts/mine-logic.mjs: they are TypeScript
// modules, and their relative imports leave off the ".ts" the site's bundler adds. A static import would be
// resolved before the hook, so they are imported after it.
registerHooks({
  resolve(specifier, context, nextResolve) {
    const bare = /^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier);
    const r = nextResolve(bare ? `${specifier}.ts` : specifier, context);
    return r.url.endsWith(".ts") ? { ...r, format: "module-typescript" } : r;
  },
});
const { metamorphAbi } = await import("../lib/metamorph/abi.ts");
const { fold, liveJob, meets, workOf } = await import("../lib/metamorph/job.ts");
const { buildSwap } = await import("../lib/swap.ts");

const site = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(site, "..");
const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
};
const flag = (name) => argv.includes(`--${name}`);

/// anvil's default keys, from its public mnemonic below, in anvil's order: test keys known to everyone and
/// worthless off a local chain. The dev wallet and the run's other parts sign with them in this script only;
/// the site never sees one, and the first step makes sure no build of it carries one.
const ANVIL_KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
  "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e",
  "0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356",
  "0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97",
  "0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6",
];
const MNEMONIC = "test test test test test test test test test test test junk";
ANVIL_KEYS.forEach((key, i) => {
  if (!isAddressEqual(privateKeyToAccount(key).address, DEFAULT_ACCOUNTS[i])) throw new Error(`anvil key #${i} does not give ${DEFAULT_ACCOUNTS[i]}`);
});

/// The other anvil accounts the run uses, one part each: #3 is the rival who mints first, #6 buys PUPATE so the
/// launch pool holds ETH for the conversion, #7 calls convert(), #8 (the swarm share's stand-in after up.mjs)
/// pays out PUPATE.
const RIVAL = 3;
const BUYER = 6;
const CALLER = 7;
const FUNDER = 8;
const DEV = Number(opt("account", "1"));
if (!Number.isInteger(DEV) || DEV < 0 || DEV > 9 || [RIVAL, BUYER, CALLER, FUNDER].includes(DEV)) {
  console.error(`--account takes one of anvil's accounts 0..9 other than ${RIVAL}, ${BUYER}, ${CALLER} and ${FUNDER} (they have parts of their own)`);
  process.exit(2);
}
/// The page reads the local chain at this address (components/Web3Provider.tsx), so the stack must answer there.
const RPC = "http://127.0.0.1:8545";
if (RPC_URL !== RPC) {
  console.error(`the page reads ${RPC}; the stack would answer on ${RPC_URL} (ANVIL_PORT): unset ANVIL_PORT`);
  process.exit(2);
}
const timeoutMs = Number(opt("timeout", "1500")) * 1000;

/// The dev wallet as RainbowKit lists it, and the binding its provider talks to this process through.
const WALLET = {
  name: "Anvil dev wallet",
  rdns: "dev.anvil.wallet",
  uuid: "6d1b5a4e-1f0c-4a7e-9c2e-3b5d7f9a1c06",
  icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%232f6f5e'/%3E%3C/svg%3E",
};
const BINDING = "__pupateDevWallet";
const MAX = maxUint256;
const E18 = 10n ** 18n;

/// The page's words the run waits for, as the specs give them: spelled out here, not taken from the code under test.
const SAYS = {
  approving: "approving PUPATE once for every mint",
  approved: "PUPATE approved for every mint",
  waiting: "valid hash found · mint it now",
  found: "found a valid hash · sending the mint",
  lost: "someone minted first, your hash expired · mining again",
};

/// A card's image from its token URI, decoded here: the art's base64 JSON, its `image`.
function imageOf(uri) {
  const m = /^data:application\/json;base64,(.*)$/s.exec(uri);
  if (!m) return null;
  try {
    return JSON.parse(Buffer.from(m[1], "base64").toString("utf8")).image ?? null;
  } catch {
    return null;
  }
}

/// IMD as the workspace writes it: four decimals, rounded down, thousands separated.
const imd4 = (wei) => `${(wei / E18).toLocaleString("en-US")}.${((wei % E18) / 10n ** 14n).toString().padStart(4, "0")}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (a) => `${String(a).slice(0, 6)}…${String(a).slice(-4)}`;
const secs = (t0) => `${((Date.now() - t0) / 1000).toFixed(1)} s`;
const oneLine = (e) => String(e instanceof Error ? e.message : e).split("\n")[0].slice(0, 500);
const tokens = (wei) => (Number(wei / 10n ** 14n) / 1e4).toLocaleString("en-US", { maximumFractionDigits: 4 });
const int = (s) => (s == null ? NaN : parseInt(String(s).replace(/,/g, ""), 10));

// ------------------------------------------------------------------ what the script starts, and stopping it

/// What the script started, so every way out stops it.
const started = { server: null, browser: null, profile: null, devtools: null, stack: false, children: new Set() };

/// Kills a child and everything it started (next dev and the browser fork processes of their own).
function killTree(child) {
  if (!child || child.exitCode !== null || child.pid === undefined) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }
}

let stopping = null;
/// Stops the browser (over its own endpoint first), the dev server and any child still running, removes the
/// browser's profile, and brings the stack down only when this run brought it up.
function stopAll() {
  stopping ??= (async () => {
    if (started.browser && started.devtools) {
      try {
        const b = devtools(`ws://127.0.0.1:${started.devtools.port}${started.devtools.path}`);
        await b.open;
        await Promise.race([b.send("Browser.close", {}, 3000), sleep(3000)]);
        b.close();
      } catch {
        /* killed below */
      }
      if (started.browser.exitCode === null) await Promise.race([new Promise((r) => started.browser.once("exit", r)), sleep(5000)]);
    }
    killTree(started.browser);
    started.browser = null;
    for (const c of started.children) killTree(c);
    if (started.server) {
      killTree(started.server);
      started.server = null;
      console.log("the dev server is stopped");
    }
    if (started.profile) {
      // Never fatal: Windows can hold a profile's files for a moment after the browser is gone.
      try {
        rmSync(started.profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 400 });
      } catch (e) {
        console.log(`note: the temporary profile ${started.profile} was not removed: ${oneLine(e)}`);
      }
      started.profile = null;
    }
    if (started.stack) {
      started.stack = false;
      console.log("bringing the stack down (this run brought it up)");
      const r = spawnSync(process.execPath, [join(repo, "script", "local", "up.mjs"), "down"], { cwd: repo, encoding: "utf8", timeout: 90_000 });
      const last = `${r.stdout ?? ""}`.trim().split(/\r?\n/).pop();
      console.log(`  up | ${last || `down exited with ${r.status}`}`);
    }
  })();
  return stopping;
}

// The last word: whatever hangs, the run ends and takes what it started with it.
setTimeout(() => {
  console.log(`✗ gave up: the run did not end within ${timeoutMs / 1000} s`);
  void stopAll().finally(() => process.exit(1));
}, timeoutMs).unref();
process.on("SIGINT", () => {
  console.log("interrupted");
  void stopAll().finally(() => process.exit(130));
});

/// Runs a command to its end, at most `timeoutMs`, keeping the tail of its output; `onLine` sees every line.
function runChild(cmd, args, { cwd, env, timeoutMs: ms, onLine }) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
    started.children.add(child);
    const tail = [];
    let rest = "";
    const take = (d) => {
      const lines = (rest + d).split(/\r?\n/);
      rest = lines.pop() ?? "";
      for (const l of lines) {
        tail.push(l);
        if (tail.length > 40) tail.shift();
        onLine?.(l);
      }
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    const timer = setTimeout(() => {
      tail.push(`(stopped after ${ms / 1000} s)`);
      killTree(child);
    }, ms);
    const done = (code) => {
      clearTimeout(timer);
      started.children.delete(child);
      if (rest) tail.push(rest);
      resolve({ code, tail: tail.slice(-12).join("\n    ") });
    };
    child.on("exit", (code) => done(code ?? 1));
    child.on("error", (e) => {
      tail.push(e.message);
      done(1);
    });
  });
}

function findBrowser() {
  const candidates =
    process.platform === "win32"
      ? [
          "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
          "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
          "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        ]
      : process.platform === "darwin"
        ? ["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
        : ["/usr/bin/microsoft-edge", "/usr/bin/google-chrome", "/usr/bin/chromium"];
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error("no Edge or Chrome found; pass --browser <path>");
  return found;
}

/// A port nothing listens on, for the dev server.
function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.unref();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

/// A minimal DevTools protocol client over Node's WebSocket: every request times out, a closed connection
/// fails whatever was waiting, and events reach every handler registered for them.
function devtools(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const waiting = new Map();
  const handlers = new Map();
  const failAll = (why) => {
    for (const w of waiting.values()) w.reject(new Error(why));
    waiting.clear();
  };
  ws.onmessage = (m) => {
    const msg = JSON.parse(typeof m.data === "string" ? m.data : m.data.toString());
    if (msg.id !== undefined && waiting.has(msg.id)) {
      const w = waiting.get(msg.id);
      waiting.delete(msg.id);
      if (msg.error) w.reject(new Error(`${w.method}: ${msg.error.message}`));
      else w.resolve(msg.result);
    } else if (msg.method) {
      for (const fn of handlers.get(msg.method) ?? []) {
        try {
          fn(msg.params);
        } catch {
          /* a handler's own failure is its own */
        }
      }
    }
  };
  ws.onclose = () => failAll("the browser closed the DevTools connection");
  const open = new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error(`cannot reach ${url}`));
    setTimeout(() => reject(new Error(`no DevTools connection to ${url}`)), 15_000).unref();
  });
  const send = (method, params = {}, ms = 30_000) =>
    new Promise((resolve, reject) => {
      if (ws.readyState !== WebSocket.OPEN) return reject(new Error(`${method}: the DevTools connection is not open`));
      const i = ++id;
      const timer = setTimeout(() => {
        waiting.delete(i);
        reject(new Error(`${method}: no answer in ${ms / 1000} s`));
      }, ms);
      waiting.set(i, {
        method,
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  const on = (method, fn) => {
    if (!handlers.has(method)) handlers.set(method, []);
    handlers.get(method).push(fn);
  };
  return { open, send, on, close: () => ws.close() };
}

// ------------------------------------------------------------------ the chain

let rid = 0;
/// One JSON-RPC call to anvil, its whole answer (result or error) as the node gave it.
async function rpcRaw(method, params = []) {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rid, method, params }),
    signal: AbortSignal.timeout(30_000),
  });
  return r.json();
}
async function rpc(method, params = []) {
  const j = await rpcRaw(method, params);
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}

const pub = createPublicClient({ chain: foundry, transport: http(RPC), pollingInterval: 250 });
const accountOf = (i) => privateKeyToAccount(ANVIL_KEYS[i]);
const walletOf = (i) => createWalletClient({ account: accountOf(i), chain: foundry, transport: http(RPC) });
const addressOf = (i) => DEFAULT_ACCOUNTS[i];

/// A transaction's receipt, which must be a success.
async function mined(hashPromise, what) {
  const hash = await hashPromise;
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 60_000 });
  if (r.status !== "success") throw new Error(`${what} reverted (${hash})`);
  return r;
}

/// A call's name and arguments, short, for the wallet's lines.
function describeCall(data) {
  for (const abi of [metamorphAbi, erc20Abi]) {
    try {
      const d = decodeFunctionData({ abi, data });
      const arg = (x) =>
        Array.isArray(x)
          ? `[${x.map(arg).join(", ")}]`
          : typeof x === "bigint"
            ? x === MAX
              ? "max"
              : x > 10n ** 12n
                ? short(toHex(x))
                : x.toString()
            : typeof x === "string" && x.startsWith("0x")
              ? short(x)
              : String(x);
      return { name: d.functionName, text: `${d.functionName}(${(d.args ?? []).map(arg).join(", ")})`, args: d.args ?? [] };
    } catch {
      /* the next ABI */
    }
  }
  return { name: String(data).slice(0, 10), text: String(data).slice(0, 10), args: [] };
}

// ------------------------------------------------------------------ the dev wallet

/// The dev wallet's side in this process: anvil's account #index, what the page's provider asks it. It is
/// connected to the site only once the site asks for its accounts (eth_requestAccounts or
/// wallet_requestPermissions, as RainbowKit's connect does), as a real wallet is. Transactions are signed here
/// with the account's key and sent raw, one at a time; everything else a wallet passes through goes to anvil.
function devWallet(index) {
  const account = accountOf(index);
  const client = createWalletClient({ account, chain: foundry, transport: http(RPC) });
  const state = { authorized: false, asks: [], sent: [] };
  let queue = Promise.resolve();
  const oneAtATime = (fn) => {
    const p = queue.then(fn, fn);
    queue = p.catch(() => undefined);
    return p;
  };
  const failure = (code, message) => Object.assign(new Error(message), { code });
  const permissions = () => [{ parentCapability: "eth_accounts", caveats: [{ type: "restrictReturnedAccounts", value: [account.address] }] }];

  async function sendTransaction(tx) {
    if (!state.authorized) throw failure(4100, "the dev wallet is not connected to this site");
    if (!tx?.from || !isAddressEqual(tx.from, account.address)) throw failure(4100, "the dev wallet signs for its own account only");
    if (tx.chainId !== undefined && Number(tx.chainId) !== CHAIN_ID) throw failure(4901, `the dev wallet is on chain ${CHAIN_ID}`);
    return oneAtATime(async () => {
      const gas = tx.gas !== undefined ? BigInt(tx.gas) : undefined;
      const hash = await client.sendTransaction({
        to: tx.to,
        data: tx.data,
        value: tx.value !== undefined ? BigInt(tx.value) : undefined,
        gas,
      });
      const call = describeCall(tx.data ?? "0x");
      state.sent.push({ to: tx.to, data: tx.data ?? "0x", name: call.name, args: call.args, gas: gas ?? null, hash });
      console.log(`  wallet | signed ${call.text}${gas ? ` with ${gas.toLocaleString("en-US")} gas` : ""} -> ${short(hash)}`);
      return hash;
    });
  }

  async function handle(method, params = []) {
    switch (method) {
      case "eth_accounts":
        return state.authorized ? [account.address] : [];
      case "eth_requestAccounts":
        state.authorized = true;
        state.asks.push(method);
        return [account.address];
      case "wallet_requestPermissions":
        state.authorized = true;
        state.asks.push(method);
        return permissions();
      case "wallet_getPermissions":
        return state.authorized ? permissions() : [];
      case "wallet_revokePermissions":
        state.authorized = false;
        return null;
      case "eth_chainId":
        return toHex(CHAIN_ID);
      case "net_version":
        return String(CHAIN_ID);
      case "wallet_switchEthereumChain":
        if (Number(params?.[0]?.chainId) === CHAIN_ID) return null;
        throw failure(4902, `the dev wallet knows chain ${CHAIN_ID} only`);
      case "wallet_addEthereumChain":
      case "wallet_watchAsset":
        throw failure(4200, `the dev wallet does not do ${method}`);
      case "eth_sendTransaction":
      case "wallet_sendTransaction":
        return sendTransaction(params[0]);
      case "personal_sign":
        if (!state.authorized) throw failure(4100, "the dev wallet is not connected to this site");
        return account.signMessage({ message: { raw: params[0] } });
      case "eth_sign":
      case "eth_signTransaction":
      case "eth_signTypedData":
      case "eth_signTypedData_v3":
      case "eth_signTypedData_v4":
        throw failure(4200, `the dev wallet does not do ${method}`);
      default: {
        // A read a wallet passes through to its node; anvil's own methods (anvil_*, evm_*) are not a wallet's.
        if (!/^(eth|net|web3)_/.test(String(method))) throw failure(4200, `the dev wallet does not do ${method}`);
        const j = await rpcRaw(method, params);
        if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code, data: j.error.data });
        return j.result;
      }
    }
  }
  return { account, state, handle };
}

/// The page's side: an EIP-1193 provider announced through EIP-6963 (RainbowKit lists it as installed), whose
/// every request goes to this process over the binding and comes back through window.__devWallet.reply. It
/// holds no key and no address. Beside it, a probe counts the Web Workers the page makes and the ones still
/// alive (the CPU engine's threads), so a stop can be seen to end them, and keeps the live job they are handed
/// and the first hashes they find, so the race knows the waiting hash. Only the top frame gets either.
function providerSource() {
  return `(() => {
  if (window.top !== window || window.__devWallet) return;
  const probe = (window.__probe = { made: 0, live: 0, job: null, founds: [] });
  const RealWorker = window.Worker;
  if (RealWorker) {
    window.Worker = class extends RealWorker {
      constructor(...args) {
        super(...args);
        probe.made++;
        probe.live++;
        this.addEventListener("message", (e) => {
          const m = e.data;
          if (m && m.type === "found" && probe.founds.length < 64) probe.founds.push({ jobId: m.jobId, nonce: m.nonce, digest: m.digest });
        });
      }
      postMessage(message, ...rest) {
        const j = message && message.type === "start" ? message.job : null;
        if (j && j.live) probe.job = { id: j.id, anchor: String(j.anchor), anchorHash: j.anchorHash, prevWork: j.prevWork, miner: j.miner };
        return super.postMessage(message, ...rest);
      }
      terminate() { if (!this.__ended) { this.__ended = true; probe.live--; } return super.terminate(); }
    };
  }
  let seq = 0;
  const waiting = new Map();
  const listeners = new Map();
  const reply = (id, answer) => {
    const w = waiting.get(id);
    if (!w) return;
    waiting.delete(id);
    if (answer && answer.error) {
      const e = new Error(answer.error.message);
      e.code = answer.error.code;
      if (answer.error.data !== undefined) e.data = answer.error.data;
      w.reject(e);
    } else w.resolve(answer ? answer.result : null);
  };
  const provider = {
    isPupateDevWallet: true,
    request(args) {
      const method = args && args.method;
      const params = (args && args.params) || [];
      return new Promise((resolve, reject) => {
        const send = window[${JSON.stringify(BINDING)}];
        if (typeof send !== "function") {
          const e = new Error("the dev wallet's driver is not attached");
          e.code = 4900;
          reject(e);
          return;
        }
        const id = ++seq;
        waiting.set(id, { resolve, reject });
        send(JSON.stringify({ id, method, params }));
      });
    },
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
      return provider;
    },
    once(event, fn) {
      const once = (...a) => { provider.removeListener(event, once); fn(...a); };
      return provider.on(event, once);
    },
    removeListener(event, fn) {
      if (listeners.has(event)) listeners.get(event).delete(fn);
      return provider;
    },
  };
  provider.off = provider.removeListener;
  window.__devWallet = { reply };
  const info = Object.freeze({ uuid: ${JSON.stringify(WALLET.uuid)}, name: ${JSON.stringify(WALLET.name)}, icon: ${JSON.stringify(WALLET.icon)}, rdns: ${JSON.stringify(WALLET.rdns)} });
  const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
})();`;
}

// ------------------------------------------------------------------ the steps before the page

function filesUnder(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...filesUnder(p));
    else out.push(p);
  }
  return out;
}

/// The environment the site is built and served with: the caller's, without what the caller sourced for the
/// stack and the keeper (the upstream RPC, keys, API keys and tokens), which the site has no use for.
function siteEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(MAINNET_RPC_URL|RPC)$|PRIVATE_KEY|API_KEY|SECRET|_TOKEN$/i.test(k)) delete env[k];
  return env;
}

/// The production export, built as `npm run build` builds it (for mainnet, the default chain), looked through
/// for anvil's ten keys (as bare hex, so with or without 0x, in either case) and the mnemonic.
async function buildAndLook() {
  let built = "";
  if (!flag("no-build")) {
    const env = siteEnv();
    delete env.NEXT_PUBLIC_CHAIN;
    delete env.NEXT_DIST_DIR;
    const nextBin = createRequire(join(site, "package.json")).resolve("next/dist/bin/next");
    const t0 = Date.now();
    const r = await runChild(process.execPath, [nextBin, "build"], { cwd: site, env, timeoutMs: 600_000 });
    if (r.code !== 0) throw new Error(`next build exited with ${r.code}:\n    ${r.tail}`);
    built = `built in ${secs(t0)}; `;
  }
  const out = join(site, "out");
  if (!existsSync(out)) throw new Error("site/out is missing: run npm run build first, or leave out --no-build");
  const needles = [...ANVIL_KEYS.map((k) => k.slice(2).toLowerCase()), MNEMONIC];
  const files = filesUnder(out);
  const hits = [];
  for (const f of files) {
    const text = readFileSync(f, "latin1").toLowerCase();
    for (const n of needles) if (text.includes(n)) hits.push(`${f.slice(out.length + 1)} holds ${n === MNEMONIC ? "the mnemonic" : `key #${needles.indexOf(n)}`}`);
  }
  if (hits.length) throw new Error(`the export carries a dev key: ${hits.slice(0, 6).join("; ")}`);
  return `${built}${files.length} files under site/out, none with one of anvil's ten keys or its mnemonic`;
}

/// "up" when the stack answers with Metamorph MD in its addresses file, "down" when nothing answers, else what is wrong.
async function stackState() {
  let chain;
  try {
    chain = Number(await rpc("eth_chainId"));
  } catch {
    return "down";
  }
  if (chain !== CHAIN_ID) return `something answers on ${RPC} for chain ${chain}`;
  if (!existsSync(ADDRESSES_FILE)) return `anvil answers on ${RPC} but ${ADDRESSES_FILE} is missing`;
  const a = JSON.parse(readFileSync(ADDRESSES_FILE, "utf8"));
  return a.metamorph ? "up" : `the addresses file has no metamorph (an older stack)`;
}

async function ensureStack() {
  const s = await stackState();
  if (s === "up") return "it was up already, and stays up after the run";
  if (s !== "down") throw new Error(`${s}: bring it down (node script/local/up.mjs down) and run again`);
  if (!process.env.MAINNET_RPC_URL && !readDotEnv().MAINNET_RPC_URL) {
    throw new Error(
      "the stack is down, and bringing it up needs MAINNET_RPC_URL: source the main checkout's .env in this shell " +
        "first (set -a; . <checkout>/.env; set +a), or start the stack yourself with node script/local/up.mjs",
    );
  }
  console.log("  the stack is down: bringing it up with script/local/up.mjs (MAINNET_RPC_URL from the caller's environment, never printed)");
  started.stack = true;
  const t0 = Date.now();
  const r = await runChild(process.execPath, [join(repo, "script", "local", "up.mjs")], {
    cwd: repo,
    env: process.env,
    timeoutMs: 480_000,
    onLine: (l) => {
      if (/^== |^ {2}(ok|FAIL) /.test(l)) console.log(`  up | ${l.trim()}`);
    },
  });
  if (r.code !== 0) throw new Error(`up.mjs exited with ${r.code}:\n    ${r.tail}`);
  const now = await stackState();
  if (now !== "up") throw new Error(`up.mjs ended, but ${now}`);
  return `brought up in ${secs(t0)}; it goes down again at the end`;
}

/// The run's own state on the chain: one bit, PUPATE for the dev wallet and the rival, the dev wallet's
/// allowance at zero (so the page asks for the approval as on a first visit), the rival's at the maximum, and a
/// buy through the Universal Router (the site's own swap) so the launch pool holds ETH for the conversion and
/// the hook holds tax for the first mint to flush.
async function fixture(run) {
  const a = JSON.parse(readFileSync(ADDRESSES_FILE, "utf8"));
  run.a = a;
  run.md = { address: a.metamorph, abi: metamorphAbi };
  run.view = (functionName, args) => pub.readContract({ ...run.md, functionName, args });
  run.balance = (token, who) => pub.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [who] });
  // The vault's seats, for the account of the run only: with none the mine is open all the same, and the
  // contract draws each card's seat from the whole collection (the commons).
  const seats = await run.view("mineableSeats");
  const from = Number(await run.view("bits"));
  const bits = await easeToOneBit(run);
  if (bits !== 1) throw new Error(`the difficulty stays at ${bits} bits`);
  const price = await run.view("mintPrice");
  const dev = addressOf(DEV);
  const funded = [];
  for (const [who, want] of [
    [DEV, price * 20n],
    [RIVAL, price * 4n],
  ]) {
    const have = await run.balance(a.token, addressOf(who));
    if (have >= want) continue;
    const pool = await run.balance(a.token, addressOf(FUNDER));
    if (pool < want - have) throw new Error(`anvil #${FUNDER} (the swarm share's stand-in) holds ${tokens(pool)} PUPATE, too little: bring a fresh stack up`);
    await mined(walletOf(FUNDER).writeContract({ address: a.token, abi: erc20Abi, functionName: "transfer", args: [addressOf(who), want - have] }), "a PUPATE transfer");
    funded.push(`#${who} ${tokens(want)} PUPATE`);
  }
  const allowance = (who) => pub.readContract({ address: a.token, abi: erc20Abi, functionName: "allowance", args: [addressOf(who), a.metamorph] });
  if ((await allowance(DEV)) !== 0n) await mined(walletOf(DEV).writeContract({ address: a.token, abi: erc20Abi, functionName: "approve", args: [a.metamorph, 0n] }), "the allowance reset");
  if ((await allowance(RIVAL)) < price * 4n) await mined(walletOf(RIVAL).writeContract({ address: a.token, abi: erc20Abi, functionName: "approve", args: [a.metamorph, MAX] }), "the rival's approval");
  const head = await pub.getBlock();
  const buy = buildSwap(a, true, E18 / 5n, 0n, head.timestamp + 1200n);
  await mined(walletOf(BUYER).sendTransaction({ to: buy.to, data: buy.data, value: buy.value }), "the router buy");
  const due = await run.view("dutiesDue");
  const held = seats.length ? `seat${seats.length > 1 ? "s" : ""} ${seats.map((s) => `#${s}`).join(", ")} mineable` : "no seat held: the cards draw from the whole collection (the commons)";
  return (
    `${held}; difficulty ${from} -> ${bits} bit; ` +
    `${funded.length ? `funded ${funded.join(", ")}; ` : ""}the dev wallet is anvil #${DEV} ${short(dev)} with ${tokens(await run.balance(a.token, dev))} PUPATE and no allowance; ` +
    `#${BUYER} bought PUPATE for 0.2 ETH through the Universal Router; dutiesDue() (flush ${due[0]}, burn ${due[1]}, convert ${due[2]})`
  );
}

/// Silence eases the target by four every 360 s; the fixture's clock is moved on until one bit is back.
async function easeToOneBit(run) {
  let bits = Number(await run.view("bits"));
  for (let i = 0; i < 8 && bits > 1; i++) {
    await rpc("evm_increaseTime", [360 * Math.ceil((bits - 1) / 2) + 1]);
    await rpc("evm_mine");
    bits = Number(await run.view("bits"));
  }
  return bits;
}

async function startServer(run) {
  const port = Number(opt("port", "0")) || (await freePort());
  run.base = `http://localhost:${port}`;
  const env = { ...siteEnv(), NEXT_PUBLIC_CHAIN: "local" };
  const t0 = Date.now();
  const tail = [];
  started.server = spawn(process.execPath, ["scripts/dev.mjs", "-p", String(port)], { cwd: site, env, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
  const keep = (d) => {
    tail.push(...String(d).split(/\r?\n/).filter(Boolean));
    tail.splice(0, Math.max(0, tail.length - 20));
  };
  started.server.stdout.on("data", keep);
  started.server.stderr.on("data", keep);
  const until = Date.now() + 300_000;
  let last = "";
  for (;;) {
    if (started.server.exitCode !== null) throw new Error(`the dev server exited (${started.server.exitCode}):\n    ${tail.join("\n    ")}`);
    try {
      // The first request compiles the page, which can take a minute or two.
      const r = await fetch(`${run.base}/mine/`, { signal: AbortSignal.timeout(Math.max(1000, Math.min(240_000, until - Date.now()))) });
      if (r.ok) break;
      last = `HTTP ${r.status}`;
    } catch (e) {
      last = oneLine(e);
    }
    if (Date.now() > until) throw new Error(`the dev server did not answer on ${run.base}/mine/: ${last}`);
    await sleep(1000);
  }
  // The other pages the run visits, compiled before the visit so the navigation is quick.
  for (const p of ["/cards/", "/cards/view/"]) await fetch(`${run.base}${p}`, { signal: AbortSignal.timeout(240_000) }).catch(() => undefined);
  return `${run.base} with NEXT_PUBLIC_CHAIN=local, /mine/ and /cards/ compiled in ${secs(t0)}`;
}

async function startBrowser(run, wallet) {
  const exe = opt("browser", "") || findBrowser();
  started.profile = mkdtempSync(join(tmpdir(), "pupate-mine-live-"));
  // A fresh profile on about:blank: Edge's sync and first-run pages stay away, and the run attaches to the
  // blank page (an Edge dialog can be a page target of its own).
  const args = [
    "--headless=new",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    "--disable-background-networking",
    "--disable-component-update",
    "--password-store=basic",
    `--user-data-dir=${started.profile}`,
    "--remote-debugging-port=0",
    "--window-size=1280,1600",
    "about:blank",
  ];
  started.browser = spawn(exe, args, { stdio: ["ignore", "ignore", "pipe"], detached: process.platform !== "win32" });
  const stderr = [];
  started.browser.stderr.on("data", (d) => {
    stderr.push(...String(d).split(/\r?\n/).filter(Boolean));
    stderr.splice(0, Math.max(0, stderr.length - 20));
  });
  const alive = () => {
    if (started.browser.exitCode !== null) throw new Error(`the browser exited (${started.browser.exitCode}): ${stderr.slice(-5).join(" | ")}`);
  };
  const portFile = join(started.profile, "DevToolsActivePort");
  const until = Date.now() + 30_000;
  while (!existsSync(portFile) || !readFileSync(portFile, "utf8").includes("\n")) {
    alive();
    if (Date.now() > until) throw new Error("the browser did not open its DevTools port");
    await sleep(200);
  }
  const [port, path] = readFileSync(portFile, "utf8").trim().split("\n");
  started.devtools = { port, path };
  let target = null;
  for (let i = 0; i < 50 && !target; i++) {
    alive();
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5000) })).json();
    target = list.find((t) => t.type === "page" && t.url === "about:blank") ?? null;
    if (!target) await sleep(200);
  }
  if (!target) throw new Error("no about:blank page to attach to");
  const page = devtools(target.webSocketDebuggerUrl);
  await page.open;
  run.page = page;
  run.errors = [];
  page.on("Runtime.consoleAPICalled", (p) => {
    if (p.type === "error") run.errors.push(p.args.map((x) => x.value ?? x.description ?? "").join(" ").slice(0, 300));
  });
  page.on("Runtime.exceptionThrown", (p) => run.errors.push(`exception: ${(p.exceptionDetails.exception?.description ?? p.exceptionDetails.text ?? "").split("\n")[0]}`));
  // The wallet's requests, answered in the page's own context.
  page.on("Runtime.bindingCalled", async (p) => {
    if (p.name !== BINDING) return;
    let req;
    try {
      req = JSON.parse(p.payload);
    } catch {
      return;
    }
    let answer;
    try {
      answer = { result: (await wallet.handle(req.method, req.params)) ?? null };
    } catch (e) {
      answer = { error: { code: typeof e?.code === "number" ? e.code : -32603, message: oneLine(e?.shortMessage ?? e?.message ?? e), data: e?.data } };
    }
    const expression = `window.__devWallet && window.__devWallet.reply(${Number(req.id)}, ${JSON.stringify(answer)})`;
    page.send("Runtime.evaluate", { expression, contextId: p.executionContextId }, 10_000).catch(() => undefined);
  });
  // The page's requests to the node can wait at the browser's door for a moment (the race); otherwise they go on.
  // While `watch` is on, the mint calls the page asks the node to estimate are noted (the race checks which hash
  // the page tried).
  run.hold = { on: false, watch: false, held: [], estimates: [] };
  page.on("Fetch.requestPaused", (p) => {
    const calls = rpcCalls(requestBody(p.request));
    if (run.hold.watch) {
      for (const c of calls) if (c?.method === "eth_estimateGas" && c.params?.[0]?.data) run.hold.estimates.push(String(c.params[0].data));
    }
    if (run.hold.on) run.hold.held.push({ id: p.requestId, methods: calls.map((c) => c?.method).filter(Boolean) });
    else page.send("Fetch.continueRequest", { requestId: p.requestId }).catch(() => undefined);
  });
  await page.send("Runtime.enable");
  await page.send("Page.enable");
  await page.send("Runtime.addBinding", { name: BINDING });
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: providerSource() });
  return `${basename(exe)} --headless=new on a fresh profile, attached to about:blank; the dev wallet "${WALLET.name}" (${WALLET.rdns}) is anvil #${DEV} ${short(addressOf(DEV))}, signed for in this process`;
}

/// A paused request's body, from postData or postDataEntries.
function requestBody(request) {
  if (typeof request.postData === "string") return request.postData;
  if (Array.isArray(request.postDataEntries)) return request.postDataEntries.map((e) => Buffer.from(e.bytes ?? "", "base64").toString("utf8")).join("");
  return "";
}

/// The JSON-RPC calls in a request body (one, or a batch).
function rpcCalls(body) {
  try {
    const j = JSON.parse(body);
    return Array.isArray(j) ? j : [j];
  } catch {
    return [];
  }
}

// ------------------------------------------------------------------ the page

/// The page's helpers, each one evaluation in the page.
function pageTools(run) {
  const ev = async (expression, ms = 20_000) => {
    const r = await run.page.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, ms);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description?.split("\n")[0] ?? r.exceptionDetails.text);
    return r.result.value;
  };
  /// A function of the page's, with JSON arguments.
  const call = (fn, ...args) => ev(`(${fn})(${args.map((x) => JSON.stringify(x)).join(", ")})`);
  const t = {
    ev,
    call,
    path: () => ev("location.pathname"),
    cta: () => ev(`document.querySelector(".mine-cta")?.textContent.trim() ?? null`),
    ctaEnabled: () => ev(`(() => { const b = document.querySelector(".mine-cta"); return !!b && !b.disabled; })()`),
    /// The field notes, newest first, without their times.
    notes: () => ev(`[...document.querySelectorAll(".notes li")].map((li) => (li.lastElementChild?.textContent ?? "").trim())`),
    /// The workspace's line under its bar.
    wsNote: () => ev(`document.querySelector(".ws-note")?.textContent.trim() ?? null`),
    probe: () => ev(`({ ...(window.__probe ?? { made: -1, live: -1 }) })`),
    /// The band "The mine, in numbers": label -> text.
    band: () =>
      call(() =>
        Object.fromEntries(
          [...document.querySelectorAll(".numbers dl > div")].map((d) => [d.querySelector("dt")?.textContent.trim(), d.querySelector("dd")?.textContent.replace(/\s+/g, " ").trim()]),
        ),
      ),
    /// Clicks the enabled element under `selector` whose text is `label`.
    click: (selector, label) =>
      call(
        (sel, text) => {
          const b = [...document.querySelectorAll(sel)].find((e) => e.textContent.trim() === text && !e.disabled);
          if (!b) return false;
          b.click();
          return true;
        },
        selector,
        label,
      ),
    /// Follows one of the top bar's links, as a visitor does (no reload: the wallet stays connected).
    nav: (href) =>
      call((h) => {
        const l = document.querySelector(`nav.nav a[href="${h}"]`);
        if (!l) return false;
        l.click();
        return true;
      }, href),
    /// The workspace's tile of card `id`: its caption, its marks, its image, whether it is selected.
    tile: (id) =>
      call((n) => {
        const li = [...document.querySelectorAll("section.cards-page ul.tiles li.tile")].find((x) => x.querySelector(".tile-id")?.textContent.trim() === `#${n}`);
        if (!li) return null;
        const img = li.querySelector("img");
        return {
          caption: [...li.querySelectorAll(".tile-cap > span")].map((x) => x.textContent.trim()).join(" · "),
          stage: li.querySelector(".tile-stage")?.textContent.trim(),
          seat: li.querySelector(".tile-seat")?.textContent.trim(),
          staked: !!li.querySelector(".mark.staked"),
          gilt: !!li.querySelector(".mark.gilt"),
          pressed: li.querySelector("button")?.getAttribute("aria-pressed") === "true",
          src: img?.getAttribute("src") ?? null,
          alt: img?.alt ?? null,
          drawn: !!img && img.complete && img.naturalWidth > 0,
        };
      }, id),
    /// Scrolls the tile into view (its image is read once it is seen) and taps it.
    showTile: (id) =>
      call((n) => {
        const li = [...document.querySelectorAll("section.cards-page ul.tiles li.tile")].find((x) => x.querySelector(".tile-id")?.textContent.trim() === `#${n}`);
        li?.scrollIntoView({ block: "center" });
        return !!li;
      }, id),
    tapTile: (id) =>
      call((n) => {
        const li = [...document.querySelectorAll("section.cards-page ul.tiles li.tile")].find((x) => x.querySelector(".tile-id")?.textContent.trim() === `#${n}`);
        const b = li?.querySelector("button[aria-pressed]");
        if (!b) return false;
        b.click();
        return true;
      }, id),
    figure: () => ev(`document.querySelector(".ws-figure .num")?.textContent.trim() ?? null`),
  };
  /// Polls `fn` until it gives something truthy, at most `ms`; the failure says where the page stood.
  t.until = async (what, fn, ms = 30_000, every = 200) => {
    const end = Date.now() + ms;
    let err = null;
    for (;;) {
      try {
        const v = await fn();
        if (v) return v;
      } catch (e) {
        err = e;
      }
      if (Date.now() > end) throw new Error(`${what}: not seen within ${ms / 1000} s${err ? ` (last error: ${oneLine(err)})` : ""}${await t.where()}`);
      await sleep(every);
    }
  };
  /// Where the page stands, for a failure: the path, the main button, the newest notes or the workspace's line.
  t.where = async () => {
    try {
      const [p, c, n, w] = await Promise.all([t.path(), t.cta(), t.notes(), t.wsNote()]);
      return `; on ${p}${c ? `, the button reads "${c}"` : ""}${w ? `, the line reads "${w}"` : ""}${n.length ? `, the newest notes: ${n.slice(0, 5).join(" | ")}` : ""}`;
    } catch {
      return "";
    }
  };
  return t;
}

// ------------------------------------------------------------------ the run

const results = [];
let stopped = null;
/// One step: ✓ with what it saw, or ✗ with what was missing. After a ✗ the run's later steps are not run
/// (each leans on the one before), except those marked independent.
async function step(name, fn, { independent = false } = {}) {
  if (stopped && !independent) {
    results.push({ name, ok: null });
    console.log(`- ${name}  (not run)`);
    return undefined;
  }
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true });
    console.log(`✓ ${name}  [${secs(t0)}]${detail ? `\n    ${String(detail).split("\n").join("\n    ")}` : ""}`);
    return true;
  } catch (e) {
    results.push({ name, ok: false });
    const text = String(e instanceof Error ? e.message : e);
    console.log(`✗ ${name}  [${secs(t0)}]\n    ${text.split("\n").join("\n    ")}`);
    if (!independent) stopped = `"${name}" failed`;
    return false;
  }
}

async function main() {
  console.log(`mine-live: the live mine page, end to end, on the local stack (${RPC}) in headless Edge with a dev wallet`);
  const run = {};
  const wallet = devWallet(DEV);
  const dev = wallet.account.address;
  let t;

  await step("the production build carries no dev key", buildAndLook, { independent: true });
  await step("the local stack: Metamorph MD at one bit", ensureStack);
  await step("the run's fixture on the chain", () => fixture(run));
  await step("the dev server against the stack", () => startServer(run));
  await step("headless Edge, the dev wallet put into every page it opens", async () => {
    const d = await startBrowser(run, wallet);
    t = pageTools(run);
    return d;
  });

  // ---------------------------------------------------------------- /mine/: connect, approve, mine, stop

  await step("/mine/ opens live: no preview, the numbers read from the chain", async () => {
    await run.page.send("Page.navigate", { url: `${run.base}/mine/` });
    const b = await t.until(
      "the live band at one bit",
      async () => {
        if ((await t.path()) !== "/mine/") return null;
        if (await t.ev(`[...document.querySelectorAll(".chip")].some((c) => c.textContent.includes("Preview"))`)) return null;
        const x = await t.band();
        return x.difficulty?.endsWith("· 1 bit") && /^\d/.test(x.minted ?? "") ? x : null;
      },
      120_000,
      300,
    );
    run.mintedBefore = int(b.minted);
    const total = Number(await run.view("totalMinted"));
    if (run.mintedBefore !== total) throw new Error(`the band reads ${b.minted} minted, totalMinted() is ${total}`);
    await t.until('"Connect wallet" on the main button', async () => (await t.cta()) === "Connect wallet", 20_000);
    const price = await t.ev(`document.querySelector(".mint-price")?.textContent.replace(/\\s+/g, " ").trim()`);
    return (
      `no preview chip; "${price}"; the band: minted ${b.minted} (totalMinted() ${total}), epoch ${b.epoch}, ${b.price}, ` +
      `difficulty ${b.difficulty}, network rate ${b["network rate"]}, since the last mint ${b["since the last mint"]}; the button reads "Connect wallet"`
    );
  });

  await step("Connect wallet: RainbowKit's modal offers the dev wallet as an installed one, and it connects", async () => {
    await t.until(
      "the wallet layer (the top bar's Connect enabled)",
      () => t.ev(`[...document.querySelectorAll(".topbar button")].some((b) => b.textContent.trim() === "Connect" && !b.disabled)`),
      30_000,
    );
    if (!(await t.click(".mine-cta", "Connect wallet"))) throw new Error('no "Connect wallet" to press');
    const option = `[data-testid="rk-wallet-option-${WALLET.rdns}"]`;
    const modal = await t.until(
      "the dev wallet in RainbowKit's modal",
      () =>
        t.call((sel) => {
          const o = document.querySelector(sel);
          if (!o) return null;
          const dialog = o.closest('[role="dialog"]') ?? document.body;
          return {
            label: o.textContent.trim(),
            installed: dialog.textContent.includes("Installed"),
            options: [...new Set([...dialog.querySelectorAll('[data-testid^="rk-wallet-option-"]')].map((e) => e.textContent.trim()))],
          };
        }, option),
      20_000,
    );
    if (!modal.installed) throw new Error(`the modal lists ${modal.options.join(", ")}, with no "Installed" group`);
    await t.call((sel) => document.querySelector(sel).click(), option);
    await t.until(
      'the wallet connected: the modal gone, "Approve PUPATE" on the button',
      async () => !(await t.ev(`!!document.querySelector(${JSON.stringify(option)})`)) && (await t.cta()) === "Approve PUPATE",
      30_000,
    );
    if (!wallet.state.asks.length) throw new Error("the page never asked the dev wallet for its accounts");
    const shown = await t.ev(`document.querySelector(".readings dd")?.textContent.trim()`);
    const bar = await t.call(() => {
      const b = [...document.querySelectorAll(".topbar button")].find((x) => x.textContent.includes("…"));
      const dim = b?.querySelector(".dim")?.textContent ?? "";
      return b ? `${b.textContent.replace(dim, "").trim()}${dim ? ` (${dim})` : ""}` : null;
    });
    return (
      `the modal lists ${modal.options.map((o) => `"${o}"`).join(", ")}, "${modal.label}" under Installed; pressed, the page asked ` +
      `${wallet.state.asks.join(" and ")}; the readings show the wallet ${shown}, the top bar ${bar}; the button reads "Approve PUPATE"`
    );
  });

  await step("Approve PUPATE: one approval, to the maximum, signed by the dev wallet", async () => {
    const sent0 = wallet.state.sent.length;
    if (!(await t.click(".mine-cta", "Approve PUPATE"))) throw new Error('no "Approve PUPATE" to press');
    await t.until(`the note "${SAYS.approved}"`, async () => (await t.notes()).includes(SAYS.approved), 45_000);
    await t.until('"Start mining" on the button, enabled', async () => (await t.cta()) === "Start mining" && (await t.ctaEnabled()), 30_000);
    const sent = wallet.state.sent.slice(sent0);
    if (sent.length !== 1 || sent[0].name !== "approve" || !isAddressEqual(sent[0].to, run.a.token) || sent[0].args[1] !== MAX) {
      throw new Error(`the wallet signed ${sent.map((s) => describeCall(s.data).text).join(", ") || "nothing"}`);
    }
    const allowance = await pub.readContract({ address: run.a.token, abi: erc20Abi, functionName: "allowance", args: [dev, run.a.metamorph] });
    if (allowance !== MAX) throw new Error(`allowance() is ${allowance}`);
    return `one transaction, approve(Metamorph MD, max) ${short(sent[0].hash)}; allowance() is type(uint256).max; the notes say "${SAYS.approving}", then "${SAYS.approved}"; the button reads "Start mining"`;
  });

  await step("Start mining, on the CPU, at one bit", async () => {
    const engine = await t.ev(`[...document.querySelectorAll(".pair .switch")].find((b) => b.getAttribute("aria-pressed") === "true")?.textContent.trim() ?? null`);
    if (engine !== "CPU") throw new Error(`the engine picked is ${engine}`);
    const bits = Number(await run.view("bits"));
    if (bits !== 1) throw new Error(`bits() is ${bits}`);
    run.sent0 = wallet.state.sent.length;
    if (!(await t.click(".mine-cta", "Start mining"))) throw new Error('no "Start mining" to press');
    const line = await t.until("the start line", async () => (await t.notes()).find((l) => /^started on CPU at \d+% power · \d+ threads? · live, 1 bits?$/.test(l)), 30_000);
    return `the engine is the CPU and bits() is 1; "${line}"`;
  });

  await step("the success line: Metamorph.md #<n> is yours · seat identity.md #<seat> · mining the next one", async () => {
    const re = /^Metamorph\.md #(\d+) is yours · seat identity\.md #(\d+)( · gilt)? · mining the next one$/;
    const line = await t.until("the success line", async () => (await t.notes()).find((l) => re.test(l)), 120_000, 100);
    // Stopped at once, so the session's mints stay few; the next step looks at the stop.
    run.stopPressed = await t.click(".mine-cta", "Stop mining");
    const [, id, seat, gilt] = re.exec(line);
    run.card = { id: Number(id), seat: Number(seat), gilt: !!gilt };
    const owner = await run.view("ownerOf", [BigInt(id)]);
    const c = await run.view("cards", [BigInt(id)]);
    if (!isAddressEqual(owner, dev) || !isAddressEqual(c[6], dev)) throw new Error(`card #${id} is held by ${owner} and was mined by ${c[6]}`);
    if (Number(c[0]) !== run.card.seat || c[3] !== run.card.gilt) throw new Error(`cards(${id}) says seat ${c[0]}, gilt ${c[3]}`);
    const notes = (await t.notes()).reverse();
    const from = notes.findIndex((l) => l.startsWith("started on CPU"));
    const at = notes.indexOf(line);
    const mint = wallet.state.sent.slice(run.sent0).find((s) => s.name === "mint");
    return (
      `"${line}"; ownerOf(${id}) and cards(${id}).miner are the dev wallet, seat #${c[0]}, gilt ${c[3]}; the mint was signed with ` +
      `${mint?.gas?.toLocaleString("en-US") ?? "?"} gas; the notes from the start: ${notes.slice(from + 1, at + 3).join(" | ")}`
    );
  });

  await step("Stop mining stops: the button, the engines, nothing minted or signed after it", async () => {
    if (!run.stopPressed && !(await t.click(".mine-cta", "Stop mining"))) throw new Error('no "Stop mining" to press');
    // A mint already on its way when Stop was pressed lands by itself; then the button comes back.
    await t.until('"Start mining" on the button again', async () => (await t.cta()) === "Start mining", 60_000);
    const notes = await t.notes();
    const stopLine = notes.find((l) => /^stopped( · |$)/.test(l));
    if (!stopLine) throw new Error(`no "stopped" in the notes: ${notes.slice(0, 5).join(" | ")}`);
    const p = await t.probe();
    if (p.live !== 0) throw new Error(`${p.live} of the ${p.made} Workers made are still alive`);
    const minted = Number(await run.view("totalMinted"));
    const sent = wallet.state.sent.length;
    await sleep(5000);
    const minted2 = Number(await run.view("totalMinted"));
    if (minted2 !== minted || wallet.state.sent.length !== sent || (await t.probe()).live !== 0) {
      throw new Error(`after the stop: totalMinted ${minted} -> ${minted2}, ${wallet.state.sent.length - sent} more transaction(s) signed`);
    }
    const state = await t.ev(`document.querySelector(".instruments .state")?.textContent.trim()`);
    const rate = await t.ev(`[...(document.querySelector(".instruments .rate")?.children ?? [])].map((c) => c.textContent.trim()).filter(Boolean).join(" ")`);
    const cards = (await t.notes()).filter((l) => / is yours · /.test(l));
    return (
      `"${stopLine}"; the button reads "Start mining", the state "${state}", the rate "${rate}"; ${p.made} Workers made, none alive; ` +
      `${cards.length} card(s) minted this session (${cards.reverse().join(" | ")}); 5 s later nothing more minted or signed`
    );
  });

  await step("the drawer shows the card with its real image: tokenURI's SVG, as a data URI", async () => {
    const { id, seat, gilt } = run.card;
    const alt = `Metamorph.md #${id} · seat identity.md #${seat}${gilt ? " · gilt" : ""}`;
    const img = await t.until(
      `the drawer's <img alt="${alt}">`,
      () =>
        t.call((a) => {
          const i = [...document.querySelectorAll("section.drawer img")].find((x) => x.alt === a);
          return i && i.complete && i.naturalWidth > 0 ? { src: i.getAttribute("src"), w: i.naturalWidth, label: i.parentElement?.textContent.replace(/\s+/g, " ").trim() } : null;
        }, alt),
      30_000,
    );
    if (!img.src.startsWith("data:image/svg+xml;base64,")) throw new Error(`its src begins ${img.src.slice(0, 40)}`);
    const chain = imageOf(await run.view("tokenURI", [BigInt(id)]));
    if (img.src !== chain) throw new Error(`its image is not tokenURI(${id})'s (${img.src.length} characters against ${chain?.length})`);
    const svg = Buffer.from(img.src.slice("data:image/svg+xml;base64,".length), "base64").toString("utf8");
    if (!/^<svg[\s>]/.test(svg.trimStart())) throw new Error("the data URI does not hold an SVG");
    run.image = img.src;
    return (
      `<img alt="${alt}" src="data:image/svg+xml;base64,…"> (${img.src.length.toLocaleString("en-US")} characters, drawn ${img.w} px wide), ` +
      `byte for byte tokenURI(${id})'s image, an SVG of ${svg.length.toLocaleString("en-US")} bytes; its label "${img.label}"`
    );
  });

  await step("the numbers header follows: minted grew, as totalMinted() reads", async () => {
    const total = Number(await run.view("totalMinted"));
    if (!(total > run.mintedBefore)) throw new Error(`totalMinted() is ${total}, as before the run`);
    const b = await t.until(`the band to read ${total} minted`, async () => {
      const x = await t.band();
      return int(x.minted) === total ? x : null;
    }, 15_000);
    return `minted ${run.mintedBefore} -> ${b.minted}; percent minted ${b["percent minted"]}; difficulty ${b.difficulty}; network rate ${b["network rate"]}; since the last mint ${b["since the last mint"]}`;
  });

  // ---------------------------------------------------------------- /cards/: the tile, stake, claim, unstake

  await step("/cards/: the card's tile, with its image", async () => {
    const { id, seat, gilt } = run.card;
    if (!(await t.nav("/cards/"))) throw new Error('no "Your cards" link in the top bar');
    await t.until("the cards page", async () => (await t.path()) === "/cards/", 30_000);
    await t.until(`the tile of #${id}`, () => t.showTile(id), 60_000, 300);
    const tile = await t.until(
      `the image on #${id}'s tile`,
      async () => {
        await t.showTile(id);
        const x = await t.tile(id);
        return x?.src && x.drawn ? x : null;
      },
      45_000,
      300,
    );
    if (tile.src !== run.image) throw new Error("the tile's image is not the drawer's (tokenURI's)");
    if (tile.stage !== "in the cocoon" || tile.seat !== `seat identity.md #${seat}` || tile.gilt !== gilt || tile.staked) throw new Error(`the tile reads "${tile.caption}"`);
    const fig = await t.until("the figure", async () => {
      const f = await t.figure();
      return f && f !== "…" ? f : null;
    }, 30_000);
    const count = await t.ev(`document.querySelectorAll("section.cards-page ul.tiles li.tile").length`);
    return `"${tile.caption}", its <img> tokenURI's image (the drawer's, byte for byte); ${count} card(s) in the wallet; "IMD earned, not claimed" reads ${fig} IMD`;
  });

  await step("Stake: the card is staked, and marked so", async () => {
    const { id } = run.card;
    if (!(await t.tapTile(id))) throw new Error(`no tile #${id} to tap`);
    await t.until(`#${id} selected`, async () => (await t.tile(id))?.pressed, 5_000);
    const sent0 = wallet.state.sent.length;
    if (!(await t.click(".ws-bar button", "Stake"))) throw new Error('no enabled "Stake"');
    await t.until(`"Staked #${id}."`, async () => (await t.wsNote()) === `Staked #${id}.`, 45_000);
    const tile = await t.until(`the staked mark on #${id}`, async () => {
      const x = await t.tile(id);
      return x?.staked ? x : null;
    }, 30_000);
    const [staker, weight] = await run.view("stakeOf", [BigInt(id)]);
    if (!isAddressEqual(staker, dev) || Number(weight) !== 1) throw new Error(`stakeOf(${id}) is ${staker}, weight ${weight}`);
    const s = wallet.state.sent.slice(sent0);
    if (s.length !== 1 || s[0].name !== "stake") throw new Error(`the wallet signed ${s.map((x) => describeCall(x.data).text).join(", ") || "nothing"}`);
    return `${describeCall(s[0].data).text} ${short(s[0].hash)}; "Staked #${id}."; the tile reads "${tile.caption}"; stakeOf(${id}) is the dev wallet, weight 1`;
  });

  await step("a credit for the stakers: convert() from another anvil key, and the figure shows it", async () => {
    if ((await run.view("pot")) === 0n) throw new Error("the pot is empty");
    const spacing = BigInt(await run.view("CONVERT_SPACING"));
    const last = await run.view("lastConvertBlock");
    const head = await pub.getBlockNumber({ cacheTime: 0 });
    if (head + 1n < last + spacing) await rpc("anvil_mine", [toHex(last + spacing - head - 1n)]);
    // A refusal is told by its name before anything is sent.
    await pub.simulateContract({ ...run.md, functionName: "convert", account: addressOf(CALLER) });
    const r = await mined(walletOf(CALLER).writeContract({ ...run.md, functionName: "convert", gas: 3_000_000n }), "convert()");
    const [c] = parseEventLogs({ abi: metamorphAbi, logs: r.logs.filter((l) => isAddressEqual(l.address, run.a.metamorph)), eventName: "Converted" });
    if (!c || c.args.imdBought === 0n) throw new Error("no Converted with IMD bought in the receipt");
    // The card's share, read from the chain: weight × accIMDPerWeight − debt, over 1e18. The figure itself is
    // held to the wei by the claim below, which must pay exactly what it shows.
    const acc = await run.view("accIMDPerWeight");
    const [, weight, debt] = await run.view("stakeOf", [BigInt(run.card.id)]);
    const share = (BigInt(weight) * acc - debt) / E18;
    if (share === 0n) throw new Error(`card #${run.card.id} earned nothing from the conversion`);
    const want = await t.until("the figure to show the credit", async () => {
      const f = await t.figure();
      return f && f !== "…" && f !== "0.0000" ? f : null;
    }, 45_000, 500);
    run.figure = want;
    return (
      `convert() from anvil #${CALLER}: ${tokens(c.args.pupateSold)} PUPATE sold for ${tokens(c.args.ethBought)} ETH, ${tokens(c.args.imdBought)} IMD bought ` +
      `(the caller's reward ${tokens(c.args.reward)} IMD); card #${run.card.id}'s share on the chain is ${imd4(share)} IMD; "IMD earned, not claimed" reads ${want} IMD`
    );
  });

  await step("Claim IMD: what the staked card earned comes to the wallet", async () => {
    const sel = await t.ev(`document.querySelector(".ws-bar .sel")?.textContent.replace(/\\s+/g, " ").trim() ?? ""`);
    if (/selected/.test(sel)) throw new Error(`a selection is on: "${sel}"`);
    const before = await run.balance(run.a.imd, dev);
    const sent0 = wallet.state.sent.length;
    if (!(await t.click(".ws-bar button", "Claim IMD"))) throw new Error('no enabled "Claim IMD"');
    const note = await t.until('"Claimed <x> IMD."', async () => {
      const w = await t.wsNote();
      return w && /^Claimed [\d,]+\.\d{4} IMD\.$/.test(w) ? w : null;
    }, 45_000);
    const s = wallet.state.sent.slice(sent0);
    if (s.length !== 1 || s[0].name !== "claim") throw new Error(`the wallet signed ${s.map((x) => describeCall(x.data).text).join(", ") || "nothing"}`);
    const r = await pub.getTransactionReceipt({ hash: s[0].hash });
    const [ev] = parseEventLogs({ abi: metamorphAbi, logs: r.logs.filter((l) => isAddressEqual(l.address, run.a.metamorph)), eventName: "Claimed" });
    if (!ev || !isAddressEqual(ev.args.staker, dev) || ev.args.imd === 0n) throw new Error("no Claimed for the dev wallet in the receipt");
    const after = await run.balance(run.a.imd, dev);
    if (after - before !== ev.args.imd) throw new Error(`the wallet's IMD moved by ${after - before} wei, Claimed says ${ev.args.imd}`);
    if (note !== `Claimed ${imd4(ev.args.imd)} IMD.`) throw new Error(`the line reads "${note}", the receipt ${imd4(ev.args.imd)} IMD`);
    if (run.figure !== imd4(ev.args.imd)) throw new Error(`the figure read ${run.figure} IMD before the claim, which paid ${imd4(ev.args.imd)} IMD`);
    await t.until("the figure back at 0.0000", async () => (await t.figure()) === "0.0000", 30_000, 500);
    return `nothing selected, so every staked card: ${describeCall(s[0].data).text} ${short(s[0].hash)}; "${note}", the figure shown before it; Claimed(the dev wallet, ${ev.args.imd} wei), and its IMD balance grew by exactly that; the figure reads 0.0000 IMD`;
  });

  await step("Unstake: the card is no longer staked", async () => {
    const { id } = run.card;
    if (!(await t.tapTile(id))) throw new Error(`no tile #${id} to tap`);
    await t.until(`#${id} selected`, async () => (await t.tile(id))?.pressed, 5_000);
    const sent0 = wallet.state.sent.length;
    if (!(await t.click(".ws-bar button", "Unstake"))) throw new Error('no enabled "Unstake"');
    await t.until(`"Unstaked #${id}."`, async () => (await t.wsNote()) === `Unstaked #${id}.`, 45_000);
    const tile = await t.until(`#${id} without the staked mark`, async () => {
      const x = await t.tile(id);
      return x && !x.staked ? x : null;
    }, 30_000);
    const [staker] = await run.view("stakeOf", [BigInt(id)]);
    if (BigInt(staker) !== 0n) throw new Error(`stakeOf(${id}) is still ${staker}`);
    const s = wallet.state.sent.slice(sent0);
    if (s.length !== 1 || s[0].name !== "unstake") throw new Error(`the wallet signed ${s.map((x) => describeCall(x.data).text).join(", ") || "nothing"}`);
    return `${describeCall(s[0].data).text} ${short(s[0].hash)}; "Unstaked #${id}."; the tile reads "${tile.caption}"; stakeOf(${id}) is empty`;
  });

  // ---------------------------------------------------------------- /mine/ again: the race, and the stop

  await step("back on /mine/: auto-mint off, Start mining, a find waits for the Mint button", async () => {
    if (!(await t.nav("/mine/"))) throw new Error('no "Mine" link in the top bar');
    await t.until('/mine/ with "Start mining" on the button', async () => (await t.path()) === "/mine/" && (await t.cta()) === "Start mining" && (await t.ctaEnabled()), 45_000);
    // One bit again: the page finds a hash at once, and the rival's draw below takes a few.
    const bits = await easeToOneBit(run);
    const auto = () =>
      t.ev(`[...document.querySelectorAll(".instrument")].find((r) => r.querySelector(".k")?.textContent.trim() === "auto-mint")?.querySelector("button.switch")?.textContent.trim() ?? null`);
    if ((await auto()) !== "on") throw new Error(`auto-mint reads "${await auto()}"`);
    await t.ev(`[...document.querySelectorAll(".instrument")].find((r) => r.querySelector(".k")?.textContent.trim() === "auto-mint").querySelector("button.switch").click()`);
    await t.until("auto-mint off", async () => (await auto()) === "off", 5_000);
    run.raceSent = wallet.state.sent.length;
    await t.ev("window.__probe.job = null; window.__probe.founds = []; true");
    if (!(await t.click(".mine-cta", "Start mining"))) throw new Error('no "Start mining" to press');
    await t.until('"Mint it now" on the button', async () => (await t.cta()) === "Mint it now", 60_000);
    const notes = await t.notes();
    if (notes[0] !== SAYS.waiting) throw new Error(`the newest note is "${notes[0]}"`);
    return `difficulty back at ${bits} bit; auto-mint off; "${notes.find((l) => l.startsWith("started on"))}", then "${notes[0]}"; the button reads "Mint it now"`;
  });

  await step("the race: a find waits, a rival mints the same prevWork, then Mint it now is pressed", async () => {
    // The waiting hash as the page's engines found it: the live job they were handed, and their finds for it.
    const probe = await t.probe();
    const job = probe.job;
    if (!job || !isAddressEqual(job.miner, dev)) throw new Error("the page's live job was not seen going to its engines");
    // At one bit about every other hash is a find: each Worker posts many before the page's stop reaches it. The
    // page waits on the first one it receives for the job and ignores the rest, and the probe sees them in the
    // same order; the rival's proof is drawn to beat the first four, and the hash the page then tries is checked
    // to be one of them.
    const finds = probe.founds.filter((f) => f.jobId === job.id).slice(0, 4);
    if (!finds.length) throw new Error(`no find for the page's job #${job.id} was seen`);
    const prevWork = await run.view("prevWork");
    if (job.prevWork.toLowerCase() !== prevWork.toLowerCase()) throw new Error("the page's job is not on the chain's prevWork");
    const target = await run.view("effectiveTarget");
    for (const f of finds) {
      const proof = await run.view("workHash", [job.anchorHash, dev, BigInt(f.nonce)]);
      if (proof.toLowerCase() !== f.digest.toLowerCase()) throw new Error("a find's digest is not the contract's workHash for it");
      if (BigInt(proof) >= target) throw new Error("the waiting hash does not solve the job: there is no race to lose");
    }
    // The rival's job on the same prevWork, and a nonce for it whose proof, as the next prevWork, leaves every
    // waiting proof above every target.
    const rj = await liveJob(pub, run.a, addressOf(RIVAL));
    if (rj.prevWork.toLowerCase() !== prevWork.toLowerCase()) throw new Error("prevWork moved before the rival's draw");
    const ours = { domain: rj.domain, chainId: rj.chainId, contract: rj.contract, miner: dev };
    const refolded = (f, w) => BigInt(workOf({ ...ours, folded: fold(job.anchorHash, w) }, BigInt(f.nonce)));
    let n = BigInt(toHex(crypto.getRandomValues(new Uint8Array(16))));
    let work;
    let draws = 0;
    for (;;) {
      n++;
      draws++;
      work = workOf(rj, n);
      if (meets(rj, work) && finds.every((f) => refolded(f, work) > MAX >> 1n)) break;
      if (draws >= 200_000) throw new Error("no rival hash in 200,000 draws");
    }
    // The page's reads wait at the browser's door for the moment of the race, so its own three-second poll
    // cannot see the rival's mint before the button is pressed (it would drop the hash with the same line, by
    // another way). Reads already on their way come back first, from the chain as it was.
    run.hold.held = [];
    run.hold.estimates = [];
    run.hold.on = true;
    run.hold.watch = true;
    await run.page.send("Fetch.enable", { patterns: [{ urlPattern: `${RPC}*`, requestStage: "Request" }] });
    const t0 = Date.now();
    let detail = "";
    let ok = false;
    try {
      await sleep(300);
      const r = await mined(walletOf(RIVAL).writeContract({ ...run.md, functionName: "mint", args: [rj.anchor, n], gas: 3_000_000n }), "the rival's mint");
      const [m] = parseEventLogs({ abi: metamorphAbi, logs: r.logs.filter((l) => isAddressEqual(l.address, run.a.metamorph)), eventName: "Minted" });
      if (!m || !isAddressEqual(m.args.miner, addressOf(RIVAL))) throw new Error("no Minted for the rival in its receipt");
      if ((await run.view("prevWork")).toLowerCase() !== work.toLowerCase()) throw new Error("prevWork is not the rival's proof");
      const target2 = await run.view("effectiveTarget");
      for (const f of finds) {
        if (BigInt(await run.view("workHash", [job.anchorHash, dev, BigInt(f.nonce)])) < target2) throw new Error("a waiting hash still solves the job after the rival's mint");
      }
      const before = await t.cta();
      if (before !== "Mint it now") throw new Error(`after the rival's mint the button reads "${before}"`);
      if (!(await t.click(".mine-cta", "Mint it now"))) throw new Error('no "Mint it now" to press');
      await t.until(`the note "${SAYS.found}"`, async () => (await t.notes())[0] === SAYS.found, 5_000, 50);
      run.race = { rivalId: Number(m.args.id), guarded: finds.map((f) => f.nonce.toLowerCase()) };
      ok = true;
      detail =
        `the page's engines found ${finds.length} hash${finds.length > 1 ? "es" : ""} for its job on prevWork ${short(prevWork)}, each one a solution (the first waits: ` +
        `nonce ${short(finds[0].nonce)}); the rival (anvil #${RIVAL}) minted #${m.args.id} on the same prevWork in block ${r.blockNumber} ` +
        `(${draws} draw${draws > 1 ? "s" : ""} for a proof that leaves every waiting one above any target, as workHash() then reads); ` +
        `with "Mint it now" still on the button it was pressed: "${SAYS.found}"`;
    } finally {
      run.hold.on = false;
      const held = run.hold.held.splice(0);
      for (const h of held) await run.page.send("Fetch.continueRequest", { requestId: h.id }).catch(() => undefined);
      // Watched on until the lost-race line, to see which hash the page tries; off at once when the race failed.
      if (!ok) {
        run.hold.watch = false;
        await run.page.send("Fetch.disable").catch(() => undefined);
      }
      const methods = [...new Set(held.flatMap((h) => h.methods))];
      detail += `; the page's reads waited ${Date.now() - t0} ms (${held.length} request${held.length === 1 ? "" : "s"}${methods.length ? `: ${methods.join(", ")}` : ""}), then went on`;
    }
    return detail;
  });

  await step(`the lost-race line: "${SAYS.lost}"`, async () => {
    let line;
    let tried;
    try {
      line = await t.until("the lost-race line", async () => (await t.notes()).find((l) => l === SAYS.lost), 30_000);
      tried = run.hold.estimates.map((data) => {
        try {
          const d = decodeFunctionData({ abi: metamorphAbi, data });
          return d.functionName === "mint" ? d.args : null;
        } catch {
          return null;
        }
      }).find(Boolean);
    } finally {
      run.hold.watch = false;
      await run.page.send("Fetch.disable").catch(() => undefined);
    }
    const notes = await t.notes();
    const before = notes[notes.indexOf(line) + 1];
    if (before !== SAYS.found) throw new Error(`the note before it is "${before}"`);
    if (!tried) throw new Error("the page was not seen asking the node about its mint");
    const nonce = toHex(tried[1], { size: 32 });
    if (!run.race.guarded.includes(nonce)) throw new Error(`the page tried nonce ${short(nonce)}, none of the waiting hashes the rival's proof was drawn against`);
    const mints = wallet.state.sent.slice(run.raceSent).filter((s) => s.name === "mint");
    if (mints.length) throw new Error(`the wallet was asked to sign ${mints.length} mint(s) of the losing hash`);
    return (
      `"${before}", then "${line}"; the page's estimate of mint(${tried[0]}, ${short(nonce)}) was refused, that nonce the waiting hash ` +
      `(${run.race.guarded.indexOf(nonce) === 0 ? "the first find" : `find ${run.race.guarded.indexOf(nonce) + 1}`}); the wallet was never asked to sign it`
    );
  });

  await step("the numbers follow the rival's mint", async () => {
    const total = Number(await run.view("totalMinted"));
    const b = await t.until(`the band to read ${total} minted`, async () => {
      const x = await t.band();
      return int(x.minted) === total ? x : null;
    }, 15_000);
    return `minted ${b.minted}, the rival's #${run.race.rivalId} counted; since the last mint ${b["since the last mint"]}`;
  });

  await step("Stop mining stops again: a waiting hash is dropped, and nothing happens after it", async () => {
    const c = await t.cta();
    let pressed;
    if (c === "Mint it now") {
      pressed = "or stop mining";
      if (!(await t.click(".mine-alt", pressed))) throw new Error('no "or stop mining" beside "Mint it now"');
    } else if (c === "Stop mining") {
      pressed = c;
      await t.click(".mine-cta", c);
    } else throw new Error(`the button reads "${c}"`);
    await t.until('"Start mining" on the button again', async () => (await t.cta()) === "Start mining", 30_000);
    const line = (await t.notes())[0];
    if (!/^stopped( · |$)/.test(line)) throw new Error(`the newest note is "${line}"`);
    const p = await t.probe();
    if (p.live !== 0) throw new Error(`${p.live} Workers still alive`);
    const minted = Number(await run.view("totalMinted"));
    const sent = wallet.state.sent.length;
    await sleep(5000);
    if (Number(await run.view("totalMinted")) !== minted || wallet.state.sent.length !== sent || (await t.notes())[0] !== line || (await t.probe()).live !== 0) {
      throw new Error("something was minted, signed or noted after the stop");
    }
    return `pressed "${pressed}": "${line}"; the button reads "Start mining"; ${p.made} Workers made, none alive; 5 s later nothing minted, signed or noted`;
  });

  // ---------------------------------------------------------------- the account of the run

  const all = run.errors ?? [];
  const known = all.filter((e) => /Allowlist|cloud\.reown\.com/i.test(e));
  console.log(`\nthe dev wallet signed ${wallet.state.sent.length} transaction(s): ${wallet.state.sent.map((s) => s.name).join(", ") || "none"}`);
  console.log(`console errors on the page: ${all.length}${known.length ? ` (${known.length} of them WalletConnect's allowlist line for localhost)` : ""}`);
  for (const e of all.filter((x) => !known.includes(x)).slice(0, 8)) console.log(`  ${e}`);
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => r.ok === false).length;
  console.log(`\nmine-live: ${passed} of ${results.length} steps passed${failed ? `, ${failed} failed, ${results.length - passed - failed} not run` : ""}`);
  return passed === results.length ? 0 : 1;
}

let code = 1;
try {
  code = await main();
} catch (e) {
  console.log(`✗ the run broke off: ${oneLine(e)}`);
} finally {
  await stopAll();
}
process.exit(code);
