"use client";

import { useMemo } from "react";
import { useReadContracts } from "wagmi";

import { ERC20_ABI } from "@/lib/abi/erc20";
import { HOOK_VAULT_READ_ABI } from "@/lib/abi/hook";
import { STATE_VIEW_ABI } from "@/lib/abi/stateView";
import { CONTRACTS, DEMO_POOL } from "@/lib/contracts";

/**
 * Live pool state derived from on-chain reads:
 *
 *   - `sqrtPriceX96` → spot price → human ratio for the supply/withdraw
 *     amount-linker.
 *   - `totalLiquidity` (hook.vaults) + `totalShares` (shareToken.totalSupply)
 *     → vault total amount0/amount1 (full-range approximation) → share
 *     calculation for withdraw.
 *
 * Full-range LP approximation:
 *   amount0 = L · 2^96 / sqrtPriceX96
 *   amount1 = L · sqrtPriceX96 / 2^96
 *
 * This is exact when the position is full-range and accurate-enough for UX
 * linking on tighter ranges (the on-chain math computes the exact required
 * shares; the UI just previews). Polled every 12s.
 */
const Q96 = 1n << 96n;

export interface PoolState {
  sqrtPriceX96: bigint;
  totalLiquidity: bigint;
  totalShares: bigint;
  /** Human-readable rate: how many `currency1` per 1 `currency0`. */
  rate1Per0: number;
  /** 1 / rate1Per0 — guarded for zero. */
  rate0Per1: number;
  /** Vault aggregate amount in raw units of each currency. */
  vaultAmount0Raw: bigint;
  vaultAmount1Raw: bigint;
}

export function usePoolState(): { state: PoolState | null; isLoading: boolean } {
  const { data, isLoading } = useReadContracts({
    contracts: [
      {
        address: CONTRACTS.stateView,
        abi: STATE_VIEW_ABI,
        functionName: "getSlot0",
        args: [DEMO_POOL.poolId],
      },
      {
        address: CONTRACTS.hook,
        abi: HOOK_VAULT_READ_ABI,
        functionName: "vaults",
        args: [DEMO_POOL.poolId],
      },
      {
        address: DEMO_POOL.shareToken,
        abi: ERC20_ABI,
        functionName: "totalSupply",
      },
    ],
    query: { refetchInterval: 12_000 },
  });

  const state = useMemo<PoolState | null>(() => {
    if (!data || data.length < 3 || data.some((r) => r.status !== "success")) return null;

    const slot0 = data[0]!.result as readonly [bigint, number, number, number];
    const vault = data[1]!.result as readonly [bigint, bigint, bigint, bigint];
    const totalShares = data[2]!.result as bigint;

    const sqrtPriceX96 = slot0[0];
    const totalLiquidity = vault[0];
    if (sqrtPriceX96 === 0n) return null;

    // Spot-price math — use Number for the human ratio because the eventual
    // consumer is a UI rate label (loses precision below 1e-15, irrelevant
    // for display).
    const sqrtPriceNum = Number(sqrtPriceX96) / Number(Q96);
    const priceRaw = sqrtPriceNum * sqrtPriceNum;
    const decimalScale = 10 ** (DEMO_POOL.decimals0 - DEMO_POOL.decimals1);
    const rate1Per0 = priceRaw * decimalScale;
    const rate0Per1 = rate1Per0 > 0 ? 1 / rate1Per0 : 0;

    const vaultAmount0Raw = totalLiquidity > 0n ? (totalLiquidity * Q96) / sqrtPriceX96 : 0n;
    const vaultAmount1Raw = totalLiquidity > 0n ? (totalLiquidity * sqrtPriceX96) / Q96 : 0n;

    return {
      sqrtPriceX96,
      totalLiquidity,
      totalShares,
      rate1Per0,
      rate0Per1,
      vaultAmount0Raw,
      vaultAmount1Raw,
    };
  }, [data]);

  return { state, isLoading };
}
