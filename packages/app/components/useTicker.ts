"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Count-up animation hook. Eases from current value → target over `duration` ms
 * using a cubic-out curve. Cancels any in-flight RAF when `target` changes
 * so values never get into a half-stale state.
 */
export function useTicker(target: number, duration = 900): number {
  const [v, setV] = useState(target);
  const fromRef = useRef(target);

  useEffect(() => {
    const from = fromRef.current;
    const start = performance.now();
    let raf = 0;

    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / duration);
      const e = 1 - Math.pow(1 - k, 3);
      const next = from + (target - from) * e;
      setV(next);
      if (k < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return v;
}
