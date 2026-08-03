import { Router } from "express";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { query } from "../db";
import { requireAuth } from "../middleware/auth";
import { canonicalRole, requirePermission } from "../services/identity";

const router = Router();
const pageSchema = z.object({ page: z.coerce.number().int().min(1).max(10_000).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) });

router.use(requireAuth);

router.get("/dashboard", requirePermission("admin.users.manage"), async (_req, res, next) => {
  try {
    const [users, creators, models, purchases, volume, reports, activeSessions] = await Promise.all([
      query<{ count: string }>("SELECT count(*)::text AS count FROM users WHERE account_status = 'active'"),
      query<{ count: string }>("SELECT count(*)::text AS count FROM users WHERE role IN ('creator', 'admin', 'super_admin') AND account_status = 'active'"),
      query<{ count: string }>("SELECT count(*)::text AS count FROM models WHERE status = 'published'"),
      query<{ count: string }>("SELECT count(*)::text AS count FROM purchases"),
      query<{ total: string }>("SELECT COALESCE(sum(price_paid_wei), 0)::text AS total FROM purchases"),
      query<{ count: string }>("SELECT count(*)::text AS count FROM reports WHERE status IN ('open', 'reviewing')"),
      query<{ count: string }>("SELECT count(*)::text AS count FROM sessions WHERE revoked_at IS NULL AND expires_at > now()")
    ]);
    res.json({ dashboard: { users: Number(users.rows[0]?.count ?? 0), creators: Number(creators.rows[0]?.count ?? 0), publishedModels: Number(models.rows[0]?.count ?? 0), purchases: Number(purchases.rows[0]?.count ?? 0), volumeWei: volume.rows[0]?.total ?? "0", openReports: Number(reports.rows[0]?.count ?? 0), activeSessions: Number(activeSessions.rows[0]?.count ?? 0) } });
  } catch (error) { next(error); }
});

router.get("/creators", requirePermission("admin.users.manage"), async (req, res, next) => {
  try {
    const { page, limit } = pageSchema.parse(req.query);
    const offset = (page - 1) * limit;
    const [creators, count] = await Promise.all([
      query(`SELECT u.id, u.username, u.display_name AS \"displayName\", u.wallet_address, u.role, u.verified, u.account_status, u.created_at, COALESCE(r.reputation_score, 0) AS reputation_score, COALESCE(r.successful_sales, 0) AS successful_sales, COALESCE(r.average_rating, 0) AS average_rating FROM users u LEFT JOIN creator_reputation r ON r.user_id = u.id WHERE u.role IN ('creator', 'admin', 'super_admin') ORDER BY u.created_at DESC LIMIT $1 OFFSET $2`, [limit, offset]),
      query<{ count: string }>("SELECT count(*)::text AS count FROM users WHERE role IN ('creator', 'admin', 'super_admin')")
    ]);
    const total = Number(count.rows[0]?.count ?? 0);
    res.json({ creators: creators.rows.map(row => ({ ...row, role: canonicalRole(row.role as string) })), pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } });
  } catch (error) { next(error); }
});

router.get("/audit", requirePermission("admin.audit.read"), async (req, res, next) => {
  try {
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(req.query);
    const [audit, admin, authentication] = await Promise.all([
      query("SELECT id, 'audit' AS source, actor_sub, actor_wallet, action, resource, resource_id, outcome, request_id, session_id, ip_address, user_agent, metadata, created_at FROM audit_logs ORDER BY created_at DESC LIMIT $1", [limit]),
      query("SELECT id, 'admin' AS source, actor_sub, actor_wallet, action, target AS resource, '' AS resource_id, outcome, request_id, session_id, ip_address, user_agent, metadata, created_at FROM admin_logs ORDER BY created_at DESC LIMIT $1", [limit]),
      query("SELECT id, 'authentication' AS source, user_id::text AS actor_sub, wallet_address AS actor_wallet, event AS action, '' AS resource, '' AS resource_id, CASE WHEN success THEN 'success' ELSE 'failure' END AS outcome, request_id, session_id, ip_address, user_agent, metadata, created_at FROM authentication_logs ORDER BY created_at DESC LIMIT $1", [limit])
    ]);
    const logs = [...audit.rows, ...admin.rows, ...authentication.rows].sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime()).slice(0, limit);
    res.json({ logs, immutable: true });
  } catch (error) { next(error); }
});

router.get("/support/users/:username", requirePermission("support.profile.read"), async (req, res, next) => {
  try {
    const result = await query("SELECT id, username, display_name, wallet_address, role, account_type, bio, created_at, last_login_at, last_active_at, account_status, verified, badges FROM users WHERE lower(username) = lower($1)", [req.params.username]);
    if (!result.rows[0]) return res.status(404).json({ error: "User not found" });
    res.json({ user: { ...result.rows[0], role: canonicalRole(result.rows[0].role) } });
  } catch (error) { next(error); }
});

router.get("/support/users/:id/purchases", requirePermission("support.purchases.read"), async (req, res, next) => {
  try { const result = await query("SELECT id, model_id, model_id_onchain, listing_id_onchain, price_paid_wei, tx_hash, purchased_at FROM purchases WHERE lower(buyer_wallet) = (SELECT lower(wallet_address) FROM users WHERE id::text = $1) ORDER BY purchased_at DESC LIMIT 100", [req.params.id]); res.json({ purchases: result.rows }); } catch (error) { next(error); }
});

router.get("/support/users/:id/downloads", requirePermission("support.downloads.read"), async (req, res, next) => {
  try { const result = await query("SELECT activity_type, model_id, metadata, created_at FROM user_activity WHERE user_id::text = $1 AND activity_type = 'downloaded' ORDER BY created_at DESC LIMIT 100", [req.params.id]); res.json({ downloads: result.rows }); } catch (error) { next(error); }
});

router.post("/support/tickets", async (req, res, next) => {
  try {
    const body = z.object({ subject: z.string().trim().min(3).max(160), body: z.string().trim().min(1).max(5000), priority: z.enum(["low", "normal", "high", "urgent"]).default("normal") }).parse(req.body);
    const result = await query("INSERT INTO support_tickets (requester_user_id, subject, body, priority) VALUES ($1, $2, $3, $4) RETURNING id, subject, body, priority, status, created_at", [req.user!.sub, body.subject, body.body, body.priority]);
    res.status(201).json({ ticket: result.rows[0] });
  } catch (error) { next(error); }
});

router.get("/support/tickets", requirePermission("support.tickets.manage"), async (req, res, next) => {
  try {
    const result = await query("SELECT t.id, t.subject, t.body, t.status, t.priority, t.created_at, t.updated_at, u.username AS requester_username, a.username AS assignee_username FROM support_tickets t JOIN users u ON u.id = t.requester_user_id LEFT JOIN users a ON a.id = t.assignee_user_id ORDER BY t.updated_at DESC LIMIT 100");
    res.json({ tickets: result.rows });
  } catch (error) { next(error); }
});

router.patch("/support/tickets/:id", requirePermission("support.tickets.manage"), async (req, res, next) => {
  try {
    const body = z.object({ status: z.enum(["open", "pending", "resolved", "closed"]).optional(), priority: z.enum(["low", "normal", "high", "urgent"]).optional(), assigneeUserId: z.string().uuid().nullable().optional() }).parse(req.body);
    const result = await query("UPDATE support_tickets SET status = COALESCE($2, status), priority = COALESCE($3, priority), assignee_user_id = COALESCE($4, assignee_user_id), updated_at = now() WHERE id::text = $1 RETURNING id, subject, status, priority, assignee_user_id, updated_at", [req.params.id, body.status, body.priority, body.assigneeUserId]);
    if (!result.rows[0]) return res.status(404).json({ error: "Ticket not found" });
    res.json({ ticket: result.rows[0] });
  } catch (error) { next(error); }
});

router.post("/users/:id/suspend", requirePermission("moderation.users.suspend"), async (req, res, next) => {
  try {
    const body = z.object({ reason: z.string().trim().min(1).max(500), until: z.string().datetime().optional() }).parse(req.body);
    const result = await query("UPDATE users SET account_status = 'suspended', suspended_until = $2, suspension_reason = $3, updated_at = now() WHERE id::text = $1 AND account_status <> 'deleted' RETURNING id, username, role, account_status, suspended_until, suspension_reason", [req.params.id, body.until ?? null, body.reason]);
    if (!result.rows[0]) return res.status(404).json({ error: "User not found" });
    res.json({ user: { ...result.rows[0], role: canonicalRole(result.rows[0].role) } });
  } catch (error) { next(error); }
});

router.post("/users/:id/ban", requirePermission("admin.users.manage"), async (req, res, next) => {
  try {
    if (req.params.id === req.user!.sub) return res.status(400).json({ error: "You cannot ban yourself" });
    const reason = z.object({ reason: z.string().trim().min(1).max(500) }).parse(req.body).reason;
    const result = await query("UPDATE users SET account_status = 'banned', banned_at = now(), banned_reason = $2, updated_at = now() WHERE id::text = $1 AND account_status <> 'deleted' RETURNING id, username, role, account_status, banned_at, banned_reason", [req.params.id, reason]);
    if (!result.rows[0]) return res.status(404).json({ error: "User not found" });
    res.json({ user: { ...result.rows[0], role: canonicalRole(result.rows[0].role) } });
  } catch (error) { next(error); }
});

router.post("/users/:id/verify", requirePermission("moderation.creator.verify"), async (req, res, next) => {
  try {
    const result = await query("UPDATE users SET verified = true, verification_requested_at = NULL, updated_at = now() WHERE id::text = $1 RETURNING id, username, role, verified", [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: "User not found" });
    await query("INSERT INTO creator_verification_requests (user_id, status, reviewer_user_id, reviewed_at) VALUES ($1, 'approved', $2, now()) ON CONFLICT (user_id) DO UPDATE SET status = 'approved', reviewer_user_id = EXCLUDED.reviewer_user_id, reviewed_at = now()", [req.params.id, req.user!.sub]);
    res.json({ user: { ...result.rows[0], role: canonicalRole(result.rows[0].role) } });
  } catch (error) { next(error); }
});

router.get("/verification", requirePermission("moderation.creator.verify"), async (_req, res, next) => {
  try { const result = await query("SELECT r.id, r.status, r.notes, r.created_at, u.id AS user_id, u.username, u.display_name, u.wallet_address, u.role FROM creator_verification_requests r JOIN users u ON u.id = r.user_id WHERE r.status = 'pending' ORDER BY r.created_at ASC LIMIT 100"); res.json({ requests: result.rows }); } catch (error) { next(error); }
});

router.get("/api-keys", requirePermission("admin.api_keys.manage"), async (req, res, next) => {
  try { const result = await query("SELECT id, key_prefix, role, created_at, last_used_at, revoked_at FROM managed_api_keys WHERE owner_user_id = $1 ORDER BY created_at DESC", [req.user!.sub]); res.json({ keys: result.rows }); } catch (error) { next(error); }
});

router.post("/api-keys", requirePermission("admin.api_keys.manage"), async (req, res, next) => {
  try {
    const body = z.object({ role: z.enum(["customer", "creator", "support_admin", "moderator"]).default("customer") }).parse(req.body);
    const id = `nbk_${randomBytes(8).toString("hex")}`;
    const secret = randomBytes(32).toString("base64url");
    await query("INSERT INTO managed_api_keys (id, owner_user_id, key_prefix, secret_hash, role) VALUES ($1, $2, $3, $4, $5)", [id, req.user!.sub, secret.slice(0, 8), createHash("sha256").update(secret).digest(), body.role]);
    res.status(201).json({ key: { id, role: body.role, apiKey: `${id}.${secret}`, secretShownOnce: true } });
  } catch (error) { next(error); }
});

router.delete("/api-keys/:id", requirePermission("admin.api_keys.manage"), async (req, res, next) => {
  try { await query("UPDATE managed_api_keys SET revoked_at = COALESCE(revoked_at, now()) WHERE id = $1 AND owner_user_id = $2", [req.params.id, req.user!.sub]); res.status(204).end(); } catch (error) { next(error); }
});

router.get("/settings/:key", requirePermission("admin.settings.manage"), async (req, res, next) => {
  try { const result = await query("SELECT setting_key, setting_value, updated_by, updated_at FROM marketplace_settings WHERE setting_key = $1", [req.params.key]); if (!result.rows[0]) return res.status(404).json({ error: "Setting not found" }); res.json({ setting: result.rows[0] }); } catch (error) { next(error); }
});

router.put("/settings/:key", requirePermission("admin.settings.manage"), async (req, res, next) => {
  try {
    const key = z.string().regex(/^[a-zA-Z0-9._-]{1,80}$/).parse(req.params.key);
    const value = z.record(z.unknown()).parse(req.body);
    const result = await query("INSERT INTO marketplace_settings (setting_key, setting_value, updated_by) VALUES ($1, $2, $3) ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_by = EXCLUDED.updated_by, updated_at = now() RETURNING setting_key, setting_value, updated_by, updated_at", [key, value, req.user!.sub]);
    res.json({ setting: result.rows[0] });
  } catch (error) { next(error); }
});

router.get("/announcements", async (_req, res, next) => {
  try { const result = await query("SELECT id, title, body, severity, starts_at, ends_at FROM platform_announcements WHERE published = true AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now()) ORDER BY starts_at DESC LIMIT 20"); res.json({ announcements: result.rows }); } catch (error) { next(error); }
});

router.post("/announcements", requirePermission("admin.announcements"), async (req, res, next) => {
  try {
    const body = z.object({ title: z.string().trim().min(3).max(160), body: z.string().trim().min(1).max(5000), severity: z.enum(["info", "warning", "critical"]).default("info"), published: z.boolean().default(false), endsAt: z.string().datetime().optional() }).parse(req.body);
    const result = await query("INSERT INTO platform_announcements (title, body, severity, published, ends_at, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, title, body, severity, published, starts_at, ends_at", [body.title, body.body, body.severity, body.published, body.endsAt ?? null, req.user!.sub]);
    res.status(201).json({ announcement: result.rows[0] });
  } catch (error) { next(error); }
});

export default router;
