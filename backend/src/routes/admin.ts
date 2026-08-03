import { Request, Router } from "express";
import { z } from "zod";
import { query, withTransaction } from "../db";
import { requireAuth, requireRole } from "../middleware/auth";
import { config } from "../config";

const router = Router();
const moderationStatusSql = "CASE WHEN m.status = 'removed' THEN 'removed' WHEN m.status IN ('flagged', 'suspended') THEN 'hidden' ELSE 'active' END";

function getPagination(req: Request) {
  const pageValue = Number.parseInt(String(req.query.page ?? "1"), 10);
  const limitValue = Number.parseInt(String(req.query.limit ?? "10"), 10);
  const page = Number.isSafeInteger(pageValue) ? Math.min(10_000, Math.max(1, pageValue)) : 1;
  const limit = Number.isSafeInteger(limitValue) ? Math.min(50, Math.max(1, limitValue)) : 10;
  return { page, limit, offset: (page - 1) * limit };
}

function queryText(req: Request, name: string) {
  return String(req.query[name] ?? "").trim().slice(0, 200);
}

// Keep authentication at the router boundary, but authorize each legacy
// route locally so the additive permission-based enterprise routes mounted
// after this router remain reachable by support_admin identities.
router.use(requireAuth);

router.get("/models", requireRole("admin", "moderator"), async (req, res, next) => {
  try {
    const { page, limit, offset } = getPagination(req);
    const status = queryText(req, "status");
    const category = queryText(req, "category");
    const search = queryText(req, "search");
    if (status && !["active", "hidden", "removed"].includes(status)) return res.status(400).json({ error: "Invalid model status filter" });

    const filters = `WHERE ($1 = '' OR m.title ILIKE '%' || $1 || '%' OR m.description ILIKE '%' || $1 || '%')
      AND ($2 = '' OR m.category = $2)
      AND ($3 = '' OR (${moderationStatusSql}) = $3)`;
    const [models, count] = await Promise.all([
      query(
        `SELECT m.id, m.model_id_onchain, m.creator_wallet, u.username AS creator_username, m.title, m.description, m.category,
                (${moderationStatusSql}) AS status,
                COALESCE(to_char(l.price_wei / 1000000000000000000.0, 'FM999999990.########'), '') AS price,
                (SELECT COUNT(*)::int FROM purchases p WHERE p.model_id = m.id OR p.model_id_onchain = m.model_id_onchain) AS total_sales,
                (SELECT COUNT(*)::int FROM reports r WHERE r.model_id = m.id) AS reports_count
         FROM models m
         LEFT JOIN users u ON lower(u.wallet_address) = lower(m.creator_wallet)
         LEFT JOIN LATERAL (
           SELECT price_wei FROM listings
           WHERE (model_id = m.id OR model_id_onchain = m.model_id_onchain) AND active = true
           ORDER BY created_at DESC LIMIT 1
         ) l ON true
         ${filters}
         ORDER BY m.created_at DESC LIMIT $4 OFFSET $5`, [search, category, status, limit, offset]
      ),
      query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM models m ${filters}`, [search, category, status])
    ]);

    const total = Number(count.rows[0]?.count ?? 0);
    res.json({ models: models.rows, pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } });
  } catch (error) { next(error); }
});

router.get("/reports", requireRole("admin", "moderator"), async (req, res, next) => {
  try {
    const { page, limit, offset } = getPagination(req);
    const status = queryText(req, "status");
    const search = queryText(req, "search");
    if (status && !["open", "resolved", "dismissed"].includes(status)) return res.status(400).json({ error: "Invalid report status filter" });
    const filters = `WHERE ($1 = '' OR r.status = $1)
      AND ($2 = '' OR m.title ILIKE '%' || $2 || '%' OR r.reason ILIKE '%' || $2 || '%')`;
    const [reports, count] = await Promise.all([
      query(
        `SELECT r.id, r.model_id, m.title AS model_title, r.reporter_wallet, r.reason, r.status, r.created_at
         FROM reports r JOIN models m ON m.id = r.model_id
         ${filters}
         ORDER BY r.created_at DESC LIMIT $3 OFFSET $4`, [status, search, limit, offset]
      ),
      query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM reports r JOIN models m ON m.id = r.model_id ${filters}`, [status, search])
    ]);

    const total = Number(count.rows[0]?.count ?? 0);
    res.json({ reports: reports.rows, pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } });
  } catch (error) { next(error); }
});

router.patch("/models/:id", requireRole("admin", "moderator"), async (req, res, next) => {
  try {
    const requestedStatus = z.enum(["active", "hidden", "removed"]).parse(req.body.status);
    const databaseStatus = requestedStatus === "active" ? "published" : requestedStatus === "hidden" ? "flagged" : "removed";
    if (databaseStatus === "published") {
      const verification = await query("SELECT verified_safe, security_status, security_score FROM models WHERE id::text = $1 OR model_id_onchain::text = $1", [req.params.id]);
      const row = verification.rows[0];
      if (!row || row.verified_safe !== true || row.security_status !== "verified_safe" || Number(row.security_score) < config.modelSecurityScoreThreshold) return res.status(409).json({ error: "Only a verified-safe model may be published" });
    }
    const result = await query(
      "UPDATE models SET status = $2, updated_at = now() WHERE id::text = $1 OR model_id_onchain::text = $1 RETURNING id, model_id_onchain, title, status",
      [req.params.id, databaseStatus]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Model not found" });
    res.json({ model: result.rows[0] });
  } catch (error) { next(error); }
});

router.patch("/reports/:id", requireRole("admin", "moderator"), async (req, res, next) => {
  try {
    const body = z.object({ status: z.enum(["open", "resolved", "dismissed"]), action: z.enum(["takedown_model"]).optional() }).parse(req.body);
    const result = await withTransaction(async client => {
      const report = await client.query<{ model_id: string }>("SELECT model_id FROM reports WHERE id::text = $1 FOR UPDATE", [req.params.id]);
      if (!report.rows[0]) return null;
      const nextStatus = body.action === "takedown_model" ? "resolved" : body.status;
      if (body.action === "takedown_model") await client.query("UPDATE models SET status = 'removed', updated_at = now() WHERE id = $1", [report.rows[0].model_id]);
      const updated = await client.query("UPDATE reports SET status = $2, updated_at = now() WHERE id::text = $1 RETURNING id, model_id, status, updated_at", [req.params.id, nextStatus]);
      return updated.rows[0];
    });
    if (!result) return res.status(404).json({ error: "Report not found" });
    res.json({ report: result });
  } catch (error) { next(error); }
});

router.get("/users", requireRole("admin"), async (_req, res, next) => {
  try { const result = await query("SELECT id, wallet_address, role, account_type, username, created_at FROM users ORDER BY created_at DESC"); res.json({ users: result.rows }); } catch (error) { next(error); }
});

router.patch("/users/:id/role", requireRole("admin"), async (req, res, next) => {
  try {
    const role = z.enum(["customer", "creator", "support_admin", "moderator", "super_admin", "buyer", "admin"]).parse(req.body.role);
    if (req.params.id === req.user!.sub && !["admin", "super_admin"].includes(role)) return res.status(400).json({ error: "You cannot remove your own admin access" });

    const result = await withTransaction(async client => {
      const target = await client.query<{ id: string; role: string }>("SELECT id, role FROM users WHERE id::text = $1 FOR UPDATE", [req.params.id]);
      if (!target.rows[0]) return null;
      if (["admin", "super_admin"].includes(target.rows[0].role) && !["admin", "super_admin"].includes(role)) {
        const admins = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM users WHERE role IN ('admin', 'super_admin')");
        if (Number(admins.rows[0].count) <= 1) {
          const error = new Error("The last admin cannot be demoted");
          (error as Error & { statusCode: number }).statusCode = 409;
          throw error;
        }
      }
      const updated = await client.query("UPDATE users SET role = $2, updated_at = now() WHERE id::text = $1 RETURNING id, wallet_address, role, account_type, username", [req.params.id, role]);
      return updated.rows[0];
    });
    if (!result) return res.status(404).json({ error: "User not found" });
    res.json({ user: result });
  } catch (error) { next(error); }
});

router.get("/analytics", async (_req, res, next) => {
  try {
    const [users, models, purchases, volume] = await Promise.all([
      query<{ count: string }>("SELECT count(*)::text AS count FROM users"),
      query<{ count: string }>("SELECT count(*)::text AS count FROM models WHERE status = 'published'"),
      query<{ count: string }>("SELECT count(*)::text AS count FROM purchases"),
      query<{ total: string }>("SELECT COALESCE(sum(price_paid_wei), 0)::text AS total FROM purchases")
    ]);
    res.json({ analytics: { users: Number(users.rows[0].count), activeModels: Number(models.rows[0].count), purchases: Number(purchases.rows[0].count), volumeWei: volume.rows[0].total } });
  } catch (error) { next(error); }
});

export default router;
