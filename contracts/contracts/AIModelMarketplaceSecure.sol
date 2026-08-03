// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AIModelMarketplaceV2} from "./AIModelMarketplaceV2.sol";

/// @title AIModelMarketplaceSecure
/// @notice V2 marketplace with an immediate incident pause separated from
/// timelocked governance actions.
/// @dev Existing V2 callers and functions remain available unchanged.
contract AIModelMarketplaceSecure is AIModelMarketplaceV2 {
    bytes32 public constant EMERGENCY_PAUSER_ROLE = keccak256("EMERGENCY_PAUSER_ROLE");

    event EmergencyPaused(address indexed account);

    constructor(
        address registryAddress,
        address payable treasury,
        address governance,
        address emergencyPauser
    ) AIModelMarketplaceV2(registryAddress, treasury, governance) {
        require(emergencyPauser != address(0), "MarketplaceSecure: zero emergency pauser");
        _grantRole(EMERGENCY_PAUSER_ROLE, emergencyPauser);
    }

    /// @notice Pause listings and purchases immediately during an incident.
    /// @dev Only the dedicated emergency operator receives this role; unpausing
    /// remains a governance action through PAUSER_ROLE and the timelock.
    function pauseEmergency() external onlyRole(EMERGENCY_PAUSER_ROLE) {
        _pause();
        emit EmergencyPaused(msg.sender);
    }
}
