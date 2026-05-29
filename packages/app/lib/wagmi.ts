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
  // Four browser-CORS-allowing X Layer RPCs behind a viem `fallback`.
  //
  //   • `batch: { batchSize, wait }` on every transport — coalesces every
  //     JSON-RPC call fired within `wait` ms into ONE HTTP POST. With all
  //     hooks polling (multicalls + activity getLogs + price reads), this
  //     drops outbound traffic by ~10x.
  //
  //   • `rank: { interval }` — viem pings the RPCs every minute, scores
  //     them on latency + success, and routes new requests to the
  //     healthiest. The previous `rank: false` re-attempted the official
  //     endpoint on every call and bounced to OKX on each 429 — the other
  //     two mirrors were never tried.
  //
  // publicnode is intentionally omitted: it doesn't send CORS headers and
  // the browser blocks every preflight.
  transports: {
    [xLayer.id]: fallback(
      [
        http("https://rpc.xlayer.tech",     { batch: { batchSize: 256, wait: 32 } }),
        http("https://xlayerrpc.okx.com",   { batch: { batchSize: 256, wait: 32 } }),
      ],
      {
        rank: { interval: 60_000 },
        retryCount: 1,
        retryDelay: 150,
      }
    ),
  },
  ssr: true,
});
