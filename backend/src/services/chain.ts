import { ethers } from "ethers";
import { config } from "../config";

export const registryAbi = [
  "event ModelRegistered(uint256 indexed modelId,address indexed creator,string ipfsHash,string metadataURI)",
  "function modelDetails(uint256 modelId) view returns (tuple(address creator,string ipfsHash,string metadataURI,uint96 royaltyBps))",
  "function ownerOf(uint256 modelId) view returns (address)"
];
export const marketplaceAbi = [
  "event ListingCreated(uint256 indexed listingId,uint256 indexed modelId,address indexed seller,uint256 price)",
  "event ListingCancelled(uint256 indexed listingId)",
  "event ListingPriceUpdated(uint256 indexed listingId,uint256 price)",
  "event ModelPurchased(uint256 indexed listingId,uint256 indexed modelId,address indexed buyer,uint256 price)",
  "function pauseMarketplace()",
  "function unpauseMarketplace()"
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
