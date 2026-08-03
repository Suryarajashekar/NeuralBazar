import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { requireAuth, requireRole } from "../middleware/auth";
import { pinFile, pinJson } from "../services/pinata";
import path from "node:path";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 * 1024 } });

router.post("/model", requireAuth, requireRole("creator", "admin"), upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Model file is required" });
    const allowedExtensions = new Set([".zip", ".tar", ".gz", ".onnx", ".pt", ".pth", ".safetensors", ".csv", ".parquet", ".json"]);
    if (!allowedExtensions.has(path.extname(req.file.originalname).toLowerCase())) return res.status(400).json({ error: "Unsupported model file type" });
    const result = await pinFile(req.file);
    res.status(201).json({ ipfsHash: result.IpfsHash, uri: `ipfs://${result.IpfsHash}`, gatewayUrl: `https://gateway.pinata.cloud/ipfs/${result.IpfsHash}` });
  } catch (error) { next(error); }
});

router.post("/metadata", requireAuth, requireRole("creator", "admin"), async (req, res, next) => {
  try {
    const metadata = z.record(z.unknown()).parse(req.body);
    const result = await pinJson(metadata);
    res.status(201).json({ ipfsHash: result.IpfsHash, uri: `ipfs://${result.IpfsHash}` });
  } catch (error) { next(error); }
});

export default router;
