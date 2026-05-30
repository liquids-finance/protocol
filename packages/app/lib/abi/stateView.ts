/**
 * V4 StateView — read-only view over PoolManager's hot state.
 *
 *   • `getSlot0` backs out the pool's spot price (sqrtPriceX96) for the
 *     supply / withdraw ratio linker.
 *
 *   • `getFeeGrowthGlobals` returns the pool's lifetime LP-fee
 *     accumulators per unit of liquidity (X128 fixed-point). We diff
 *     these against a localStorage snapshot to back out the realised LP
 *     fee APR — same maths Uniswap's subgraph runs, just done in-browser.
 */
export const STATE_VIEW_ABI = [
  {
    type: "function",
    name: "getSlot0",
    stateMutability: "view",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "protocolFee", type: "uint24" },
      { name: "lpFee", type: "uint24" },
    ],
  },
  {
    type: "function",
    name: "getFeeGrowthGlobals",
    stateMutability: "view",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [
      { name: "feeGrowthGlobal0X128", type: "uint256" },
      { name: "feeGrowthGlobal1X128", type: "uint256" },
    ],
  },
] as const;
