# Mainnet launch runner

`launch.mjs` is `docs/deployment.md` as a program: the same steps, in the same order, each one
reading the chain first and refusing to repeat what is already done, so an interrupted launch is
continued by running the step again. The two steps that spend IMD say so in their names below and
are run on an explicit go.

    node script/mainnet/launch.mjs status     balances, base fee, which steps are done
    node script/mainnet/launch.mjs pre        DeployPreLaunch: timelock, FloorFeed, Cocoon          gas only
    node script/mainnet/launch.mjs question   Permit2 approval if needed, the oracle request, the
                                              attestation, questionHash                           0.5 IMD
    node script/mainnet/launch.mjs manifest   fill launch.json, commit, push, free launch check    nothing
    node script/mainnet/launch.mjs open       launch.open, wait until live, verify token and hook  0.5 IMD
    node script/mainnet/launch.mjs post       PostLaunch: wire, vest 5%, pin the question, hand
                                              FloorFeed and Cocoon to the timelock                 gas only
    node script/mainnet/launch.mjs report     the first floor report, from the kept attestation    gas only
    node script/mainnet/launch.mjs finish     keeper/addresses.mainnet.json, the site snippet, links

Needs Foundry, Node 22+, the keeper's dependencies (`cd keeper && npm install`), and in `.env`:
`MAINNET_RPC_URL`, `KEEPER_PRIVATE_KEY` (the deployer, who is `DEVELOPER`, `OPERATOR` and the wallet
that pays IMD), optionally `ETHERSCAN_API_KEY` for source verification and `MAX_BASE_FEE_GWEI`
(default 1: no transaction is sent while the base fee is above it). No secret is printed; errors are
scrubbed of the RPC URL and the keys.

## What it keeps

Progress (addresses, the oracle request id, the question hash, the launch id) in
`%TEMP%/pupate-mainnet/progress.json` and a copy in `keeper/.launch/progress.json` (ignored by git);
the first attestation in `keeper/.launch/first-attestation.json`; the paid-action request token in
`keeper/.imd/token` (ignored by git; it is what reads the orders later). `finish` writes
`keeper/addresses.mainnet.json`, which is committed.

## Built from the Sepolia rehearsal

Gas limits are forge's simulation times 1.3 (mainnet's `eth_estimateGas` agrees with forge, unlike
Sepolia's); transactions go out one at a time with retries, and each step waits for three agreeing
polls before reading what the previous one did, because the RPC provider's nodes lag each other.
`PostLaunch` itself is idempotent. `open` finds the launch by repository and commit on
`GET /launches` and stops with the reason if IMD parks it.
