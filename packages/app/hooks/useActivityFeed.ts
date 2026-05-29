"use client";

import { useQuery } from "@tanstack/react-query";
import { parseAbiItem } from "viem";
import type { Address } from "viem";
import { useAccount, usePublicClient } from "wagmi";

import { CONTRACTS, DEMO_POOL } from "@/lib/contracts";

/**
 * On-chain Activity feed for the connected user.
 *
 * Reads the hook's Deposited / Withdrawn / Borrowed / Repaid event topics
 * over a rolling block window via `publicClient.getLogs`, joins each event
 * with its block timestamp (one tiny extra read per row), and returns the
 * latest 10 sorted newest-first.
 *
 * X Layer block time ~2-3s ⇒ a 12,000-block lookback ≈ 6-10h of history,
 * which keeps us well below typical free-tier RPC log-range caps.
 *
 * Activity is per-user (filtered on the indexed `user` / `borrower` topic).
 */
export type ActivityType = "Supplied" | "Withdrew" | "Borrowed" | "Repaid";

export interface ActivityEntry {
  type: ActivityType;
  /** Display string for the LEFT column (`<type> · X token + Y token`). */
  amount: string;
  /** Display string for the RIGHT column (~$X.XX, USDT0 mapped 1:1). */
  usd: string;
  market: string;
  txHash: `0x${string}`;
  timestamp: number;
  blockNumber: bigint;
}

// X Layer's public RPCs have two hard limits we respect:
//   • each `eth_getLogs` call accepts at most 100 blocks
//   • per-IP rate-limit on each mirror kicks in fast
//
// We chunk under the per-call cap, delay between chunks, and rely on the
// viem `fallback` + JSON-RPC batching transport in `wagmi.ts` to rotate
// requests across three mirrors. Cache lives an hour (gcTime) and is
// considered fresh for 5 minutes — page navs reuse the cached feed
// instead of re-scanning the whole window every time.
const TOTAL_LOOKBACK_BLOCKS = 30_000n; // ~16h at ~2s blocks
const CHUNK_SIZE_BLOCKS = 100n;
const CHUNK_DELAY_MS = 280;

const DEPOSITED_EVENT = parseAbiItem(
  "event Deposited(bytes32 indexed poolId, address indexed user, uint256 amount0, uint256 amount1, uint256 sharesMinted)"
);
const WITHDRAWN_EVENT = parseAbiItem(
  "event Withdrawn(bytes32 indexed poolId, address indexed user, uint256 sharesBurned, uint256 amount0Out, uint256 amount1Out)"
);
const BORROWED_EVENT = parseAbiItem(
  "event Borrowed(bytes32 indexed poolId, address indexed borrower, uint256 amount)"
);
const REPAID_EVENT = parseAbiItem(
  "event Repaid(bytes32 indexed poolId, address indexed borrower, uint256 amount)"
);

/** Compute a list of [lo, hi] inclusive ranges covering [fromBlock, toBlock]. */
function blockRanges(fromBlock: bigint, toBlock: bigint): Array<[bigint, bigint]> {
  const out: Array<[bigint, bigint]> = [];
  for (let lo = fromBlock; lo <= toBlock; lo += CHUNK_SIZE_BLOCKS) {
    const hi = lo + CHUNK_SIZE_BLOCKS - 1n;
    out.push([lo, hi > toBlock ? toBlock : hi]);
  }
  return out;
}

/**
 * Walk `ranges` serially through `getLogs`, accumulating results. Per-chunk
 * failures (RPC rate-limit, transient errors) drop only that chunk and log
 * a warning — they never blank the whole feed. The four event scans run
 * concurrently via Promise.all over four `collectLogsSerial` calls, so the
 * RPC sees at most four in-flight requests at a time.
 */
async function collectLogsSerial<T>(
  ranges: Array<[bigint, bigint]>,
  getOne: (range: [bigint, bigint]) => Promise<T[]>
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i]!;
    try {
      const chunk = await getOne(range);
      out.push(...chunk);
    } catch (err) {
      if (typeof console !== "undefined") {
        console.warn(`[activity] getLogs ${range[0]}-${range[1]} failed`, err);
      }
    }
    // Tiny breather between chunks to stay under X Layer's per-IP rate limit.
    if (i < ranges.length - 1) {
      await new Promise((r) => setTimeout(r, CHUNK_DELAY_MS));
    }
  }
  return out;
}

const PAIR_LABEL = `${DEMO_POOL.symbol1} / ${DEMO_POOL.symbol0}`;

function fmt(raw: bigint, decimals: number, dp: number): string {
  const scale = 10n ** BigInt(decimals);
  const whole = raw / scale;
  const frac = raw % scale;
  const fracStr = frac.toString().padStart(decimals, "0").slice(0, dp).replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}

function pairText(amount0: bigint, amount1: bigint): string {
  const a0 = fmt(amount0, DEMO_POOL.decimals0, 2);
  const a1 = fmt(amount1, DEMO_POOL.decimals1, 4);
  return `${a0} ${DEMO_POOL.symbol0} + ${a1} ${DEMO_POOL.symbol1}`;
}

function usdtAsUsd(raw: bigint): string {
  // USDT0 ≈ $1; bake the dollar formatting + thousands separator inline.
  const n = Number(raw) / 10 ** DEMO_POOL.decimals0;
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function useActivityFeed(): {
  entries: ActivityEntry[];
  isLoading: boolean;
  isError: boolean;
} {
  const { address } = useAccount();
  const client = usePublicClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["activity", address, client?.chain?.id],
    enabled: Boolean(address && client),
    refetchInterval: 5 * 60_000, // 5 min
    staleTime: 4 * 60_000, // serve from cache for 4 min between refetches
    gcTime: 60 * 60_000, // keep cache alive 1h so page navigation reuses it
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<ActivityEntry[]> => {
      if (!address || !client) return [];
      const head = await client.getBlockNumber();
      const fromBlock = head > TOTAL_LOOKBACK_BLOCKS ? head - TOTAL_LOOKBACK_BLOCKS : 0n;

      // Each event has a different indexed-arg name (`user` for LP-side,
      // `borrower` for debt-side). Four scans run concurrently, each one
      // walks its block-range list serially. Net RPC pressure: at most four
      // in-flight `getLogs` requests, far below X Layer's rate limit.
      const ranges = blockRanges(fromBlock, head);
      const [deposited, withdrawn, borrowed, repaid] = await Promise.all([
        collectLogsSerial(ranges, ([lo, hi]) =>
          client.getLogs({
            address: CONTRACTS.hook as Address,
            event: DEPOSITED_EVENT,
            args: { user: address },
            fromBlock: lo,
            toBlock: hi,
          })
        ),
        collectLogsSerial(ranges, ([lo, hi]) =>
          client.getLogs({
            address: CONTRACTS.hook as Address,
            event: WITHDRAWN_EVENT,
            args: { user: address },
            fromBlock: lo,
            toBlock: hi,
          })
        ),
        collectLogsSerial(ranges, ([lo, hi]) =>
          client.getLogs({
            address: CONTRACTS.hook as Address,
            event: BORROWED_EVENT,
            args: { borrower: address },
            fromBlock: lo,
            toBlock: hi,
          })
        ),
        collectLogsSerial(ranges, ([lo, hi]) =>
          client.getLogs({
            address: CONTRACTS.hook as Address,
            event: REPAID_EVENT,
            args: { borrower: address },
            fromBlock: lo,
            toBlock: hi,
          })
        ),
      ]);

      const rough: Array<Omit<ActivityEntry, "timestamp">> = [];

      for (const log of deposited) {
        const a0 = log.args.amount0 ?? 0n;
        const a1 = log.args.amount1 ?? 0n;
        rough.push({
          type: "Supplied",
          amount: pairText(a0, a1),
          // USD = USDT0 side × 1 (stable) + xETH side priced at the spot we
          // already display elsewhere. For activity we lean honest and only
          // count the USDT0 leg — the LP value depends on per-block oracle
          // prices we don't index.
          usd: usdtAsUsd(a0),
          market: PAIR_LABEL,
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
        });
      }
      for (const log of withdrawn) {
        const a0 = log.args.amount0Out ?? 0n;
        const a1 = log.args.amount1Out ?? 0n;
        rough.push({
          type: "Withdrew",
          amount: pairText(a0, a1),
          usd: usdtAsUsd(a0),
          market: PAIR_LABEL,
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
        });
      }
      for (const log of borrowed) {
        const amount = log.args.amount ?? 0n;
        rough.push({
          type: "Borrowed",
          amount: `${fmt(amount, DEMO_POOL.decimals0, 2)} ${DEMO_POOL.symbol0}`,
          usd: usdtAsUsd(amount),
          market: PAIR_LABEL,
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
        });
      }
      for (const log of repaid) {
        const amount = log.args.amount ?? 0n;
        rough.push({
          type: "Repaid",
          amount: `${fmt(amount, DEMO_POOL.decimals0, 2)} ${DEMO_POOL.symbol0}`,
          usd: usdtAsUsd(amount),
          market: PAIR_LABEL,
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
        });
      }

      rough.sort((a, b) => Number(b.blockNumber - a.blockNumber));
      const top = rough.slice(0, 10);

      // Resolve block timestamps in parallel — each `getBlock` is one tiny
      // call. Deduplicate block numbers so two events in the same block hit
      // the RPC once.
      const uniqueBlocks = Array.from(new Set(top.map((e) => e.blockNumber)));
      const blockMap = new Map<bigint, number>();
      const blocks = await Promise.all(
        uniqueBlocks.map((bn) => client.getBlock({ blockNumber: bn }))
      );
      for (let i = 0; i < uniqueBlocks.length; i++) {
        blockMap.set(uniqueBlocks[i]!, Number(blocks[i]!.timestamp));
      }

      return top.map((e) => ({ ...e, timestamp: blockMap.get(e.blockNumber) ?? 0 }));
    },
  });

  return { entries: data ?? [], isLoading, isError };
}

/**
 * Compact "12s ago" / "4m ago" / "2d ago" relative time formatter.
 * Anything more than a week falls back to a fixed YYYY-MM-DD date.
 */
export function relativeTime(unixSec: number): string {
  if (!unixSec) return "—";
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - unixSec);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(unixSec * 1000).toISOString().slice(0, 10);
}
