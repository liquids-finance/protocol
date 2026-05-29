/**
 * Universal Router 2.1.1 — execute(commands, inputs, deadline).
 *
 * Commands is a packed-byte array where each byte selects a command (the
 * upper bits encode `allow_revert` flags). For a vanilla V4 swap we use a
 * single byte: `0x10` = V4_SWAP. The matching `inputs[0]` is the encoded
 * V4 action stream — see `lib/swap/encode.ts` for that wire format.
 */
export const UNIVERSAL_ROUTER_ABI = [
  {
    type: "function",
    name: "execute",
    stateMutability: "payable",
    inputs: [
      { name: "commands", type: "bytes" },
      { name: "inputs", type: "bytes[]" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

/** Single V4 swap command. */
export const UR_COMMAND_V4_SWAP = "0x10" as const;

/**
 * Two-command sequence: PERMIT2_PERMIT (0x0a) then V4_SWAP (0x10). UR runs
 * the permit first — calling Permit2.permit(owner, permitSingle, sig) to
 * set the allowance from a fresh user signature — then the swap consumes
 * that allowance via Permit2.transferFrom. Lets the whole flow finish in
 * one transaction after a single signature.
 */
export const UR_COMMAND_PERMIT_AND_V4_SWAP = "0x0a10" as const;

// V4 action codes (mirror of `v4-periphery/src/libraries/Actions.sol`).
export const V4_SWAP_EXACT_IN_SINGLE = 0x06;
export const V4_SETTLE_ALL = 0x0c;
export const V4_TAKE_ALL = 0x0f;
