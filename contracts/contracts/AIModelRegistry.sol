// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title AIModelRegistry
/// @notice ERC-721 registry for AI model ownership, metadata, and creator royalties.
contract AIModelRegistry is ERC721, ERC2981, Ownable {
    struct Model {
        address creator;
        string ipfsHash;
        string metadataURI;
        uint96 royaltyBps;
    }

    uint96 public constant MAX_ROYALTY_BPS = 2_500;
    uint256 private _nextModelId = 1;
    mapping(uint256 modelId => Model model) private _models;

    event ModelRegistered(
        uint256 indexed modelId,
        address indexed creator,
        string ipfsHash,
        string metadataURI
    );
    event MetadataUpdated(uint256 indexed modelId, string newURI);
    event ModelRoyaltyUpdated(uint256 indexed modelId, uint96 royaltyBps);

    constructor() ERC721("NeuralBazaar AI Model", "NAIM") Ownable(msg.sender) {}

    /// @notice Register a model and mint its ownership token to the caller.
    function registerModel(
        string calldata ipfsHash,
        string calldata metadataURI,
        uint96 royaltyBps
    ) external returns (uint256 modelId) {
        require(bytes(ipfsHash).length > 0, "Registry: empty IPFS hash");
        require(bytes(metadataURI).length > 0, "Registry: empty metadata URI");
        require(royaltyBps <= MAX_ROYALTY_BPS, "Registry: royalty too high");

        modelId = _nextModelId++;
        _safeMint(msg.sender, modelId);
        _models[modelId] = Model(msg.sender, ipfsHash, metadataURI, royaltyBps);
        _setTokenRoyalty(modelId, msg.sender, royaltyBps);

        emit ModelRegistered(modelId, msg.sender, ipfsHash, metadataURI);
    }

    /// @notice Update the metadata URI for a model owned by or originally created by the caller.
    function updateMetadata(uint256 modelId, string calldata newURI) external {
        require(_exists(modelId), "Registry: model missing");
        require(bytes(newURI).length > 0, "Registry: empty URI");
        Model storage model = _models[modelId];
        require(msg.sender == model.creator || msg.sender == ownerOf(modelId), "Registry: not authorized");
        model.metadataURI = newURI;
        emit MetadataUpdated(modelId, newURI);
    }

    /// @notice Transfer model ownership while preserving original creator and royalty data.
    function transferOwnership(uint256 modelId, address newOwner) external {
        require(_exists(modelId), "Registry: model missing");
        require(newOwner != address(0), "Registry: zero owner");
        address currentOwner = ownerOf(modelId);
        require(msg.sender == currentOwner || getApproved(modelId) == msg.sender || isApprovedForAll(currentOwner, msg.sender), "Registry: not authorized");
        _transfer(currentOwner, newOwner, modelId);
    }

    /// @notice Return the complete model record.
    function modelDetails(uint256 modelId) external view returns (Model memory) {
        require(_exists(modelId), "Registry: model missing");
        return _models[modelId];
    }

    /// @notice Return the original creator address for a model.
    function creatorOf(uint256 modelId) external view returns (address) {
        require(_exists(modelId), "Registry: model missing");
        return _models[modelId].creator;
    }

    /// @notice Return the number of the next model token to be minted.
    function nextModelId() external view returns (uint256) {
        return _nextModelId;
    }

    function _exists(uint256 modelId) internal view returns (bool) {
        return _ownerOf(modelId) != address(0);
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, ERC2981) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
