// The pre-register list behind the mine page's temporary form (site/components/PreRegister.tsx): a Worker
// over one D1 table (schema.sql). Three routes. POST /register takes a handle and an address, with the
// message the wallet signed and its signature where the page had a wallet, bare where the address was
// pasted; GET /count says how many rows there are (for the owner's curl, not the page: the figure is held
// in the isolate for a minute, so the table is not counted on every call); GET /export?key=… hands the owner
// the CSV, and without the right key it is a 404 like any other path. Nothing is kept but the row: no IP, no
// user agent. The connection's address is read once, for the rate limit on /register, and goes no further.
//
// The signed path proves the address: the Worker rebuilds the message the page shows the wallet from the
// body's handle and address and the message's own issued line, requires the message to be exactly that,
// the issued time to be within ten minutes of now, and the signature to recover to the address. Only then
// is the row verified = 1. A pasted address is verified = 0.
import { getAddress, isAddress, isHex, verifyMessage } from "viem";

export interface Env {
  DB: D1Database;
  /// The rate limit on /register (wrangler.toml): three a minute from one connection.
  REGISTER_LIMIT: RateLimit;
  /// `wrangler secret put ADMIN_KEY`: the export's key. Unset, the export does not exist.
  ADMIN_KEY?: string;
}

/// The pages that may call the list from a browser.
const ORIGINS = new Set(["https://pupate.fun", "https://www.pupate.fun", "http://localhost:3000"]);
/// An X username: letters, digits and underscores, fifteen at most, never the "@".
const HANDLE = /^[A-Za-z0-9_]{1,15}$/;
/// The issued line as the page writes it: Date.prototype.toISOString.
const ISSUED = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
/// A body larger than this is refused unread.
const MAX_BODY = 4096;
/// How far from now a message's issued time may lie, either way.
const ISSUED_WINDOW_MS = 10 * 60 * 1000;
/// How long a count is kept in the isolate before the table is counted again.
const COUNT_TTL_MS = 60_000;
const COLUMNS = ["id", "handle", "address", "followed", "verified", "message", "signature", "created_at"] as const;

type Row = Record<(typeof COLUMNS)[number], string | number | null>;
type Headers = Record<string, string>;

/// The last count and when it was read; per isolate.
let counted: { count: number; at: number } | null = null;

/// The message the page shows the wallet, word for word: the handle, the checksummed address, the time.
export function expectedMessage(handle: string, address: string, issued: string): string {
  return `Pre-register @${handle} for Metamorph MD\naddress ${address}\nissued ${issued}`;
}

/// Whether `message` is exactly the expected message for this handle and address, issued within the window
/// of `now`.
export function messageHolds(message: string, handle: string, address: string, now: number): boolean {
  const lines = message.split("\n");
  if (lines.length !== 3 || !lines[2].startsWith("issued ")) return false;
  const issued = lines[2].slice("issued ".length);
  if (!ISSUED.test(issued) || message !== expectedMessage(handle, address, issued)) return false;
  const at = Date.parse(issued);
  return Number.isFinite(at) && Math.abs(now - at) <= ISSUED_WINDOW_MS;
}

/// The export's key against the one given, compared in full whatever matches, so a wrong key takes the
/// same time as a near one.
function keyHolds(given: string | null, key: string | undefined): boolean {
  if (!given || !key || given.length !== key.length) return false;
  let diff = 0;
  for (let i = 0; i < key.length; i++) diff |= given.charCodeAt(i) ^ key.charCodeAt(i);
  return diff === 0;
}

/// One CSV field: quoted when it holds a comma, a quote or a line break (the message does).
function csvField(v: string | number | null): string {
  const s = v === null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function cors(request: Request): Headers {
  const origin = request.headers.get("Origin");
  if (!origin || !ORIGINS.has(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(body: unknown, status: number, headers: Headers, cache = "no-store"): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json", "Cache-Control": cache } });
}

const malformed = (headers: Headers) => json({ error: "malformed" }, 400, headers);
const notFound = (headers: Headers) => json({ error: "not found" }, 404, headers);

async function register(request: Request, env: Env, headers: Headers): Promise<Response> {
  // Three a minute from one connection; the address is the limit's key and is kept nowhere.
  const { success } = await env.REGISTER_LIMIT.limit({ key: request.headers.get("cf-connecting-ip") ?? "" });
  if (!success) return json({ error: "too many tries" }, 429, headers);
  if (Number(request.headers.get("Content-Length") ?? 0) > MAX_BODY) return json({ error: "too large" }, 413, headers);
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY) return json({ error: "too large" }, 413, headers);
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return malformed(headers);
    body = parsed as Record<string, unknown>;
  } catch {
    return malformed(headers);
  }
  // The honeypot: a field no visitor sees. Whoever fills it is thanked and forgotten.
  if (body.website !== undefined && body.website !== "") return json({ ok: true }, 200, headers);

  const { handle, address, followed, message, signature } = body;
  if (typeof handle !== "string" || !HANDLE.test(handle)) return malformed(headers);
  if (typeof address !== "string" || !isAddress(address)) return malformed(headers);
  if (typeof followed !== "boolean") return malformed(headers);
  const checksummed = getAddress(address);

  let verified = 0;
  if (message !== undefined || signature !== undefined) {
    if (typeof message !== "string" || typeof signature !== "string" || !isHex(signature)) return malformed(headers);
    if (!messageHolds(message, handle, checksummed, Date.now())) return malformed(headers);
    let holds = false;
    try {
      holds = await verifyMessage({ address: checksummed, message, signature });
    } catch {
      holds = false;
    }
    if (!holds) return malformed(headers);
    verified = 1;
  }

  try {
    await env.DB.prepare(
      "INSERT INTO registrations (handle, address, followed, verified, message, signature, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
    )
      .bind(handle, checksummed.toLowerCase(), followed ? 1 : 0, verified, verified ? message : null, verified ? signature : null, new Date().toISOString())
      .run();
  } catch (e) {
    if (/UNIQUE/i.test(String((e as Error)?.message ?? e))) return json({ error: "already registered" }, 409, headers);
    throw e;
  }
  return json({ ok: true }, 200, headers);
}

/// The count, read from the table at most once a minute per isolate and cacheable for as long.
async function count(env: Env, headers: Headers): Promise<Response> {
  const now = Date.now();
  if (!counted || now - counted.at > COUNT_TTL_MS) {
    const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM registrations").first<{ count: number }>();
    counted = { count: row?.count ?? 0, at: now };
  }
  return json({ count: counted.count }, 200, headers, "public, max-age=60");
}

async function exportCsv(env: Env, headers: Headers): Promise<Response> {
  const { results } = await env.DB.prepare(`SELECT ${COLUMNS.join(", ")} FROM registrations ORDER BY id`).all<Row>();
  const lines = [COLUMNS.join(","), ...results.map((r) => COLUMNS.map((c) => csvField(r[c])).join(","))];
  return new Response(`${lines.join("\r\n")}\r\n`, {
    status: 200,
    headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="registrations.csv"', "Cache-Control": "no-store" },
  });
}

export default {
  async fetch(request, env): Promise<Response> {
    const headers = cors(request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    const { pathname, searchParams } = new URL(request.url);
    try {
      if (request.method === "POST" && pathname === "/register") return await register(request, env, headers);
      if (request.method === "GET" && pathname === "/count") return await count(env, headers);
      if (request.method === "GET" && pathname === "/export" && keyHolds(searchParams.get("key"), env.ADMIN_KEY)) return await exportCsv(env, headers);
      return notFound(headers);
    } catch (e) {
      // The cause, for `wrangler tail`: the message only, never a body, an address or a connection.
      console.error((e as Error)?.message ?? String(e));
      return json({ error: "the list is down" }, 500, headers);
    }
  },
} satisfies ExportedHandler<Env>;
