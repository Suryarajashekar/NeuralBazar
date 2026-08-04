import { Router } from "express";
import { z } from "zod";
import { query } from "../db";
import { requireAuth } from "../middleware/auth";

const router = Router();
const modelParam = z.string().min(1).max(120);
const periodSchema = z.enum(["weekly", "monthly", "all-time"]);

async function resolveModel(value: string) {
  const result = await query<{ id: string; title: string; description: string; category: string; creator_wallet: string; model_id_onchain: number }>("SELECT id, title, description, category, creator_wallet, model_id_onchain FROM models WHERE id::text = $1 OR model_id_onchain::text = $1", [value]);
  return result.rows[0];
}

function cutoff(period: "weekly" | "monthly" | "all-time") {
  return period === "weekly" ? "now() - interval '7 days'" : period === "monthly" ? "now() - interval '30 days'" : "'epoch'::timestamptz";
}

router.get("/models/:id/community", async (req, res, next) => {
  try {
    const model = await resolveModel(modelParam.parse(req.params.id));
    if (!model) return res.status(404).json({ error: "Model not found" });
    const [stats, discussions] = await Promise.all([
      query(`SELECT
        (SELECT COUNT(*)::int FROM model_likes WHERE model_id = $1) AS likes,
        (SELECT COUNT(*)::int FROM wishlists WHERE model_id = $1) AS bookmarks,
        (SELECT COUNT(*)::int FROM model_shares WHERE model_id = $1) AS shares,
        (SELECT COUNT(*)::int FROM model_discussions WHERE model_id = $1) AS discussions`, [model.id]),
      query(`SELECT d.id, d.kind, d.title, d.body, d.status, d.created_at, d.updated_at,
                    u.username AS author_username, u.display_name AS author_display_name, u.avatar_url AS author_avatar,
                    (SELECT COUNT(*)::int FROM discussion_comments c WHERE c.discussion_id = d.id) AS comment_count
             FROM model_discussions d JOIN users u ON u.id = d.author_user_id
             WHERE d.model_id = $1 ORDER BY d.updated_at DESC LIMIT 100`, [model.id])
    ]);
    res.json({ model, stats: stats.rows[0], discussions: discussions.rows });
  } catch (error) { next(error); }
});

router.get("/discussions/:id", async (req, res, next) => {
  try {
    const discussion = await query(`SELECT d.*, m.title AS model_title, m.id AS model_id, u.username AS author_username, u.display_name AS author_display_name, u.avatar_url AS author_avatar
      FROM model_discussions d JOIN models m ON m.id = d.model_id JOIN users u ON u.id = d.author_user_id WHERE d.id = $1`, [req.params.id]);
    if (!discussion.rows[0]) return res.status(404).json({ error: "Discussion not found" });
    const comments = await query(`SELECT c.id, c.body, c.created_at, u.username AS author_username, u.display_name AS author_display_name, u.avatar_url AS author_avatar
      FROM discussion_comments c JOIN users u ON u.id = c.author_user_id WHERE c.discussion_id = $1 ORDER BY c.created_at ASC`, [req.params.id]);
    res.json({ discussion: discussion.rows[0], comments: comments.rows });
  } catch (error) { next(error); }
});

router.post("/models/:id/like", requireAuth, async (req, res, next) => {
  try {
    const model = await resolveModel(modelParam.parse(req.params.id));
    if (!model) return res.status(404).json({ error: "Model not found" });
    await query("INSERT INTO model_likes (user_id, model_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [req.user!.sub, model.id]);
    res.status(201).json({ liked: true });
  } catch (error) { next(error); }
});

router.delete("/models/:id/like", requireAuth, async (req, res, next) => {
  try {
    const model = await resolveModel(modelParam.parse(req.params.id));
    if (model) await query("DELETE FROM model_likes WHERE user_id = $1 AND model_id = $2", [req.user!.sub, model.id]);
    res.status(204).end();
  } catch (error) { next(error); }
});

router.post("/models/:id/share", requireAuth, async (req, res, next) => {
  try {
    const model = await resolveModel(modelParam.parse(req.params.id));
    if (!model) return res.status(404).json({ error: "Model not found" });
    const channel = z.string().trim().min(1).max(40).default("copy_link").parse(req.body?.channel);
    await query("INSERT INTO model_shares (user_id, model_id, channel) VALUES ($1, $2, $3)", [req.user!.sub, model.id, channel]);
    res.status(201).json({ shared: true });
  } catch (error) { next(error); }
});

router.post("/models/:id/discussions", requireAuth, async (req, res, next) => {
  try {
    const model = await resolveModel(modelParam.parse(req.params.id));
    if (!model) return res.status(404).json({ error: "Model not found" });
    const body = z.object({ kind: z.enum(["discussion", "bug", "feature", "question"]).default("discussion"), title: z.string().trim().min(3).max(160), body: z.string().trim().min(1).max(5000) }).parse(req.body);
    const result = await query("INSERT INTO model_discussions (model_id, author_user_id, kind, title, body) VALUES ($1, $2, $3, $4, $5) RETURNING id, kind, title, body, status, created_at", [model.id, req.user!.sub, body.kind, body.title, body.body]);
    res.status(201).json({ discussion: result.rows[0] });
  } catch (error) { next(error); }
});

router.post("/discussions/:id/comments", requireAuth, async (req, res, next) => {
  try {
    const body = z.object({ body: z.string().trim().min(1).max(3000) }).parse(req.body);
    const thread = await query("SELECT id FROM model_discussions WHERE id = $1", [req.params.id]);
    if (!thread.rows[0]) return res.status(404).json({ error: "Discussion not found" });
    const result = await query("INSERT INTO discussion_comments (discussion_id, author_user_id, body) VALUES ($1, $2, $3) RETURNING id, body, created_at", [req.params.id, req.user!.sub, body.body]);
    await query("UPDATE model_discussions SET updated_at = now() WHERE id = $1", [req.params.id]);
    res.status(201).json({ comment: result.rows[0] });
  } catch (error) { next(error); }
});

router.get("/leaderboards", async (req, res, next) => {
  try {
    const period = periodSchema.parse(req.query.period ?? "weekly");
    const since = cutoff(period);
    const creators = await query(`SELECT u.id, COALESCE(u.display_name, u.username, substring(u.wallet_address, 1, 10)) AS label, u.username, u.avatar_url,
      COALESCE((SELECT COUNT(*) FROM models m WHERE lower(m.creator_wallet) = lower(u.wallet_address) AND m.status <> 'removed'), 0)::int AS models,
      COALESCE((SELECT COUNT(*) FROM purchases p JOIN models m ON m.model_id_onchain = p.model_id_onchain WHERE lower(m.creator_wallet) = lower(u.wallet_address) AND p.purchased_at >= ${since}), 0)::int AS sales,
      COALESCE((SELECT COUNT(*) FROM user_activity a JOIN models m ON m.id = a.model_id WHERE lower(m.creator_wallet) = lower(u.wallet_address) AND a.activity_type = 'downloaded' AND a.created_at >= ${since}), 0)::int AS downloads,
      COALESCE((SELECT AVG(r.score) FROM ratings r JOIN models m ON r.target_type = 'model' AND r.target_key = m.id::text WHERE lower(m.creator_wallet) = lower(u.wallet_address) AND r.moderation_status = 'visible'), 0)::numeric(4,2) AS rating
      FROM users u WHERE u.role IN ('creator', 'admin', 'super_admin') AND u.account_status = 'active'
      ORDER BY (COALESCE((SELECT COUNT(*) FROM purchases p JOIN models m ON m.model_id_onchain = p.model_id_onchain WHERE lower(m.creator_wallet) = lower(u.wallet_address) AND p.purchased_at >= ${since}), 0) * 5 + COALESCE((SELECT COUNT(*) FROM user_activity a JOIN models m ON m.id = a.model_id WHERE lower(m.creator_wallet) = lower(u.wallet_address) AND a.activity_type = 'downloaded' AND a.created_at >= ${since}), 0) / 10.0 + COALESCE((SELECT AVG(r.score) FROM ratings r JOIN models m ON r.target_type = 'model' AND r.target_key = m.id::text WHERE lower(m.creator_wallet) = lower(u.wallet_address)), 0) * 10) DESC LIMIT 10`);
    const customers = await query(`SELECT u.id, COALESCE(u.display_name, u.username, substring(u.wallet_address, 1, 10)) AS label, u.username, u.avatar_url,
      COALESCE((SELECT COUNT(*) FROM purchases p WHERE lower(p.buyer_wallet) = lower(u.wallet_address) AND p.purchased_at >= ${since}), 0)::int AS purchases,
      COALESCE((SELECT COUNT(*) FROM user_activity a WHERE a.user_id = u.id AND a.activity_type = 'downloaded' AND a.created_at >= ${since}), 0)::int AS downloads,
      COALESCE((SELECT COUNT(*) FROM wishlists w WHERE w.user_id = u.id), 0)::int AS bookmarks
      FROM users u WHERE u.account_status = 'active'
      ORDER BY (COALESCE((SELECT COUNT(*) FROM purchases p WHERE lower(p.buyer_wallet) = lower(u.wallet_address) AND p.purchased_at >= ${since}), 0) * 10 + COALESCE((SELECT COUNT(*) FROM user_activity a WHERE a.user_id = u.id AND a.activity_type = 'downloaded' AND a.created_at >= ${since}), 0) * 2 + COALESCE((SELECT COUNT(*) FROM wishlists w WHERE w.user_id = u.id), 0)) DESC LIMIT 10`);

    async function modelBoard(filter: string) {
      return query(`SELECT m.id, m.title AS label, m.category, m.model_id_onchain,
        COALESCE((SELECT COUNT(*) FROM model_likes l WHERE l.model_id = m.id AND l.created_at >= ${since}), 0)::int AS likes,
        COALESCE((SELECT COUNT(*) FROM model_shares s WHERE s.model_id = m.id AND s.created_at >= ${since}), 0)::int AS shares,
        COALESCE((SELECT COUNT(*) FROM purchases p WHERE p.model_id_onchain = m.model_id_onchain AND p.purchased_at >= ${since}), 0)::int AS sales,
        COALESCE((SELECT COUNT(*) FROM user_activity a WHERE a.model_id = m.id AND a.activity_type = 'viewed' AND a.created_at >= ${since}), 0)::int AS views,
        COALESCE((SELECT AVG(r.score) FROM ratings r WHERE r.target_type = 'model' AND r.target_key = m.id::text AND r.moderation_status = 'visible'), 0)::numeric(4,2) AS rating
        FROM models m WHERE m.status = 'published' AND (${filter})
        ORDER BY (COALESCE((SELECT COUNT(*) FROM model_likes l WHERE l.model_id = m.id AND l.created_at >= ${since}), 0) * 4 + COALESCE((SELECT COUNT(*) FROM purchases p WHERE p.model_id_onchain = m.model_id_onchain AND p.purchased_at >= ${since}), 0) * 8 + COALESCE((SELECT COUNT(*) FROM user_activity a WHERE a.model_id = m.id AND a.activity_type = 'viewed' AND a.created_at >= ${since}), 0) / 5.0 + COALESCE((SELECT AVG(r.score) FROM ratings r WHERE r.target_type = 'model' AND r.target_key = m.id::text), 0) * 3) DESC LIMIT 10`);
    }
    const [models, datasets, prompts, agents] = await Promise.all([
      modelBoard("TRUE"),
      modelBoard("lower(m.category) = 'dataset' OR m.tags && ARRAY['dataset','datasets']::text[]"),
      modelBoard("lower(m.category) = 'prompt' OR m.tags && ARRAY['prompt','prompts']::text[]"),
      modelBoard("lower(m.category) = 'agent' OR m.tags && ARRAY['agent','agents']::text[]")
    ]);
    res.json({ period, leaderboards: { creators: creators.rows, customers: customers.rows, models: models.rows, datasets: datasets.rows, prompts: prompts.rows, agents: agents.rows } });
  } catch (error) { next(error); }
});

export default router;
