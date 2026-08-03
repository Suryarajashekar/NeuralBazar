import { Router } from "express";
import { z } from "zod";
import { query, withTransaction } from "../db";
import { requireAuth } from "../middleware/auth";

const router = Router();
const uuid = z.string().uuid();

async function membership(orgId: string, userId: string) {
  const result = await query<{ role: string }>("SELECT role FROM organization_members WHERE organization_id = $1 AND user_id = $2", [orgId, userId]);
  return result.rows[0];
}

router.use(requireAuth);

router.get("/", async (req, res, next) => {
  try {
    const result = await query("SELECT o.*, om.role FROM organizations o JOIN organization_members om ON om.organization_id = o.id WHERE om.user_id = $1 ORDER BY o.created_at DESC", [req.user!.sub]);
    res.json({ organizations: result.rows });
  } catch (error) { next(error); }
});

router.post("/", async (req, res, next) => {
  try {
    const body = z.object({ name: z.string().min(2).max(120), slug: z.string().regex(/^[a-z0-9-]{3,60}$/), billingEmail: z.string().email().max(200).default("") }).parse(req.body);
    const result = await withTransaction(async client => {
      const organization = await client.query("INSERT INTO organizations (name, slug, owner_user_id, billing_email) VALUES ($1, $2, $3, $4) RETURNING *", [body.name, body.slug, req.user!.sub, body.billingEmail]);
      await client.query("INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'owner')", [organization.rows[0].id, req.user!.sub]);
      return organization.rows[0];
    });
    res.status(201).json({ organization: result });
  } catch (error) { next(error); }
});

router.post("/:id/members", async (req, res, next) => {
  try {
    const orgId = uuid.parse(req.params.id);
    const actor = await membership(orgId, req.user!.sub);
    if (!actor || !["owner", "admin"].includes(actor.role)) return res.status(403).json({ error: "Organization admin permission required" });
    const body = z.object({ walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/), role: z.enum(["admin", "developer", "viewer", "billing"]) }).parse(req.body);
    const target = await query<{ id: string }>("SELECT id FROM users WHERE lower(wallet_address) = lower($1)", [body.walletAddress]);
    if (!target.rows[0]) return res.status(404).json({ error: "User not found" });
    const result = await query("INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role RETURNING *", [orgId, target.rows[0].id, body.role]);
    res.status(201).json({ member: result.rows[0] });
  } catch (error) { next(error); }
});

router.post("/:id/projects", async (req, res, next) => {
  try {
    const orgId = uuid.parse(req.params.id);
    const actor = await membership(orgId, req.user!.sub);
    if (!actor || !["owner", "admin", "developer"].includes(actor.role)) return res.status(403).json({ error: "Project permission required" });
    const body = z.object({ name: z.string().min(1).max(120), description: z.string().max(1000).default("") }).parse(req.body);
    const result = await query("INSERT INTO workspace_projects (organization_id, name, description, created_by) VALUES ($1, $2, $3, $4) RETURNING *", [orgId, body.name, body.description, req.user!.sub]);
    res.status(201).json({ project: result.rows[0] });
  } catch (error) { next(error); }
});

router.get("/:id/usage", async (req, res, next) => {
  try {
    const orgId = uuid.parse(req.params.id);
    if (!await membership(orgId, req.user!.sub)) return res.status(403).json({ error: "Organization membership required" });
    const result = await query("SELECT endpoint, status_code, SUM(units)::bigint AS units, AVG(latency_ms)::numeric(14,2) AS average_latency_ms, date_trunc('day', created_at) AS day FROM api_usage WHERE organization_id = $1 GROUP BY endpoint, status_code, date_trunc('day', created_at) ORDER BY day DESC", [orgId]);
    res.json({ usage: result.rows });
  } catch (error) { next(error); }
});

router.post("/:id/billing-events", async (req, res, next) => {
  try {
    const orgId = uuid.parse(req.params.id);
    const actor = await membership(orgId, req.user!.sub);
    if (!actor || !["owner", "admin", "billing"].includes(actor.role)) return res.status(403).json({ error: "Billing permission required" });
    const body = z.object({ eventType: z.string().min(1).max(80), amountCents: z.number().int().min(0).default(0), currency: z.string().length(3).default("USD"), externalReference: z.string().max(200).default(""), metadata: z.record(z.unknown()).default({}) }).parse(req.body);
    const result = await query("INSERT INTO billing_events (organization_id, event_type, amount_cents, currency, external_reference, metadata) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *", [orgId, body.eventType, body.amountCents, body.currency.toUpperCase(), body.externalReference, body.metadata]);
    res.status(201).json({ billingEvent: result.rows[0] });
  } catch (error) { next(error); }
});

export default router;

