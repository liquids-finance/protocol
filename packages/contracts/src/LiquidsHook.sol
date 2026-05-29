// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// Uniswap V4
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {IUnlockCallback} from "v4-core/interfaces/callback/IUnlockCallback.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {LiquidityAmounts} from "v4-periphery/libraries/LiquidityAmounts.sol";
import {BeforeSwapDelta} from "v4-core/types/BeforeSwapDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "v4-core/types/PoolOperation.sol";

// OpenZeppelin
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

// Local
import {BaseHook} from "./base/BaseHook.sol";
import {LiquidsDemoShareToken} from "./LiquidsShareToken.sol";
import {IPriceFeed} from "./interfaces/IPriceFeed.sol";
import {ISignatureTransfer} from "./interfaces/IPermit2.sol";
import {InterestRateModel} from "./libraries/InterestRateModel.sol";
import {PositionValue} from "./libraries/PositionValue.sol";

/// @notice Pool-native lending hook on Uniswap V4. Each registered pool is its own isolated
///         lending market (Morpho Blue style): permissionless creation, oracle chosen at init,
///         risk isolated per pool. LPs supply liquidity, get ERC20 shares, earn swap fees and
///         lending interest. Borrowers post their shares as collateral and draw the stable
///         currency from the pool's aggregate liquidity.
///
/// @dev HACKATHON BUILD. Unaudited. See VERSION/WARNING for the on-chain disclaimer.
contract LiquidsHookDemo is BaseHook, Ownable, Pausable, ReentrancyGuardTransient, IUnlockCallback {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    // ============================================================
    // Demo metadata (on-chain disclaimers)
    // ============================================================

    string public constant VERSION = "0.1.0-hackathon-okx-buildx";
    string public constant WARNING = "Demo deployment. Unaudited. Funds at risk.";

    // ============================================================
    // Risk parameters (basis points, 10_000 = 100%)
    // ============================================================

    /// @notice Maximum loan-to-value at origination.
    uint256 public constant MAX_LTV_BPS = 6_000; // 60%
    /// @notice Health factor threshold below which liquidation is allowed.
    uint256 public constant LIQUIDATION_HF_BPS = 11_500; // 1.15
    /// @notice Liquidation finder fee, paid as shares to msg.sender out of the borrower's collateral.
    uint256 public constant FINDER_FEE_BPS = 50; // 0.5%
    /// @dev Internal-only; mirrored on {LiquidsLens} for external consumers.
    uint256 internal constant BPS_DENOM = 10_000;

    // ============================================================
    // Interest rate model (WAD, 1e18 = 100% annual)
    // Kink-curve borrow rate. Lending rate = borrow * utilization.
    // Internal-only constants (mirrored on {LiquidsLens} for external/UI consumption).
    // ============================================================

    uint256 internal constant BASE_RATE_WAD = 0.01e18; // 1%
    uint256 internal constant SLOPE1_WAD = 0.06e18; // 6%
    uint256 internal constant SLOPE2_WAD = 1.0e18; // 100%
    uint256 internal constant KINK_U_WAD = 0.7e18; // 70%
    uint256 internal constant WAD = 1e18;
    uint256 internal constant SECONDS_PER_YEAR = 365 days;

    /// @notice Reject Chainlink reads older than this. Sized for X Layer mainnet, where the
    /// canonical Chainlink feeds run a 24-hour heartbeat; this gives a 2-hour buffer on top so
    /// transient delays don't trip the gate. Trade-off: longer cap means a downed-feed window of
    /// up to ~26h can go undetected — acceptable for a demo build, NOT for production.
    /// V2 makes this per-pool configurable so each market matches its own feed's heartbeat.
    /// @dev Internal-only; mirrored on {LiquidsLens}.
    uint256 internal constant MAX_PRICE_STALENESS = 26 hours;

    /// @notice Locked dust share minted on first supply to neutralize the first-depositor inflation attack
    /// (Uniswap V2 pattern). Burned to DEAD_ADDRESS; never redeemable.
    uint256 public constant MIN_LIQUIDITY_SHARES = 1_000;
    /// @notice Sink for the MIN_LIQUIDITY_SHARES burn. address(0xdead) is unspendable in practice.
    address public constant DEAD_ADDRESS = address(0xdead);

    /// @notice Canonical Uniswap Permit2 deployment. Same address on every EVM chain (X Layer included).
    /// Used by `supplyWithPermit2` / `repayWithPermit2` so callers can skip the separate ERC20 approve tx.
    ISignatureTransfer public constant PERMIT2 = ISignatureTransfer(0x000000000022D473030F116dDEE9F6B43aC78BA3);

    // ============================================================
    // Structs
    // ============================================================

    /// @dev Per-pool config set at registration. address(shareToken) != 0 ⇒ registered.
    /// Both oracles are mandatory (no implicit-stable assumption — even USDT0 can depeg).
    /// borrowCurrencyIndex picks which side (0 or 1) is the borrowable asset.
    struct PoolConfig {
        IPriceFeed oracle0;
        IPriceFeed oracle1;
        LiquidsDemoShareToken shareToken;
        uint8 borrowCurrencyIndex;
    }

    /// @dev Per-pool mutable vault state. Slot-packed where possible.
    struct VaultState {
        uint128 totalLiquidity; // V4 aggregate position liquidity units
        uint64 lastAccrualTime; // block.timestamp at last borrowIndex update
        uint256 totalScaledDebt; // Σ scaledDebt across borrowers (1e18 scale)
        uint256 borrowIndex; // grows over time per kink rate; 1e18 at registration
    }

    /// @dev Per-borrower debt entry. current_debt = scaledDebt * borrowIndex / 1e18.
    struct Debt {
        uint256 scaledDebt;
    }

    /// @dev Tag for the PoolManager unlock dispatcher.
    enum Action {
        Supply,
        Withdraw,
        Borrow,
        Repay
    }

    /// @dev Single payload for the PoolManager.unlock → unlockCallback round-trip.
    /// Fields are interpreted per `action`; unused fields are zero.
    /// - Supply / Withdraw: `liquidity` carries the L to add/remove; `amount` is unused.
    /// - Borrow / Repay:    `liquidity` carries the L to extract/re-add; `amount` is the borrow-asset raw quantity.
    struct CallbackData {
        Action action;
        PoolKey key;
        address user;
        uint128 liquidity;
        uint256 amount;
    }

    // ============================================================
    // State (multi-pool, keyed by V4 PoolId)
    // ============================================================

    mapping(PoolId => PoolConfig) public configs;
    mapping(PoolId => VaultState) public vaults;
    mapping(PoolId => mapping(address => Debt)) public debts;

    // ============================================================
    // Errors
    // ============================================================

    error DirectAddNotAllowed();
    error DirectRemoveNotAllowed();
    error PoolNotRegistered();
    error PoolAlreadyRegistered();
    error InvalidHookData();
    error InvalidPoolKey();
    error InvalidOracle();
    error InvalidBorrowCurrencyIndex();
    error ZeroAmount();
    error InsufficientLiquidity(uint256 available, uint256 requested);
    error LTVExceeded();
    error PositionHealthy();
    error SlippageExceeded();
    error OnlyPoolManager();
    error InvalidAction();
    error DebtOutstanding();
    error InvalidPermit2();

    // ============================================================
    // Events
    // ============================================================

    event DeployedForHackathon(string version, string warning, address indexed deployer, uint256 timestamp);
    event PoolRegistered(
        PoolId indexed poolId,
        address shareToken,
        address oracle0,
        address oracle1,
        uint8 borrowCurrencyIndex,
        address indexed creator
    );
    event Deposited(
        PoolId indexed poolId, address indexed user, uint256 amount0, uint256 amount1, uint256 sharesMinted
    );
    event Withdrawn(
        PoolId indexed poolId, address indexed user, uint256 sharesBurned, uint256 amount0Out, uint256 amount1Out
    );
    event Borrowed(PoolId indexed poolId, address indexed borrower, uint256 amount);
    event Repaid(PoolId indexed poolId, address indexed borrower, uint256 amount);
    event Liquidated(
        PoolId indexed poolId,
        address indexed borrower,
        address indexed finder,
        uint256 debtCleared,
        uint256 finderFeeShares
    );
    event InterestAccrued(PoolId indexed poolId, uint256 newBorrowIndex);

    // ============================================================
    // Constructor
    // ============================================================

    constructor(IPoolManager _poolManager) BaseHook(_poolManager) Ownable(msg.sender) {
        emit DeployedForHackathon(VERSION, WARNING, msg.sender, block.timestamp);
    }

    // ============================================================
    // Hook permissions
    // ============================================================

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: true,
            afterInitialize: false,
            beforeAddLiquidity: true,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: true,
            afterRemoveLiquidity: false,
            beforeSwap: false,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    // ============================================================
    // Hook callbacks (V4 → this contract)
    // ============================================================

    /// @notice Gate against direct PoolManager.initialize calls. A pool can only be initialized
    /// if it was first registered via createPool() — which sets the oracles, share token, and
    /// borrow side. Direct V4 init bypassing createPool will revert here.
    function beforeInitialize(
        address,
        /* sender */
        PoolKey calldata key,
        uint160 /* sqrtPriceX96 */
    )
        external
        view
        override
        onlyPoolManager
        returns (bytes4)
    {
        PoolId poolId = key.toId();
        if (address(configs[poolId].shareToken) == address(0)) {
            revert PoolNotRegistered();
        }
        return IHooks.beforeInitialize.selector;
    }

    /// @notice Reject direct modifyLiquidity from external callers. Only this hook may add liquidity.
    function beforeAddLiquidity(
        address sender,
        PoolKey calldata,
        /* key */
        ModifyLiquidityParams calldata,
        /* params */
        bytes calldata /* hookData */
    )
        external
        view
        override
        onlyPoolManager
        returns (bytes4)
    {
        if (sender != address(this)) revert DirectAddNotAllowed();
        return IHooks.beforeAddLiquidity.selector;
    }

    /// @notice Reject direct modifyLiquidity from external callers. Only this hook may remove liquidity.
    function beforeRemoveLiquidity(
        address sender,
        PoolKey calldata,
        /* key */
        ModifyLiquidityParams calldata,
        /* params */
        bytes calldata /* hookData */
    )
        external
        view
        override
        onlyPoolManager
        returns (bytes4)
    {
        if (sender != address(this)) revert DirectRemoveNotAllowed();
        return IHooks.beforeRemoveLiquidity.selector;
    }

    /// @notice Accrue interest on every swap so the borrowIndex stays fresh.
    function afterSwap(
        address,
        /* sender */
        PoolKey calldata key,
        SwapParams calldata,
        /* params */
        BalanceDelta,
        /* delta */
        bytes calldata /* hookData */
    )
        external
        override
        onlyPoolManager
        returns (bytes4, int128)
    {
        _accrueInterest(key);
        return (IHooks.afterSwap.selector, 0);
    }

    // ============================================================
    // PoolManager unlock callback + per-action dispatch handlers
    // ============================================================

    /// @notice Single entry point V4 calls back into after we invoke `poolManager.unlock(actionData)`.
    /// Decodes the action tag and routes to the matching internal handler. The dispatched handler
    /// is responsible for invoking modifyLiquidity / swap and zeroing all currency deltas before return.
    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();
        CallbackData memory cb = abi.decode(data, (CallbackData));
        if (cb.action == Action.Supply) return _handleSupply(cb);
        if (cb.action == Action.Withdraw) return _handleWithdraw(cb);
        if (cb.action == Action.Borrow) return _handleBorrow(cb);
        if (cb.action == Action.Repay) return _handleRepay(cb);
        revert InvalidAction();
    }

    /// @notice Inside unlock context: modifyLiquidity(+L), pay both currency debits via sync/transfer/settle.
    /// Returns (amount0Used, amount1Used) ABI-encoded so the outer supply() knows the exact draw.
    function _handleSupply(CallbackData memory cb) internal returns (bytes memory) {
        (int24 tickLower, int24 tickUpper) = _fullRangeTicks(cb.key.tickSpacing);

        // Add liquidity to our aggregate position. Hook is the position owner (salt=0).
        (BalanceDelta delta,) = poolManager.modifyLiquidity(
            cb.key,
            ModifyLiquidityParams({
                tickLower: tickLower,
                tickUpper: tickUpper,
                liquidityDelta: int256(uint256(cb.liquidity)),
                salt: bytes32(0)
            }),
            ""
        );

        // On supply, both delta components are non-positive (we owe the pool). Flip sign for debit math.
        uint256 owed0 = delta.amount0() < 0 ? uint256(int256(-delta.amount0())) : 0;
        uint256 owed1 = delta.amount1() < 0 ? uint256(int256(-delta.amount1())) : 0;

        _settleERC20(cb.key.currency0, owed0);
        _settleERC20(cb.key.currency1, owed1);

        return abi.encode(owed0, owed1);
    }

    /// @notice Inside unlock context: modifyLiquidity(-L), take both currencies directly to the user.
    /// Flash accounting lets us skip the hook intermediary — pool sends straight to user, saving 2 transfers.
    function _handleWithdraw(CallbackData memory cb) internal returns (bytes memory) {
        (int24 tickLower, int24 tickUpper) = _fullRangeTicks(cb.key.tickSpacing);

        (BalanceDelta delta,) = poolManager.modifyLiquidity(
            cb.key,
            ModifyLiquidityParams({
                tickLower: tickLower,
                tickUpper: tickUpper,
                liquidityDelta: -int256(uint256(cb.liquidity)),
                salt: bytes32(0)
            }),
            ""
        );

        // On removal, delta amounts are non-negative (pool owes us).
        uint256 owed0 = delta.amount0() > 0 ? uint256(int256(delta.amount0())) : 0;
        uint256 owed1 = delta.amount1() > 0 ? uint256(int256(delta.amount1())) : 0;

        _takeERC20(cb.key.currency0, cb.user, owed0);
        _takeERC20(cb.key.currency1, cb.user, owed1);

        return abi.encode(owed0, owed1);
    }

    /// @notice Inside unlock context: modifyLiquidity(-L) → swap non-borrow→borrow in same pool → take borrow to user.
    /// Swap fees stay with the V4 position (i.e., us, the only LP) — that's the natural origination fee.
    function _handleBorrow(CallbackData memory cb) internal returns (bytes memory) {
        (int24 tickLower, int24 tickUpper) = _fullRangeTicks(cb.key.tickSpacing);

        (BalanceDelta delta,) = poolManager.modifyLiquidity(
            cb.key,
            ModifyLiquidityParams({
                tickLower: tickLower,
                tickUpper: tickUpper,
                liquidityDelta: -int256(uint256(cb.liquidity)),
                salt: bytes32(0)
            }),
            ""
        );
        uint256 fromModify0 = delta.amount0() > 0 ? uint256(int256(delta.amount0())) : 0;
        uint256 fromModify1 = delta.amount1() > 0 ? uint256(int256(delta.amount1())) : 0;

        uint8 borrowIdx = configs[cb.key.toId()].borrowCurrencyIndex;
        uint256 totalOut;

        if (borrowIdx == 1) {
            // Borrow = currency1. Convert all currency0 we just extracted into currency1 via the same pool.
            uint256 swapped;
            if (fromModify0 > 0) {
                BalanceDelta swapDelta = poolManager.swap(
                    cb.key,
                    SwapParams({
                        zeroForOne: true,
                        amountSpecified: -int256(fromModify0),
                        sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
                    }),
                    ""
                );
                if (swapDelta.amount1() > 0) swapped = uint256(int256(swapDelta.amount1()));
            }
            totalOut = fromModify1 + swapped;
            _takeERC20(cb.key.currency1, cb.user, totalOut);
        } else {
            // Borrow = currency0. Mirror: convert all currency1 into currency0.
            uint256 swapped;
            if (fromModify1 > 0) {
                BalanceDelta swapDelta = poolManager.swap(
                    cb.key,
                    SwapParams({
                        zeroForOne: false,
                        amountSpecified: -int256(fromModify1),
                        sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1
                    }),
                    ""
                );
                if (swapDelta.amount0() > 0) swapped = uint256(int256(swapDelta.amount0()));
            }
            totalOut = fromModify0 + swapped;
            _takeERC20(cb.key.currency0, cb.user, totalOut);
        }

        return abi.encode(totalOut);
    }

    /// @notice Inside unlock context: swap half of repaid borrow asset → other side, modifyLiquidity(+L) with
    /// the combined amounts, settle the borrow-side debit, take any volatile-side dust to hook. Returns
    /// (addedL, amountActuallyAbsorbed) — caller refunds the difference and reduces debt by `actuallyAbsorbed`.
    function _handleRepay(CallbackData memory cb) internal returns (bytes memory) {
        PoolId poolId = cb.key.toId();
        (int24 tickLower, int24 tickUpper) = _fullRangeTicks(cb.key.tickSpacing);
        uint8 borrowIdx = configs[poolId].borrowCurrencyIndex;

        uint256 repayAmount = cb.amount;
        uint256 swapAmount = repayAmount / 2; // half-and-half is optimal for full-range at equilibrium price

        // Step 1: swap half the borrow asset → other side.
        uint256 received;
        {
            BalanceDelta sd = poolManager.swap(
                cb.key,
                SwapParams({
                    zeroForOne: borrowIdx == 0,
                    amountSpecified: -int256(swapAmount),
                    sqrtPriceLimitX96: borrowIdx == 0 ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
                }),
                ""
            );
            int128 receivedDelta = borrowIdx == 0 ? sd.amount1() : sd.amount0();
            if (receivedDelta > 0) received = uint256(int256(receivedDelta));
        }

        uint256 remainingBorrow = repayAmount - swapAmount;

        // Step 2: size new L using the post-swap sqrt and the now-available amounts.
        uint128 addedL;
        {
            (uint160 sqrtPostSwap,,,) = poolManager.getSlot0(poolId);
            uint256 amount0For = borrowIdx == 0 ? remainingBorrow : received;
            uint256 amount1For = borrowIdx == 0 ? received : remainingBorrow;
            addedL = LiquidityAmounts.getLiquidityForAmounts(
                sqrtPostSwap,
                TickMath.getSqrtPriceAtTick(tickLower),
                TickMath.getSqrtPriceAtTick(tickUpper),
                amount0For,
                amount1For
            );
        }
        if (addedL == 0) revert ZeroAmount();

        // Step 3: modifyLiquidity(+addedL).
        (BalanceDelta md,) = poolManager.modifyLiquidity(
            cb.key,
            ModifyLiquidityParams({
                tickLower: tickLower, tickUpper: tickUpper, liquidityDelta: int256(uint256(addedL)), salt: bytes32(0)
            }),
            ""
        );
        uint256 modifyOwed0 = md.amount0() < 0 ? uint256(int256(-md.amount0())) : 0;
        uint256 modifyOwed1 = md.amount1() < 0 ? uint256(int256(-md.amount1())) : 0;

        // Step 4: settle borrow-side debit from hook, take other-side dust, refund leftover borrow asset.
        uint256 actuallyAbsorbed;
        if (borrowIdx == 0) {
            uint256 toSettle = swapAmount + modifyOwed0;
            if (toSettle > repayAmount) revert SlippageExceeded();
            _settleERC20(cb.key.currency0, toSettle);
            actuallyAbsorbed = toSettle;

            uint256 refund = repayAmount - toSettle;
            if (refund > 0) IERC20(Currency.unwrap(cb.key.currency0)).safeTransfer(cb.user, refund);

            if (received < modifyOwed1) revert SlippageExceeded();
            if (received > modifyOwed1) _takeERC20(cb.key.currency1, address(this), received - modifyOwed1);
        } else {
            uint256 toSettle = swapAmount + modifyOwed1;
            if (toSettle > repayAmount) revert SlippageExceeded();
            _settleERC20(cb.key.currency1, toSettle);
            actuallyAbsorbed = toSettle;

            uint256 refund = repayAmount - toSettle;
            if (refund > 0) IERC20(Currency.unwrap(cb.key.currency1)).safeTransfer(cb.user, refund);

            if (received < modifyOwed0) revert SlippageExceeded();
            if (received > modifyOwed0) _takeERC20(cb.key.currency0, address(this), received - modifyOwed0);
        }

        return abi.encode(addedL, actuallyAbsorbed);
    }

    // ============================================================
    // User-facing write functions
    // ============================================================

    /// @notice Register a new isolated lending market on top of a Uniswap V4 pool and initialize the V4 pool itself.
    /// Permissionless (Morpho Blue style) — anyone may spin up a market with their chosen oracles and borrow side.
    /// Risk is isolated per pool; pool creator picks the trust assumptions, LPs/borrowers decide whether to join.
    /// @dev `key.hooks` must equal this contract. Each (currency0, currency1, fee, tickSpacing, hooks) tuple can
    /// only be registered once. Calls poolManager.initialize internally, which triggers beforeInitialize where
    /// we verify the config was pre-set in this same call.
    function createPool(
        PoolKey calldata key,
        uint160 sqrtPriceX96,
        IPriceFeed oracle0,
        IPriceFeed oracle1,
        uint8 borrowCurrencyIndex
    ) external nonReentrant whenNotPaused returns (PoolId poolId, address shareToken) {
        if (address(key.hooks) != address(this)) revert InvalidPoolKey();
        if (address(oracle0) == address(0) || address(oracle1) == address(0)) {
            revert InvalidOracle();
        }
        if (borrowCurrencyIndex > 1) revert InvalidBorrowCurrencyIndex();

        poolId = key.toId();
        PoolConfig storage cfg = configs[poolId];
        if (address(cfg.shareToken) != address(0)) {
            revert PoolAlreadyRegistered();
        }

        // Deploy the per-pool share token with DEMO-prefixed name/symbol pulled from the underlying tokens.
        string memory sym0 = _tokenSymbol(key.currency0);
        string memory sym1 = _tokenSymbol(key.currency1);
        LiquidsDemoShareToken sToken = new LiquidsDemoShareToken(
            string.concat("Liquidsfi DEMO ", sym0, "/", sym1, " Vault - Hackathon Build"),
            string.concat("lqfDEMO-", sym0, "-", sym1),
            poolId
        );

        cfg.oracle0 = oracle0;
        cfg.oracle1 = oracle1;
        cfg.shareToken = sToken;
        cfg.borrowCurrencyIndex = borrowCurrencyIndex;

        VaultState storage vault = vaults[poolId];
        vault.borrowIndex = WAD;
        vault.lastAccrualTime = uint64(block.timestamp);

        shareToken = address(sToken);
        emit PoolRegistered(poolId, shareToken, address(oracle0), address(oracle1), borrowCurrencyIndex, msg.sender);

        // Trigger the V4 pool initialization. PoolManager will call back into beforeInitialize, which
        // verifies the pool is registered (it is — we just set it above) and returns the selector.
        poolManager.initialize(key, sqrtPriceX96);
    }

    /// @notice Add liquidity to the vault. Hook performs modifyLiquidity(+) internally and mints
    /// vault shares proportional to the USD value contributed (oracle-priced).
    /// @param key Pool to deposit into (must be registered via createPool first).
    /// @param amount0Desired Upper bound caller authorizes for currency0; V4 may consume less due to ratio.
    /// @param amount1Desired Upper bound caller authorizes for currency1; refund of unused on return.
    /// @param minShares Slippage guard — revert if shares minted would be less than this.
    function supply(PoolKey calldata key, uint256 amount0Desired, uint256 amount1Desired, uint256 minShares)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 sharesMinted)
    {
        if (amount0Desired > 0) {
            IERC20(Currency.unwrap(key.currency0)).safeTransferFrom(msg.sender, address(this), amount0Desired);
        }
        if (amount1Desired > 0) {
            IERC20(Currency.unwrap(key.currency1)).safeTransferFrom(msg.sender, address(this), amount1Desired);
        }
        return _supplyAfterPull(msg.sender, key, amount0Desired, amount1Desired, minShares);
    }

    /// @notice Same as {supply} but pulls both currencies through Uniswap Permit2 (one signature,
    /// no standalone ERC20 approve). `permit` must be a batch of length 2 with
    /// `permitted[0].token = currency0` and `permitted[1].token = currency1`, each with
    /// `permitted[i].amount >= amount{0,1}Desired`.
    /// @param key Pool to deposit into.
    /// @param amount0Desired Currency0 upper bound caller authorizes (≤ permit.permitted[0].amount).
    /// @param amount1Desired Currency1 upper bound caller authorizes (≤ permit.permitted[1].amount).
    /// @param minShares Slippage guard on shares minted.
    /// @param permit Batch Permit2 payload signed by msg.sender.
    /// @param signature EIP-712 signature over `permit` for Permit2's domain.
    function supplyWithPermit2(
        PoolKey calldata key,
        uint256 amount0Desired,
        uint256 amount1Desired,
        uint256 minShares,
        ISignatureTransfer.PermitBatchTransferFrom calldata permit,
        bytes calldata signature
    ) external nonReentrant whenNotPaused returns (uint256 sharesMinted) {
        if (
            permit.permitted.length != 2 || permit.permitted[0].token != Currency.unwrap(key.currency0)
                || permit.permitted[1].token != Currency.unwrap(key.currency1)
        ) revert InvalidPermit2();

        ISignatureTransfer.SignatureTransferDetails[] memory details =
            new ISignatureTransfer.SignatureTransferDetails[](2);
        details[0] = ISignatureTransfer.SignatureTransferDetails({to: address(this), requestedAmount: amount0Desired});
        details[1] = ISignatureTransfer.SignatureTransferDetails({to: address(this), requestedAmount: amount1Desired});

        PERMIT2.permitTransferFrom(permit, details, msg.sender, signature);

        return _supplyAfterPull(msg.sender, key, amount0Desired, amount1Desired, minShares);
    }

    /// @dev Shared post-pull supply path: assumes `amount{0,1}Desired` of the respective currencies
    /// are already sitting in this contract. Sizes L from desired amounts, crosses V4, refunds unused,
    /// mints shares to `user` proportional to oracle-priced deposit value.
    function _supplyAfterPull(
        address user,
        PoolKey calldata key,
        uint256 amount0Desired,
        uint256 amount1Desired,
        uint256 minShares
    ) internal returns (uint256 sharesMinted) {
        if (amount0Desired == 0 && amount1Desired == 0) revert ZeroAmount();

        PoolId poolId = key.toId();
        PoolConfig storage cfg = configs[poolId];
        if (address(cfg.shareToken) == address(0)) revert PoolNotRegistered();

        // Bring borrowIndex current so the totalAssets snapshot below reflects accrued interest.
        _accrueInterest(key);

        // Compute the largest L the desired amounts can support at the current pool price.
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(poolId);
        (int24 tickLower, int24 tickUpper) = _fullRangeTicks(key.tickSpacing);
        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96,
            TickMath.getSqrtPriceAtTick(tickLower),
            TickMath.getSqrtPriceAtTick(tickUpper),
            amount0Desired,
            amount1Desired
        );
        if (liquidity == 0) revert ZeroAmount();

        // Snapshot BEFORE the deposit for fair share math.
        uint256 totalAssetsBeforeWad = _totalAssetsWad(key);
        uint256 totalSharesBefore = cfg.shareToken.totalSupply();

        // Cross into V4 unlock context. _handleSupply runs modifyLiquidity(+L) and settles both currency debits.
        bytes memory result = poolManager.unlock(
            abi.encode(CallbackData({action: Action.Supply, key: key, user: user, liquidity: liquidity, amount: 0}))
        );
        (uint256 amount0Used, uint256 amount1Used) = abi.decode(result, (uint256, uint256));

        // Refund any tokens the V4 position didn't consume.
        if (amount0Desired > amount0Used) {
            IERC20(Currency.unwrap(key.currency0)).safeTransfer(user, amount0Desired - amount0Used);
        }
        if (amount1Desired > amount1Used) {
            IERC20(Currency.unwrap(key.currency1)).safeTransfer(user, amount1Desired - amount1Used);
        }

        // USD-WAD value of the actual deposit, derived from oracle prices.
        uint256 p0Wad = PositionValue.fetchPriceWad(cfg.oracle0, _tokenDecimals(key.currency0), MAX_PRICE_STALENESS);
        uint256 p1Wad = PositionValue.fetchPriceWad(cfg.oracle1, _tokenDecimals(key.currency1), MAX_PRICE_STALENESS);
        uint256 depositedValueWad = amount0Used * p0Wad + amount1Used * p1Wad;

        if (totalSharesBefore == 0) {
            // First supply: 1 share ≈ 1 USD-WAD. Burn a small dust amount to DEAD_ADDRESS to neutralize
            // the first-depositor inflation attack (Uniswap V2 pattern).
            if (depositedValueWad <= MIN_LIQUIDITY_SHARES) revert ZeroAmount();
            cfg.shareToken.mint(DEAD_ADDRESS, MIN_LIQUIDITY_SHARES);
            sharesMinted = depositedValueWad - MIN_LIQUIDITY_SHARES;
        } else {
            if (totalAssetsBeforeWad == 0) revert ZeroAmount(); // unreachable in normal operation
            sharesMinted = (depositedValueWad * totalSharesBefore) / totalAssetsBeforeWad;
        }
        if (sharesMinted < minShares) revert SlippageExceeded();

        cfg.shareToken.mint(user, sharesMinted);
        vaults[poolId].totalLiquidity += liquidity;

        emit Deposited(poolId, user, amount0Used, amount1Used, sharesMinted);
    }

    /// @notice Burn vault shares for proportional value from the V4 position. Nominal value preserved —
    /// caller receives shares × shareValue worth of currency0 + currency1 at the current pool composition.
    /// Aave-style availability constraint: if utilization is so high that the V4 position can't cover the
    /// requested USD value, the call reverts and the caller must wait for borrower repayments.
    /// Allowed while paused so users can always exit.
    /// @param key Pool to withdraw from.
    /// @param sharesToBurn Number of vault shares to redeem.
    /// @param minAmount0Out Slippage guard on currency0 receipt.
    /// @param minAmount1Out Slippage guard on currency1 receipt.
    function withdraw(PoolKey calldata key, uint256 sharesToBurn, uint256 minAmount0Out, uint256 minAmount1Out)
        external
        nonReentrant
        returns (uint256 amount0Out, uint256 amount1Out)
    {
        if (sharesToBurn == 0) revert ZeroAmount();

        PoolId poolId = key.toId();
        PoolConfig storage cfg = configs[poolId];
        if (address(cfg.shareToken) == address(0)) revert PoolNotRegistered();

        // Block withdraw while the caller has an open borrow position — they must repay first.
        // This closes the "drain collateral with debt still owed" escape.
        if (debts[poolId][msg.sender].scaledDebt > 0) revert DebtOutstanding();

        _accrueInterest(key);

        uint256 totalShares_ = cfg.shareToken.totalSupply();
        uint256 totalAssetsWad_ = _totalAssetsWad(key);
        uint256 v4ValueWad = _v4ValueUSDWad(key);

        // User's claim on total vault value, USD-WAD.
        uint256 userValueWad = (sharesToBurn * totalAssetsWad_) / totalShares_;

        // Aave-style availability: cannot draw more USD than the V4 position currently holds.
        if (userValueWad > v4ValueWad) revert InsufficientLiquidity(v4ValueWad, userValueWad);
        if (userValueWad == 0) revert ZeroAmount();

        // L slice proportional to the user's USD claim on V4.
        uint128 liquidity = uint128((uint256(vaults[poolId].totalLiquidity) * userValueWad) / v4ValueWad);
        if (liquidity == 0) revert ZeroAmount();

        // Cross into V4 unlock context. Handler removes L and takes both currencies directly to msg.sender.
        bytes memory result = poolManager.unlock(
            abi.encode(
                CallbackData({action: Action.Withdraw, key: key, user: msg.sender, liquidity: liquidity, amount: 0})
            )
        );
        (amount0Out, amount1Out) = abi.decode(result, (uint256, uint256));

        if (amount0Out < minAmount0Out || amount1Out < minAmount1Out) revert SlippageExceeded();

        cfg.shareToken.burn(msg.sender, sharesToBurn);
        vaults[poolId].totalLiquidity -= liquidity;

        emit Withdrawn(poolId, msg.sender, sharesToBurn, amount0Out, amount1Out);
    }

    /// @notice Draw the pool's borrow asset against the caller's vault shares.
    /// LTV-checked against MAX_LTV_BPS. Internal flow extracts proportional L, swaps the non-borrow side
    /// to the borrow side in the same pool (so swap fees compound back into the position), and takes
    /// the total borrow currency directly to the caller. Debt is recorded scaled by the current borrowIndex.
    /// @param key Pool to borrow from.
    /// @param amount Target borrow amount (caller may receive slightly less due to swap impact).
    /// @param minBorrowOut Slippage guard — revert if actual delivered is less than this.
    function borrow(PoolKey calldata key, uint256 amount, uint256 minBorrowOut)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 actualBorrowed)
    {
        if (amount == 0) revert ZeroAmount();

        PoolId poolId = key.toId();
        PoolConfig storage cfg = configs[poolId];
        if (address(cfg.shareToken) == address(0)) revert PoolNotRegistered();

        _accrueInterest(key);

        // Collateral USD-WAD = caller's share-weighted slice of total vault assets.
        uint256 totalShares_ = cfg.shareToken.totalSupply();
        uint256 userShares = cfg.shareToken.balanceOf(msg.sender);
        uint256 userCollateralWad = totalShares_ == 0 ? 0 : (userShares * _totalAssetsWad(key)) / totalShares_;

        // New total debt USD-WAD = existing debt + requested draw (priced via oracle).
        uint256 existingDebtWad = _borrowAssetUSDWad(key, _currentDebt(poolId, msg.sender));
        uint256 newDrawWad = _borrowAssetUSDWad(key, amount);
        uint256 totalDebtAfterWad = existingDebtWad + newDrawWad;

        // LTV gate: debt/collateral must be ≤ MAX_LTV_BPS.
        if (totalDebtAfterWad * BPS_DENOM > userCollateralWad * MAX_LTV_BPS) revert LTVExceeded();

        // L slice sized so the modify + swap roundtrip delivers roughly `amount` of borrow currency.
        uint256 v4ValueWad = _v4ValueUSDWad(key);
        if (v4ValueWad < newDrawWad) revert InsufficientLiquidity(v4ValueWad, newDrawWad);
        uint128 liquidity = uint128((uint256(vaults[poolId].totalLiquidity) * newDrawWad) / v4ValueWad);
        if (liquidity == 0) revert ZeroAmount();

        // Cross into V4 unlock context. Handler returns the actual borrow amount delivered.
        bytes memory result = poolManager.unlock(
            abi.encode(
                CallbackData({action: Action.Borrow, key: key, user: msg.sender, liquidity: liquidity, amount: amount})
            )
        );
        actualBorrowed = abi.decode(result, (uint256));

        if (actualBorrowed < minBorrowOut) revert SlippageExceeded();

        // Record debt scaled by current borrowIndex so subsequent accruals lift it automatically.
        uint256 scaledIncrease = (actualBorrowed * WAD) / vaults[poolId].borrowIndex;
        debts[poolId][msg.sender].scaledDebt += scaledIncrease;
        vaults[poolId].totalScaledDebt += scaledIncrease;
        vaults[poolId].totalLiquidity -= liquidity;

        emit Borrowed(poolId, msg.sender, actualBorrowed);
    }

    /// @notice Repay outstanding debt (principal + accrued interest).
    /// Caller transfers borrow asset to the hook; the unlock handler swaps half to the volatile side and
    /// re-adds the combined amounts as new V4 liquidity (aggressive re-add, no idle). Any portion the
    /// V4 position could not absorb is refunded to caller. Debt is reduced by the actually absorbed amount.
    /// Allowed while paused so borrowers can always close out.
    /// @param key Pool to repay against.
    /// @param amount Repay budget; effective repay is capped by current debt and by what V4 absorbs.
    function repay(PoolKey calldata key, uint256 amount) external nonReentrant returns (uint256 actuallyRepaid) {
        (Currency borrowCurrency, uint256 cappedAmount, bool isFullRepayIntent) = _prepareRepay(key, amount);
        IERC20(Currency.unwrap(borrowCurrency)).safeTransferFrom(msg.sender, address(this), cappedAmount);
        return _executeRepay(key, msg.sender, cappedAmount, isFullRepayIntent);
    }

    /// @notice Same as {repay} but pulls the borrow currency through Uniswap Permit2.
    /// `permit.permitted.token` must equal the pool's borrow currency and
    /// `permit.permitted.amount` must be ≥ the post-cap repay amount.
    /// @param key Pool to repay against.
    /// @param amount Repay budget; capped by current debt.
    /// @param permit Permit2 single-token payload signed by msg.sender.
    /// @param signature EIP-712 signature over `permit` for Permit2's domain.
    function repayWithPermit2(
        PoolKey calldata key,
        uint256 amount,
        ISignatureTransfer.PermitTransferFrom calldata permit,
        bytes calldata signature
    ) external nonReentrant returns (uint256 actuallyRepaid) {
        (Currency borrowCurrency, uint256 cappedAmount, bool isFullRepayIntent) = _prepareRepay(key, amount);
        if (permit.permitted.token != Currency.unwrap(borrowCurrency)) revert InvalidPermit2();

        PERMIT2.permitTransferFrom(
            permit,
            ISignatureTransfer.SignatureTransferDetails({to: address(this), requestedAmount: cappedAmount}),
            msg.sender,
            signature
        );

        return _executeRepay(key, msg.sender, cappedAmount, isFullRepayIntent);
    }

    /// @dev Shared validation + interest accrual for repay paths. Returns the resolved borrow currency,
    /// the amount capped at the caller's current debt, and a flag telling {_executeRepay} to forgive
    /// sub-wei dust on a full close-out.
    function _prepareRepay(PoolKey calldata key, uint256 amount)
        internal
        returns (Currency borrowCurrency, uint256 cappedAmount, bool isFullRepayIntent)
    {
        if (amount == 0) revert ZeroAmount();

        PoolId poolId = key.toId();
        PoolConfig storage cfg = configs[poolId];
        if (address(cfg.shareToken) == address(0)) revert PoolNotRegistered();

        _accrueInterest(key);

        uint256 currentDebt = _currentDebt(poolId, msg.sender);
        if (currentDebt == 0) revert ZeroAmount();
        // Detect "close my entire position" intent BEFORE capping `amount` — the swap fee dust below
        // the absorbed value would otherwise leave a few wei of debt that can never be cleared in a
        // single tx, leaving share transfers permanently locked.
        isFullRepayIntent = amount >= currentDebt;
        cappedAmount = amount > currentDebt ? currentDebt : amount;
        borrowCurrency = cfg.borrowCurrencyIndex == 0 ? key.currency0 : key.currency1;
    }

    /// @dev Shared post-pull repay path: assumes `amount` of the borrow currency is already in the hook.
    /// Crosses V4 (swap half → modifyLiquidity(+)), refunds any unabsorbed leftover, reduces caller's debt.
    function _executeRepay(PoolKey calldata key, address user, uint256 amount, bool isFullRepayIntent)
        internal
        returns (uint256 actuallyRepaid)
    {
        PoolId poolId = key.toId();

        bytes memory result = poolManager.unlock(
            abi.encode(CallbackData({action: Action.Repay, key: key, user: user, liquidity: 0, amount: amount}))
        );
        (uint128 addedL, uint256 absorbed) = abi.decode(result, (uint128, uint256));
        actuallyRepaid = absorbed;

        // Reduce scaledDebt by the absorbed amount, scaled by current borrowIndex.
        uint256 scaledDecrease = (actuallyRepaid * WAD) / vaults[poolId].borrowIndex;
        // Forgive sub-wei swap-fee dust when caller signaled full repayment, so positions can close
        // cleanly in one tx (the forgiven micro-amount is a tiny donation to remaining LPs).
        if (isFullRepayIntent || scaledDecrease > debts[poolId][user].scaledDebt) {
            scaledDecrease = debts[poolId][user].scaledDebt;
        }
        debts[poolId][user].scaledDebt -= scaledDecrease;
        vaults[poolId].totalScaledDebt -= scaledDecrease;
        vaults[poolId].totalLiquidity += addedL;

        emit Repaid(poolId, user, actuallyRepaid);
    }

    /// @notice Permissionless liquidation of an underwater position (HF < LIQUIDATION_HF_BPS).
    /// Unified vault burn-and-cancel: borrower's shares are burned and their debt is zeroed in a single
    /// state update — V4 is NOT touched, so no slippage, no swap, no MEV surface. The trigger caller
    /// receives 0.5% of debt value re-minted as fresh shares (finder fee from the borrower's collateral).
    /// Allowed while paused so the protocol can always clear bad positions.
    /// @param key Pool the position lives in.
    /// @param borrower Owner of the underwater position.
    /// @return debtCleared Amount of borrow-asset debt zeroed.
    /// @return finderFeeShares Shares minted to msg.sender as the trigger reward.
    function liquidate(PoolKey calldata key, address borrower)
        external
        nonReentrant
        returns (uint256 debtCleared, uint256 finderFeeShares)
    {
        PoolId poolId = key.toId();
        PoolConfig storage cfg = configs[poolId];
        if (address(cfg.shareToken) == address(0)) revert PoolNotRegistered();

        _accrueInterest(key);

        uint256 borrowerDebt = _currentDebt(poolId, borrower);
        if (borrowerDebt == 0) revert PositionHealthy();

        uint256 borrowerShares = cfg.shareToken.balanceOf(borrower);
        uint256 totalShares_ = cfg.shareToken.totalSupply();
        uint256 totalAssetsWad_ = _totalAssetsWad(key);
        uint256 collateralWad = totalShares_ == 0 ? 0 : (borrowerShares * totalAssetsWad_) / totalShares_;
        uint256 debtWad = _borrowAssetUSDWad(key, borrowerDebt);

        // HF < LIQUIDATION_HF_BPS / BPS_DENOM  ⇔  collateral × BPS_DENOM < debt × LIQUIDATION_HF_BPS.
        if (collateralWad * BPS_DENOM >= debtWad * LIQUIDATION_HF_BPS) revert PositionHealthy();

        // Finder fee = 0.5% of debt USD value, expressed as share token units.
        finderFeeShares =
            totalAssetsWad_ == 0 ? 0 : (debtWad * FINDER_FEE_BPS * totalShares_) / (BPS_DENOM * totalAssetsWad_);
        if (finderFeeShares > borrowerShares) finderFeeShares = borrowerShares;

        // Burn the borrower's whole position, then re-mint the finder fee fraction to msg.sender.
        if (borrowerShares > 0) cfg.shareToken.burn(borrower, borrowerShares);
        if (finderFeeShares > 0) cfg.shareToken.mint(msg.sender, finderFeeShares);

        // Cancel the debt. Aggregate is reduced by the borrower's stored scaledDebt; the entry is wiped.
        vaults[poolId].totalScaledDebt -= debts[poolId][borrower].scaledDebt;
        delete debts[poolId][borrower];
        debtCleared = borrowerDebt;

        emit Liquidated(poolId, borrower, msg.sender, debtCleared, finderFeeShares);
    }

    // ============================================================
    // Admin (circuit breaker)
    // ============================================================

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ============================================================
    // Internal accounting (interest accrual, utilization, totals)
    // ============================================================

    /// @notice Update the pool's borrowIndex to reflect interest accrued since the last touch.
    /// Cheap O(1) operation; safe to call multiple times per block (no-op when elapsed == 0).
    /// MUST be invoked at the start of every function that reads or writes utilization-sensitive state.
    function _accrueInterest(PoolKey calldata key) internal {
        PoolId poolId = key.toId();
        VaultState storage vault = vaults[poolId];
        uint256 elapsed = block.timestamp - vault.lastAccrualTime;
        if (elapsed == 0) return;

        uint256 uWad = _utilization(key);
        uint256 ratePerSec = InterestRateModel.borrowRatePerSecondWad(
            uWad, BASE_RATE_WAD, SLOPE1_WAD, SLOPE2_WAD, KINK_U_WAD, SECONDS_PER_YEAR
        );

        vault.borrowIndex = InterestRateModel.applyLinearAccrual(vault.borrowIndex, ratePerSec, elapsed);
        vault.lastAccrualTime = uint64(block.timestamp);

        emit InterestAccrued(poolId, vault.borrowIndex);
    }

    /// @notice Current utilization U = debtUSD / totalAssetsUSD, in WAD (1e18 = 100%).
    /// Both numerator and denominator are USD-WAD so the ratio is unit-consistent across
    /// pools with different decimal layouts. Reads borrowIndex as-is — caller should
    /// _accrueInterest first when freshness matters.
    function _utilization(PoolKey calldata key) internal view returns (uint256) {
        uint256 totalWad = _totalAssetsWad(key);
        if (totalWad == 0) return 0;
        uint256 debt = _totalDebt(key.toId());
        uint256 debtWad = _borrowAssetUSDWad(key, debt);
        return (debtWad * WAD) / totalWad;
    }

    /// @notice Total vault assets in USD (WAD): V4 fair value + outstanding debt receivable.
    /// Both terms valued via oracles only — manipulation-resistant.
    function _totalAssetsWad(PoolKey calldata key) internal view returns (uint256) {
        uint256 v4Wad = _v4ValueUSDWad(key);
        uint256 debt = _totalDebt(key.toId());
        uint256 debtWad = _borrowAssetUSDWad(key, debt);
        return v4Wad + debtWad;
    }

    /// @notice Fair USD value (WAD) of the aggregate V4 position. Spot-price-independent.
    /// Formula: 2 * L * sqrt(P0_per_unit * P1_per_unit), oracle-priced both sides.
    function _v4ValueUSDWad(PoolKey calldata key) internal view returns (uint256) {
        PoolId poolId = key.toId();
        VaultState storage vault = vaults[poolId];
        if (vault.totalLiquidity == 0) return 0;
        PoolConfig storage cfg = configs[poolId];

        uint256 p0 = PositionValue.fetchPriceWad(cfg.oracle0, _tokenDecimals(key.currency0), MAX_PRICE_STALENESS);
        uint256 p1 = PositionValue.fetchPriceWad(cfg.oracle1, _tokenDecimals(key.currency1), MAX_PRICE_STALENESS);

        return PositionValue.fairValueWad(vault.totalLiquidity, p0, p1);
    }

    /// @notice Convert a raw amount of the pool's borrow asset to USD (WAD).
    function _borrowAssetUSDWad(PoolKey calldata key, uint256 amount) internal view returns (uint256) {
        if (amount == 0) return 0;
        PoolConfig storage cfg = configs[key.toId()];
        Currency borrowCurrency = cfg.borrowCurrencyIndex == 0 ? key.currency0 : key.currency1;
        IPriceFeed feed = cfg.borrowCurrencyIndex == 0 ? cfg.oracle0 : cfg.oracle1;
        uint256 priceWad = PositionValue.fetchPriceWad(feed, _tokenDecimals(borrowCurrency), MAX_PRICE_STALENESS);
        return amount * priceWad;
    }

    /// @notice Current debt of `user` on `poolId` in the borrow asset's raw units, accrued.
    function _currentDebt(PoolId poolId, address user) internal view returns (uint256) {
        return (debts[poolId][user].scaledDebt * vaults[poolId].borrowIndex) / WAD;
    }

    /// @notice Sum of all borrowers' current debts on `poolId` in borrow-asset raw units.
    function _totalDebt(PoolId poolId) internal view returns (uint256) {
        VaultState storage vault = vaults[poolId];
        return (vault.totalScaledDebt * vault.borrowIndex) / WAD;
    }

    /// @notice Best-effort ERC20 symbol read for naming the per-pool share token.
    /// Handles native ETH (address(0)) and tokens whose symbol() reverts.
    function _tokenSymbol(Currency currency) internal view returns (string memory) {
        address addr = Currency.unwrap(currency);
        if (addr == address(0)) return "ETH";
        try IERC20Metadata(addr).symbol() returns (string memory s) {
            return s;
        } catch {
            return "TKN";
        }
    }

    /// @notice Best-effort ERC20 decimals read for converting raw amounts to scaled values.
    function _tokenDecimals(Currency currency) internal view returns (uint8) {
        address addr = Currency.unwrap(currency);
        if (addr == address(0)) return 18; // native ETH
        try IERC20Metadata(addr).decimals() returns (uint8 d) {
            return d;
        } catch {
            return 18; // conservative fallback for non-compliant tokens
        }
    }

    /// @notice Full-range tick boundaries aligned to the pool's tickSpacing.
    /// Same ticks every time → V4 keeps a single position keyed by (owner=hook, tickLower, tickUpper, salt=0).
    function _fullRangeTicks(int24 tickSpacing) internal pure returns (int24 tickLower, int24 tickUpper) {
        tickLower = (TickMath.MIN_TICK / tickSpacing) * tickSpacing;
        tickUpper = (TickMath.MAX_TICK / tickSpacing) * tickSpacing;
    }

    /// @notice Pay a currency debit to the PoolManager via the sync → transfer → settle dance.
    /// No-op if amount is zero. ERC20 path only; native ETH currencies are unsupported in the MVP.
    function _settleERC20(Currency currency, uint256 amount) internal {
        if (amount == 0) return;
        poolManager.sync(currency);
        IERC20(Currency.unwrap(currency)).safeTransfer(address(poolManager), amount);
        poolManager.settle();
    }

    /// @notice Claim a currency credit from the PoolManager directly to `to`.
    /// No-op if amount is zero. Works for both ERC20 and native; PoolManager handles the dispatch.
    function _takeERC20(Currency currency, address to, uint256 amount) internal {
        if (amount == 0) return;
        poolManager.take(currency, to, amount);
    }

    // ============================================================
    // Views
    // ============================================================

    /// @notice Queried by LiquidsDemoShareToken's transfer guard. Returns true if `user` has any
    /// outstanding scaled debt on `poolId`. Lets the share token block holder-to-holder transfers
    /// while a borrow is open, closing the "sell collateral to confederate, then default" escape.
    /// @dev This is the only view on the hook itself — all other read-only queries live on the
    /// {LiquidsLens} periphery contract (with projected-to-now accrual) to keep the hook under
    /// the 24KB EIP-170 bytecode limit.
    function hasOpenDebt(PoolId poolId, address user) external view returns (bool) {
        return debts[poolId][user].scaledDebt > 0;
    }
}
