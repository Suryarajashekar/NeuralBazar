import { pool, query } from ".";

async function main() {
  await query(
    `INSERT INTO users (wallet_address, role, username, bio) VALUES
      ('0x1111111111111111111111111111111111111111', 'creator', 'VectorForge', 'Open-source computer vision researcher'),
      ('0x2222222222222222222222222222222222222222', 'creator', 'SignalWorks', 'Forecasting and time-series specialist')
     ON CONFLICT (wallet_address) DO NOTHING`
  );
  await query(
    `INSERT INTO models (model_id_onchain, creator_wallet, ipfs_hash, metadata_uri, title, description, category, tags, license)
     VALUES
       (1001, '0x1111111111111111111111111111111111111111', 'QmVectorForge', 'ipfs://QmVectorForgeMetadata', 'Vector Vision Pro', 'High-accuracy image embeddings for product search.', 'Computer Vision', ARRAY['embeddings','search','vision'], 'Apache-2.0'),
       (1002, '0x2222222222222222222222222222222222222222', 'QmSignalWorks', 'ipfs://QmSignalWorksMetadata', 'Signal Forecast 2.1', 'Interpretable forecasting model for operational demand.', 'Forecasting', ARRAY['forecasting','time-series','operations'], 'MIT')
     ON CONFLICT (model_id_onchain) DO NOTHING`
  );
  console.log("Seed data inserted");
  await pool.end();
}

main().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exitCode = 1;
});
