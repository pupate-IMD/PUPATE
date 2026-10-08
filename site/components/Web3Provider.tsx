"use client";

import "@rainbow-me/rainbowkit/styles.css";
import { getDefaultConfig, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { http, WagmiProvider } from "wagmi";
import { foundry, mainnet, sepolia } from "wagmi/chains";
import { TARGET } from "@/lib/addresses";
import { pupateTheme } from "@/lib/rainbowTheme";

// Wallet connection through RainbowKit on wagmi and viem. Injected wallets work as is; WalletConnect
// wallets need NEXT_PUBLIC_WC_PROJECT_ID from cloud.reown.com (free). The target chain comes first;
// the local anvil fork (chain 31337) is offered only when the site is built for it. Reads go through
// the public endpoints unless NEXT_PUBLIC_RPC_MAINNET / NEXT_PUBLIC_RPC_SEPOLIA name a provider.
const chains =
  TARGET === "local"
    ? ([foundry, mainnet, sepolia] as const)
    : TARGET === "sepolia"
      ? ([sepolia, mainnet] as const)
      : ([mainnet, sepolia] as const);

const config = getDefaultConfig({
  appName: "Pupate",
  projectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID || "00000000000000000000000000000000",
  chains,
  transports: {
    [mainnet.id]: http(process.env.NEXT_PUBLIC_RPC_MAINNET || undefined),
    [sepolia.id]: http(process.env.NEXT_PUBLIC_RPC_SEPOLIA || undefined),
    [foundry.id]: http("http://127.0.0.1:8545"),
  },
  ssr: true,
});

export function Web3Provider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={pupateTheme()} modalSize="compact" appInfo={{ appName: "Pupate" }}>
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
