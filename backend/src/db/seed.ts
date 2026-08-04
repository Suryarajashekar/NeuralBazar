import { pool, query } from ".";

async function main() {
  await query(
    `INSERT INTO users (wallet_address, role, username, bio, display_name, website, github_url, huggingface_url, skills, verified) VALUES
      ('0x1111111111111111111111111111111111111111', 'creator', 'VectorForge', 'Open-source computer vision researcher', 'Mira Chen', 'https://vectorforge.dev', 'https://github.com/vectorforge', 'https://huggingface.co/vectorforge', ARRAY['Computer vision','PyTorch','Embeddings'], true),
      ('0x2222222222222222222222222222222222222222', 'creator', 'SignalWorks', 'Forecasting and time-series specialist', 'Jon Bell', 'https://signalworks.ai', 'https://github.com/signalworks', 'https://huggingface.co/signalworks', ARRAY['Forecasting','Time series','Python'], true)
     ON CONFLICT (wallet_address) DO NOTHING`
  );
  await query(
    `INSERT INTO models (model_id_onchain, creator_wallet, ipfs_hash, metadata_uri, title, description, category, tags, license, current_version, context_length, gpu_requirement, supported_languages, screenshots, documentation_url, api_reference_url, playground_url, demo_video_url, changelog, download_count)
     VALUES
       (1001, '0x1111111111111111111111111111111111111111', 'QmVectorForge', 'ipfs://QmVectorForgeMetadata', 'Vector Vision Pro', 'High-accuracy image embeddings for product search.', 'Computer Vision', ARRAY['embeddings','search','vision'], 'Apache-2.0', 'v2.4.1', 8192, '1x T4 · 16 GB VRAM', ARRAY['Python','JavaScript','cURL'], ARRAY['preview-1','preview-2','preview-3'], 'https://docs.neuralbazaar.local/vector-vision', 'https://docs.neuralbazaar.local/vector-vision/api', 'https://play.neuralbazaar.local/vector-vision', 'https://video.neuralbazaar.local/vector-vision', '[{"version":"v2.4.1","date":"Jun 18, 2026","summary":"Faster indexing and stronger low-light retrieval.","changes":["Reduced median embedding latency by 34%","Added multilingual product labels"]}]'::jsonb, 18420),
       (1002, '0x2222222222222222222222222222222222222222', 'QmSignalWorks', 'ipfs://QmSignalWorksMetadata', 'Signal Forecast 2.1', 'Interpretable forecasting model for operational demand.', 'Forecasting', ARRAY['forecasting','time-series','operations'], 'MIT', 'v2.1.0', 4096, 'CPU or 1x T4 · 8 GB VRAM', ARRAY['Python','R'], ARRAY['forecast-1','forecast-2'], 'https://docs.neuralbazaar.local/signal-forecast', 'https://docs.neuralbazaar.local/signal-forecast/api', NULL, NULL, '[{"version":"v2.1.0","date":"Jun 03, 2026","summary":"Improved confidence intervals for sparse series.","changes":["Added holiday-aware seasonality"]}]'::jsonb, 8930)
      ON CONFLICT (model_id_onchain) DO NOTHING`
  );
  await query(
    `INSERT INTO creator_reputation (user_id, reputation_score, trust_score, successful_sales, successful_downloads, average_rating, verified)
     SELECT id, 92, 95, 128, 18420, 4.9, true FROM users WHERE lower(wallet_address) = lower('0x1111111111111111111111111111111111111111')
     ON CONFLICT (user_id) DO NOTHING;
     INSERT INTO creator_reputation (user_id, reputation_score, trust_score, successful_sales, successful_downloads, average_rating, verified)
     SELECT id, 88, 91, 64, 8930, 4.7, true FROM users WHERE lower(wallet_address) = lower('0x2222222222222222222222222222222222222222')
     ON CONFLICT (user_id) DO NOTHING;`
  );
  await query(
    `INSERT INTO benchmark_runs (model_id, status, accuracy, latency_ms, inference_speed, gpu_memory_mb, cost_per_1k_tokens, model_size_bytes, dataset_name, runner_version, completed_at)
     SELECT id, 'completed', 0.942, 42.0, 23.8, 4096, 0.012, 185000000, 'retail-search-v3', 'neuralbazaar-runner-1.2', now() FROM models m WHERE model_id_onchain = 1001 AND NOT EXISTS (SELECT 1 FROM benchmark_runs b WHERE b.model_id = m.id AND b.status = 'completed');
     INSERT INTO benchmark_runs (model_id, status, accuracy, latency_ms, inference_speed, gpu_memory_mb, cost_per_1k_tokens, model_size_bytes, dataset_name, runner_version, completed_at)
     SELECT id, 'completed', 0.887, 68.0, 14.7, 2048, 0.008, 92000000, 'operations-forecast-v2', 'neuralbazaar-runner-1.2', now() FROM models m WHERE model_id_onchain = 1002 AND NOT EXISTS (SELECT 1 FROM benchmark_runs b WHERE b.model_id = m.id AND b.status = 'completed');`
  );
  await query(
    `INSERT INTO ratings (rater_wallet, target_type, target_key, score, review) VALUES
      ('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'model', (SELECT id::text FROM models WHERE model_id_onchain = 1001), 5, 'Excellent retrieval quality and a clean API.'),
      ('0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'model', (SELECT id::text FROM models WHERE model_id_onchain = 1001), 5, 'The playground made evaluation quick.'),
      ('0xcccccccccccccccccccccccccccccccccccccc', 'model', (SELECT id::text FROM models WHERE model_id_onchain = 1002), 5, 'Clear forecasts with useful uncertainty bands.')
     ON CONFLICT DO NOTHING;`
  );
  console.log("Seed data inserted");
  await pool.end();
}

main().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exitCode = 1;
});
