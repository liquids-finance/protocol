import { POOL_KEY_TUPLE } from "./poolKey";

/**
 * V4 Quoter — exact-single-hop pricing. The on-chain function is non-view
 * (it calls `PoolManager.unlock` under the hood) but the contract catches the
 * resulting revert internally and returns the decoded amounts, so an eth_call
 * via wagmi's read path resolves cleanly.
 *
 * The ABI is annotated as `view` on purpose: wagmi's type system constrains
 * `useReadContract` to view/pure ABIs, but the runtime call just does eth_call
 * which works regardless. This lets us keep types tight without a cast.
 */
export const QUOTER_ABI = [
  {
    type: "function",
    name: "quoteExactInputSingle",
    stateMutability: "view",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "poolKey", ...POOL_KEY_TUPLE },
          { name: "zeroForOne", type: "bool" },
          { name: "exactAmount", type: "uint128" },
          { name: "hookData", type: "bytes" },
        ],
      },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "quoteExactOutputSingle",
    stateMutability: "view",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "poolKey", ...POOL_KEY_TUPLE },
          { name: "zeroForOne", type: "bool" },
          { name: "exactAmount", type: "uint128" },
          { name: "hookData", type: "bytes" },
        ],
      },
    ],
    outputs: [
      { name: "amountIn", type: "uint256" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
] as const;
