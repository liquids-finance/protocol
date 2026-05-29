import type { Address, Hex } from "viem";
import { concat, encodeAbiParameters, toHex } from "viem";

import type { PoolKey } from "@/lib/abi/poolKey";
import {
  V4_SETTLE_ALL,
  V4_SWAP_EXACT_IN_SINGLE,
  V4_TAKE_ALL,
} from "@/lib/abi/universalRouter";
import type { PermitSingleMessage } from "@/lib/permit2/sign";

/**
 * Tuple component layout for `PoolKey` — duplicated here so the swap-specific
 * encoder doesn't import from the read ABI (and so callers can see the shape
 * they're constructing).
 */
const POOL_KEY_COMPONENTS = [
  { name: "currency0", type: "address" },
  { name: "currency1", type: "address" },
  { name: "fee", type: "uint24" },
  { name: "tickSpacing", type: "int24" },
  { name: "hooks", type: "address" },
] as const;

/**
 * Build the single `inputs[0]` payload for a Universal Router V4_SWAP command
 * representing a single-hop exact-input swap.
 *
 *  actions = [SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL]
 *
 * Each action's matching params:
 *  - SWAP_EXACT_IN_SINGLE: (PoolKey, zeroForOne, amountIn, amountOutMin, hookData)
 *  - SETTLE_ALL: (currencyIn, maxAmountIn)        — UR pays the pool the input
 *  - TAKE_ALL:   (currencyOut, minAmountOut)      — UR forwards output to msg.sender
 */
export function encodeExactInputSingle(args: {
  poolKey: PoolKey;
  zeroForOne: boolean;
  amountIn: bigint;
  amountOutMin: bigint;
}): Hex {
  const actions = concat([
    toHex(V4_SWAP_EXACT_IN_SINGLE, { size: 1 }),
    toHex(V4_SETTLE_ALL, { size: 1 }),
    toHex(V4_TAKE_ALL, { size: 1 }),
  ]);

  // `minHopPriceX36` is a per-hop slippage guard added in v4-periphery — 0
  // disables it (we already cap with `amountOutMinimum` via TAKE_ALL). Missing
  // this field was the actual cause of past UR.execute reverts because the
  // struct layout has SIX fields, not five.
  const swapParam = encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          { name: "poolKey", type: "tuple", components: POOL_KEY_COMPONENTS },
          { name: "zeroForOne", type: "bool" },
          { name: "amountIn", type: "uint128" },
          { name: "amountOutMinimum", type: "uint128" },
          { name: "minHopPriceX36", type: "uint256" },
          { name: "hookData", type: "bytes" },
        ],
      },
    ],
    [
      {
        poolKey: args.poolKey,
        zeroForOne: args.zeroForOne,
        amountIn: args.amountIn,
        amountOutMinimum: args.amountOutMin,
        minHopPriceX36: 0n,
        hookData: "0x" as Hex,
      },
    ]
  );

  const inputCurrency: Address = args.zeroForOne ? args.poolKey.currency0 : args.poolKey.currency1;
  const outputCurrency: Address = args.zeroForOne ? args.poolKey.currency1 : args.poolKey.currency0;

  const settleParam = encodeAbiParameters(
    [
      { name: "currency", type: "address" },
      { name: "maxAmount", type: "uint256" },
    ],
    [inputCurrency, args.amountIn]
  );

  const takeParam = encodeAbiParameters(
    [
      { name: "currency", type: "address" },
      { name: "minAmount", type: "uint256" },
    ],
    [outputCurrency, args.amountOutMin]
  );

  return encodeAbiParameters(
    [
      { name: "actions", type: "bytes" },
      { name: "params", type: "bytes[]" },
    ],
    [actions, [swapParam, settleParam, takeParam]]
  );
}

/**
 * Build `inputs[0]` for a UR `PERMIT2_PERMIT` command (0x0a) — an
 * abi-encoded `(PermitSingle, bytes signature)` tuple. UR decodes this and
 * calls `Permit2.permit(msg.sender, permitSingle, signature)` which sets the
 * AllowanceTransfer allowance the V4 swap then consumes.
 */
export function encodePermit2Permit(permit: PermitSingleMessage, signature: Hex): Hex {
  return encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          {
            name: "details",
            type: "tuple",
            components: [
              { name: "token", type: "address" },
              { name: "amount", type: "uint160" },
              { name: "expiration", type: "uint48" },
              { name: "nonce", type: "uint48" },
            ],
          },
          { name: "spender", type: "address" },
          { name: "sigDeadline", type: "uint256" },
        ],
      },
      { name: "signature", type: "bytes" },
    ],
    [permit, signature]
  );
}
