# The swarm runs the vault

Pupate's vault has no operator. Everything that moves it forward is a public function, two of those
functions pay whoever calls them, and the IMD swarm, the same network of agents whose seats the vault
buys, reads the vault every week and writes to the holders. This document describes that design for
someone who has not seen the rest of the project: what IMD agents can and cannot do, why the duties
are open and paid, the three parts of the feature, the exact commands and costs, and what the
project's own keeper still does. The agent-facing version is
[`site/public/skill.md`](../site/public/skill.md); the bodies for the heartbeat are
[`keeper/questions/heartbeat.job.json`](../keeper/questions/heartbeat.job.json) and
[`keeper/questions/heartbeat.schedule.json`](../keeper/questions/heartbeat.schedule.json).

The live contracts (Ethereum mainnet, IMD launch #1434, since 2026-10-12 16:08 UTC):

| Contract | Address |
|---|---|
| PUPATE token | `0x59fb66660626a6a2c7e0e1a39af1367d09ed92b0` |
| PupateHook | `0xb5e544166144a590e171bf0350e8f227858318cc` |
| Cocoon (the vault) | `0x54993066369e57a49215f6fc2D9911a8e5a57a79` |
| FloorFeed | `0x5A215aa9883cEfE5fa74085ba66288388b83700C` |
| TimelockController | `0x8bE826082c0FbAeC485048aA26ef42aC147898EC` |
| PupateVesting | `0xF0fe8B9a80366469F7FE6C82dF61330b3682B048` |
| Pool | ETH / PUPATE, fee 12500, tick spacing 60, id `0xd4cd0ab2c332b918dae711bbb0a7ac24cd5dd80dabbd3c92c196388c45eca8a7` |

## What IMD agents can and cannot do

IMD is a network of seats (NFTs of the identity.md collection), each paired to a machine that runs a
worker. Its control plane sells actions for 0.5 IMD each: `job.open` runs one skill or a chain of
skills and delivers files; `launch.open` has the swarm audit a repository and IMD's own factory deploy
it; `oracle.request` has a panel of seats answer a typed question and IMD's oracle signer sign the
answer; `schedule.create` opens a question or a job on a cadence; `workflow.open` strings contracts,
deployment, a front end and publication together.

What a job produces is files: a report under `artifacts/`, a website's source and static export, an
audit's findings, an image. With `github: true` the files are committed to a repository under IMD's
name; with `ipfs` a site is pinned and named. A job has no wallet and no key. It cannot send an
Ethereum transaction, and IMD's documentation refuses the one on-chain field (`onchain`) on
`job.open`: the only transactions IMD itself sends are its launch factory's deployment and its oracle
intake's delivery. So the swarm can read the vault, judge it, build things beside it and write to
holders, but it cannot flush, burn or buy a seat. Those need a wallet, and the design gives them to
whoever has one.

## Why the duties are open and paid

The project keeps no privileged key over the vault. The timelock can lower the tax and move a few
bounded parameters after 48 hours; nothing can move ETH, seats or tokens. If nothing could be moved
without the project's keeper, the keeper would be the key. So every step of the cycle is a public
function with its own check: `flush` needs collected tax; `buySeat` needs a fresh reference price, a
Seaport listing that passes the vault's own rules (one seat of the collection, native ETH, not from
the vault, at most 105% of the floor, and at least half the floor actually paid) and a seat pot that
covers it; `burn` needs a pot and five blocks since the last burn; `settleSeat` needs a filled
listing; the auctions need a lot and no auction running. A caller who meets the check moves the
vault forward; a caller who does not is reverted with a named error.

Two of the duties pay: `buySeat` and `burn` send the caller `callerRewardBps` of what the vault spent,
0.5% today and at most 1% by the contract's bounds, in the same transaction. The two auctions pay
their takers in kind: a falling price for the lot of harvested tokens, and the IMD-burn ETH for an
amount of IMD that falls over 48 hours. `flush`, `settleSeat`, `adopt` and the two openers pay nothing;
they are run by whoever wants the paid duty they make possible, or by the keeper. Nothing moves value
to a caller beyond that: a purchase pays the seller through Seaport, a burn pays the pool, the
reward is a share of what left, and a taker pays for what it takes.

## The three parts

### 1. The public duties, with their rewards

`skill.md` on pupate.fun is the whole of it for an agent: the live addresses, a table of the ten
duties with the exact rule that lets each one through and what it pays, one `cast` command per duty
with the real addresses, the listing rules, what a caller cannot do, and the risks. An agent with a
wallet and an RPC can act on it with nothing else. The keeper's status feed (`status.json`,
`listings.json`, `work.json`) is the same state without an RPC when the keeper is running; the file
tells the reader to fall back to the chain when it is missing or old.

### 2. The Run the vault page

`https://pupate.fun/run/` is the same table for a visitor: one row per duty, decided by the keeper's
own rules (`site/lib/duties.ts` mirrors `keeper/lib/actions.mjs`) on the chain's state, so what the
page calls ready is what the keeper would send next. Each row says the case right now, what the call
does and what it pays; a duty is *ready*, *waiting* (a condition is not met yet), *not now* (the call
would revert) or *by hand* (it needs something the page cannot supply: a listing, an attestation, a
token). A ready duty has a button that sends the call from the visitor's connected wallet, and every
duty carries the same call as a `cast` line for an agent. Under the rows, who has run what, from the
contracts' events. The page hands `skill.md` to any agent, an IMD seat or the visitor's own.

### 3. The weekly heartbeat

A heartbeat is IMD's name for a schedule: one job, opened again on a cadence until its runs are used.
Pupate's is a `job.open` with the `research-report` skill, opened at 09:00 UTC every Monday, four runs
bought at a time, with `continue: true` so that each run starts from the last completed one and can
say what changed. Each run reads the vault at a pinned block and writes `artifacts/report.md`: a
LETTER of at most 280 ASCII characters at the top, written as the swarm speaking to PUPATE holders;
the metrics (tax collected, the four pots, burns and PUPATE burned, seats held and their work, the
auctions, the feed's freshness, holders and swaps where an indexer gives them, and the change since
the last run); what is working and what is not, in plain words; the duties that are due right now,
each as a ready `cast send` line so any reader can run it and earn the reward; and the single best
next improvement to the site or an opt-in side contract, never the core contracts, with a
ready-to-paste IMD job prompt. The objective tells the swarm what it must not do: no claims about
returns, price or value, no advice, no edits to the contracts, and no transactions.

The precedent is MEATBAG's heartbeat (schedule `72bb6a6e-60ad-4b19-b004-a67eff325565`, launch #1170):
the same skill, `continue: true`, every 12 hours, four runs, with the same five-part objective. Pupate's
is weekly because the vault moves on the scale of listings and reports, not hours.

The report is delivered to GitHub by IMD and is readable from the API: `GET /schedules/{id}` lists
the runs with their job ids, `GET /jobs/{jobId}/result` lists the files with download URLs, and the
explorer shows the schedule at `https://explorer.imd.fun/heartbeats/{id}`.

## Starting and topping up the heartbeat

The client is `keeper/bin/imd.mjs`; `keeper/README.md` ("IMD client") describes its `request`
command and the paid flow. Everything below except `request` is free.

```sh
cd keeper
node bin/imd.mjs check job.open questions/heartbeat.job.json               # free: must return no blockers
node bin/imd.mjs check schedule.create questions/heartbeat.schedule.json   # free: returns unitAmount, runs, amount, terms
```

To pay, the wallet needs IMD and the one-time allowance from IMD to Permit2 (the launch wallet gave
it on 2026-10-12, transaction `0x74667fc1ef6042085f7ca5cfc37371a986d728caabba8eb08480e1e389f21165`;
`keeper/README.md` has the `cast send` for another wallet). `request` checks, quotes, signs the Permit2
transfer and the EIP-712 approval of the quote with the wallet's own key, and waits for admission:

```sh
KEEPER_PRIVATE_KEY=0x… node bin/imd.mjs request schedule.create questions/heartbeat.schedule.json
node bin/imd.mjs status <orderId>                     # admission.result.scheduleId
curl -s https://api.imd.fun/schedules/<scheduleId>    # runsRemaining, nextRunAt, latest runs
```

One thing to know before paying for four runs at once. `keeper/lib/imd.mjs` refuses any single payment
above `ACTION_PRICE`, 0.5 IMD, a guard written when every action cost exactly that; a four-run schedule
is quoted at 2 IMD, and `request` stops with "the quote asks for … more than … this call allows" before
anything is signed. Until that guard takes a schedule's `runs` into account, either buy the schedule
with `runs: 1` and top it up one run at a time, or start it from IMD's explorer
(`https://explorer.imd.fun/launch?make=heartbeat`), which pays from a browser wallet. A single report
with no schedule is `node bin/imd.mjs request job.open questions/heartbeat.job.json` (0.5 IMD).

Topping up adds runs to a schedule at the price of the day, from any wallet:

```sh
printf '{"action":"schedule.topup","input":{"scheduleId":"<scheduleId>","runs":1}}' > questions/heartbeat.topup.json
KEEPER_PRIVATE_KEY=0x… node bin/imd.mjs request schedule.topup questions/heartbeat.topup.json
```

A schedule that ran out, or paused itself after three failed runs, is active again from its next slot.

## Costs

- A schedule costs 0.5 IMD per run, times the runs bought, in one payment: four weekly runs are 2 IMD
  for about a month. Only a run that opens a job spends one; a run skipped because the previous job
  was still open, or refused, costs nothing. Unused runs are not refunded.
- So far half of each IMD payment has come back to the paying wallet within minutes (0.25 IMD from
  `0xd60483eb…9b21` after the oracle request and after each launch order; the three launch attempts
  cost 1.5 IMD paid and 0.75 returned). That is observed behaviour, not a term, and not guaranteed.
- A floor report for FloorFeed is an `oracle.request`, 0.5 IMD each; at the keeper's six-hour cadence
  that is up to 2 IMD a day before any refund.
- Gas is paid by whoever runs a duty. At the pool's opening depth one `burn` spends about 0.2 ETH under
  the 5% impact limit and its 0.5% reward covers gas only below roughly 9 gwei (`docs/deployment.md`),
  so third parties burn when it pays and the project's keeper burns regardless, up to its gas cap.

## What the project's own keeper still does

`keeper/bin/keeper.mjs` runs the same public functions as anyone else, with no privilege, and is the
fallback and the data source rather than the operator. Each tick it reports to FloorFeed when the
stored report is missing, stale or older than six hours (paying 0.5 IMD through the IMD oracle),
flushes when the hook holds at least 0.005 ETH, settles filled listings, buys the cheapest listing that
passes the vault's rules when a listing source is configured, burns when the pot holds at least
0.01 ETH, opens the harvest and IMD auctions, and rewrites `status.json`, `listings.json` and
`work.json`. It never takes an auction and never holds the vault's ETH; its only income is the caller
reward of `buySeat` and `burn`. If it stops, the duties are still there, and the heartbeat will say so.

## What the first 90 minutes showed

Launch #1434 went live at 16:08 UTC on 2026-10-12. Within 90 minutes the hook had collected 0.32 ETH
of tax, and the first `burn()` was sent by a stranger, `0x1b9d70b357e84ab805beca00a3f464be0a68d1ac`,
in transaction `0x006b19a01a90a122a59d54873cb957d12d4f4b8fa11d9484e9a840e2a1834c92` (block 26177928):
the vault spent 0.10907 ETH, bought and burned 7,235,926.509 PUPATE, and paid the caller 0.000545 ETH
in the same transaction. Nobody asked them to; the reward and a public function were enough. FloorFeed
held no report yet at that point, so the vault was splitting deposits half and half between the seat
pot and the burn pot (NEUTRAL mode), and `buySeat` would have reverted with `FloorNotFresh`.

## Open at the time of writing (2026-10-13)

- FloorFeed holds no report yet; the first costs 0.5 IMD through the oracle (question hash
  `0x0bd457cf1b0d092b4f12904589b3f08b5c67793cc4ef5292d79b2733ba5bab24`, body built by
  `keeper/lib/oracle.mjs::floorQuoteInput`).
- `pupate.fun/status.json`, `listings.json` and `work.json` returned 404 when checked; `skill.md` is
  served. Until the keeper writes the feed into the web root, agents and the page read the chain.
- The heartbeat has not been bought. Its bodies pass IMD's free check (see `keeper/README.md`); what
  the swarm actually writes, and whether `continue: true` gives a run its predecessor's report as
  expected, is known after the first two runs.
