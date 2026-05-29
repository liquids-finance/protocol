/**
 * Permit2 — AllowanceTransfer surface.
 *
 * The Universal Router pulls tokens from the user via Permit2 (never directly
 * via ERC20.transferFrom), so each swap path needs two approvals on first
 * use of a token:
 *   1. ERC20.approve(Permit2, max)          — one-time, persists forever
 *   2. Permit2.approve(token, UR, amount, expiration) — per-amount, expires
 *
 * Phase 5 swaps step (2) for a signed PermitSingle so a swap costs the user
 * a single tx instead of an extra approval round-trip.
 */
export const PERMIT2_ABI = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "token", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
      { name: "nonce", type: "uint48" },
    ],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "spender", type: "address" },
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
    ],
    outputs: [],
  },
] as const;

/**
 * Permit2 sentinel: 2^48 - 1 ≈ year 8.9M. Effectively never expires.
 * uint48 max (281_474_976_710_655) is well inside `Number.MAX_SAFE_INTEGER`
 * so viem represents it as a plain number rather than a bigint.
 */
export const PERMIT2_MAX_EXPIRATION = 2 ** 48 - 1;

/** Permit2's amount field is uint160 — cap at 2^160 - 1, not 2^256. */
export const PERMIT2_MAX_AMOUNT = 2n ** 160n - 1n;
