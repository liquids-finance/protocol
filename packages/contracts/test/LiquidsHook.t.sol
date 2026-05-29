// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {TestSetup} from "./utils/TestSetup.sol";
import {LiquidsHookDemo} from "../src/LiquidsHook.sol";
import {PoolId} from "v4-core/types/PoolId.sol";

/// @notice Happy-path lifecycle tests for the Liquids hook over a freshly-deployed V4 PoolManager.
contract LiquidsHookTest is TestSetup {
    // ============================================================
    // createPool
    // ============================================================

    function test_CreatePool_DeploysShareTokenAndPoolState() public view {
        assertTrue(address(shareToken) != address(0), "share token not deployed");
        assertEq(shareToken.hook(), address(hook), "share token hook mismatch");
        assertEq(PoolId.unwrap(shareToken.poolId()), PoolId.unwrap(poolId), "share token poolId mismatch");
        assertEq(shareToken.totalSupply(), 0, "expected zero shares before any supply");

        // Vault state initialized: borrowIndex = 1e18, lastAccrualTime set.
        (uint128 totalLiq, uint64 lastAccrual, uint256 totalScaledDebt, uint256 borrowIndex) = hook.vaults(poolId);
        assertEq(totalLiq, 0, "totalLiquidity not 0 on fresh pool");
        assertGt(lastAccrual, 0, "lastAccrualTime not set");
        assertEq(totalScaledDebt, 0, "totalScaledDebt not 0 on fresh pool");
        assertEq(borrowIndex, lens.WAD(), "borrowIndex not initialized to WAD");
    }

    function test_CreatePool_RevertsOnDuplicate() public {
        // setUp already created the pool. Calling createPool again with same key should revert.
        vm.expectRevert(LiquidsHookDemo.PoolAlreadyRegistered.selector);
        hook.createPool(poolKey, 1, oracle0, oracle1, borrowCurrencyIndex);
    }

    // ============================================================
    // supply
    // ============================================================

    function test_Supply_FirstDepositor_MintsSharesAndDeadShares() public {
        (uint256 amount0, uint256 amount1) = _equalValueAmounts();

        uint256 aliceBefore0 = token0.balanceOf(alice);
        uint256 aliceBefore1 = token1.balanceOf(alice);

        vm.prank(alice);
        uint256 shares = hook.supply(poolKey, amount0, amount1, 0);

        // Alice received non-zero shares.
        assertGt(shares, 0, "alice received no shares");
        assertEq(shareToken.balanceOf(alice), shares, "alice share balance != minted");

        // Dead address holds the inflation-attack tribute.
        assertEq(
            shareToken.balanceOf(hook.DEAD_ADDRESS()), hook.MIN_LIQUIDITY_SHARES(), "MIN_LIQUIDITY_SHARES not minted"
        );

        // Hook tracks the new V4 liquidity.
        (uint128 totalLiq,,,) = hook.vaults(poolId);
        assertGt(totalLiq, 0, "vault liquidity not bumped");

        // Alice spent some of each token.
        assertLt(token0.balanceOf(alice), aliceBefore0, "no token0 consumed");
        assertLt(token1.balanceOf(alice), aliceBefore1, "no token1 consumed");
    }

    function test_Supply_SecondDepositor_GetsProportionalShares() public {
        (uint256 amount0, uint256 amount1) = _equalValueAmounts();

        vm.prank(alice);
        uint256 aliceShares = hook.supply(poolKey, amount0, amount1, 0);

        vm.prank(bob);
        uint256 bobShares = hook.supply(poolKey, amount0, amount1, 0);

        // Bob deposited the same value → near-identical shares (within 1% for first-deposit dust + rounding).
        assertApproxEqRel(bobShares, aliceShares, 1e16, "bob shares deviated from alice");
    }

    // ============================================================
    // borrow
    // ============================================================

    function test_Borrow_HappyPath_DeliversStableAndRecordsDebt() public {
        (uint256 amount0, uint256 amount1) = _equalValueAmounts();
        vm.prank(alice);
        hook.supply(poolKey, amount0, amount1, 0);

        uint256 borrowAmount = 1_000 * 10 ** usdtLike().decimals(); // $1k against ~$4k collateral
        uint256 stableBefore = usdtLike().balanceOf(alice);

        vm.prank(alice);
        uint256 actualBorrowed = hook.borrow(poolKey, borrowAmount, 0);

        assertGt(actualBorrowed, 0, "no borrow delivered");
        assertEq(usdtLike().balanceOf(alice) - stableBefore, actualBorrowed, "stable receipt mismatch");
        assertGt(lens.debtOf(poolKey, alice), 0, "debt not recorded");
    }

    function test_Borrow_LTVExceeded_Reverts() public {
        (uint256 amount0, uint256 amount1) = _equalValueAmounts();
        vm.prank(alice);
        hook.supply(poolKey, amount0, amount1, 0);

        // Try borrowing 75% of collateral USD value (above 60% cap).
        uint256 tooMuch = 3_000 * 10 ** usdtLike().decimals();

        vm.prank(alice);
        vm.expectRevert(LiquidsHookDemo.LTVExceeded.selector);
        hook.borrow(poolKey, tooMuch, 0);
    }

    // ============================================================
    // repay
    // ============================================================

    function test_Repay_ReducesDebt() public {
        (uint256 amount0, uint256 amount1) = _equalValueAmounts();
        vm.prank(alice);
        hook.supply(poolKey, amount0, amount1, 0);

        // Pre-compute borrow amount: evaluating it inline would consume the next vm.prank.
        uint256 borrowAmount = 1_000 * 10 ** usdtLike().decimals();
        vm.prank(alice);
        hook.borrow(poolKey, borrowAmount, 0);

        uint256 debtBefore = lens.debtOf(poolKey, alice);
        assertGt(debtBefore, 0, "no debt to repay");

        vm.prank(alice);
        hook.repay(poolKey, debtBefore / 2);

        uint256 debtAfter = lens.debtOf(poolKey, alice);
        assertLt(debtAfter, debtBefore, "debt not reduced");
    }

    // ============================================================
    // withdraw
    // ============================================================

    function test_Withdraw_BlockedByOpenDebt() public {
        (uint256 amount0, uint256 amount1) = _equalValueAmounts();
        vm.prank(alice);
        uint256 aliceShares = hook.supply(poolKey, amount0, amount1, 0);

        // Pre-compute: same prank-consumption footgun as elsewhere.
        uint256 borrowAmount = 1_000 * 10 ** usdtLike().decimals();
        vm.prank(alice);
        hook.borrow(poolKey, borrowAmount, 0);

        vm.prank(alice);
        vm.expectRevert(LiquidsHookDemo.DebtOutstanding.selector);
        hook.withdraw(poolKey, aliceShares, 0, 0);
    }

    function test_Withdraw_HappyPath_ReturnsBothTokens() public {
        (uint256 amount0, uint256 amount1) = _equalValueAmounts();
        vm.prank(alice);
        uint256 aliceShares = hook.supply(poolKey, amount0, amount1, 0);

        uint256 before0 = token0.balanceOf(alice);
        uint256 before1 = token1.balanceOf(alice);

        vm.prank(alice);
        (uint256 out0, uint256 out1) = hook.withdraw(poolKey, aliceShares, 0, 0);

        assertGt(out0, 0, "no token0 returned");
        assertGt(out1, 0, "no token1 returned");
        assertEq(token0.balanceOf(alice), before0 + out0, "token0 balance not credited");
        assertEq(token1.balanceOf(alice), before1 + out1, "token1 balance not credited");
        assertEq(shareToken.balanceOf(alice), 0, "alice still has shares after full withdraw");
    }
}
