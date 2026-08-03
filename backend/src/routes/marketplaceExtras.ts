import { Router } from "express";
import { z } from "zod";
import { query } from "../db";
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();
const uuid = z.string().uuid();

function sessionId(req: import("express").Request, res: import("express").Response) {
  if (!uuid.safeParse(req.user?.sub).success) { res.status(403).json({ error: "A session account is required" }); return undefined; }
  return req.user!.sub;
}

async function modelId(value: string) {
  const result = await query<{ id: string }>("SELECT id FROM models WHERE id::text = $1 OR model_id_onchain::text = $1", [value]);
  return result.rows[0]?.id;
}

router.get("/featured", async (_req, res, next) => {
  try {
    const result = await query("SELECT * FROM featured_items WHERE starts_at <= now() AND (ends_at IS NULL OR ends_at > now()) ORDER BY starts_at DESC");
    res.json({ featured: result.rows });
  } catch (error) { next(error); }
});

router.use(requireAuth);

router.get("/wishlist", async (req, res, next) => {
  try {
    const userId = sessionId(req, res); if (!userId) return;
    const result = await query("SELECT w.created_at, m.* FROM wishlists w JOIN models m ON m.id = w.model_id WHERE w.user_id = $1 ORDER BY w.created_at DESC", [userId]);
    res.json({ models: result.rows });
  } catch (error) { next(error); }
});

router.post("/wishlist/:modelId", async (req, res, next) => {
  try {
    const userId = sessionId(req, res); if (!userId) return;
    const model = await modelId(req.params.modelId);
    if (!model) return res.status(404).json({ error: "Model not found" });
    await query("INSERT INTO wishlists (user_id, model_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [userId, model]);
    await query("INSERT INTO user_activity (user_id, model_id, activity_type) VALUES ($1, $2, 'wishlist_added')", [userId, model]);
    res.status(201).json({ saved: true });
  } catch (error) { next(error); }
});

router.delete("/wishlist/:modelId", async (req, res, next) => {
  try {
    const userId = sessionId(req, res); if (!userId) return;
    const model = await modelId(req.params.modelId);
    if (model) await query("DELETE FROM wishlists WHERE user_id = $1 AND model_id = $2", [userId, model]);
    res.status(204).end();
  } catch (error) { next(error); }
});

router.get("/collections", async (req, res, next) => {
  try {
    const userId = sessionId(req, res); if (!userId) return;
    const result = await query("SELECT c.*, COUNT(ci.model_id)::int AS item_count FROM collections c LEFT JOIN collection_items ci ON ci.collection_id = c.id WHERE c.owner_user_id = $1 OR c.is_public = true GROUP BY c.id ORDER BY c.updated_at DESC", [userId]);
    res.json({ collections: result.rows });
  } catch (error) { next(error); }
});

router.post("/collections", async (req, res, next) => {
  try {
    const userId = sessionId(req, res); if (!userId) return;
    const body = z.object({ name: z.string().min(1).max(120), description: z.string().max(1000).default(""), isPublic: z.boolean().default(false) }).parse(req.body);
    const result = await query("INSERT INTO collections (owner_user_id, name, description, is_public) VALUES ($1, $2, $3, $4) RETURNING *", [userId, body.name, body.description, body.isPublic]);
    res.status(201).json({ collection: result.rows[0] });
  } catch (error) { next(error); }
});

router.post("/collections/:collectionId/items", async (req, res, next) => {
  try {
    const userId = sessionId(req, res); if (!userId) return;
    const collection = await query("SELECT id FROM collections WHERE id = $1 AND owner_user_id = $2", [req.params.collectionId, userId]);
    const model = await modelId(z.string().min(1).parse(req.body.modelId));
    if (!collection.rows[0] || !model) return res.status(404).json({ error: "Collection or model not found" });
    await query("INSERT INTO collection_items (collection_id, model_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [req.params.collectionId, model]);
    await query("UPDATE collections SET updated_at = now() WHERE id = $1", [req.params.collectionId]);
    res.status(201).json({ saved: true });
  } catch (error) { next(error); }
});

router.post("/follow/:wallet", async (req, res, next) => {
  try {
    const userId = sessionId(req, res); if (!userId) return;
    const wallet = z.string().regex(/^0x[a-fA-F0-9]{40}$/).parse(req.params.wallet).toLowerCase();
    const creator = await query<{ id: string }>("SELECT id FROM users WHERE lower(wallet_address) = lower($1) AND role IN ('creator', 'admin', 'super_admin')", [wallet]);
    if (!creator.rows[0]) return res.status(404).json({ error: "Creator not found" });
    await query("INSERT INTO creator_follows (follower_user_id, creator_user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [userId, creator.rows[0].id]);
    await query("INSERT INTO notifications (user_id, type, title, body, metadata) VALUES ($1, 'creator_followed', 'New follower', $2, $3)", [creator.rows[0].id, "A buyer followed your creator profile", { follower: req.user!.address }]);
    res.status(201).json({ following: true });
  } catch (error) { next(error); }
});

router.delete("/follow/:wallet", async (req, res, next) => {
  try {
    const userId = sessionId(req, res); if (!userId) return;
    const wallet = z.string().regex(/^0x[a-fA-F0-9]{40}$/).parse(req.params.wallet).toLowerCase();
    await query("DELETE FROM creator_follows WHERE follower_user_id = $1 AND creator_user_id = (SELECT id FROM users WHERE lower(wallet_address) = lower($2))", [userId, wallet]);
    res.status(204).end();
  } catch (error) { next(error); }
});

router.get("/notifications", async (req, res, next) => {
  try {
    const userId = sessionId(req, res); if (!userId) return;
    const result = await query("SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2", [userId, Math.min(100, Math.max(1, Number(req.query.limit ?? 30)))]);
    res.json({ notifications: result.rows });
  } catch (error) { next(error); }
});

router.patch("/notifications/:id/read", async (req, res, next) => {
  try {
    const userId = sessionId(req, res); if (!userId) return;
    const result = await query("UPDATE notifications SET read_at = now() WHERE id = $1 AND user_id = $2 RETURNING *", [req.params.id, userId]);
    if (!result.rows[0]) return res.status(404).json({ error: "Notification not found" });
    res.json({ notification: result.rows[0] });
  } catch (error) { next(error); }
});

router.post("/featured", requireRole("admin", "moderator"), async (req, res, next) => {
  try {
    const body = z.object({ itemType: z.enum(["model", "creator"]), itemKey: z.string().min(1).max(120), placement: z.string().min(1).max(50).default("home"), endsAt: z.string().datetime().optional() }).parse(req.body);
    const result = await query("INSERT INTO featured_items (item_type, item_key, placement, ends_at, created_by) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (item_type, item_key, placement) DO UPDATE SET ends_at = EXCLUDED.ends_at RETURNING *", [body.itemType, body.itemKey, body.placement, body.endsAt ?? null, req.user!.address]);
    res.status(201).json({ featured: result.rows[0] });
  } catch (error) { next(error); }
});

export default router;
