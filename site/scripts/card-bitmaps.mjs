// Renders the mine's preview cards (public/cards/metamorph/c-*.svg, the chrysalis cards a practice find
// reveals) to 540 px WebP beside them, with headless Edge or Chrome: the page draws each SVG on a canvas and
// hands back a WebP. The reveal and the drawer show these bitmaps, because rasterizing an SVG full of blur
// filters is slow while the GPU mines, and the page's frames wait for it. Rerun after a preview SVG changes:
//
//   cd site && node scripts/card-bitmaps.mjs [--browser <path to msedge or chrome>]
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SIZE = 540;
const QUALITY = 0.9;
const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "cards", "metamorph");
const argv = process.argv.slice(2);
const given = argv.includes("--browser") ? argv[argv.indexOf("--browser") + 1] : "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

const PAGE = `<!doctype html><meta charset="utf-8"><script>
window.render = async (svg, size, quality) => {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    await new Promise((ok, no) => { img.onload = ok; img.onerror = () => no(new Error("the SVG did not load")); img.src = url; });
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    canvas.getContext("2d").drawImage(img, 0, 0, size, size);
    return canvas.toDataURL("image/webp", quality);
  } finally {
    URL.revokeObjectURL(url);
  }
};
</script>`;

const cards = readdirSync(dir).filter((f) => /^c-\d+\.svg$/.test(f));
const profile = mkdtempSync(join(tmpdir(), "pupate-card-bitmaps-"));
const browser = spawn(given || findBrowser(), ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`, "--remote-debugging-port=0", "about:blank"], {
  stdio: "ignore",
});
const watchdog = setTimeout(() => {
  console.error("gave up: the browser did not finish in time");
  stop();
  process.exit(1);
}, 120_000);

function stop() {
  if (browser.exitCode === null && browser.pid !== undefined) {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(browser.pid), "/T", "/F"], { stdio: "ignore" });
    else browser.kill("SIGTERM");
  }
}

let code = 1;
try {
  const portFile = join(profile, "DevToolsActivePort");
  while (!existsSync(portFile) || !readFileSync(portFile, "utf8").includes("\n")) {
    if (browser.exitCode !== null) throw new Error(`the browser exited (code ${browser.exitCode})`);
    await sleep(200);
  }
  const port = readFileSync(portFile, "utf8").split("\n")[0].trim();
  let target = null;
  for (let i = 0; i < 50 && !target; i++) {
    target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page");
    if (!target) await sleep(200);
  }
  if (!target) throw new Error("the browser opened no page");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok, no) => {
    ws.onopen = ok;
    ws.onerror = () => no(new Error("no DevTools connection"));
  });
  let id = 0;
  const waiting = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(String(m.data));
    waiting.get(msg.id)?.(msg);
    waiting.delete(msg.id);
  };
  const send = (method, params = {}) =>
    new Promise((ok, no) => {
      const i = ++id;
      const timer = setTimeout(() => no(new Error(`${method}: no answer`)), 30_000);
      waiting.set(i, (msg) => {
        clearTimeout(timer);
        if (msg.error) no(new Error(msg.error.message));
        else ok(msg.result);
      });
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  await send("Page.navigate", { url: `data:text/html;charset=utf-8,${encodeURIComponent(PAGE)}` });
  for (let i = 0; i < 50; i++) {
    const r = await send("Runtime.evaluate", { expression: "typeof window.render", returnByValue: true });
    if (r.result?.value === "function") break;
    await sleep(100);
  }
  for (const file of cards) {
    const svg = readFileSync(join(dir, file), "utf8");
    const r = await send("Runtime.evaluate", { expression: `render(${JSON.stringify(svg)}, ${SIZE}, ${QUALITY})`, awaitPromise: true, returnByValue: true });
    const url = r.result?.value;
    if (typeof url !== "string" || !url.startsWith("data:image/webp;base64,")) throw new Error(`${file}: ${r.exceptionDetails?.exception?.description ?? "no WebP came back"}`);
    const out = join(dir, file.replace(/\.svg$/, ".webp"));
    const bytes = Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
    writeFileSync(out, bytes);
    console.log(`${file} -> ${file.replace(/\.svg$/, ".webp")} (${SIZE} px, ${(bytes.length / 1024).toFixed(1)} KB)`);
  }
  ws.close();
  code = 0;
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
} finally {
  stop();
  clearTimeout(watchdog);
  await sleep(500);
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  } catch {
    console.log(`note: the temporary profile ${profile} was not removed`);
  }
}
process.exit(code);
