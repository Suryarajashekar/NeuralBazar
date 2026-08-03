import { Router } from "express";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import { query, withTransaction } from "../db";
import { requireAuth, requireRole } from "../middleware/auth";
import { config } from "../config";
import { registryAbi, getProvider } from "../services/chain";
import { ethers } from "ethers";
import { createDecryptTransform, unwrapDataKey } from "../services/modelCrypto";

const router = Router();
const modelInput = z.object({
  modelIdOnchain: z.coerce.bigint().positive(),
  ipfsHash: z.string().min(1).max(200),
  metadataUri: z.string().min(1).max(500),
  title: z.string().min(2).max(120),
  description: z.string().min(10).max(5000),
  category: z.string().min(2).max(80),
  tags: z.array(z.string().min(1).max(40)).max(20),
  license: z.string().min(2).max(80)
});

router.get("/", async (req, res, next) => {
  try {
    const search = String(req.query.search ?? "").trim();
    const category = String(req.query.category ?? "").trim();
    const sort = req.query.sort === "rating" ? "rating" : "newest";
    const result = await query(
      `SELECT m.*, l.listing_id_onchain, l.price_wei, to_char(l.price_wei / 1000000000000000000.0, 'FM999999990.########') AS price_eth,
              COALESCE(ROUND(AVG(CASE WHEN r.target_type = 'model' THEN r.score END)::numeric, 1), 0) AS rating,
              COUNT(CASE WHEN r.target_type = 'model' THEN 1 END)::int AS rating_count,
              COALESCE(u.username, substring(m.creator_wallet, 1, 10)) AS creator_name
       FROM models m LEFT JOIN users u ON lower(u.wallet_address) = lower(m.creator_wallet)
       LEFT JOIN listings l ON l.model_id_onchain = m.model_id_onchain AND l.active = true
       LEFT JOIN ratings r ON r.target_key = m.id::text
       WHERE m.status = 'published'
         AND ($1 = '' OR m.title ILIKE '%' || $1 || '%' OR m.description ILIKE '%' || $1 || '%' OR $1 = ANY(m.tags))
         AND ($2 = '' OR m.category = $2)
       GROUP BY m.id, u.username, l.listing_id_onchain, l.price_wei
       ORDER BY ${sort === "rating" ? "rating DESC, m.created_at DESC" : "m.created_at DESC"}`,
      [search, category]
    );
    res.json({ models: result.rows });
  } catch (error) { next(error); }
});

router.get("/purchased", requireAuth, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT m.*, p.price_paid_wei, p.purchased_at, p.tx_hash, am.listing_id_onchain
       FROM purchases p JOIN models m ON m.model_id_onchain = p.model_id_onchain
       LEFT JOIN listings am ON am.listing_id_onchain = p.listing_id_onchain
       WHERE lower(p.buyer_wallet) = lower($1) ORDER BY p.purchased_at DESC`, [req.user!.address]
    );
    res.json({ models: result.rows });
  } catch (error) { next(error); }
});

router.get("/mine", requireAuth, requireRole("creator", "admin"), async (req, res, next) => {
  try {
    const result = await query(
      `SELECT m.*, l.listing_id_onchain, l.price_wei, to_char(l.price_wei / 1000000000000000000.0, 'FM999999990.########') AS price_eth, l.active AS listing_active
       FROM models m LEFT JOIN listings l ON l.model_id_onchain = m.model_id_onchain
       WHERE lower(m.creator_wallet) = lower($1) ORDER BY m.created_at DESC`, [req.user!.address]
    );
    res.json({ models: result.rows });
  } catch (error) { next(error); }
});

router.get("/:id", async (req, res, next) => {
  try {
    const result = await query(
      `SELECT m.*, l.listing_id_onchain, l.price_wei, to_char(l.price_wei / 1000000000000000000.0, 'FM999999990.########') AS price_eth,
              COALESCE(u.username, substring(m.creator_wallet, 1, 10)) AS creator_name,
              COALESCE(AVG(CASE WHEN r.target_type = 'model' THEN r.score END), 0) AS rating,
              COUNT(CASE WHEN r.target_type = 'model' THEN 1 END)::int AS rating_count,
              COALESCE(AVG(CASE WHEN r.target_type = 'developer' THEN r.score END), 0) AS developer_rating
       FROM models m LEFT JOIN users u ON lower(u.wallet_address) = lower(m.creator_wallet)
       LEFT JOIN listings l ON l.model_id_onchain = m.model_id_onchain AND l.active = true
       LEFT JOIN ratings r ON r.target_key = CASE WHEN r.target_type = 'model' THEN m.id::text ELSE lower(m.creator_wallet) END
       WHERE m.id::text = $1 OR m.model_id_onchain::text = $1
       GROUP BY m.id, u.username, l.listing_id_onchain, l.price_wei`, [req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Model not found" });
    res.json({ model: result.rows[0] });
  } catch (error) { next(error); }
});

router.post("/", requireAuth, requireRole("creator", "admin"), async (req, res, next) => {
  try {
    const body = modelInput.parse(req.body);
    if (!config.registryAddress || !ethers.isAddress(config.registryAddress)) return res.status(503).json({ error: "Model registry is not configured" });

    const registry = new ethers.Contract(config.registryAddress, registryAbi, getProvider());
    let details: { creator: string; ipfsHash: string; metadataURI: string };
    try {
      details = await registry.modelDetails(body.modelIdOnchain);
    } catch {
      return res.status(404).json({ error: "The on-chain model does not exist" });
    }
    if (details.creator.toLowerCase() !== req.user!.address.toLowerCase()) return res.status(403).json({ error: "Only the on-chain creator can save this model" });
    if (details.ipfsHash !== body.ipfsHash || details.metadataURI !== body.metadataUri) return res.status(409).json({ error: "Database metadata must match the registered on-chain metadata" });

    const manifest = await query<{ upload_id: string }>(
      `SELECT upload_id FROM upload_manifests
       WHERE lower(owner_wallet) = lower($1) AND ipfs_hash = $2 AND status = 'ready' AND scan_status = 'passed' AND expires_at > now()
       ORDER BY created_at DESC LIMIT 1`, [req.user!.address, body.ipfsHash]
    );
    if (!manifest.rows[0]) return res.status(409).json({ error: "This model must be uploaded, scanned, and encrypted through the private upload flow first" });

    const result = await withTransaction(async client => {
      const inserted = await client.query(
        `INSERT INTO models (model_id_onchain, creator_wallet, ipfs_hash, metadata_uri, title, description, category, tags, license)
         VALUES ($1, lower($2), $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (model_id_onchain) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description, category = EXCLUDED.category, tags = EXCLUDED.tags, license = EXCLUDED.license, updated_at = now()
         RETURNING *`, [body.modelIdOnchain.toString(), req.user!.address, body.ipfsHash, body.metadataUri, body.title, body.description, body.category, body.tags, body.license]
      );
      await client.query("UPDATE upload_manifests SET model_id_onchain = $2, status = 'attached', attached_at = now() WHERE upload_id = $1 AND status = 'ready'", [manifest.rows[0].upload_id, body.modelIdOnchain.toString()]);
      return inserted;
    });
    res.status(201).json({ model: result.rows[0] });
  } catch (error) { next(error); }
});

router.get("/:id/access", requireAuth, async (req, res, next) => {
  try {
    const result = await query<{ model_id_onchain: string; ipfs_hash: string; title: string; original_name: string; wrapped_key: string; encryption_iv: string }>(
      `SELECT m.model_id_onchain, m.ipfs_hash, m.title, um.original_name, um.wrapped_key, um.encryption_iv
       FROM models m JOIN upload_manifests um ON um.model_id_onchain = m.model_id_onchain AND um.status = 'attached'
       WHERE (m.id::text = $1 OR m.model_id_onchain::text = $1) AND m.status = 'published'`, [req.params.id]
    );
    const model = result.rows[0];
    if (!model) return res.status(404).json({ error: "Model not found" });
    const { accessAbi, getProvider } = await import("../services/chain");
    if (!config.accessManagerAddress) return res.status(503).json({ error: "Access service is not configured" });
    const accessManager = new ethers.Contract(config.accessManagerAddress, accessAbi, getProvider());
    const allowed = await accessManager.hasAccess(req.user!.address, BigInt(model.model_id_onchain));
    if (!allowed) return res.status(403).json({ error: "Purchase access to unlock this model" });

    const gatewayUrl = `${config.pinataGateway.replace(/\/$/, "")}/${model.ipfs_hash}`;
    const gatewayResponse = await fetch(gatewayUrl, { headers: config.pinataGatewayJwt ? { Authorization: `Bearer ${config.pinataGatewayJwt}` } : undefined });
    if (!gatewayResponse.ok || !gatewayResponse.body) return res.status(502).json({ error: "Private model storage is unavailable" });
    const safeFilename = model.original_name.replace(/[^a-zA-Z0-9._-]/g, "_");
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${safeFilename}"`);
    res.setHeader("Cache-Control", "private, no-store");
    try {
      await pipeline(
        Readable.fromWeb(gatewayResponse.body as import("node:stream/web").ReadableStream),
        createDecryptTransform(unwrapDataKey(model.wrapped_key), Buffer.from(model.encryption_iv, "base64")),
        res
      );
    } catch (error) {
      if (!res.destroyed) res.destroy(error as Error);
    }
  } catch (error) { next(error); }
});

router.patch("/:id/status", requireAuth, requireRole("moderator", "admin"), async (req, res, next) => {
  try {
    const status = z.enum(["published", "flagged", "suspended", "removed"]).parse(req.body.status);
    const result = await query("UPDATE models SET status = $2, updated_at = now() WHERE id::text = $1 RETURNING *", [req.params.id, status]);
    if (!result.rows[0]) return res.status(404).json({ error: "Model not found" });
    res.json({ model: result.rows[0] });
  } catch (error) { next(error); }
});

export default router;
