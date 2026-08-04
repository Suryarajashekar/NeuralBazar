// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// @title AILicenseNFT
/// @notice Transferable, on-chain proof that an address owns a model license.
/// @dev The model artifact hash and creator are immutable for each license.
contract AILicenseNFT is ERC721, ERC2981, AccessControl, Pausable {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    struct LicenseInfo {
        uint256 modelId;
        address creator;
        bytes32 modelHash;
        uint96 royaltyBps;
        uint64 issuedAt;
        string licenseURI;
    }

    uint256 private _nextLicenseId = 1;
    mapping(uint256 licenseId => LicenseInfo info) private _licenses;
    mapping(uint256 licenseId => string uri) private _tokenUris;
    mapping(address account => mapping(uint256 modelId => uint256 balance)) private _licenseBalances;

    event LicenseIssued(
        uint256 indexed licenseId,
        uint256 indexed modelId,
        address indexed licensee,
        address creator,
        bytes32 modelHash,
        string licenseURI
    );

    constructor(address admin) ERC721("NeuralBazaar AI License", "NAIL") {
        require(admin != address(0), "LicenseNFT: zero admin");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
    }

    /// @notice Mint a license as part of an atomic marketplace purchase.
    function issueLicense(
        address licensee,
        uint256 modelId,
        address creator,
        bytes32 modelHash,
        string calldata licenseURI,
        uint96 royaltyBps
    ) external onlyRole(MINTER_ROLE) whenNotPaused returns (uint256 licenseId) {
        require(licensee != address(0), "LicenseNFT: zero licensee");
        require(creator != address(0), "LicenseNFT: zero creator");
        require(modelHash != bytes32(0), "LicenseNFT: empty model hash");
        require(royaltyBps <= 2_500, "LicenseNFT: royalty too high");
        require(bytes(licenseURI).length > 0, "LicenseNFT: empty URI");

        licenseId = _nextLicenseId;
        unchecked { _nextLicenseId++; }
        _licenses[licenseId] = LicenseInfo(modelId, creator, modelHash, royaltyBps, uint64(block.timestamp), licenseURI);
        _tokenUris[licenseId] = licenseURI;
        _safeMint(licensee, licenseId);
        _setTokenRoyalty(licenseId, creator, royaltyBps);
        emit LicenseIssued(licenseId, modelId, licensee, creator, modelHash, licenseURI);
    }

    function licenseDetails(uint256 licenseId) external view returns (LicenseInfo memory) {
        require(_ownerOf(licenseId) != address(0), "LicenseNFT: license missing");
        return _licenses[licenseId];
    }

    function hasModelLicense(address account, uint256 modelId) external view returns (bool) {
        return _licenseBalances[account][modelId] > 0;
    }

    function licenseBalance(address account, uint256 modelId) external view returns (uint256) {
        return _licenseBalances[account][modelId];
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        require(_ownerOf(tokenId) != address(0), "LicenseNFT: license missing");
        return _tokenUris[tokenId];
    }

    function pause() external onlyRole(PAUSER_ROLE) { _pause(); }
    function unpause() external onlyRole(PAUSER_ROLE) { _unpause(); }

    function _update(address to, uint256 tokenId, address auth) internal override returns (address from) {
        require(!paused(), "LicenseNFT: paused");
        from = super._update(to, tokenId, auth);
        uint256 modelId = _licenses[tokenId].modelId;
        if (from != address(0)) {
            unchecked { _licenseBalances[from][modelId]--; }
        }
        if (to != address(0)) _licenseBalances[to][modelId]++;
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, ERC2981, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
