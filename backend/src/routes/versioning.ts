import { Router } from "express";
import { z } from "zod";
import { query, withTransaction } from "../db";
import { requireAuth } from "../middleware/auth";
import { isSuperAdmin } from "../services/identity";

const router = Router();
const versionSchema = z.object({
  version: z.string().regex(/^v?\d+\.\d+\.\d+$/).max(30),
  uploadId: z.string().uuid(),
  metadataSha256: z.string().regex(/^[a-f0-9]{64}$/).default(""),
  releaseNotes: z.string().max(3000).default(""),
  changelog: z.array(z.string().max(500)).max(100).default([]),
  onchainVersion: z.string().max(100).default("")
});

async function modelFor(value: string) {
  const result = await query<{ id: string; creator_wallet: string; ipfs_hash: string; metadata_uri: string }>("SELECT id, creator_wallet, ipfs_hash, metadata_uri FROM models WHERE id::text = $1 OR model_id_onchain::text = $1", [value]);
  return result.rows[0];
}

router.get("/models/:id/versions", async (req, res, next) => {
  try {
    const model = await modelFor(String(req.params.id));
    if (!model) return res.status(404).json({ error: "Model not found" });
    const versions = await query("SELECT * FROM model_versions WHERE model_id = $1 ORDER BY created_at DESC", [model.id]);
    res.json({ versions: versions.rows });
  } catch (error) { next(error); }
});

router.post("/models/:id/versions", requireAuth, async (req, res, next) => {
  try {
    const body = versionSchema.parse(req.body);
    const model = await modelFor(String(req.params.id));
    if (!model) return res.status(404).json({ error: "Model not found" });
    if (!isSuperAdmin(req.user!.role) && model.creator_wallet.toLowerCase() !== req.user!.address.toLowerCase()) return res.status(403).json({ error: "Only the model creator can add versions" });
    const upload = await query<{ file_sha256: string; verified_safe: boolean; security_status: string; owner_wallet: string }>(
      "SELECT COALESCE(original_sha256, sha256) AS file_sha256, verified_safe, security_status, owner_wallet FROM upload_manifests WHERE upload_id = $1 AND status IN ('ready', 'attached') AND expires_at > now()", [body.uploadId]
    );
    if (!upload.rows[0] || !upload.rows[0].verified_safe || upload.rows[0].security_status !== "verified_safe" || upload.rows[0].owner_wallet.toLowerCase() !== req.user!.address.toLowerCase()) return res.status(409).json({ error: "A verified-safe upload owned by the creator is required" });
    const version = await query(
      `INSERT INTO model_versions (model_id, version, upload_id, file_sha256, metadata_sha256, release_notes, changelog, onchain_version, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOT EXISTS (SELECT 1 FROM model_versions WHERE model_id = $1 AND is_active = true)) RETURNING *`,
      [model.id, body.version, body.uploadId, upload.rows[0].file_sha256, body.metadataSha256, body.releaseNotes, body.changelog, body.onchainVersion]
    );
    res.status(201).json({ version: version.rows[0] });
  } catch (error) { next(error); }
});

router.post("/models/:id/versions/:versionId/activate", requireAuth, async (req, res, next) => {
  try {
    const model = await modelFor(String(req.params.id));
    if (!model) return res.status(404).json({ error: "Model not found" });
    if (!isSuperAdmin(req.user!.role) && model.creator_wallet.toLowerCase() !== req.user!.address.toLowerCase()) return res.status(403).json({ error: "Only the model creator can activate versions" });
    const version = await query<{ id: string; upload_id: string; file_sha256: string }>("SELECT id, upload_id, file_sha256 FROM model_versions WHERE id = $1 AND model_id = $2", [req.params.versionId, model.id]);
    if (!version.rows[0]) return res.status(404).json({ error: "Version not found" });
    const result = await withTransaction(async client => {
      await client.query("UPDATE model_versions SET is_active = false WHERE model_id = $1", [model.id]);
      const active = await client.query("UPDATE model_versions SET is_active = true WHERE id = $1 RETURNING *", [version.rows[0].id]);
      await client.query("UPDATE models SET ipfs_hash = COALESCE((SELECT um.ipfs_hash FROM upload_manifests um WHERE um.upload_id = $2 AND um.status = 'attached' AND um.model_id_onchain = (SELECT model_id_onchain FROM models WHERE id = $1)), ipfs_hash), updated_at = now() WHERE id = $1", [model.id, version.rows[0].upload_id]);
      return active.rows[0];
    });
    res.json({ version: result });
  } catch (error) { next(error); }
});

router.get("/models/:id/versions/compare", async (req, res, next) => {
  try {
    const left = z.string().uuid().parse(req.query.left);
    const right = z.string().uuid().parse(req.query.right);
    const model = await modelFor(String(req.params.id));
    if (!model) return res.status(404).json({ error: "Model not found" });
    const result = await query("SELECT * FROM model_versions WHERE model_id = $1 AND id IN ($2, $3) ORDER BY created_at ASC", [model.id, left, right]);
    if (result.rows.length !== 2) return res.status(404).json({ error: "Both versions must belong to this model" });
    res.json({ versions: result.rows, comparison: { fileChanged: result.rows[0].file_sha256 !== result.rows[1].file_sha256, releaseNotes: result.rows.map(row => row.release_notes) } });
  } catch (error) { next(error); }
});

export default router;
