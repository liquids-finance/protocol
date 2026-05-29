// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

// V4
import {PoolManager} from "v4-core/PoolManager.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";

// Local
import {LiquidsHookDemo} from "../../src/LiquidsHook.sol";
import {LiquidsLensDemo} from "../../src/LiquidsLens.sol";
import {LiquidsDemoShareToken} from "../../src/LiquidsShareToken.sol";
import {IPriceFeed} from "../../src/interfaces/IPriceFeed.sol";

// Test infra
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockPermit2} from "../mocks/MockPermit2.sol";
import {MockPriceFeed} from "../mocks/MockPriceFeed.sol";
import {HookMiner} from "./HookMiner.sol";

/// @notice Common Foundry setup: spins up V4 PoolManager, deploys mock tokens & oracles, mines the
/// hook's magic address, deploys the hook via CREATE2, and creates an xETH/USDT0-like demo market.
/// Concrete test contracts inherit from this and reuse `alice`, `bob`, `liquidator`, `poolKey`, etc.
abstract contract TestSetup is Test {
    using PoolIdLibrary for PoolKey;

    // ===== V4 + protocol =====
    PoolManager public poolManager;
    LiquidsHookDemo public hook;
    LiquidsLensDemo public lens;
    LiquidsDemoShareToken public shareToken;

    // ===== Pool tokens (sorted by address so token0 < token1) =====
    MockERC20 public token0;
    MockERC20 public token1;
    MockPriceFeed public oracle0;
    MockPriceFeed public oracle1;

    // ===== Pool config =====
    PoolKey public poolKey;
    PoolId public poolId;
    uint8 public borrowCurrencyIndex; // 0 if borrowing currency0 (USDT-like), 1 if currency1

    /// @dev True when the 18-dec "ETH-like" token landed at the lower address slot (currency0).
    bool internal ethIsCurrency0;

    // ===== Roles =====
    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");
    address public liquidator = makeAddr("liquidator");

    // ===== Constants =====
    /// @dev Magic-address flag mask for our hook's callback set.
    uint160 internal constant HOOK_FLAGS = uint160(
        Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG
            | Hooks.AFTER_SWAP_FLAG
    );

    /// @dev Pool fee tier (0.05%) and matching tickSpacing.
    uint24 internal constant POOL_FEE = 500;
    int24 internal constant POOL_TICK_SPACING = 10;

    /// @dev Chainlink-style 8-decimal oracle values: ETH = $2000, USDT = $1.
    int256 internal constant INITIAL_ETH_USD = 200_000_000_000;
    int256 internal constant INITIAL_USDT_USD = 100_000_000;

    /// @dev Canonical Uniswap Permit2 deployment address. Same on every EVM chain.
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    function setUp() public virtual {
        // 1. Deploy V4 PoolManager.
        poolManager = new PoolManager(address(this));

        // 2. Deploy mock tokens. We use 18 decimals for the volatile side, 6 for the stable side.
        //    Whichever address sorts lower becomes currency0 — V4 enforces sorted PoolKey.
        MockERC20 ethLike = new MockERC20("xETH", "XETH", 18);
        MockERC20 usdtLike = new MockERC20("USDT0", "USDT0", 6);

        ethIsCurrency0 = address(ethLike) < address(usdtLike);
        if (ethIsCurrency0) {
            token0 = ethLike;
            token1 = usdtLike;
            borrowCurrencyIndex = 1;
        } else {
            token0 = usdtLike;
            token1 = ethLike;
            borrowCurrencyIndex = 0;
        }

        // 3. Deploy oracles matched to each currency's role.
        oracle0 = new MockPriceFeed(
            8, ethIsCurrency0 ? INITIAL_ETH_USD : INITIAL_USDT_USD, ethIsCurrency0 ? "XETH/USD" : "USDT0/USD"
        );
        oracle1 = new MockPriceFeed(
            8, ethIsCurrency0 ? INITIAL_USDT_USD : INITIAL_ETH_USD, ethIsCurrency0 ? "USDT0/USD" : "XETH/USD"
        );

        // 4. Mine a salt so CREATE2 puts the hook at an address whose low bits encode HOOK_FLAGS.
        bytes memory ctorArgs = abi.encode(IPoolManager(address(poolManager)));
        (address minedAddr, bytes32 salt) =
            HookMiner.find(address(this), HOOK_FLAGS, type(LiquidsHookDemo).creationCode, ctorArgs);

        // 5. CREATE2 deploy. BaseHook's constructor validates the address bits — passes since we mined.
        hook = new LiquidsHookDemo{salt: salt}(IPoolManager(address(poolManager)));
        require(address(hook) == minedAddr, "TestSetup: hook address mismatch");

        // 5b. Periphery Lens (read-only views with projected accrual). Independent 24KB budget.
        lens = new LiquidsLensDemo(hook);

        // 5c. Etch MockPermit2's runtime code at the canonical Permit2 address so
        // `hook.PERMIT2()` calls land on a working stub in this Foundry env.
        vm.etch(PERMIT2, address(new MockPermit2()).code);

        // 6. Compose the PoolKey for the demo market.
        poolKey = PoolKey({
            currency0: Currency.wrap(address(token0)),
            currency1: Currency.wrap(address(token1)),
            fee: POOL_FEE,
            tickSpacing: POOL_TICK_SPACING,
            hooks: IHooks(address(hook))
        });
        poolId = poolKey.toId();

        // 7. Initial pool price. Picked near the fair tick for ETH ≈ $2000 vs USDT ≈ $1 at 18/6 decimals.
        //    tick = ±200_200 (multiple of POOL_TICK_SPACING=10).
        int24 initialTick = ethIsCurrency0 ? int24(-200_200) : int24(200_200);
        uint160 initialSqrtPriceX96 = TickMath.getSqrtPriceAtTick(initialTick);

        // 8. Spin up the lending market through the hook (deploys share token + calls poolManager.initialize).
        hook.createPool(
            poolKey,
            initialSqrtPriceX96,
            IPriceFeed(address(oracle0)),
            IPriceFeed(address(oracle1)),
            borrowCurrencyIndex
        );

        // 9. Cache the per-pool share token reference for assertions.
        (,, LiquidsDemoShareToken sToken,) = hook.configs(poolId);
        shareToken = sToken;

        // 10. Fund and pre-approve the three actors.
        _fundAndApprove(alice);
        _fundAndApprove(bob);
        _fundAndApprove(liquidator);
    }

    /// @dev Mint 1M units of each token to `user` and authorize both the hook (direct supply/repay)
    /// and Permit2 (gasless Permit2 wrappers) to spend.
    function _fundAndApprove(address user) internal {
        token0.mint(user, 1_000_000 * 10 ** token0.decimals());
        token1.mint(user, 1_000_000 * 10 ** token1.decimals());

        vm.startPrank(user);
        token0.approve(address(hook), type(uint256).max);
        token1.approve(address(hook), type(uint256).max);
        token0.approve(PERMIT2, type(uint256).max);
        token1.approve(PERMIT2, type(uint256).max);
        vm.stopPrank();
    }

    /// @dev Returns the 18-decimal ("ETH-like") token regardless of which slot it landed in.
    function ethLike() internal view returns (MockERC20) {
        return ethIsCurrency0 ? token0 : token1;
    }

    /// @dev Returns the 6-decimal ("USDT-like") token regardless of slot.
    function usdtLike() internal view returns (MockERC20) {
        return ethIsCurrency0 ? token1 : token0;
    }

    /// @dev Oracle pricing the volatile (ETH-like) side.
    function ethOracle() internal view returns (MockPriceFeed) {
        return ethIsCurrency0 ? oracle0 : oracle1;
    }

    /// @dev Oracle pricing the stable (USDT-like) side.
    function usdtOracle() internal view returns (MockPriceFeed) {
        return ethIsCurrency0 ? oracle1 : oracle0;
    }

    /// @dev Build (amount0, amount1) representing ~$2000 of value on each side at the seeded price
    /// (1 unit of the 18-decimal token + 2000 units of the 6-decimal one).
    function _equalValueAmounts() internal view returns (uint256 amount0, uint256 amount1) {
        uint256 ethAmt = 1 * 10 ** ethLike().decimals();
        uint256 usdtAmt = 2_000 * 10 ** usdtLike().decimals();
        amount0 = ethIsCurrency0 ? ethAmt : usdtAmt;
        amount1 = ethIsCurrency0 ? usdtAmt : ethAmt;
    }
}
