import { Router } from "express";
import { z } from "zod";
import { query } from "../db";
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();
const modelInput = z.object({
  modelIdOnchain: z.coerce.number().int().positive(),
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
    const result = await query(
      `INSERT INTO models (model_id_onchain, creator_wallet, ipfs_hash, metadata_uri, title, description, category, tags, license)
       VALUES ($1, lower($2), $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (model_id_onchain) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description, category = EXCLUDED.category, tags = EXCLUDED.tags, license = EXCLUDED.license, updated_at = now()
       RETURNING *`, [body.modelIdOnchain, req.user!.address, body.ipfsHash, body.metadataUri, body.title, body.description, body.category, body.tags, body.license]
    );
    res.status(201).json({ model: result.rows[0] });
  } catch (error) { next(error); }
});

router.get("/:id/access", requireAuth, async (req, res, next) => {
  try {
    const result = await query<{ model_id_onchain: number; ipfs_hash: string; title: string }>("SELECT model_id_onchain, ipfs_hash, title FROM models WHERE id::text = $1 OR model_id_onchain::text = $1", [req.params.id]);
    const model = result.rows[0];
    if (!model) return res.status(404).json({ error: "Model not found" });
    const { config } = await import("../config");
    const { accessAbi, getProvider } = await import("../services/chain");
    if (!config.accessManagerAddress) return res.status(503).json({ error: "Access service is not configured" });
    const { ethers } = await import("ethers");
    const accessManager = new ethers.Contract(config.accessManagerAddress, accessAbi, getProvider());
    const allowed = await accessManager.hasAccess(req.user!.address, model.model_id_onchain);
    if (!allowed) return res.status(403).json({ error: "Purchase access to unlock this model" });
    res.json({ title: model.title, ipfsHash: model.ipfs_hash, gatewayUrl: `${config.pinataGateway}/${model.ipfs_hash}` });
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
