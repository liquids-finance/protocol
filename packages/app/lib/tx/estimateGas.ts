import type { Abi, Address, PublicClient } from "viem";

/**
 * Default safety margin on top of the simulated gas estimate. The hook
 * does projected interest accrual inside its `borrow` / `repay` paths,
 * and the V4 swap path has fee + sqrt-price branches that occasionally
 * land slightly above the estimate. 20% covers both without making fees
 * meaningfully more expensive (an empty block on X Layer is well under
 * a cent of OKB).
 */
const DEFAULT_BUFFER_BPS = 2000n; // +20 %

/**
 * Minimum gas floor for any contract call — even a pure refund / no-op
 * approval rounds up to ~30k after EIP-3529 refunds settle. Prevents a
 * tiny estimate from underbidding the actual on-chain cost.
 */
const MIN_GAS = 60_000n;

/**
 * Run `eth_estimateGas` against the contract call we're about to fire
 * and return a gas limit padded by `bufferBps` basis points (default
 * 20 %). Must be called from a connected-wallet code path — `account`
 * is required by the estimator so calls that depend on `msg.sender`
 * (allowances, debt projections, …) simulate against the real caller.
 *
 * Why we do this client-side instead of trusting the wallet:
 *
 *   Browser extension wallets (MetaMask, OKX extension, Rabby, etc.)
 *   run their own `eth_estimateGas` before signing when the tx request
 *   omits a `gas` field. **Mobile wallets reached over WalletConnect
 *   often don't** — they sign exactly the tx the dApp handed them, gas
 *   field and all. With no gas set, viem (`writeContract`) defers to
 *   the wallet; the wallet defers to "whatever you sent me"; the
 *   request goes out with `gas: 0` and the RPC returns
 *       intrinsic gas too low: gas 0, minimum needed 22728
 *
 * Pre-estimating on the dApp side means every tx — desktop OR mobile —
 * leaves the page with a correct `gas` already filled in, so a wallet
 * that doesn't auto-estimate still signs a valid request.
 */
export async function estimateGasWithBuffer(
  client: PublicClient,
  params: {
    address: Address;
    abi: Abi;
    functionName: string;
    args?: readonly unknown[];
    account: Address;
    value?: bigint;
  },
  bufferBps: bigint = DEFAULT_BUFFER_BPS
): Promise<bigint> {
  const estimated = await client.estimateContractGas(params as Parameters<PublicClient["estimateContractGas"]>[0]);
  const buffered = estimated + (estimated * bufferBps) / 10_000n;
  return buffered < MIN_GAS ? MIN_GAS : buffered;
}
