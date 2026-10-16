# Deployment

Pupate goes live in two steps around one IMD launch. The hook takes Cocoon and the timelock as
constructor arguments, so both exist before the launch; the token and the pool exist only after it,
so wiring and vesting come after. Rehearse the whole sequence on Sepolia first (Plan 4).

## 0. Before anything

- A wallet with ETH for gas and at least a few IMD for paid IMD actions (0.5 IMD each).
- `MAINNET_RPC_URL` for the fork test: `forge test --match-contract CocoonSeaportForkTest` must pass.
- The addresses for the launch chain: PoolManager, Seaport 1.6, the collection, the IMD token, IMD's
  oracle attester (`GET https://api.imd.fun/oracle/requests` returns it as `attester`).

## 1. Pre-launch contracts

    forge script script/DeployPreLaunch.s.sol --rpc-url $RPC --broadcast --verify

Deploys, in order: `TimelockController` (48 hours; the developer proposes, anyone executes, no admin),
`FloorFeed` (owned by the deployer for now), `Cocoon` (owned by the deployer for now). Prints the
`constructorArgs` line for `launch.json`.

Then make the first oracle request through IMD's paid-action flow with FloorFeed as the consumer:
`consumer.verifyingContract` = the FloorFeed address in lowercase, `consumer.chainId` = the launch chain,
`chainId` = the evidence chain (mainnet), the floor question in `keeper/questions/floor.question.txt`
(`keeper/lib/oracle.mjs::floorQuoteInput` builds the body). The oracle request's record carries
`questionHash`; keep it, and keep the attestation for the first report.

## 2. The launch

Fill `<COCOON_ADDRESS>` and `<TIMELOCK_ADDRESS>` in `launch.json`, commit, and pay for a
`launch.open` of kind `univ4_hook` pointing at this repository and that commit (`repoUrl`,
`baseCommit`, `pairWith: "eth"`, pool share 85%). The swarm reviews, deploys the token and the hook,
opens and seeds the pool in one transaction, and reports the addresses on `GET /launches/:id`.

Check before going on: the hook's `sink()` is Cocoon, its `owner()` is the timelock, its
`launchPool()` is the intended pool, and `openedAtBlock()` is the deployment block.

## 3. Post-launch

    COCOON=… FEED=… TIMELOCK=… TOKEN=… HOOK=… DEVELOPER=… QUESTION_HASH=… \
    forge script script/PostLaunch.s.sol --rpc-url $RPC --broadcast --verify

Wires Cocoon to the launch pool (it refuses any pool whose hook does not name it as the sink), deploys
`PupateVesting` and moves the developer's allocation into it, pins the oracle question, and hands
FloorFeed and Cocoon to the timelock. From here on every parameter change goes through the 48-hour
timelock.

## 4. First report, keeper, site

- Submit the first floor report (`FloorFeed.report`). The first report after the question is set is
  not rate-limited.
- Start the keeper: `node keeper/bin/keeper.mjs --loop` (env in `keeper/README.md`; `--once` for cron,
  `--status` to look). It reports every six hours, flushes, buys from Seaport listings at or under the
  tolerance, settles filled listings, burns and starts the auctions. `node keeper/test/fork.mjs` runs the
  whole cycle on the local fork. Two things to expect: at the opening pool depth one `burn()` spends only
  about 0.2 ETH (the 5% impact limit), so a large burn pot takes many calls five blocks apart; and the
  burn reward only covers gas below roughly 9 gwei at that depth, so third-party callers will burn only
  when it pays and the project's keeper burns regardless, up to `GAS_PRICE_CAP_GWEI`.
- Publish the site and point `pupate.fun` at it. `deploy/` sets up one small VPS that serves the export
  over HTTPS and runs the keeper beside it, with `status.json`, `listings.json` and `work.json` written
  straight into the web root; the export is plain files, so any static host (IPFS included) works too.
- Pair the first seat: the operator calls `Cocoon.authorizeWorker` with IMD's pairing message, then
  completes the pairing on IMD with any signature bytes.

## 5. Metamorph MD: the mine opens

The contracts can be live before the vault holds a seat. `script/mainnet/README.md`, "Metamorph MD", is the
runbook: the art, then the token at 20 bits, then the two addresses recorded and the keeper restarted, then
the site. `script/mainnet/metamorph.mjs` (`status`, `art`, `rehearsal`, `token`, `record`) runs those steps one
command each, as `launch.mjs` runs the launch: the chain read first, the runbook's refusals before anything is
sent, a question before every broadcast, the addresses recorded.

- **The keeper's new duties.** With `metamorph` in its addresses file (`keeper/addresses.mainnet.json`,
  named by `ADDRESSES` in the keeper's `.env` on the VPS) the keeper runs four more steps at the end of
  every tick, all of them public functions of the token: `noteSeats` (`noteSeat` for every seat the vault
  holds that is not noted yet), `forgetSeats` (`forgetSeat` for every noted seat the vault sold),
  `convert` (`convert()` once the pot holds 20 mint prices, or any ETH, five blocks after the last one,
  with the estimate + 1,000,000 as its gas limit; the caller's 0.5% of the IMD bought goes to the keeper's
  wallet) and `poke` (`poke(ids)` for staked cards that emerged, 50 a transaction, so they weigh 2). "Holds"
  is the token's own test, on Cocoon's books and in its wallet, read on chain every tick. The flags and the
  start line are unchanged; without `metamorph` the keeper says so at start and runs exactly as before. The
  status feed gains a `mine` block (minted, epoch, price, bits, the last mint, the pot, the duties due, the
  noted and mineable seats, the staked cards). `keeper/README.md`, "The mine's duties", has the details,
  and `node keeper/test/metamorph.mjs` runs all four on a fresh local stack.
- **The page switches on with the deployment, a seat in the vault or not (the commons, 2026-10-16).** The
  deployment that carries `metamorph` and `metamorphArt` in `MAINNET` (`site/lib/addresses.ts`) turns
  `/mine/` and `/cards/` from the preview into the live pages, and the mine is open from that moment: Start
  mining is on whenever the contract is live, the practice run a link away. While `mineableSeats()` is
  empty the mine reads "Ready. The vault holds no seat yet, so cards draw from the whole identity.md
  collection.", with the price and the numbers from the chain, and every mint draws its seat from the whole
  collection. The page reads `mineableSeats()` every three seconds; from the first seat the keeper notes
  the mints draw from the vault's seats instead, with no second deployment, and a sale (`forgetSeats`
  forgets the seat) puts the mine back on the commons. The pre-register card stays up until the first card
  is minted.
- **Proof before the deployment.** `cd site && npm run mine-live` drives the same pages in headless Edge
  against the local stack with a dev wallet: connect through RainbowKit, approve, mine and mint at one
  bit, the card in the drawer with its tokenURI image, stake, claim IMD after a real conversion, unstake,
  and one forced lost race. The site is deployed only after it ends with every step passed.

## What each party holds afterwards

| Party | Can do | Cannot do |
|---|---|---|
| Timelock (developer proposes, 48 h) | lower the tax; change Cocoon's bounded parameters, the operator, FloorFeed's attester, question and freshness | raise the tax; move ETH, seats or tokens; change the sink, the split, the launch schedule, the liquidity gate |
| Developer | claim the developer balance; change the developer address; release vested PUPATE | anything else |
| Operator | approve and revoke IMD pairings for held seats | move anything; sign anything else |
| Anyone | flush, buy, settle, adopt, burn, run the auctions, release vesting, execute matured timelock operations | |

Lowering the tax has a floor once Metamorph MD is live. Its conversion sells PUPATE in the launch pool
under a 5% (500 bps) bound taken from the spot of the moment, which a caller can move first, and that leg
resists a sandwich only because the hook taxes both sides of a trade. By the audit's first-order estimate
(`docs/REVIEW.md`, Metamorph MD, I-5), a standing tax below about 1.2% on the mainnet pool, whose fee is
1.25%, would let a sandwich of a conversion pay. Metamorph MD has no key, so its bound cannot follow the
tax down: when proposing a cut, keep the tax above that or accept the exposure knowingly.

## The launch request (IMD policy v34, 2026-10-07)

- The pool's LP fee tier must be **12500** (1.25%), tick spacing 60. The ETH-paired opening valuation is fixed by policy at 10 ETH on mainnet (20 ETH on Sepolia), up to 100 ETH.
- A `launch.open` for a self-hosted repository carries `shape: "chain"`. Pupate's steps are `audit-imported-code → adversarial-review`: IMD plans an audit of the code as it is, the manifest, four specialist audits, a judge and the deployment, and the only node with a write path is the manifest node (`launch.json`), so no agent can change `src/` or `test/`. Launch #1205 was admitted in this shape. An `adapt-contract-project` step between the two would give an agent a write budget over the source, which Pupate cannot use: the hook is bound to a Cocoon that is already deployed. Ready bodies: `keeper/questions/launch.check.json` (mainnet) and `launch.sepolia.check.json`. Run `node keeper/bin/imd.mjs check launch.open <body>` first: it is free and must return no blockers. `script/mainnet/launch.mjs manifest` sets `repoUrl` and `baseCommit`.
- Admission runs seven checks, visible on the launch record (`GET /launches/:id`, `admissionChecks`): `provenance`, `findings` (the judge's blocking findings must all be resolved), `independent_review`, `bytecode` (every contract under `src/` reproducible, and free of `CALLCODE`, `DELEGATECALL` and `SELFDESTRUCT`), `manifest`, `protected_invariants` (seven tests against the creation code) and `economics`. IMD builds with forge 1.8.3; run the suite on that version before paying.
- IMD pays the launch transaction up to `gasCeilingWei` = 0.05 ETH on mainnet. Measured on the local mainnet fork (`script/local/`): token deploy 415,644 gas, hook deploy through the CREATE2 factory 1,390,744, pool open + single-sided seed in one transaction 289,486, about 2.1M in all before IMD's own factory overhead. At 2.1M the ceiling holds up to ~24 gwei; budget for 3.5M (~14 gwei) to be safe, and launch while the base fee is well under that.
- Rehearse locally first: `node script/local/up.mjs` deploys the whole stack on an anvil fork of mainnet and `cd site && npx --yes tsx scripts/fork-e2e.ts` exercises the site's live modules against it (buy and sell through the Universal Router, flush).

## Mainnet: live (2026-10-12)

IMD launch #1434 deployed the token and the hook and opened the pool in one transaction,
`0xac7aff89cdf23f126631da73106cd3aef33c812fd39eace00fafb8e257e522b3` (block 26177488, 16:08:23 UTC), after
every admission check passed: provenance, findings, independent review, bytecode, manifest, protected
invariants, economics. `post` then wired the vault, vested the launch wallet's 5% and handed FloorFeed and
Cocoon to the timelock; `finish` wrote `keeper/addresses.mainnet.json`.

| Contract | Address |
|---|---|
| PupateToken (PUPATE) | `0x59fb66660626a6a2c7e0e1a39af1367d09ed92b0` |
| PupateHook | `0xb5e544166144a590e171bf0350e8f227858318cc` |
| Cocoon | `0x54993066369e57a49215f6fc2D9911a8e5a57a79` |
| FloorFeed | `0x5A215aa9883cEfE5fa74085ba66288388b83700C` |
| TimelockController | `0x8bE826082c0FbAeC485048aA26ef42aC147898EC` |
| PupateVesting | `0xF0fe8B9a80366469F7FE6C82dF61330b3682B048` |
| IMD's MerkleDistributor (the swarm's 10%) | `0x15a2eb86e71f9c85c9cfb21ca4aeadb58793cbd7` |
| Pool | ETH / PUPATE, fee 12500, tick spacing 60, id `0xd4cd0ab2c332b918dae711bbb0a7ac24cd5dd80dabbd3c92c196388c45eca8a7` |

IMD's record: `https://explorer.imd.fun/token/0x59fb66660626a6a2c7e0e1a39af1367d09ed92b0` and the job
`https://explorer.imd.fun/jobs/6e0f859e-9d6f-4384-8457-0c4e0cf85f93`. The first floor report was not
sent: the attestation bought that morning had gone stale by the time the third attempt went live, so
FloorFeed holds no report yet and the vault splits deposits in NEUTRAL mode until one is bought (0.5 IMD,
of which IMD has returned half each time so far). The three attempts cost 1.5 IMD paid and 0.75 IMD
returned, plus the gas of three vault deployments.

## Mainnet, the road there (2026-10-10 to 2026-10-12)

`script/mainnet/launch.mjs pre` ran on 2026-10-10 from the deployer `0x7A2B112aF54419ed0B18e051027f3142C13441D9`
(also `DEVELOPER` and `OPERATOR`), base fee 0.063 gwei:

| Contract | Address | |
|---|---|---|
| TimelockController | `0x8bE826082c0FbAeC485048aA26ef42aC147898EC` | 48 hours, the developer proposes |
| FloorFeed | `0x5A215aa9883cEfE5fa74085ba66288388b83700C` | attester `0x5598Aa91…2982`, evidence chain 1; owned by the deployer until `post` |
| Cocoon | `0x54993066369e57a49215f6fc2D9911a8e5a57a79` | the vault as launched, deployed by `redeploy`; owned by the deployer until `post` |
| Cocoon, retired | `0xc4E514E60565a2c04bd657f18bB34B503D6c299D` | the vault of the second attempt (#1412): carried the reopening flaw the review of the first fix found; never wired, empty, abandoned |
| Cocoon, retired | `0x0adD7b9584cd73CeF21B39014e3ff6077BE53441` | the vault of launch #1400: never wired, empty, abandoned (see below) |

From block 26161806.

`question` ran on 2026-10-12. The wallet approved Permit2 for IMD
(`0x74667fc1ef6042085f7ca5cfc37371a986d728caabba8eb08480e1e389f21165`) and paid 0.5 IMD for the floor
question (order `ce7d267d-cc49-4905-86b8-a4a1a28a86cb`, payment
`0x6293f038829467a2c36690c43bbc7058ac3ab8bf182ec1645f8f31e74ba469f2`). Oracle request
`db921753-2067-4094-8547-649f63a72179` was attested in under two minutes: twelve of the twenty seats
answered, all twelve with 2.68 ETH read from OpenSea, against a quorum of eleven.

| | |
|---|---|
| Question hash, to be pinned by `post` | `0x0bd457cf1b0d092b4f12904589b3f08b5c67793cc4ef5292d79b2733ba5bab24` |
| First attested floor | 2.68 ETH, issued 2026-10-12 09:41:57 UTC, signed by `0x5598Aa91…2982` for FloorFeed on chain 1 |

The runner's progress file carries the same addresses and ids.

Before the first payment the free checks changed three things, recorded in spec revision 7 and
`docs/phase0-findings.md`: the hook's liquidity gate is the opening transaction (the hook is not deployed
yet, so only its source changed; Cocoon and FloorFeed above are as deployed), the floor question asks a
panel for the collection's lowest listing instead of a chain recipe for a median of sales, and the paid
path of the IMD client was corrected and dry-run to its last free step. One more thing surfaced at the
first payment itself: this machine's clock ran 13 seconds fast, which put the permit's deadline past the
window IMD allows (`invalid_payment_window`, nothing charged); the client now takes the time from IMD's
own answers.

Before the second payment an independent review of the gate change came back with nothing blocking
(`docs/REVIEW.md`): one regression test and one fork test through IMD's real factory were added, the
gate's one residual is stated in `launch.json` and in the request, and the request took the two-step
shape above.

### Launch #1400, parked (2026-10-12)

`open` paid 0.5 IMD (order `ef7a9245-2bc9-4a65-ae99-e91bf9514aef`, payment
`0x526a5c3e4802548392e578157cb0871fcb4df139fd567bdcb839f84eac4c4f2d`) and IMD's swarm worked on job
`f3f01060-a9cd-4c35-bad7-e54ac763a342` for 53 minutes. Six of the seven admission checks passed. The
seventh, findings, did not: the audit found that `Cocoon.skim()` could be called from inside
`takeAuction`'s lot transfer and book a taker's unrefunded excess into the burn pot. The launch was
parked as #1400 and nothing was deployed. The audit's text is on
`https://explorer.imd.fun/jobs/f3f01060-a9cd-4c35-bad7-e54ac763a342`, and `docs/REVIEW.md` records every
finding with its outcome.

The vault is fixed in the source and deployed again. `script/mainnet/launch.mjs redeploy` deploys the
new Cocoon beside the same FloorFeed and timelock, at the launch wallet's next contract address, which
`launch.json`, the launch request and the fork test already name; the step sends nothing if the wallet's
nonce has moved. It ran twice: nonce 4 gave `0xc4E514E60565a2c04bd657f18bB34B503D6c299D`, which the independent review of the first fix
then showed to carry a second flaw, and nonce 5 gives `0x54993066369e57a49215f6fc2D9911a8e5a57a79`, the vault as launched. The question hash and the first attestation are FloorFeed's
and stay as they are. Then: `manifest`, `open` (0.5 IMD), `post`, `report`, `finish`.

What that attempt taught about IMD:

- Half of each payment came back within minutes: 0.25 IMD from `0xd60483eb…9b21` after the oracle
  request and again after the launch order, so each action has cost 0.25 IMD net so far.
- The swarm needed 53 minutes from payment to verdict: 11 for the first audit, 7 for the manifest, about
  12 for the four specialists side by side, then the judge, one revision of the manifest, and the judge
  again.
- `launch.json`'s notes may be 4,000 characters at most, and a request whose objective makes a node's
  rendered assignment longer than 8,000 characters is refused by the free check (`objective_too_large`).
  An objective of about 4,500 characters fits.
- IMD's manifest agent is told by its own reference text to write `initialPrice` as 2^96; say in the
  request that the value in the manifest is to be kept.
- The wait in `open` must outlast a sleeping laptop: the runner now waits out network errors, and finds
  Foundry where `foundryup` puts it when the shell's PATH does not have it.

### Launch #1412, parked (2026-10-12)

The second attempt (order `ee02d5e3-b2da-4df5-a2be-367ba534f285`, job `2726c329-944c-4bbb-9156-5bc4c8962091`,
commit `f66596e`) was paid while the independent review of the first fix was still running, and that
review then found that the fix had opened a second hole. IMD's audit found the same hole and one more
(`buySeat` taking an order from Cocoon itself), and parked the launch after 70 minutes. Both are fixed
and recorded in `docs/REVIEW.md`; the third vault is deployed from that source. Lesson kept: the launch
is paid only after the review of a fix has come back. Before the third attempt the whole vault was audited
once more by a fresh reviewer, which found one more medium issue in a change made that day (`docs/REVIEW.md`).

## What the Sepolia rehearsal taught (2026-10-10)

`script/sepolia/up.mjs` ran the whole sequence on Sepolia with the real deployer wallet (addresses in
`keeper/addresses.sepolia.json`; all post-deploy checks pass). Four things to carry to mainnet:

- **Gas limits need a margin over forge's estimate.** Forge simulates on the project's `cancun` EVM;
  live networks run newer schedules. On Sepolia contract creation cost about seven times the estimate
  (Cocoon 38.4M gas against 5.5M on mainnet), so the rehearsal runs `--gas-estimate-multiplier 900`.
  Mainnet's `eth_estimateGas` agrees with forge (Cocoon 5.5M), so `130` is enough there. Unused gas is
  refunded; an underestimate costs the whole limit.
- **Do not take gas limits from the node per transaction (`--skip-simulation`).** The provider's nodes
  lag each other by a block or two; the second transaction's estimate then runs against a state that
  does not have the first, and forge gives up on the nonce. Keep the simulation, send with `--slow
  --retries 10 --delay 8`, and wait for the state to settle (three agreeing polls) between scripts.
- **`PostLaunch` is idempotent.** It skips the wiring, the question and the ownership transfers the
  chain already shows, and `VESTING` reuses a vesting contract an interrupted attempt deployed. A run
  that stops halfway is simply run again.
- **Free RPC tiers cap `eth_getLogs` ranges** (Alchemy: 10 blocks). The keeper and the site halve their
  log chunk when a node refuses a range and keep the size that worked, so a fresh keeper can still
  catch up from the pre-launch block.
