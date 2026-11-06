import { resolve } from "node:path";
import type { NextConfig } from "next";

const root = resolve(import.meta.dirname, "../..");

const config: NextConfig = {
  devIndicators: false,
  outputFileTracingRoot: root,
  turbopack: {
    root,
    // Anchor's browser build mentions fs in NodeWallet.local, which a browser never calls.
    resolveAlias: { fs: { browser: "./lib/empty.ts" } },
  },
  transpilePackages: ["@leash/sdk"],
};

export default config;
