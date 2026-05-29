import { POOL_KEY_TUPLE } from "./poolKey";

/**
 * Write surface of LiquidsHookDemo. The hook pulls each currency from the
 * caller (`transferFrom`) inside its unlock callback, so users must approve
 * both tokens to the hook address before calling `supply` (and the borrow
 * asset before `repay`).
 *
 * Phase 3 wires the plain (non-Permit2) variants; Phase 5 swaps in
 * `supplyWithPermit2` / `repayWithPermit2` for the same UX without on-chain
 * approvals.
 */
export const HOOK_ABI = [
  {
    type: "function",
    name: "supply",
    stateMutability: "nonpayable",
    inputs: [
      { name: "key", ...POOL_KEY_TUPLE },
      { name: "amount0Desired", type: "uint256" },
      { name: "amount1Desired", type: "uint256" },
      { name: "minShares", type: "uint256" },
    ],
    outputs: [{ name: "sharesMinted", type: "uint256" }],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [
      { name: "key", ...POOL_KEY_TUPLE },
      { name: "sharesToBurn", type: "uint256" },
      { name: "minAmount0Out", type: "uint256" },
      { name: "minAmount1Out", type: "uint256" },
    ],
    outputs: [
      { name: "amount0Out", type: "uint256" },
      { name: "amount1Out", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "borrow",
    stateMutability: "nonpayable",
    inputs: [
      { name: "key", ...POOL_KEY_TUPLE },
      { name: "amount", type: "uint256" },
      { name: "minBorrowOut", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "repay",
    stateMutability: "nonpayable",
    inputs: [
      { name: "key", ...POOL_KEY_TUPLE },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "actuallyRepaid", type: "uint256" }],
  },
  // ── Permit2 variants — pull funds via a single signed permit instead of
  //    an upfront ERC20.approve to the hook. Match LiquidsHook.sol:621/852.
  {
    type: "function",
    name: "supplyWithPermit2",
    stateMutability: "nonpayable",
    inputs: [
      { name: "key", ...POOL_KEY_TUPLE },
      { name: "amount0Desired", type: "uint256" },
      { name: "amount1Desired", type: "uint256" },
      { name: "minShares", type: "uint256" },
      {
        name: "permit",
        type: "tuple",
        components: [
          {
            name: "permitted",
            type: "tuple[]",
            components: [
              { name: "token", type: "address" },
              { name: "amount", type: "uint256" },
            ],
          },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      { name: "signature", type: "bytes" },
    ],
    outputs: [{ name: "sharesMinted", type: "uint256" }],
  },
  {
    type: "function",
    name: "repayWithPermit2",
    stateMutability: "nonpayable",
    inputs: [
      { name: "key", ...POOL_KEY_TUPLE },
      { name: "amount", type: "uint256" },
      {
        name: "permit",
        type: "tuple",
        components: [
          {
            name: "permitted",
            type: "tuple",
            components: [
              { name: "token", type: "address" },
              { name: "amount", type: "uint256" },
            ],
          },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      { name: "signature", type: "bytes" },
    ],
    outputs: [{ name: "actuallyRepaid", type: "uint256" }],
  },
] as const;

/** Sentinel: `repay(maxUint256)` clears the entire outstanding debt. */
export const REPAY_ALL = (1n << 256n) - 1n;

/** Just enough of the hook's read surface for vault totals (used by the
 *  swap/withdraw ratio linker). The mapping returns the full struct unpacked. */
export const HOOK_VAULT_READ_ABI = [
  {
    type: "function",
    name: "vaults",
    stateMutability: "view",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [
      { name: "totalLiquidity", type: "uint128" },
      { name: "lastAccrualTime", type: "uint64" },
      { name: "totalScaledDebt", type: "uint256" },
      { name: "borrowIndex", type: "uint256" },
    ],
  },
] as const;
