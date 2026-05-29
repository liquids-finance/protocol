"use client";

import { useReadContracts } from "wagmi";

import { LENS_ABI } from "@/lib/abi/lens";
import { DEMO_POOL_KEY } from "@/lib/abi/poolKey";
import { CONTRACTS } from "@/lib/contracts";

/**
 * Live read of the only registered Liquids market on X Layer.
 *
 * One multicall against LiquidsLensDemo for the projected views; everything
 * returns in WAD (1e18) — convert to display at the boundary, not in here.
 *
 * Polls every 15s so the demo feels live without hammering the RPC.
 */
export interface DemoMarketStats {
  /** Total vault assets in USD-WAD. */
  totalAssetsWad: bigint;
  /** Utilization in WAD (1e18 = 100%). */
  utilizationWad: bigint;
  /** Borrow APY in WAD (1e18 = 100% per year). */
  borrowApyWad: bigint;
  /** Lending APY paid to LPs in WAD. */
  lendingApyWad: bigint;
}

export function useDemoMarket(): {
  stats: DemoMarketStats | null;
  isLoading: boolean;
  isError: boolean;
} {
  const base = {
    address: CONTRACTS.lens,
    abi: LENS_ABI,
    args: [DEMO_POOL_KEY],
  } as const;

  const { data, isLoading, isError } = useReadContracts({
    contracts: [
      { ...base, functionName: "totalAssets" },
      { ...base, functionName: "utilization" },
      { ...base, functionName: "borrowAPY" },
      { ...base, functionName: "lendingAPY" },
    ],
    query: {
      refetchInterval: 15_000,
    },
  });

  if (!data || data.some((r) => r.status !== "success")) {
    return { stats: null, isLoading, isError };
  }

  return {
    stats: {
      totalAssetsWad: data[0].result as bigint,
      utilizationWad: data[1].result as bigint,
      borrowApyWad: data[2].result as bigint,
      lendingApyWad: data[3].result as bigint,
    },
    isLoading,
    isError,
  };
}
