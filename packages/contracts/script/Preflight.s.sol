// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import {IPriceFeed} from "../src/interfaces/IPriceFeed.sol";

/// @notice Read-only preflight: verifies that every chain-side dependency the deploy assumes
/// is actually live and well at the addresses in .env. Run this BEFORE broadcasting DeployCore
/// or CreateDemoPool to catch typos, missing deployments, stale oracles, decimals mismatches.
///
/// Usage (no broadcast — pure RPC read):
///   forge script script/Preflight.s.sol:Preflight --rpc-url x_layer_mainnet
///
/// Reads PRIVATE_KEY only to print the resulting EOA + balance; does not sign anything.
contract Preflight is Script {
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address internal constant DEFAULT_CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    /// @dev Same value as LiquidsHookDemo.MAX_PRICE_STALENESS — oracles must update at least this often.
    /// Sized for X Layer's 24-hour Chainlink heartbeat with 2-hour buffer.
    uint256 internal constant MAX_STALENESS = 26 hours;

    function run() external view {
        console2.log("=== Liquids preflight ===");
        console2.log("");

        // -- Deployer EOA -------------------------------------------------
        uint256 pk = vm.envOr("PRIVATE_KEY", uint256(0));
        if (pk == 0) {
            console2.log(unicode" PRIVATE_KEY unset — set it before broadcasting.");
        } else {
            address deployer = vm.addr(pk);
            console2.log("Deployer EOA:    ", deployer);
            console2.log("Deployer balance:", deployer.balance);
            if (deployer.balance == 0) {
                console2.log(unicode" Zero balance — fund the EOA with OKB before deploying.");
            }
        }
        console2.log("");

        // -- Stage 1 deps -------------------------------------------------
        address pm = vm.envAddress("V4_POOL_MANAGER");
        _checkCode("V4 PoolManager", pm);

        address create2 = vm.envOr("CREATE2_DEPLOYER", DEFAULT_CREATE2_DEPLOYER);
        _checkCode("CREATE2 deployer", create2);

        bool permit2Live = PERMIT2.code.length > 0;
        console2.log("Permit2 canonical: ", PERMIT2);
        if (permit2Live) {
            console2.log("  OK - Permit2 code present");
        } else {
            console2.log(unicode" Permit2 NOT deployed - supplyWithPermit2 / repayWithPermit2 will revert");
        }
        console2.log("");

        // -- Stage 2 deps (skip silently if unset; useful for stage-1-only preflight) --
        address tokenA = vm.envOr("TOKEN_A", address(0));
        if (tokenA == address(0)) {
            console2.log("Stage 2 vars unset - skipping demo-pool preflight.");
            return;
        }

        address tokenB = vm.envAddress("TOKEN_B");
        address oracleA = vm.envAddress("ORACLE_A");
        address oracleB = vm.envAddress("ORACLE_B");

        _checkToken("TOKEN_A", tokenA);
        _checkToken("TOKEN_B", tokenB);
        _checkOracle("ORACLE_A", oracleA);
        _checkOracle("ORACLE_B", oracleB);

        // Verify sort order so the user understands the resulting currency0/currency1 mapping.
        console2.log("");
        if (tokenA < tokenB) {
            console2.log("Sort order:        TOKEN_A is currency0, TOKEN_B is currency1");
        } else {
            console2.log("Sort order:        TOKEN_B is currency0, TOKEN_A is currency1");
        }

        // Hook address (optional — only set after Stage 1).
        address hook = vm.envOr("HOOK", address(0));
        if (hook != address(0)) {
            _checkCode("HOOK (stage 1)", hook);
        }

        console2.log("");
        console2.log("=== Preflight complete ===");
    }

    function _checkCode(string memory label, address a) internal view {
        console2.log(label, a);
        uint256 size = a.code.length;
        if (size == 0) {
            console2.log(unicode"  ERROR: no contract code at this address.");
        } else {
            console2.log("  OK - code size:", size);
        }
    }

    function _checkToken(string memory label, address a) internal view {
        console2.log(label, a);
        if (a.code.length == 0) {
            console2.log(unicode"  ERROR: no contract code.");
            return;
        }
        try IERC20Metadata(a).symbol() returns (string memory s) {
            console2.log("  symbol:  ", s);
        } catch {
            console2.log(unicode"  symbol() reverted (non-compliant ERC20?)");
        }
        try IERC20Metadata(a).decimals() returns (uint8 d) {
            console2.log("  decimals:", d);
        } catch {
            console2.log(unicode"  decimals() reverted - hook will fall back to 18.");
        }
    }

    function _checkOracle(string memory label, address a) internal view {
        console2.log(label, a);
        if (a.code.length == 0) {
            console2.log(unicode"  ERROR: no contract code.");
            return;
        }
        try IPriceFeed(a).decimals() returns (uint8 d) {
            console2.log("  feed decimals:", d);
        } catch {
            console2.log(unicode"  decimals() reverted - not a valid feed.");
            return;
        }
        try IPriceFeed(a).description() returns (string memory desc) {
            console2.log("  description:  ", desc);
        } catch {}

        try IPriceFeed(a).latestRoundData() returns (uint80, int256 answer, uint256, uint256 updatedAt, uint80) {
            console2.log("  last answer:   ", answer);
            console2.log("  last updated:  ", updatedAt);
            if (answer <= 0) {
                console2.log(unicode"  ERROR: non-positive answer - hook reverts on this.");
            }
            uint256 age = block.timestamp - updatedAt;
            console2.log("  staleness (s): ", age);
            if (age > MAX_STALENESS) {
                console2.log(unicode"  ERROR: oracle stale beyond MAX_PRICE_STALENESS (26h) - hook will reject.");
            } else {
                console2.log(unicode"  OK - fresh.");
            }
        } catch {
            console2.log(unicode"  ERROR: latestRoundData() reverted.");
        }
    }
}
