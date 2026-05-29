"use client";

import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import {
  injectedWallet,
  metaMaskWallet,
  okxWallet,
  rainbowWallet,
  trustWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { fallback, http } from "viem";

import { xLayer } from "./chains";

/**
 * WalletConnect Cloud project for Liquids.finance. Set
 * `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` to override (e.g. per-deploy projects).
 */
const realProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";

// `getDefaultConfig` throws `No projectId found` when the value is empty,
// which kills static prerendering during `next build` (CI, Vercel preview
// without env set, etc.). We feed a zero-filled placeholder through to
// satisfy the type/validation check at build time; the runtime warning
// below still surfaces the real misconfiguration to anyone actually
// trying to use the app.
const projectId = realProjectId || "00000000000000000000000000000000";

if (typeof window !== "undefined" && !realProjectId) {
  console.warn(
    "[wagmi] NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is empty — WalletConnect QR pairing will fail. " +
      "Set the env var in `packages/app/.env.local` (dev) or in Vercel project env (prod) and restart."
  );
}

/**
 * `getDefaultConfig` is RainbowKit v2's canonical wagmi factory — it produces
 * the exact `createConfig` invocation the WalletConnect SignClient expects
 * (proper metadata, `multiInjectedProviderDiscovery: false`, queueing /
 * SSR hydration). The custom-`connectorsForWallets`-then-`createConfig`
 * variant we ran before missed at least one of those, which is the most
 * likely cause of the dead pairing URI on phones.
 *
 * We DO pass our own wallet ordering so OKX stays at the top of the
 * "Recommended on X Layer" group — supported via the `wallets` arg.
 */
export const wagmiConfig = getDefaultConfig({
  appName: "Liquids.finance",
  appDescription: "Pool-native lending on Uniswap V4 — demo build on X Layer.",
  appUrl: "https://app.liquids.finance",
  appIcon: "https://app.liquids.finance/icon.svg",
  projectId,
  chains: [xLayer],
  wallets: [
    {
      groupName: "Recommended on X Layer",
      wallets: [okxWallet, injectedWallet, metaMaskWallet],
    },
    {
      groupName: "Other",
      wallets: [walletConnectWallet, rainbowWallet, trustWallet],
    },
  ],
  // Browser-CORS-allowing X Layer RPCs behind a viem `fallback`.
  //
  // ⚠️ `batch` is INTENTIONALLY OFF. Two reasons:
  //
  //   1. Multicall3 (configured on the chain in `chains.ts`) already
  //      collapses every multi-read into ONE on-chain `eth_call`, so the
  //      JSON-RPC batch layer adds almost no traffic savings.
  //
  //   2. X Layer's public RPCs occasionally return a JSON-RPC batch
  //      response with a missing entry (one of the requests in the array
  //      just isn't there in the reply). viem 2.51's batch parser then
  //      crashes at http.ts:169 with
  //         `Cannot read properties of undefined (reading 'error')`
  //      because `body.find(r => r.id === id)` came back undefined.
  //      That single broken response cascades into every read failing,
  //      blanking the entire dashboard. Disabling batch makes each
  //      eth_call its own POST — slower in theory, but the Multicall3
  //      consolidation already gives us the win.
  //
  //   • `rank: { interval }` — viem pings the RPCs every minute, scores
  //     them on latency + success, and routes new requests to the
  //     healthiest one.
  //
  // publicnode is omitted: no CORS headers, the browser blocks every
  // preflight.
  transports: {
    [xLayer.id]: fallback(
      [
        http("https://rpc.xlayer.tech"),
        http("https://xlayerrpc.okx.com"),
      ],
      {
        rank: { interval: 60_000 },
        retryCount: 2,
        retryDelay: 200,
      }
    ),
  },
  ssr: true,
});
