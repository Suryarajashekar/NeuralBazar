import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { query } from "../db";
import { requireAuth } from "../middleware/auth";
import { refreshCreatorReputation } from "../services/reputation";

const router = Router();
const ratingSchema = z.object({ targetType: z.enum(["model", "developer"]), targetKey: z.string().min(1).max(120), score: z.number().int().min(1).max(5), review: z.string().max(1000).default("") });
const ratingRateLimit = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: true, legacyHeaders: false });

router.get("/", async (req, res, next) => {
  try {
    const targetType = z.enum(["model", "developer"]).parse(req.query.targetType);
    const targetKey = z.string().min(1).parse(req.query.targetKey);
    // Reviews are public marketplace content, but the reviewer's wallet is
    // private account data and is intentionally not returned here.
    const result = await query("SELECT score, review, verified_purchase, created_at FROM ratings WHERE target_type = $1 AND target_key = $2 AND reported_at IS NULL ORDER BY created_at DESC", [targetType, targetKey]);
    const average = result.rows.length ? result.rows.reduce((sum, item) => sum + Number(item.score), 0) / result.rows.length : 0;
    res.json({ average: Number(average.toFixed(1)), count: result.rows.length, ratings: result.rows });
  } catch (error) { next(error); }
});

router.post("/", requireAuth, ratingRateLimit, async (req, res, next) => {
  try {
    const body = ratingSchema.parse(req.body);
    let verifiedPurchase = false;
    let purchaseTxHash: string | null = null;
    let creatorWallet: string | undefined;
    if (body.targetType === "model") {
      const target = await query<{ id: string; model_id_onchain: string; creator_wallet: string }>("SELECT id, model_id_onchain, creator_wallet FROM models WHERE id::text = $1 OR model_id_onchain::text = $1", [body.targetKey]);
      if (!target.rows[0]) return res.status(404).json({ error: "Model not found" });
      creatorWallet = target.rows[0].creator_wallet;
      const purchase = await query<{ tx_hash: string }>(
        "SELECT tx_hash FROM purchases WHERE lower(buyer_wallet) = lower($1) AND (model_id = $2 OR model_id_onchain = $3) ORDER BY purchased_at DESC LIMIT 1",
        [req.user!.address, target.rows[0].id, target.rows[0].model_id_onchain]
      );
      verifiedPurchase = Boolean(purchase.rows[0]);
      purchaseTxHash = purchase.rows[0]?.tx_hash ?? null;
    } else if (!/^0x[a-fA-F0-9]{40}$/.test(body.targetKey)) {
      return res.status(400).json({ error: "Developer ratings require a wallet address" });
    } else {
      const target = await query("SELECT 1 FROM users WHERE lower(wallet_address) = lower($1)", [body.targetKey]);
      if (!target.rows[0]) return res.status(404).json({ error: "Developer not found" });
    }
    const result = await query(
      `INSERT INTO ratings (rater_wallet, target_type, target_key, score, review, verified_purchase, purchase_tx_hash)
       VALUES (lower($1), $2, $3, $4, $5, $6, $7)
       ON CONFLICT (rater_wallet, target_type, target_key)
       DO UPDATE SET score = EXCLUDED.score, review = EXCLUDED.review, verified_purchase = EXCLUDED.verified_purchase, purchase_tx_hash = EXCLUDED.purchase_tx_hash, updated_at = now()
       RETURNING *`, [req.user!.address, body.targetType, body.targetKey, body.score, body.review, verifiedPurchase, purchaseTxHash]
    );
    if (body.targetType === "developer") await refreshCreatorReputation(body.targetKey);
    if (creatorWallet) await refreshCreatorReputation(creatorWallet);
    res.status(201).json({ rating: result.rows[0] });
  } catch (error) { next(error); }
});

export default router;
