# Vendored dependencies

Everything the build needs is committed as ordinary files under `lib/`. There are no git submodules and
no package manager step, and `forge build` and `forge test` need no network.

| Package | Version | Vendored | Remapping | Licence |
|---|---|---|---|---|
| [Uniswap v4-core](https://github.com/Uniswap/v4-core) | 1.0.2 (npm `@uniswap/v4-core@1.0.2`) | `src/` without `src/test/`, `licenses/` | `v4-core/=lib/v4-core/` | BUSL-1.1 for `PoolManager.sol` and six libraries (`Pool`, `Position`, `Lock`, `CurrencyDelta`, `CurrencyReserves`, `NonzeroDeltaCount`); MIT for everything else |
| [forge-std](https://github.com/foundry-rs/forge-std) | v1.9.7 | whole repository | `forge-std/=lib/forge-std/src/` | MIT OR Apache-2.0 |
| [solmate](https://github.com/transmissions11/solmate) | the copy pinned inside v4-core 1.0.2 | `src/auth/Owned.sol`, `LICENSE` | `solmate/=lib/solmate/` | AGPL-3.0-only |

The contracts in `src/` import only MIT-licensed parts of v4-core: interfaces, types, and the `Hooks` and
`SafeCast` libraries. The BUSL-1.1 files and solmate's `Owned.sol` are used only by the PoolManager that
the tests deploy locally.

`forge fmt` ignores `lib/**`, so the upstream files stay byte for byte as delivered.
