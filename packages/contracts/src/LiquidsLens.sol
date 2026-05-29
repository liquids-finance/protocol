// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {Currency} from "v4-core/types/Currency.sol";

import {LiquidsHookDemo} from "./LiquidsHook.sol";
import {LiquidsDemoShareToken} from "./LiquidsShareToken.sol";
import {IPriceFeed} from "./interfaces/IPriceFeed.sol";
import {InterestRateModel} from "./libraries/InterestRateModel.sol";
import {PositionValue} from "./libraries/PositionValue.sol";

/// @notice Stateless periphery view-helper for the Liquids hook. Exists for two reasons:
///   1. Bytecode budget — moving view functions off the hook frees room under EIP-170 (24,576B).
///   2. Projected accruals — the hook's stored `borrowIndex` only updates on write ops; this lens
///      forward-projects it to `block.timestamp` using the same kink rate model the hook applies on
///      next write. Every reading function returns values consistent with what a user would observe
///      after triggering an accrue this block, with no on-chain state change.
///
/// All math here mirrors the hook 1:1. Constants are duplicated as `internal constant` to avoid
/// per-call external getter overhead; values must be kept in sync at change time.
///
/// @dev Read-only. No funds custody, no state writes, no special privileges.
contract LiquidsLensDemo {
    using PoolIdLibrary for PoolKey;

    // ============================================================
    // Mirrored constants (must equal the hook's internal constants).
    // Exposed `public` so frontends and tests can read risk parameters without
    // crossing the hook's tight bytecode budget.
    // ============================================================

    uint256 public constant WAD = 1e18;
    uint256 public constant BPS_DENOM = 10_000;

    uint256 public constant BASE_RATE_WAD = 0.01e18;
    uint256 public constant SLOPE1_WAD = 0.06e18;
    uint256 public constant SLOPE2_WAD = 1.0e18;
    uint256 public constant KINK_U_WAD = 0.7e18;
    uint256 public constant SECONDS_PER_YEAR = 365 days;

    uint256 public constant MAX_PRICE_STALENESS = 26 hours;

    // ============================================================
    // Hook reference (set at deploy)
    // ============================================================

    LiquidsHookDemo public immutable HOOK;

    constructor(LiquidsHookDemo _hook) {
        HOOK = _hook;
    }

    // ============================================================
    // Public projected views
    // ============================================================

    /// @notice Current debt of `user` on `key` in the borrow asset's raw units,
    /// projected forward to `block.timestamp` using the same kink rate model the hook applies.
    function debtOf(PoolKey calldata key, address user) external view returns (uint256) {
        uint256 scaledDebt = HOOK.debts(key.toId(), user);
        return (scaledDebt * _projectedBorrowIndex(key)) / WAD;
    }

    /// @notice Health factor of `user` on `key` in WAD (1e18 = 1.0), projected.
    /// HF = collateralUSD / debtUSD. Returns type(uint256).max for users with no debt.
    function healthFactor(PoolKey calldata key, address user) external view returns (uint256) {
        PoolId pid = key.toId();
        uint256 projectedIndex = _projectedBorrowIndex(key);
        uint256 scaledDebt = HOOK.debts(pid, user);
        uint256 debtAsset = (scaledDebt * projectedIndex) / WAD;
        uint256 debtWad = _borrowAssetUSDWad(key, debtAsset);
        if (debtWad == 0) return type(uint256).max;

        LiquidsDemoShareToken sToken = _shareToken(pid);
        uint256 totalShares = sToken.totalSupply();
        if (totalShares == 0) return 0;

        uint256 totalAssetsWad = _totalAssetsWadProjected(key, projectedIndex);
        uint256 userCollateralWad = (sToken.balanceOf(user) * totalAssetsWad) / totalShares;
        return (userCollateralWad * WAD) / debtWad;
    }

    /// @notice USD-WAD value of one vault share, projected. Returns 0 if no shares minted yet.
    function shareValue(PoolKey calldata key) external view returns (uint256) {
        LiquidsDemoShareToken sToken = _shareToken(key.toId());
        uint256 totalShares = sToken.totalSupply();
        if (totalShares == 0) return 0;
        uint256 totalAssetsWad = _totalAssetsWadProjected(key, _projectedBorrowIndex(key));
        return (totalAssetsWad * WAD) / totalShares;
    }

    /// @notice Total vault assets in USD-WAD: V4 fair value + outstanding debt receivable (projected).
    function totalAssets(PoolKey calldata key) external view returns (uint256) {
        return _totalAssetsWadProjected(key, _projectedBorrowIndex(key));
    }

    /// @notice Utilization U = debtUSD / totalAssetsUSD, WAD-scaled, projected.
    function utilization(PoolKey calldata key) external view returns (uint256) {
        return _utilizationAtIndex(key, _projectedBorrowIndex(key));
    }

    /// @notice Annual borrow rate in WAD at current (projected) utilization.
    function borrowAPY(PoolKey calldata key) external view returns (uint256) {
        return InterestRateModel.borrowRatePerYearWad(
            _utilizationAtIndex(key, _projectedBorrowIndex(key)), BASE_RATE_WAD, SLOPE1_WAD, SLOPE2_WAD, KINK_U_WAD
        );
    }

    /// @notice Annual lending rate paid to LPs in WAD: borrowAPY × utilization (reserveFactor = 0 in MVP).
    function lendingAPY(PoolKey calldata key) external view returns (uint256) {
        uint256 uWad = _utilizationAtIndex(key, _projectedBorrowIndex(key));
        uint256 bAPY = InterestRateModel.borrowRatePerYearWad(uWad, BASE_RATE_WAD, SLOPE1_WAD, SLOPE2_WAD, KINK_U_WAD);
        return (bAPY * uWad) / WAD;
    }

    // ============================================================
    // Raw (non-projected) views — match the hook's pre-Lens behavior 1:1.
    // Useful for tests verifying borrowIndex stickiness across writes.
    // ============================================================

    /// @notice Same as {debtOf} but using the hook's stored (non-projected) borrowIndex.
    function debtOfRaw(PoolKey calldata key, address user) external view returns (uint256) {
        PoolId pid = key.toId();
        (,,, uint256 storedIdx) = HOOK.vaults(pid);
        uint256 scaledDebt = HOOK.debts(pid, user);
        return (scaledDebt * storedIdx) / WAD;
    }

    /// @notice Stored (non-projected) borrowIndex for `key`.
    function borrowIndex(PoolKey calldata key) external view returns (uint256) {
        (,,, uint256 idx) = HOOK.vaults(key.toId());
        return idx;
    }

    /// @notice Projected borrowIndex that the hook would record if accrue ran in this block.
    function projectedBorrowIndex(PoolKey calldata key) external view returns (uint256) {
        return _projectedBorrowIndex(key);
    }

    // ============================================================
    // Internal math (mirrors the hook)
    // ============================================================

    /// @dev Compute borrowIndex projected forward to `block.timestamp` using stored utilization
    /// (snapshot at the last write, same as the hook would do at next accrue).
    function _projectedBorrowIndex(PoolKey calldata key) internal view returns (uint256) {
        PoolId pid = key.toId();
        (, uint64 lastAccrualTime,, uint256 storedIndex) = HOOK.vaults(pid);

        uint256 elapsed = block.timestamp - lastAccrualTime;
        if (elapsed == 0) return storedIndex;

        // Utilization at the STORED index — matches what the hook reads before applying accrue.
        uint256 uWad = _utilizationAtIndex(key, storedIndex);
        uint256 ratePerSec = InterestRateModel.borrowRatePerSecondWad(
            uWad, BASE_RATE_WAD, SLOPE1_WAD, SLOPE2_WAD, KINK_U_WAD, SECONDS_PER_YEAR
        );
        return InterestRateModel.applyLinearAccrual(storedIndex, ratePerSec, elapsed);
    }

    /// @dev Utilization given a specific borrowIndex (lets us evaluate U at either stored or projected).
    function _utilizationAtIndex(PoolKey calldata key, uint256 idx) internal view returns (uint256) {
        uint256 totalWad = _totalAssetsWadProjected(key, idx);
        if (totalWad == 0) return 0;
        uint256 debt = _totalDebtAtIndex(key.toId(), idx);
        uint256 debtWad = _borrowAssetUSDWad(key, debt);
        return (debtWad * WAD) / totalWad;
    }

    /// @dev Total vault assets in USD-WAD at a specific borrowIndex.
    function _totalAssetsWadProjected(PoolKey calldata key, uint256 idx) internal view returns (uint256) {
        uint256 v4Wad = _v4ValueUSDWad(key);
        uint256 debt = _totalDebtAtIndex(key.toId(), idx);
        uint256 debtWad = _borrowAssetUSDWad(key, debt);
        return v4Wad + debtWad;
    }

    /// @dev Aggregate debt across all borrowers at a given index.
    function _totalDebtAtIndex(PoolId pid, uint256 idx) internal view returns (uint256) {
        (,, uint256 totalScaledDebt,) = HOOK.vaults(pid);
        return (totalScaledDebt * idx) / WAD;
    }

    /// @dev Oracle-priced V4 fair value of the vault's aggregate position.
    function _v4ValueUSDWad(PoolKey calldata key) internal view returns (uint256) {
        PoolId pid = key.toId();
        (uint128 totalLiquidity,,,) = HOOK.vaults(pid);
        if (totalLiquidity == 0) return 0;
        (IPriceFeed oracle0, IPriceFeed oracle1,,) = HOOK.configs(pid);

        uint256 p0 = PositionValue.fetchPriceWad(oracle0, _tokenDecimals(key.currency0), MAX_PRICE_STALENESS);
        uint256 p1 = PositionValue.fetchPriceWad(oracle1, _tokenDecimals(key.currency1), MAX_PRICE_STALENESS);
        return PositionValue.fairValueWad(totalLiquidity, p0, p1);
    }

    /// @dev Convert a raw borrow-asset amount to USD-WAD via the borrow side's oracle.
    function _borrowAssetUSDWad(PoolKey calldata key, uint256 amount) internal view returns (uint256) {
        if (amount == 0) return 0;
        PoolId pid = key.toId();
        (IPriceFeed oracle0, IPriceFeed oracle1,, uint8 borrowIdx) = HOOK.configs(pid);
        Currency borrowCurrency = borrowIdx == 0 ? key.currency0 : key.currency1;
        IPriceFeed feed = borrowIdx == 0 ? oracle0 : oracle1;
        uint256 priceWad = PositionValue.fetchPriceWad(feed, _tokenDecimals(borrowCurrency), MAX_PRICE_STALENESS);
        return amount * priceWad;
    }

    function _shareToken(PoolId pid) internal view returns (LiquidsDemoShareToken) {
        (,, LiquidsDemoShareToken sToken,) = HOOK.configs(pid);
        return sToken;
    }

    function _tokenDecimals(Currency currency) internal view returns (uint8) {
        address addr = Currency.unwrap(currency);
        if (addr == address(0)) return 18;
        try IERC20Metadata(addr).decimals() returns (uint8 d) {
            return d;
        } catch {
            return 18;
        }
    }
}
