// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {TestSetup} from "./utils/TestSetup.sol";
import {LiquidsHookDemo} from "../src/LiquidsHook.sol";
import {IPriceFeed} from "../src/interfaces/IPriceFeed.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";

/// @notice Input validation and revert-path coverage for every user-facing entry point.
contract LiquidsHookValidationTest is TestSetup {
    // ============================================================
    // createPool
    // ============================================================

    function test_CreatePool_ZeroOracle0_Reverts() public {
        PoolKey memory k = _freshKey();
        vm.expectRevert(LiquidsHookDemo.InvalidOracle.selector);
        hook.createPool(k, 1, IPriceFeed(address(0)), oracle1, borrowCurrencyIndex);
    }

    function test_CreatePool_ZeroOracle1_Reverts() public {
        PoolKey memory k = _freshKey();
        vm.expectRevert(LiquidsHookDemo.InvalidOracle.selector);
        hook.createPool(k, 1, oracle0, IPriceFeed(address(0)), borrowCurrencyIndex);
    }

    function test_CreatePool_InvalidBorrowCurrencyIndex_Reverts() public {
        PoolKey memory k = _freshKey();
        vm.expectRevert(LiquidsHookDemo.InvalidBorrowCurrencyIndex.selector);
        hook.createPool(k, 1, oracle0, oracle1, 2); // only 0 or 1 valid
    }

    function test_CreatePool_WrongHookAddress_Reverts() public {
        PoolKey memory k = _freshKey();
        k.hooks = IHooks(address(0xBEEF)); // someone else's hook
        vm.expectRevert(LiquidsHookDemo.InvalidPoolKey.selector);
        hook.createPool(k, 1, oracle0, oracle1, borrowCurrencyIndex);
    }

    // ============================================================
    // supply
    // ============================================================

    function test_Supply_BothAmountsZero_Reverts() public {
        vm.prank(alice);
        vm.expectRevert(LiquidsHookDemo.ZeroAmount.selector);
        hook.supply(poolKey, 0, 0, 0);
    }

    function test_Supply_UnregisteredPool_Reverts() public {
        PoolKey memory k = _freshKey();
        (uint256 a0, uint256 a1) = _equalValueAmounts();
        vm.prank(alice);
        vm.expectRevert(LiquidsHookDemo.PoolNotRegistered.selector);
        hook.supply(k, a0, a1, 0);
    }

    function test_Supply_MinSharesNotMet_Reverts() public {
        (uint256 a0, uint256 a1) = _equalValueAmounts();
        // Demand absurd minShares.
        vm.prank(alice);
        vm.expectRevert(LiquidsHookDemo.SlippageExceeded.selector);
        hook.supply(poolKey, a0, a1, type(uint256).max);
    }

    // ============================================================
    // borrow
    // ============================================================

    function test_Borrow_ZeroAmount_Reverts() public {
        vm.prank(alice);
        vm.expectRevert(LiquidsHookDemo.ZeroAmount.selector);
        hook.borrow(poolKey, 0, 0);
    }

    function test_Borrow_UnregisteredPool_Reverts() public {
        PoolKey memory k = _freshKey();
        vm.prank(alice);
        vm.expectRevert(LiquidsHookDemo.PoolNotRegistered.selector);
        hook.borrow(k, 1, 0);
    }

    function test_Borrow_NoCollateral_RevertsLTV() public {
        // Bob never supplied → 0 shares → LTV check fails (collateral=0, debt>0).
        vm.prank(bob);
        vm.expectRevert(LiquidsHookDemo.LTVExceeded.selector);
        hook.borrow(poolKey, 100, 0);
    }

    function test_Borrow_MinBorrowOutNotMet_Reverts() public {
        (uint256 a0, uint256 a1) = _equalValueAmounts();
        vm.prank(alice);
        hook.supply(poolKey, a0, a1, 0);

        uint256 borrowAmount = 100 * 10 ** usdtLike().decimals();
        vm.prank(alice);
        vm.expectRevert(LiquidsHookDemo.SlippageExceeded.selector);
        hook.borrow(poolKey, borrowAmount, type(uint256).max);
    }

    // ============================================================
    // repay
    // ============================================================

    function test_Repay_ZeroAmount_Reverts() public {
        vm.prank(alice);
        vm.expectRevert(LiquidsHookDemo.ZeroAmount.selector);
        hook.repay(poolKey, 0);
    }

    function test_Repay_UnregisteredPool_Reverts() public {
        PoolKey memory k = _freshKey();
        vm.prank(alice);
        vm.expectRevert(LiquidsHookDemo.PoolNotRegistered.selector);
        hook.repay(k, 1);
    }

    function test_Repay_NoDebt_Reverts() public {
        // alice has neither supplied nor borrowed.
        vm.prank(alice);
        vm.expectRevert(LiquidsHookDemo.ZeroAmount.selector);
        hook.repay(poolKey, 100);
    }

    // ============================================================
    // withdraw
    // ============================================================

    function test_Withdraw_ZeroShares_Reverts() public {
        vm.prank(alice);
        vm.expectRevert(LiquidsHookDemo.ZeroAmount.selector);
        hook.withdraw(poolKey, 0, 0, 0);
    }

    function test_Withdraw_UnregisteredPool_Reverts() public {
        PoolKey memory k = _freshKey();
        vm.prank(alice);
        vm.expectRevert(LiquidsHookDemo.PoolNotRegistered.selector);
        hook.withdraw(k, 1, 0, 0);
    }

    function test_Withdraw_SlippageMinOut_Reverts() public {
        (uint256 a0, uint256 a1) = _equalValueAmounts();
        vm.prank(alice);
        uint256 shares = hook.supply(poolKey, a0, a1, 0);

        vm.prank(alice);
        vm.expectRevert(LiquidsHookDemo.SlippageExceeded.selector);
        hook.withdraw(poolKey, shares, type(uint256).max, type(uint256).max);
    }

    // ============================================================
    // helper
    // ============================================================

    /// @dev A PoolKey that has the right hook address but a fresh fee tier — not registered.
    function _freshKey() internal view returns (PoolKey memory k) {
        k = poolKey;
        k.fee = poolKey.fee == 500 ? uint24(3000) : uint24(500); // flip fee → different poolId
    }
}
