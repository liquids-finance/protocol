/**
 * Patched re-export of the `qr` package.
 *
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │ Why this exists                                                 │
 *   │                                                                  │
 *   │ cuer@0.0.3 (RainbowKit's QR component) calls                     │
 *   │   encodeQR(value, 'raw', { border: 0, ... })                     │
 *   │ but qr@0.6+ enforces `border >= 1` and throws — without this     │
 *   │ shim the WC modal crashes on open.                               │
 *   │                                                                  │
 *   │ The naive fix (force border = 1) made the modal render, but the  │
 *   │ resulting grid had an extra 1-cell quiet zone baked into the     │
 *   │ matrix. cuer's renderer assumes the finder patterns start at     │
 *   │ row/col 0, so the painted QR ended up with shifted finder        │
 *   │ corners — phone cameras failed to lock on it. (RainbowKit's      │
 *   │ "Need the official WalletConnect modal?" link uses WC's own      │
 *   │ canvas, which is why that one always worked.)                    │
 *   │                                                                  │
 *   │ Correct fix: when the caller asks for border = 0, call qr with   │
 *   │ border = 1 (to bypass the throw) then strip the outer ring from  │
 *   │ the returned grid so cuer sees the exact border-0 matrix it      │
 *   │ expects.                                                         │
 *   └──────────────────────────────────────────────────────────────────┘
 *
 * Wired via webpack `resolve.alias` + Turbopack `resolveAlias` in
 * `next.config.ts`. The import path `"qr"` (exact) resolves here;
 * `"qr-real"` resolves to the real package below.
 */

import * as qrLib from "qr-real";

const originalEncodeQR = qrLib.encodeQR;

export const encodeQR = function encodeQR(text, mode, options) {
  const wantsZeroBorder = !(
    options &&
    typeof options.border === "number" &&
    options.border > 0
  );

  if (!wantsZeroBorder) {
    return originalEncodeQR(text, mode, options);
  }

  const opts = options ? { ...options, border: 1 } : { border: 1 };
  const result = originalEncodeQR(text, mode, opts);

  // Only the "raw" mode is shaped like a 2D boolean grid that needs the
  // border stripped. Other modes (svg / gif / ascii) bake the border into
  // a string, and cuer never uses them, so we leave them untouched.
  if (
    mode === "raw" &&
    Array.isArray(result) &&
    result.length > 2 &&
    Array.isArray(result[0]) &&
    result[0].length > 2
  ) {
    const inner = result.slice(1, -1);
    return inner.map((row) => row.slice(1, -1));
  }
  return result;
};

// Pass-through every other named binding (decodeQR, types, …) so importers
// of `"qr"` see the full surface.
export * from "qr-real";
