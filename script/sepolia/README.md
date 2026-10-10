# Sepolia rehearsal

The mainnet deployment sequence on a public testnet, signed by the real deployer wallet, so the
scripts, the hook address mining, the pool opening, the first report and the keeper are all exercised
against real nodes before a single IMD is spent. Nothing here touches `src/` or `test/`.

    node script/sepolia/up.mjs           # deploy everything, write keeper/addresses.sepolia.json
    node script/sepolia/up.mjs status    # the deployer's balance and the addresses on record

Needs Foundry (`forge`, `cast`), Node 22+, and in `.env`: `SEPOLIA_RPC_URL` and `KEEPER_PRIVATE_KEY`
(the deployer, who is also `DEVELOPER` and `OPERATOR` here). On the first run the script generates
`SEPOLIA_ATTESTER_KEY`, a throwaway key for the feed's attester, and appends it to `.env`. No secret is
ever printed; errors are scrubbed of the RPC URL and the keys.

## What differs from mainnet

| | Sepolia rehearsal | Mainnet |
|---|---|---|
| Collection | `MockERC721` from `test/mocks`, three seats minted to the deployer | identity.md |
| IMD token | `MockERC20`, 1,000 minted to the deployer | the IMD token |
| Token, hook, pool | `script/local/LaunchLocal.s.sol`, our own factory | IMD's launch (`launch.open`, paid) |
| Oracle attester | a local key (`SEPOLIA_ATTESTER_KEY`), reports signed by `ReportLocal.s.sol` | IMD's oracle |
| Question hash | keccak256 of `keeper/questions/floor.question.txt` | from the paid oracle request |

Everything else is the mainnet sequence: `DeployPreLaunch` → launch → `PostLaunch` → first report,
with the same checks `script/local/up.mjs` makes on the fork.

## Afterwards

- The keeper: `RPC=$SEPOLIA_RPC_URL ADDRESSES=keeper/addresses.sepolia.json ATTESTATION_SOURCE=local
  ALLOW_LOCAL_ATTESTER=1 LOCAL_ATTESTER_KEY=$SEPOLIA_ATTESTER_KEY node keeper/bin/keeper.mjs --once`.
- The site in live mode against Sepolia: copy the addresses into `SEPOLIA` in `site/lib/addresses.ts`
  and run the dev server with `NEXT_PUBLIC_CHAIN=sepolia`; a wallet on Sepolia can then buy through the
  real swap panel.
- Each `up` deploys a fresh stack; the previous one stays on Sepolia, unused.
