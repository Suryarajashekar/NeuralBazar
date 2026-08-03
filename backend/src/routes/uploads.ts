import { Router } from "express";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { query } from "../db";
import { requireAuth, requireRole } from "../middleware/auth";
import { pinFileFromPath, pinJson } from "../services/pinata";
import { config } from "../config";
import { encryptStagedFile } from "../services/modelCrypto";
import { scanModelFile } from "../services/modelScanner";
import { createProvenance, signModelManifest } from "../services/modelSecurity";
import { UploadValidationError } from "../services/uploadSecurity";

const router = Router();
fs.mkdirSync(config.uploadTempDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: config.uploadTempDir,
    filename: (_req, _file, callback) => callback(null, `${randomUUID()}.upload`)
  }),
  limits: { fileSize: config.maxUploadBytes, files: 1 }
});
const uploadRateLimit = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: true, legacyHeaders: false });

router.post("/model", requireAuth, requireRole("creator", "admin"), uploadRateLimit, upload.single("file"), async (req, res, next) => {
  const stagedPath = req.file?.path;
  const encryptedPath = stagedPath ? `${stagedPath}.encrypted` : undefined;
  const uploadId = randomUUID();
  try {
    if (!req.file) return res.status(400).json({ error: "Model file is required" });
    if (!config.modelEncryptionKey) return res.status(503).json({ error: "Private model delivery is not configured" });
    if (path.basename(req.file.originalname) !== req.file.originalname) return res.status(400).json({ error: "The uploaded filename is not valid" });
    const scan = await scanModelFile(req.file.path, req.file.originalname, config.maxUploadBytes);

    // Rejected files never enter private storage or the publication flow. A
    // compact manifest is retained so the security decision is auditable.
    if (!scan.verifiedSafe) {
      await query(
        `INSERT INTO upload_manifests (upload_id, owner_wallet, original_name, ipfs_hash, sha256, wrapped_key, encryption_iv, scan_status, scanner_version, status, original_sha256, encrypted_sha256, security_score, security_status, verified_safe, security_report, provenance)
         VALUES ($1, lower($2), $3, $4, $5, $6, $7, 'rejected', $8, 'revoked', $5, NULL, $9, 'rejected', false, $10, $11)`,
        [uploadId, req.user!.address, req.file.originalname, `rejected://${uploadId}`, scan.sha256, "rejected", "", scan.scanner, scan.securityScore, scan.riskReport, { source: "NeuralBazaar upload pipeline", originalSha256: scan.sha256, securityFindings: scan.findings.map(finding => finding.code), recordedAt: new Date().toISOString() }]
      );
      const summary = scan.findings.slice(0, 3).map(finding => finding.code).join(", ");
      throw new UploadValidationError(`Model security verification failed (score ${scan.securityScore}/100)${summary ? `: ${summary}` : ""}`);
    }

    const encryption = await encryptStagedFile(req.file.path, encryptedPath!);
    if (scan.sha256 !== encryption.sourceSha256) {
      throw new UploadValidationError("Model integrity verification failed while staging the encrypted artifact");
    }
    const manifest = {
      uploadId,
      ownerWallet: req.user!.address.toLowerCase(),
      originalName: req.file.originalname,
      originalSha256: scan.sha256,
      encryptedSha256: encryption.sha256,
      byteLength: scan.byteLength,
      scanner: scan.scanner,
      securityScore: scan.securityScore,
      securityStatus: "verified_safe" as const,
      watermarkDetected: scan.watermarkDetected,
      createdAt: new Date().toISOString()
    };
    const signed = signModelManifest(manifest);
    const provenance = createProvenance(manifest, signed, scan.findings);
    const result = await pinFileFromPath({ path: encryptedPath!, originalname: `${req.file.originalname}.nbm`, mimetype: "application/octet-stream" });
    await query(
      `INSERT INTO upload_manifests (upload_id, owner_wallet, original_name, ipfs_hash, sha256, wrapped_key, encryption_iv, scan_status, scanner_version, original_sha256, encrypted_sha256, security_score, security_status, verified_safe, security_report, signed_manifest, signature, signature_public_key, provenance)
       VALUES ($1, lower($2), $3, $4, $5, $6, $7, $8, $9, $10, $5, $11, $12, true, $13, $14, $15, $16, $17)`,
      [uploadId, req.user!.address, req.file.originalname, result.IpfsHash, encryption.sha256, encryption.wrappedKey, encryption.encryptionIv, scan.status, scan.scanner, scan.sha256, scan.securityScore, scan.securityStatus, scan.riskReport, manifest, signed.signature, signed.publicKey, provenance]
    );
    res.status(201).json({
      uploadId,
      ipfsHash: result.IpfsHash,
      uri: `ipfs://${result.IpfsHash}`,
      sha256: encryption.sha256,
      byteLength: encryption.byteLength,
      scanStatus: scan.status,
      scanner: scan.scanner,
      originalSha256: scan.sha256,
      encryptedSha256: encryption.sha256,
      securityScore: scan.securityScore,
      securityStatus: scan.securityStatus,
      verifiedSafe: scan.verifiedSafe,
      watermarkDetected: scan.watermarkDetected,
      riskReport: scan.riskReport,
      signedManifest: manifest,
      signature: signed.signature,
      signaturePublicKey: signed.publicKey,
      provenance
    });
  } catch (error) {
    next(error);
  } finally {
    if (stagedPath) await fs.promises.rm(stagedPath, { force: true }).catch(() => undefined);
    if (encryptedPath) await fs.promises.rm(encryptedPath, { force: true }).catch(() => undefined);
  }
});

router.post("/metadata", requireAuth, requireRole("creator", "admin"), async (req, res, next) => {
  try {
    const metadata = z.record(z.unknown()).parse(req.body);
    const result = await pinJson(metadata);
    res.status(201).json({ ipfsHash: result.IpfsHash, uri: `ipfs://${result.IpfsHash}` });
  } catch (error) { next(error); }
});

export default router;
