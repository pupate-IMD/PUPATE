// Runs the GPU engine's self-test in headless Edge (or Chrome) and prints what it measured: the adapter,
// the known-answer and hit-path checks, the rate, hashes per dispatch, the practice bits it implies, and
// the CPU threads' rate beside it. It opens /mine/?gpu-selftest=1 (a development-only flag of the mine
// page) and reads the JSON the page writes into <pre id="gpu-selftest">, over the DevTools protocol.
//
//   cd site && node scripts/gpu-selftest.mjs                 # starts the dev server on port 3123, then stops it
//   node scripts/gpu-selftest.mjs --url http://localhost:3000   # a dev server that is already running
//   node scripts/gpu-selftest.mjs --high-performance        # ask for the discrete GPU on a hybrid laptop
//   node scripts/gpu-selftest.mjs --dump-dom                # the plain `msedge --dump-dom` form: checks only,
//                                                           # its virtual time makes the timings meaningless
//
// Other options: --port <n>, --browser <path to msedge or chrome>, --flags "<extra browser flags>",
// --timeout <seconds> (default 300), --bench <ms> (a longer GPU benchmark than the page's one second).
// Exits 0 when the self-test passed, 1 otherwise.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const site = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
};
const flag = (name) => argv.includes(`--${name}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const port = Number(opt("port", "3123"));
const given = opt("url", "");
const base = (given || `http://localhost:${port}`).replace(/\/+$/, "");
const bench = Number(opt("bench", "0"));
const target = `${base}/mine/?gpu-selftest=1${bench > 0 ? `&bench=${bench}` : ""}`;
const timeoutMs = Number(opt("timeout", "300")) * 1000;
const browser = opt("browser", "") || findBrowser();
const extra = (opt("flags", "") || "").split(/\s+/).filter(Boolean);
const gpuFlags = ["--enable-unsafe-webgpu", "--enable-features=Vulkan", ...(flag("high-performance") ? ["--force-high-performance-gpu"] : []), ...extra];

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

/// Kills a child and everything it started (next dev forks its own server process).
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

async function waitForServer() {
  const until = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < until) {
    try {
      // The first request compiles the page, which can take a minute or two.
      const r = await fetch(`${base}/mine/`, { signal: AbortSignal.timeout(240_000) });
      if (r.ok) return;
      last = `HTTP ${r.status}`;
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
    }
    await sleep(1000);
  }
  throw new Error(`the site at ${base} did not answer: ${last}`);
}

/// A minimal DevTools protocol client over Node's WebSocket.
function devtools(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const waiting = new Map();
  const events = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(typeof m.data === "string" ? m.data : m.data.toString());
    if (msg.id && waiting.has(msg.id)) {
      const w = waiting.get(msg.id);
      waiting.delete(msg.id);
      if (msg.error) w.reject(new Error(msg.error.message));
      else w.resolve(msg.result);
    } else if (msg.method) events.push(msg);
  };
  const open = new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error(`cannot reach ${url}`));
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const i = ++id;
      waiting.set(i, { resolve, reject });
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  return { open, send, events, close: () => ws.close() };
}

function consoleLines(events) {
  const lines = [];
  for (const e of events) {
    if (e.method === "Runtime.consoleAPICalled") lines.push(`console.${e.params.type}: ${e.params.args.map((a) => a.value ?? a.description ?? "").join(" ")}`);
    if (e.method === "Runtime.exceptionThrown") lines.push(`exception: ${e.params.exceptionDetails.exception?.description ?? e.params.exceptionDetails.text}`);
  }
  return lines;
}

async function viaDevtools() {
  const profile = mkdtempSync(join(tmpdir(), "pupate-gpu-selftest-"));
  const args = ["--headless=new", ...gpuFlags, "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`, "--remote-debugging-port=0", target];
  const edge = spawn(browser, args, { stdio: "ignore", detached: process.platform !== "win32" });
  try {
    // The browser writes its DevTools port into the profile.
    const portFile = join(profile, "DevToolsActivePort");
    const until = Date.now() + 30_000;
    while (!existsSync(portFile) || !readFileSync(portFile, "utf8").includes("\n")) {
      if (Date.now() > until) throw new Error("the browser did not open its DevTools port");
      await sleep(200);
    }
    const [dtPort, browserPath] = readFileSync(portFile, "utf8").trim().split("\n");
    let pageUrl = "";
    for (let i = 0; i < 50 && !pageUrl; i++) {
      const list = await (await fetch(`http://127.0.0.1:${dtPort}/json/list`)).json();
      pageUrl = list.find((t) => t.type === "page" && t.url.includes("gpu-selftest"))?.webSocketDebuggerUrl ?? "";
      if (!pageUrl) await sleep(200);
    }
    if (!pageUrl) throw new Error("the self-test page did not open");
    const page = devtools(pageUrl);
    await page.open;
    await page.send("Runtime.enable");
    const until2 = Date.now() + timeoutMs;
    let out = null;
    while (Date.now() < until2) {
      const r = await page.send("Runtime.evaluate", { expression: "document.getElementById('gpu-selftest')?.textContent ?? null", returnByValue: true });
      if (r.result?.value) {
        out = r.result.value;
        break;
      }
      await sleep(1000);
    }
    const logs = consoleLines(page.events);
    page.close();
    // Close the browser cleanly over its own endpoint.
    try {
      const b = devtools(`ws://127.0.0.1:${dtPort}${browserPath}`);
      await b.open;
      await Promise.race([b.send("Browser.close"), sleep(3000)]);
      b.close();
    } catch {
      /* killed below */
    }
    return { out, logs };
  } finally {
    await Promise.race([new Promise((r) => edge.once("exit", r)), sleep(5000)]);
    killTree(edge);
    await sleep(500);
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
}

async function viaDumpDom() {
  const profile = mkdtempSync(join(tmpdir(), "pupate-gpu-selftest-"));
  try {
    const r = spawnSync(browser, ["--headless=new", ...gpuFlags, "--virtual-time-budget=20000", `--user-data-dir=${profile}`, "--dump-dom", target], {
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
    });
    const m = /<pre id="gpu-selftest"[^>]*>([\s\S]*?)<\/pre>/.exec(r.stdout ?? "");
    const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    return { out: m ? unescape(m[1]) : null, logs: (r.stderr ?? "").split("\n").filter((l) => /webgpu|dawn|gpu/i.test(l)).slice(-20) };
  } finally {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
}

const fmt = (h) => (h >= 1e9 ? `${(h / 1e9).toFixed(2)} GH/s` : h >= 1e6 ? `${(h / 1e6).toFixed(2)} MH/s` : h >= 1e3 ? `${(h / 1e3).toFixed(1)} kH/s` : `${Math.round(h)} H/s`);

let server = null;
let code = 1;
try {
  if (!given) {
    console.log(`starting the dev server on port ${port}`);
    server = spawn(process.execPath, ["scripts/dev.mjs", "-p", String(port)], { cwd: site, stdio: "ignore", detached: process.platform !== "win32" });
  }
  await waitForServer();
  console.log(`${flag("dump-dom") ? "dump-dom" : "devtools"}: ${browser} ${gpuFlags.join(" ")}\n  ${target}`);
  const { out, logs } = flag("dump-dom") ? await viaDumpDom() : await viaDevtools();
  if (flag("dump-dom")) console.log("note: --virtual-time-budget runs the page on virtual time; the checks hold, the timings and the rate do not");
  if (!out) {
    console.log("no self-test result on the page");
    for (const l of logs) console.log(`  ${l}`);
  } else {
    console.log(out);
    const r = JSON.parse(out);
    const g = r.gpu;
    if (g) {
      console.log(
        `\nGPU ${g.name}: ${g.ok ? "passed" : "FAILED"}${g.ok ? ` · ${fmt(g.rate)} · ${g.batch.toLocaleString("en-US")} hashes a dispatch in ${g.dispatchMs} ms · shader ready in ${g.compileMs} ms · practice target ${r.practiceBits} bits` : ` · ${g.detail}`}`,
      );
    } else console.log(`\nGPU unavailable: ${r.probe?.reason ?? r.error}`);
    if (r.cpu) console.log(`CPU ${r.cpu.threads} threads: ${fmt(r.cpu.rate)}${r.gpuOverCpu ? ` · the GPU is ${r.gpuOverCpu}x the CPU` : ""}`);
    code = g?.ok ? 0 : 1;
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
} finally {
  if (server) {
    killTree(server);
    console.log("dev server stopped");
  }
}
process.exit(code);
