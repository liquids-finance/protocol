// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {TestSetup} from "./utils/TestSetup.sol";
import {LiquidsHookDemo} from "../src/LiquidsHook.sol";
import {LiquidsDemoShareToken} from "../src/LiquidsShareToken.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Share token transfer guard, pause / circuit-breaker, and admin access control.
contract LiquidsHookGuardsTest is TestSetup {
    // ============================================================
    // Transfer guard
    // ============================================================

    function test_Transfer_NoDebt_Succeeds() public {
        (uint256 a0, uint256 a1) = _equalValueAmounts();
        vm.prank(alice);
        uint256 aliceShares = hook.supply(poolKey, a0, a1, 0);

        // Alice has no debt → can move shares freely.
        vm.prank(alice);
        shareToken.transfer(bob, aliceShares / 2);

        assertEq(shareToken.balanceOf(alice), aliceShares - aliceShares / 2, "alice balance mismatch");
        assertEq(shareToken.balanceOf(bob), aliceShares / 2, "bob did not receive");
    }

    function test_Transfer_WithOpenDebt_Reverts() public {
        (uint256 a0, uint256 a1) = _equalValueAmounts();
        vm.prank(alice);
        uint256 aliceShares = hook.supply(poolKey, a0, a1, 0);

        uint256 borrowAmount = 1_000 * 10 ** usdtLike().decimals();
        vm.prank(alice);
        hook.borrow(poolKey, borrowAmount, 0);

        vm.prank(alice);
        vm.expectRevert(LiquidsDemoShareToken.TransferLocked.selector);
        shareToken.transfer(bob, aliceShares / 2);
    }

    function test_Transfer_AfterFullRepay_Succeeds() public {
        (uint256 a0, uint256 a1) = _equalValueAmounts();
        vm.prank(alice);
        uint256 aliceShares = hook.supply(poolKey, a0, a1, 0);

        uint256 borrowAmount = 1_000 * 10 ** usdtLike().decimals();
        vm.prank(alice);
        hook.borrow(poolKey, borrowAmount, 0);

        // Fully repay (use a generous repay budget; repay caps at current debt).
        uint256 budget = 2_000 * 10 ** usdtLike().decimals();
        vm.prank(alice);
        hook.repay(poolKey, budget);

        assertEq(lens.debtOf(poolKey, alice), 0, "debt not fully cleared");

        // Transfer should now succeed.
        vm.prank(alice);
        shareToken.transfer(bob, aliceShares / 4);
        assertEq(shareToken.balanceOf(bob), aliceShares / 4, "transfer post-repay failed");
    }

    function test_Transfer_FromNonDebtor_Succeeds() public {
        // bob has shares but no debt, alice has shares + debt. Bob's transfers should still work.
        (uint256 a0, uint256 a1) = _equalValueAmounts();
        vm.prank(bob);
        uint256 bobShares = hook.supply(poolKey, a0, a1, 0);
        vm.prank(alice);
        hook.supply(poolKey, a0, a1, 0);

        uint256 borrowAmount = 1_000 * 10 ** usdtLike().decimals();
        vm.prank(alice);
        hook.borrow(poolKey, borrowAmount, 0);

        // Bob has no debt — should still be able to transfer.
        vm.prank(bob);
        shareToken.transfer(liquidator, bobShares / 2);

        assertEq(shareToken.balanceOf(liquidator), bobShares / 2, "non-debtor transfer failed");
    }

    // ============================================================
    // Pause (circuit breaker)
    // ============================================================

    function test_Pause_BlocksSupply() public {
        hook.pause();

        (uint256 a0, uint256 a1) = _equalValueAmounts();
        vm.prank(alice);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        hook.supply(poolKey, a0, a1, 0);
    }

    function test_Pause_BlocksBorrow() public {
        // Supply first while unpaused.
        (uint256 a0, uint256 a1) = _equalValueAmounts();
        vm.prank(alice);
        hook.supply(poolKey, a0, a1, 0);

        hook.pause();

        uint256 borrowAmount = 1_000 * 10 ** usdtLike().decimals();
        vm.prank(alice);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        hook.borrow(poolKey, borrowAmount, 0);
    }

    function test_Pause_AllowsWithdraw() public {
        (uint256 a0, uint256 a1) = _equalValueAmounts();
        vm.prank(alice);
        uint256 aliceShares = hook.supply(poolKey, a0, a1, 0);

        hook.pause();

        vm.prank(alice);
        (uint256 out0, uint256 out1) = hook.withdraw(poolKey, aliceShares, 0, 0);
        assertGt(out0 + out1, 0, "no exit while paused");
    }

    function test_Pause_AllowsRepay() public {
        (uint256 a0, uint256 a1) = _equalValueAmounts();
        vm.prank(alice);
        hook.supply(poolKey, a0, a1, 0);

        uint256 borrowAmount = 1_000 * 10 ** usdtLike().decimals();
        vm.prank(alice);
        hook.borrow(poolKey, borrowAmount, 0);

        hook.pause();

        uint256 budget = 2_000 * 10 ** usdtLike().decimals();
        vm.prank(alice);
        hook.repay(poolKey, budget);
        assertEq(lens.debtOf(poolKey, alice), 0, "repay blocked by pause");
    }

    function test_Pause_AllowsLiquidate() public {
        // Whale + alice setup so liquidation is reachable.
        uint256 bigEth = 10 * 10 ** ethLike().decimals();
        uint256 bigUsdt = 20_000 * 10 ** usdtLike().decimals();
        (uint256 b0, uint256 b1) = ethIsCurrency0 ? (bigEth, bigUsdt) : (bigUsdt, bigEth);
        vm.prank(bob);
        hook.supply(poolKey, b0, b1, 0);

        (uint256 a0, uint256 a1) = _equalValueAmounts();
        vm.prank(alice);
        hook.supply(poolKey, a0, a1, 0);

        uint256 borrowAmount = 2_000 * 10 ** usdtLike().decimals();
        vm.prank(alice);
        hook.borrow(poolKey, borrowAmount, 0);

        ethOracle().setPrice(int256(500 * 1e8));
        hook.pause();

        vm.prank(liquidator);
        (uint256 cleared,) = hook.liquidate(poolKey, alice);
        assertGt(cleared, 0, "liquidation blocked by pause");
    }

    function test_Pause_OnlyOwner() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        hook.pause();
    }

    function test_Unpause_OnlyOwner() public {
        hook.pause();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        hook.unpause();
    }

    function test_Unpause_RestoresOperations() public {
        hook.pause();
        hook.unpause();

        (uint256 a0, uint256 a1) = _equalValueAmounts();
        vm.prank(alice);
        uint256 shares = hook.supply(poolKey, a0, a1, 0);
        assertGt(shares, 0, "supply blocked after unpause");
    }
}
