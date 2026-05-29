import type { Address, TypedDataDomain } from "viem";

import { CONTRACTS } from "@/lib/contracts";

/**
 * Permit2 EIP-712 helpers — typed-data structs used across all three sig
 * flows (swap, supply, repay) plus a domain factory + nonce generator.
 *
 * NOTE: Permit2's EIP-712 domain has no `version` field — just name +
 * chainId + verifyingContract. Adding a version yields a different domain
 * separator and the signature won't verify on-chain.
 */
export function permit2Domain(chainId: number): TypedDataDomain {
  return {
    name: "Permit2",
    chainId,
    verifyingContract: CONTRACTS.permit2,
  };
}

// ─── AllowanceTransfer (used by Universal Router) ─────────────────────────
//
// One persistent allowance per (owner, token, spender), set by a signed
// PermitSingle and refreshed by a new sig once the previous one is spent
// or expires.

export const PERMIT_SINGLE_TYPES = {
  PermitDetails: [
    { name: "token", type: "address" },
    { name: "amount", type: "uint160" },
    { name: "expiration", type: "uint48" },
    { name: "nonce", type: "uint48" },
  ],
  PermitSingle: [
    { name: "details", type: "PermitDetails" },
    { name: "spender", type: "address" },
    { name: "sigDeadline", type: "uint256" },
  ],
} as const;

export interface PermitDetails {
  token: Address;
  amount: bigint; // uint160
  expiration: number; // uint48
  nonce: number; // uint48 (current on-chain nonce, read from Permit2.allowance)
}

export interface PermitSingleMessage {
  details: PermitDetails;
  spender: Address;
  sigDeadline: bigint;
}

// ─── SignatureTransfer (used by our hook's Permit2 variants) ──────────────
//
// One-shot signatures consumed during transferFrom. Each carries a random
// nonce (bitmap-checked on-chain) so any unused word/bit combination is
// valid forever.

export const PERMIT_TRANSFER_FROM_TYPES = {
  TokenPermissions: [
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
  ],
  PermitTransferFrom: [
    { name: "permitted", type: "TokenPermissions" },
    { name: "spender", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export const PERMIT_BATCH_TRANSFER_FROM_TYPES = {
  TokenPermissions: [
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
  ],
  PermitBatchTransferFrom: [
    { name: "permitted", type: "TokenPermissions[]" },
    { name: "spender", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export interface TokenPermissions {
  token: Address;
  amount: bigint;
}

export interface PermitTransferFromMessage {
  permitted: TokenPermissions;
  spender: Address;
  nonce: bigint;
  deadline: bigint;
}

export interface PermitBatchTransferFromMessage {
  permitted: TokenPermissions[];
  spender: Address;
  nonce: bigint;
  deadline: bigint;
}

// ─── Random nonce for SignatureTransfer ──────────────────────────────────

/**
 * 248-bit random nonce — comfortably below uint256 max but enormous enough
 * that bitmap collisions never happen in practice. Uses Web Crypto when
 * available, falls back to Math.random for SSR safety (the result is only
 * consumed inside event handlers anyway).
 */
export function randomPermit2Nonce(): bigint {
  const bytes = new Uint8Array(31);
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let value = 0n;
  for (const b of bytes) value = (value << 8n) | BigInt(b);
  return value;
}

// ─── Sentinels reused at the call sites ──────────────────────────────────

export const PERMIT2_MAX_AMOUNT_160 = 2n ** 160n - 1n;
export const PERMIT2_MAX_EXPIRATION_48 = 2 ** 48 - 1;
/** Default 30-minute window the user has to confirm a signed permit. */
export const DEFAULT_SIG_DEADLINE_SECONDS = 30 * 60;
