// Renders each .stage in assets.html to a 2x PNG via headless Edge + the DevTools protocol.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const dir = process.argv[2];
const scale = 2;
const port = 9336;
const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const proc = spawn(edge, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${port}`, "--window-size=1600,1200",
  "--force-device-scale-factor=" + scale, "--user-data-dir=" + process.env.TEMP + "/pupate-cdp-brand", "--no-first-run", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  let targets;
  for (let i = 0; i < 40; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break; } catch {} await sleep(250); }
  const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? m.error); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }))?.result?.value;
  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1200, deviceScaleFactor: scale, mobile: false });
  await send("Page.navigate", { url: pathToFileURL(dir + "/assets.html").href });
  for (let i = 0; i < 80; i++) { if (await ev("window.__assetsReady === true")) break; await sleep(250); }
  await sleep(400);
  for (const stage of ["logo", "banner", "og"]) {
    const clip = await ev(`(() => { const e = document.getElementById(${JSON.stringify(stage)}); const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.left, y: r.top, width: r.width, height: r.height }); })()`);
    const c = JSON.parse(clip);
    const r = await send("Page.captureScreenshot", { format: "png", clip: { ...c, scale: 1 }, captureBeyondViewport: true });
    writeFileSync(`${dir}/${stage}.png`, Buffer.from(r.data, "base64"));
    console.log(`${stage}.png  ${Math.round(c.width * scale)}x${Math.round(c.height * scale)}`);
  }
  ws.close();
} finally { proc.kill(); }
