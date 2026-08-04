import { query } from "../db";

export async function queueBenchmark(modelId: string, versionId?: string, evaluationId?: string) {
  const result = await query(
    `INSERT INTO benchmark_runs (model_id, version_id, evaluation_id, status, dataset_name, runner_version)
     VALUES ($1, $2, $3, 'queued', 'NeuralBazaar evaluation suite', 'safe-metadata-v1') RETURNING *`,
    [modelId, versionId ?? null, evaluationId ?? null]
  );
  return result.rows[0];
}

export async function processOneBenchmark() {
  const claimed = await query<{ id: string; model_id: string; evaluation_id: string | null }>(
    `UPDATE benchmark_runs SET status = 'running'
     WHERE id = (SELECT id FROM benchmark_runs WHERE status = 'queued' ORDER BY created_at ASC FOR UPDATE SKIP LOCKED LIMIT 1)
     RETURNING id, model_id, evaluation_id`
  );
  const run = claimed.rows[0];
  if (!run) return false;
  try {
    // Uploaded model code is never imported or executed in the API/worker
    // process. This baseline records verifiable artifact metadata and leaves
    // inference metrics unavailable until an isolated runner is configured.
    const artifact = await query<{ size: string | null }>(
      `SELECT (um.signed_manifest->>'byteLength')::text AS size
       FROM upload_manifests um JOIN models m ON m.model_id_onchain = um.model_id_onchain
       WHERE m.id = $1 AND um.status = 'attached' ORDER BY um.created_at DESC LIMIT 1`, [run.model_id]
    );
    await query(
      `UPDATE benchmark_runs SET status = 'not_available', model_size_bytes = $2, metrics = $3, error_message = $4, completed_at = now()
       WHERE id = $1`,
      [run.id, artifact.rows[0]?.size ? Number(artifact.rows[0].size) : null, { execution: "isolated-runner-required", artifactIntegrity: "verified-by-upload-manifest", inferenceMetrics: null }, "Inference benchmark requires an explicitly configured isolated runner"]
    );
    if (run.evaluation_id) {
      await query("UPDATE evaluation_results SET status = 'not_available', completed_at = now() WHERE benchmark_run_id = $1", [run.id]);
      await query("UPDATE evaluation_jobs SET status = 'not_available', completed_at = now() WHERE id = $1", [run.evaluation_id]);
    }
  } catch (error) {
    await query("UPDATE benchmark_runs SET status = 'failed', error_message = $2, completed_at = now() WHERE id = $1", [run.id, error instanceof Error ? error.message.slice(0, 500) : "Benchmark failed"]);
    if (run.evaluation_id) {
      await query("UPDATE evaluation_results SET status = 'failed', completed_at = now() WHERE benchmark_run_id = $1", [run.id]);
      await query("UPDATE evaluation_jobs SET status = 'failed', completed_at = now() WHERE id = $1", [run.evaluation_id]);
    }
  }
  return true;
}
