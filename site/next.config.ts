import type { NextConfig } from "next";

// A static export: plain files for any host (deploy/ serves them from a VPS with nginx), no server of its own.
const nextConfig: NextConfig = {
  // `npm run dev` (scripts/dev.mjs) sets NEXT_DIST_DIR=.next-dev, so the dev server owns a directory of
  // its own and `npm run build` never overwrites it mid-flight. The build keeps the default: with
  // `output: "export"` Next treats any custom distDir as the export folder and builds in `.next`
  // regardless (hasCustomExportOutput in next's build/index.js), so the site lands in `out/`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
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
      "@react-native-async-storage/async-storage",
    ];
    config.resolve = config.resolve ?? {};
    config.resolve.alias = { ...(config.resolve.alias ?? {}), ...Object.fromEntries(stubs.map((s) => [s, false])) };
    config.resolve.fallback = { ...(config.resolve.fallback ?? {}), fs: false, net: false, tls: false };
    return config;
  },
};

export default nextConfig;
