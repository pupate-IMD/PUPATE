// Thumbnails for the eye: every SVG in out/art/ (written by script/art/parity.mjs) to a 540-px PNG in
// out/art/png/, drawn by headless Edge, which renders the textPaths and the blur filters as a browser does
// (with grey, not coloured, antialiasing on the digits).
// Each picture is a 1080 x 1080 window at half scale, in a profile of its own (so the run neither joins nor
// disturbs another Edge); with --screenshot, Edge exits once the picture is written.
// Usage: node script/art/thumbs.mjs [path to msedge.exe]   (Edge's default Windows path otherwise)
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const dir = join(resolve(dirname(fileURLToPath(import.meta.url)), "..", ".."), "out", "art");
const edge = process.argv[2] ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const profile = `--user-data-dir=${join(tmpdir(), "pupate-art-thumbs")}`;
const flags = ["--headless=new", "--disable-gpu", "--disable-lcd-text", "--hide-scrollbars", "--no-first-run", profile];
mkdirSync(join(dir, "png"), { recursive: true });
let failed = 0;
for (const svg of readdirSync(dir).filter((f) => f.endsWith(".svg")).sort()) {
  const png = join(dir, "png", svg.replace(/[.]svg$/, ".png"));
  rmSync(png, { force: true });
  const size = ["--force-device-scale-factor=0.5", "--window-size=1080,1080", `--screenshot=${png}`];
  spawnSync(edge, [...flags, ...size, pathToFileURL(join(dir, svg)).href], { stdio: "ignore", timeout: 60_000 });
  if (!existsSync(png)) failed++;
  console.log(`${existsSync(png) ? "ok  " : "FAIL"} out/art/png/${svg.replace(/[.]svg$/, ".png")}`);
}
console.log(failed === 0 ? "all drawn" : `${failed} not drawn`);
process.exitCode = failed === 0 ? 0 : 1;
