// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPriceFeed} from "../../src/interfaces/IPriceFeed.sol";

/// @notice Chainlink AggregatorV3-compatible mock with knobs for price and staleness. Lets tests
/// simulate market moves (drop ETH 30% to trigger liquidation) and stale-feed reverts.
contract MockPriceFeed is IPriceFeed {
    uint8 public immutable feedDecimals;
    string public feedDescription;
    int256 public answer;
    uint256 public lastUpdate;

    constructor(uint8 decimals_, int256 initialAnswer, string memory description_) {
        feedDecimals = decimals_;
        answer = initialAnswer;
        feedDescription = description_;
        lastUpdate = block.timestamp;
    }

    /// @notice Test knob: bump the reported price.
    function setPrice(int256 newAnswer) external {
        answer = newAnswer;
        lastUpdate = block.timestamp;
    }

    /// @notice Test knob: rewind the feed's last update to make it look stale.
    function setLastUpdate(uint256 t) external {
        lastUpdate = t;
    }

    function decimals() external view override returns (uint8) {
        return feedDecimals;
    }

    function description() external view override returns (string memory) {
        return feedDescription;
    }

    function version() external pure override returns (uint256) {
        return 1;
    }

    function latestRoundData()
        external
        view
        override
        returns (uint80 roundId, int256 ans, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        return (1, answer, lastUpdate, lastUpdate, 1);
    }
}
