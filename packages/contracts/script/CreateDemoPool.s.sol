// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";

import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId} from "v4-core/types/PoolId.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";

import {LiquidsHookDemo} from "../src/LiquidsHook.sol";
import {IPriceFeed} from "../src/interfaces/IPriceFeed.sol";

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/// @notice Register a demo lending market (xETH / USDT0) on the already-deployed Liquids hook.
///
/// Required env:
///   PRIVATE_KEY              — broadcaster
///   HOOK                     — deployed LiquidsHookDemo address (output of DeployCore)
///   TOKEN_A                  — first token (will be sorted by address into currency0 vs currency1)
///   TOKEN_B                  — second token
///   ORACLE_A                 — Chainlink-style price feed for TOKEN_A
///   ORACLE_B                 — Chainlink-style price feed for TOKEN_B
///   BORROW_SIDE              — "A" or "B" — which token is borrowable from the pool
///   INITIAL_TICK             — int24 starting tick (must be a multiple of TICK_SPACING).
///                              Script converts to sqrtPriceX96 via TickMath. Example:
///                              200200 → ~$1989 ETH per USDT (USDT-currency0, ETH-currency1).
///
/// Optional env:
///   POOL_FEE                 — basis points, default 500 (0.05%)
///   TICK_SPACING             — default 10
///
/// Usage:
///   forge script script/CreateDemoPool.s.sol:CreateDemoPool --rpc-url x_layer_mainnet --broadcast
contract CreateDemoPool is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address hookAddr = vm.envAddress("HOOK");
        address tokenA = vm.envAddress("TOKEN_A");
        address tokenB = vm.envAddress("TOKEN_B");
        address oracleA = vm.envAddress("ORACLE_A");
        address oracleB = vm.envAddress("ORACLE_B");
        string memory borrowSide = vm.envString("BORROW_SIDE");
        int24 initialTick = int24(vm.envInt("INITIAL_TICK"));

        uint24 fee = uint24(vm.envOr("POOL_FEE", uint256(500)));
        int24 tickSpacing = int24(int256(vm.envOr("TICK_SPACING", uint256(10))));

        require(initialTick % tickSpacing == 0, "INITIAL_TICK must be a multiple of TICK_SPACING");
        uint160 initialSqrtPriceX96 = TickMath.getSqrtPriceAtTick(initialTick);

        // V4 PoolKey requires currency0 < currency1 by address.
        (address t0, address t1, address o0, address o1, bool aIsToken0) = _sortPair(tokenA, tokenB, oracleA, oracleB);

        // Borrow side index follows the sorted ordering, not the user's A/B labels.
        uint8 borrowIdx = _resolveBorrowIdx(borrowSide, aIsToken0);

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(t0),
            currency1: Currency.wrap(t1),
            fee: fee,
            tickSpacing: tickSpacing,
            hooks: IHooks(hookAddr)
        });

        LiquidsHookDemo hook = LiquidsHookDemo(hookAddr);

        vm.startBroadcast(deployerKey);

        (PoolId poolId, address shareToken) =
            hook.createPool(key, initialSqrtPriceX96, IPriceFeed(o0), IPriceFeed(o1), borrowIdx);

        vm.stopBroadcast();

        // Reproduce the share-token name/symbol the hook composes so the user has the exact
        // strings for OKLink verify-contract (which needs constructor args).
        string memory sym0 = _safeSymbol(t0);
        string memory sym1 = _safeSymbol(t1);
        string memory shareName = string.concat("Liquidsfi DEMO ", sym0, "/", sym1, " Vault - Hackathon Build");
        string memory shareSymbol = string.concat("lqfDEMO-", sym0, "-", sym1);

        console2.log("");
        console2.log("=== Demo pool registered ===");
        console2.log("Hook:           ", hookAddr);
        console2.log("currency0:      ", t0);
        console2.log("currency1:      ", t1);
        console2.log("fee:            ", fee);
        console2.log("tickSpacing:    ", tickSpacing);
        console2.log("borrowIdx:      ", borrowIdx);
        console2.log("shareToken:     ", shareToken);
        console2.log("initialTick:    ", initialTick);
        console2.log("initialSqrtX96: ", uint256(initialSqrtPriceX96));
        console2.log("");
        console2.log("--- For OKLink verify of LiquidsDemoShareToken ---");
        console2.log("name:   ", shareName);
        console2.log("symbol: ", shareSymbol);
        console2.log("poolId: ");
        console2.logBytes32(PoolId.unwrap(poolId));
    }

    function _safeSymbol(address token) internal view returns (string memory) {
        try IERC20Metadata(token).symbol() returns (string memory s) {
            return s;
        } catch {
            return "TKN";
        }
    }

    function _sortPair(address tokenA, address tokenB, address oracleA, address oracleB)
        internal
        pure
        returns (address t0, address t1, address o0, address o1, bool aIsToken0)
    {
        if (tokenA < tokenB) {
            return (tokenA, tokenB, oracleA, oracleB, true);
        } else {
            return (tokenB, tokenA, oracleB, oracleA, false);
        }
    }

    function _resolveBorrowIdx(string memory borrowSide, bool aIsToken0) internal pure returns (uint8) {
        bytes32 h = keccak256(bytes(borrowSide));
        if (h == keccak256("A")) {
            return aIsToken0 ? 0 : 1;
        }
        if (h == keccak256("B")) {
            return aIsToken0 ? 1 : 0;
        }
        revert("BORROW_SIDE must be 'A' or 'B'");
    }
}
