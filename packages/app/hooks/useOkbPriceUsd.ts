"use client";

import { useQuery } from "@tanstack/react-query";

/**
 * OKB / USD spot, refreshed every 60s.
 *
 * Uses CoinGecko's public price endpoint (no API key) — works on free tier
 * with light rate limits, more than enough for a single-pair display.
 * The result is cached by react-query so the rest of the app can read the
 * same value without re-fetching.
 */
export function useOkbPriceUsd(): { price: number | null; isLoading: boolean } {
  const { data, isLoading } = useQuery({
    queryKey: ["okb-price-usd"],
    queryFn: async () => {
      try {
        const res = await fetch(
          "https://api.coingecko.com/api/v3/simple/price?ids=okb&vs_currencies=usd",
          { cache: "no-store" }
        );
        if (!res.ok) return null;
        const json = (await res.json()) as { okb?: { usd?: number } };
        const usd = json?.okb?.usd;
        return typeof usd === "number" ? usd : null;
      } catch {
        return null;
      }
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  return { price: data ?? null, isLoading };
}
