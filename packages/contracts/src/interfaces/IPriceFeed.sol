// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Chainlink-compatible price feed interface.
/// Used by LiquidsHookDemo to price volatile pool currencies in USD.
/// Stable currencies (e.g., USDT0) skip oracle by passing address(0) at registration.
interface IPriceFeed {
    function decimals() external view returns (uint8);

    function description() external view returns (string memory);

    function version() external view returns (uint256);

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}
