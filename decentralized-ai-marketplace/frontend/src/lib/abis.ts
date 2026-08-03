export const registryAbi = [
  { type: "function", name: "registerModel", stateMutability: "nonpayable", inputs: [{ name: "ipfsHash", type: "string" }, { name: "metadataURI", type: "string" }, { name: "royaltyBps", type: "uint96" }], outputs: [{ name: "modelId", type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "tokenId", type: "uint256" }], outputs: [] },
  { type: "event", name: "ModelRegistered", anonymous: false, inputs: [{ indexed: true, name: "modelId", type: "uint256" }, { indexed: true, name: "creator", type: "address" }, { indexed: false, name: "ipfsHash", type: "string" }, { indexed: false, name: "metadataURI", type: "string" }] }
] as const;

export const marketplaceAbi = [
  { type: "function", name: "createListing", stateMutability: "nonpayable", inputs: [{ name: "modelId", type: "uint256" }, { name: "price", type: "uint256" }], outputs: [{ name: "listingId", type: "uint256" }] },
  { type: "function", name: "buyModel", stateMutability: "payable", inputs: [{ name: "listingId", type: "uint256" }], outputs: [] },
  { type: "function", name: "cancelListing", stateMutability: "nonpayable", inputs: [{ name: "listingId", type: "uint256" }], outputs: [] },
  { type: "function", name: "pauseMarketplace", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "unpauseMarketplace", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "event", name: "ModelPurchased", anonymous: false, inputs: [{ indexed: true, name: "listingId", type: "uint256" }, { indexed: true, name: "modelId", type: "uint256" }, { indexed: true, name: "buyer", type: "address" }, { indexed: false, name: "price", type: "uint256" }] }
] as const;
