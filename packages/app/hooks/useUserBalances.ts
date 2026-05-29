"use client";

import { useAccount, useReadContracts } from "wagmi";

import { ERC20_ABI } from "@/lib/abi/erc20";
import { CONTRACTS, DEMO_POOL } from "@/lib/contracts";

/**
 * Single multicall for everything the action panels need:
 *   - USDT0 / xETH balances
 *   - USDT0 / xETH ERC20 allowance to Permit2 — the one-time max approval
 *     that unlocks every signed Permit2 flow (supply, repay, swap)
 *   - LP share balance
 *
 * Returns `null` until the wallet is connected and the multicall resolves.
 * Polled every 12s so a recent supply / approval refreshes the UI without a
 * manual reload — write hooks also call `refetch()` after confirm.
 */
export interface UserBalances {
  usdt0Balance: bigint;
  /** ERC20 allowance from user → Permit2. Once this is large enough we never
   *  ask for it again — Permit2 then pulls funds via signatures. */
  usdt0PermitAllowance: bigint;
  xethBalance: bigint;
  xethPermitAllowance: bigint;
  shareBalance: bigint;
}

export function useUserBalances(): {
  balances: UserBalances | null;
  refetch: () => void;
  isLoading: boolean;
} {
  const { address } = useAccount();

  const { data, isLoading, refetch } = useReadContracts({
    contracts: address
      ? [
          { address: DEMO_POOL.currency0, abi: ERC20_ABI, functionName: "balanceOf", args: [address] },
          {
            address: DEMO_POOL.currency0,
            abi: ERC20_ABI,
            functionName: "allowance",
            args: [address, CONTRACTS.permit2],
          },
          { address: DEMO_POOL.currency1, abi: ERC20_ABI, functionName: "balanceOf", args: [address] },
          {
            address: DEMO_POOL.currency1,
            abi: ERC20_ABI,
            functionName: "allowance",
            args: [address, CONTRACTS.permit2],
          },
          { address: DEMO_POOL.shareToken, abi: ERC20_ABI, functionName: "balanceOf", args: [address] },
        ]
      : [],
    query: {
      enabled: Boolean(address),
      refetchInterval: 12_000,
    },
  });

  if (!address || !data || data.length < 5 || data.some((r) => r.status !== "success")) {
    return { balances: null, refetch, isLoading };
  }

  return {
    balances: {
      usdt0Balance: data[0]!.result as bigint,
      usdt0PermitAllowance: data[1]!.result as bigint,
      xethBalance: data[2]!.result as bigint,
      xethPermitAllowance: data[3]!.result as bigint,
      shareBalance: data[4]!.result as bigint,
    },
    refetch,
    isLoading,
  };
}
