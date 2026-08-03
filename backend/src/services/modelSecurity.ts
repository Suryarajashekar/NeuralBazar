import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { config } from "../config";
import type { SecurityFinding } from "./modelScanner";

export type SignedModelManifest = {
  uploadId: string;
  ownerWallet: string;
  originalName: string;
  originalSha256: string;
  encryptedSha256: string;
  byteLength: number;
  scanner: string;
  securityScore: number;
  securityStatus: "verified_safe" | "rejected";
  watermarkDetected: boolean;
  createdAt: string;
};

let developmentKeys: { privateKey: string; publicKey: string } | undefined;

function signingKeys() {
  if (config.modelSigningPrivateKey) {
    const privateKey = createPrivateKey(config.modelSigningPrivateKey);
    const publicKey = config.modelSigningPublicKey || createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString();
    return { privateKey, publicKey };
  }
  if (!developmentKeys) {
    const generated = generateKeyPairSync("ed25519", { privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
    developmentKeys = generated;
    console.warn("MODEL_SIGNING_PRIVATE_KEY is not configured; using an ephemeral development signing key");
  }
  return { privateKey: createPrivateKey(developmentKeys.privateKey), publicKey: developmentKeys.publicKey };
}

export function canonicalManifest(manifest: SignedModelManifest) {
  return JSON.stringify({
    byteLength: manifest.byteLength,
    createdAt: manifest.createdAt,
    encryptedSha256: manifest.encryptedSha256,
    originalName: manifest.originalName,
    originalSha256: manifest.originalSha256,
    ownerWallet: manifest.ownerWallet.toLowerCase(),
    scanner: manifest.scanner,
    securityScore: manifest.securityScore,
    securityStatus: manifest.securityStatus,
    uploadId: manifest.uploadId,
    watermarkDetected: manifest.watermarkDetected
  });
}

export function signModelManifest(manifest: SignedModelManifest) {
  const payload = canonicalManifest(manifest);
  const keys = signingKeys();
  return {
    payload,
    payloadSha256: createHash("sha256").update(payload).digest("hex"),
    signature: sign(null, Buffer.from(payload), keys.privateKey).toString("base64"),
    publicKey: keys.publicKey
  };
}

export function verifyModelManifest(manifest: SignedModelManifest, signature: string, publicKey: string) {
  try { return verify(null, Buffer.from(canonicalManifest(manifest)), createPublicKey(publicKey), Buffer.from(signature, "base64")); } catch { return false; }
}

export function createProvenance(manifest: SignedModelManifest, signature: { payloadSha256: string; signature: string; publicKey: string }, findings: SecurityFinding[]) {
  return {
    source: "NeuralBazaar upload pipeline",
    ownerWallet: manifest.ownerWallet.toLowerCase(),
    uploadId: manifest.uploadId,
    originalSha256: manifest.originalSha256,
    encryptedSha256: manifest.encryptedSha256,
    signedManifestSha256: signature.payloadSha256,
    signatureAlgorithm: "Ed25519",
    signaturePublicKey: signature.publicKey,
    tamperDetection: "SHA-256 source digest + AES-256-GCM ciphertext authentication",
    watermarkDetected: manifest.watermarkDetected,
    securityFindings: findings.map(finding => finding.code),
    recordedAt: manifest.createdAt
  };
}
