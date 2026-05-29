"use client";

import { useReadContract } from "wagmi";

import { QUOTER_ABI } from "@/lib/abi/quoter";
import { DEMO_POOL_KEY } from "@/lib/abi/poolKey";
import { CONTRACTS } from "@/lib/contracts";

const QUOTE_REFRESH_MS = 12_000;

export interface QuoteInput {
  /** Side that drives the trade. `false` = currency1 → currency0. */
  zeroForOne: boolean;
  /** Raw input amount (decimals of the input currency). */
  exactAmount: bigint;
  /** Skip the multicall while the user is still typing. */
  enabled: boolean;
}

export interface QuoteResult {
  amountOut: bigint;
  gasEstimate: bigint;
}

/**
 * Live read against V4 Quoter — eth_call against `quoteExactInputSingle`.
 * The quoter is non-view on-chain but catches its own revert, so wagmi's
 * read path resolves cleanly. Polling every 12s keeps the displayed
 * amountOut + gas fresh while the pool state moves.
 */
export function useQuote({ zeroForOne, exactAmount, enabled }: QuoteInput): {
  quote: QuoteResult | null;
  isFetching: boolean;
  isError: boolean;
  /** ms since epoch when react-query last successfully filled this read.
   *  0 while we've never had a result. UI uses this with `refreshMs` to
   *  render a countdown to the next auto-refresh. */
  dataUpdatedAt: number;
  refreshMs: number;
} {
  const { data, isFetching, isError, dataUpdatedAt } = useReadContract({
    address: CONTRACTS.quoter,
    abi: QUOTER_ABI,
    functionName: "quoteExactInputSingle",
    args: [
      {
        poolKey: DEMO_POOL_KEY,
        zeroForOne,
        exactAmount,
        hookData: "0x",
      },
    ],
    query: {
      enabled: enabled && exactAmount > 0n,
      refetchInterval: QUOTE_REFRESH_MS,
    },
  });

  if (!data) return { quote: null, isFetching, isError, dataUpdatedAt, refreshMs: QUOTE_REFRESH_MS };
  const [amountOut, gasEstimate] = data as readonly [bigint, bigint];
  return {
    quote: { amountOut, gasEstimate },
    isFetching,
    isError,
    dataUpdatedAt,
    refreshMs: QUOTE_REFRESH_MS,
  };
}
