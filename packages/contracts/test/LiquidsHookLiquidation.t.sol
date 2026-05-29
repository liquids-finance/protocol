// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {TestSetup} from "./utils/TestSetup.sol";
import {LiquidsHookDemo} from "../src/LiquidsHook.sol";

/// @notice Liquidation scenarios: healthy / no debt / underwater triggers / finder fee accounting.
contract LiquidsHookLiquidationTest is TestSetup {
    function test_Liquidate_HealthyPosition_Reverts() public {
        // LTV ~25% with seed prices → HF well above threshold.
        (uint256 a0, uint256 a1) = _equalValueAmounts();
        vm.prank(alice);
        hook.supply(poolKey, a0, a1, 0);

        uint256 borrowAmount = 1_000 * 10 ** usdtLike().decimals();
        vm.prank(alice);
        hook.borrow(poolKey, borrowAmount, 0);

        vm.expectRevert(LiquidsHookDemo.PositionHealthy.selector);
        hook.liquidate(poolKey, alice);
    }

    function test_Liquidate_NoDebt_Reverts() public {
        (uint256 a0, uint256 a1) = _equalValueAmounts();
        vm.prank(alice);
        hook.supply(poolKey, a0, a1, 0);

        vm.expectRevert(LiquidsHookDemo.PositionHealthy.selector);
        hook.liquidate(poolKey, alice);
    }

    function test_Liquidate_Underwater_BurnsAndCancelsDebt() public {
        // bob is a whale LP (10x alice). This dilutes alice's self-collateralization (in a single-LP
        // vault the borrower's own debt receivable counts toward their collateral, making the position
        // self-protective). With a small-fraction borrower, a moderate price drop is enough to liquidate.
        _bobSuppliesWhale();

        // Alice deposits $4k and borrows ~$2k (near max LTV).
        (uint256 a0, uint256 a1) = _equalValueAmounts();
        vm.prank(alice);
        hook.supply(poolKey, a0, a1, 0);

        uint256 borrowAmount = 2_000 * 10 ** usdtLike().decimals();
        vm.prank(alice);
        hook.borrow(poolKey, borrowAmount, 0);

        // ETH crashes from $2000 → $500. Position fair value scales with sqrt(P), so V4 drops ~50%.
        ethOracle().setPrice(int256(500 * 1e8));

        uint256 finderBefore = shareToken.balanceOf(liquidator);
        uint256 aliceSharesBefore = shareToken.balanceOf(alice);
        uint256 debtBefore = lens.debtOf(poolKey, alice);

        vm.prank(liquidator);
        (uint256 debtCleared, uint256 finderFeeShares) = hook.liquidate(poolKey, alice);

        assertEq(debtCleared, debtBefore, "debtCleared mismatch");
        assertGt(finderFeeShares, 0, "no finder fee minted");
        assertEq(shareToken.balanceOf(liquidator) - finderBefore, finderFeeShares, "finder fee not received");
        assertLt(shareToken.balanceOf(alice), aliceSharesBefore, "borrower shares not reduced");
        assertEq(lens.debtOf(poolKey, alice), 0, "debt not zeroed");
    }

    function test_Liquidate_Underwater_RemainingLPsBenefit() public {
        // Same whale-vs-borrower split so liquidation can fire on a realistic crash.
        _bobSuppliesWhale();

        (uint256 a0, uint256 a1) = _equalValueAmounts();
        vm.prank(alice);
        hook.supply(poolKey, a0, a1, 0);

        uint256 borrowAmount = 2_000 * 10 ** usdtLike().decimals();
        vm.prank(alice);
        hook.borrow(poolKey, borrowAmount, 0);

        uint256 svBefore = lens.shareValue(poolKey);
        ethOracle().setPrice(int256(500 * 1e8));
        uint256 svAtTrigger = lens.shareValue(poolKey);

        vm.prank(liquidator);
        hook.liquidate(poolKey, alice);

        uint256 svAfter = lens.shareValue(poolKey);

        assertGt(svAfter, 0, "share value collapsed to zero");
        // With HF just below threshold, the buffer between collateral and debt flows to remaining LPs.
        // Post-liquidation shareValue should not be worse than the at-trigger snapshot.
        assertGe(svAfter, svAtTrigger, "remaining LPs were not made whole by burn+cancel");

        emit log_named_uint("shareValue before crash", svBefore);
        emit log_named_uint("shareValue at trigger ", svAtTrigger);
        emit log_named_uint("shareValue after liq  ", svAfter);
    }

    /// @dev Helper: bob supplies 10 ETH + 20_000 USDT (~$40k) so alice's later $4k deposit is a small fraction.
    function _bobSuppliesWhale() internal {
        uint256 bigEth = 10 * 10 ** ethLike().decimals();
        uint256 bigUsdt = 20_000 * 10 ** usdtLike().decimals();
        (uint256 b0, uint256 b1) = ethIsCurrency0 ? (bigEth, bigUsdt) : (bigUsdt, bigEth);
        vm.prank(bob);
        hook.supply(poolKey, b0, b1, 0);
    }
}
