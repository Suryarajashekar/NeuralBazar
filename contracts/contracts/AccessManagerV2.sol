// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title AccessManagerV2
/// @notice Separates governance from the backend operator that grants post-purchase access.
/// @dev The admin address should be a multisig and the granter should be a dedicated hot wallet.
contract AccessManagerV2 is AccessControl {
    bytes32 public constant GRANTER_ROLE = keccak256("GRANTER_ROLE");
    mapping(address user => mapping(uint256 modelId => bool)) private _access;
    event AccessGranted(address indexed user, uint256 indexed modelId, address indexed operator);
    event AccessRevoked(address indexed user, uint256 indexed modelId, address indexed operator);

    /// @param governance Multisig that administers roles.
    /// @param granter Dedicated backend/indexer wallet.
    constructor(address governance, address granter) {
        require(governance != address(0), "AccessV2: zero governance");
        require(granter != address(0), "AccessV2: zero granter");
        _grantRole(DEFAULT_ADMIN_ROLE, governance);
        _grantRole(GRANTER_ROLE, granter);
    }

    /// @notice Grant access after a verified purchase event.
    function grantAccess(address user, uint256 modelId) external onlyRole(GRANTER_ROLE) { require(user != address(0), "AccessV2: zero user"); _access[user][modelId] = true; emit AccessGranted(user, modelId, msg.sender); }
    /// @notice Revoke access during a refund, takedown, or abuse response.
    function revokeAccess(address user, uint256 modelId) external onlyRole(GRANTER_ROLE) { _access[user][modelId] = false; emit AccessRevoked(user, modelId, msg.sender); }
    /// @notice Check whether an address can access a model.
    function hasAccess(address user, uint256 modelId) external view returns (bool) { return _access[user][modelId]; }
}
