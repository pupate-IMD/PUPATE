# Pupate

Pupate is a strategy token on Ethereum. A tax on every trade funds a vault that buys Identity MD
seats, puts them to work in the IMD swarm, and lists them for resale. An IMD oracle report of the
collection's reference price decides how much of the tax buys seats and how much buys back and burns
the token.

- Design: `docs/superpowers/specs/2026-10-06-pupate-design.md`
- What was checked before building: `docs/phase0-findings.md`
- Dependencies: `docs/dependencies.md`

## Contracts

| Contract | What it does |
|---|---|
| `PupateToken` | PUPATE: a plain ERC-20 with a fixed supply, burnable by its holders. |
| `PupateHook` | Uniswap v4 hook. Takes the tax on the ETH side of every trade in the launch pool, admits liquidity only in the block the pool opens, and flushes the tax to the vault. |
| `FloorFeed` | Stores the collection's reference price from IMD oracle attestations, with a rise limit of 25% per 6 hours. |
| `Cocoon` | The vault. Splits the tax by mode, buys seats on Seaport at or under the floor, lists them, settles sales, burns PUPATE within a price-impact limit, auctions seat earnings and the IMD share, and pairs held seats to IMD workers. |
| `PupateVesting` | Releases the developer's allocation linearly over 12 months. |
| `cocoon/SeatListing`, `cocoon/Decay`, `cocoon/WorkerAuthorization` | The Seaport orders per seat, the auction price curve, and IMD's pairing digest. |

Deployment sequence and scripts: `docs/deployment.md`. Launch manifest: `launch.json`.

## Build

    forge build
    forge test

Toolchain is pinned in `foundry.toml`. Dependencies are vendored under `lib/`; the build needs no network.
