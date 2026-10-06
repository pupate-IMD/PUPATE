import type { NextConfig } from "next";

// A static export: the site is published to IPFS and named under ENS, with no server.
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  reactStrictMode: true,
  images: { unoptimized: true },
  webpack: (config) => {
    // wagmi's connectors reach for optional packages Pupate never uses (Coinbase's x402 payment
    // SDKs, pino's pretty printer, lokijs). Stub them so the static build does not look for them.
    const stubs = [
      "@x402/core",
      "@x402/core/client",
      "@x402/evm",
      "@x402/evm/exact/client",
      "@x402/evm/upto/client",
      "@x402/svm",
      "@x402/svm/exact/client",
      "pino-pretty",
      "lokijs",
      "encoding",
    ];
    config.resolve = config.resolve ?? {};
    config.resolve.alias = { ...(config.resolve.alias ?? {}), ...Object.fromEntries(stubs.map((s) => [s, false])) };
    config.resolve.fallback = { ...(config.resolve.fallback ?? {}), fs: false, net: false, tls: false };
    return config;
  },
};

export default nextConfig;
