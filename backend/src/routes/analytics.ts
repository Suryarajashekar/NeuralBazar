import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../middleware/auth";
import { query, withTransaction } from "../db";
import { requirePermission } from "../services/identity";

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

router.get("/creator", requirePermission("analytics.creator"), async (req, res, next) => {
  try {
    const wallet = req.user!.address;
    const userId = req.user!.sub;
    const [headline, sales, ratings, daily, heatmap, devices, apiUsage, prompts, peakHours] = await Promise.all([
      query(`SELECT COUNT(*)::int AS models, COUNT(*) FILTER (WHERE status = 'published')::int AS published,
                    COALESCE(SUM(view_count), 0)::bigint AS visitors, COALESCE(SUM(download_count), 0)::bigint AS downloads
             FROM models WHERE lower(creator_wallet) = lower($1)`, [wallet]),
      query(`SELECT COUNT(p.id)::int AS sales, COALESCE(SUM(p.price_paid_wei), 0)::text AS revenue_wei,
                    COALESCE(SUM(p.price_paid_wei) FILTER (WHERE p.purchased_at >= date_trunc('month', now())), 0)::text AS monthly_revenue_wei,
                    COUNT(DISTINCT p.buyer_wallet)::int AS buyers,
                    COALESCE(COUNT(rr.id), 0)::int AS refund_requests
             FROM purchases p JOIN models m ON m.model_id_onchain = p.model_id_onchain
             LEFT JOIN refund_requests rr ON rr.purchase_id = p.id
             WHERE lower(m.creator_wallet) = lower($1)`, [wallet]),
      query(`SELECT COALESCE(AVG(r.score), 0)::numeric(4,2) AS average, COUNT(*)::int AS count
             FROM ratings r JOIN models m ON r.target_type = 'model' AND r.target_key = m.id::text
             WHERE lower(m.creator_wallet) = lower($1) AND r.moderation_status = 'visible'`, [wallet]),
      query(`SELECT series.day::date AS day,
                    COALESCE((SELECT COUNT(*) FROM purchases p JOIN models m ON m.model_id_onchain = p.model_id_onchain WHERE lower(m.creator_wallet) = lower($1) AND p.purchased_at::date = series.day::date), 0)::int AS sales,
                    COALESCE((SELECT SUM(p.price_paid_wei) FROM purchases p JOIN models m ON m.model_id_onchain = p.model_id_onchain WHERE lower(m.creator_wallet) = lower($1) AND p.purchased_at::date = series.day::date), 0)::text AS revenue_wei,
                    COALESCE((SELECT COUNT(*) FROM user_activity a JOIN models m ON m.id = a.model_id WHERE lower(m.creator_wallet) = lower($1) AND a.activity_type = 'viewed' AND a.created_at::date = series.day::date), 0)::int AS visitors,
                    COALESCE((SELECT COUNT(*) FROM user_activity a JOIN models m ON m.id = a.model_id WHERE lower(m.creator_wallet) = lower($1) AND a.activity_type = 'downloaded' AND a.created_at::date = series.day::date), 0)::int AS downloads
             FROM generate_series(current_date - interval '29 days', current_date, interval '1 day') series(day)
             ORDER BY series.day`, [wallet]),
      query(`SELECT COALESCE(a.metadata->>'country', 'Unknown') AS country, COUNT(*)::int AS visits
             FROM user_activity a JOIN models m ON m.id = a.model_id
             WHERE lower(m.creator_wallet) = lower($1) AND a.activity_type = 'viewed'
             GROUP BY 1 ORDER BY visits DESC LIMIT 12`, [wallet]),
      query(`SELECT COALESCE(a.metadata->>'device_type', 'Unknown') AS device_type, COUNT(*)::int AS visits
             FROM user_activity a JOIN models m ON m.id = a.model_id
             WHERE lower(m.creator_wallet) = lower($1) AND a.activity_type = 'viewed'
             GROUP BY 1 ORDER BY visits DESC LIMIT 8`, [wallet]),
      query(`SELECT COUNT(*)::int AS calls, COALESCE(SUM(u.units), 0)::bigint AS units, COALESCE(SUM(u.tokens), 0)::bigint AS tokens,
                    COALESCE(SUM(u.cost_usd), 0)::numeric(14,2) AS cost_usd
             FROM api_usage u LEFT JOIN models m ON m.id = u.model_id
             WHERE lower(m.creator_wallet) = lower($1) OR u.user_id = $2`, [wallet, userId]),
      query(`SELECT COALESCE(NULLIF(u.metadata->>'prompt', ''), '(unlabelled)') AS prompt, COUNT(*)::int AS uses
             FROM api_usage u LEFT JOIN models m ON m.id = u.model_id
             WHERE lower(m.creator_wallet) = lower($1) OR u.user_id = $2
             GROUP BY 1 ORDER BY uses DESC LIMIT 8`, [wallet, userId]),
      query(`SELECT EXTRACT(HOUR FROM u.created_at)::int AS hour, COUNT(*)::int AS calls
             FROM api_usage u LEFT JOIN models m ON m.id = u.model_id
             WHERE lower(m.creator_wallet) = lower($1) OR u.user_id = $2
             GROUP BY 1 ORDER BY calls DESC LIMIT 8`, [wallet, userId])
    ]);
    const visitors = Number(headline.rows[0]?.visitors ?? 0);
    const salesCount = Number(sales.rows[0]?.sales ?? 0);
    res.json({ analytics: {
      headline: { ...headline.rows[0], ...sales.rows[0], ...ratings.rows[0], conversion_rate: visitors ? Number(((salesCount / visitors) * 100).toFixed(2)) : 0, monthly_income_wei: sales.rows[0]?.monthly_revenue_wei ?? "0", refund_rate: salesCount ? Number(((Number(sales.rows[0]?.refund_requests ?? 0) / salesCount) * 100).toFixed(2)) : 0 },
      daily: daily.rows, countries: heatmap.rows, devices: devices.rows, apiUsage: apiUsage.rows[0], mostUsedPrompts: prompts.rows, peakHours: peakHours.rows
    } });
  } catch (error) { next(error); }
});

router.get("/creator/experiments", requirePermission("analytics.creator"), async (req, res, next) => {
  try {
    const result = await query(`SELECT e.id, e.name, e.status, e.primary_metric, e.created_at, m.title AS model_title,
       json_agg(json_build_object('id', v.id, 'variant_key', v.variant_key, 'label', v.label, 'traffic_percent', v.traffic_percent,
         'views', COALESCE((SELECT COUNT(*) FROM creator_experiment_events ev WHERE ev.variant_id = v.id AND ev.event_type = 'view'), 0),
         'purchases', COALESCE((SELECT COUNT(*) FROM creator_experiment_events ev WHERE ev.variant_id = v.id AND ev.event_type = 'purchase'), 0))) AS variants
       FROM creator_experiments e JOIN models m ON m.id = e.model_id JOIN creator_experiment_variants v ON v.experiment_id = e.id
       WHERE e.owner_user_id = $1 GROUP BY e.id, m.title ORDER BY e.created_at DESC`, [req.user!.sub]);
    res.json({ experiments: result.rows });
  } catch (error) { next(error); }
});

router.post("/creator/experiments", requirePermission("analytics.creator"), async (req, res, next) => {
  try {
    const body = z.object({ modelId: z.string().min(1), name: z.string().trim().min(3).max(120), variantA: z.string().trim().min(1).max(80), variantB: z.string().trim().min(1).max(80), versionA: z.string().uuid().optional(), versionB: z.string().uuid().optional(), trafficA: z.number().min(0).max(100).default(50), trafficB: z.number().min(0).max(100).default(50) }).parse(req.body);
    if (Math.abs(body.trafficA + body.trafficB - 100) > 0.01) return res.status(400).json({ error: "Variant traffic must total 100%" });
    const result = await withTransaction(async client => {
      const model = await client.query<{ id: string }>("SELECT id FROM models WHERE (id::text = $1 OR model_id_onchain::text = $1) AND lower(creator_wallet) = lower($2)", [body.modelId, req.user!.address]);
      if (!model.rows[0]) return null;
      const experiment = await client.query<{ id: string }>("INSERT INTO creator_experiments (owner_user_id, model_id, name) VALUES ($1, $2, $3) RETURNING id", [req.user!.sub, model.rows[0].id, body.name]);
      await client.query("INSERT INTO creator_experiment_variants (experiment_id, variant_key, label, version_id, traffic_percent) VALUES ($1, 'A', $2, $3, $4), ($1, 'B', $5, $6, $7)", [experiment.rows[0].id, body.variantA, body.versionA ?? null, body.trafficA, body.variantB, body.versionB ?? null, body.trafficB]);
      return experiment.rows[0];
    });
    if (!result) return res.status(404).json({ error: "Creator model not found" });
    res.status(201).json({ experiment: result });
  } catch (error) { next(error); }
});

router.post("/creator/experiments/:id/events", async (req, res, next) => {
  try {
    const body = z.object({ variantId: z.string().uuid(), visitorKey: z.string().trim().min(3).max(160), eventType: z.enum(["view", "purchase"]) }).parse(req.body);
    const experiment = await query("SELECT e.id FROM creator_experiments e JOIN creator_experiment_variants v ON v.experiment_id = e.id WHERE e.id = $1 AND v.id = $2", [req.params.id, body.variantId]);
    if (!experiment.rows[0]) return res.status(404).json({ error: "Experiment or variant not found" });
    await query("INSERT INTO creator_experiment_events (experiment_id, variant_id, visitor_key, event_type) VALUES ($1, $2, $3, $4)", [req.params.id, body.variantId, body.visitorKey, body.eventType]);
    res.status(201).json({ recorded: true });
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
