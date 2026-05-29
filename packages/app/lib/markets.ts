/**
 * Lightweight seed data for the Markets list. Only the demo (xETH/USDT0)
 * row is shown live; the seed exists purely as an `undefined`-safe fallback
 * while the Lens multicall is in-flight.
 */

export interface Market {
  coll: string;
  loan: string;
  chain: string;
  supply: number;
  liquidity: number;
  util: number;
  supplyApy: number;
  borrowApy: number;
  lltv: number;
  group: "eth" | "btc" | "stable";
  badge: "core" | "hot" | null;
  /** True when the row reflects real on-chain data. */
  isLive?: boolean;
}

export const MARKETS: Market[] = [
  {
    coll: "xETH",
    loan: "USDT0",
    chain: "X Layer",
    supply: 0,
    liquidity: 0,
    util: 0,
    supplyApy: 0,
    borrowApy: 0,
    lltv: 0.86,
    group: "eth",
    badge: "core",
  },
];
