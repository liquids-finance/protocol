import { defineChain } from "viem";

/**
 * X Layer mainnet — OKX's L2 (Polygon CDK based). Not in viem's built-in
 * chain list, so we define it explicitly. Hook + Lens + demo pool live here.
 */
export const xLayer = defineChain({
  id: 196,
  name: "X Layer",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  // Four browser-CORS-friendly public RPCs. viem's `fallback` transport in
  // wagmi.ts rotates between them on 429 / 5xx, so a single endpoint hitting
  // its per-IP rate-limit doesn't blank the dashboard. publicnode is NOT
  // included — it omits the `Access-Control-Allow-Origin` header and the
  // browser blocks every preflight.
  // Three browser-CORS-allowing X Layer mirrors. `xlayer.drpc.org` is
  // intentionally dropped — its X Layer node returns 500 on every
  // `eth_getLogs` request (broken on dRPC's side, not ours).
  rpcUrls: {
    default: {
      http: [
        "https://rpc.xlayer.tech",
        "https://xlayerrpc.okx.com",
        "https://rpc.ankr.com/xlayer",
      ],
    },
  },
  blockExplorers: {
    default: { name: "OKLink", url: "https://www.oklink.com/x-layer" },
  },
  testnet: false,
});
