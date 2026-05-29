// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {TestSetup} from "./utils/TestSetup.sol";
import {LiquidsHookDemo} from "../src/LiquidsHook.sol";
import {ISignatureTransfer} from "../src/interfaces/IPermit2.sol";

import {Currency} from "v4-core/types/Currency.sol";

import {MockERC20} from "./mocks/MockERC20.sol";
import {MockPermit2} from "./mocks/MockPermit2.sol";

/// @notice End-to-end coverage of {LiquidsHookDemo.supplyWithPermit2} and {repayWithPermit2}.
/// Uses MockPermit2 etched at the canonical address — signature verification is stubbed but the
/// `requestedAmount <= permitted.amount` invariant and deadline are enforced, so token-transfer
/// behaviour is faithful to mainnet Permit2 (only sig + nonce semantics are out of scope here).
contract LiquidsHookPermit2Test is TestSetup {
    // ============================================================
    // supplyWithPermit2
    // ============================================================

    function test_SupplyWithPermit2_HappyPath_PullsBothCurrenciesAndMintsShares() public {
        (uint256 amount0, uint256 amount1) = _equalValueAmounts();

        ISignatureTransfer.PermitBatchTransferFrom memory permit = _buildSupplyPermit(
            amount0,
            amount1,
            /* nonce */
            0,
            /* deadline */
            block.timestamp + 1 hours
        );

        uint256 alice0Before = token0.balanceOf(alice);
        uint256 alice1Before = token1.balanceOf(alice);

        vm.prank(alice);
        uint256 shares = hook.supplyWithPermit2(
            poolKey,
            amount0,
            amount1,
            /* minShares */
            0,
            permit,
            ""
        );

        assertGt(shares, 0, "alice received no shares");
        assertEq(shareToken.balanceOf(alice), shares, "share balance mismatch");
        assertLt(token0.balanceOf(alice), alice0Before, "no token0 pulled");
        assertLt(token1.balanceOf(alice), alice1Before, "no token1 pulled");
    }

    function test_SupplyWithPermit2_DeliversSameOutcomeAsClassicSupply() public {
        // Alice supplies via classic ERC20 approve + supply.
        (uint256 amount0, uint256 amount1) = _equalValueAmounts();
        vm.prank(alice);
        uint256 aliceShares = hook.supply(poolKey, amount0, amount1, 0);

        // Bob supplies an equal-value position via Permit2.
        ISignatureTransfer.PermitBatchTransferFrom memory permit =
            _buildSupplyPermit(amount0, amount1, 0, block.timestamp + 1 hours);
        vm.prank(bob);
        uint256 bobShares = hook.supplyWithPermit2(poolKey, amount0, amount1, 0, permit, "");

        // Permit2 path must produce equivalent share output (subject to first-deposit dust offset).
        assertApproxEqRel(bobShares, aliceShares, 1e16, "permit2 supply diverged from classic");
    }

    function test_SupplyWithPermit2_BatchLengthMismatch_Reverts() public {
        // Build a 1-element batch — should fail length check on hook.
        ISignatureTransfer.TokenPermissions[] memory permitted = new ISignatureTransfer.TokenPermissions[](1);
        permitted[0] = ISignatureTransfer.TokenPermissions({token: address(token0), amount: 1 ether});
        ISignatureTransfer.PermitBatchTransferFrom memory permit =
            ISignatureTransfer.PermitBatchTransferFrom({permitted: permitted, nonce: 0, deadline: block.timestamp + 1});

        vm.prank(alice);
        vm.expectRevert(LiquidsHookDemo.InvalidPermit2.selector);
        hook.supplyWithPermit2(poolKey, 1 ether, 0, 0, permit, "");
    }

    function test_SupplyWithPermit2_Token0Mismatch_Reverts() public {
        (uint256 amount0, uint256 amount1) = _equalValueAmounts();
        // Swap token0's slot to a foreign token address.
        MockERC20 stranger = new MockERC20("STR", "STR", 18);

        ISignatureTransfer.TokenPermissions[] memory permitted = new ISignatureTransfer.TokenPermissions[](2);
        permitted[0] = ISignatureTransfer.TokenPermissions({token: address(stranger), amount: amount0});
        permitted[1] = ISignatureTransfer.TokenPermissions({token: address(token1), amount: amount1});
        ISignatureTransfer.PermitBatchTransferFrom memory permit =
            ISignatureTransfer.PermitBatchTransferFrom({permitted: permitted, nonce: 0, deadline: block.timestamp + 1});

        vm.prank(alice);
        vm.expectRevert(LiquidsHookDemo.InvalidPermit2.selector);
        hook.supplyWithPermit2(poolKey, amount0, amount1, 0, permit, "");
    }

    function test_SupplyWithPermit2_Token1Mismatch_Reverts() public {
        (uint256 amount0, uint256 amount1) = _equalValueAmounts();
        MockERC20 stranger = new MockERC20("STR", "STR", 18);

        ISignatureTransfer.TokenPermissions[] memory permitted = new ISignatureTransfer.TokenPermissions[](2);
        permitted[0] = ISignatureTransfer.TokenPermissions({token: address(token0), amount: amount0});
        permitted[1] = ISignatureTransfer.TokenPermissions({token: address(stranger), amount: amount1});
        ISignatureTransfer.PermitBatchTransferFrom memory permit =
            ISignatureTransfer.PermitBatchTransferFrom({permitted: permitted, nonce: 0, deadline: block.timestamp + 1});

        vm.prank(alice);
        vm.expectRevert(LiquidsHookDemo.InvalidPermit2.selector);
        hook.supplyWithPermit2(poolKey, amount0, amount1, 0, permit, "");
    }

    function test_SupplyWithPermit2_AmountOverPermitted_RevertsInPermit2() public {
        (uint256 amount0, uint256 amount1) = _equalValueAmounts();

        // Sign for half but ask hook to pull the full amount via amountXDesired — Permit2 enforces
        // requestedAmount <= permitted.amount, so MockPermit2 should reject before any transfer.
        ISignatureTransfer.PermitBatchTransferFrom memory permit =
            _buildSupplyPermit(amount0 / 2, amount1 / 2, 0, block.timestamp + 1 hours);

        vm.prank(alice);
        vm.expectRevert(MockPermit2.MockPermit2_AmountExceedsPermitted.selector);
        hook.supplyWithPermit2(poolKey, amount0, amount1, 0, permit, "");
    }

    function test_SupplyWithPermit2_DeadlineExpired_RevertsInPermit2() public {
        (uint256 amount0, uint256 amount1) = _equalValueAmounts();
        vm.warp(block.timestamp + 10);
        ISignatureTransfer.PermitBatchTransferFrom memory permit = _buildSupplyPermit(
            amount0,
            amount1,
            0,
            /* already expired */
            block.timestamp - 1
        );

        vm.prank(alice);
        vm.expectRevert(MockPermit2.MockPermit2_DeadlineExpired.selector);
        hook.supplyWithPermit2(poolKey, amount0, amount1, 0, permit, "");
    }

    // ============================================================
    // repayWithPermit2
    // ============================================================

    function test_RepayWithPermit2_HappyPath_ClearsHalfDebt() public {
        // Alice supplies + borrows the classic way first.
        (uint256 a0, uint256 a1) = _equalValueAmounts();
        vm.prank(alice);
        hook.supply(poolKey, a0, a1, 0);

        uint256 borrowAmount = 1_000 * 10 ** usdtLike().decimals();
        vm.prank(alice);
        hook.borrow(poolKey, borrowAmount, 0);

        uint256 debtBefore = lens.debtOf(poolKey, alice);
        uint256 half = debtBefore / 2;

        ISignatureTransfer.PermitTransferFrom memory permit = _buildRepayPermit(
            half,
            /* nonce */
            1,
            block.timestamp + 1 hours
        );

        vm.prank(alice);
        hook.repayWithPermit2(poolKey, half, permit, "");

        uint256 debtAfter = lens.debtOf(poolKey, alice);
        assertLt(debtAfter, debtBefore, "debt not reduced");
    }

    function test_RepayWithPermit2_WrongToken_Reverts() public {
        (uint256 a0, uint256 a1) = _equalValueAmounts();
        vm.prank(alice);
        hook.supply(poolKey, a0, a1, 0);
        uint256 borrowAmount = 1_000 * 10 ** usdtLike().decimals();
        vm.prank(alice);
        hook.borrow(poolKey, borrowAmount, 0);

        // Sign a permit for the WRONG side (volatile instead of stable).
        ISignatureTransfer.PermitTransferFrom memory permit = ISignatureTransfer.PermitTransferFrom({
            permitted: ISignatureTransfer.TokenPermissions({token: address(ethLike()), amount: 100}),
            nonce: 1,
            deadline: block.timestamp + 1 hours
        });

        vm.prank(alice);
        vm.expectRevert(LiquidsHookDemo.InvalidPermit2.selector);
        hook.repayWithPermit2(poolKey, 100, permit, "");
    }

    function test_RepayWithPermit2_DeadlineExpired_RevertsInPermit2() public {
        (uint256 a0, uint256 a1) = _equalValueAmounts();
        vm.prank(alice);
        hook.supply(poolKey, a0, a1, 0);
        uint256 borrowAmount = 1_000 * 10 ** usdtLike().decimals();
        vm.prank(alice);
        hook.borrow(poolKey, borrowAmount, 0);

        ISignatureTransfer.PermitTransferFrom memory permit =
            _buildRepayPermit(borrowAmount / 2, 1, block.timestamp - 1);

        vm.prank(alice);
        vm.expectRevert(MockPermit2.MockPermit2_DeadlineExpired.selector);
        hook.repayWithPermit2(poolKey, borrowAmount / 2, permit, "");
    }

    function test_RepayWithPermit2_NoDebt_Reverts() public {
        // Alice has no debt — repay should hit the early ZeroAmount revert in _prepareRepay.
        ISignatureTransfer.PermitTransferFrom memory permit = _buildRepayPermit(1, 0, block.timestamp + 1 hours);

        vm.prank(alice);
        vm.expectRevert(LiquidsHookDemo.ZeroAmount.selector);
        hook.repayWithPermit2(poolKey, 1, permit, "");
    }

    // ============================================================
    // Helpers
    // ============================================================

    function _buildSupplyPermit(uint256 amount0, uint256 amount1, uint256 nonce, uint256 deadline)
        internal
        view
        returns (ISignatureTransfer.PermitBatchTransferFrom memory)
    {
        ISignatureTransfer.TokenPermissions[] memory permitted = new ISignatureTransfer.TokenPermissions[](2);
        permitted[0] = ISignatureTransfer.TokenPermissions({token: address(token0), amount: amount0});
        permitted[1] = ISignatureTransfer.TokenPermissions({token: address(token1), amount: amount1});
        return ISignatureTransfer.PermitBatchTransferFrom({permitted: permitted, nonce: nonce, deadline: deadline});
    }

    function _buildRepayPermit(uint256 amount, uint256 nonce, uint256 deadline)
        internal
        view
        returns (ISignatureTransfer.PermitTransferFrom memory)
    {
        return ISignatureTransfer.PermitTransferFrom({
            permitted: ISignatureTransfer.TokenPermissions({token: address(usdtLike()), amount: amount}),
            nonce: nonce,
            deadline: deadline
        });
    }
}
