// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Brute-force search for a CREATE2 salt that yields a deployment address whose low 14 bits
/// encode the desired hook permission flags. Used by tests and deployment scripts to make sure
/// `Hooks.validateHookPermissions(...)` passes when the hook contract runs its constructor.
library HookMiner {
    uint160 internal constant FLAG_MASK = uint160((1 << 14) - 1);
    uint256 internal constant MAX_ITERATIONS = 200_000;

    error SaltNotFound();

    function find(address deployer, uint160 flags, bytes memory creationCode, bytes memory constructorArgs)
        internal
        pure
        returns (address hookAddress, bytes32 salt)
    {
        bytes memory bytecode = abi.encodePacked(creationCode, constructorArgs);
        for (uint256 i = 0; i < MAX_ITERATIONS; ++i) {
            salt = bytes32(i);
            hookAddress = computeAddress(deployer, salt, bytecode);
            if (uint160(hookAddress) & FLAG_MASK == flags) return (hookAddress, salt);
        }
        revert SaltNotFound();
    }

    function computeAddress(address deployer, bytes32 salt, bytes memory bytecode) internal pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), deployer, salt, keccak256(bytecode))))));
    }
}
