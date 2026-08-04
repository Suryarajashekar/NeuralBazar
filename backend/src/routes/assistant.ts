import { Router } from "express";
import { z } from "zod";
import { query } from "../db";
import { cosineSimilarity, textEmbedding } from "../services/embeddings";

const router = Router();
const publicModelWhere = "m.status = 'published' AND m.security_status IN ('verified_safe', 'legacy_unverified')";

router.post("/chat", async (req, res, next) => {
  try {
    const body = z.object({ message: z.string().trim().min(3).max(1000) }).parse(req.body ?? {});
    const result = await query(
      `SELECT m.*, l.listing_id_onchain, to_char(l.price_wei / 1000000000000000000.0, 'FM999999990.########') AS price_eth,
              COALESCE(u.username, substring(m.creator_wallet, 1, 10)) AS creator_name,
              COALESCE((SELECT ROUND(AVG(r.score)::numeric, 1) FROM ratings r WHERE r.target_type = 'model' AND r.target_key = m.id::text), 0) AS rating,
              COALESCE((SELECT COUNT(*)::int FROM ratings r WHERE r.target_type = 'model' AND r.target_key = m.id::text), 0) AS rating_count
       FROM models m LEFT JOIN users u ON lower(u.wallet_address) = lower(m.creator_wallet)
       LEFT JOIN listings l ON l.model_id_onchain = m.model_id_onchain AND l.active = true
       WHERE ${publicModelWhere}
       ORDER BY m.trending_score DESC, m.created_at DESC LIMIT 100`
    );
    const vector = textEmbedding(body.message);
    const normalized = body.message.toLowerCase();
    const models = result.rows.map(model => {
      const text = `${model.title} ${model.description} ${model.category} ${(model.tags ?? []).join(" ")}`;
      const lexical = text.toLowerCase().includes(normalized) ? 0.25 : 0;
      const score = Math.max(0, Math.min(1, (cosineSimilarity(vector, textEmbedding(text)) + 1) / 2 * 0.75 + lexical + Number(model.trending_score || 0) / 1000));
      const tags = (model.tags ?? []).map((tag: string) => tag.toLowerCase());
      const resourceType = tags.includes("api") || model.category.toLowerCase().includes("api") ? "API" : tags.includes("dataset") || model.category.toLowerCase().includes("dataset") ? "Dataset" : "Model";
      return { ...model, assistant_score: Number(score.toFixed(4)), resource_type: resourceType };
    }).sort((a, b) => b.assistant_score - a.assistant_score).slice(0, 8);
    const ocr = /ocr|text recognition|document|kannada|tamil|hindi|malayalam/i.test(body.message);
    const language = /kannada|ಕನ್ನಡ/i.test(body.message) ? "Kannada" : /tamil/i.test(body.message) ? "Tamil" : /hindi/i.test(body.message) ? "Hindi" : "the requested language";
    const response = ocr
      ? `I found ${models.length} candidates for ${language} OCR. Start with the highest intent matches, use the playground with a sample image, then compare accuracy and latency before buying.`
      : `I found ${models.length} marketplace candidates for your request. I ranked them by semantic fit, marketplace quality, and recent activity.`;
    res.json({ message: response, models, apis: models.filter(model => model.resource_type === "API").slice(0, 3), datasets: models.filter(model => model.resource_type === "Dataset").slice(0, 3), query: body.message });
  } catch (error) { next(error); }
});

export default router;
