"use client";

import { useMemo } from "react";
import type { Address } from "viem";
import { useAccount, useReadContracts } from "wagmi";

import { ERC20_ABI } from "@/lib/abi/erc20";
import { HOOK_VAULT_READ_ABI } from "@/lib/abi/hook";
import { LENS_ABI } from "@/lib/abi/lens";
import { PERMIT2_ABI } from "@/lib/abi/permit2";
import { DEMO_POOL_KEY } from "@/lib/abi/poolKey";
import { STATE_VIEW_ABI } from "@/lib/abi/stateView";
import { CONTRACTS, DEMO_POOL } from "@/lib/contracts";

/**
 * `useLiveData` — single source of truth for every on-chain read the app
 * cares about. Replaces the old fan-out of `useDemoMarket / useUserPosition
 * / useUserBalances / usePoolState / useURPermitAllowances` which each ran
 * their own multicall on their own interval. Splitting them duplicated reads
 * across hooks (e.g. `shareBalance` was fetched twice) and meant every page
 * paid a separate first-fetch cost on mount.
 *
 * Architecture
 *
 *   `usePoolReads()`  — 8-call multicall, no user address needed. Runs
 *                       always (so the marketing/landing surfaces of the
 *                       app stay live before connect).
 *
 *   `useUserReads()`  — 10-call multicall, gated on `address`. Polled at
 *                       the same cadence as the pool reads.
 *
 *   `useLiveData()`   — composes them into a single value, exposes a
 *                       `refetch()` that invalidates both at once for
 *                       write hooks to call after a tx confirms.
 *
 * Why two multicalls instead of one? `useReadContracts` arrays must have
 * a stable shape, and we don't want to force user-level reads when no
 * wallet is connected. The viem `fallback` + `batch: true` transport in
 * `lib/wagmi.ts` coalesces both into ONE HTTP POST per polling tick, so
 * we get the convenience of separate hooks without paying for two round
 * trips.
 *
 * React-query handles cross-page caching automatically: the same query
 * key returns cached data instantly, refetches in the background.
 */

const Q96 = 1n << 96n;
const WAD = 10n ** 18n;
const MAX_UINT256 = (1n << 256n) - 1n;
const POLL_INTERVAL_MS = 8_000;
const STALE_MS = 5_000;

// ════════════════════════════════════════════════════════════════════════
//   Pool side — everything that's the same for every user
// ════════════════════════════════════════════════════════════════════════

export interface PoolLive {
  /** Total vault value (USD-WAD), projected to this block. */
  totalAssetsUsdWad: bigint;
  /** Vault utilization (WAD: 1e18 = 100%). */
  utilizationWad: bigint;
  /** Borrow rate per year (WAD). */
  borrowApyWad: bigint;
  /** Lending rate paid to LPs per year (WAD). */
  lendingApyWad: bigint;
  /** USD-WAD value of one whole vault share. */
  shareValueWad: bigint;
  /** V4 pool spot price as sqrt(price) × 2^96. */
  sqrtPriceX96: bigint;
  /** Aggregate V4 liquidity owned by the vault. */
  totalLiquidity: bigint;
  /** ERC20 total supply of the share token. */
  totalShares: bigint;
  /** Human ratio: how many `currency1` (xETH) per 1 `currency0` (USDT0). */
  rate1Per0: number;
  /** 1 / rate1Per0, guarded for zero. */
  rate0Per1: number;
  /** Vault's full-range token totals (raw units of each currency). */
  vaultAmount0Raw: bigint;
  vaultAmount1Raw: bigint;
}

function usePoolReads(): {
  pool: PoolLive | null;
  isLoading: boolean;
  refetch: () => Promise<unknown>;
} {
  const { data, isLoading, refetch } = useReadContracts({
    contracts: [
      // 0
      { address: CONTRACTS.lens, abi: LENS_ABI, functionName: "totalAssets", args: [DEMO_POOL_KEY] },
      // 1
      { address: CONTRACTS.lens, abi: LENS_ABI, functionName: "utilization", args: [DEMO_POOL_KEY] },
      // 2
      { address: CONTRACTS.lens, abi: LENS_ABI, functionName: "borrowAPY", args: [DEMO_POOL_KEY] },
      // 3
      { address: CONTRACTS.lens, abi: LENS_ABI, functionName: "lendingAPY", args: [DEMO_POOL_KEY] },
      // 4
      { address: CONTRACTS.lens, abi: LENS_ABI, functionName: "shareValue", args: [DEMO_POOL_KEY] },
      // 5  (uint160, int24, uint24, uint24)
      { address: CONTRACTS.stateView, abi: STATE_VIEW_ABI, functionName: "getSlot0", args: [DEMO_POOL.poolId] },
      // 6  (uint128, uint64, uint256, uint256)
      { address: CONTRACTS.hook, abi: HOOK_VAULT_READ_ABI, functionName: "vaults", args: [DEMO_POOL.poolId] },
      // 7
      { address: DEMO_POOL.shareToken, abi: ERC20_ABI, functionName: "totalSupply" },
    ],
    query: {
      refetchInterval: POLL_INTERVAL_MS,
      staleTime: STALE_MS,
      refetchOnWindowFocus: true,
    },
  });

  const pool = useMemo<PoolLive | null>(() => {
    if (!data || data.length < 8) return null;

    // Field-level fallback policy: a single failing read on the multicall
    // (e.g. a transient RPC hiccup or one Lens function reverting on an
    // empty pool) MUST NOT zero out the whole dashboard. Pull each result
    // individually, log the failure for debug, fall back to a sensible
    // default. Only a missing `sqrtPriceX96` skips the derived rate math.
    const read = <T,>(idx: number, label: string, fallback: T): T => {
      const r = data[idx];
      if (!r) return fallback;
      if (r.status === "success") return r.result as T;
      if (typeof console !== "undefined") {
        console.warn(`[useLiveData] pool[${idx}] (${label}) failed`, r.error);
      }
      return fallback;
    };

    const totalAssetsUsdWad = read<bigint>(0, "totalAssets", 0n);
    const utilizationWad = read<bigint>(1, "utilization", 0n);
    const borrowApyWad = read<bigint>(2, "borrowAPY", 0n);
    const lendingApyWad = read<bigint>(3, "lendingAPY", 0n);
    const shareValueWad = read<bigint>(4, "shareValue", 0n);
    const slot0 = read<readonly [bigint, number, number, number]>(
      5,
      "getSlot0",
      [0n, 0, 0, 0]
    );
    const vault = read<readonly [bigint, bigint, bigint, bigint]>(
      6,
      "vaults",
      [0n, 0n, 0n, 0n]
    );
    const totalShares = read<bigint>(7, "totalSupply", 0n);

    const sqrtPriceX96 = slot0[0];
    const totalLiquidity = vault[0];

    // Without a valid sqrtPrice we can't derive a human rate or vault
    // token totals, but the Lens stats (TVL, util, APYs) are still
    // valid in their own right — surface them.
    let rate1Per0 = 0;
    let rate0Per1 = 0;
    let vaultAmount0Raw = 0n;
    let vaultAmount1Raw = 0n;

    if (sqrtPriceX96 > 0n) {
      const sqrtPriceNum = Number(sqrtPriceX96) / Number(Q96);
      const priceRaw = sqrtPriceNum * sqrtPriceNum;
      const decimalScale = 10 ** (DEMO_POOL.decimals0 - DEMO_POOL.decimals1);
      rate1Per0 = priceRaw * decimalScale;
      rate0Per1 = rate1Per0 > 0 ? 1 / rate1Per0 : 0;

      if (totalLiquidity > 0n) {
        vaultAmount0Raw = (totalLiquidity * Q96) / sqrtPriceX96;
        vaultAmount1Raw = (totalLiquidity * sqrtPriceX96) / Q96;
      }
    }

    return {
      totalAssetsUsdWad,
      utilizationWad,
      borrowApyWad,
      lendingApyWad,
      shareValueWad,
      sqrtPriceX96,
      totalLiquidity,
      totalShares,
      rate0Per1,
      rate1Per0,
      vaultAmount0Raw,
      vaultAmount1Raw,
    };
  }, [data]);

  return { pool, isLoading, refetch };
}

// ════════════════════════════════════════════════════════════════════════
//   User side — balances, allowances, debt, projected HF
// ════════════════════════════════════════════════════════════════════════

export interface UserLive {
  address: Address;
  /** USDT0 balance (raw, 6 decimals). */
  usdt0Balance: bigint;
  /** USDT0 allowance to the canonical Permit2 contract. */
  usdt0PermitAllowance: bigint;
  /** xETH balance (raw, 18 decimals). */
  xethBalance: bigint;
  /** xETH allowance to the canonical Permit2 contract. */
  xethPermitAllowance: bigint;
  /** LP share token balance (18 decimals). */
  shareBalance: bigint;
  /** Outstanding borrow in raw USDT0 units. */
  debtRaw: bigint;
  /** Health factor (WAD). `null` when user has no debt (HF = ∞). */
  hfWad: bigint | null;
  /** Derived: USD-WAD value of the user's supplied LP. */
  suppliedUsdWad: bigint;
  /** Derived: USD-WAD value of outstanding debt. */
  debtUsdWad: bigint;
  /** Permit2 → Universal Router allowance for USDT0 (used by swap path). */
  usdt0UrAllowance: { amount: bigint; expiration: number; nonce: number };
  xethUrAllowance: { amount: bigint; expiration: number; nonce: number };
}

function useUserReads(): {
  user: UserLive | null;
  isLoading: boolean;
  refetch: () => Promise<unknown>;
} {
  const { address } = useAccount();

  const { data, isLoading, refetch } = useReadContracts({
    contracts: address
      ? [
          // 0  USDT0 balance
          { address: DEMO_POOL.currency0, abi: ERC20_ABI, functionName: "balanceOf", args: [address] },
          // 1  USDT0 → Permit2 allowance
          {
            address: DEMO_POOL.currency0,
            abi: ERC20_ABI,
            functionName: "allowance",
            args: [address, CONTRACTS.permit2],
          },
          // 2  xETH balance
          { address: DEMO_POOL.currency1, abi: ERC20_ABI, functionName: "balanceOf", args: [address] },
          // 3  xETH → Permit2 allowance
          {
            address: DEMO_POOL.currency1,
            abi: ERC20_ABI,
            functionName: "allowance",
            args: [address, CONTRACTS.permit2],
          },
          // 4  share balance
          { address: DEMO_POOL.shareToken, abi: ERC20_ABI, functionName: "balanceOf", args: [address] },
          // 5  share value (same as pool — but bundled here so we can derive USD without the pool fetch)
          { address: CONTRACTS.lens, abi: LENS_ABI, functionName: "shareValue", args: [DEMO_POOL_KEY] },
          // 6  debtOf
          { address: CONTRACTS.lens, abi: LENS_ABI, functionName: "debtOf", args: [DEMO_POOL_KEY, address] },
          // 7  healthFactor
          { address: CONTRACTS.lens, abi: LENS_ABI, functionName: "healthFactor", args: [DEMO_POOL_KEY, address] },
          // 8  Permit2 → UR allowance for USDT0
          {
            address: CONTRACTS.permit2,
            abi: PERMIT2_ABI,
            functionName: "allowance",
            args: [address, DEMO_POOL.currency0, CONTRACTS.universalRouter],
          },
          // 9  Permit2 → UR allowance for xETH
          {
            address: CONTRACTS.permit2,
            abi: PERMIT2_ABI,
            functionName: "allowance",
            args: [address, DEMO_POOL.currency1, CONTRACTS.universalRouter],
          },
        ]
      : [],
    query: {
      enabled: Boolean(address),
      refetchInterval: POLL_INTERVAL_MS,
      staleTime: STALE_MS,
      refetchOnWindowFocus: true,
    },
  });

  const user = useMemo<UserLive | null>(() => {
    if (!address || !data || data.length < 10) return null;

    const read = <T,>(idx: number, label: string, fallback: T): T => {
      const r = data[idx];
      if (!r) return fallback;
      if (r.status === "success") return r.result as T;
      if (typeof console !== "undefined") {
        console.warn(`[useLiveData] user[${idx}] (${label}) failed`, r.error);
      }
      return fallback;
    };

    const usdt0Balance = read<bigint>(0, "USDT0.balanceOf", 0n);
    const usdt0PermitAllowance = read<bigint>(1, "USDT0.allowance(permit2)", 0n);
    const xethBalance = read<bigint>(2, "xETH.balanceOf", 0n);
    const xethPermitAllowance = read<bigint>(3, "xETH.allowance(permit2)", 0n);
    const shareBalance = read<bigint>(4, "share.balanceOf", 0n);
    const shareValueWad = read<bigint>(5, "shareValue", 0n);
    const debtRaw = read<bigint>(6, "debtOf", 0n);
    const hfRaw = read<bigint>(7, "healthFactor", MAX_UINT256);
    const u = read<readonly [bigint, number, number]>(8, "permit2.allowance(USDT0,UR)", [0n, 0, 0]);
    const x = read<readonly [bigint, number, number]>(9, "permit2.allowance(xETH,UR)", [0n, 0, 0]);

    // shareValue is USD-WAD per WHOLE share (1e18 = 1 share) → multiply by
    // raw share balance and shift by one WAD to get suppliedUsd.
    const suppliedUsdWad = (shareBalance * shareValueWad) / WAD;

    // healthFactor returns type(uint256).max when debt == 0; treat that as
    // "no debt" and back-derive debtUsd from collateralUsd / HF otherwise.
    const noDebt = hfRaw >= MAX_UINT256 / 2n || debtRaw === 0n;
    const debtUsdWad = noDebt ? 0n : (suppliedUsdWad * WAD) / hfRaw;
    const hfWad = noDebt ? null : hfRaw;

    return {
      address,
      usdt0Balance,
      usdt0PermitAllowance,
      xethBalance,
      xethPermitAllowance,
      shareBalance,
      debtRaw,
      hfWad,
      suppliedUsdWad,
      debtUsdWad,
      usdt0UrAllowance: { amount: u[0], expiration: u[1], nonce: u[2] },
      xethUrAllowance: { amount: x[0], expiration: x[1], nonce: x[2] },
    };
  }, [data, address]);

  return { user, isLoading, refetch };
}

// ════════════════════════════════════════════════════════════════════════
//   Public composite hook
// ════════════════════════════════════════════════════════════════════════

export interface LiveData {
  pool: PoolLive | null;
  user: UserLive | null;
  isLoading: boolean;
  /** Force-refresh both multicalls — call from write hooks after a tx confirms. */
  refetch: () => Promise<void>;
}

export function useLiveData(): LiveData {
  const poolRes = usePoolReads();
  const userRes = useUserReads();

  const refetch = useMemo(() => {
    return async () => {
      await Promise.all([poolRes.refetch(), userRes.refetch()]);
    };
  }, [poolRes.refetch, userRes.refetch]);

  return {
    pool: poolRes.pool,
    user: userRes.user,
    isLoading: poolRes.isLoading || userRes.isLoading,
    refetch,
  };
}
