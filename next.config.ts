import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // cacheComponents is deliberately off. Every page here reads the auth cookie and
  // renders one user's private ledger, so there is nothing cacheable to gain -- only
  // Suspense ceremony and a ban on route-segment config.
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
