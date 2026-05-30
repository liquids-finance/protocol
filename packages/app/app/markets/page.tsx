"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { TokenPair } from "@/components/TokenIcon";
import { useLiveData } from "@/hooks/useLiveData";
import { usePoolFeeApr } from "@/hooks/usePoolFeeApr";
import { fmtCompact, fmtPct, wadToNum } from "@/lib/format";
import { MARKETS } from "@/lib/markets";
import type { Market } from "@/lib/markets";
import { DEMO_POOL } from "@/lib/contracts";

type SortKey = "supply" | "liquidity" | "borrowed" | "supplyApy" | "borrowApy";

interface SortState {
  key: SortKey;
  dir: "asc" | "desc";
}

export default function MarketsPage() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortState>({ key: "supply", dir: "desc" });

  const { pool } = useLiveData();
  const { apr: feeApr } = usePoolFeeApr(pool);

  // Replace the first matching seed row (xETH / USDT0 on X Layer) with live
  // numbers. Falls back to seed values until the multicall resolves so the
  // table is never empty. `supplyApy` is the "Dual APY" the rest of the app
  // talks about — interest paid by borrowers + LP swap-fee APR (when the
  // snapshot window is wide enough to back one out).
  const liveMarket: Market = useMemo(() => {
    const seed = MARKETS.find(
      (m) => m.coll === DEMO_POOL.symbol1 && m.loan === DEMO_POOL.symbol0 && m.chain === "X Layer"
    ) ?? MARKETS[0];

    if (!pool) return { ...seed, isLive: true };

    const supplyUsd = wadToNum(pool.totalAssetsUsdWad);
    const util = wadToNum(pool.utilizationWad);
    const borrowedUsd = supplyUsd * util;
    const lendingPct = wadToNum(pool.lendingApyWad) * 100;
    const feeAprPct = feeApr != null ? feeApr * 100 : 0;
    return {
      ...seed,
      coll: DEMO_POOL.symbol1,
      loan: DEMO_POOL.symbol0,
      chain: "X Layer",
      supply: supplyUsd,
      liquidity: supplyUsd - borrowedUsd,
      util,
      supplyApy: lendingPct + feeAprPct,
      borrowApy: wadToNum(pool.borrowApyWad) * 100,
      badge: "core",
      isLive: true,
    };
  }, [pool, feeApr]);

  const rows = useMemo(() => {
    // Only live markets render — preview rows would be misleading and we
    // currently have exactly one live pool.
    const list = [{ ...liveMarket, borrowed: liveMarket.supply * liveMarket.util }];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (m) =>
        m.coll.toLowerCase().includes(q) ||
        m.loan.toLowerCase().includes(q) ||
        m.chain.toLowerCase().includes(q)
    );
  }, [liveMarket, query]);

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }));
  const sortArrow = (key: SortKey) => (sort.key === key ? (sort.dir === "desc" ? " ↓" : " ↑") : "");

  return (
    <section className="mk-card card">
      <div className="mk-toolbar">
        <div className="mk-search">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
            <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <path d="M11 11 L 14.5 14.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by asset or chain…"
            aria-label="Filter markets"
          />
        </div>
      </div>

      <div className="mk-scroll">
        <div className="mk-table" role="table">
          <div className="mk-row mk-row-h mono" role="row">
            <span>Market</span>
            <button className="mk-sort" onClick={() => toggleSort("supply")}>
              Total supply{sortArrow("supply")}
            </button>
            <button className="mk-sort" onClick={() => toggleSort("liquidity")}>
              Available liquidity{sortArrow("liquidity")}
            </button>
            <button className="mk-sort" onClick={() => toggleSort("borrowed")}>
              Total borrowed{sortArrow("borrowed")}
            </button>
            <button className="mk-sort" onClick={() => toggleSort("supplyApy")}>
              Dual-APY{sortArrow("supplyApy")}
            </button>
            <button className="mk-sort" onClick={() => toggleSort("borrowApy")}>
              Borrow APY{sortArrow("borrowApy")}
            </button>
            <span />
          </div>

          {rows.length === 0 && (
            <div className="empty-state">
              <span className="empty-bullet empty-bullet-mute" />
              <strong>No markets match.</strong>
              <span className="empty-sub">Try a different asset or clear the filter.</span>
            </div>
          )}

          {rows.map((m, i) => (
            <button
              key={`${m.coll}-${m.loan}-${m.chain}-${i}`}
              className="mk-row mk-row-data"
              role="row"
              onClick={() => router.push(`/markets/${m.coll.toLowerCase()}-${m.loan.toLowerCase()}`)}
            >
              <span className="mk-market">
                <TokenPair a={m.coll} b={m.loan} size={28} />
                <span className="mk-market-name">
                  <span className="mk-market-pair">
                    {m.coll} <em>/</em> {m.loan}
                  </span>
                  <span className="mk-tag mk-tag-core">{m.chain}</span>
                </span>
              </span>
              <span className="mono mk-num">{fmtCompact(m.supply)}</span>
              <span className="mono mk-num">{fmtCompact(m.liquidity)}</span>
              <span className="mono mk-num">{fmtCompact(m.borrowed)}</span>
              <span className="mono mk-apy mk-apy-supply">{fmtPct(m.supplyApy)}</span>
              <span className="mono mk-apy mk-apy-borrow">{fmtPct(m.borrowApy)}</span>
              <span className="mk-arrow" aria-hidden>→</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
