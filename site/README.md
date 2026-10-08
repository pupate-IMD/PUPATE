# Pupate site

The Pupate website: Next.js 15 (App Router, TypeScript), exported as a static site that any host can
serve (`deploy/` puts it on a VPS next to the keeper). Wallets connect through RainbowKit on wagmi and viem.

    npm install
    npm run dev        # http://localhost:3000
    npm run build      # static export in out/

## Environment

Copy `.env.example` to `.env.local`:

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_WC_PROJECT_ID` | WalletConnect project id from cloud.reown.com (free). Injected wallets such as MetaMask and Rabby work without it; WalletConnect wallets need it. Without it the console shows "Origin … not found on Allowlist", which is harmless until then. Add `pupate.fun` and `localhost:3000` to the project's allowlist. |
| `NEXT_PUBLIC_CHAIN` | `mainnet` (default) or `sepolia`; puts that chain first in the wallet's chain list. |
| `NEXT_PUBLIC_RPC_MAINNET`, `NEXT_PUBLIC_RPC_SEPOLIA` | RPC endpoints for the live reads and the wallet transports (a provider such as Alchemy; without them the public endpoints, which are rate-limited). |

These are baked into the export at build time. On the VPS they live in `/etc/pupate/site.env`, which
`deploy/update.sh` loads before `npm run build`.

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
- `app/{flow,feed,cocoon,emerge,steps,record}/page.tsx`: one page per stage, framed by `components/Shell.tsx`; `app/page.tsx` is the front page with its index of them.
- `app/docs/`, `lib/docs.ts`, `components/docs/`: the documentation, one page per entry in the table of contents.
- `public/skill.md`: the keeper skill, the file an agent reads to run the public steps. Fill in the addresses at launch.
- `lib/attestation.ts`, `components/OracleProof.tsx`: an IMD oracle attestation checked in the browser, with the same EIP-712 encoding as `src/oracle/OracleAttestation.sol`.
- `lib/seat.ts`, `components/EmergenceCard.tsx`: each seat's drawing, fixed by its number, and the sample record of its work.
