// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {ISignatureTransfer} from "../../src/interfaces/IPermit2.sol";

/// @notice Test stand-in for Uniswap Permit2's SignatureTransfer surface.
/// @dev Skips EIP-712 signature verification and nonce bookkeeping; just forwards `transferFrom`
/// using the token approvals the owner has already granted to this contract. Enforces the
/// `requestedAmount <= permitted.amount` invariant the real Permit2 does, plus deadline check.
/// In TestSetup we etch this contract's runtime code at the canonical Permit2 address so any
/// production call from the hook (`PERMIT2.permitTransferFrom(...)`) lands here.
contract MockPermit2 is ISignatureTransfer {
    error MockPermit2_AmountExceedsPermitted();
    error MockPermit2_DeadlineExpired();
    error MockPermit2_LengthMismatch();

    /// @notice Single-token transfer.
    function permitTransferFrom(
        PermitTransferFrom calldata permit,
        SignatureTransferDetails calldata transferDetails,
        address owner,
        bytes calldata /* signature */
    ) external override {
        if (block.timestamp > permit.deadline) revert MockPermit2_DeadlineExpired();
        if (transferDetails.requestedAmount > permit.permitted.amount) revert MockPermit2_AmountExceedsPermitted();
        IERC20(permit.permitted.token).transferFrom(owner, transferDetails.to, transferDetails.requestedAmount);
    }

    /// @notice Batch transfer.
    function permitTransferFrom(
        PermitBatchTransferFrom calldata permit,
        SignatureTransferDetails[] calldata transferDetails,
        address owner,
        bytes calldata /* signature */
    ) external override {
        if (block.timestamp > permit.deadline) revert MockPermit2_DeadlineExpired();
        if (transferDetails.length != permit.permitted.length) revert MockPermit2_LengthMismatch();
        for (uint256 i = 0; i < permit.permitted.length; ++i) {
            if (transferDetails[i].requestedAmount > permit.permitted[i].amount) {
                revert MockPermit2_AmountExceedsPermitted();
            }
            IERC20(permit.permitted[i].token)
                .transferFrom(owner, transferDetails[i].to, transferDetails[i].requestedAmount);
        }
    }
}
