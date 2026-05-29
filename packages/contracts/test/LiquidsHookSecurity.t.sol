// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {TestSetup} from "./utils/TestSetup.sol";
import {LiquidsHookDemo} from "../src/LiquidsHook.sol";
import {BaseHook} from "../src/base/BaseHook.sol";
import {PositionValue} from "../src/libraries/PositionValue.sol";
import {LiquidsDemoShareToken} from "../src/LiquidsShareToken.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {ModifyLiquidityParams, SwapParams} from "v4-core/types/PoolOperation.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {BeforeSwapDelta} from "v4-core/types/BeforeSwapDelta.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";

/// @notice Security-critical paths: hook callbacks rejecting non-PoolManager callers, direct V4
/// modifyLiquidity / initialize bypasses, share token mint/burn access control, oracle staleness.
contract LiquidsHookSecurityTest is TestSetup {
    // ============================================================
    // Hook callback access control
    // ============================================================

    function test_BeforeInitialize_OnlyPoolManager() public {
        vm.expectRevert(BaseHook.NotPoolManager.selector);
        hook.beforeInitialize(address(this), poolKey, 0);
    }

    function test_BeforeAddLiquidity_OnlyPoolManager() public {
        ModifyLiquidityParams memory p;
        vm.expectRevert(BaseHook.NotPoolManager.selector);
        hook.beforeAddLiquidity(address(this), poolKey, p, "");
    }

    function test_BeforeRemoveLiquidity_OnlyPoolManager() public {
        ModifyLiquidityParams memory p;
        vm.expectRevert(BaseHook.NotPoolManager.selector);
        hook.beforeRemoveLiquidity(address(this), poolKey, p, "");
    }

    function test_AfterSwap_OnlyPoolManager() public {
        SwapParams memory p;
        BalanceDelta d;
        vm.expectRevert(BaseHook.NotPoolManager.selector);
        hook.afterSwap(address(this), poolKey, p, d, "");
    }

    function test_UnlockCallback_OnlyPoolManager() public {
        vm.expectRevert(LiquidsHookDemo.OnlyPoolManager.selector);
        hook.unlockCallback("");
    }

    // ============================================================
    // Direct V4 bypass attempts (the "Cream-Finance-style" attack class)
    // ============================================================

    function test_DirectPoolManagerInitialize_Reverts() public {
        // Direct PoolManager.initialize for an unregistered pool key triggers our beforeInitialize,
        // which sees no config and reverts with PoolNotRegistered. Whole tx unwinds.
        PoolKey memory k = poolKey;
        k.fee = uint24(3000); // a different pool from the one createPool registered
        vm.expectRevert();
        poolManager.initialize(k, 1);
    }

    function test_DirectModifyLiquidity_AddIsBlockedByHook() public {
        // Anyone calling PoolManager.unlock and then modifyLiquidity for our pool gets blocked at
        // the hook's beforeAddLiquidity (sender != hook).
        // Wrap the attempt in an unlocker contract so we can call unlock from EOA-like context.
        DirectV4Attacker attacker = new DirectV4Attacker(address(poolManager));
        vm.expectRevert(); // hook rejects with DirectAddNotAllowed, bubbled through PoolManager
        attacker.attemptDirectAdd(poolKey);
    }

    function test_DirectModifyLiquidity_RemoveIsBlockedByHook() public {
        DirectV4Attacker attacker = new DirectV4Attacker(address(poolManager));
        vm.expectRevert();
        attacker.attemptDirectRemove(poolKey);
    }

    // ============================================================
    // Share token mint/burn gating
    // ============================================================

    function test_ShareToken_MintOnlyHook() public {
        vm.prank(alice);
        vm.expectRevert(LiquidsDemoShareToken.OnlyHook.selector);
        shareToken.mint(alice, 1e18);
    }

    function test_ShareToken_BurnOnlyHook() public {
        // Give alice some shares via supply, then she tries to burn herself — must fail.
        (uint256 a0, uint256 a1) = _equalValueAmounts();
        vm.prank(alice);
        hook.supply(poolKey, a0, a1, 0);

        vm.prank(alice);
        vm.expectRevert(LiquidsDemoShareToken.OnlyHook.selector);
        shareToken.burn(alice, 1);
    }

    // ============================================================
    // Oracle staleness
    // ============================================================

    function test_StalePrice_BlocksSupply() public {
        // Push block.timestamp 27h past oracle's lastUpdate (set in setUp) to exceed MAX_PRICE_STALENESS=26h.
        vm.warp(block.timestamp + 27 hours);

        (uint256 a0, uint256 a1) = _equalValueAmounts();
        vm.prank(alice);
        vm.expectRevert(PositionValue.StalePrice.selector);
        hook.supply(poolKey, a0, a1, 0);
    }

    function test_StalePrice_BlocksBorrow() public {
        (uint256 a0, uint256 a1) = _equalValueAmounts();
        vm.prank(alice);
        hook.supply(poolKey, a0, a1, 0);

        // Advance past staleness threshold. Oracle lastUpdate is from setUp, no refresh.
        vm.warp(block.timestamp + 27 hours);

        uint256 borrowAmount = 100 * 10 ** usdtLike().decimals();
        vm.prank(alice);
        vm.expectRevert(PositionValue.StalePrice.selector);
        hook.borrow(poolKey, borrowAmount, 0);
    }

    function test_InvalidPrice_NonPositive_Reverts() public {
        (uint256 a0, uint256 a1) = _equalValueAmounts();
        vm.prank(alice);
        hook.supply(poolKey, a0, a1, 0);

        ethOracle().setPrice(0);

        uint256 borrowAmount = 100 * 10 ** usdtLike().decimals();
        vm.prank(alice);
        vm.expectRevert(PositionValue.InvalidPrice.selector);
        hook.borrow(poolKey, borrowAmount, 0);
    }
}

/// @notice Helper for the "direct V4 modifyLiquidity bypass" scenarios. Becomes the unlocker so
/// PoolManager forwards modifyLiquidity → beforeAddLiquidity callback, which our hook rejects.
contract DirectV4Attacker {
    address public immutable manager;

    constructor(address _manager) {
        manager = _manager;
    }

    function attemptDirectAdd(PoolKey calldata key) external {
        // Trigger PoolManager.unlock which calls back into this contract's unlockCallback.
        // Inside, we'll call modifyLiquidity directly; hook should revert.
        (bool ok, bytes memory data) = manager.call(abi.encodeWithSignature("unlock(bytes)", abi.encode(uint8(0), key)));
        if (!ok) _bubble(data);
    }

    function attemptDirectRemove(PoolKey calldata key) external {
        (bool ok, bytes memory data) = manager.call(abi.encodeWithSignature("unlock(bytes)", abi.encode(uint8(1), key)));
        if (!ok) _bubble(data);
    }

    /// @notice PoolManager calls back here. We attempt the forbidden modifyLiquidity.
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        (uint8 action, PoolKey memory key) = abi.decode(data, (uint8, PoolKey));
        if (action == 0) {
            (bool ok, bytes memory ret) = manager.call(
                abi.encodeWithSignature(
                    "modifyLiquidity((address,address,uint24,int24,address),(int24,int24,int256,bytes32),bytes)",
                    key,
                    ModifyLiquidityParams({tickLower: -10, tickUpper: 10, liquidityDelta: 1, salt: bytes32(0)}),
                    ""
                )
            );
            if (!ok) _bubble(ret);
        } else {
            (bool ok, bytes memory ret) = manager.call(
                abi.encodeWithSignature(
                    "modifyLiquidity((address,address,uint24,int24,address),(int24,int24,int256,bytes32),bytes)",
                    key,
                    ModifyLiquidityParams({tickLower: -10, tickUpper: 10, liquidityDelta: -1, salt: bytes32(0)}),
                    ""
                )
            );
            if (!ok) _bubble(ret);
        }
        return "";
    }

    function _bubble(bytes memory data) private pure {
        assembly {
            revert(add(data, 32), mload(data))
        }
    }
}
