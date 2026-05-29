// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";

import {LiquidsHookDemo} from "../src/LiquidsHook.sol";
import {LiquidsLensDemo} from "../src/LiquidsLens.sol";

import {HookMiner} from "../test/utils/HookMiner.sol";

/// @notice Deploy `LiquidsHookDemo` (via CREATE2 with a mined magic-address salt) and the
/// stateless `LiquidsLensDemo` periphery contract.
///
/// Required env:
///   PRIVATE_KEY              — broadcaster (forge cast wallet new + fund on X Layer)
///   V4_POOL_MANAGER          — official Uniswap V4 PoolManager on the target chain
///
/// Optional env:
///   CREATE2_DEPLOYER         — defaults to Foundry's CREATE2 factory (0x4e59b4...) — required to be
///                              deployed on the target chain or the script reverts
///
/// Usage:
///   forge script script/DeployCore.s.sol:DeployCore --rpc-url x_layer_mainnet --broadcast
///
/// Output: console logs the hook + lens addresses; copy them into your frontend config.
contract DeployCore is Script {
    /// @dev Canonical CREATE2 deployer (deployed on every major EVM chain via deterministic deployer).
    address internal constant DEFAULT_CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    /// @dev Canonical Uniswap Permit2 deployment (same on every EVM chain — if present).
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    /// @dev Hook flag mask matching {LiquidsHookDemo.getHookPermissions}.
    uint160 internal constant HOOK_FLAGS = uint160(
        Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG
            | Hooks.AFTER_SWAP_FLAG
    );

    function run() external returns (LiquidsHookDemo hook, LiquidsLensDemo lens) {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address poolManager = vm.envAddress("V4_POOL_MANAGER");
        address create2Deployer = vm.envOr("CREATE2_DEPLOYER", DEFAULT_CREATE2_DEPLOYER);

        // Sanity: V4 PoolManager exists.
        require(poolManager.code.length > 0, "V4 PoolManager not deployed at provided address");
        // Sanity: deterministic deployer exists.
        require(create2Deployer.code.length > 0, "CREATE2 deployer not deployed on this chain");

        // Soft check: Permit2 presence on this chain. If absent, the supplyWithPermit2 / repayWithPermit2
        // paths will revert at runtime — classic supply / repay still work via ERC20 approve.
        bool permit2Live = PERMIT2.code.length > 0;
        if (!permit2Live) {
            console2.log("");
            console2.log(unicode"  WARNING: Permit2 NOT deployed at canonical address on this chain.");
            console2.log("  Address checked:", PERMIT2);
            console2.log("  supplyWithPermit2 / repayWithPermit2 will revert until Permit2 is bridged.");
            console2.log("  Classic supply / repay (ERC20 approve path) remain functional.");
            console2.log("");
        }

        // Mine a salt so the deployed address bits encode our hook flags (V4 IHooks address-bits check).
        bytes memory ctorArgs = abi.encode(IPoolManager(poolManager));
        (address minedAddr, bytes32 salt) =
            HookMiner.find(create2Deployer, HOOK_FLAGS, type(LiquidsHookDemo).creationCode, ctorArgs);

        console2.log("Mined hook address:", minedAddr);
        console2.log("Salt:", vm.toString(salt));

        vm.startBroadcast(deployerKey);

        hook = new LiquidsHookDemo{salt: salt}(IPoolManager(poolManager));
        require(address(hook) == minedAddr, "DeployCore: hook landed at wrong address");

        lens = new LiquidsLensDemo(hook);

        vm.stopBroadcast();

        console2.log("");
        console2.log("=== Liquids deployment complete ===");
        console2.log("Hook:        ", address(hook));
        console2.log("Lens:        ", address(lens));
        console2.log("Owner:       ", vm.addr(deployerKey));
        console2.log("PoolManager: ", poolManager);
        console2.log("Permit2 live:", permit2Live);
    }
}
