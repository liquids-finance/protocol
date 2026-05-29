import type { Address } from "viem";

import { CONTRACTS, DEMO_POOL } from "@/lib/contracts";

/**
 * Uniswap V4 PoolKey shape. Currency is just `address` on the wire; we keep
 * the original type names in the ABI tuple so it lines up cleanly with the
 * Solidity signature when passed as a single struct argument.
 */
export interface PoolKey {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
}

/** ABI tuple fragment for a PoolKey argument. Reused across Lens reads. */
export const POOL_KEY_TUPLE = {
  type: "tuple",
  components: [
    { name: "currency0", type: "address" },
    { name: "currency1", type: "address" },
    { name: "fee", type: "uint24" },
    { name: "tickSpacing", type: "int24" },
    { name: "hooks", type: "address" },
  ],
} as const;

/** PoolKey for the deployed demo market on X Layer. */
export const DEMO_POOL_KEY: PoolKey = {
  currency0: DEMO_POOL.currency0,
  currency1: DEMO_POOL.currency1,
  fee: DEMO_POOL.fee,
  tickSpacing: DEMO_POOL.tickSpacing,
  hooks: CONTRACTS.hook,
};
