# Pupate pre-register list

The list behind the temporary pre-register card on [pupate.fun/mine](https://pupate.fun/mine): a Cloudflare
Worker (`src/index.ts`) over one D1 table (`schema.sql`). It takes an X username and an Ethereum address,
counts the rows, and hands the owner the CSV. It is not a gate: the mine has no allowlist, and the card
goes when mining opens.

    npm install          # Node 22+: wrangler, viem, typescript
    npm run typecheck
    npm run check        # the checks below, against wrangler dev on a local D1 of their own

## What it stores

One row per person (`schema.sql`): the handle (unique whatever its case, never with the "@"), the address
(lowercase, unique), whether the follow button was pressed (`followed`, the honour system), whether a wallet
signed for the address (`verified`), and for a signed entry the message and the signature, so anyone can
check them later. No IP address, no user agent, no cookie.

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
| `POST /register` with `{ handle, address, followed, message?, signature? }` | `200 { ok }`; `409` when the handle or the address is on the list already; `400` for anything malformed, a message of another shape, a stale issued time or a signature that does not hold; `413` over 4 KB |
| `GET /count` | `{ count }`, every row |
| `GET /export?key=<ADMIN_KEY>` | the CSV, every row and column; without the key, or with a wrong one, a `404` like any other path |

A body whose `website` field is not empty (the honeypot, a field no visitor sees) is answered `200` and not
stored. Browsers may call from `https://pupate.fun`, `https://www.pupate.fun` and `http://localhost:3000`
only (CORS); `OPTIONS` is answered.

## Deploy, from a fresh Cloudflare account

The free plan covers all of it: Workers (100,000 requests a day) and D1 (5 GB, 5 million rows read and
100,000 rows written a day). The list is a few thousand rows at most and a page view is one request.

1. Install wrangler, once: `npm i -g wrangler` (or run every command below as `npx wrangler …`). In this
   directory `npm install` brings it too.
2. `wrangler login` opens the browser for the account.
3. `wrangler d1 create pupate-preregister` prints the database id. Paste it into `wrangler.toml` as
   `database_id`, in place of the placeholder.
4. `wrangler d1 execute pupate-preregister --remote --file schema.sql` creates the table.
5. `wrangler secret put ADMIN_KEY` asks for the export's key: a long random string, kept where the owner
   keeps keys (`openssl rand -hex 32` makes one). Without it the export route does not exist.
6. `wrangler deploy` prints the Worker's URL, `https://pupate-preregister.<account>.workers.dev`.
7. In Vercel, Settings → Environment Variables: `NEXT_PUBLIC_PREREGISTER_URL` = that URL, for Production
   (and Preview if wanted), then redeploy the site. The variable is baked into the export at build time, so
   a redeploy is needed, not a restart. `/mine` then shows the card while the mine is not open.

A quick look after the deploy: `curl https://pupate-preregister.<account>.workers.dev/count` answers
`{"count":0}`.

## The list, in hand

    curl "https://pupate-preregister.<account>.workers.dev/export?key=<ADMIN_KEY>" -o registrations.csv

Columns: `id, handle, address, followed, verified, message, signature, created_at`. The count on the page
is `GET /count`; the page shows it only from 100 upwards.

## Turning it off

Either remove `NEXT_PUBLIC_PREREGISTER_URL` from Vercel's environment and redeploy the site, or let the
mine open: the page leaves the card out by itself once the contracts are live and the vault holds a seat a
mint can pick. The Worker can stay as it is (nothing calls it) or go with `wrangler delete`; the D1
database keeps the list until `wrangler d1 delete pupate-preregister`, so download the CSV first.

## The checks

`npm run check` wipes `.wrangler/check-state`, applies the schema to a local D1 there, starts `wrangler dev
--local` on a free port with a key of its own, and runs: a signed entry (a throwaway key signs the page's
message), a pasted entry, the duplicates (the handle in another case too), a signature by another key, a
message for another handle, a stale and a future issued time, a signature that is not hex, the honeypot
(the count unchanged), the malformed bodies, a body over 4 KB, the count, the export without a key, with a
wrong key and with the key (row by row), an unknown path, and the CORS answers. PASS/FAIL per line, exit 1
on any FAIL. `npm run dev` runs the Worker by hand on http://localhost:8787 (apply the schema first:
`npx wrangler d1 execute pupate-preregister --local --file schema.sql`; a `.dev.vars` file with
`ADMIN_KEY=…` gives the export a key).
