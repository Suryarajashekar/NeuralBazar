import { Router } from "express";
import { z } from "zod";
import { query } from "../db";
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();
router.post("/", requireAuth, async (req, res, next) => {
  try {
    const body = z.object({ modelId: z.string().uuid(), reason: z.string().min(5).max(200), notes: z.string().max(1000).default("") }).parse(req.body);
    const result = await query("INSERT INTO reports (model_id, reporter_wallet, reason, notes) VALUES ($1, lower($2), $3, $4) RETURNING *", [body.modelId, req.user!.address, body.reason, body.notes]);
    res.status(201).json({ report: result.rows[0] });
  } catch (error) { next(error); }
});

router.get("/", requireAuth, requireRole("moderator", "admin"), async (_req, res, next) => {
  try {
    const result = await query("SELECT r.*, m.title FROM reports r JOIN models m ON m.id = r.model_id ORDER BY r.created_at DESC");
    res.json({ reports: result.rows });
  } catch (error) { next(error); }
});

router.patch("/:id", requireAuth, requireRole("moderator", "admin"), async (req, res, next) => {
  try {
    const body = z.object({ status: z.enum(["open", "reviewing", "resolved", "dismissed"]), notes: z.string().max(1000).optional() }).parse(req.body);
    const result = await query("UPDATE reports SET status = $2, notes = COALESCE($3, notes), updated_at = now() WHERE id::text = $1 RETURNING *", [req.params.id, body.status, body.notes]);
    res.json({ report: result.rows[0] });
  } catch (error) { next(error); }
});

export default router;
