// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IPriceFeed} from "../interfaces/IPriceFeed.sol";

/// @notice Manipulation-resistant USD valuation for a full-range Uniswap V4 position.
/// @dev Uses ONLY oracle prices, never the pool's spot price (sqrtPriceX96).
///      Formula:  V_wad = 2 * L * sqrt(P0_per_unit_wad * P1_per_unit_wad)
///      where P_i_per_unit_wad is the WAD-scaled USD value of a single smallest unit of token_i
///      (i.e., wei for an 18-decimal token, 10^-6 for a 6-decimal token).
///      Derivation: a V4 full-range position satisfies L = sqrt(amount0 * amount1), the same
///      invariant Uniswap V2 used. The Alpha Homora fair-value formula applies directly and is
///      provably price-manipulation resistant — a pool dump moves spot value above fair, so the
///      fair value is a conservative lower bound, which is exactly what we want when valuing
///      collateral for borrowing.
library PositionValue {
    error StalePrice();
    error InvalidPrice();

    /// @notice Read a Chainlink-style feed, validate freshness, and return the WAD USD price
    /// of one smallest unit of the underlying token.
    /// @param feed price feed implementing IPriceFeed (AggregatorV3 ABI subset)
    /// @param tokenDecimals decimals of the priced ERC20 (e.g., 18 for ETH, 6 for USDT)
    /// @param maxStaleness max seconds since the feed's last update that we'll tolerate
    /// @return USD value of one smallest unit, WAD-scaled (1e18 = $1 per smallest unit)
    function fetchPriceWad(IPriceFeed feed, uint8 tokenDecimals, uint256 maxStaleness) internal view returns (uint256) {
        (, int256 answer,, uint256 updatedAt,) = feed.latestRoundData();
        if (answer <= 0) revert InvalidPrice();
        if (block.timestamp - updatedAt > maxStaleness) revert StalePrice();
        return pricePerUnitWad(answer, feed.decimals(), tokenDecimals);
    }

    /// @notice Convert a raw oracle answer to USD-per-smallest-unit in WAD.
    /// @dev Two-step scaling: first lift the oracle answer to a WAD-USD value of one *full* token,
    ///      then divide by 10^tokenDecimals to get per-smallest-unit. Pure function — safe to inline.
    function pricePerUnitWad(int256 chainlinkPrice, uint8 chainlinkDecimals, uint8 tokenDecimals)
        internal
        pure
        returns (uint256)
    {
        if (chainlinkPrice <= 0) revert InvalidPrice();
        // price-of-one-full-token in WAD = answer * 10^(18 - chainlinkDecimals)
        uint256 priceFullWad = uint256(chainlinkPrice) * (10 ** (18 - chainlinkDecimals));
        // price-per-smallest-unit in WAD = price-of-one-full-token / 10^tokenDecimals
        return priceFullWad / (10 ** tokenDecimals);
    }

    /// @notice Fair USD value (WAD) of a full-range V4 position using oracle prices.
    /// @param liquidity V4 liquidity units (uint128)
    /// @param price0PerUnitWad WAD USD per smallest unit of currency0 (from fetchPriceWad)
    /// @param price1PerUnitWad WAD USD per smallest unit of currency1 (from fetchPriceWad)
    function fairValueWad(uint128 liquidity, uint256 price0PerUnitWad, uint256 price1PerUnitWad)
        internal
        pure
        returns (uint256)
    {
        if (liquidity == 0) return 0;
        uint256 product = price0PerUnitWad * price1PerUnitWad;
        uint256 sqrtProduct = Math.sqrt(product);
        return 2 * uint256(liquidity) * sqrtProduct;
    }
}
