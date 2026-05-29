"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
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
}

interface TxFlowApi {
  start: (title: string, steps: TxStepInput[]) => void;
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
export function TxFlowProvider({ children }: { children: React.ReactNode }) {
  const [snap, setSnap] = useState<FlowSnapshot>({
    open: false,
    state: "closed",
    title: "",
    steps: [],
  });

  const start = useCallback<TxFlowApi["start"]>((title, steps) => {
    setSnap({
      open: true,
      state: "running",
      title,
      steps: steps.map((s) => ({ ...s, status: "idle" })),
    });
  }, []);

  const setStep = useCallback<TxFlowApi["setStep"]>((key, update) => {
    setSnap((s) => ({
      ...s,
      steps: s.steps.map((step) => (step.key === key ? { ...step, ...update } : step)),
    }));
  }, []);

  const done = useCallback(() => {
    setSnap((s) => ({ ...s, state: "done" }));
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
      return { ...s, state: "failed", steps };
    });
  }, []);

  const close = useCallback(() => {
    setSnap((s) => ({ ...s, open: false, state: "closed" }));
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
      <TxModal snap={snap} api={api} />
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

function TxModal({ snap, api }: { snap: FlowSnapshot; api: TxFlowApi }) {
  if (!snap.open) return null;

  const subtitle =
    snap.state === "running"
      ? "Confirm each step in your wallet — leave this open until it's done."
      : snap.state === "done"
      ? "Transaction confirmed on X Layer."
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

        {snap.state !== "running" && (
          <button type="button" className="btn btn-primary tx-modal-foot" onClick={api.close}>
            {snap.state === "done" ? "Done" : "Close"}
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
