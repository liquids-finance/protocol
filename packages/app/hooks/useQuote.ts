"use client";

import { useReadContract } from "wagmi";

import { QUOTER_ABI } from "@/lib/abi/quoter";
import { DEMO_POOL_KEY } from "@/lib/abi/poolKey";
import { CONTRACTS } from "@/lib/contracts";

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
} {
  const { data, isFetching, isError } = useReadContract({
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
      refetchInterval: 12_000,
    },
  });

  if (!data) return { quote: null, isFetching, isError };
  const [amountOut, gasEstimate] = data as readonly [bigint, bigint];
  return { quote: { amountOut, gasEstimate }, isFetching, isError };
}
