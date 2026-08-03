import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import { query } from "../db";

const router = Router();
const userIdRequired = (value: string | undefined) => value && /^[0-9a-f-]{36}$/i.test(value) ? value : undefined;

router.use(requireAuth);

router.get("/buyer", async (req, res, next) => {
  try {
    const userId = userIdRequired(req.user?.sub); if (!userId) return res.status(403).json({ error: "A session account is required" });
    const [purchases, downloads, wishlist, activity] = await Promise.all([
      query("SELECT COUNT(*)::int AS count, COALESCE(SUM(price_paid_wei), 0)::text AS volume_wei FROM purchases WHERE lower(buyer_wallet) = lower($1)", [req.user!.address]),
      query("SELECT COUNT(*)::int AS count FROM user_activity WHERE user_id = $1 AND activity_type = 'downloaded'", [userId]),
      query("SELECT COUNT(*)::int AS count FROM wishlists WHERE user_id = $1", [userId]),
      query("SELECT date_trunc('day', created_at) AS day, COUNT(*)::int AS count FROM user_activity WHERE user_id = $1 GROUP BY 1 ORDER BY 1 DESC LIMIT 30", [userId])
    ]);
    res.json({ analytics: { purchases: purchases.rows[0], downloads: downloads.rows[0].count, wishlistItems: wishlist.rows[0].count, activityByDay: activity.rows } });
  } catch (error) { next(error); }
});

router.get("/seller", async (req, res, next) => {
  try {
    const [models, sales, ratings, reputation] = await Promise.all([
      query("SELECT COUNT(*)::int AS count, COUNT(*) FILTER (WHERE status = 'published')::int AS published FROM models WHERE lower(creator_wallet) = lower($1)", [req.user!.address]),
      query("SELECT COUNT(*)::int AS count, COALESCE(SUM(p.price_paid_wei), 0)::text AS volume_wei FROM purchases p JOIN models m ON m.model_id_onchain = p.model_id_onchain WHERE lower(m.creator_wallet) = lower($1)", [req.user!.address]),
      query("SELECT COALESCE(AVG(r.score), 0)::numeric(4,2) AS average, COUNT(*)::int AS count FROM ratings r WHERE r.target_type = 'developer' AND lower(r.target_key) = lower($1)", [req.user!.address]),
      query("SELECT * FROM creator_reputation cr JOIN users u ON u.id = cr.user_id WHERE lower(u.wallet_address) = lower($1)", [req.user!.address])
    ]);
    res.json({ analytics: { models: models.rows[0], sales: sales.rows[0], ratings: ratings.rows[0], reputation: reputation.rows[0] ?? null } });
  } catch (error) { next(error); }
});

router.get("/admin", requireRole("admin", "moderator"), async (_req, res, next) => {
  try {
    const [security, api, auth, orgs] = await Promise.all([
      query("SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE verified_safe = true)::int AS verified_safe, COUNT(*) FILTER (WHERE security_status = 'rejected')::int AS rejected FROM upload_manifests"),
      query("SELECT COUNT(*)::int AS requests, COALESCE(SUM(units), 0)::text AS units FROM api_usage WHERE created_at > now() - interval '30 days'"),
      query("SELECT COUNT(*)::int AS failed_logins FROM authentication_logs WHERE success = false AND created_at > now() - interval '30 days'"),
      query("SELECT COUNT(*)::int AS organizations FROM organizations")
    ]);
    res.json({ analytics: { security: security.rows[0], apiUsage: api.rows[0], authentication: auth.rows[0], organizations: orgs.rows[0] } });
  } catch (error) { next(error); }
});

export default router;

