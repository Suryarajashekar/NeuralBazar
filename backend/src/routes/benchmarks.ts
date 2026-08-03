import { Router } from "express";
import { z } from "zod";
import { query } from "../db";
import { requireAuth } from "../middleware/auth";
import { queueBenchmark } from "../services/benchmark";
import { isSuperAdmin } from "../services/identity";

const router = Router();

router.get("/leaderboard", async (req, res, next) => {
  try {
    const metric = z.enum(["accuracy", "f1", "latency_ms", "inference_speed"]).catch("accuracy").parse(req.query.metric);
    const order = metric === "latency_ms" ? "ASC NULLS LAST" : "DESC NULLS LAST";
    const result = await query(
      `SELECT m.id, m.model_id_onchain, m.title, m.creator_wallet, b.status, b.accuracy, b.precision_score, b.recall, b.f1, b.latency_ms, b.inference_speed, b.model_size_bytes, b.created_at
       FROM benchmark_runs b JOIN models m ON m.id = b.model_id
       WHERE b.status = 'completed' AND m.status = 'published'
       ORDER BY b.${metric} ${order}, b.created_at DESC LIMIT $1`, [Math.min(100, Math.max(1, Number(req.query.limit ?? 25)))]
    );
    res.json({ leaderboard: result.rows, metric });
  } catch (error) { next(error); }
});

router.get("/models/:id", async (req, res, next) => {
  try {
    const model = await query<{ id: string }>("SELECT id FROM models WHERE id::text = $1 OR model_id_onchain::text = $1", [req.params.id]);
    if (!model.rows[0]) return res.status(404).json({ error: "Model not found" });
    const runs = await query("SELECT * FROM benchmark_runs WHERE model_id = $1 ORDER BY created_at DESC", [model.rows[0].id]);
    res.json({ benchmarks: runs.rows });
  } catch (error) { next(error); }
});

router.post("/models/:id/run", requireAuth, async (req, res, next) => {
  try {
    const body = z.object({ versionId: z.string().uuid().optional() }).parse(req.body ?? {});
    const model = await query<{ id: string; creator_wallet: string }>("SELECT id, creator_wallet FROM models WHERE id::text = $1 OR model_id_onchain::text = $1", [req.params.id]);
    if (!model.rows[0]) return res.status(404).json({ error: "Model not found" });
    if (!isSuperAdmin(req.user!.role) && model.rows[0].creator_wallet.toLowerCase() !== req.user!.address.toLowerCase()) return res.status(403).json({ error: "Only the model creator can request a benchmark" });
    const run = await queueBenchmark(model.rows[0].id, body.versionId);
    res.status(202).json({ benchmark: run, message: "Benchmark queued for an isolated worker" });
  } catch (error) { next(error); }
});

export default router;
