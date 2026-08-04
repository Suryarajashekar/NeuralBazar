// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";
import {AIModelRegistry} from "./AIModelRegistry.sol";

interface IAILicenseIssuer {
    function issueLicense(
        address licensee,
        uint256 modelId,
        address creator,
        bytes32 modelHash,
        string calldata licenseURI,
        uint96 royaltyBps
    ) external returns (uint256 licenseId);
}

/// @title AIModelMarketplaceV2
/// @notice Governance-controlled model access marketplace with pull payments.
/// @dev Deploy the governance address as a multisig (for example, a Safe).
contract AIModelMarketplaceV2 is AccessControl, EIP712, Pausable, ReentrancyGuard {
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant FEE_MANAGER_ROLE = keccak256("FEE_MANAGER_ROLE");
    bytes32 public constant PURCHASE_AUTHORIZATION_TYPEHASH = keccak256(
        "PurchaseAuthorization(uint256 listingId,address buyer,uint256 nonce,uint256 deadline)"
    );

    struct Listing { uint256 listingId; uint256 modelId; address seller; uint256 price; bool active; }
    struct LicenseListing { uint256 listingId; uint256 licenseId; address seller; uint256 price; bool active; }

    AIModelRegistry public immutable registry;
    address public licenseNFT;
    address payable public platformTreasury;
    uint96 public platformFeeBps;
    uint256 private _nextListingId = 1;
    uint256 private _nextLicenseListingId = 1;
    uint256 public pendingTreasury;
    mapping(uint256 listingId => Listing listing) public listings;
    mapping(uint256 modelId => uint256 listingId) public activeListingByModel;
    mapping(address account => uint256 amount) public pendingWithdrawals;
    mapping(address buyer => uint256 nonce) public purchaseNonces;
    mapping(uint256 listingId => LicenseListing listing) public licenseListings;

    event ListingCreated(uint256 indexed listingId, uint256 indexed modelId, address indexed seller, uint256 price);
    event ListingPriceUpdated(uint256 indexed listingId, uint256 price);
    event ListingCancelled(uint256 indexed listingId);
    event ModelPurchased(uint256 indexed listingId, uint256 indexed modelId, address indexed buyer, uint256 price);
    event PaymentCredited(address indexed account, uint256 amount, uint8 paymentType);
    event PaymentWithdrawn(address indexed account, uint256 amount);
    event TreasuryWithdrawn(address indexed recipient, uint256 amount);
    event MarketplacePaused(address indexed account);
    event MarketplaceUnpaused(address indexed account);
    event PlatformFeeUpdated(uint96 platformFeeBps);
    event PlatformTreasuryUpdated(address indexed treasury);
    event PurchaseAuthorizationUsed(address indexed buyer, uint256 indexed listingId, uint256 nonce, uint256 deadline);
    event LicenseNFTConfigured(address indexed licenseNFT);
    event LicenseIssuedForPurchase(uint256 indexed licenseId, uint256 indexed modelId, address indexed buyer, bytes32 modelHash);
    event LicenseListingCreated(uint256 indexed listingId, uint256 indexed licenseId, address indexed seller, uint256 price);
    event LicenseListingCancelled(uint256 indexed listingId);
    event LicenseListingPriceUpdated(uint256 indexed listingId, uint256 price);
    event LicensePurchased(uint256 indexed listingId, uint256 indexed licenseId, address indexed buyer, address seller, uint256 price, uint256 royaltyAmount);

    /// @param registryAddress Existing AIModelRegistry deployment.
    /// @param treasury Recipient configured for platform fees.
    /// @param governance Multisig that receives administrative roles.
    constructor(address registryAddress, address payable treasury, address governance)
        EIP712("NeuralBazaar Marketplace", "2")
    {
        require(registryAddress != address(0), "MarketplaceV2: zero registry");
        require(treasury != address(0), "MarketplaceV2: zero treasury");
        require(governance != address(0), "MarketplaceV2: zero governance");
        registry = AIModelRegistry(registryAddress);
        platformTreasury = treasury;
        _grantRole(DEFAULT_ADMIN_ROLE, governance);
        _grantRole(PAUSER_ROLE, governance);
        _grantRole(FEE_MANAGER_ROLE, governance);
    }

    /// @notice Configure the license NFT that is minted for primary purchases.
    function setLicenseNFT(address licenseNFTAddress) external onlyRole(FEE_MANAGER_ROLE) {
        require(licenseNFTAddress != address(0), "MarketplaceV2: zero license NFT");
        licenseNFT = licenseNFTAddress;
        emit LicenseNFTConfigured(licenseNFTAddress);
    }

    /// @notice Create one active fixed-price access listing for a model owned by the caller.
    function createListing(uint256 modelId, uint256 price) external whenNotPaused returns (uint256 listingId) {
        require(registry.ownerOf(modelId) == msg.sender, "MarketplaceV2: not model owner");
        require(registry.getApproved(modelId) == address(this) || registry.isApprovedForAll(msg.sender, address(this)), "MarketplaceV2: approval required");
        require(price > 0, "MarketplaceV2: price is zero");
        require(activeListingByModel[modelId] == 0, "MarketplaceV2: model already listed");
        listingId = _nextListingId;
        unchecked { _nextListingId++; }
        listings[listingId] = Listing(listingId, modelId, msg.sender, price, true);
        activeListingByModel[modelId] = listingId;
        emit ListingCreated(listingId, modelId, msg.sender, price);
    }

    /// @notice Buy model access and credit seller, creator royalty, and treasury balances.
    function buyModel(uint256 listingId) external payable whenNotPaused nonReentrant {
        _buyModel(listingId, msg.sender);
    }

    /// @notice Buy model access using an EIP-712 authorization signed by the buyer.
    /// @dev The nonce and typed-data domain prevent replay across purchases,
    /// chains, and marketplace deployments.
    function buyModelWithAuthorization(
        uint256 listingId,
        address buyer,
        uint256 deadline,
        uint256 nonce,
        bytes calldata signature
    ) external payable whenNotPaused nonReentrant {
        require(buyer != address(0), "MarketplaceV2: zero buyer");
        require(block.timestamp <= deadline, "MarketplaceV2: authorization expired");
        require(nonce == purchaseNonces[buyer], "MarketplaceV2: invalid authorization nonce");
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(
            PURCHASE_AUTHORIZATION_TYPEHASH,
            listingId,
            buyer,
            nonce,
            deadline
        )));
        require(ECDSA.recover(digest, signature) == buyer, "MarketplaceV2: invalid authorization signature");
        purchaseNonces[buyer] = nonce + 1;
        emit PurchaseAuthorizationUsed(buyer, listingId, nonce, deadline);
        _buyModel(listingId, buyer);
    }

    function _buyModel(uint256 listingId, address buyer) internal {
        Listing storage listing = listings[listingId];
        require(listing.active, "MarketplaceV2: inactive listing");
        require(msg.value == listing.price, "MarketplaceV2: incorrect payment");
        require(buyer != listing.seller, "MarketplaceV2: seller cannot buy");
        require(registry.ownerOf(listing.modelId) == listing.seller, "MarketplaceV2: ownership changed");
        listing.active = false;
        activeListingByModel[listing.modelId] = 0;
        (address royaltyReceiver, uint256 royaltyAmount) = registry.royaltyInfo(listing.modelId, msg.value);
        uint256 platformAmount = (msg.value * platformFeeBps) / 10_000;
        require(royaltyAmount + platformAmount <= msg.value, "MarketplaceV2: invalid split");
        uint256 sellerAmount = msg.value - royaltyAmount - platformAmount;
        pendingWithdrawals[listing.seller] += sellerAmount;
        emit PaymentCredited(listing.seller, sellerAmount, 1);
        if (royaltyAmount > 0) { pendingWithdrawals[royaltyReceiver] += royaltyAmount; emit PaymentCredited(royaltyReceiver, royaltyAmount, 2); }
        if (platformAmount > 0) { pendingTreasury += platformAmount; emit PaymentCredited(platformTreasury, platformAmount, 3); }
        if (licenseNFT != address(0)) {
            AIModelRegistry.Model memory model = registry.modelDetails(listing.modelId);
            uint256 licenseId = IAILicenseIssuer(licenseNFT).issueLicense(
                buyer,
                listing.modelId,
                model.creator,
                registry.modelHashOf(listing.modelId),
                model.metadataURI,
                model.royaltyBps
            );
            emit LicenseIssuedForPurchase(licenseId, listing.modelId, buyer, registry.modelHashOf(listing.modelId));
        }
        emit ModelPurchased(listingId, listing.modelId, buyer, msg.value);
    }

    /// @notice List a transferable license for a secondary sale.
    function createLicenseListing(uint256 licenseId, uint256 price) external whenNotPaused returns (uint256 listingId) {
        require(licenseNFT != address(0), "MarketplaceV2: license NFT not configured");
        require(IERC721(licenseNFT).ownerOf(licenseId) == msg.sender, "MarketplaceV2: not license owner");
        require(
            IERC721(licenseNFT).getApproved(licenseId) == address(this) ||
            IERC721(licenseNFT).isApprovedForAll(msg.sender, address(this)),
            "MarketplaceV2: license approval required"
        );
        require(price > 0, "MarketplaceV2: price is zero");
        listingId = _nextLicenseListingId;
        unchecked { _nextLicenseListingId++; }
        licenseListings[listingId] = LicenseListing(listingId, licenseId, msg.sender, price, true);
        emit LicenseListingCreated(listingId, licenseId, msg.sender, price);
    }

    /// @notice Buy a license NFT and split its ERC-2981 creator royalty.
    function buyLicense(uint256 listingId) external payable whenNotPaused nonReentrant {
        LicenseListing storage listing = licenseListings[listingId];
        require(listing.active, "MarketplaceV2: inactive license listing");
        require(msg.value == listing.price, "MarketplaceV2: incorrect payment");
        require(msg.sender != listing.seller, "MarketplaceV2: seller cannot buy");
        require(IERC721(licenseNFT).ownerOf(listing.licenseId) == listing.seller, "MarketplaceV2: license ownership changed");

        listing.active = false;
        (address royaltyReceiver, uint256 royaltyAmount) = IERC2981(licenseNFT).royaltyInfo(listing.licenseId, msg.value);
        uint256 platformAmount = (msg.value * platformFeeBps) / 10_000;
        require(royaltyAmount + platformAmount <= msg.value, "MarketplaceV2: invalid split");
        uint256 sellerAmount = msg.value - royaltyAmount - platformAmount;
        pendingWithdrawals[listing.seller] += sellerAmount;
        emit PaymentCredited(listing.seller, sellerAmount, 4);
        if (royaltyAmount > 0) { pendingWithdrawals[royaltyReceiver] += royaltyAmount; emit PaymentCredited(royaltyReceiver, royaltyAmount, 5); }
        if (platformAmount > 0) { pendingTreasury += platformAmount; emit PaymentCredited(platformTreasury, platformAmount, 6); }
        IERC721(licenseNFT).safeTransferFrom(listing.seller, msg.sender, listing.licenseId);
        emit LicensePurchased(listingId, listing.licenseId, msg.sender, listing.seller, msg.value, royaltyAmount);
    }

    function cancelLicenseListing(uint256 listingId) external {
        LicenseListing storage listing = licenseListings[listingId];
        require(listing.active, "MarketplaceV2: inactive license listing");
        require(msg.sender == listing.seller || hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "MarketplaceV2: not authorized");
        listing.active = false;
        emit LicenseListingCancelled(listingId);
    }

    function updateLicensePrice(uint256 listingId, uint256 newPrice) external {
        LicenseListing storage listing = licenseListings[listingId];
        require(listing.active, "MarketplaceV2: inactive license listing");
        require(msg.sender == listing.seller, "MarketplaceV2: not seller");
        require(IERC721(licenseNFT).ownerOf(listing.licenseId) == msg.sender, "MarketplaceV2: license ownership changed");
        require(newPrice > 0, "MarketplaceV2: price is zero");
        listing.price = newPrice;
        emit LicenseListingPriceUpdated(listingId, newPrice);
    }

    /// @notice Cancel an active listing. Governance can cancel listings whose ownership changed.
    function cancelListing(uint256 listingId) external {
        Listing storage listing = listings[listingId];
        require(listing.active, "MarketplaceV2: inactive listing");
        require(msg.sender == listing.seller || hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "MarketplaceV2: not authorized");
        listing.active = false;
        if (activeListingByModel[listing.modelId] == listingId) activeListingByModel[listing.modelId] = 0;
        emit ListingCancelled(listingId);
    }

    /// @notice Update the price of an active listing owned by the seller.
    function updatePrice(uint256 listingId, uint256 newPrice) external {
        Listing storage listing = listings[listingId];
        require(listing.active, "MarketplaceV2: inactive listing");
        require(msg.sender == listing.seller, "MarketplaceV2: not seller");
        require(registry.ownerOf(listing.modelId) == msg.sender, "MarketplaceV2: ownership changed");
        require(newPrice > 0, "MarketplaceV2: price is zero");
        listing.price = newPrice;
        emit ListingPriceUpdated(listingId, newPrice);
    }

    /// @notice Withdraw the caller's credited seller or royalty balance.
    function withdrawPayments() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "MarketplaceV2: no balance");
        pendingWithdrawals[msg.sender] = 0;
        (bool sent, ) = payable(msg.sender).call{value: amount}("");
        require(sent, "MarketplaceV2: withdrawal failed");
        emit PaymentWithdrawn(msg.sender, amount);
    }

    /// @notice Withdraw accumulated platform fees to the configured treasury.
    function withdrawTreasury() external onlyRole(FEE_MANAGER_ROLE) nonReentrant {
        uint256 amount = pendingTreasury;
        require(amount > 0, "MarketplaceV2: no treasury balance");
        pendingTreasury = 0;
        (bool sent, ) = platformTreasury.call{value: amount}("");
        require(sent, "MarketplaceV2: treasury withdrawal failed");
        emit TreasuryWithdrawn(platformTreasury, amount);
    }

    /// @notice Pause listings and purchases during an incident.
    function pauseMarketplace() external onlyRole(PAUSER_ROLE) { _pause(); emit MarketplacePaused(msg.sender); }
    /// @notice Resume listings and purchases after an incident review.
    function unpauseMarketplace() external onlyRole(PAUSER_ROLE) { _unpause(); emit MarketplaceUnpaused(msg.sender); }

    /// @notice Configure the platform fee, capped at ten percent.
    function setPlatformFeeBps(uint96 newFeeBps) external onlyRole(FEE_MANAGER_ROLE) { require(newFeeBps <= 1_000, "MarketplaceV2: fee too high"); platformFeeBps = newFeeBps; emit PlatformFeeUpdated(newFeeBps); }
    /// @notice Configure the treasury receiving platform fees.
    function setPlatformTreasury(address payable newTreasury) external onlyRole(FEE_MANAGER_ROLE) { require(newTreasury != address(0), "MarketplaceV2: zero treasury"); platformTreasury = newTreasury; emit PlatformTreasuryUpdated(newTreasury); }

    /// @notice Reject unsolicited ETH so accounting cannot be bypassed.
    receive() external payable { revert("MarketplaceV2: direct deposits disabled"); }
}
