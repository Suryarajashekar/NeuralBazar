import { ethers } from "ethers";
import { config } from "../config";

export const registryAbi = [
  "event ModelRegistered(uint256 indexed modelId,address indexed creator,string ipfsHash,string metadataURI)",
  "event ModelHashAnchored(uint256 indexed modelId,bytes32 indexed contentHash)",
  "function modelDetails(uint256 modelId) view returns (tuple(address creator,string ipfsHash,string metadataURI,uint96 royaltyBps))",
  "function modelHashOf(uint256 modelId) view returns (bytes32)",
  "function ownerOf(uint256 modelId) view returns (address)"
];
export const marketplaceAbi = [
  "event ListingCreated(uint256 indexed listingId,uint256 indexed modelId,address indexed seller,uint256 price)",
  "event ListingCancelled(uint256 indexed listingId)",
  "event ListingPriceUpdated(uint256 indexed listingId,uint256 price)",
  "event ModelPurchased(uint256 indexed listingId,uint256 indexed modelId,address indexed buyer,uint256 price)",
  "event LicenseIssuedForPurchase(uint256 indexed licenseId,uint256 indexed modelId,address indexed buyer,bytes32 modelHash)",
  "event LicenseListingCreated(uint256 indexed listingId,uint256 indexed licenseId,address indexed seller,uint256 price)",
  "event LicenseListingCancelled(uint256 indexed listingId)",
  "event LicenseListingPriceUpdated(uint256 indexed listingId,uint256 price)",
  "event LicensePurchased(uint256 indexed listingId,uint256 indexed licenseId,address indexed buyer,address seller,uint256 price,uint256 royaltyAmount)",
  "function pauseMarketplace()",
  "function unpauseMarketplace()"
];
export const licenseAbi = [
  "event LicenseIssued(uint256 indexed licenseId,uint256 indexed modelId,address indexed licensee,address creator,bytes32 modelHash,string licenseURI)",
  "event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)",
  "function ownerOf(uint256 licenseId) view returns (address)",
  "function hasModelLicense(address account,uint256 modelId) view returns (bool)"
];
export const reviewAnchorAbi = [
  "event ReviewAnchored(bytes32 indexed reviewHash,uint256 indexed modelId,address indexed reviewer,uint8 score,string reviewURI)"
];
export const accessAbi = ["function grantAccess(address user,uint256 modelId)", "function hasAccess(address user,uint256 modelId) view returns (bool)"];

export function getProvider() {
  if (!config.rpcUrl) throw new Error("RPC_URL is not configured");
  return new ethers.JsonRpcProvider(config.rpcUrl, config.chainId);
}

export function getBackendSigner() {
  if (!config.backendSignerPrivateKey) throw new Error("BACKEND_SIGNER_PRIVATE_KEY is not configured");
  return new ethers.Wallet(config.backendSignerPrivateKey, getProvider());
}
