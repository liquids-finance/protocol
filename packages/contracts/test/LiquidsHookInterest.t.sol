// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {TestSetup} from "./utils/TestSetup.sol";
import {LiquidsHookDemo} from "../src/LiquidsHook.sol";

/// @notice Interest accrual: borrowIndex grows over time, accruals are idempotent within a block,
/// and higher utilization produces higher rate.
contract LiquidsHookInterestTest is TestSetup {
    function test_Accrual_TimeAdvances_BorrowIndexGrows() public {
        (uint256 a0, uint256 a1) = _equalValueAmounts();
        vm.prank(alice);
        hook.supply(poolKey, a0, a1, 0);

        uint256 borrowAmount = 1_000 * 10 ** usdtLike().decimals();
        vm.prank(alice);
        hook.borrow(poolKey, borrowAmount, 0);

        (,,, uint256 indexBefore) = hook.vaults(poolId);
        assertEq(indexBefore, lens.WAD(), "borrowIndex should still be WAD at start");

        uint256 debtBefore = lens.debtOf(poolKey, alice);

        // Jump 1 year forward, then bump oracles so they're not flagged as stale.
        vm.warp(block.timestamp + 365 days);
        ethOracle().setPrice(int256(INITIAL_ETH_USD));
        usdtOracle().setPrice(int256(INITIAL_USDT_USD));

        // Trigger an accrue by reading something through a non-view interaction.
        // The simplest: another tiny supply by bob hits _accrueInterest at the start.
        (uint256 b0, uint256 b1) = _equalValueAmounts();
        vm.prank(bob);
        hook.supply(poolKey, b0, b1, 0);

        (,,, uint256 indexAfter) = hook.vaults(poolId);
        uint256 debtAfter = lens.debtOf(poolKey, alice);

        assertGt(indexAfter, indexBefore, "borrowIndex did not grow after 1 year");
        assertGt(debtAfter, debtBefore, "debt did not grow after 1 year");
    }

    function test_Accrual_Idempotent_NoCompoundingInOneBlock() public {
        (uint256 a0, uint256 a1) = _equalValueAmounts();
        vm.prank(alice);
        hook.supply(poolKey, a0, a1, 0);

        uint256 borrowAmount = 1_000 * 10 ** usdtLike().decimals();
        vm.prank(alice);
        hook.borrow(poolKey, borrowAmount, 0);

        // Advance time, then two accruing operations in the same block should not double-charge.
        vm.warp(block.timestamp + 100 days);
        ethOracle().setPrice(int256(INITIAL_ETH_USD));
        usdtOracle().setPrice(int256(INITIAL_USDT_USD));

        (uint256 b0, uint256 b1) = _equalValueAmounts();
        vm.prank(bob);
        hook.supply(poolKey, b0, b1, 0);
        (,,, uint256 indexFirst) = hook.vaults(poolId);

        // Second op in same block — elapsed=0, accrue should no-op.
        vm.prank(bob);
        hook.supply(poolKey, b0, b1, 0);
        (,,, uint256 indexSecond) = hook.vaults(poolId);

        assertEq(indexFirst, indexSecond, "second accrue in same block changed index");
    }

    function test_Accrual_BorrowAPYReflectsUtilization() public {
        (uint256 a0, uint256 a1) = _equalValueAmounts();
        vm.prank(alice);
        hook.supply(poolKey, a0, a1, 0);

        uint256 apyAtZeroU = lens.borrowAPY(poolKey);
        assertEq(apyAtZeroU, lens.BASE_RATE_WAD(), "no-borrow APY should equal BASE_RATE");

        // Borrow ~25% LTV → utilization climbs from 0.
        uint256 borrowAmount = 1_000 * 10 ** usdtLike().decimals();
        vm.prank(alice);
        hook.borrow(poolKey, borrowAmount, 0);

        uint256 apyWithDebt = lens.borrowAPY(poolKey);
        assertGt(apyWithDebt, apyAtZeroU, "APY should rise with utilization");
    }

    function test_Accrual_LendingAPYIsBorrowAPYTimesU() public {
        (uint256 a0, uint256 a1) = _equalValueAmounts();
        vm.prank(alice);
        hook.supply(poolKey, a0, a1, 0);

        uint256 borrowAmount = 1_500 * 10 ** usdtLike().decimals();
        vm.prank(alice);
        hook.borrow(poolKey, borrowAmount, 0);

        uint256 bAPY = lens.borrowAPY(poolKey);
        uint256 lAPY = lens.lendingAPY(poolKey);
        uint256 u = lens.utilization(poolKey);

        // lendingAPY = borrowAPY * u / WAD (reserveFactor = 0).
        uint256 expected = (bAPY * u) / lens.WAD();
        assertEq(lAPY, expected, "lendingAPY != borrowAPY * U");
    }
}
