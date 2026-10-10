// Where the contracts live, per chain. A chain with addresses runs the site in live mode; a chain
// without them runs the preview simulation. Mainnet and Sepolia are filled in when the contracts are
// deployed; the local anvil fork publishes its own file (written by script/local/up.mjs, gitignored).

import type { Address } from "viem";

export interface Addresses {
  chainId: number;
  /// The block of the pre-launch deploy; event history is read from here.
  fromBlock: number;
  token: Address;
  hook: Address;
  cocoon: Address;
  feed: Address;
  timelock: Address;
  vesting?: Address;
  poolManager: Address;
  universalRouter: Address;
  quoter: Address;
  permit2: Address;
  collection: Address;
  imd: Address;
  seaport: Address;
  poolKey: { fee: number; tickSpacing: number };
}

export const PERMIT2: Address = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
export const SEAPORT: Address = "0x0000000000000068F116a894984e2DB1123eB395";
export const COLLECTION: Address = "0x0000eC93127BAA929E58E97dd0095A2BFb38ec1D";
export const IMD: Address = "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7";

/// Uniswap v4 on each chain, from developers.uniswap.org/docs/protocols/v4/deployments.
export const UNISWAP = {
  1: {
    poolManager: "0x000000000004444c5dc75cB358380D2e3dE08A90",
    universalRouter: "0x66a9893cc07d91d95644aedd05d03f95e1dba8af",
    quoter: "0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203",
  },
  11155111: {
    poolManager: "0xE03A1074c86CFeDd5C142C4F04F1a1536e203543",
    universalRouter: "0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b",
    quoter: "0x61b3f2011a92d183c7dbadbda940a7555ccf9227",
  },
} as const satisfies Record<number, { poolManager: Address; universalRouter: Address; quoter: Address }>;

// Filled at launch (mainnet) and at the rehearsal (Sepolia). Null keeps the chain in preview mode.
export const MAINNET: Addresses | null = null;

/// The Sepolia rehearsal of 2026-10-10 (script/sepolia/up.mjs): the real contracts against a mock
/// collection and a mock IMD, the pool opened by the local launch factory. Test figures, not Pupate.
export const SEPOLIA: Addresses | null = {
  chainId: 11155111,
  fromBlock: 11884126,
  token: "0xF5389EA27807536BAA5B6096f3F873E86606F3F3",
  hook: "0x84C2E27279a14D314CCB4fD94611A4c3e84018cc",
  cocoon: "0xFF466998add222dE5963f9648Fc8499a46bADC82",
  feed: "0x17FD7Bc83F893868798caa27B0aa5c1444fb6E22",
  timelock: "0x780A18072C024EA79B2f4E27dA89AaF3B166C5A3",
  vesting: "0x1582D6710a3e1aFBa2E8eC4aDD75acd82CE464a7",
  poolManager: UNISWAP[11155111].poolManager,
  universalRouter: UNISWAP[11155111].universalRouter,
  quoter: UNISWAP[11155111].quoter,
  permit2: PERMIT2,
  collection: "0x0adD7b9584cd73CeF21B39014e3ff6077BE53441",
  imd: "0x2B14082662A1664C60D9BdE5ef54aD2fd98b5f65",
  seaport: SEAPORT,
  poolKey: { fee: 12500, tickSpacing: 60 },
};

export type Target = "mainnet" | "sepolia" | "local";

export const TARGET: Target =
  process.env.NEXT_PUBLIC_CHAIN === "sepolia" ? "sepolia" : process.env.NEXT_PUBLIC_CHAIN === "local" ? "local" : "mainnet";

export const TARGET_CHAIN_ID = TARGET === "sepolia" ? 11155111 : TARGET === "local" ? 31337 : 1;

/// The addresses for the configured target, or null for preview mode. The local fork's file is
/// fetched at runtime so a fresh deploy needs no rebuild.
export async function loadAddresses(): Promise<Addresses | null> {
  if (TARGET === "mainnet") return MAINNET;
  if (TARGET === "sepolia") return SEPOLIA;
  try {
    const res = await fetch("/addresses.local.json", { cache: "no-store" });
    if (!res.ok) return null;
    const a = (await res.json()) as Addresses;
    return a && a.token && a.hook && a.cocoon && a.feed ? a : null;
  } catch {
    return null;
  }
}
