// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Minimal subset of Uniswap's Permit2 (`SignatureTransfer`) used by the hook for
/// gasless approvals on supply and repay. The canonical Permit2 contract lives at
/// 0x000000000022D473030F116dDEE9F6B43aC78BA3 on every EVM chain (including X Layer).
///
/// Only the structs and the two `permitTransferFrom` overloads we actually call are declared;
/// the full Permit2 ABI is much larger and we don't need the rest.
///
/// Reference: https://github.com/Uniswap/permit2/blob/main/src/interfaces/ISignatureTransfer.sol
interface ISignatureTransfer {
    /// @dev Single-token permission. `amount` is the maximum the spender may transfer.
    struct TokenPermissions {
        address token;
        uint256 amount;
    }

    /// @dev Single-token permit payload signed by the owner.
    struct PermitTransferFrom {
        TokenPermissions permitted;
        uint256 nonce;
        uint256 deadline;
    }

    /// @dev Multi-token permit payload signed by the owner.
    struct PermitBatchTransferFrom {
        TokenPermissions[] permitted;
        uint256 nonce;
        uint256 deadline;
    }

    /// @dev Per-token transfer detail. `requestedAmount` must be ≤ the permitted amount.
    struct SignatureTransferDetails {
        address to;
        uint256 requestedAmount;
    }

    /// @notice Transfer a single token from `owner` using a signed permit.
    function permitTransferFrom(
        PermitTransferFrom calldata permit,
        SignatureTransferDetails calldata transferDetails,
        address owner,
        bytes calldata signature
    ) external;

    /// @notice Transfer multiple tokens from `owner` in one call using a signed batch permit.
    function permitTransferFrom(
        PermitBatchTransferFrom calldata permit,
        SignatureTransferDetails[] calldata transferDetails,
        address owner,
        bytes calldata signature
    ) external;
}
