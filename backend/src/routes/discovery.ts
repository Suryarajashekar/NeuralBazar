import { Router } from "express";
import { z } from "zod";
import { query } from "../db";
import { requireAuth } from "../middleware/auth";
import { cosineSimilarity, textEmbedding } from "../services/embeddings";
import { config } from "../config";

const router = Router();
const uuid = z.string().uuid();
const publicModelWhere = "m.status = 'published' AND m.security_status IN ('verified_safe', 'legacy_unverified')";
type SemanticRow = { [key: string]: unknown; title: string; description: string; category: string; tags: string[]; rating?: number | string; download_count?: number | string; revenue_eth?: number | string; created_at?: string | Date; trending_score?: number | string };

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
    const type = String(req.query.type ?? "").trim().slice(0, 80);
    const access = ["free", "paid"].includes(String(req.query.access)) ? String(req.query.access) : "";
    const sort = ["trending", "newest", "rating", "downloads", "revenue"].includes(String(req.query.sort)) ? String(req.query.sort) : "relevance";
    const rows = await query<SemanticRow>(
      `SELECT m.*, l.listing_id_onchain, l.price_wei, to_char(l.price_wei / 1000000000000000000.0, 'FM999999990.########') AS price_eth,
              COALESCE(u.username, substring(m.creator_wallet, 1, 10)) AS creator_name,
              COALESCE((SELECT AVG(r.score) FROM ratings r WHERE r.target_type = 'model' AND r.target_key = m.id::text), 0) AS rating,
              to_char(COALESCE((SELECT SUM(p.price_paid_wei) FROM purchases p WHERE p.model_id = m.id), 0) / 1000000000000000000.0, 'FM999999990.########') AS revenue_eth
       FROM models m LEFT JOIN users u ON lower(u.wallet_address) = lower(m.creator_wallet)
       LEFT JOIN listings l ON l.model_id_onchain = m.model_id_onchain AND l.active = true
       WHERE ${publicModelWhere} AND ($1 = '' OR m.search_document @@ plainto_tsquery('simple', $1) OR m.title ILIKE '%' || $1 || '%' OR m.description ILIKE '%' || $1 || '%')
         AND ($2 = '' OR m.category = $2)
         AND ($3 = '' OR lower(m.category) = lower($3) OR lower(m.title) ILIKE '%' || lower($3) || '%' OR EXISTS (SELECT 1 FROM unnest(m.tags) tag WHERE lower(tag) = lower($3)))
         AND ($4 = '' OR ($4 = 'free' AND (l.price_wei IS NULL OR l.price_wei = 0)) OR ($4 = 'paid' AND l.price_wei IS NOT NULL AND l.price_wei > 0))
       ORDER BY m.trending_score DESC, m.created_at DESC LIMIT $5`, [q, category, type, access, Math.min(200, limit * 4)]
    );
    const queryVector = textEmbedding(q);
    const models = rows.rows.map(model => {
      const text = `${model.title} ${model.description} ${model.category} ${(model.tags ?? []).join(" ")}`;
      const lexical = q ? text.toLowerCase().includes(q.toLowerCase()) ? 1 : 0 : 0;
      const score = q ? Math.max(0, Math.min(1, (cosineSimilarity(queryVector, textEmbedding(text)) + 1) / 2 * 0.7 + lexical * 0.3)) : 0;
      return { ...model, semantic_score: Number(score.toFixed(4)) };
    }).sort((left, right) => sort === "rating" ? Number(right.rating || 0) - Number(left.rating || 0) : sort === "downloads" ? Number(right.download_count || 0) - Number(left.download_count || 0) : sort === "revenue" ? Number(right.revenue_eth || 0) - Number(left.revenue_eth || 0) : sort === "newest" ? new Date(String(right.created_at)).getTime() - new Date(String(left.created_at)).getTime() : sort === "trending" ? Number(right.trending_score || 0) - Number(left.trending_score || 0) : right.semantic_score - left.semantic_score).slice(0, limit);
    res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=120");
    res.json({ models, query: q, embeddingModel: config.embeddingModel });
  } catch (error) { next(error); }
});

router.post("/search/track", requireAuth, async (req, res, next) => {
  try {
    if (!uuid.safeParse(req.user!.sub).success) return res.status(403).json({ error: "A session account is required" });
    const body = z.object({ query: z.string().trim().min(2).max(300) }).parse(req.body ?? {});
    await query(
      "INSERT INTO user_activity (user_id, activity_type, metadata) VALUES ($1, 'searched', $2)",
      [req.user!.sub, { query: body.query, source: "marketplace-search" }]
    );
    res.status(204).end();
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

router.get("/recommendations", requireAuth, async (req, res, next) => {
  try {
    if (!uuid.safeParse(req.user!.sub).success) return res.status(403).json({ error: "A session account is required" });
    const signals = await query<{ category: string; tags: string[]; activity_type: string }>(
      `SELECT m.category, m.tags, a.activity_type
       FROM user_activity a JOIN models m ON m.id = a.model_id
       WHERE a.user_id = $1 AND a.model_id IS NOT NULL
       ORDER BY a.created_at DESC LIMIT 200`, [req.user!.sub]
    );
    const purchases = await query<{ category: string; tags: string[] }>(
      `SELECT m.category, m.tags FROM purchases p JOIN models m ON m.model_id_onchain = p.model_id_onchain
       JOIN users u ON lower(u.wallet_address) = lower(p.buyer_wallet)
       WHERE u.id = $1 ORDER BY p.purchased_at DESC LIMIT 100`, [req.user!.sub]
    );
    const searches = await query<{ query: string }>(
      "SELECT metadata->>'query' AS query FROM user_activity WHERE user_id = $1 AND activity_type = 'searched' ORDER BY created_at DESC LIMIT 10", [req.user!.sub]
    );
    const preferences = new Map<string, number>();
    const tagPreferences = new Map<string, number>();
    const weight: Record<string, number> = { viewed: 1, downloaded: 3, wishlist_added: 2 };
    for (const signal of signals.rows) {
      const value = weight[signal.activity_type] ?? 1;
      preferences.set(signal.category, (preferences.get(signal.category) ?? 0) + value);
      for (const tag of signal.tags ?? []) tagPreferences.set(tag.toLowerCase(), (tagPreferences.get(tag.toLowerCase()) ?? 0) + value);
    }
    for (const purchase of purchases.rows) {
      preferences.set(purchase.category, (preferences.get(purchase.category) ?? 0) + 4);
      for (const tag of purchase.tags ?? []) tagPreferences.set(tag.toLowerCase(), (tagPreferences.get(tag.toLowerCase()) ?? 0) + 4);
    }
    const category = [...preferences.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
    const tags = [...tagPreferences.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([tag]) => tag);
    const latestSearch = searches.rows[0]?.query ?? "";
    const result = await query(
      `SELECT m.*, l.listing_id_onchain, l.price_wei, to_char(l.price_wei / 1000000000000000000.0, 'FM999999990.########') AS price_eth,
              COALESCE(u.username, substring(m.creator_wallet, 1, 10)) AS creator_name,
              COALESCE((SELECT ROUND(AVG(r.score)::numeric, 1) FROM ratings r WHERE r.target_type = 'model' AND r.target_key = m.id::text), 0) AS rating,
              (CASE WHEN $1 <> '' AND lower(m.category) = lower($1) THEN 8 ELSE 0 END
               + COALESCE((SELECT COUNT(*) FROM unnest(m.tags) tag WHERE lower(tag) = ANY($2::text[])), 0) * 2
               + CASE WHEN $3 <> '' AND (m.title ILIKE '%' || $3 || '%' OR m.description ILIKE '%' || $3 || '%' OR $3 = ANY(m.tags)) THEN 5 ELSE 0 END
               + LEAST(m.trending_score, 20) * 0.05) AS recommendation_score
       FROM models m LEFT JOIN users u ON lower(u.wallet_address) = lower(m.creator_wallet)
       LEFT JOIN listings l ON l.model_id_onchain = m.model_id_onchain AND l.active = true
       WHERE ${publicModelWhere} AND ($1 = '' OR lower(m.category) = lower($1) OR EXISTS (SELECT 1 FROM unnest(m.tags) tag WHERE lower(tag) = ANY($2::text[])) OR ($3 <> '' AND (m.title ILIKE '%' || $3 || '%' OR m.description ILIKE '%' || $3 || '%')))
       ORDER BY recommendation_score DESC, m.trending_score DESC, m.created_at DESC LIMIT $4`, [category, tags, latestSearch, Math.min(30, Math.max(1, Number(req.query.limit ?? 12)))]
    );
    res.json({ models: result.rows, strategy: category || tags.length || latestSearch ? "browsing-download-purchase-search-signals" : "new-user-trending", preferences: { category, tags, latestSearch } });
  } catch (error) { next(error); }
});

router.post("/models/:id/view", requireAuth, async (req, res, next) => {
  try {
    if (!uuid.safeParse(req.user!.sub).success) return res.status(403).json({ error: "A session account is required" });
    const model = await resolveModel(String(req.params.id));
    if (!model) return res.status(404).json({ error: "Model not found" });
    await query("UPDATE models SET view_count = view_count + 1, trending_score = trending_score + 0.1 WHERE id = $1", [model.id]);
    await query("INSERT INTO user_activity (user_id, model_id, activity_type, metadata) VALUES ($1, $2, 'viewed', $3)", [req.user!.sub, model.id, { source: "model-detail", country: req.header("x-country")?.trim().slice(0, 80) || "", device_type: req.header("x-device-type")?.trim().slice(0, 40) || "" }]);
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

router.get("/recently-viewed", requireAuth, async (req, res, next) => {
  try {
    if (!uuid.safeParse(req.user!.sub).success) return res.status(403).json({ error: "A session account is required" });
    const result = await query(
      `SELECT DISTINCT ON (m.id) a.created_at AS viewed_at, m.*,
              COALESCE(u.username, substring(m.creator_wallet, 1, 10)) AS creator_name,
              l.listing_id_onchain, to_char(l.price_wei / 1000000000000000000.0, 'FM999999990.########') AS price_eth
       FROM user_activity a JOIN models m ON m.id = a.model_id
       LEFT JOIN users u ON lower(u.wallet_address) = lower(m.creator_wallet)
       LEFT JOIN listings l ON l.model_id_onchain = m.model_id_onchain AND l.active = true
       WHERE a.user_id = $1 AND a.activity_type = 'viewed' AND ${publicModelWhere}
       ORDER BY m.id, a.created_at DESC`, [req.user!.sub]
    );
    res.json({ models: result.rows.sort((a, b) => new Date(String(b.viewed_at)).getTime() - new Date(String(a.viewed_at)).getTime()).slice(0, Math.min(12, Math.max(1, Number(req.query.limit ?? 8)))) });
  } catch (error) { next(error); }
});

export default router;
