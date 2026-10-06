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
- Start the keeper (Plan 4): reports every six hours, `flush`, `buySeat`, `settleSeat`, `burn`, the
  auctions.
- Publish the site to IPFS and point `pupate.si` at it.
- Pair the first seat: the operator calls `Cocoon.authorizeWorker` with IMD's pairing message, then
  completes the pairing on IMD with any signature bytes.

## What each party holds afterwards

| Party | Can do | Cannot do |
|---|---|---|
| Timelock (developer proposes, 48 h) | lower the tax; change Cocoon's bounded parameters, the operator, FloorFeed's attester, question and freshness | raise the tax; move ETH, seats or tokens; change the sink, the split, the launch schedule, the liquidity gate |
| Developer | claim the developer balance; change the developer address; release vested PUPATE | anything else |
| Operator | approve and revoke IMD pairings for held seats | move anything; sign anything else |
| Anyone | flush, buy, settle, adopt, burn, run the auctions, release vesting, execute matured timelock operations | |
