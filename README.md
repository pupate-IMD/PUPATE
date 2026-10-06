# Pupate

Pupate is a strategy token on Ethereum. A tax on every trade funds a vault that buys Identity MD
seats, puts them to work in the IMD swarm, and lists them for resale. An IMD oracle report of the
collection floor decides how much of the tax buys seats and how much buys back and burns the token.

Design: `docs/superpowers/specs/2026-10-06-pupate-design.md`

## Build

    forge build
    forge test

Toolchain is pinned in `foundry.toml`. Dependencies are vendored under `lib/`; the build needs no network.
