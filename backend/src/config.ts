import "dotenv/config";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { EnterpriseRole } from "./services/identity";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function positiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

type ApiKeyRole = EnterpriseRole;
type ApiKeyConfig = { id: string; secret: string; secretHash: Buffer; subject: string; walletAddress: string; role: ApiKeyRole };

function parseApiKeys(value: string | undefined): ApiKeyConfig[] {
  if (!value?.trim()) return [];
  return value.split(",").filter(Boolean).map(entry => {
    const [id, secret, subject, walletAddress, role] = entry.split(":");
    if (!id || !secret || secret.length < 32 || !subject || !walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress) || !["customer", "creator", "support_admin", "moderator", "super_admin", "buyer", "admin"].includes(role ?? "")) {
      throw new Error("API_KEYS entries must be id:secret:subject:wallet:role with a 32+ character secret");
    }
    return { id, secret, secretHash: createHash("sha256").update(secret).digest(), subject, walletAddress: walletAddress.toLowerCase(), role: role as ApiKeyRole };
  });
}

const adminWalletAddress = process.env.ADMIN_WALLET_ADDRESS?.toLowerCase() ?? "";
if (adminWalletAddress && !/^0x[a-f0-9]{40}$/.test(adminWalletAddress)) throw new Error("ADMIN_WALLET_ADDRESS must be a valid Ethereum address");
if (process.env.NODE_ENV === "production" && !adminWalletAddress) throw new Error("ADMIN_WALLET_ADDRESS is required in production");
if (process.env.NODE_ENV === "production" && (process.env.JWT_SECRET ?? "").length < 32) throw new Error("JWT_SECRET must be at least 32 characters in production");
if (process.env.NODE_ENV === "production" && !process.env.MODEL_ENCRYPTION_KEY) throw new Error("MODEL_ENCRYPTION_KEY is required in production");
if (process.env.NODE_ENV === "production" && !process.env.CLAMAV_PATH) throw new Error("CLAMAV_PATH is required in production");
if (process.env.NODE_ENV === "production" && !process.env.MODEL_SIGNING_PRIVATE_KEY) throw new Error("MODEL_SIGNING_PRIVATE_KEY is required in production");
let frontendUrl: URL;
try { frontendUrl = new URL(process.env.FRONTEND_URL ?? "http://localhost:3000"); } catch { throw new Error("FRONTEND_URL must be a valid URL"); }
if (process.env.NODE_ENV === "production" && frontendUrl.protocol !== "https:") throw new Error("FRONTEND_URL must use HTTPS in production");

const trustProxyValue = process.env.TRUST_PROXY ?? "1";
const trustProxy = trustProxyValue === "true" ? true : trustProxyValue === "false" ? false : positiveInteger("TRUST_PROXY", 1);

export const config = {
  port: Number(process.env.PORT ?? 4000),
  trustProxy,
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
  pinataGatewayJwt: process.env.PINATA_GATEWAY_JWT || "",
  pinataGateway: process.env.PINATA_GATEWAY ?? "https://gateway.pinata.cloud/ipfs",
  modelEncryptionKey: process.env.MODEL_ENCRYPTION_KEY ?? "",
  clamavPath: process.env.CLAMAV_PATH ?? "",
  modelSigningPrivateKey: process.env.MODEL_SIGNING_PRIVATE_KEY ?? "",
  modelSigningPublicKey: process.env.MODEL_SIGNING_PUBLIC_KEY ?? "",
  modelSecurityScoreThreshold: Number(process.env.MODEL_SECURITY_SCORE_THRESHOLD ?? 80),
  benchmarkRunnerPath: process.env.BENCHMARK_RUNNER_PATH ?? "",
  embeddingModel: process.env.EMBEDDING_MODEL ?? "local-hash-v1",
  chainId: Number(process.env.CHAIN_ID ?? 11155111),
  indexerStartBlock: Number(process.env.INDEXER_START_BLOCK ?? 0),
  maxUploadBytes: positiveInteger("MAX_UPLOAD_BYTES", 256 * 1024 * 1024),
  uploadTempDir: process.env.UPLOAD_TEMP_DIR || path.join(os.tmpdir(), "neuralbazaar-uploads"),
  accessTokenTtlSeconds: positiveInteger("ACCESS_TOKEN_TTL_SECONDS", 15 * 60),
  refreshTokenTtlSeconds: positiveInteger("REFRESH_TOKEN_TTL_SECONDS", 7 * 24 * 60 * 60),
  sessionIdleTimeoutMinutes: positiveInteger("SESSION_IDLE_TIMEOUT_MINUTES", 30),
  requestSigningMaxSkewSeconds: positiveInteger("REQUEST_SIGNING_MAX_SKEW_SECONDS", 300),
  apiKeys: parseApiKeys(process.env.API_KEYS)
};

if (!Number.isInteger(config.modelSecurityScoreThreshold) || config.modelSecurityScoreThreshold < 1 || config.modelSecurityScoreThreshold > 100) {
  throw new Error("MODEL_SECURITY_SCORE_THRESHOLD must be an integer between 1 and 100");
}
