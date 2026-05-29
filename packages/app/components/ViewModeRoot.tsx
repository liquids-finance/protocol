"use client";

import { usePathname } from "next/navigation";

/**
 * Wraps the app shell, applying `data-view="markets"` on the root container
 * when on /markets so the Markets table can grow/scroll within the viewport
 * (mirroring the design's `#root[data-view="markets"]` behavior).
 */
export function ViewModeRoot({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // Only the markets LIST page gets the locked-viewport markets layout.
  // Detail pages (/markets/[slug]) scroll like the dashboard.
  const view = pathname === "/markets" ? "markets" : "dashboard";
  return (
    <div className="app-root" data-view={view}>
      {children}
    </div>
  );
}
