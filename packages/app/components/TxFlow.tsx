"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";

import { OKLINK_TX } from "@/lib/contracts";
import { shortAddr } from "@/lib/format";

export type StepStatus = "idle" | "pending" | "done" | "failed";

export interface TxStepInput {
  key: string;
  label: string;
}

export interface TxStep extends TxStepInput {
  status: StepStatus;
  txHash?: `0x${string}`;
  errorMsg?: string;
}

type FlowState = "running" | "done" | "failed" | "closed";

interface FlowSnapshot {
  open: boolean;
  state: FlowState;
  title: string;
  steps: TxStep[];
  /** True iff the most recent failure looks like a wallet rejection (4001
   *  / "User rejected" / "User denied") rather than an on-chain revert. */
  failureIsRejection: boolean;
}

interface StartOptions {
  /** Re-runs the same submit flow. Modal exposes this as a "Retry" button
   *  on the failed step. The submit is expected to re-derive its own step
   *  list from current state, so already-confirmed steps (approvals,
   *  signatures whose allowance is still valid) get skipped on retry. */
  onRetry?: () => void | Promise<void>;
}

interface TxFlowApi {
  start: (title: string, steps: TxStepInput[], opts?: StartOptions) => void;
  setStep: (key: string, update: Partial<Omit<TxStep, "key" | "label">>) => void;
  done: () => void;
  fail: (errorMsg?: string) => void;
  close: () => void;
}

const TxFlowContext = createContext<TxFlowApi | null>(null);

/**
 * Centralized transaction-flow surface. Any on-chain action (swap, supply,
 * withdraw, borrow, repay) calls `start` with its expected steps, then
 * advances them via `setStep` while it works. The modal renders a clean
 * progress view + final tx-hash links — replaces the per-step toast spam
 * we had during Phases 3–5.
 */
/** Heuristic for "was this a wallet rejection vs an on-chain revert?".
 *  EIP-1193 says rejection comes back as code 4001, but every wallet
 *  spells the message differently — match a few common shapes plus the
 *  numeric code so we cover MetaMask, Rabby, WC mobile wallets, OKX. */
function looksLikeUserRejection(msg: string | undefined): boolean {
  if (!msg) return false;
  const m = msg.toLowerCase();
  return (
    m.includes("user rejected") ||
    m.includes("user denied") ||
    m.includes("rejected the request") ||
    m.includes("4001")
  );
}

export function TxFlowProvider({ children }: { children: React.ReactNode }) {
  const [snap, setSnap] = useState<FlowSnapshot>({
    open: false,
    state: "closed",
    title: "",
    steps: [],
    failureIsRejection: false,
  });

  // The submit-again callback is kept in a ref (not in `snap`) because it
  // changes identity on every render in the form component and we don't
  // want that to force a modal re-render on each keystroke.
  const onRetryRef = useRef<(() => void | Promise<void>) | null>(null);

  const start = useCallback<TxFlowApi["start"]>((title, steps, opts) => {
    onRetryRef.current = opts?.onRetry ?? null;
    setSnap({
      open: true,
      state: "running",
      title,
      steps: steps.map((s) => ({ ...s, status: "idle" })),
      failureIsRejection: false,
    });
  }, []);

  const setStep = useCallback<TxFlowApi["setStep"]>((key, update) => {
    setSnap((s) => ({
      ...s,
      steps: s.steps.map((step) => (step.key === key ? { ...step, ...update } : step)),
    }));
  }, []);

  const done = useCallback(() => {
    onRetryRef.current = null;
    setSnap((s) => ({ ...s, state: "done", failureIsRejection: false }));
  }, []);

  const fail = useCallback<TxFlowApi["fail"]>((errorMsg) => {
    setSnap((s) => {
      // Mark the first non-done step as failed so the modal shows where the
      // flow broke. If they're all done, fall back to flagging the last one.
      const idx = s.steps.findIndex((st) => st.status !== "done");
      const target = idx === -1 ? s.steps.length - 1 : idx;
      const steps = s.steps.map((step, i) =>
        i === target ? { ...step, status: "failed" as const, errorMsg } : step
      );
      return { ...s, state: "failed", steps, failureIsRejection: looksLikeUserRejection(errorMsg) };
    });
  }, []);

  const close = useCallback(() => {
    onRetryRef.current = null;
    setSnap((s) => ({ ...s, open: false, state: "closed", failureIsRejection: false }));
  }, []);

  const retry = useCallback(async () => {
    const fn = onRetryRef.current;
    if (!fn) return;
    // Drop the failed/error marker on the failed step and flip the flow
    // back to "running" before re-invoking — the form's submit will set
    // the next pending step as it walks forward. Keeps already-done step
    // markers intact so the user can see what carried over.
    setSnap((s) => ({
      ...s,
      state: "running",
      failureIsRejection: false,
      steps: s.steps.map((step) =>
        step.status === "failed" ? { ...step, status: "idle", errorMsg: undefined } : step
      ),
    }));
    try {
      await fn();
    } catch {
      // The submit's own try/catch already routes errors through fail().
      // Swallow here so an unhandled promise rejection doesn't surface.
    }
  }, []);

  const api = useMemo<TxFlowApi>(() => ({ start, setStep, done, fail, close }), [
    start,
    setStep,
    done,
    fail,
    close,
  ]);

  return (
    <TxFlowContext.Provider value={api}>
      {children}
      <TxModal snap={snap} api={api} onRetry={retry} canRetry={onRetryRef.current != null} />
    </TxFlowContext.Provider>
  );
}

export function useTxFlow(): TxFlowApi {
  const ctx = useContext(TxFlowContext);
  if (!ctx) throw new Error("useTxFlow called outside <TxFlowProvider>");
  return ctx;
}

// ════════════════════════════════════════════════════════════════════════
//   Modal renderer
// ════════════════════════════════════════════════════════════════════════

function TxModal({
  snap,
  api,
  onRetry,
  canRetry,
}: {
  snap: FlowSnapshot;
  api: TxFlowApi;
  onRetry: () => void | Promise<void>;
  canRetry: boolean;
}) {
  if (!snap.open) return null;

  const completedCount = snap.steps.filter((s) => s.status === "done").length;
  const hasResumeContext = completedCount > 0 && snap.state === "failed";

  const subtitle =
    snap.state === "running"
      ? "Confirm each step in your wallet — leave this open until it's done."
      : snap.state === "done"
      ? "Transaction confirmed on X Layer."
      : snap.failureIsRejection && hasResumeContext
      ? `You cancelled in the wallet. Earlier steps are still good — Retry picks up from where you stopped.`
      : snap.failureIsRejection
      ? "You cancelled in the wallet. Retry to try again."
      : "Something went wrong. Review the failing step below.";

  // Click on backdrop closes only when the flow has finished (success/failure)
  // so users can't accidentally dismiss an in-flight signature prompt.
  const onBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (snap.state === "running") return;
    api.close();
  };

  return (
    <div className="tx-modal-overlay" onClick={onBackdrop} role="dialog" aria-modal>
      <div className="tx-modal-card card">
        <h2 className="display">{snap.title}</h2>
        <p className="tx-modal-sub">{subtitle}</p>

        <ul className="tx-steps">
          {snap.steps.map((step) => (
            <StepRow key={step.key} step={step} />
          ))}
        </ul>

        {snap.state === "failed" && canRetry && (
          <div className="tx-modal-foot" style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ flex: 1 }}
              onClick={api.close}
            >
              Close
            </button>
            <button
              type="button"
              className="btn btn-primary"
              style={{ flex: 1 }}
              onClick={onRetry}
            >
              Retry
            </button>
          </div>
        )}
        {snap.state === "failed" && !canRetry && (
          <button type="button" className="btn btn-primary tx-modal-foot" onClick={api.close}>
            Close
          </button>
        )}
        {snap.state === "done" && (
          <button type="button" className="btn btn-primary tx-modal-foot" onClick={api.close}>
            Done
          </button>
        )}
      </div>
    </div>
  );
}

function StepRow({ step }: { step: TxStep }) {
  return (
    <li className={`tx-step tx-step-${step.status}`}>
      <span className="tx-step-marker">
        {step.status === "pending" && <span className="tx-spinner" aria-hidden />}
        {step.status === "done" && <span aria-hidden>✓</span>}
        {step.status === "failed" && <span aria-hidden>!</span>}
        {step.status === "idle" && <span aria-hidden>·</span>}
      </span>
      <div className="tx-step-body">
        <span className="tx-step-label">{step.label}</span>
        {step.txHash && (
          <span className="tx-step-hash mono">
            <a href={OKLINK_TX(step.txHash)} target="_blank" rel="noreferrer">
              {shortAddr(step.txHash, 10, 8)} ↗
            </a>
          </span>
        )}
        {step.errorMsg && <span className="tx-step-error">{step.errorMsg}</span>}
      </div>
    </li>
  );
}

// ════════════════════════════════════════════════════════════════════════
//   Helper for forms — convert wagmi / viem errors to a short message
// ════════════════════════════════════════════════════════════════════════

/**
 * Wagmi + viem errors come with a long `message` and a short `shortMessage`.
 * Surface the latter when available; everything else collapses to a one-liner
 * so the modal stays compact.
 */
export function extractErrorMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e && typeof e === "object") {
    const o = e as { shortMessage?: unknown; details?: unknown; message?: unknown };
    if (typeof o.shortMessage === "string") return o.shortMessage;
    if (typeof o.details === "string") return o.details;
    if (typeof o.message === "string") return o.message;
  }
  return "Unknown error";
}
