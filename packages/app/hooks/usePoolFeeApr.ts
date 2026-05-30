"use client";

import { useEffect, useState } from "react";

import { DEMO_POOL } from "@/lib/contracts";
import { wadToNum } from "@/lib/format";

import type { PoolLive } from "./useLiveData";

/**
 * usePoolFeeApr — realised LP-fee APR for the V4 pool.
 *
 * The same arithmetic Uniswap's subgraph runs, just done in-browser
 * against on-chain accumulators. V4 stores `feeGrowthGlobal0/1X128` per
 * pool — a lifetime "fee per unit of liquidity" counter. Diff that
 * against a stored snapshot, multiply by the vault's current liquidity,
 * convert to USD, annualise, divide by TVL. No subgraph required.
 *
 *   APR ≈ (Δfees_USD × seconds-per-year)  /  (window_seconds × TVL_USD)
 *
 * The trade-off vs. an off-chain feed:
 *
 *   • The snapshot lives in localStorage, so it's per-browser and starts
 *     empty. The very first visit returns `null` (we don't have a "T0"
 *     yet). Subsequent visits return a real number whose denominator
 *     widens with elapsed time.
 *
 *   • Window grows until it hits `MAX_WINDOW_SEC` (24 h), then we rotate
 *     so the figure stays "trailing 24 h" rather than "since the dawn of
 *     time".
 *
 *   • While the window is shorter than `MIN_WINDOW_SEC` we return null —
 *     a 5-second sample would be far too noisy to trust.
 *
 *   • A re-init of the pool (totalLiquidity drops to zero) blows out the
 *     snapshot; the next non-zero liquidity reading reseeds it.
 *
 * For a hackathon demo this is honest: real on-chain data, transparent
 * methodology, and the limitations are visible to anyone reading the
 * code.
 */

const SNAPSHOT_KEY = `liquids-fee-apr-snap:${DEMO_POOL.poolId}`;
const MIN_WINDOW_SEC = 30; // wait at least this long before trusting the average
const MAX_WINDOW_SEC = 24 * 60 * 60; // rotate so the figure is trailing-24h-ish
const SEC_PER_YEAR = 365 * 24 * 60 * 60;
const X128 = 1n << 128n;

interface Snapshot {
  feeGrowth0: string;
  feeGrowth1: string;
  ts: number;
}

function readSnapshot(): Snapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Snapshot;
    if (
      typeof parsed.feeGrowth0 !== "string" ||
      typeof parsed.feeGrowth1 !== "string" ||
      typeof parsed.ts !== "number"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeSnapshot(snap: Snapshot): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snap));
  } catch {
    /* localStorage full / disabled — just don't snapshot */
  }
}

export interface PoolFeeAprResult {
  /** Annualised LP-fee APR as a decimal (0.05 = 5 %). Null while we're
   *  still seeding the snapshot or the pool has no liquidity. */
  apr: number | null;
  /** Width of the window the APR was calculated over, in seconds. Lets
   *  the UI label things like "trailing 12 h" so the user knows how
   *  trustworthy the figure is. */
  windowSec: number | null;
}

export function usePoolFeeApr(pool: PoolLive | null): PoolFeeAprResult {
  const [result, setResult] = useState<PoolFeeAprResult>({
    apr: null,
    windowSec: null,
  });

  useEffect(() => {
    if (!pool || pool.totalLiquidity === 0n) {
      setResult({ apr: null, windowSec: null });
      return;
    }
    const now = Math.floor(Date.now() / 1000);

    let snap = readSnapshot();

    // Rotate stale snapshots so the displayed APR stays "trailing ~24h"
    // instead of "lifetime since the user first opened the page".
    if (snap && now - snap.ts > MAX_WINDOW_SEC) snap = null;

    if (!snap) {
      writeSnapshot({
        feeGrowth0: pool.feeGrowthGlobal0X128.toString(),
        feeGrowth1: pool.feeGrowthGlobal1X128.toString(),
        ts: now,
      });
      setResult({ apr: null, windowSec: null });
      return;
    }

    const windowSec = now - snap.ts;
    if (windowSec < MIN_WINDOW_SEC) {
      setResult({ apr: null, windowSec });
      return;
    }

    const snap0 = BigInt(snap.feeGrowth0);
    const snap1 = BigInt(snap.feeGrowth1);

    // X128 accumulators monotonically increase under normal pool
    // operation. They CAN wrap in theory (uint256 mod 2^256) but the
    // upper bound is so far above any realistic 24-hour fee figure that
    // a wrap inside a one-day window is impossible at any sane TVL.
    // Treat a "negative" delta as "snapshot is in the future" (clock
    // skew / browser sleep) and just reseed.
    if (
      pool.feeGrowthGlobal0X128 < snap0 ||
      pool.feeGrowthGlobal1X128 < snap1
    ) {
      writeSnapshot({
        feeGrowth0: pool.feeGrowthGlobal0X128.toString(),
        feeGrowth1: pool.feeGrowthGlobal1X128.toString(),
        ts: now,
      });
      setResult({ apr: null, windowSec: null });
      return;
    }

    const delta0 = pool.feeGrowthGlobal0X128 - snap0;
    const delta1 = pool.feeGrowthGlobal1X128 - snap1;

    // Δfees_token = Δfee_per_L  ×  current_L,  un-X128'd.
    // Using current liquidity (vs. averaging across the window) means a
    // sudden TVL jump skews the result, but for a single-pool demo with
    // mostly steady L this is fine and avoids storing a TVL snapshot.
    const fees0Raw = (delta0 * pool.totalLiquidity) >> 128n;
    const fees1Raw = (delta1 * pool.totalLiquidity) >> 128n;

    const fee0Tokens = Number(fees0Raw) / 10 ** DEMO_POOL.decimals0;
    const fee1Tokens = Number(fees1Raw) / 10 ** DEMO_POOL.decimals1;

    // USDT0 ≈ $1. xETH valued at the pool's spot rate (USDT0 per xETH).
    // Same shortcut PriceInfo on the swap page uses; oracle pricing is
    // available via the Lens but the marginal accuracy isn't worth a
    // second multicall here.
    const fee0Usd = fee0Tokens;
    const fee1Usd = fee1Tokens * pool.rate0Per1;
    const totalFeeUsd = fee0Usd + fee1Usd;

    const tvlUsd = wadToNum(pool.totalAssetsUsdWad);
    if (tvlUsd <= 0 || totalFeeUsd <= 0) {
      setResult({ apr: 0, windowSec });
      return;
    }

    const apr = (totalFeeUsd * SEC_PER_YEAR) / (windowSec * tvlUsd);
    setResult({ apr, windowSec });
  }, [
    pool?.feeGrowthGlobal0X128,
    pool?.feeGrowthGlobal1X128,
    pool?.totalLiquidity,
    pool?.totalAssetsUsdWad,
    pool?.rate0Per1,
  ]);

  return result;
}

/** Convert PoolFeeAprResult.windowSec into a short, friendly label like
 *  "trailing 47 min" / "trailing 11 h". Used in the APR tooltip / hint
 *  next to the combined APY figure. */
export function fmtFeeAprWindow(windowSec: number | null): string {
  if (windowSec == null || windowSec < MIN_WINDOW_SEC) return "seeding…";
  if (windowSec < 60 * 60) return `trailing ${Math.round(windowSec / 60)} min`;
  if (windowSec < 24 * 60 * 60) return `trailing ${Math.round(windowSec / 3600)} h`;
  return "trailing 24 h";
}
