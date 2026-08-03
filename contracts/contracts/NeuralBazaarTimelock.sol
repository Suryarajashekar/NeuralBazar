// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";

/// @title NeuralBazaarTimelock
/// @notice Timelocked administration for marketplace and access-manager roles.
/// @dev The proposer and executor should normally be the governance multisig.
contract NeuralBazaarTimelock is TimelockController {
    uint256 public constant MINIMUM_DELAY = 1 days;

    event SecurityTimelockConfigured(uint256 indexed minDelay, address indexed admin);

    constructor(
        uint256 minDelay,
        address[] memory proposers,
        address[] memory executors,
        address admin
    ) TimelockController(minDelay, proposers, executors, admin) {
        require(minDelay >= MINIMUM_DELAY, "NeuralBazaarTimelock: delay too short");
        emit SecurityTimelockConfigured(minDelay, admin);
    }
}
