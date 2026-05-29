import { POOL_KEY_TUPLE } from "./poolKey";

/**
 * Minimal ABI fragment for LiquidsLensDemo. Only includes the projected views
 * the frontend actually reads — keeps bundle small and surface obvious.
 *
 * All returns are WAD-scaled (1e18) where applicable:
 *   - USD-WAD: `totalAssets`, `shareValue`
 *   - rate-WAD: `borrowAPY`, `lendingAPY` (annual fraction × 1e18)
 *   - WAD ratio: `utilization`, `healthFactor`
 *   - raw asset units: `debtOf` (decimals of the borrow asset, NOT WAD)
 */
export const LENS_ABI = [
  {
    type: "function",
    name: "totalAssets",
    stateMutability: "view",
    inputs: [{ name: "key", ...POOL_KEY_TUPLE }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "utilization",
    stateMutability: "view",
    inputs: [{ name: "key", ...POOL_KEY_TUPLE }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "borrowAPY",
    stateMutability: "view",
    inputs: [{ name: "key", ...POOL_KEY_TUPLE }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "lendingAPY",
    stateMutability: "view",
    inputs: [{ name: "key", ...POOL_KEY_TUPLE }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "shareValue",
    stateMutability: "view",
    inputs: [{ name: "key", ...POOL_KEY_TUPLE }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "debtOf",
    stateMutability: "view",
    inputs: [
      { name: "key", ...POOL_KEY_TUPLE },
      { name: "user", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "healthFactor",
    stateMutability: "view",
    inputs: [
      { name: "key", ...POOL_KEY_TUPLE },
      { name: "user", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;
