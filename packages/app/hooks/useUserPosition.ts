"use client";

import { useAccount, useReadContracts } from "wagmi";

import { ERC20_ABI } from "@/lib/abi/erc20";
import { LENS_ABI } from "@/lib/abi/lens";
import { DEMO_POOL_KEY } from "@/lib/abi/poolKey";
import { CONTRACTS, DEMO_POOL } from "@/lib/contracts";

/**
 * Live read of the connected user's position in the demo market.
 *
 * Strategy:
 *   - shareBalance × shareValue gives supplied USD-WAD.
 *   - debtOf is the raw borrow-asset amount (USDT0 has 6 decimals).
 *   - healthFactor = collateralUSD × 1e18 / debtUSD — used both as the
 *     headline HF and to back-derive debtUSD without a second oracle read.
 *
 * Returns `null` until the wallet is connected AND data has resolved.
 */
export interface UserPosition {
  /** USD-WAD value of user's supplied LP collateral. */
  suppliedUsdWad: bigint;
  /** USD-WAD value of user's outstanding debt. */
  debtUsdWad: bigint;
  /** Raw borrow-asset amount of debt (decimals of DEMO_POOL.symbol0). */
  debtRaw: bigint;
  /** Health factor in WAD. `null` when user has no debt (HF = ∞). */
  hfWad: bigint | null;
}

const MAX_UINT256 = (1n << 256n) - 1n;

export function useUserPosition(): {
  position: UserPosition | null;
  isConnected: boolean;
  isLoading: boolean;
  isError: boolean;
} {
  const { address, isConnected } = useAccount();

  const { data, isLoading, isError } = useReadContracts({
    contracts: address
      ? [
          {
            address: DEMO_POOL.shareToken,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [address],
          },
          {
            address: CONTRACTS.lens,
            abi: LENS_ABI,
            functionName: "shareValue",
            args: [DEMO_POOL_KEY],
          },
          {
            address: CONTRACTS.lens,
            abi: LENS_ABI,
            functionName: "debtOf",
            args: [DEMO_POOL_KEY, address],
          },
          {
            address: CONTRACTS.lens,
            abi: LENS_ABI,
            functionName: "healthFactor",
            args: [DEMO_POOL_KEY, address],
          },
        ]
      : [],
    query: {
      enabled: Boolean(address),
      refetchInterval: 20_000,
    },
  });

  if (
    !address ||
    !data ||
    data.length < 4 ||
    data.some((r) => r.status !== "success")
  ) {
    return { position: null, isConnected, isLoading, isError };
  }

  const shareBalance = data[0]!.result as bigint;
  const shareValueWad = data[1]!.result as bigint;
  const debtRaw = data[2]!.result as bigint;
  const hfRaw = data[3]!.result as bigint;

  // shareValue is USD-WAD per WHOLE share (1e18 = 1 share). So:
  //   suppliedUsdWad = shareBalance(wei) × shareValue / 1e18
  const WAD = 10n ** 18n;
  const suppliedUsdWad = (shareBalance * shareValueWad) / WAD;

  // HF = collateralUSD × 1e18 / debtUSD  →  debtUSD = collateralUSD × 1e18 / HF.
  // Lens returns type(uint256).max when debt == 0; treat that as "no debt".
  const noDebt = hfRaw >= MAX_UINT256 / 2n || debtRaw === 0n;
  const debtUsdWad = noDebt ? 0n : (suppliedUsdWad * WAD) / hfRaw;
  const hfWad = noDebt ? null : hfRaw;

  return {
    position: { suppliedUsdWad, debtUsdWad, debtRaw, hfWad },
    isConnected,
    isLoading,
    isError,
  };
}
