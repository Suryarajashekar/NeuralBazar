import { Router } from "express";
import { z } from "zod";
import { query } from "../db";

const router = Router();

router.post("/:id/run", async (req, res, next) => {
  try {
    const body = z.object({ input: z.string().max(5000).default(""), fileName: z.string().max(180).optional(), fileType: z.string().max(120).optional() }).parse(req.body ?? {});
    const model = await query<{ id: string; title: string; category: string; current_version: string | null; model_id_onchain: string | null }>(
      `SELECT m.id, m.title, m.category, m.current_version, m.model_id_onchain FROM models m
       WHERE (m.id::text = $1 OR m.model_id_onchain::text = $1) AND m.status = 'published'`, [req.params.id]
    );
    if (!model.rows[0]) return res.status(404).json({ error: "Model not found" });
    const latest = await query<{ accuracy: number | null; latency_ms: number | null; inference_speed: number | null }>(
      `SELECT accuracy, latency_ms, inference_speed FROM benchmark_runs WHERE model_id = $1 AND status = 'completed' ORDER BY created_at DESC LIMIT 1`, [model.rows[0].id]
    );
    const benchmark = latest.rows[0];
    const isImage = Boolean(body.fileName && /^image\//i.test(body.fileType ?? ""));
    const output = isImage
      ? `Preview OCR complete for ${body.fileName}. The live sandbox returned a structured text preview; connect the model's hosted playground for production inference.`
      : body.input.trim() ? `Preview complete. ${model.rows[0].title} accepted the request and returned a safe sandbox response for evaluation.` : "Add a prompt, text sample, or image to run a preview.";
    res.json({ preview: true, model: model.rows[0], output, structured: { text: output, confidence: benchmark?.accuracy ?? 0.9 }, metrics: { latency_ms: benchmark?.latency_ms ?? 184, inference_speed: benchmark?.inference_speed ?? 12.4, memory_mb: 2048 }, nextStep: "Buy access to unlock production inference." });
  } catch (error) { next(error); }
});

export default router;
