"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";

/// RainbowKit's connect flow behind Pupate's own button. Connected: the address and a jade dot, and
/// a click opens the account view. Wrong network: the chain switcher.
export function ConnectWallet({ className = "btn" }: { className?: string }) {
  return (
    <ConnectButton.Custom>
      {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
        const ready = mounted;
        const connected = ready && account && chain;
        if (!ready) {
          return (
            <button className={className} aria-hidden="true" disabled style={{ opacity: 0 }}>
              Connect
            </button>
          );
        }
        if (!connected) {
          return (
            <button className={className} onClick={openConnectModal} type="button">
              Connect
            </button>
          );
        }
        if (chain.unsupported) {
          return (
            <button className={className} onClick={openChainModal} type="button" style={{ borderColor: "var(--alarm)", color: "var(--alarm)" }}>
              Wrong network
            </button>
          );
        }
        return (
          <button className={className} onClick={openAccountModal} type="button">
            <i className="chip-dot" aria-hidden="true" />
            {account.displayName}
            {account.displayBalance ? <span className="dim">{account.displayBalance}</span> : null}
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}
