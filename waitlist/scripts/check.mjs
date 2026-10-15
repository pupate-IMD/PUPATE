// The list's checks, in Node, against `wrangler dev` on a local D1 of its own (.wrangler/check-state, wiped
// first, the schema applied): a signed entry (a throwaway key signs the page's three-line message), a pasted
// entry, the duplicates (409, the handle in another case too), a signature for another address, a message
// for another handle, a stale and a future issued time, a signature that is not hex (400 each), the
// honeypot (200, nothing stored), the malformed bodies (400) and an oversized one (413), the count (right
// once read, then held for a minute, with its cache header), the export without a key, with a wrong key
// (404 both) and with the key (the CSV, row by row), the rate limit (a fourth try from one connection within
// a minute is 429, another connection is not), an unknown path and the CORS answer for a page that may call
// and one that may not. PASS/FAIL per check, exit 1 on any FAIL.
//
// Every request carries a cf-connecting-ip of its own (the local runtime passes the header through), so only
// the rate-limit check meets the limit. The rows are counted through the export, since /count is held.
//
//   npm run check        (or: node scripts/check.mjs)
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STATE = join(ROOT, ".wrangler", "check-state");
const WRANGLER = join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
const KEY = `check-${randomBytes(12).toString("hex")}`;
const MINUTE = 60_000;

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

/// Until the Worker answers anything at all (a 404 will do; /count is not asked, so its memo stays cold).
async function waitFor(url, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      await fetch(url);
      return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

/// Stops wrangler and the workerd it runs (on Windows a plain kill would leave workerd behind).
function stop(child) {
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else child.kill();
}

const message = (handle, address, issued) => `Pre-register @${handle} for Metamorph MD\naddress ${address}\nissued ${issued}`;
const fresh = () => privateKeyToAccount(generatePrivateKey());

// ------------------------------------------------------------------ the local list

rmSync(STATE, { recursive: true, force: true });
const schema = spawnSync(process.execPath, [WRANGLER, "d1", "execute", "pupate-preregister", "--local", "--file", "schema.sql", "--persist-to", STATE], {
  cwd: ROOT,
  encoding: "utf8",
  env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
});
check("the schema applied to a fresh local D1", schema.status === 0, schema.status === 0 ? "" : (schema.stderr || schema.stdout).trim().split("\n").pop());
if (schema.status !== 0) process.exit(1);

const port = await freePort();
const inspector = await freePort();
const dev = spawn(
  process.execPath,
  [WRANGLER, "dev", "--local", "--port", String(port), "--inspector-port", String(inspector), "--var", `ADMIN_KEY:${KEY}`, "--persist-to", STATE],
  { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, WRANGLER_SEND_METRICS: "false" } },
);
let said = "";
dev.stdout.on("data", (d) => (said += d));
dev.stderr.on("data", (d) => (said += d));
const base = `http://127.0.0.1:${port}`;

// A connection of its own for every request, unless one is named.
let connections = 0;
const nextIp = () => `10.1.${Math.floor(++connections / 256)}.${connections % 256}`;
const post = (body, headers = {}) =>
  fetch(`${base}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "cf-connecting-ip": nextIp(), ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const exportCsv = async () => (await fetch(`${base}/export?key=${KEY}`)).text();
const rowsNow = async () => (await exportCsv()).trim().split("\r\n").length - 1;

try {
  const up = await waitFor(`${base}/`, 90_000);
  check("wrangler dev answers on a free port", up, up ? "" : said.trim().split("\n").slice(-3).join(" | "));
  if (!up) process.exit(1);

  // The signed path: the page's message, signed by a throwaway key.
  const alice = fresh();
  const issued = new Date().toISOString();
  const aliceMessage = message("alice", alice.address, issued);
  const aliceSignature = await alice.signMessage({ message: aliceMessage });
  let r = await post({ handle: "alice", address: alice.address, followed: true, message: aliceMessage, signature: aliceSignature, website: "" });
  check("a signed entry registers (200)", r.status === 200, `status ${r.status}`);
  check("the list holds one row", (await rowsNow()) === 1);

  // The pasted path: no signature, the address in lower case.
  const bob = fresh();
  r = await post({ handle: "bob", address: bob.address.toLowerCase(), followed: true });
  check("a pasted entry registers (200)", r.status === 200, `status ${r.status}`);
  check("the list holds two rows", (await rowsNow()) === 2);

  // Duplicates, in another case too.
  r = await post({ handle: "ALICE", address: fresh().address, followed: true });
  check("a duplicate handle, in another case, is refused (409)", r.status === 409, `status ${r.status}`);
  r = await post({ handle: "carol", address: alice.address.toLowerCase(), followed: true });
  check("a duplicate address, in another case, is refused (409)", r.status === 409, `status ${r.status}`);

  // Signatures that do not hold.
  const dave = fresh();
  const eve = fresh();
  let m = message("dave", eve.address, new Date().toISOString());
  r = await post({ handle: "dave", address: eve.address, followed: true, message: m, signature: await dave.signMessage({ message: m }) });
  check("a signature by another key is refused (400)", r.status === 400, `status ${r.status}`);
  m = message("dave", dave.address, new Date().toISOString());
  r = await post({ handle: "dave2", address: dave.address, followed: true, message: m, signature: await dave.signMessage({ message: m }) });
  check("a message for another handle is refused (400)", r.status === 400, `status ${r.status}`);
  m = message("dave", dave.address, new Date(Date.now() - 11 * MINUTE).toISOString());
  r = await post({ handle: "dave", address: dave.address, followed: true, message: m, signature: await dave.signMessage({ message: m }) });
  check("a message issued eleven minutes ago is refused (400)", r.status === 400, `status ${r.status}`);
  m = message("dave", dave.address, new Date(Date.now() + 11 * MINUTE).toISOString());
  r = await post({ handle: "dave", address: dave.address, followed: true, message: m, signature: await dave.signMessage({ message: m }) });
  check("a message issued eleven minutes ahead is refused (400)", r.status === 400, `status ${r.status}`);
  m = message("dave", dave.address, new Date().toISOString());
  r = await post({ handle: "dave", address: dave.address, followed: true, message: m, signature: "signed, honest" });
  check("a signature that is not hex is refused (400)", r.status === 400, `status ${r.status}`);
  r = await post({ handle: "dave", address: dave.address, followed: true, message: m });
  check("a message without a signature is refused (400)", r.status === 400, `status ${r.status}`);
  check("none of those registered", (await rowsNow()) === 2);

  // The honeypot.
  r = await post({ handle: "frank", address: fresh().address, followed: true, website: "https://spam.example" });
  check("the honeypot answers 200", r.status === 200, `status ${r.status}`);
  check("and stores nothing", (await rowsNow()) === 2);

  // Malformed bodies.
  r = await post({ handle: "@grace", address: fresh().address, followed: true });
  check("a handle with the @ is refused (400)", r.status === 400, `status ${r.status}`);
  r = await post({ handle: "grace heart", address: fresh().address, followed: true });
  check("a handle with a space is refused (400)", r.status === 400, `status ${r.status}`);
  r = await post({ handle: "grace", address: "0x1234", followed: true });
  check("an address that is not one is refused (400)", r.status === 400, `status ${r.status}`);
  r = await post({ handle: "grace", address: fresh().address, followed: "yes" });
  check("a followed that is not a boolean is refused (400)", r.status === 400, `status ${r.status}`);
  r = await post("not json");
  check("a body that is not JSON is refused (400)", r.status === 400, `status ${r.status}`);
  r = await post({ handle: "grace", address: fresh().address, followed: true, note: "a".repeat(5000) });
  check("a body over 4 KB is refused (413)", r.status === 413, `status ${r.status}`);
  check("none of those registered either", (await rowsNow()) === 2);

  // The count: right when first read, then held for a minute.
  r = await fetch(`${base}/count`);
  check("GET /count answers { count } with the rows so far", r.status === 200 && JSON.stringify(await r.json()) === '{"count":2}');
  check("and says the browser may keep it a minute", r.headers.get("cache-control") === "public, max-age=60", r.headers.get("cache-control") ?? "no header");
  r = await post({ handle: "carl", address: fresh().address, followed: true });
  check("a third entry registers (200)", r.status === 200, `status ${r.status}`);
  r = await fetch(`${base}/count`);
  check("the count is held for a minute (still two)", JSON.stringify(await r.json()) === '{"count":2}');
  check("while the export shows three rows", (await rowsNow()) === 3);

  // The export.
  r = await fetch(`${base}/export`);
  check("the export without a key is a 404", r.status === 404, `status ${r.status}`);
  r = await fetch(`${base}/export?key=${KEY}x`);
  check("the export with a wrong key is a 404", r.status === 404, `status ${r.status}`);
  r = await fetch(`${base}/export?key=${KEY}`);
  const csv = await r.text();
  check("the export with the key is the CSV", r.status === 200 && (r.headers.get("content-type") ?? "").startsWith("text/csv"), `status ${r.status}`);
  check("its header names the columns", csv.startsWith("id,handle,address,followed,verified,message,signature,created_at\r\n"));
  check("row one is alice, verified, with her message and signature", csv.includes(`\r\n1,alice,${alice.address.toLowerCase()},1,1,"${aliceMessage}",${aliceSignature},`));
  check("row two is bob, unverified, with neither", csv.includes(`\r\n2,bob,${bob.address.toLowerCase()},1,0,,,`));
  // The message's own line breaks are bare LFs inside its quotes; the rows end in CRLF.
  check("and there are three rows", csv.trim().split("\r\n").length === 4);

  // The rate limit: every try counts, the fourth within a minute from one connection is refused, another
  // connection is not.
  const one = { "cf-connecting-ip": "10.9.9.9" };
  const tries = [];
  for (let i = 0; i < 4; i++) tries.push((await post("not json", one)).status);
  check("three tries from one connection are answered (400 each), the fourth is 429", tries.join(",") === "400,400,400,429", tries.join(","));
  r = await post("not json", { "cf-connecting-ip": "10.9.9.10" });
  check("another connection is not limited", r.status === 400, `status ${r.status}`);
  r = await post({ handle: "zed", address: fresh().address, followed: true }, one);
  check("a good entry from the limited connection is refused too (429)", r.status === 429, `status ${r.status}`);
  check("and not stored", (await rowsNow()) === 3);

  // The rest.
  r = await fetch(`${base}/anything`);
  check("an unknown path is a 404", r.status === 404, `status ${r.status}`);
  r = await fetch(`${base}/register`, { method: "OPTIONS", headers: { Origin: "https://pupate.fun", "Access-Control-Request-Method": "POST" } });
  check("OPTIONS from pupate.fun is allowed", r.status === 204 && r.headers.get("access-control-allow-origin") === "https://pupate.fun", `status ${r.status}`);
  r = await fetch(`${base}/count`, { headers: { Origin: "http://localhost:3000" } });
  check("localhost:3000 is allowed", r.headers.get("access-control-allow-origin") === "http://localhost:3000");
  r = await fetch(`${base}/count`, { headers: { Origin: "https://elsewhere.example" } });
  check("another origin gets no CORS header", r.headers.get("access-control-allow-origin") === null);
} finally {
  stop(dev);
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
