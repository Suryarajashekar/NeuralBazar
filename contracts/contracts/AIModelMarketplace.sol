// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {AIModelRegistry} from "./AIModelRegistry.sol";

/// @title AIModelMarketplace
/// @notice Creates fixed-price, access-license listings for registered AI models.
contract AIModelMarketplace is Ownable, Pausable, ReentrancyGuard {
    struct Listing {
        uint256 listingId;
        uint256 modelId;
        address seller;
        uint256 price;
        bool active;
    }

    AIModelRegistry public immutable registry;
    uint96 public platformFeeBps;
    address payable public platformTreasury;
    uint256 private _nextListingId = 1;
    mapping(uint256 listingId => Listing listing) public listings;

    event ListingCreated(uint256 indexed listingId, uint256 indexed modelId, address indexed seller, uint256 price);
    event ListingPriceUpdated(uint256 indexed listingId, uint256 price);
    event ListingCancelled(uint256 indexed listingId);
    event ModelPurchased(uint256 indexed listingId, uint256 indexed modelId, address indexed buyer, uint256 price);
    event MarketplacePaused(address indexed account);
    event MarketplaceUnpaused(address indexed account);
    event PlatformFeeUpdated(uint96 platformFeeBps);
    event PlatformTreasuryUpdated(address indexed treasury);

    constructor(address registryAddress, address payable treasury) Ownable(msg.sender) {
        require(registryAddress != address(0), "Marketplace: zero registry");
        require(treasury != address(0), "Marketplace: zero treasury");
        registry = AIModelRegistry(registryAddress);
        platformTreasury = treasury;
    }

    /// @notice Create a listing for a model owned by the caller.
    function createListing(uint256 modelId, uint256 price) external whenNotPaused returns (uint256 listingId) {
        require(registry.ownerOf(modelId) == msg.sender, "Marketplace: not model owner");
        require(registry.getApproved(modelId) == address(this) || registry.isApprovedForAll(msg.sender, address(this)), "Marketplace: approval required");
        require(price > 0, "Marketplace: price is zero");

        listingId = _nextListingId++;
        listings[listingId] = Listing(listingId, modelId, msg.sender, price, true);
        emit ListingCreated(listingId, modelId, msg.sender, price);
    }

    /// @notice Buy access to an active model listing and split payment between platform, seller, and creator.
    function buyModel(uint256 listingId) external payable whenNotPaused nonReentrant {
        Listing storage listing = listings[listingId];
        require(listing.active, "Marketplace: inactive listing");
        require(msg.value == listing.price, "Marketplace: incorrect payment");
        require(msg.sender != listing.seller, "Marketplace: seller cannot buy");

        listing.active = false;
        address creator = registry.creatorOf(listing.modelId);
        (, uint256 royaltyAmount) = registry.royaltyInfo(listing.modelId, msg.value);
        uint256 platformAmount = (msg.value * platformFeeBps) / 10_000;
        require(royaltyAmount + platformAmount <= msg.value, "Marketplace: invalid split");
        uint256 sellerAmount = msg.value - royaltyAmount - platformAmount;

        _send(payable(listing.seller), sellerAmount);
        if (royaltyAmount > 0) _send(payable(creator), royaltyAmount);
        if (platformAmount > 0) _send(platformTreasury, platformAmount);

        emit ModelPurchased(listingId, listing.modelId, msg.sender, msg.value);
    }

    /// @notice Cancel a listing created by the seller.
    function cancelListing(uint256 listingId) external {
        Listing storage listing = listings[listingId];
        require(listing.seller == msg.sender, "Marketplace: not seller");
        require(listing.active, "Marketplace: inactive listing");
        listing.active = false;
        emit ListingCancelled(listingId);
    }

    /// @notice Update the price of an active listing.
    function updatePrice(uint256 listingId, uint256 newPrice) external {
        Listing storage listing = listings[listingId];
        require(listing.seller == msg.sender, "Marketplace: not seller");
        require(listing.active, "Marketplace: inactive listing");
        require(newPrice > 0, "Marketplace: price is zero");
        listing.price = newPrice;
        emit ListingPriceUpdated(listingId, newPrice);
    }

    /// @notice Pause new purchases and listings. Admin-only emergency control.
    function pauseMarketplace() external onlyOwner {
        _pause();
        emit MarketplacePaused(msg.sender);
    }

    /// @notice Resume new purchases and listings.
    function unpauseMarketplace() external onlyOwner {
        _unpause();
        emit MarketplaceUnpaused(msg.sender);
    }

    /// @notice Configure an optional platform fee in basis points.
    function setPlatformFeeBps(uint96 newFeeBps) external onlyOwner {
        require(newFeeBps <= 1_000, "Marketplace: fee too high");
        platformFeeBps = newFeeBps;
        emit PlatformFeeUpdated(newFeeBps);
    }

    /// @notice Configure the treasury receiving the optional platform fee.
    function setPlatformTreasury(address payable newTreasury) external onlyOwner {
        require(newTreasury != address(0), "Marketplace: zero treasury");
        platformTreasury = newTreasury;
        emit PlatformTreasuryUpdated(newTreasury);
    }

    function _send(address payable recipient, uint256 amount) private {
        if (amount == 0) return;
        (bool sent, ) = recipient.call{value: amount}("");
        require(sent, "Marketplace: payment failed");
    }
}
