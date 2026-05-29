"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";

import { TokenIcon, TokenPair } from "@/components/TokenIcon";
import { useTicker } from "@/components/useTicker";
import { useActivityFeed, relativeTime } from "@/hooks/useActivityFeed";
import type { ActivityEntry, ActivityType } from "@/hooks/useActivityFeed";
import { useDemoMarket } from "@/hooks/useDemoMarket";
import { useUserPosition } from "@/hooks/useUserPosition";
import { fmtNum, fmtPct, fmtUSD, rawToNum, wadToNum } from "@/lib/format";
import { DEMO_POOL, OKLINK_TX } from "@/lib/contracts";

const TYPE_ICONS: Record<ActivityType, { sym: string; kind: string }> = {
  Supplied: { sym: "↓", kind: "primary" },
  Withdrew: { sym: "↑", kind: "neutral" },
  Borrowed: { sym: "→", kind: "accent" },
  Repaid:   { sym: "←", kind: "ok" },
};

const PAIR_LABEL = `${DEMO_POOL.symbol1} / ${DEMO_POOL.symbol0}`;
const MARKET_SLUG = `${DEMO_POOL.symbol1.toLowerCase()}-${DEMO_POOL.symbol0.toLowerCase()}`;
const MAX_LTV = 0.86;

export default function DashboardPage() {
  const { position, isConnected } = useUserPosition();
  const { stats } = useDemoMarket();

  const view = useMemo(() => {
    if (!isConnected) return { state: "disconnected" as const };
    if (!position) return { state: "loading" as const };

    const suppliedUsd = wadToNum(position.suppliedUsdWad);
    const debtUsd = wadToNum(position.debtUsdWad);
    const debtAmount = rawToNum(position.debtRaw, DEMO_POOL.decimals0);
    const netWorth = suppliedUsd - debtUsd;

    if (suppliedUsd === 0 && debtUsd === 0) {
      return { state: "empty" as const };
    }

    const supplyApy = stats ? wadToNum(stats.lendingApyWad) * 100 : 0;
    const borrowApy = stats ? wadToNum(stats.borrowApyWad) * 100 : 0;

    const supEarn = (suppliedUsd * supplyApy) / 100;
    const borCost = (debtUsd * borrowApy) / 100;
    const netApy = netWorth > 0 ? ((supEarn - borCost) / netWorth) * 100 : 0;

    const borrowPower = suppliedUsd * MAX_LTV;
    const used = borrowPower > 0 ? Math.min(1, debtUsd / borrowPower) : 0;
    const hf = position.hfWad != null ? wadToNum(position.hfWad) : Infinity;
    const hfKind = hf >= 1.5 ? "ok" : hf >= 1.1 ? "warn" : "bad";

    return {
      state: "active" as const,
      suppliedUsd,
      debtUsd,
      debtAmount,
      netWorth,
      netApy,
      supplyApy,
      borrowApy,
      hf,
      hfKind,
      used,
    };
  }, [isConnected, position, stats]);

  if (view.state === "disconnected") return <DisconnectedState />;
  if (view.state === "loading") return <LoadingState />;
  if (view.state === "empty") return <EmptyState />;

  return <ActivePositionsView view={view} />;
}

// ════════════════════════════════════════════════════════════════════════
//   Active positions — live data from Lens + share token reads
// ════════════════════════════════════════════════════════════════════════

interface ActiveView {
  state: "active";
  suppliedUsd: number;
  debtUsd: number;
  debtAmount: number;
  netWorth: number;
  netApy: number;
  supplyApy: number;
  borrowApy: number;
  hf: number;
  hfKind: string;
  used: number;
}

function ActivePositionsView({ view }: { view: ActiveView }) {
  const router = useRouter();
  const goManage = () => router.push(`/markets/${MARKET_SLUG}`);

  const nwV = useTicker(view.netWorth);
  const supV = useTicker(view.suppliedUsd);
  const borV = useTicker(view.debtUsd);

  const hasBorrow = view.debtUsd > 0;
  const hasSupply = view.suppliedUsd > 0;
  const hfDisplay = view.hf === Infinity ? "∞" : view.hf.toFixed(2);

  return (
    <>
      <section className="db-stats card">
        <div className="db-stat db-stat-hero">
          <span className="label-eyebrow">Net worth</span>
          <span className="display db-stat-val">{fmtUSD(nwV, 2)}</span>
          <span className="db-stat-delta mk-delta-neutral">{PAIR_LABEL} pool</span>
        </div>
        <div className="db-stat">
          <span className="label-eyebrow">Supplied</span>
          <span className="display db-stat-val">{fmtUSD(supV, 2)}</span>
          <span className="db-stat-delta mk-delta-neutral">{hasSupply ? "1 position" : "0 positions"}</span>
        </div>
        <div className="db-stat">
          <span className="label-eyebrow">Borrowed</span>
          <span className="display db-stat-val">{fmtUSD(borV, 2)}</span>
          <span className="db-stat-delta mk-delta-neutral">{hasBorrow ? "1 position" : "0 positions"}</span>
        </div>
        <div className="db-stat">
          <span className="label-eyebrow">Net APY</span>
          <span className={`display db-stat-val ${view.netApy >= 0 ? "db-apy-pos" : "db-apy-neg"}`}>
            {(view.netApy >= 0 ? "+" : "") + view.netApy.toFixed(2) + "%"}
          </span>
          <span className="db-stat-delta mk-delta-neutral">blended</span>
        </div>
        <div className="db-stat db-stat-hf">
          <span className="label-eyebrow">Health factor</span>
          <span className={`hf-pill hf-${view.hfKind}`}>
            <span className="dot" />
            <span className="hf-pill-val mono">{hfDisplay}</span>
          </span>
          <div className="db-hf-bar">
            <span className="db-hf-fill" style={{ width: Math.min(100, view.used * 100) + "%" }} />
          </div>
        </div>
      </section>

      <div className="db-positions">
        <PositionCard
          title="Supplied"
          eyebrow="Collateral · earning"
          cols={["Asset", "Market", "Balance", "APY", ""]}
          isEmpty={!hasSupply}
          emptyMsg="Supply LP into the demo pool to start earning."
        >
          <div className="db-prow" role="row">
            <span className="db-asset">
              <TokenPair a={DEMO_POOL.symbol1} b={DEMO_POOL.symbol0} size={26} />
              <span className="db-asset-sym">{PAIR_LABEL}</span>
            </span>
            <span className="db-market mono">{PAIR_LABEL}</span>
            <span className="db-bal mono">{fmtUSD(view.suppliedUsd, 2)}</span>
            <span className="mono mk-apy-supply">{fmtPct(view.supplyApy)}</span>
            <span className="db-prow-actions">
              <span className="db-coll-tag">Collateral</span>
              <button className="btn btn-tertiary btn-sm" type="button" onClick={goManage}>
                Manage
              </button>
            </span>
          </div>
        </PositionCard>

        <PositionCard
          title="Borrowed"
          eyebrow="Debt · accruing"
          cols={["Asset", "Market", "Debt", "APY", ""]}
          isEmpty={!hasBorrow}
          emptyMsg="Borrow against your collateral once you've supplied LP."
        >
          <div className="db-prow" role="row">
            <span className="db-asset">
              <TokenIcon sym={DEMO_POOL.symbol0} size={26} />
              <span className="db-asset-sym">{DEMO_POOL.symbol0}</span>
            </span>
            <span className="db-market mono">{PAIR_LABEL}</span>
            <span className="db-bal mono">
              {fmtUSD(view.debtUsd, 2)}
              <em className="mk-sub">
                {fmtNum(view.debtAmount, 2)} {DEMO_POOL.symbol0}
              </em>
            </span>
            <span className="mono mk-apy-borrow">{fmtPct(view.borrowApy)}</span>
            <span className="db-prow-actions">
              <button className="btn btn-tertiary btn-sm" type="button" onClick={goManage}>
                Repay
              </button>
            </span>
          </div>
        </PositionCard>
      </div>

      <ActivityCardLive />
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════
//   Sub-views: shared empty / disconnected / loading
// ════════════════════════════════════════════════════════════════════════

function DisconnectedState() {
  return (
    <section className="card" style={{ padding: "56px 32px", textAlign: "center", maxWidth: 520, margin: "40px auto" }}>
      <h2 className="display" style={{ fontSize: 24, margin: "0 0 8px", letterSpacing: "-0.02em" }}>
        Connect a wallet to continue
      </h2>
      <p style={{ color: "var(--text-mid)", fontSize: 14, margin: "0 0 24px" }}>
        Markets are viewable read-only, but you&apos;ll need a connected wallet to see your dashboard,
        supply LP and borrow.
      </p>
      <div style={{ display: "inline-flex" }}>
        <ConnectButton showBalance={false} />
      </div>
    </section>
  );
}

function LoadingState() {
  return (
    <section className="db-stats card">
      <div className="db-stat">
        <span className="label-eyebrow">Loading positions…</span>
        <span className="display db-stat-val" style={{ color: "var(--text-faint)" }}>—</span>
      </div>
    </section>
  );
}

function EmptyState() {
  return (
    <>
      <section className="db-stats card">
        <div className="db-stat db-stat-hero">
          <span className="label-eyebrow">Net worth</span>
          <span className="display db-stat-val">{fmtUSD(0, 2)}</span>
          <span className="db-stat-delta mk-delta-neutral">No positions yet</span>
        </div>
        <div className="db-stat">
          <span className="label-eyebrow">Supplied</span>
          <span className="display db-stat-val">{fmtUSD(0, 2)}</span>
          <span className="db-stat-delta mk-delta-neutral">0 positions</span>
        </div>
        <div className="db-stat">
          <span className="label-eyebrow">Borrowed</span>
          <span className="display db-stat-val">{fmtUSD(0, 2)}</span>
          <span className="db-stat-delta mk-delta-neutral">0 positions</span>
        </div>
        <div className="db-stat">
          <span className="label-eyebrow">Net APY</span>
          <span className="display db-stat-val" style={{ color: "var(--text-faint)" }}>—</span>
          <span className="db-stat-delta mk-delta-neutral">blended</span>
        </div>
        <div className="db-stat db-stat-hf">
          <span className="label-eyebrow">Health factor</span>
          <span className="display db-stat-val" style={{ color: "var(--text-faint)" }}>—</span>
        </div>
      </section>

      <div className="db-positions">
        <PositionCard
          title="Supplied"
          eyebrow="Collateral · earning"
          cols={["Asset", "Market", "Balance", "APY", ""]}
          isEmpty
          emptyMsg="Supply LP into the demo pool to start earning and unlock borrow power."
        >
          <span />
        </PositionCard>
        <PositionCard
          title="Borrowed"
          eyebrow="Debt · accruing"
          cols={["Asset", "Market", "Debt", "APY", ""]}
          isEmpty
          emptyMsg="Borrow against your collateral once you've supplied LP."
        >
          <span />
        </PositionCard>
      </div>
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════
//   Reusable sub-components
// ════════════════════════════════════════════════════════════════════════

interface PositionCardProps {
  title: string;
  eyebrow: string;
  cols: string[];
  isEmpty: boolean;
  emptyMsg: string;
  children: React.ReactNode;
}

function PositionCard({ title, eyebrow, cols, isEmpty, emptyMsg, children }: PositionCardProps) {
  return (
    <section className="db-card card">
      <header className="db-card-head">
        <span className="label-eyebrow">{eyebrow}</span>
        <h3 className="display">{title}</h3>
      </header>
      {isEmpty ? (
        <div className="empty-state">
          <span className="empty-bullet empty-bullet-mute" />
          <strong>Nothing here yet.</strong>
          <span className="empty-sub">{emptyMsg}</span>
          <Link href="/markets" className="btn btn-ghost btn-sm" style={{ marginTop: 10 }}>
            Browse markets →
          </Link>
        </div>
      ) : (
        <div className="db-ptable">
          <div className="db-prow db-prow-h mono" role="row">
            {cols.map((c, i) => (
              <span key={i}>{c}</span>
            ))}
          </div>
          {children}
        </div>
      )}
    </section>
  );
}

function ActivityCardLive() {
  const { entries, isLoading } = useActivityFeed();
  return (
    <section className="hist-card card" style={{ marginTop: 18 }}>
      <header className="hist-head">
        <h3 className="display">Activity</h3>
      </header>
      {entries.length === 0 ? (
        <div className="empty-state">
          <strong>{isLoading ? "Loading recent activity…" : "No activity yet."}</strong>
          <span className="empty-sub">
            Your supply, borrow and repay transactions appear here as soon as they confirm.
          </span>
        </div>
      ) : (
        <ul className="hist-list">
          {entries.slice(0, 8).map((e) => (
            <ActivityRow key={e.txHash} entry={e} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ActivityRow({ entry }: { entry: ActivityEntry }) {
  const meta = TYPE_ICONS[entry.type];
  return (
    <li className="hist-item">
      <span className={`hist-icon hist-icon-${meta.kind}`}>{meta.sym}</span>
      <span className="hist-meta">
        <span className="hist-type">{entry.type}</span>
        <span className="hist-amt mono">
          {entry.market} ·{" "}
          <a
            href={OKLINK_TX(entry.txHash)}
            target="_blank"
            rel="noreferrer"
            style={{ color: "inherit", textDecoration: "none" }}
            title={entry.txHash}
          >
            {relativeTime(entry.timestamp)} ↗
          </a>
        </span>
      </span>
      <span className="hist-right">
        <span className="hist-amount mono">{entry.amount}</span>
        <span className="hist-usd mono">{entry.usd}</span>
      </span>
    </li>
  );
}
