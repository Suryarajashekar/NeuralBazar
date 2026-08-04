import { Router } from "express";
import { z } from "zod";
import { query } from "../db";
import { requireAuth } from "../middleware/auth";
import { queueBenchmark } from "../services/benchmark";
import { isSuperAdmin } from "../services/identity";

const router = Router();

router.get("/leaderboard", async (req, res, next) => {
  try {
    const metric = z.enum(["all", "accuracy", "f1", "latency_ms", "inference_speed", "gpu_memory_mb", "cost_per_1k_tokens"]).catch("all").parse(req.query.metric);
    const order = metric === "latency_ms" || metric === "gpu_memory_mb" || metric === "cost_per_1k_tokens" ? "ASC NULLS LAST" : "DESC NULLS LAST";
    const orderBy = metric === "all" ? "accuracy DESC NULLS LAST, latency_ms ASC NULLS LAST, created_at DESC" : `b.${metric} ${order}, b.created_at DESC`;
    const result = await query(
      `SELECT m.id, m.model_id_onchain, m.title, m.category, m.creator_wallet, m.tags, m.verified_safe, m.security_status, b.status, b.accuracy, b.precision_score, b.recall, b.f1, b.latency_ms, b.inference_speed, b.gpu_memory_mb, b.cpu_memory_mb, b.cost_per_1k_tokens, b.model_size_bytes, b.dataset_name, b.created_at
       FROM (SELECT DISTINCT ON (model_id) * FROM benchmark_runs WHERE status = 'completed' ORDER BY model_id, created_at DESC) b JOIN models m ON m.id = b.model_id
       WHERE m.status = 'published'
       ORDER BY ${orderBy} LIMIT $1`, [Math.min(100, Math.max(1, Number(req.query.limit ?? 25)))]
    );
    res.json({ leaderboard: result.rows, metric });
  } catch (error) { next(error); }
});

router.post("/evaluate", requireAuth, async (req, res, next) => {
  try {
    if (!isSuperAdmin(req.user!.role) && !["creator", "admin"].includes(req.user!.role)) return res.status(403).json({ error: "Creator access is required to run an evaluation" });
    const body = z.object({ datasetName: z.string().trim().min(2).max(160), datasetSizeBytes: z.coerce.number().int().nonnegative().max(2_000_000_000), datasetUploadId: z.string().uuid().optional(), datasetIpfsHash: z.string().max(200).optional(), modelIds: z.array(z.string().min(1).max(120)).min(1).max(10) }).parse(req.body ?? {});
    let datasetManifest: Record<string, unknown> = { source: "evaluation-upload", selectedModels: body.modelIds };
    let datasetSizeBytes = body.datasetSizeBytes;
    if (body.datasetUploadId) {
      const uploaded = await query<{ ipfs_hash: string; original_sha256: string; security_score: number; signed_manifest: Record<string, unknown> }>(
        `SELECT ipfs_hash, original_sha256, security_score, signed_manifest FROM upload_manifests WHERE upload_id = $1 AND lower(owner_wallet) = lower($2) AND status = 'ready' AND scan_status = 'passed' AND verified_safe = true AND expires_at > now()`, [body.datasetUploadId, req.user!.address]
      );
      if (!uploaded.rows[0]) return res.status(409).json({ error: "Dataset upload must pass the secure upload pipeline before evaluation" });
      if (body.datasetIpfsHash && body.datasetIpfsHash !== uploaded.rows[0].ipfs_hash) return res.status(409).json({ error: "Dataset upload identity does not match" });
      datasetManifest = { ...datasetManifest, uploadId: body.datasetUploadId, ipfsHash: uploaded.rows[0].ipfs_hash, originalSha256: uploaded.rows[0].original_sha256, securityScore: uploaded.rows[0].security_score };
      datasetSizeBytes = Number(uploaded.rows[0].signed_manifest?.byteLength ?? datasetSizeBytes);
    }
    const models = await query<{ id: string; title: string }>(
      `SELECT id, title FROM models WHERE status = 'published' AND (id::text = ANY($1::text[]) OR model_id_onchain::text = ANY($1::text[]))`, [body.modelIds]
    );
    if (models.rows.length !== new Set(body.modelIds).size) return res.status(404).json({ error: "One or more selected models were not found" });
    const job = await query<{ id: string }>(
      `INSERT INTO evaluation_jobs (owner_user_id, dataset_name, dataset_size_bytes, dataset_manifest) VALUES ($1, $2, $3, $4) RETURNING id`,
      [req.user!.sub, body.datasetName, datasetSizeBytes, { ...datasetManifest, selectedModels: models.rows.map(model => model.id) }]
    );
    for (const model of models.rows) {
      const run = await queueBenchmark(model.id, undefined, job.rows[0].id);
      await query("INSERT INTO evaluation_results (evaluation_id, model_id, benchmark_run_id) VALUES ($1, $2, $3)", [job.rows[0].id, model.id, run.id]);
    }
    res.status(202).json({ evaluation: { id: job.rows[0].id, datasetName: body.datasetName, modelCount: models.rows.length, status: "queued" }, message: "Dataset evaluation queued for the isolated benchmark runner" });
  } catch (error) { next(error); }
});

router.get("/evaluations/:id", requireAuth, async (req, res, next) => {
  try {
    const evaluation = await query("SELECT * FROM evaluation_jobs WHERE id = $1 AND owner_user_id = $2", [req.params.id, req.user!.sub]);
    if (!evaluation.rows[0]) return res.status(404).json({ error: "Evaluation not found" });
    const results = await query(
      `SELECT er.*, m.title, m.model_id_onchain, br.dataset_name, br.error_message FROM evaluation_results er JOIN models m ON m.id = er.model_id LEFT JOIN benchmark_runs br ON br.id = er.benchmark_run_id WHERE er.evaluation_id = $1 ORDER BY er.leaderboard_score DESC NULLS LAST, er.created_at ASC`, [req.params.id]
    );
    res.json({ evaluation: evaluation.rows[0], results: results.rows });
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
