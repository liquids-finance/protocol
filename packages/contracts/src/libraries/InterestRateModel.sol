// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Pure interest-rate math for the Liquids lending hook.
/// All inputs/outputs use WAD precision (1e18 = 100%).
///
/// Borrow rate uses a kink curve: linear slope until utilization reaches the kink,
/// then a steeper slope to choke demand. Lending APY at the caller is computed as
/// borrowAPY * utilization (after a reserve factor cut, which is zero in the MVP).
/// Interest accrual uses a linear approximation: with accruals on every state-changing
/// op, elapsed time is small enough that linear ≈ compound to within a basis point.
library InterestRateModel {
    error InvalidUtilization();

    /// @notice Annual borrow rate at the given utilization.
    /// @param utilizationWad current utilization, 1e18 = 100%
    /// @param baseRateWad rate floor at U=0 (e.g., 0.01e18 = 1%)
    /// @param slope1Wad linear slope in WAD per WAD up to the kink
    /// @param slope2Wad steeper slope above the kink
    /// @param kinkUWad utilization at which slope2 takes over
    /// @return rate per year in WAD (1e18 = 100% APY)
    function borrowRatePerYearWad(
        uint256 utilizationWad,
        uint256 baseRateWad,
        uint256 slope1Wad,
        uint256 slope2Wad,
        uint256 kinkUWad
    ) internal pure returns (uint256) {
        if (utilizationWad > 1e18) revert InvalidUtilization();
        if (utilizationWad <= kinkUWad) {
            return baseRateWad + (slope1Wad * utilizationWad) / 1e18;
        }
        uint256 normalSegment = (slope1Wad * kinkUWad) / 1e18;
        uint256 jumpSegment = (slope2Wad * (utilizationWad - kinkUWad)) / 1e18;
        return baseRateWad + normalSegment + jumpSegment;
    }

    /// @notice Annual borrow rate divided by seconds per year for per-block accrual.
    function borrowRatePerSecondWad(
        uint256 utilizationWad,
        uint256 baseRateWad,
        uint256 slope1Wad,
        uint256 slope2Wad,
        uint256 kinkUWad,
        uint256 secondsPerYear
    ) internal pure returns (uint256) {
        uint256 annual = borrowRatePerYearWad(utilizationWad, baseRateWad, slope1Wad, slope2Wad, kinkUWad);
        return annual / secondsPerYear;
    }

    /// @notice Linear approximation of compound interest:
    ///         newIndex = currentIndex * (1 + ratePerSecond * elapsed)
    /// @dev Accurate for short elapsed periods (our pattern: accrue every state op).
    function applyLinearAccrual(uint256 currentIndex, uint256 ratePerSecondWad, uint256 elapsedSeconds)
        internal
        pure
        returns (uint256)
    {
        if (elapsedSeconds == 0) return currentIndex;
        uint256 growth = ratePerSecondWad * elapsedSeconds; // WAD
        return (currentIndex * (1e18 + growth)) / 1e18;
    }
}
