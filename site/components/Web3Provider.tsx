"use client";

import "@rainbow-me/rainbowkit/styles.css";
import { getDefaultConfig, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { mainnet, sepolia } from "wagmi/chains";
import { pupateTheme } from "@/lib/rainbowTheme";

// Wallet connection through RainbowKit on wagmi and viem. Injected wallets work as is; WalletConnect
// wallets need NEXT_PUBLIC_WC_PROJECT_ID from cloud.reown.com (free). The launch chain comes first.
const config = getDefaultConfig({
  appName: "Pupate",
  projectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID || "00000000000000000000000000000000",
  chains: process.env.NEXT_PUBLIC_CHAIN === "sepolia" ? [sepolia, mainnet] : [mainnet, sepolia],
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
