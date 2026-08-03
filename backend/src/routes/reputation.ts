import { Router } from "express";
import { z } from "zod";
import { query } from "../db";
import { requireAuth } from "../middleware/auth";
import { refreshCreatorReputation } from "../services/reputation";

const router = Router();
const walletSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);

router.get("/creator/:wallet", async (req, res, next) => {
  try {
    const wallet = walletSchema.parse(req.params.wallet).toLowerCase();
    const reputation = await refreshCreatorReputation(wallet);
    if (!reputation) return res.status(404).json({ error: "Creator not found" });
    res.json({ reputation });
  } catch (error) { next(error); }
});

router.get("/creators", async (req, res, next) => {
  try {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 20)));
    const result = await query(
      `SELECT u.wallet_address, COALESCE(u.username, substring(u.wallet_address, 1, 10)) AS creator_name,
              COALESCE(cr.reputation_score, 0) AS reputation_score, COALESCE(cr.trust_score, 0) AS trust_score,
              COALESCE(cr.average_rating, 0) AS average_rating, COALESCE(cr.successful_sales, 0) AS successful_sales,
              COALESCE(cr.verified, false) AS verified
       FROM users u LEFT JOIN creator_reputation cr ON cr.user_id = u.id
       WHERE u.role IN ('creator', 'admin', 'super_admin') ORDER BY COALESCE(cr.reputation_score, 0) DESC, u.created_at ASC LIMIT $1`, [limit]
    );
    res.json({ creators: result.rows });
  } catch (error) { next(error); }
});

router.get("/creator/:wallet/reviews", async (req, res, next) => {
  try {
    const wallet = walletSchema.parse(req.params.wallet).toLowerCase();
    const result = await query(
      `SELECT score, review, verified_purchase, created_at FROM ratings
       WHERE target_type = 'developer' AND lower(target_key) = lower($1) AND reported_at IS NULL
       ORDER BY created_at DESC LIMIT 100`, [wallet]
    );
    res.json({ reviews: result.rows });
  } catch (error) { next(error); }
});

router.post("/ratings/:id/report", requireAuth, async (req, res, next) => {
  try {
    const body = z.object({ reason: z.string().min(5).max(300) }).parse(req.body);
    const result = await query(
      "UPDATE ratings SET reported_at = now(), report_reason = $2 WHERE id::text = $1 RETURNING id, reported_at, report_reason",
      [req.params.id, body.reason]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Review not found" });
    res.json({ rating: result.rows[0] });
  } catch (error) { next(error); }
});

export default router;
