"use client";

import { useEffect, useRef, useState } from "react";

const PRESETS = [0.1, 0.5, 1.0] as const;

/**
 * Top-right slippage chooser opened from the Swap card's gear icon. Closes
 * on outside-click and Escape. Uses a controlled value pattern so the parent
 * keeps the source of truth.
 */
export function SlippagePopover({
  open,
  onClose,
  value,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  value: number;
  onChange: (pct: number) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [custom, setCustom] = useState("");

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const isPreset = (PRESETS as readonly number[]).includes(value);
  const warn = value > 5;
  const veryHigh = value > 10;

  return (
    <div ref={rootRef} className="settings-pop">
      <h4>Max slippage</h4>
      <div className="slippage-row">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            className={`slippage-preset${value === p ? " is-active" : ""}`}
            onClick={() => {
              onChange(p);
              setCustom("");
            }}
          >
            {p}%
          </button>
        ))}
      </div>
      <div className={`slippage-custom${!isPreset ? " is-active" : ""}`}>
        <input
          type="text"
          inputMode="decimal"
          placeholder="Custom"
          value={!isPreset && custom === "" ? value.toString() : custom}
          onChange={(e) => {
            setCustom(e.target.value);
            const n = Number(e.target.value);
            if (!Number.isNaN(n) && n > 0 && n < 50) onChange(n);
          }}
        />
        <span>%</span>
      </div>
      {warn && (
        <p className={`slippage-warn${veryHigh ? " is-bad" : ""}`}>
          {veryHigh
            ? "Above 10% is very risky — most swaps will be sandwich-attacked."
            : "High slippage tolerance — your trade may be front-run."}
        </p>
      )}
    </div>
  );
}
