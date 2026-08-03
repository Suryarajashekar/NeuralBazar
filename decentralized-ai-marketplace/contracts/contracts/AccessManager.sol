// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title AccessManager
/// @notice Token-gated access records granted by the backend after a verified purchase event.
contract AccessManager is Ownable {
    mapping(address user => mapping(uint256 modelId => bool)) private _access;

    event AccessGranted(address indexed user, uint256 indexed modelId);
    event AccessRevoked(address indexed user, uint256 indexed modelId);

    constructor() Ownable(msg.sender) {}

    /// @notice Grant a user access to a model. Intended for the trusted indexer signer.
    function grantAccess(address user, uint256 modelId) external onlyOwner {
        require(user != address(0), "Access: zero user");
        _access[user][modelId] = true;
        emit AccessGranted(user, modelId);
    }

    /// @notice Revoke a user's access to a model.
    function revokeAccess(address user, uint256 modelId) external onlyOwner {
        _access[user][modelId] = false;
        emit AccessRevoked(user, modelId);
    }

    /// @notice Return whether a user has purchased access to a model.
    function hasAccess(address user, uint256 modelId) external view returns (bool) {
        return _access[user][modelId];
    }
}
