import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

const here = path.dirname(fileURLToPath(import.meta.url));
const qrShim = path.join(here, "patches/qr-shim.mjs");

// `qr` lives nested inside bun's content-addressed cache (`.bun/qr@X.Y.Z`)
// rather than at any node-resolvable top-level path, so neither `require`
// nor `import.meta.resolve` finds it. Walk the workspace up to find the
// `.bun` cache directory, then pick the first `qr@*` entry.
function findQrEntry(start: string): string {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    const bunDir = path.join(dir, "node_modules", ".bun");
    if (fs.existsSync(bunDir)) {
      const match = fs.readdirSync(bunDir).find((d) => /^qr@\d/.test(d));
      if (match) {
        const entry = path.join(bunDir, match, "node_modules", "qr", "index.js");
        if (fs.existsSync(entry)) return entry;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Could not locate `qr` package for QR shim alias");
}

const qrRealEntry = findQrEntry(here);
// Turbopack rejects absolute filesystem paths in resolveAlias (it interprets
// the leading `/` as a server-relative URL). Webpack accepts either, but we
// give both consistent project-relative paths to keep the config compact.
const toRel = (target: string) => {
  const rel = path.relative(here, target).replace(/\\/g, "/");
  return rel.startsWith(".") ? rel : "./" + rel;
};
const qrShimRel = toRel(qrShim);
const qrRealRel = toRel(qrRealEntry);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@rainbow-me/rainbowkit"],
  // Turbopack picks up `resolveAlias` here; webpack picks up the alias in the
  // `webpack:` hook below. The patched `qr` shim swaps in a non-throwing
  // `encodeQR` so RainbowKit's WC modal can render its QR code.
  turbopack: {
    resolveAlias: {
      qr: qrShimRel,
      "qr-real": qrRealRel,
    },
  },
  webpack: (config) => {
    // wagmi / RainbowKit drag in a bunch of optional deps that don't apply on web.
    config.externals.push("pino-pretty", "lokijs", "encoding");
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      // Patched qr — `qr$` (exact) routes consumers to the shim; the shim
      // then asks for `qr-real`, which both bundlers redirect to the real
      // resolved entry path.
      qr$: qrShim,
      "qr-real$": qrRealEntry,
      // MetaMask SDK references RN AsyncStorage; nopify it on web.
      "@react-native-async-storage/async-storage": false,
    };
    // Silence noisy optional-dep warnings from RainbowKit's barrel export chain
    // (Coinbase CDP / Base Account / Phantom etc. we never wire up).
    config.ignoreWarnings = [
      ...(config.ignoreWarnings ?? []),
      { module: /node_modules\/@coinbase\/cdp-sdk/ },
      { module: /node_modules\/@base-org\/account/ },
      { module: /node_modules\/@wagmi\/connectors\/.*baseAccount/ },
      { module: /node_modules\/@metamask\/sdk/ },
      { module: /node_modules\/pino/ },
      { module: /node_modules\/ox\/.*tempo/ },
      /Critical dependency: the request of a dependency is an expression/,
    ];
    return config;
  },
};

export default nextConfig;
