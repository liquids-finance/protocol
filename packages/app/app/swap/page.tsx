"use client";

import { maxUint256 } from "viem";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  useAccount,
  useChainId,
  useGasPrice,
  usePublicClient,
  useSignTypedData,
  useWriteContract,
} from "wagmi";

import { SlippagePopover } from "@/components/SlippagePopover";
import { TokenIcon } from "@/components/TokenIcon";
import { extractErrorMessage, useTxFlow } from "@/components/TxFlow";
import { useLiveData } from "@/hooks/useLiveData";
import { useOkbPriceUsd } from "@/hooks/useOkbPriceUsd";
import { useQuote } from "@/hooks/useQuote";
import { ERC20_ABI } from "@/lib/abi/erc20";
import { estimateGasWithBuffer } from "@/lib/tx/estimateGas";
import { DEMO_POOL_KEY } from "@/lib/abi/poolKey";
import {
  UNIVERSAL_ROUTER_ABI,
  UR_COMMAND_PERMIT_AND_V4_SWAP,
  UR_COMMAND_V4_SWAP,
} from "@/lib/abi/universalRouter";
import { CONTRACTS, DEMO_POOL } from "@/lib/contracts";
import { fmtNum, fmtUSD, rawToNum } from "@/lib/format";
import { parseAmount } from "@/lib/parse";
import {
  DEFAULT_SIG_DEADLINE_SECONDS,
  PERMIT_SINGLE_TYPES,
  PERMIT2_MAX_AMOUNT_160,
  PERMIT2_MAX_EXPIRATION_48,
  permit2Domain,
} from "@/lib/permit2/sign";
import type { PermitSingleMessage } from "@/lib/permit2/sign";
import { encodeExactInputSingle, encodePermit2Permit } from "@/lib/swap/encode";

interface TokenMeta {
  symbol: string;
  address: `0x${string}`;
  decimals: number;
  /** 0 if this token is poolKey.currency0, else 1. */
  index: 0 | 1;
}

const USDT0: TokenMeta = {
  symbol: DEMO_POOL.symbol0,
  address: DEMO_POOL.currency0,
  decimals: DEMO_POOL.decimals0,
  index: 0,
};
const XETH: TokenMeta = {
  symbol: DEMO_POOL.symbol1,
  address: DEMO_POOL.currency1,
  decimals: DEMO_POOL.decimals1,
  index: 1,
};

const DEADLINE_SECONDS = 600;

export default function SwapPage() {
  const [sellTok, setSellTok] = useState<TokenMeta>(USDT0);
  const [buyTok, setBuyTok] = useState<TokenMeta>(XETH);
  const [sellAmt, setSellAmt] = useState("");
  const [slippagePct, setSlippagePct] = useState(0.5);
  const [showSettings, setShowSettings] = useState(false);

  const { pool, user, refetch: refetchLive } = useLiveData();
  const { data: gasPriceWei } = useGasPrice();
  const { price: okbUsd } = useOkbPriceUsd();

  const balanceFor = (tok: TokenMeta): bigint | null => {
    if (!user) return null;
    return tok.index === 0 ? user.usdt0Balance : user.xethBalance;
  };

  // ─── Quote ──────────────────────────────────────────────────────────
  const parsedSell = useMemo(() => parseAmount(sellAmt, sellTok.decimals), [sellAmt, sellTok]);
  const zeroForOne = sellTok.index === 0;
  const {
    quote,
    isFetching: quoteLoading,
    dataUpdatedAt: quoteUpdatedAt,
    refreshMs: quoteRefreshMs,
  } = useQuote({
    zeroForOne,
    exactAmount: parsedSell ?? 0n,
    enabled: parsedSell != null && parsedSell > 0n,
  });

  // Tick every second so the "Refresh in Ns" label visibly counts down.
  // Driven by a useState bumper so we don't reach into refs from JSX —
  // 1 Hz is plenty for a human-readable countdown, well below the cost
  // of any pool / quote read.
  const [, setNowTick] = useState(0);
  useEffect(() => {
    if (!quote) return;
    const id = window.setInterval(() => setNowTick((n) => n + 1), 1_000);
    return () => window.clearInterval(id);
  }, [quote]);
  const refreshInSec = quote && quoteUpdatedAt > 0
    ? Math.max(0, Math.ceil((quoteUpdatedAt + quoteRefreshMs - Date.now()) / 1000))
    : null;

  const buyAmtFromQuote = quote
    ? rawToNum(quote.amountOut, buyTok.decimals).toFixed(buyTok.decimals === 18 ? 6 : 2)
    : "";
  const sellNum = parsedSell ? rawToNum(parsedSell, sellTok.decimals) : 0;
  const buyNum = quote ? rawToNum(quote.amountOut, buyTok.decimals) : 0;
  const midRate = useMemo(() => (quote && sellNum > 0 ? buyNum / sellNum : null), [quote, sellNum, buyNum]);

  const minOut = quote
    ? (quote.amountOut * BigInt(Math.floor((100 - slippagePct) * 100))) / 10_000n
    : 0n;

  // ─── Auth states ────────────────────────────────────────────────────
  const sellErc20ToPermit2 =
    user && (sellTok.index === 0 ? user.usdt0PermitAllowance : user.xethPermitAllowance);
  const urPermit = user && (sellTok.index === 0 ? user.usdt0UrAllowance : user.xethUrAllowance);

  const now = Math.floor(Date.now() / 1000);
  const needsErc20Approve =
    parsedSell != null && sellErc20ToPermit2 != null && sellErc20ToPermit2 < parsedSell;
  // Per-swap signature: needed when the Permit2 → UR allowance is empty,
  // expired, or smaller than this swap. After the first signed swap with
  // `amount=MAX_160 / expiration=MAX_48`, subsequent swaps within the window
  // skip the permit step entirely.
  const needsPermitSign =
    parsedSell != null &&
    urPermit != null &&
    (urPermit.amount < parsedSell || urPermit.expiration < now);

  // ─── Write path — one async submit that walks the TxFlow modal ───────
  const flow = useTxFlow();
  const client = usePublicClient();
  const { address } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { writeContractAsync } = useWriteContract();
  const chainId = useChainId();
  const [busy, setBusy] = useState(false);
  const submitRef = useRef<() => Promise<void>>(() => Promise.resolve());

  const onSwap = async () => {
    if (!quote || parsedSell == null || !client || !urPermit || !address) return;
    const swapInput = encodeExactInputSingle({
      poolKey: DEMO_POOL_KEY,
      zeroForOne,
      amountIn: parsedSell,
      amountOutMin: minOut,
    });
    const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SECONDS);

    const steps = [
      ...(needsErc20Approve ? [{ key: "ap", label: `Approve ${sellTok.symbol} for Permit2` }] : []),
      ...(needsPermitSign ? [{ key: "sig", label: `Sign Permit2 → Universal Router (${sellTok.symbol})` }] : []),
      { key: "tx", label: needsPermitSign ? "Permit + V4 swap" : "V4 swap" },
    ];

    flow.start(`Swap ${sellTok.symbol} → ${buyTok.symbol}`, steps, {
      onRetry: () => submitRef.current(),
    });
    setBusy(true);
    try {
      if (needsErc20Approve) {
        flow.setStep("ap", { status: "pending" });
        const apParams = {
          address: sellTok.address,
          abi: ERC20_ABI,
          functionName: "approve" as const,
          args: [CONTRACTS.permit2, maxUint256] as const,
        };
        const apGas = await estimateGasWithBuffer(client, { ...apParams, account: address });
        const hash = await writeContractAsync({ ...apParams, gas: apGas });
        flow.setStep("ap", { txHash: hash });
        await client.waitForTransactionReceipt({ hash });
        flow.setStep("ap", { status: "done" });
        await refetchLive();
      }

      let permitInput: `0x${string}` | null = null;
      if (needsPermitSign) {
        flow.setStep("sig", { status: "pending" });
        // Sign for MAX amount + MAX expiration so the next N swaps inside
        // this window go directly to V4_SWAP without another signature.
        const permit: PermitSingleMessage = {
          details: {
            token: sellTok.address,
            amount: PERMIT2_MAX_AMOUNT_160,
            expiration: PERMIT2_MAX_EXPIRATION_48,
            nonce: urPermit.nonce,
          },
          spender: CONTRACTS.universalRouter,
          sigDeadline: BigInt(Math.floor(Date.now() / 1000) + DEFAULT_SIG_DEADLINE_SECONDS),
        };
        const sig = await signTypedDataAsync({
          domain: permit2Domain(chainId),
          types: PERMIT_SINGLE_TYPES,
          primaryType: "PermitSingle",
          message: permit,
        });
        permitInput = encodePermit2Permit(permit, sig);
        flow.setStep("sig", { status: "done" });
      }

      flow.setStep("tx", { status: "pending" });
      const swapParams = permitInput
        ? {
            address: CONTRACTS.universalRouter,
            abi: UNIVERSAL_ROUTER_ABI,
            functionName: "execute" as const,
            args: [UR_COMMAND_PERMIT_AND_V4_SWAP, [permitInput, swapInput], deadline] as const,
          }
        : {
            address: CONTRACTS.universalRouter,
            abi: UNIVERSAL_ROUTER_ABI,
            functionName: "execute" as const,
            args: [UR_COMMAND_V4_SWAP, [swapInput], deadline] as const,
          };
      const swapGas = await estimateGasWithBuffer(client, { ...swapParams, account: address });
      const hash = await writeContractAsync({ ...swapParams, gas: swapGas });
      flow.setStep("tx", { txHash: hash });
      await client.waitForTransactionReceipt({ hash });
      flow.setStep("tx", { status: "done" });
      flow.done();

      refetchLive();
      setSellAmt("");
    } catch (e) {
      flow.fail(extractErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  submitRef.current = onSwap;

  const flip = () => {
    setSellTok(buyTok);
    setBuyTok(sellTok);
    setSellAmt(buyAmtFromQuote);
  };

  // ─── CTA label state machine ────────────────────────────────────────
  const sellBal = balanceFor(sellTok);
  const insufficient = sellBal != null && parsedSell != null && parsedSell > sellBal;

  const cta = (() => {
    if (parsedSell == null || parsedSell === 0n) return { label: "Enter an amount", disabled: true };
    if (insufficient) return { label: `Insufficient ${sellTok.symbol} balance`, disabled: true };
    if (!quote && quoteLoading) return { label: "Fetching quote…", disabled: true };
    if (!quote) return { label: "No route", disabled: true };
    return {
      label: busy ? "Working…" : "Swap",
      action: onSwap,
      disabled: busy,
    };
  })();

  // USD value via the pool's spot rate. `rate0Per1` is "USDT0 per xETH"
  // (~3,500). USDT0 ≈ $1 so the formula is symmetric — multiply the xETH
  // side by `rate0Per1`, USDT0 stays as-is. The previous derivation off
  // `midRate` inverted the direction and rendered xETH as $0.00.
  const usdt0PerXeth = pool?.rate0Per1 ?? 0;
  const sellUsd = sellTok.index === 0 ? sellNum : sellNum * usdt0PerXeth;
  const buyUsd = buyTok.index === 0 ? buyNum : buyNum * usdt0PerXeth;

  // Gas estimate × current gas price × OKB/USD → swap network fee in USD.
  // Quoter's `gasEstimate` is in gas units; `useGasPrice` is wei/gas.
  // OKB has 18 decimals like ETH, so a plain divide-by-1e18 finishes it.
  const gasUsd = useMemo(() => {
    if (!quote?.gasEstimate || !gasPriceWei || !okbUsd) return null;
    const weiCost = quote.gasEstimate * gasPriceWei;
    return (Number(weiCost) / 1e18) * okbUsd;
  }, [quote?.gasEstimate, gasPriceWei, okbUsd]);

  return (
    <section className="swap-shell card">
      <header className="swap-head">
        <h2 className="display">Swap</h2>
        <button
          className="swap-icon-btn"
          onClick={() => setShowSettings((v) => !v)}
          type="button"
          aria-label="Slippage settings"
        >
          <SettingsIcon />
        </button>
        <SlippagePopover
          open={showSettings}
          onClose={() => setShowSettings(false)}
          value={slippagePct}
          onChange={setSlippagePct}
        />
      </header>

      <div className="swap-body">
        <SwapInput
          label="Sell"
          token={sellTok}
          value={sellAmt}
          onChange={setSellAmt}
          balance={sellBal}
          usd={sellUsd}
          showMax
        />

        <div className="swap-flip">
          <button type="button" className="swap-flip-btn" onClick={flip} aria-label="Flip tokens">
            ↓
          </button>
        </div>

        <SwapInput
          label="Buy"
          token={buyTok}
          value={buyAmtFromQuote}
          onChange={() => {}}
          balance={balanceFor(buyTok)}
          usd={buyUsd}
          readonly
        />

        <PriceInfo
          sellTok={sellTok}
          buyTok={buyTok}
          midRate={midRate}
          quoteAmountOut={quote?.amountOut ?? null}
          slippagePct={slippagePct}
          minOut={minOut}
          gasEstimate={quote?.gasEstimate ?? null}
          gasUsd={gasUsd}
          loading={quoteLoading}
          refreshInSec={refreshInSec}
        />

        <button
          type="button"
          className="btn btn-primary swap-cta"
          onClick={cta.action}
          disabled={cta.disabled}
        >
          {cta.label}
        </button>
      </div>
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════════
//   Input panel
// ════════════════════════════════════════════════════════════════════════

function SwapInput({
  label,
  token,
  value,
  onChange,
  balance,
  usd,
  showMax,
  readonly,
}: {
  label: string;
  token: TokenMeta;
  value: string;
  onChange: (v: string) => void;
  balance: bigint | null;
  usd: number;
  showMax?: boolean;
  readonly?: boolean;
}) {
  const handleMax = () => {
    if (balance == null) return;
    const whole = balance / 10n ** BigInt(token.decimals);
    const frac = balance % 10n ** BigInt(token.decimals);
    const fracStr = frac.toString().padStart(token.decimals, "0").replace(/0+$/, "");
    onChange(fracStr ? `${whole}.${fracStr}` : whole.toString());
  };

  return (
    <div className="swap-input">
      <div className="swap-input-label">{label}</div>
      <div className="swap-input-row">
        <input
          type="text"
          inputMode="decimal"
          placeholder="0.0"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          readOnly={readonly}
        />
        <span className="swap-token-chip">
          <TokenIcon sym={token.symbol} size={22} />
          {token.symbol}
        </span>
      </div>
      <div className="swap-balance-row">
        <span>{usd > 0 ? `~${fmtUSD(usd, 2)}` : "~$0.00"}</span>
        <span>
          Balance:{" "}
          {balance != null
            ? fmtNum(rawToNum(balance, token.decimals), Math.min(token.decimals, 4))
            : "—"}
          {showMax && balance != null && balance > 0n && (
            <button type="button" className="swap-max" onClick={handleMax}>
              Max
            </button>
          )}
        </span>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
//   Price + gas info row
// ════════════════════════════════════════════════════════════════════════

function PriceInfo({
  sellTok,
  buyTok,
  midRate,
  quoteAmountOut,
  slippagePct,
  minOut,
  gasEstimate,
  gasUsd,
  loading,
  refreshInSec,
}: {
  sellTok: TokenMeta;
  buyTok: TokenMeta;
  midRate: number | null;
  quoteAmountOut: bigint | null;
  slippagePct: number;
  minOut: bigint;
  gasEstimate: bigint | null;
  gasUsd: number | null;
  loading: boolean;
  /** Seconds until the next quote auto-refresh. null while no quote
   *  has loaded yet; renders a tiny "fetching…" / "refresh Ns" hint
   *  on the price row so the user sees the quote is alive. */
  refreshInSec: number | null;
}) {
  const rateLabel = midRate
    ? `1 ${sellTok.symbol} = ${fmtNum(midRate, midRate < 1 ? 6 : 2)} ${buyTok.symbol}`
    : "—";
  const minOutNum = quoteAmountOut ? rawToNum(minOut, buyTok.decimals) : 0;
  // Network fee row: prefer the USD figure when both gas + OKB price are
  // available, fall back to the raw gas-units estimate otherwise.
  const feeLabel = gasUsd != null
    ? `~$${gasUsd.toFixed(gasUsd < 0.01 ? 4 : 2)}`
    : gasEstimate
    ? `~${Number(gasEstimate).toLocaleString()} gas`
    : "—";

  return (
    <div className="swap-info">
      <div className="swap-info-row">
        <span>
          Price
          {refreshInSec != null && !loading && (
            <span style={{ opacity: 0.5, marginLeft: 6, fontSize: 11 }}>
              · refresh {refreshInSec}s
            </span>
          )}
          {loading && (
            <span style={{ opacity: 0.5, marginLeft: 6, fontSize: 11 }}>
              · refreshing…
            </span>
          )}
        </span>
        <span className="mono">{loading && !midRate ? "fetching…" : rateLabel}</span>
      </div>
      <div className="swap-info-row">
        <span>Minimum received</span>
        <span className="mono">
          {quoteAmountOut ? `${fmtNum(minOutNum, buyTok.decimals === 18 ? 6 : 2)} ${buyTok.symbol}` : "—"}
        </span>
      </div>
      <div className="swap-info-row">
        <span>Max slippage</span>
        <span className="mono">{slippagePct.toFixed(2)}%</span>
      </div>
      <div className="swap-info-row">
        <span>Network fee</span>
        <span className="mono">{feeLabel}</span>
      </div>
    </div>
  );
}


// ════════════════════════════════════════════════════════════════════════
//   Inline SVG icons
// ════════════════════════════════════════════════════════════════════════

function SettingsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.05a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.05a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.05a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
