// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {PoolId} from "v4-core/types/PoolId.sol";

/// @notice Per-pool ERC20 share token issued by LiquidsHookDemo for each registered pool.
/// Mint and burn are gated to the deploying hook. Name/symbol carry the "DEMO" prefix as
/// an on-chain warning that this is a hackathon build.
///
/// @dev Transfer guard: a holder with outstanding debt in the parent hook cannot transfer their
/// shares. This neutralizes the "borrow, sell collateral to confederate, default" exploit.
/// Mints (from=0) and burns (to=0) are hook-mediated and skip the guard.
interface IDebtChecker {
    function hasOpenDebt(PoolId poolId, address user) external view returns (bool);
}

contract LiquidsDemoShareToken is ERC20 {
    error OnlyHook();
    error TransferLocked();

    /// @notice The LiquidsHookDemo instance that deployed this share token.
    address public immutable hook;
    /// @notice Pool this share token represents. Used to ask the hook about debt status.
    PoolId public immutable poolId;

    modifier onlyHook() {
        if (msg.sender != hook) revert OnlyHook();
        _;
    }

    constructor(string memory name_, string memory symbol_, PoolId pid) ERC20(name_, symbol_) {
        hook = msg.sender;
        poolId = pid;
    }

    function mint(address to, uint256 amount) external onlyHook {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyHook {
        _burn(from, amount);
    }

    /// @notice OZ ERC20 unified mint/burn/transfer hook. Lock real transfers while sender has debt.
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            // Real holder-to-holder transfer. Block if `from` has an open borrow position.
            if (IDebtChecker(hook).hasOpenDebt(poolId, from)) revert TransferLocked();
        }
        super._update(from, to, value);
    }
}
