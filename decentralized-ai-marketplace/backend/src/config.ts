import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const adminWalletAddress = process.env.ADMIN_WALLET_ADDRESS?.toLowerCase() ?? "";
if (adminWalletAddress && !/^0x[a-f0-9]{40}$/.test(adminWalletAddress)) throw new Error("ADMIN_WALLET_ADDRESS must be a valid Ethereum address");
if (process.env.NODE_ENV === "production" && !adminWalletAddress) throw new Error("ADMIN_WALLET_ADDRESS is required in production");

export const config = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required("DATABASE_URL"),
  jwtSecret: required("JWT_SECRET"),
  frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:3000",
  adminWalletAddress,
  backendPublicUrl: process.env.BACKEND_PUBLIC_URL ?? "http://localhost:4000",
  rpcUrl: process.env.RPC_URL ?? "",
  registryAddress: process.env.REGISTRY_ADDRESS ?? "",
  marketplaceAddress: process.env.MARKETPLACE_ADDRESS ?? "",
  accessManagerAddress: process.env.ACCESS_MANAGER_ADDRESS ?? "",
  backendSignerPrivateKey: process.env.BACKEND_SIGNER_PRIVATE_KEY ?? "",
  pinataJwt: process.env.PINATA_JWT ?? "",
  pinataGateway: process.env.PINATA_GATEWAY ?? "https://gateway.pinata.cloud/ipfs",
  chainId: Number(process.env.CHAIN_ID ?? 11155111),
  indexerStartBlock: Number(process.env.INDEXER_START_BLOCK ?? 0)
};
