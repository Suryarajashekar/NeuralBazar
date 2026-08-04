export const registryAbi = [
  { type: "function", name: "registerModel", stateMutability: "nonpayable", inputs: [{ name: "ipfsHash", type: "string" }, { name: "metadataURI", type: "string" }, { name: "royaltyBps", type: "uint96" }], outputs: [{ name: "modelId", type: "uint256" }] },
  { type: "function", name: "registerModelWithHash", stateMutability: "nonpayable", inputs: [{ name: "ipfsHash", type: "string" }, { name: "metadataURI", type: "string" }, { name: "contentHash", type: "bytes32" }, { name: "royaltyBps", type: "uint96" }], outputs: [{ name: "modelId", type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "tokenId", type: "uint256" }], outputs: [] },
  { type: "function", name: "modelHashOf", stateMutability: "view", inputs: [{ name: "modelId", type: "uint256" }], outputs: [{ name: "contentHash", type: "bytes32" }] },
  { type: "event", name: "ModelRegistered", anonymous: false, inputs: [{ indexed: true, name: "modelId", type: "uint256" }, { indexed: true, name: "creator", type: "address" }, { indexed: false, name: "ipfsHash", type: "string" }, { indexed: false, name: "metadataURI", type: "string" }] },
  { type: "event", name: "ModelHashAnchored", anonymous: false, inputs: [{ indexed: true, name: "modelId", type: "uint256" }, { indexed: true, name: "contentHash", type: "bytes32" }] }
] as const;

export const marketplaceAbi = [
  { type: "function", name: "createListing", stateMutability: "nonpayable", inputs: [{ name: "modelId", type: "uint256" }, { name: "price", type: "uint256" }], outputs: [{ name: "listingId", type: "uint256" }] },
  { type: "function", name: "buyModel", stateMutability: "payable", inputs: [{ name: "listingId", type: "uint256" }], outputs: [] },
  { type: "function", name: "cancelListing", stateMutability: "nonpayable", inputs: [{ name: "listingId", type: "uint256" }], outputs: [] },
  { type: "function", name: "pauseMarketplace", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "unpauseMarketplace", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "createLicenseListing", stateMutability: "nonpayable", inputs: [{ name: "licenseId", type: "uint256" }, { name: "price", type: "uint256" }], outputs: [{ name: "listingId", type: "uint256" }] },
  { type: "function", name: "buyLicense", stateMutability: "payable", inputs: [{ name: "listingId", type: "uint256" }], outputs: [] },
  { type: "event", name: "ModelPurchased", anonymous: false, inputs: [{ indexed: true, name: "listingId", type: "uint256" }, { indexed: true, name: "modelId", type: "uint256" }, { indexed: true, name: "buyer", type: "address" }, { indexed: false, name: "price", type: "uint256" }] }
] as const;

export const licenseAbi = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "tokenId", type: "uint256" }], outputs: [] },
  { type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ name: "owner", type: "address" }] },
  { type: "function", name: "hasModelLicense", stateMutability: "view", inputs: [{ name: "account", type: "address" }, { name: "modelId", type: "uint256" }], outputs: [{ name: "hasLicense", type: "bool" }] }
] as const;

export const reviewAnchorAbi = [
  { type: "function", name: "anchorReview", stateMutability: "nonpayable", inputs: [{ name: "reviewHash", type: "bytes32" }, { name: "modelId", type: "uint256" }, { name: "score", type: "uint8" }, { name: "reviewURI", type: "string" }], outputs: [] }
] as const;
