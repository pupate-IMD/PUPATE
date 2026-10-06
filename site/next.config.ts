import type { NextConfig } from "next";

// A static export: the site is published to IPFS and named under ENS, with no server.
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  reactStrictMode: true,
  images: { unoptimized: true },
};

export default nextConfig;
