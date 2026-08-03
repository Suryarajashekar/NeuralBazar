// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {AIModelRegistry} from "./AIModelRegistry.sol";

/// @title AIModelMarketplaceV2
/// @notice Governance-controlled model access marketplace with pull payments.
/// @dev Deploy the governance address as a multisig (for example, a Safe).
contract AIModelMarketplaceV2 is AccessControl, Pausable, ReentrancyGuard {
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant FEE_MANAGER_ROLE = keccak256("FEE_MANAGER_ROLE");

    struct Listing { uint256 listingId; uint256 modelId; address seller; uint256 price; bool active; }

    AIModelRegistry public immutable registry;
    address payable public platformTreasury;
    uint96 public platformFeeBps;
    uint256 private _nextListingId = 1;
    uint256 public pendingTreasury;
    mapping(uint256 listingId => Listing listing) public listings;
    mapping(uint256 modelId => uint256 listingId) public activeListingByModel;
    mapping(address account => uint256 amount) public pendingWithdrawals;

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

    /// @param registryAddress Existing AIModelRegistry deployment.
    /// @param treasury Recipient configured for platform fees.
    /// @param governance Multisig that receives administrative roles.
    constructor(address registryAddress, address payable treasury, address governance) {
        require(registryAddress != address(0), "MarketplaceV2: zero registry");
        require(treasury != address(0), "MarketplaceV2: zero treasury");
        require(governance != address(0), "MarketplaceV2: zero governance");
        registry = AIModelRegistry(registryAddress);
        platformTreasury = treasury;
        _grantRole(DEFAULT_ADMIN_ROLE, governance);
        _grantRole(PAUSER_ROLE, governance);
        _grantRole(FEE_MANAGER_ROLE, governance);
    }

    /// @notice Create one active fixed-price access listing for a model owned by the caller.
    function createListing(uint256 modelId, uint256 price) external whenNotPaused returns (uint256 listingId) {
        require(registry.ownerOf(modelId) == msg.sender, "MarketplaceV2: not model owner");
        require(registry.getApproved(modelId) == address(this) || registry.isApprovedForAll(msg.sender, address(this)), "MarketplaceV2: approval required");
        require(price > 0, "MarketplaceV2: price is zero");
        require(activeListingByModel[modelId] == 0, "MarketplaceV2: model already listed");
        listingId = _nextListingId++;
        listings[listingId] = Listing(listingId, modelId, msg.sender, price, true);
        activeListingByModel[modelId] = listingId;
        emit ListingCreated(listingId, modelId, msg.sender, price);
    }

    /// @notice Buy model access and credit seller, creator royalty, and treasury balances.
    function buyModel(uint256 listingId) external payable whenNotPaused nonReentrant {
        Listing storage listing = listings[listingId];
        require(listing.active, "MarketplaceV2: inactive listing");
        require(msg.value == listing.price, "MarketplaceV2: incorrect payment");
        require(msg.sender != listing.seller, "MarketplaceV2: seller cannot buy");
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
        emit ModelPurchased(listingId, listing.modelId, msg.sender, msg.value);
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
