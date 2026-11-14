import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // The dev server is reached at the tailscale/LAN address, not just localhost,
  // so its HMR websocket has to accept those origins too.
  allowedDevOrigins: ["100.116.42.40", "192.168.0.102", "localhost", "127.0.0.1"],
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
