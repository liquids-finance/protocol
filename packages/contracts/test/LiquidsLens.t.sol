// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {TestSetup} from "./utils/TestSetup.sol";
import {LiquidsHookDemo} from "../src/LiquidsHook.sol";
import {LiquidsLensDemo} from "../src/LiquidsLens.sol";

/// @notice Targets the {LiquidsLensDemo}'s projected-accrual behavior. The hook's stored
/// `borrowIndex` only refreshes on write ops; the lens projects it forward to `block.timestamp`
/// so UIs see live debt growth even between writes. Tests verify:
///   1. projected ≥ stored at all times,
///   2. projected matches what the hook *would* record after the next write,
///   3. raw views match the hook's pre-Lens behaviour 1:1,
///   4. wired constants equal the hook's.
contract LiquidsLensTest is TestSetup {
    function test_Lens_Initial_StoredAndProjectedAreEqual() public view {
        // No time has passed since createPool → projection is a no-op.
        assertEq(lens.borrowIndex(poolKey), lens.projectedBorrowIndex(poolKey), "fresh pool projection != stored");
        assertEq(lens.borrowIndex(poolKey), lens.WAD(), "initial borrowIndex != WAD");
    }

    function test_Lens_DebtOf_ProjectsForwardWithoutWriteOp() public {
        // Supply + borrow to seed live debt.
        (uint256 a0, uint256 a1) = _equalValueAmounts();
        vm.prank(alice);
        hook.supply(poolKey, a0, a1, 0);
        uint256 borrowAmount = 1_500 * 10 ** usdtLike().decimals();
        vm.prank(alice);
        hook.borrow(poolKey, borrowAmount, 0);

        uint256 debtT0Projected = lens.debtOf(poolKey, alice);
        uint256 debtT0Raw = lens.debtOfRaw(poolKey, alice);
        assertEq(debtT0Projected, debtT0Raw, "projected != raw at t=0");

        // Advance time without triggering a write. Hook's borrowIndex stays put; lens should project.
        vm.warp(block.timestamp + 30 days);
        ethOracle().setPrice(int256(INITIAL_ETH_USD));
        usdtOracle().setPrice(int256(INITIAL_USDT_USD));

        uint256 debtRawAfter = lens.debtOfRaw(poolKey, alice);
        uint256 debtProjectedAfter = lens.debtOf(poolKey, alice);

        assertEq(debtRawAfter, debtT0Raw, "raw debt drifted without write op");
        assertGt(debtProjectedAfter, debtRawAfter, "projected did not grow");
    }

    function test_Lens_ProjectedMatchesPostWriteAccrual() public {
        // Setup positions.
        (uint256 a0, uint256 a1) = _equalValueAmounts();
        vm.prank(alice);
        hook.supply(poolKey, a0, a1, 0);
        uint256 borrowAmount = 1_000 * 10 ** usdtLike().decimals();
        vm.prank(alice);
        hook.borrow(poolKey, borrowAmount, 0);

        vm.warp(block.timestamp + 90 days);
        ethOracle().setPrice(int256(INITIAL_ETH_USD));
        usdtOracle().setPrice(int256(INITIAL_USDT_USD));

        // Snapshot lens projection.
        uint256 projectedIdx = lens.projectedBorrowIndex(poolKey);
        uint256 projectedDebt = lens.debtOf(poolKey, alice);

        // Trigger an accrue via a cheap write op (bob supplies).
        (uint256 b0, uint256 b1) = _equalValueAmounts();
        vm.prank(bob);
        hook.supply(poolKey, b0, b1, 0);

        // The hook's stored borrowIndex should now equal what the lens predicted (give or take
        // any rounding from order of ops — should be exact since math is deterministic).
        assertEq(lens.borrowIndex(poolKey), projectedIdx, "post-accrue borrowIndex != lens projection");
        // Alice's debt as the hook now records it should equal the lens's earlier projection.
        assertEq(lens.debtOfRaw(poolKey, alice), projectedDebt, "post-accrue debt != lens projection");
    }

    function test_Lens_HealthFactor_FallsAsInterestAccrues() public {
        (uint256 a0, uint256 a1) = _equalValueAmounts();
        vm.prank(alice);
        hook.supply(poolKey, a0, a1, 0);
        uint256 borrowAmount = 1_000 * 10 ** usdtLike().decimals();
        vm.prank(alice);
        hook.borrow(poolKey, borrowAmount, 0);

        uint256 hfBefore = lens.healthFactor(poolKey, alice);

        vm.warp(block.timestamp + 365 days);
        ethOracle().setPrice(int256(INITIAL_ETH_USD));
        usdtOracle().setPrice(int256(INITIAL_USDT_USD));

        uint256 hfAfter = lens.healthFactor(poolKey, alice);
        assertLt(hfAfter, hfBefore, "HF did not decay with accrued interest");
    }

    function test_Lens_BorrowAPY_ZeroDebtEqualsBaseRate() public {
        // Pool has shares but no debt → utilization 0 → APY = BASE_RATE.
        (uint256 a0, uint256 a1) = _equalValueAmounts();
        vm.prank(alice);
        hook.supply(poolKey, a0, a1, 0);

        assertEq(lens.borrowAPY(poolKey), lens.BASE_RATE_WAD(), "zero-U APY != BASE_RATE");
        assertEq(lens.utilization(poolKey), 0, "expected zero utilization");
        assertEq(lens.lendingAPY(poolKey), 0, "zero-U lending APY should be 0");
    }

    function test_Lens_LendingAPY_EqualsBorrowAPYTimesUtilization() public {
        (uint256 a0, uint256 a1) = _equalValueAmounts();
        vm.prank(alice);
        hook.supply(poolKey, a0, a1, 0);
        uint256 borrowAmount = 1_500 * 10 ** usdtLike().decimals();
        vm.prank(alice);
        hook.borrow(poolKey, borrowAmount, 0);

        uint256 bAPY = lens.borrowAPY(poolKey);
        uint256 u = lens.utilization(poolKey);
        uint256 expectedLend = (bAPY * u) / lens.WAD();
        assertEq(lens.lendingAPY(poolKey), expectedLend, "lending APY != borrow * U (reserveFactor=0)");
    }

    function test_Lens_TotalAssets_NonzeroAfterSupply() public {
        (uint256 a0, uint256 a1) = _equalValueAmounts();
        vm.prank(alice);
        hook.supply(poolKey, a0, a1, 0);
        assertGt(lens.totalAssets(poolKey), 0, "totalAssets zero after supply");
        assertGt(lens.shareValue(poolKey), 0, "shareValue zero after supply");
    }

    function test_Lens_HealthFactor_MaxForNoDebt() public {
        (uint256 a0, uint256 a1) = _equalValueAmounts();
        vm.prank(alice);
        hook.supply(poolKey, a0, a1, 0);

        // Alice has shares but no debt → HF should be max.
        assertEq(lens.healthFactor(poolKey, alice), type(uint256).max, "no-debt HF != max");
    }

    function test_Lens_Constants_MatchHook() public view {
        // These should remain equal in source — quick smoke test that someone hasn't drifted one side.
        // (Hook's internal constants are not externally readable, but we know the source values.)
        assertEq(lens.WAD(), 1e18, "WAD drifted");
        assertEq(lens.BASE_RATE_WAD(), 0.01e18, "BASE_RATE_WAD drifted");
        assertEq(lens.SLOPE1_WAD(), 0.06e18, "SLOPE1_WAD drifted");
        assertEq(lens.SLOPE2_WAD(), 1.0e18, "SLOPE2_WAD drifted");
        assertEq(lens.KINK_U_WAD(), 0.7e18, "KINK_U_WAD drifted");
        assertEq(lens.SECONDS_PER_YEAR(), 365 days, "SECONDS_PER_YEAR drifted");
        assertEq(lens.MAX_PRICE_STALENESS(), 26 hours, "MAX_PRICE_STALENESS drifted");
        assertEq(lens.BPS_DENOM(), 10_000, "BPS_DENOM drifted");
    }

    function test_Lens_HookReference_IsCorrect() public view {
        assertEq(address(lens.HOOK()), address(hook), "lens points to wrong hook");
    }
}
