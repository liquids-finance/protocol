"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { maxUint256 } from "viem";
import { useChainId, usePublicClient, useSignTypedData, useWriteContract } from "wagmi";

import { extractErrorMessage, useTxFlow } from "@/components/TxFlow";
import { TokenIcon, TokenPair } from "@/components/TokenIcon";
import { useDemoMarket } from "@/hooks/useDemoMarket";
import { usePoolState } from "@/hooks/usePoolState";
import type { PoolState } from "@/hooks/usePoolState";
import { useUserBalances } from "@/hooks/useUserBalances";
import { useUserPosition } from "@/hooks/useUserPosition";
import { ERC20_ABI } from "@/lib/abi/erc20";
import { HOOK_ABI } from "@/lib/abi/hook";
import { DEMO_POOL_KEY } from "@/lib/abi/poolKey";
import { CONTRACTS, DEMO_POOL, OKLINK_ADDRESS } from "@/lib/contracts";
import { fmtCompact, fmtNum, fmtPct, fmtUSD, rawToNum, shortAddr, wadToNum } from "@/lib/format";
import { parseAmount } from "@/lib/parse";
import {
  DEFAULT_SIG_DEADLINE_SECONDS,
  PERMIT_BATCH_TRANSFER_FROM_TYPES,
  PERMIT_TRANSFER_FROM_TYPES,
  permit2Domain,
  randomPermit2Nonce,
} from "@/lib/permit2/sign";
import type {
  PermitBatchTransferFromMessage,
  PermitTransferFromMessage,
} from "@/lib/permit2/sign";

const DEMO_SLUG = `${DEMO_POOL.symbol1.toLowerCase()}-${DEMO_POOL.symbol0.toLowerCase()}`;
const MAX_LTV_PCT = 86;

// 18 decimals — the share token follows the standard ERC20 convention.
const SHARE_DECIMALS = 18;

export default function MarketDetailPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();

  if (params.slug !== DEMO_SLUG) {
    return <NotFound onBack={() => router.push("/markets")} />;
  }

  return <DemoMarketDetail />;
}

// ════════════════════════════════════════════════════════════════════════
//   Demo market — xETH / USDT0 on X Layer
// ════════════════════════════════════════════════════════════════════════

function DemoMarketDetail() {
  const { stats } = useDemoMarket();
  const { position, isConnected } = useUserPosition();
  const { balances, refetch: refetchBalances } = useUserBalances();

  const supplyUsd = stats ? wadToNum(stats.totalAssetsWad) : 0;
  const util = stats ? wadToNum(stats.utilizationWad) : 0;
  const borrowedUsd = supplyUsd * util;
  const availableUsd = supplyUsd - borrowedUsd;
  const supplyApy = stats ? wadToNum(stats.lendingApyWad) * 100 : 0;
  const borrowApy = stats ? wadToNum(stats.borrowApyWad) * 100 : 0;

  const userSupplied = position ? wadToNum(position.suppliedUsdWad) : 0;
  const userDebt = position ? wadToNum(position.debtUsdWad) : 0;
  const userDebtRaw = position ? rawToNum(position.debtRaw, DEMO_POOL.decimals0) : 0;
  const hf = position?.hfWad != null ? wadToNum(position.hfWad) : null;
  const hfKind = hf == null ? "ok" : hf >= 1.5 ? "ok" : hf >= 1.1 ? "warn" : "bad";

  return (
    <>
      <Link href="/markets" className="md-back">
        ← Markets
      </Link>

      <div className="md-hero">
        <TokenPair a={DEMO_POOL.symbol1} b={DEMO_POOL.symbol0} size={48} />
        <h1>
          {DEMO_POOL.symbol1} <em>/</em> {DEMO_POOL.symbol0}
        </h1>
        <div className="md-hero-tags">
          <span className="badge">X Layer · {DEMO_POOL.fee / 10_000}% fee</span>
        </div>
      </div>

      <section className="db-stats card">
        <div className="db-stat">
          <span className="label-eyebrow">Total supply</span>
          <span className="display db-stat-val">{fmtCompact(supplyUsd)}</span>
          <span className="db-stat-delta mk-delta-neutral">USD value</span>
        </div>
        <div className="db-stat">
          <span className="label-eyebrow">Available</span>
          <span className="display db-stat-val">{fmtCompact(availableUsd)}</span>
          <span className="db-stat-delta mk-delta-neutral">borrowable</span>
        </div>
        <div className="db-stat">
          <span className="label-eyebrow">Total borrowed</span>
          <span className="display db-stat-val">{fmtCompact(borrowedUsd)}</span>
          <span className="db-stat-delta mk-delta-neutral">{(util * 100).toFixed(1)}% util</span>
        </div>
        <div className="db-stat">
          <span className="label-eyebrow">Dual APY</span>
          <span className="display db-stat-val db-apy-pos">{fmtPct(supplyApy)}</span>
          <span className="db-stat-delta mk-delta-neutral">LP fees + lending</span>
        </div>
        <div className="db-stat">
          <span className="label-eyebrow">Borrow APY</span>
          <span className="display db-stat-val">{fmtPct(borrowApy)}</span>
          <span className="db-stat-delta mk-delta-neutral">kink rate</span>
        </div>
      </section>

      <div className="md-grid">
        {/* LEFT: your position + market info */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <section className="md-card card">
            <header className="md-card-head">
              <span className="label-eyebrow">Your position</span>
              <h3 className="display">In this market</h3>
            </header>
            <div className="md-card-body">
              {!isConnected ? (
                <p style={{ color: "var(--text-mid)", margin: 0 }}>
                  Connect a wallet to view your supplied LP and any outstanding debt here.
                </p>
              ) : (
                <>
                  <div className="md-kv">
                    <span>Supplied (LP)</span>
                    <span className="mono">{fmtUSD(userSupplied, 2)}</span>
                  </div>
                  <div className="md-kv">
                    <span>Debt</span>
                    <span className="mono">
                      {fmtUSD(userDebt, 2)}
                      {userDebt > 0 && (
                        <em style={{ color: "var(--text-dim)", fontStyle: "normal", marginLeft: 6 }}>
                          ({fmtNum(userDebtRaw, 2)} {DEMO_POOL.symbol0})
                        </em>
                      )}
                    </span>
                  </div>
                  <div className="md-kv">
                    <span>Health factor</span>
                    <span>
                      <span className={`hf-pill hf-pill-sm hf-${hfKind}`}>
                        <span className="dot" />
                        <span className="hf-pill-val mono">
                          {hf == null ? "∞" : hf.toFixed(2)}
                        </span>
                      </span>
                    </span>
                  </div>
                </>
              )}
            </div>
          </section>

          <section className="md-card card">
            <header className="md-card-head">
              <span className="label-eyebrow">Market parameters</span>
              <h3 className="display">Risk + contracts</h3>
            </header>
            <div className="md-card-body">
              <div className="md-kv"><span>Max LTV</span><span className="mono">{MAX_LTV_PCT}%</span></div>
              <div className="md-kv"><span>Borrow asset</span><span className="mono">{DEMO_POOL.symbol0}</span></div>
              <div className="md-kv"><span>Pool fee</span><span className="mono">{(DEMO_POOL.fee / 10_000).toFixed(2)}%</span></div>
              <div className="md-kv"><span>Tick spacing</span><span className="mono">{DEMO_POOL.tickSpacing}</span></div>
              <div className="md-kv">
                <span>Hook</span>
                <span className="mono">
                  <a href={OKLINK_ADDRESS(CONTRACTS.hook)} target="_blank" rel="noreferrer">
                    {shortAddr(CONTRACTS.hook)} ↗
                  </a>
                </span>
              </div>
              <div className="md-kv">
                <span>Lens</span>
                <span className="mono">
                  <a href={OKLINK_ADDRESS(CONTRACTS.lens)} target="_blank" rel="noreferrer">
                    {shortAddr(CONTRACTS.lens)} ↗
                  </a>
                </span>
              </div>
              <div className="md-kv">
                <span>Share token</span>
                <span className="mono">
                  <a href={OKLINK_ADDRESS(DEMO_POOL.shareToken)} target="_blank" rel="noreferrer">
                    {shortAddr(DEMO_POOL.shareToken)} ↗
                  </a>
                </span>
              </div>
              <div className="md-kv"><span>Pool ID</span><span className="mono">{shortAddr(DEMO_POOL.poolId, 10, 8)}</span></div>
            </div>
          </section>
        </div>

        {/* RIGHT: action panels */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <CollateralPanel
            balances={balances}
            refetchBalances={refetchBalances}
            isConnected={isConnected}
            suppliedUsd={userSupplied}
            debtUsd={userDebt}
          />
          <DebtPanel
            balances={balances}
            refetchBalances={refetchBalances}
            isConnected={isConnected}
            debtRaw={position?.debtRaw ?? 0n}
            suppliedUsd={userSupplied}
            debtUsd={userDebt}
          />
        </div>
      </div>
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════
//   Collateral side — Supply / Withdraw
// ════════════════════════════════════════════════════════════════════════

interface CollateralPanelProps {
  balances: ReturnType<typeof useUserBalances>["balances"];
  refetchBalances: () => void;
  isConnected: boolean;
  suppliedUsd: number;
  debtUsd: number;
}

function CollateralPanel(props: CollateralPanelProps) {
  const [tab, setTab] = useState<"supply" | "withdraw">("supply");
  return (
    <section className="md-card card">
      <div className="md-card-body">
        <div className="md-tabs">
          <button type="button" className={`md-tab${tab === "supply" ? " is-active" : ""}`} onClick={() => setTab("supply")}>
            Supply
          </button>
          <button type="button" className={`md-tab${tab === "withdraw" ? " is-active" : ""}`} onClick={() => setTab("withdraw")}>
            Withdraw
          </button>
        </div>
        {tab === "supply" ? <SupplyForm {...props} /> : <WithdrawForm {...props} />}
      </div>
    </section>
  );
}

function SupplyForm({ balances, refetchBalances, isConnected }: CollateralPanelProps) {
  // Linked inputs — both stay editable, typing in either recomputes the
  // sibling from the pool's spot ratio.
  const [amount0, setAmount0] = useState("");
  const [amount1, setAmount1] = useState("");
  const { state: pool } = usePoolState();

  const handleChange0 = (v: string) => {
    setAmount0(v);
    if (!pool || !pool.rate1Per0) return setAmount1("");
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return setAmount1("");
    setAmount1((n * pool.rate1Per0).toFixed(Math.min(8, DEMO_POOL.decimals1)));
  };
  const handleChange1 = (v: string) => {
    setAmount1(v);
    if (!pool || !pool.rate0Per1) return setAmount0("");
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return setAmount0("");
    setAmount0((n * pool.rate0Per1).toFixed(Math.min(6, DEMO_POOL.decimals0)));
  };

  const parsed0 = parseAmount(amount0, DEMO_POOL.decimals0);
  const parsed1 = parseAmount(amount1, DEMO_POOL.decimals1);
  const haveAmounts = parsed0 != null && parsed0 > 0n && parsed1 != null && parsed1 > 0n;
  const insufBal0 = balances && parsed0 != null && parsed0 > balances.usdt0Balance;
  const insufBal1 = balances && parsed1 != null && parsed1 > balances.xethBalance;

  const flow = useTxFlow();
  const chainId = useChainId();
  const client = usePublicClient();
  const { signTypedDataAsync } = useSignTypedData();
  const { writeContractAsync } = useWriteContract();
  const [busy, setBusy] = useState(false);

  const submitSupply = async () => {
    if (!balances || !client || !haveAmounts) return;
    const needs0 = parsed0! > balances.usdt0PermitAllowance;
    const needs1 = parsed1! > balances.xethPermitAllowance;

    const steps = [
      ...(needs0 ? [{ key: "ap0", label: `Approve ${DEMO_POOL.symbol0} for Permit2` }] : []),
      ...(needs1 ? [{ key: "ap1", label: `Approve ${DEMO_POOL.symbol1} for Permit2` }] : []),
      { key: "sig", label: "Sign Permit2 batch (USDT0 + xETH)" },
      { key: "tx", label: "Supply to pool" },
    ];

    flow.start("Supply", steps);
    setBusy(true);
    try {
      if (needs0) {
        flow.setStep("ap0", { status: "pending" });
        const hash = await writeContractAsync({
          address: DEMO_POOL.currency0,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [CONTRACTS.permit2, maxUint256],
        });
        flow.setStep("ap0", { txHash: hash });
        await client.waitForTransactionReceipt({ hash });
        flow.setStep("ap0", { status: "done" });
      }
      if (needs1) {
        flow.setStep("ap1", { status: "pending" });
        const hash = await writeContractAsync({
          address: DEMO_POOL.currency1,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [CONTRACTS.permit2, maxUint256],
        });
        flow.setStep("ap1", { txHash: hash });
        await client.waitForTransactionReceipt({ hash });
        flow.setStep("ap1", { status: "done" });
      }

      flow.setStep("sig", { status: "pending" });
      const nonce = randomPermit2Nonce();
      const deadline = BigInt(Math.floor(Date.now() / 1000) + DEFAULT_SIG_DEADLINE_SECONDS);
      const message: PermitBatchTransferFromMessage = {
        permitted: [
          { token: DEMO_POOL.currency0, amount: parsed0! },
          { token: DEMO_POOL.currency1, amount: parsed1! },
        ],
        spender: CONTRACTS.hook,
        nonce,
        deadline,
      };
      const sig = await signTypedDataAsync({
        domain: permit2Domain(chainId),
        types: PERMIT_BATCH_TRANSFER_FROM_TYPES,
        primaryType: "PermitBatchTransferFrom",
        message,
      });
      flow.setStep("sig", { status: "done" });

      flow.setStep("tx", { status: "pending" });
      const hash = await writeContractAsync({
        address: CONTRACTS.hook,
        abi: HOOK_ABI,
        functionName: "supplyWithPermit2",
        args: [DEMO_POOL_KEY, parsed0!, parsed1!, 0n, message, sig],
      });
      flow.setStep("tx", { txHash: hash });
      await client.waitForTransactionReceipt({ hash });
      flow.setStep("tx", { status: "done" });
      flow.done();

      refetchBalances();
      setAmount0("");
      setAmount1("");
    } catch (e) {
      flow.fail(extractErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const ctaLabel = !isConnected
    ? "Connect wallet"
    : !haveAmounts
    ? "Enter an amount"
    : insufBal0
    ? `Insufficient ${DEMO_POOL.symbol0} balance`
    : insufBal1
    ? `Insufficient ${DEMO_POOL.symbol1} balance`
    : busy
    ? "Working…"
    : "Supply";

  return (
    <>
      <AmountInput
        label={`${DEMO_POOL.symbol0} balance`}
        sym={DEMO_POOL.symbol0}
        decimals={DEMO_POOL.decimals0}
        value={amount0}
        onChange={handleChange0}
        balanceRaw={balances?.usdt0Balance}
      />
      <div style={{ height: 8 }} />
      <AmountInput
        label={`${DEMO_POOL.symbol1} balance`}
        sym={DEMO_POOL.symbol1}
        decimals={DEMO_POOL.decimals1}
        value={amount1}
        onChange={handleChange1}
        balanceRaw={balances?.xethBalance}
      />
      <button
        type="button"
        className="btn btn-primary md-cta"
        style={{ marginTop: 14 }}
        onClick={submitSupply}
        disabled={!isConnected || !haveAmounts || !!insufBal0 || !!insufBal1 || busy}
      >
        {ctaLabel}
      </button>
    </>
  );
}

function WithdrawForm({ balances, refetchBalances, isConnected, suppliedUsd, debtUsd }: CollateralPanelProps) {
  // Two amount-side inputs linked through the pool ratio. Each side's Max
  // button is sized to the user's share of the vault's per-token total.
  const [amount0, setAmount0] = useState("");
  const [amount1, setAmount1] = useState("");
  const { state: pool } = usePoolState();

  const handleChange0 = (v: string) => {
    setAmount0(v);
    if (!pool || !pool.rate1Per0) return setAmount1("");
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return setAmount1("");
    setAmount1((n * pool.rate1Per0).toFixed(Math.min(8, DEMO_POOL.decimals1)));
  };
  const handleChange1 = (v: string) => {
    setAmount1(v);
    if (!pool || !pool.rate0Per1) return setAmount0("");
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return setAmount0("");
    setAmount0((n * pool.rate0Per1).toFixed(Math.min(6, DEMO_POOL.decimals0)));
  };

  // Withdraw max per side = userShareBalance × vaultAmount / totalShares.
  // This is the most the user could redeem if they burned every share they own.
  const { userMax0Raw, userMax1Raw } = useMemo(() => {
    if (!pool || !balances || pool.totalShares === 0n) {
      return { userMax0Raw: undefined, userMax1Raw: undefined };
    }
    return {
      userMax0Raw: (balances.shareBalance * pool.vaultAmount0Raw) / pool.totalShares,
      userMax1Raw: (balances.shareBalance * pool.vaultAmount1Raw) / pool.totalShares,
    };
  }, [pool, balances]);

  const parsed0 = parseAmount(amount0, DEMO_POOL.decimals0);
  const sharesToBurn = useMemo(() => {
    if (!pool || !parsed0 || pool.vaultAmount0Raw === 0n) return 0n;
    return (parsed0 * pool.totalShares) / pool.vaultAmount0Raw;
  }, [pool, parsed0]);

  const insufficient = balances && sharesToBurn > 0n && sharesToBurn > balances.shareBalance;
  const hasInput = parsed0 != null && parsed0 > 0n;
  const sharesDisplay = sharesToBurn > 0n ? rawToNum(sharesToBurn, SHARE_DECIMALS) : 0;

  // HF after — withdrawing reduces collateral. New HF = (collateral - withdrawnUSD) / debt.
  // USDT0 ≈ $1, xETH valued at pool spot.
  const withdrawnUsd = useMemo(() => {
    const v0 = Number(amount0) || 0;
    const v1 = Number(amount1) || 0;
    const usdt0PerXeth = pool?.rate0Per1 ?? 0;
    return v0 + v1 * usdt0PerXeth;
  }, [amount0, amount1, pool]);
  const newCollateral = Math.max(0, suppliedUsd - withdrawnUsd);
  const projectedHf = debtUsd > 0 ? newCollateral / debtUsd : Infinity;
  const projectedHfKind = projectedHf >= 1.5 ? "ok" : projectedHf >= 1.1 ? "warn" : "bad";

  const flow = useTxFlow();
  const client = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (sharesToBurn === 0n || !client) return;
    flow.start("Withdraw", [{ key: "tx", label: "Burn LP shares + receive tokens" }]);
    setBusy(true);
    try {
      flow.setStep("tx", { status: "pending" });
      const hash = await writeContractAsync({
        address: CONTRACTS.hook,
        abi: HOOK_ABI,
        functionName: "withdraw",
        args: [DEMO_POOL_KEY, sharesToBurn, 0n, 0n],
      });
      flow.setStep("tx", { txHash: hash });
      await client.waitForTransactionReceipt({ hash });
      flow.setStep("tx", { status: "done" });
      flow.done();
      refetchBalances();
      setAmount0("");
      setAmount1("");
    } catch (e) {
      flow.fail(extractErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  // Hook reverts `DebtOutstanding` on any withdraw while caller has scaled
  // debt > 0, so we short-circuit the form with a clear explanation rather
  // than letting the user discover this via a tx revert.
  if (debtUsd > 0) {
    return (
      <div className="empty-state" style={{ padding: "20px 0" }}>
        <span className="empty-bullet empty-bullet-mute" />
        <strong>Repay your debt first.</strong>
        <span className="empty-sub">
          The hook locks LP shares while you hold an open borrow. Repay your{" "}
          {fmtUSD(debtUsd, 2)} debt and then come back here to withdraw.
        </span>
      </div>
    );
  }

  return (
    <>
      <AmountInput
        label={`${DEMO_POOL.symbol0} out · Max`}
        sym={DEMO_POOL.symbol0}
        decimals={DEMO_POOL.decimals0}
        value={amount0}
        onChange={handleChange0}
        balanceRaw={userMax0Raw}
      />
      <div style={{ height: 8 }} />
      <AmountInput
        label={`${DEMO_POOL.symbol1} out · Max`}
        sym={DEMO_POOL.symbol1}
        decimals={DEMO_POOL.decimals1}
        value={amount1}
        onChange={handleChange1}
        balanceRaw={userMax1Raw}
      />

      {sharesToBurn > 0n && (
        <div className="md-meta-row" style={{ marginTop: 10 }}>
          <span>LP shares burned</span>
          <span className="mono">{fmtNum(sharesDisplay, 6)}</span>
        </div>
      )}
      {hasInput && debtUsd > 0 && (
        <div className="md-meta-row" style={{ marginTop: 6 }}>
          <span>Health factor after</span>
          <span className={`hf-pill hf-pill-sm hf-${projectedHfKind}`}>
            <span className="dot" />
            <span className="hf-pill-val mono">
              {projectedHf === Infinity ? "∞" : projectedHf.toFixed(2)}
            </span>
          </span>
        </div>
      )}

      <button
        type="button"
        className="btn btn-primary md-cta"
        style={{ marginTop: 14 }}
        onClick={submit}
        disabled={!isConnected || !hasInput || sharesToBurn === 0n || !!insufficient || busy}
      >
        {!isConnected
          ? "Connect wallet"
          : insufficient
          ? "Not enough LP shares"
          : busy
          ? "Working…"
          : "Withdraw"}
      </button>
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════
//   Debt side — Borrow / Repay
// ════════════════════════════════════════════════════════════════════════

interface DebtPanelProps extends CollateralPanelProps {
  debtRaw: bigint;
  suppliedUsd: number;
  debtUsd: number;
}

function DebtPanel({ balances, refetchBalances, isConnected, debtRaw, suppliedUsd, debtUsd }: DebtPanelProps) {
  const [tab, setTab] = useState<"borrow" | "repay">("borrow");
  return (
    <section className="md-card card">
      <div className="md-card-body">
        <div className="md-tabs">
          <button type="button" className={`md-tab${tab === "borrow" ? " is-active" : ""}`} onClick={() => setTab("borrow")}>
            Borrow
          </button>
          <button type="button" className={`md-tab${tab === "repay" ? " is-active" : ""}`} onClick={() => setTab("repay")}>
            Repay
          </button>
        </div>
        {tab === "borrow" ? (
          <BorrowForm
            refetchBalances={refetchBalances}
            isConnected={isConnected}
            suppliedUsd={suppliedUsd}
            debtUsd={debtUsd}
          />
        ) : (
          <RepayForm
            balances={balances}
            refetchBalances={refetchBalances}
            isConnected={isConnected}
            debtRaw={debtRaw}
            suppliedUsd={suppliedUsd}
            debtUsd={debtUsd}
          />
        )}
      </div>
    </section>
  );
}

function BorrowForm({
  refetchBalances,
  isConnected,
  suppliedUsd,
  debtUsd,
}: {
  refetchBalances: () => void;
  isConnected: boolean;
  suppliedUsd: number;
  debtUsd: number;
}) {
  const [amount, setAmount] = useState("");
  const parsed = parseAmount(amount, DEMO_POOL.decimals0);

  // USDT0 ≈ $1 — the Lens does exact oracle pricing on-chain; the UI estimate
  // is fine for sizing. Hard cap at $0 so a depleted position doesn't render
  // a negative max.
  const maxBorrowUsd = Math.max(0, suppliedUsd * (MAX_LTV_PCT / 100) - debtUsd);
  const amountUsd = parsed != null ? Number(parsed) / 10 ** DEMO_POOL.decimals0 : 0;
  const projectedDebtUsd = debtUsd + amountUsd;
  const projectedHf = projectedDebtUsd > 0 ? suppliedUsd / projectedDebtUsd : Infinity;
  const projectedHfKind = projectedHf >= 1.5 ? "ok" : projectedHf >= 1.1 ? "warn" : "bad";
  const overCap = amountUsd > maxBorrowUsd + 0.005; // 0.5¢ tolerance for rounding

  const handleMax = () => {
    if (maxBorrowUsd <= 0) return;
    // Round down to 2 decimals so we leave a thin headroom margin against
    // rounding inside the hook's projected accrual.
    const rounded = Math.floor(maxBorrowUsd * 100) / 100;
    setAmount(rounded.toString());
  };

  const flow = useTxFlow();
  const client = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (parsed == null || parsed === 0n || !client) return;
    flow.start("Borrow", [{ key: "tx", label: `Borrow ${DEMO_POOL.symbol0}` }]);
    setBusy(true);
    try {
      flow.setStep("tx", { status: "pending" });
      const hash = await writeContractAsync({
        address: CONTRACTS.hook,
        abi: HOOK_ABI,
        functionName: "borrow",
        args: [DEMO_POOL_KEY, parsed, 0n],
      });
      flow.setStep("tx", { txHash: hash });
      await client.waitForTransactionReceipt({ hash });
      flow.setStep("tx", { status: "done" });
      flow.done();
      refetchBalances();
      setAmount("");
    } catch (e) {
      flow.fail(extractErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const disabled =
    !isConnected || parsed == null || parsed === 0n || overCap || busy || suppliedUsd <= 0;
  const label = !isConnected
    ? "Connect wallet"
    : suppliedUsd <= 0
    ? "Supply collateral first"
    : overCap
    ? "Exceeds borrow capacity"
    : busy
    ? "Working…"
    : `Borrow ${DEMO_POOL.symbol0}`;

  return (
    <>
      <div className="md-input">
        <input
          type="text"
          inputMode="decimal"
          placeholder="0.0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <span className="md-input-sym">
          <TokenIcon sym={DEMO_POOL.symbol0} size={18} style={{ marginRight: 6, verticalAlign: "middle" }} />
          {DEMO_POOL.symbol0}
        </span>
      </div>

      <div className="md-meta-row">
        <span>Available to borrow</span>
        <span className="mono" style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
          <span>{fmtUSD(maxBorrowUsd, 2)}</span>
          {maxBorrowUsd > 0 && (
            <button
              type="button"
              onClick={handleMax}
              style={{
                background: "transparent", border: "0", font: "inherit",
                color: "var(--primary)", cursor: "pointer", padding: 0,
                fontSize: 11, letterSpacing: ".04em", textTransform: "uppercase",
              }}
            >
              Max
            </button>
          )}
        </span>
      </div>

      {amountUsd > 0 && (
        <div className="md-meta-row" style={{ marginTop: 6 }}>
          <span>Health factor after</span>
          <span className={`hf-pill hf-pill-sm hf-${projectedHfKind}`}>
            <span className="dot" />
            <span className="hf-pill-val mono">
              {projectedHf === Infinity ? "∞" : projectedHf.toFixed(2)}
            </span>
          </span>
        </div>
      )}

      <button
        type="button"
        className="btn btn-primary md-cta"
        style={{ marginTop: 16 }}
        onClick={submit}
        disabled={disabled}
      >
        {label}
      </button>
    </>
  );
}

function RepayForm({
  balances,
  refetchBalances,
  isConnected,
  debtRaw,
  suppliedUsd,
  debtUsd,
}: {
  balances: ReturnType<typeof useUserBalances>["balances"];
  refetchBalances: () => void;
  isConnected: boolean;
  debtRaw: bigint;
  suppliedUsd: number;
  debtUsd: number;
}) {
  const [amount, setAmount] = useState("");
  const parsed = parseAmount(amount, DEMO_POOL.decimals0);
  const noDebt = debtRaw === 0n;
  const insufficientBal = balances && parsed != null && parsed > balances.usdt0Balance;
  const overDebt = parsed != null && parsed > debtRaw;

  const flow = useTxFlow();
  const chainId = useChainId();
  const client = usePublicClient();
  const { signTypedDataAsync } = useSignTypedData();
  const { writeContractAsync } = useWriteContract();
  const [busy, setBusy] = useState(false);

  // Max = lesser of (wallet balance, outstanding debt) — repaying more than
  // owed is wasteful and the hook would refund anyway; staying ≤ debt keeps
  // the tx tight.
  const maxRepayRaw = balances
    ? balances.usdt0Balance < debtRaw
      ? balances.usdt0Balance
      : debtRaw
    : 0n;

  // HF after — repayment reduces debt 1:1 in USD (USDT0 stable).
  const amountUsd = parsed != null ? Number(parsed) / 10 ** DEMO_POOL.decimals0 : 0;
  const newDebtUsd = Math.max(0, debtUsd - amountUsd);
  const projectedHf = newDebtUsd > 0 ? suppliedUsd / newDebtUsd : Infinity;
  const projectedHfKind = projectedHf >= 1.5 ? "ok" : projectedHf >= 1.1 ? "warn" : "bad";

  const runRepay = async (rawAmount: bigint) => {
    if (!balances || !client) return;
    const needsApprove = rawAmount > balances.usdt0PermitAllowance;
    const steps = [
      ...(needsApprove ? [{ key: "ap", label: `Approve ${DEMO_POOL.symbol0} for Permit2` }] : []),
      { key: "sig", label: `Sign Permit2 (${DEMO_POOL.symbol0})` },
      { key: "tx", label: "Repay debt" },
    ];

    flow.start("Repay", steps);
    setBusy(true);
    try {
      if (needsApprove) {
        flow.setStep("ap", { status: "pending" });
        const hash = await writeContractAsync({
          address: DEMO_POOL.currency0,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [CONTRACTS.permit2, maxUint256],
        });
        flow.setStep("ap", { txHash: hash });
        await client.waitForTransactionReceipt({ hash });
        flow.setStep("ap", { status: "done" });
      }

      flow.setStep("sig", { status: "pending" });
      const nonce = randomPermit2Nonce();
      const deadline = BigInt(Math.floor(Date.now() / 1000) + DEFAULT_SIG_DEADLINE_SECONDS);
      const message: PermitTransferFromMessage = {
        permitted: { token: DEMO_POOL.currency0, amount: rawAmount },
        spender: CONTRACTS.hook,
        nonce,
        deadline,
      };
      const sig = await signTypedDataAsync({
        domain: permit2Domain(chainId),
        types: PERMIT_TRANSFER_FROM_TYPES,
        primaryType: "PermitTransferFrom",
        message,
      });
      flow.setStep("sig", { status: "done" });

      flow.setStep("tx", { status: "pending" });
      const hash = await writeContractAsync({
        address: CONTRACTS.hook,
        abi: HOOK_ABI,
        functionName: "repayWithPermit2",
        args: [DEMO_POOL_KEY, rawAmount, message, sig],
      });
      flow.setStep("tx", { txHash: hash });
      await client.waitForTransactionReceipt({ hash });
      flow.setStep("tx", { status: "done" });
      flow.done();
      refetchBalances();
      setAmount("");
    } catch (e) {
      flow.fail(extractErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const submit = () => {
    if (parsed == null || parsed === 0n) return;
    runRepay(parsed);
  };
  // Full close-out: sign for the full debt amount. Permit2 caps the pull at
  // the permitted figure; the hook's close-out detection forgives sub-wei dust.
  const repayAll = () => {
    if (debtRaw === 0n) return;
    runRepay(debtRaw);
  };

  const debtNum = debtRaw > 0n ? rawToNum(debtRaw, DEMO_POOL.decimals0) : 0;
  const labelRow = noDebt
    ? "No outstanding debt"
    : `Debt: ${fmtNum(debtNum, 2)} ${DEMO_POOL.symbol0}`;

  if (noDebt) {
    return (
      <div className="empty-state" style={{ padding: "20px 0" }}>
        <span className="empty-bullet empty-bullet-mute" />
        <strong>Nothing to repay.</strong>
        <span className="empty-sub">Borrow against your collateral first, then come back here to repay.</span>
      </div>
    );
  }

  return (
    <>
      <AmountInput
        label={labelRow}
        sym={DEMO_POOL.symbol0}
        decimals={DEMO_POOL.decimals0}
        value={amount}
        onChange={setAmount}
        balanceRaw={maxRepayRaw}
      />

      {parsed != null && parsed > 0n && (
        <div className="md-meta-row" style={{ marginTop: 6 }}>
          <span>Health factor after</span>
          <span className={`hf-pill hf-pill-sm hf-${projectedHfKind}`}>
            <span className="dot" />
            <span className="hf-pill-val mono">
              {projectedHf === Infinity ? "∞" : projectedHf.toFixed(2)}
            </span>
          </span>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
        <button
          type="button"
          className="btn btn-primary md-cta"
          onClick={submit}
          disabled={
            !isConnected ||
            parsed == null ||
            parsed === 0n ||
            !!insufficientBal ||
            !!overDebt ||
            busy
          }
        >
          {!isConnected
            ? "Connect wallet"
            : insufficientBal
            ? `Insufficient ${DEMO_POOL.symbol0} balance`
            : overDebt
            ? "Exceeds outstanding debt"
            : busy
            ? "Working…"
            : "Repay"}
        </button>
        <button
          type="button"
          className="btn btn-tertiary md-cta btn-sm"
          onClick={repayAll}
          disabled={!isConnected || busy}
          title="Sign for the full outstanding debt amount"
        >
          Repay full debt
        </button>
      </div>
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════
//   Shared input row
// ════════════════════════════════════════════════════════════════════════

function AmountInput({
  label,
  sym,
  decimals,
  value,
  onChange,
  balanceRaw,
}: {
  label: string;
  sym: string;
  decimals: number;
  value: string;
  onChange: (v: string) => void;
  balanceRaw?: bigint;
}) {
  const handleMax = () => {
    if (balanceRaw == null) return;
    // Render at the full precision the asset supports so parseAmount
    // round-trips cleanly.
    const whole = balanceRaw / 10n ** BigInt(decimals);
    const frac = balanceRaw % 10n ** BigInt(decimals);
    const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
    onChange(fracStr ? `${whole}.${fracStr}` : whole.toString());
  };

  return (
    <div>
      <div className="md-input">
        <input
          type="text"
          inputMode="decimal"
          placeholder="0.0"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <span className="md-input-sym">
          <TokenIcon sym={sym} size={18} style={{ marginRight: 6, verticalAlign: "middle" }} />
          {sym}
        </span>
      </div>
      <div className="md-meta-row">
        <span>{label}</span>
        <span className="mono" style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
          {balanceRaw != null && (
            <>
              <span>{fmtNum(rawToNum(balanceRaw, decimals), Math.min(decimals, 4))}</span>
              <button
                type="button"
                onClick={handleMax}
                style={{
                  background: "transparent",
                  border: "0",
                  font: "inherit",
                  color: "var(--primary)",
                  cursor: "pointer",
                  padding: 0,
                  fontSize: 11,
                  letterSpacing: ".04em",
                  textTransform: "uppercase",
                }}
              >
                Max
              </button>
            </>
          )}
          {balanceRaw == null && <span>—</span>}
        </span>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
//   Not-found state (unknown slug)
// ════════════════════════════════════════════════════════════════════════

function NotFound({ onBack }: { onBack: () => void }) {
  return (
    <section className="card" style={{ padding: "56px 32px", textAlign: "center", maxWidth: 520, margin: "40px auto" }}>
      <h2 className="display" style={{ fontSize: 24, margin: "0 0 8px", letterSpacing: "-0.02em" }}>
        Market not found
      </h2>
      <p style={{ color: "var(--text-mid)", fontSize: 14, margin: "0 0 24px" }}>
        Only the {DEMO_POOL.symbol1} / {DEMO_POOL.symbol0} demo market is live right now.
      </p>
      <button type="button" className="btn btn-primary" onClick={onBack}>
        Back to markets
      </button>
    </section>
  );
}
