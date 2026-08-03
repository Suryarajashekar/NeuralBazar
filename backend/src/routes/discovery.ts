import { Router } from "express";
import { z } from "zod";
import { query } from "../db";
import { requireAuth } from "../middleware/auth";
import { cosineSimilarity, textEmbedding } from "../services/embeddings";
import { config } from "../config";

const router = Router();
const uuid = z.string().uuid();
const publicModelWhere = "m.status = 'published' AND m.security_status IN ('verified_safe', 'legacy_unverified')";

async function resolveModel(value: string) {
  const result = await query<{ id: string; category: string; title: string; description: string; tags: string[] }>(
    `SELECT m.id, m.category, m.title, m.description, m.tags FROM models m WHERE (m.id::text = $1 OR m.model_id_onchain::text = $1) AND ${publicModelWhere}`,
    [value]
  );
  return result.rows[0];
}

router.get("/search/semantic", async (req, res, next) => {
  try {
    const q = z.string().max(300).default("").parse(String(req.query.q ?? "").trim());
    const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 20)));
    const category = String(req.query.category ?? "").trim().slice(0, 80);
    const rows = await query(
      `SELECT m.*, l.listing_id_onchain, l.price_wei, to_char(l.price_wei / 1000000000000000000.0, 'FM999999990.########') AS price_eth,
              COALESCE(u.username, substring(m.creator_wallet, 1, 10)) AS creator_name,
              COALESCE((SELECT AVG(r.score) FROM ratings r WHERE r.target_type = 'model' AND r.target_key = m.id::text), 0) AS rating
       FROM models m LEFT JOIN users u ON lower(u.wallet_address) = lower(m.creator_wallet)
       LEFT JOIN listings l ON l.model_id_onchain = m.model_id_onchain AND l.active = true
       WHERE ${publicModelWhere} AND ($1 = '' OR m.search_document @@ plainto_tsquery('simple', $1) OR m.title ILIKE '%' || $1 || '%' OR m.description ILIKE '%' || $1 || '%')
         AND ($2 = '' OR m.category = $2)
       ORDER BY m.trending_score DESC, m.created_at DESC LIMIT $3`, [q, category, Math.min(200, limit * 4)]
    );
    const queryVector = textEmbedding(q);
    const models = rows.rows.map(model => {
      const text = `${model.title} ${model.description} ${model.category} ${(model.tags ?? []).join(" ")}`;
      const lexical = q ? text.toLowerCase().includes(q.toLowerCase()) ? 1 : 0 : 0;
      const score = q ? Math.max(0, Math.min(1, (cosineSimilarity(queryVector, textEmbedding(text)) + 1) / 2 * 0.7 + lexical * 0.3)) : 0;
      return { ...model, semantic_score: Number(score.toFixed(4)) };
    }).sort((left, right) => right.semantic_score - left.semantic_score).slice(0, limit);
    res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=120");
    res.json({ models, query: q, embeddingModel: config.embeddingModel });
  } catch (error) { next(error); }
});

router.get("/models/:id/similar", async (req, res, next) => {
  try {
    const model = await resolveModel(String(req.params.id));
    if (!model) return res.status(404).json({ error: "Model not found" });
    const source = textEmbedding(`${model.title} ${model.description} ${model.category} ${model.tags.join(" ")}`);
    const candidates = await query(
      `SELECT m.*, COALESCE(u.username, substring(m.creator_wallet, 1, 10)) AS creator_name
       FROM models m LEFT JOIN users u ON lower(u.wallet_address) = lower(m.creator_wallet)
       WHERE ${publicModelWhere} AND m.id <> $1 AND m.category = $2 ORDER BY m.trending_score DESC, m.created_at DESC LIMIT 50`, [model.id, model.category]
    );
    const models = candidates.rows.map(candidate => ({ ...candidate, semantic_score: Number(((cosineSimilarity(source, textEmbedding(`${candidate.title} ${candidate.description} ${candidate.category} ${(candidate.tags ?? []).join(" ")}`)) + 1) / 2).toFixed(4)) })).sort((a, b) => b.semantic_score - a.semantic_score).slice(0, 12);
    res.json({ models });
  } catch (error) { next(error); }
});

router.get("/recommendations", async (req, res, next) => {
  try {
    const userId = typeof req.query.userId === "string" && uuid.safeParse(req.query.userId).success ? req.query.userId : null;
    let category = "";
    if (userId) {
      const activity = await query<{ category: string }>(
        `SELECT m.category FROM user_activity a JOIN models m ON m.id = a.model_id WHERE a.user_id = $1 ORDER BY a.created_at DESC LIMIT 1`, [userId]
      );
      category = activity.rows[0]?.category ?? "";
    }
    const result = await query(
      `SELECT m.*, COALESCE(u.username, substring(m.creator_wallet, 1, 10)) AS creator_name
       FROM models m LEFT JOIN users u ON lower(u.wallet_address) = lower(m.creator_wallet)
       WHERE ${publicModelWhere} AND ($1 = '' OR m.category = $1)
       ORDER BY m.trending_score DESC, m.view_count DESC, m.created_at DESC LIMIT $2`, [category, Math.min(30, Math.max(1, Number(req.query.limit ?? 12)))]
    );
    res.json({ models: result.rows, strategy: category ? "recent-activity-category" : "trending" });
  } catch (error) { next(error); }
});

router.post("/models/:id/view", requireAuth, async (req, res, next) => {
  try {
    if (!uuid.safeParse(req.user!.sub).success) return res.status(403).json({ error: "A session account is required" });
    const model = await resolveModel(String(req.params.id));
    if (!model) return res.status(404).json({ error: "Model not found" });
    await query("UPDATE models SET view_count = view_count + 1, trending_score = trending_score + 0.1 WHERE id = $1", [model.id]);
    await query("INSERT INTO user_activity (user_id, model_id, activity_type, metadata) VALUES ($1, $2, 'viewed', $3)", [req.user!.sub, model.id, { source: "model-detail" }]);
    res.status(204).end();
  } catch (error) { next(error); }
});

router.get("/trending", async (req, res, next) => {
  try {
    const result = await query(`SELECT m.* FROM models m WHERE ${publicModelWhere} ORDER BY m.trending_score DESC, m.view_count DESC, m.created_at DESC LIMIT $1`, [Math.min(50, Math.max(1, Number(req.query.limit ?? 20)))]);
    res.json({ models: result.rows });
  } catch (error) { next(error); }
});

router.get("/activity/:type", requireAuth, async (req, res, next) => {
  try {
    if (!uuid.safeParse(req.user!.sub).success) return res.status(403).json({ error: "A session account is required" });
    const type = z.enum(["viewed", "downloaded", "searched", "wishlist_added"]).parse(req.params.type);
    const result = await query(
      `SELECT a.created_at, a.metadata, m.* FROM user_activity a JOIN models m ON m.id = a.model_id WHERE a.user_id = $1 AND a.activity_type = $2 ORDER BY a.created_at DESC LIMIT $3`,
      [req.user!.sub, type, Math.min(100, Math.max(1, Number(req.query.limit ?? 30)))]
    );
    res.json({ activity: result.rows });
  } catch (error) { next(error); }
});

export default router;
