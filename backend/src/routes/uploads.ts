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
  try {
    if (!req.file) return res.status(400).json({ error: "Model file is required" });
    if (!config.modelEncryptionKey) return res.status(503).json({ error: "Private model delivery is not configured" });
    if (path.basename(req.file.originalname) !== req.file.originalname) return res.status(400).json({ error: "The uploaded filename is not valid" });
    const scan = await scanModelFile(req.file.path, req.file.originalname, config.maxUploadBytes);
    const encryption = await encryptStagedFile(req.file.path, encryptedPath!);
    const result = await pinFileFromPath({ path: encryptedPath!, originalname: `${req.file.originalname}.nbm`, mimetype: "application/octet-stream" });
    const uploadId = randomUUID();
    await query(
      `INSERT INTO upload_manifests (upload_id, owner_wallet, original_name, ipfs_hash, sha256, wrapped_key, encryption_iv, scan_status, scanner_version)
       VALUES ($1, lower($2), $3, $4, $5, $6, $7, $8, $9)`,
      [uploadId, req.user!.address, req.file.originalname, result.IpfsHash, encryption.sha256, encryption.wrappedKey, encryption.encryptionIv, scan.status, scan.scanner]
    );
    res.status(201).json({ uploadId, ipfsHash: result.IpfsHash, uri: `ipfs://${result.IpfsHash}`, sha256: encryption.sha256, byteLength: encryption.byteLength, scanStatus: scan.status, scanner: scan.scanner });
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
