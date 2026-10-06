# Pupate site

The Pupate website: Next.js 15 (App Router, TypeScript), exported as a static site for IPFS. Wallets
connect through RainbowKit on wagmi and viem.

    npm install
    npm run dev        # http://localhost:3000
    npm run build      # static export in out/

## Environment

Copy `.env.example` to `.env.local`:

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_WC_PROJECT_ID` | WalletConnect project id from cloud.reown.com (free). Injected wallets such as MetaMask and Rabby work without it; WalletConnect wallets need it. |
| `NEXT_PUBLIC_CHAIN` | `mainnet` (default) or `sepolia`; puts that chain first in the wallet's chain list. |

## What is real and what is not

The app, its components, the design system and the wallet connection are the real site. Until the
contracts are deployed, the figures come from `lib/sim.ts` and every button runs the same rules as
the contracts against those sample figures, inside the page. Plan 4 replaces that module with
contract reads and writes and removes the preview strip; the components stay.

## Where things are

- `app/layout.tsx`: fonts (Instrument Serif for the voice, IBM Plex Mono for the data) and the theme script.
- `app/globals.css`: the design tokens and every component style.
- `components/Web3Provider.tsx`, `lib/rainbowTheme.ts`, `components/ConnectWallet.tsx`: RainbowKit, themed with the page's CSS variables.
- `components/SimContext.tsx`, `lib/sim.ts`: the simulated protocol behind the preview.
