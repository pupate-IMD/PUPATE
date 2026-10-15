# Pupate pre-register list

The list behind the temporary pre-register card on [pupate.fun/mine](https://pupate.fun/mine): a Cloudflare
Worker (`src/index.ts`) over one D1 table (`schema.sql`). It takes an X username and an Ethereum address,
counts the rows for the owner, and hands the owner the CSV. It is not a gate: the mine has no allowlist, and
the card goes when mining opens.

    npm install          # Node 22+: wrangler, viem, typescript
    npm run typecheck
    npm run check        # the checks below, against wrangler dev on a local D1 of their own

## What it stores

One row per person (`schema.sql`): the handle (unique whatever its case, never with the "@"), the address
(lowercase, unique), whether the follow button was pressed (`followed`, the honour system), whether a wallet
signed for the address (`verified`), and for a signed entry the message and the signature, so anyone can
check them later. No IP address, no user agent, no cookie. The connection's address is read once per
registration attempt, for the rate limit, and goes no further.

The signed path: the page has the wallet sign three lines, free of gas,

    Pre-register @<handle> for Metamorph MD
    address <checksummed address>
    issued <ISO time>

and the Worker rebuilds that message from the body's handle and address and the message's own issued line,
requires the message to be exactly that, the issued time to be within ten minutes of now, and the signature
to recover to the address (viem's `verifyMessage`, so a plain wallet; a smart-contract wallet's signature is
refused and the page offers the pasted path instead). Only then is the row `verified = 1`. An address
pasted without a wallet is `verified = 0`.

## Routes

| route | answer |
|---|---|
| `POST /register` with `{ handle, address, followed, message?, signature? }` | `200 { ok }`; `409` when the handle or the address is on the list already; `429` past three tries a minute from one connection; `400` for anything malformed, a message of another shape, a stale issued time or a signature that does not hold; `413` over 4 KB |
| `GET /count` | `{ count }`, every row. For the owner's `curl`; the page does not show it. The figure is read from the table at most once a minute per isolate and answered with `Cache-Control: public, max-age=60`, so it can be up to a minute behind |
| `GET /export?key=<ADMIN_KEY>` | the CSV, every row and column; without the key, or with a wrong one, a `404` like any other path |

A body whose `website` field is not empty (the honeypot, a field no visitor sees) is answered `200` and not
stored. Browsers may call from `https://pupate.fun`, `https://www.pupate.fun` and `http://localhost:3000`
only (CORS); `OPTIONS` is answered. The rate limit is Cloudflare's Workers rate-limiting binding
(`[[ratelimits]]` in `wrangler.toml`), keyed on `cf-connecting-ip`; a limited request is `429` with a JSON
error and the page says "too many tries from your connection; wait a minute."

## Deploy, from a fresh Cloudflare account

The free plan covers all of it: Workers (100,000 requests a day), D1 (5 GB, 5 million rows read and
100,000 rows written a day) and the rate-limiting binding. A registration is one request and one row
written; the count reads the table at most once a minute per isolate; the export reads it once per download.

1. Install wrangler, once: `npm i -g wrangler` (or run every command below as `npx wrangler …`). In this
   directory `npm install` brings it too.
2. `wrangler login` opens the browser for the account.
3. `wrangler d1 create pupate-preregister` prints the database id. Paste it into `wrangler.toml` as
   `database_id`, in place of the placeholder.
4. `wrangler d1 execute pupate-preregister --remote --file schema.sql` creates the table.
5. `wrangler secret put ADMIN_KEY` asks for the export's key: a long random string, kept where the owner
   keeps keys (`openssl rand -hex 32` makes one). Without it the export route does not exist.
6. `wrangler deploy` prints the Worker's URL, `https://pupate-preregister.<account>.workers.dev`.
7. Give the site the URL as `NEXT_PUBLIC_PREREGISTER_URL` and build it again, on whichever host serves it:
   on Vercel (the live host today) in the project's Settings → Environment Variables, for Production, then a
   redeploy; on the VPS one line in `/etc/pupate/site.env`, then `bash deploy/update.sh`. The variable is baked
   into the export at build time, so a rebuild is needed, not a restart. `/mine` then shows the card while
   the mine has not opened.

A quick look after the deploy: `curl https://pupate-preregister.<account>.workers.dev/count` answers
`{"count":0}`.

## The list, in hand

    curl "https://pupate-preregister.<account>.workers.dev/export?key=<ADMIN_KEY>" -o registrations.csv
    curl "https://pupate-preregister.<account>.workers.dev/count"

Columns: `id, handle, address, followed, verified, message, signature, created_at`. The count is the owner's
figure (up to a minute behind); the page shows no number.

## Turning it off

When the mine opens, remove `NEXT_PUBLIC_PREREGISTER_URL` from the site's environment and rebuild it. The
page also hides the card by itself from the first mint on (and never shows it on a live site before its
numbers are read), but the variable is the switch: with it gone the card is out of the build. The Worker can
stay as it is (nothing calls it) or go with `wrangler delete`; the D1 database keeps the list until
`wrangler d1 delete pupate-preregister`, so download the CSV first.

## The checks

`npm run check` wipes `.wrangler/check-state`, applies the schema to a local D1 there, starts `wrangler dev
--local` on a free port with a key of its own, and runs: a signed entry (a throwaway key signs the page's
message), a pasted entry, the duplicates (the handle in another case too), a signature by another key, a
message for another handle, a stale and a future issued time, a signature that is not hex, the honeypot
(nothing stored), the malformed bodies, a body over 4 KB, the count (and that it is held for a minute), the
export without a key, with a wrong key and with the key (row by row), the rate limit (a fourth try from one
connection within a minute is `429`), an unknown path, and the CORS answers. Each request carries its own
`cf-connecting-ip`, which the local runtime honours, so only the rate-limit check meets the limit. PASS/FAIL
per line, exit 1 on any FAIL. `npm run dev` runs the Worker by hand on http://localhost:8787 (apply the
schema first: `npx wrangler d1 execute pupate-preregister --local --file schema.sql`; a `.dev.vars` file with
`ADMIN_KEY=…` gives the export a key).
