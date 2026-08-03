import { Router } from "express";
import { z } from "zod";
import { query } from "../db";
import { requireAuth } from "../middleware/auth";

const router = Router();
const ratingSchema = z.object({ targetType: z.enum(["model", "developer"]), targetKey: z.string().min(1).max(120), score: z.number().int().min(1).max(5), review: z.string().max(1000).default("") });

router.get("/", async (req, res, next) => {
  try {
    const targetType = z.enum(["model", "developer"]).parse(req.query.targetType);
    const targetKey = z.string().min(1).parse(req.query.targetKey);
    // Reviews are public marketplace content, but the reviewer's wallet is
    // private account data and is intentionally not returned here.
    const result = await query("SELECT score, review, created_at FROM ratings WHERE target_type = $1 AND target_key = $2 ORDER BY created_at DESC", [targetType, targetKey]);
    const average = result.rows.length ? result.rows.reduce((sum, item) => sum + Number(item.score), 0) / result.rows.length : 0;
    res.json({ average: Number(average.toFixed(1)), count: result.rows.length, ratings: result.rows });
  } catch (error) { next(error); }
});

router.post("/", requireAuth, async (req, res, next) => {
  try {
    const body = ratingSchema.parse(req.body);
    const result = await query(
      `INSERT INTO ratings (rater_wallet, target_type, target_key, score, review)
       VALUES (lower($1), $2, $3, $4, $5)
       ON CONFLICT (rater_wallet, target_type, target_key)
       DO UPDATE SET score = EXCLUDED.score, review = EXCLUDED.review, updated_at = now()
       RETURNING *`, [req.user!.address, body.targetType, body.targetKey, body.score, body.review]
    );
    res.status(201).json({ rating: result.rows[0] });
  } catch (error) { next(error); }
});

export default router;
