"use client";

import { useAccount, useSwitchChain } from "wagmi";

import { xLayer } from "@/lib/chains";

/**
 * Wrong-network full-width banner. Shown when the connected chain is anything
 * other than X Layer (chain id 196). The Switch button calls wagmi's
 * `switchChain` so the user can hop without leaving the app.
 */
export function NetworkBanner() {
  const { isConnected, chainId } = useAccount();
  const { switchChain } = useSwitchChain();

  if (!isConnected || chainId === xLayer.id) return null;

  return (
    <div className="net-banner">
      <div className="net-banner-inner">
        <strong>Wrong network detected.</strong>
        <span>Liquids.finance runs on X Layer (chainID {xLayer.id}). Switch to continue.</span>
        <button
          className="btn btn-primary"
          onClick={() => switchChain({ chainId: xLayer.id })}
          type="button"
        >
          Switch to X Layer →
        </button>
      </div>
    </div>
  );
}
