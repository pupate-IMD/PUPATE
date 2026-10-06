# Vendored dependencies

Everything the build needs is committed as ordinary files under `lib/`. There are no git submodules and
no package manager step, and `forge build` and `forge test` need no network.

| Package | Version | Vendored | Remapping | Licence |
|---|---|---|---|---|
| [Uniswap v4-core](https://github.com/Uniswap/v4-core) | 1.0.2 (npm `@uniswap/v4-core@1.0.2`) | `src/` without `src/test/`, `licenses/` | `v4-core/=lib/v4-core/` | BUSL-1.1 for `PoolManager.sol` and six libraries (`Pool`, `Position`, `Lock`, `CurrencyDelta`, `CurrencyReserves`, `NonzeroDeltaCount`); MIT for everything else |
| [forge-std](https://github.com/foundry-rs/forge-std) | v1.9.7 | whole repository | `forge-std/=lib/forge-std/src/` | MIT OR Apache-2.0 |
| [solmate](https://github.com/transmissions11/solmate) | the copy pinned inside v4-core 1.0.2 | `src/auth/Owned.sol`, `LICENSE` | `solmate/=lib/solmate/` | AGPL-3.0-only |
| [seaport-types](https://github.com/ProjectOpenSea/seaport-types) | 1.6.0 (npm `seaport-types@1.6.0`) | `src/`, `LICENSE` | `seaport-types/=lib/seaport-types/` | MIT |
| [OpenZeppelin Contracts](https://github.com/OpenZeppelin/openzeppelin-contracts) | 5.4.0 (npm `@openzeppelin/contracts@5.4.0`) | `governance/TimelockController.sol` and the eleven files it imports | `@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/` | MIT (SPDX headers; the npm package ships no licence file) |

The contracts in `src/` import only MIT-licensed parts of v4-core: interfaces, types, and the `Hooks`,
`SafeCast` and `FullMath` libraries. The BUSL-1.1 files and solmate's `Owned.sol` are used only by the
PoolManager that the tests deploy locally. Seaport itself is not vendored: Cocoon calls the live Seaport
1.6 at `0x0000000000000068F116a894984e2DB1123eB395` through its interface, and the tests use a local
stand-in plus a mainnet fork.

`forge fmt` ignores `lib/**`, so the upstream files stay byte for byte as delivered.
