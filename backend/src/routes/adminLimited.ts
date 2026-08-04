import { Router } from "express";
import { z } from "zod";
import { query } from "../db";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../services/identity";

const router = Router();
router.use(requireAuth);

router.get("/dashboard", requirePermission("admin.dashboard.read"), async (_req, res, next) => {
  try {
    const [users, models, sales, revenue, creators, traffic, apiUsage, fraud, daily] = await Promise.all([
      query("SELECT COUNT(*)::int AS count FROM users WHERE account_status = 'active'"),
      query("SELECT COUNT(*)::int AS count FROM models WHERE status = 'published'"),
      query("SELECT COUNT(*)::int AS count FROM purchases"),
      query("SELECT COALESCE(SUM(price_paid_wei), 0)::text AS total FROM purchases"),
      query("SELECT COUNT(*)::int AS count FROM users WHERE role IN ('creator', 'admin', 'super_admin') AND account_status = 'active'"),
      query("SELECT COUNT(*)::int AS count FROM user_activity WHERE activity_type = 'viewed'"),
      query("SELECT COUNT(*)::int AS calls, COALESCE(SUM(units), 0)::bigint AS units, COALESCE(SUM(cost_usd), 0)::numeric(14,2) AS cost_usd FROM api_usage WHERE created_at >= now() - interval '30 days'"),
      query("SELECT (SELECT COUNT(*) FROM reports WHERE status IN ('open', 'reviewing')) + (SELECT COUNT(*) FROM authentication_logs WHERE success = false AND created_at >= now() - interval '24 hours') AS count"),
      query(`SELECT series.day::date AS day,
                    COALESCE((SELECT COUNT(*) FROM purchases p WHERE p.purchased_at::date = series.day::date), 0)::int AS sales,
                    COALESCE((SELECT SUM(p.price_paid_wei) FROM purchases p WHERE p.purchased_at::date = series.day::date), 0)::text AS revenue_wei,
                    COALESCE((SELECT COUNT(*) FROM user_activity a WHERE a.activity_type = 'viewed' AND a.created_at::date = series.day::date), 0)::int AS traffic
             FROM generate_series(current_date - interval '29 days', current_date, interval '1 day') series(day) ORDER BY series.day`)
    ]);
    res.json({ dashboard: { users: Number(users.rows[0]?.count ?? 0), models: Number(models.rows[0]?.count ?? 0), sales: Number(sales.rows[0]?.count ?? 0), revenueWei: revenue.rows[0]?.total ?? "0", activeCreators: Number(creators.rows[0]?.count ?? 0), traffic: Number(traffic.rows[0]?.count ?? 0), apiUsage: apiUsage.rows[0], fraudAlerts: Number(fraud.rows[0]?.count ?? 0), daily: daily.rows } });
  } catch (error) { next(error); }
});

router.get("/models", requirePermission("moderation.content"), async (_req, res, next) => {
  try {
    const result = await query(`SELECT m.id, m.title, m.category, m.status, m.security_status, m.verified_safe, m.created_at, u.username AS creator_username, u.wallet_address AS creator_wallet
      FROM models m LEFT JOIN users u ON lower(u.wallet_address) = lower(m.creator_wallet)
      WHERE m.status IN ('draft', 'flagged', 'suspended') ORDER BY m.created_at DESC LIMIT 100`);
    res.json({ models: result.rows });
  } catch (error) { next(error); }
});

router.patch("/models/:id", requirePermission("moderation.content"), async (req, res, next) => {
  try {
    const action = z.object({ action: z.enum(["approve", "reject", "suspend"]) }).parse(req.body).action;
    const status = action === "approve" ? "published" : action === "reject" ? "removed" : "suspended";
    if (action === "approve") {
      const safe = await query("SELECT verified_safe, security_status FROM models WHERE id::text = $1 OR model_id_onchain::text = $1", [req.params.id]);
      if (!safe.rows[0]) return res.status(404).json({ error: "Model not found" });
      if (safe.rows[0].verified_safe !== true || safe.rows[0].security_status !== "verified_safe") return res.status(409).json({ error: "Only verified-safe models may be approved" });
    }
    const result = await query("UPDATE models SET status = $2, updated_at = now() WHERE id::text = $1 OR model_id_onchain::text = $1 RETURNING id, title, status", [req.params.id, status]);
    if (!result.rows[0]) return res.status(404).json({ error: "Model not found" });
    res.json({ model: result.rows[0] });
  } catch (error) { next(error); }
});

router.get("/creators", requirePermission("moderation.users.suspend"), async (_req, res, next) => {
  try { const result = await query("SELECT id, username, display_name, wallet_address, role, account_status, suspended_until, suspension_reason FROM users WHERE role = 'creator' ORDER BY created_at DESC LIMIT 100"); res.json({ creators: result.rows }); } catch (error) { next(error); }
});

router.post("/creators/:id/suspend", requirePermission("moderation.users.suspend"), async (req, res, next) => {
  try {
    const reason = z.object({ reason: z.string().trim().min(1).max(500) }).parse(req.body).reason;
    const result = await query("UPDATE users SET account_status = 'suspended', suspended_until = NULL, suspension_reason = $2, updated_at = now() WHERE id::text = $1 AND role = 'creator' RETURNING id, username, account_status, suspension_reason", [req.params.id, reason]);
    if (!result.rows[0]) return res.status(404).json({ error: "Creator not found" });
    res.json({ creator: result.rows[0] });
  } catch (error) { next(error); }
});

router.get("/reviews", requirePermission("moderation.reviews"), async (_req, res, next) => {
  try {
    const result = await query(`SELECT r.id, r.target_key, r.score, r.review, r.moderation_status, r.moderation_notes, r.created_at, m.title AS model_title
      FROM ratings r LEFT JOIN models m ON r.target_type = 'model' AND r.target_key = m.id::text
      WHERE r.target_type = 'model' ORDER BY r.created_at DESC LIMIT 100`);
    res.json({ reviews: result.rows });
  } catch (error) { next(error); }
});

router.patch("/reviews/:id", requirePermission("moderation.reviews"), async (req, res, next) => {
  try {
    const body = z.object({ moderationStatus: z.enum(["visible", "hidden", "warned"]), moderationNotes: z.string().max(500).default("") }).parse(req.body);
    const result = await query("UPDATE ratings SET moderation_status = $2, moderation_notes = $3, reported_at = CASE WHEN $2 = 'hidden' THEN now() ELSE reported_at END, report_reason = CASE WHEN $2 = 'hidden' THEN $3 ELSE report_reason END, updated_at = now() WHERE id = $1 RETURNING id, moderation_status, moderation_notes", [req.params.id, body.moderationStatus, body.moderationNotes]);
    if (!result.rows[0]) return res.status(404).json({ error: "Review not found" });
    res.json({ review: result.rows[0] });
  } catch (error) { next(error); }
});

router.get("/comments", requirePermission("moderation.comments"), async (_req, res, next) => {
  try { const result = await query(`SELECT c.id, c.body, c.moderation_status, c.moderation_notes, c.created_at, m.title AS model_title, u.username AS author_username FROM model_comments c JOIN models m ON m.id = c.model_id JOIN users u ON u.id = c.author_user_id ORDER BY c.created_at DESC LIMIT 100`); res.json({ comments: result.rows }); } catch (error) { next(error); }
});

router.patch("/comments/:id", requirePermission("moderation.comments"), async (req, res, next) => {
  try {
    const body = z.object({ moderationStatus: z.enum(["visible", "hidden", "removed"]), moderationNotes: z.string().max(500).default("") }).parse(req.body);
    const result = await query("UPDATE model_comments SET moderation_status = $2, moderation_notes = $3, moderated_by = $4, updated_at = now() WHERE id = $1 RETURNING id, moderation_status, moderation_notes", [req.params.id, body.moderationStatus, body.moderationNotes, req.user!.sub]);
    if (!result.rows[0]) return res.status(404).json({ error: "Comment not found" });
    res.json({ comment: result.rows[0] });
  } catch (error) { next(error); }
});

router.get("/refunds", requirePermission("refunds.review"), async (_req, res, next) => {
  try {
    const result = await query(`SELECT r.id, r.reason, r.status, r.resolution_note, r.created_at, p.price_paid_wei, p.buyer_wallet, m.title AS model_title
      FROM refund_requests r JOIN purchases p ON p.id = r.purchase_id LEFT JOIN models m ON m.model_id_onchain = p.model_id_onchain
      ORDER BY r.created_at DESC LIMIT 100`);
    res.json({ refunds: result.rows });
  } catch (error) { next(error); }
});

router.patch("/refunds/:id", requirePermission("refunds.review"), async (req, res, next) => {
  try {
    const body = z.object({ status: z.enum(["approved", "rejected", "paid"]), resolutionNote: z.string().max(1000).default("") }).parse(req.body);
    const result = await query("UPDATE refund_requests SET status = $2, resolution_note = $3, reviewer_user_id = $4, updated_at = now() WHERE id = $1 RETURNING id, status, resolution_note, updated_at", [req.params.id, body.status, body.resolutionNote, req.user!.sub]);
    if (!result.rows[0]) return res.status(404).json({ error: "Refund request not found" });
    res.json({ refund: result.rows[0] });
  } catch (error) { next(error); }
});

export default router;
