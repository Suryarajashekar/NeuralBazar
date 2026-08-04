import { Router } from "express";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { query } from "../db";
import { requireAuth } from "../middleware/auth";

const router = Router();
const uuid = z.string().uuid();

router.use(requireAuth);

router.get("/dashboard", async (req, res, next) => {
  try {
    const userId = req.user!.sub;
    const wallet = req.user!.address;
    const [purchased, saved, downloads, invoices, keys, usage, usageByDay, subscriptions, tickets, refunds] = await Promise.all([
      query(`SELECT m.*, p.id AS purchase_id, p.price_paid_wei, p.purchased_at, p.tx_hash, COALESCE(u.username, substring(m.creator_wallet, 1, 10)) AS creator_name
             FROM purchases p JOIN models m ON m.model_id_onchain = p.model_id_onchain
             LEFT JOIN users u ON lower(u.wallet_address) = lower(m.creator_wallet)
             WHERE lower(p.buyer_wallet) = lower($1) ORDER BY p.purchased_at DESC`, [wallet]),
      query(`SELECT w.created_at, m.*, COALESCE(u.username, substring(m.creator_wallet, 1, 10)) AS creator_name
             FROM wishlists w JOIN models m ON m.id = w.model_id
             LEFT JOIN users u ON lower(u.wallet_address) = lower(m.creator_wallet)
             WHERE w.user_id = $1 ORDER BY w.created_at DESC`, [userId]),
      query(`SELECT a.created_at, a.metadata, m.id AS model_id, m.title, m.category
             FROM user_activity a LEFT JOIN models m ON m.id = a.model_id
             WHERE a.user_id = $1 AND a.activity_type = 'downloaded' ORDER BY a.created_at DESC LIMIT 100`, [userId]),
      query(`SELECT p.id AS purchase_id, CONCAT('NB-', upper(substring(replace(p.id::text, '-', ''), 1, 10))) AS invoice_number,
                    m.title, p.price_paid_wei, p.purchased_at, p.tx_hash
             FROM purchases p LEFT JOIN models m ON m.model_id_onchain = p.model_id_onchain
             WHERE lower(p.buyer_wallet) = lower($1) ORDER BY p.purchased_at DESC`, [wallet]),
      query("SELECT id, key_prefix, role, created_at, last_used_at, revoked_at FROM managed_api_keys WHERE owner_user_id = $1 ORDER BY created_at DESC", [userId]),
      query(`SELECT COUNT(*)::int AS calls, COALESCE(SUM(units), 0)::bigint AS units, COALESCE(SUM(tokens), 0)::bigint AS tokens,
                    COALESCE(SUM(cost_usd), 0)::numeric(14, 2) AS cost_usd
             FROM api_usage WHERE user_id = $1 AND created_at >= date_trunc('month', now())`, [userId]),
      query(`SELECT series.day::date AS day,
                    COALESCE((SELECT COUNT(*) FROM api_usage u WHERE u.user_id = $1 AND u.created_at::date = series.day::date), 0)::int AS calls,
                    COALESCE((SELECT SUM(u.tokens) FROM api_usage u WHERE u.user_id = $1 AND u.created_at::date = series.day::date), 0)::bigint AS tokens,
                    COALESCE((SELECT SUM(u.cost_usd) FROM api_usage u WHERE u.user_id = $1 AND u.created_at::date = series.day::date), 0)::numeric(14, 2) AS cost_usd
             FROM generate_series(current_date - interval '29 days', current_date, interval '1 day') series(day)
             ORDER BY series.day`, [userId]),
      query("SELECT id, plan_name, status, monthly_credits, credits_used, monthly_cost_usd, renews_at FROM subscriptions WHERE user_id = $1 ORDER BY created_at DESC", [userId]),
      query("SELECT id, subject, body, status, priority, created_at, updated_at FROM support_tickets WHERE requester_user_id = $1 ORDER BY updated_at DESC", [userId]),
      query(`SELECT r.id, r.reason, r.status, r.resolution_note, r.created_at, p.id AS purchase_id, m.title
             FROM refund_requests r JOIN purchases p ON p.id = r.purchase_id LEFT JOIN models m ON m.model_id_onchain = p.model_id_onchain
             WHERE r.requester_user_id = $1 ORDER BY r.created_at DESC`, [userId])
    ]);
    const credits = subscriptions.rows.reduce((sum, row) => sum + (row.status === "active" ? Number(row.monthly_credits || 0) - Number(row.credits_used || 0) : 0), 0);
    res.json({ dashboard: { purchased: purchased.rows, saved: saved.rows, downloads: downloads.rows, invoices: invoices.rows, apiKeys: keys.rows, usage: usage.rows[0], usageByDay: usageByDay.rows, subscriptions: subscriptions.rows, remainingCredits: Math.max(0, credits), tickets: tickets.rows, refunds: refunds.rows } });
  } catch (error) { next(error); }
});

router.get("/api-keys", async (req, res, next) => {
  try { const result = await query("SELECT id, key_prefix, role, created_at, last_used_at, revoked_at FROM managed_api_keys WHERE owner_user_id = $1 ORDER BY created_at DESC", [req.user!.sub]); res.json({ keys: result.rows }); } catch (error) { next(error); }
});

router.post("/api-keys", async (req, res, next) => {
  try {
    const body = z.object({ role: z.enum(["customer", "creator"]).default("customer") }).parse(req.body ?? {});
    const id = `nbk_${randomBytes(8).toString("hex")}`;
    const secret = randomBytes(32).toString("base64url");
    await query("INSERT INTO managed_api_keys (id, owner_user_id, key_prefix, secret_hash, role) VALUES ($1, $2, $3, $4, $5)", [id, req.user!.sub, secret.slice(0, 8), createHash("sha256").update(secret).digest(), body.role]);
    res.status(201).json({ key: { id, role: body.role, apiKey: `${id}.${secret}`, secretShownOnce: true } });
  } catch (error) { next(error); }
});

router.delete("/api-keys/:id", async (req, res, next) => {
  try { await query("UPDATE managed_api_keys SET revoked_at = COALESCE(revoked_at, now()) WHERE id = $1 AND owner_user_id = $2", [req.params.id, req.user!.sub]); res.status(204).end(); } catch (error) { next(error); }
});

router.post("/tickets", async (req, res, next) => {
  try {
    const body = z.object({ subject: z.string().trim().min(3).max(160), body: z.string().trim().min(1).max(5000), priority: z.enum(["low", "normal", "high", "urgent"]).default("normal") }).parse(req.body);
    const result = await query("INSERT INTO support_tickets (requester_user_id, subject, body, priority) VALUES ($1, $2, $3, $4) RETURNING id, subject, body, priority, status, created_at", [req.user!.sub, body.subject, body.body, body.priority]);
    res.status(201).json({ ticket: result.rows[0] });
  } catch (error) { next(error); }
});

router.post("/refunds", async (req, res, next) => {
  try {
    const body = z.object({ purchaseId: uuid, reason: z.string().trim().min(5).max(1000) }).parse(req.body);
    const purchase = await query("SELECT id FROM purchases WHERE id = $1 AND lower(buyer_wallet) = lower($2)", [body.purchaseId, req.user!.address]);
    if (!purchase.rows[0]) return res.status(404).json({ error: "Purchase not found" });
    const result = await query("INSERT INTO refund_requests (requester_user_id, purchase_id, reason) VALUES ($1, $2, $3) ON CONFLICT (requester_user_id, purchase_id) DO UPDATE SET reason = EXCLUDED.reason, status = 'pending', updated_at = now() RETURNING *", [req.user!.sub, body.purchaseId, body.reason]);
    res.status(201).json({ refund: result.rows[0] });
  } catch (error) { next(error); }
});

router.post("/subscriptions", async (req, res, next) => {
  try {
    const body = z.object({ planName: z.string().trim().min(2).max(80), monthlyCredits: z.number().int().min(0).max(10_000_000), monthlyCostUsd: z.number().min(0).max(100_000) }).parse(req.body);
    const result = await query("INSERT INTO subscriptions (user_id, plan_name, monthly_credits, monthly_cost_usd, renews_at) VALUES ($1, $2, $3, $4, now() + interval '1 month') RETURNING *", [req.user!.sub, body.planName, body.monthlyCredits, body.monthlyCostUsd]);
    res.status(201).json({ subscription: result.rows[0] });
  } catch (error) { next(error); }
});

router.patch("/subscriptions/:id/cancel", async (req, res, next) => {
  try {
    const result = await query("UPDATE subscriptions SET status = 'cancelled', updated_at = now() WHERE id = $1 AND user_id = $2 RETURNING *", [req.params.id, req.user!.sub]);
    if (!result.rows[0]) return res.status(404).json({ error: "Subscription not found" });
    res.json({ subscription: result.rows[0] });
  } catch (error) { next(error); }
});

export default router;
