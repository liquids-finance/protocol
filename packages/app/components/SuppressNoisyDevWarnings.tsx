"use client";

import { useEffect } from "react";

/**
 * Filters known-noisy upstream dev warnings out of the Next.js error overlay.
 *
 * Currently muted:
 *   - "invalid border=0" — RainbowKit's QR code library passes `border={0}` to
 *     an SVG. React 19 + Next 15.5 rejects unknown SVG attrs and surfaces the
 *     warning as a full-screen overlay. Harmless at runtime; cosmetic only.
 *
 * No-op in production — keep the safety net for any real bug that ships.
 */
export function SuppressNoisyDevWarnings() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    const orig = console.error;
    console.error = (...args: unknown[]) => {
      const first = args[0];
      if (typeof first === "string" && first.includes("invalid border")) return;
      orig.apply(console, args);
    };
    return () => {
      console.error = orig;
    };
  }, []);
  return null;
}
