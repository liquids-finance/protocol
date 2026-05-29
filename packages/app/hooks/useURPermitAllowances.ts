"use client";

import { useAccount, useReadContracts } from "wagmi";

import { PERMIT2_ABI } from "@/lib/abi/permit2";
import { CONTRACTS, DEMO_POOL } from "@/lib/contracts";

/**
 * Permit2's AllowanceTransfer allowance from the user to the Universal
 * Router, read for both USDT0 and xETH. We use the `nonce` to build fresh
 * PermitSingle signatures and the `amount/expiration` to decide whether a
 * new permit is needed at all (when the previous one still has headroom).
 */
export interface URPermitAllowance {
  amount: bigint;
  expiration: number;
  nonce: number;
}

export interface URPermitAllowances {
  usdt0: URPermitAllowance;
  xeth: URPermitAllowance;
}

export function useURPermitAllowances(): {
  allowances: URPermitAllowances | null;
  refetch: () => void;
} {
  const { address } = useAccount();

  const { data, refetch } = useReadContracts({
    contracts: address
      ? [
          {
            address: CONTRACTS.permit2,
            abi: PERMIT2_ABI,
            functionName: "allowance",
            args: [address, DEMO_POOL.currency0, CONTRACTS.universalRouter],
          },
          {
            address: CONTRACTS.permit2,
            abi: PERMIT2_ABI,
            functionName: "allowance",
            args: [address, DEMO_POOL.currency1, CONTRACTS.universalRouter],
          },
        ]
      : [],
    query: {
      enabled: Boolean(address),
      refetchInterval: 12_000,
    },
  });

  if (!address || !data || data.length < 2 || data.some((r) => r.status !== "success")) {
    return { allowances: null, refetch };
  }

  // viem types uint48 returns as numbers, uint160 as bigint.
  const u = data[0]!.result as readonly [bigint, number, number];
  const x = data[1]!.result as readonly [bigint, number, number];

  return {
    allowances: {
      usdt0: { amount: u[0], expiration: u[1], nonce: u[2] },
      xeth: { amount: x[0], expiration: x[1], nonce: x[2] },
    },
    refetch,
  };
}
