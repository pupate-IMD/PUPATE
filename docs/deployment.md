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
`consumer.verifyingContract` = the FloorFeed address, `consumer.chainId` = the launch chain,
`chainId` = the evidence chain (mainnet), the floor question from `docs/phase0-findings.md`. The
response carries `questionHash`; keep it, and keep the attestation for the first report.

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
- Publish the site to IPFS and point `pupate.fun` at it.
- Pair the first seat: the operator calls `Cocoon.authorizeWorker` with IMD's pairing message, then
  completes the pairing on IMD with any signature bytes.

## What each party holds afterwards

| Party | Can do | Cannot do |
|---|---|---|
| Timelock (developer proposes, 48 h) | lower the tax; change Cocoon's bounded parameters, the operator, FloorFeed's attester, question and freshness | raise the tax; move ETH, seats or tokens; change the sink, the split, the launch schedule, the liquidity gate |
| Developer | claim the developer balance; change the developer address; release vested PUPATE | anything else |
| Operator | approve and revoke IMD pairings for held seats | move anything; sign anything else |
| Anyone | flush, buy, settle, adopt, burn, run the auctions, release vesting, execute matured timelock operations | |

## The launch request (IMD policy v34, 2026-10-07)

- The pool's LP fee tier must be **12500** (1.25%), tick spacing 60. The ETH-paired opening valuation is fixed by policy at 10 ETH on mainnet (20 ETH on Sepolia), up to 100 ETH.
- A `launch.open` for a self-hosted repository must carry `shape: "chain"` and the steps `audit-imported-code → adapt-contract-project → adversarial-review`; the adapt step owns its own write budget and may not be given `paths`. Ready bodies: `keeper/questions/launch.check.json` (mainnet) and `launch.sepolia.check.json`. Run `node keeper/bin/imd.mjs check launch.open <body>` first: it is free and must return no blockers. Update `baseCommit` to the commit being launched.
- IMD pays the launch transaction up to `gasCeilingWei` = 0.05 ETH on mainnet. Measured on the local mainnet fork (`script/local/`): token deploy 415,644 gas, hook deploy through the CREATE2 factory 1,390,744, pool open + single-sided seed in one transaction 289,486, about 2.1M in all before IMD's own factory overhead. At 2.1M the ceiling holds up to ~24 gwei; budget for 3.5M (~14 gwei) to be safe, and launch while the base fee is well under that.
- Rehearse locally first: `node script/local/up.mjs` deploys the whole stack on an anvil fork of mainnet and `cd site && npx --yes tsx scripts/fork-e2e.ts` exercises the site's live modules against it (buy and sell through the Universal Router, flush).
