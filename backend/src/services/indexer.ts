import { ethers } from "ethers";
import { query } from "../db";
import { config } from "../config";
import { accessAbi, getBackendSigner, getProvider, marketplaceAbi, registryAbi } from "./chain";

let running = false;

export async function syncChainOnce() {
  if (!config.rpcUrl || !config.registryAddress || !config.marketplaceAddress) return;
  const provider = getProvider();
  const registry = new ethers.Contract(config.registryAddress, registryAbi, provider);
  const marketplace = new ethers.Contract(config.marketplaceAddress, marketplaceAbi, provider);
  const state = await query<{ last_block: string }>("SELECT last_block FROM indexer_state WHERE id = 1");
  const fromBlock = Number(state.rows[0]?.last_block ?? config.indexerStartBlock - 1) + 1;
  const toBlock = await provider.getBlockNumber();
  if (fromBlock > toBlock) return;

  const registered = await registry.queryFilter(registry.filters.ModelRegistered(), fromBlock, toBlock);
  for (const event of registered) {
    const log = event as ethers.EventLog;
    const [modelId, creator, ipfsHash, metadataURI] = log.args;
    const creatorAddress = String(creator).toLowerCase();
    await query("INSERT INTO users (wallet_address) VALUES ($1) ON CONFLICT DO NOTHING", [creatorAddress]);
    await query(
      `INSERT INTO models (model_id_onchain, creator_wallet, ipfs_hash, metadata_uri, title, description, category, tags, license, status, security_status, verified_safe)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'draft', 'pending', false)
       ON CONFLICT (model_id_onchain) DO UPDATE SET ipfs_hash = EXCLUDED.ipfs_hash, metadata_uri = EXCLUDED.metadata_uri, updated_at = now()`,
      [String(modelId), creatorAddress, String(ipfsHash), String(metadataURI), `Model #${modelId}`, "Newly registered AI model", "Other", [], "Custom"]
    );
  }

  const listings = await marketplace.queryFilter(marketplace.filters.ListingCreated(), fromBlock, toBlock);
  for (const event of listings) {
    const log = event as ethers.EventLog;
    const [listingId, modelId, seller, price] = log.args;
    await query(
      `INSERT INTO listings (listing_id_onchain, model_id_onchain, seller_wallet, price_wei)
       VALUES ($1, $2, lower($3), $4)
       ON CONFLICT (listing_id_onchain) DO UPDATE SET price_wei = EXCLUDED.price_wei, active = true, updated_at = now()`,
      [String(listingId), String(modelId), String(seller), String(price)]
    );
  }

  const cancelled = await marketplace.queryFilter(marketplace.filters.ListingCancelled(), fromBlock, toBlock);
  for (const event of cancelled) {
    const log = event as ethers.EventLog;
    await query("UPDATE listings SET active = false, updated_at = now() WHERE listing_id_onchain = $1", [String(log.args[0])]);
  }

  const priceUpdates = await marketplace.queryFilter(marketplace.filters.ListingPriceUpdated(), fromBlock, toBlock);
  for (const event of priceUpdates) {
    const log = event as ethers.EventLog;
    await query("UPDATE listings SET price_wei = $2, updated_at = now() WHERE listing_id_onchain = $1", [String(log.args[0]), String(log.args[1])]);
  }

  const purchases = await marketplace.queryFilter(marketplace.filters.ModelPurchased(), fromBlock, toBlock);
  for (const event of purchases) {
    const log = event as ethers.EventLog;
    const [listingId, modelId, buyer, price] = log.args;
    const txHash = log.transactionHash;
    await query(
      `INSERT INTO purchases (buyer_wallet, model_id_onchain, listing_id_onchain, price_paid_wei, tx_hash)
       VALUES (lower($1), $2, $3, $4, $5) ON CONFLICT (tx_hash) DO NOTHING`,
      [String(buyer), String(modelId), String(listingId), String(price), txHash]
    );
    await query("UPDATE listings SET active = false, updated_at = now() WHERE listing_id_onchain = $1", [String(listingId)]);
    if (config.accessManagerAddress && config.backendSignerPrivateKey) {
      const access = new ethers.Contract(config.accessManagerAddress, accessAbi, getBackendSigner());
      const tx = await access.grantAccess(String(buyer), String(modelId));
      await tx.wait();
    }
  }

  await query("UPDATE indexer_state SET last_block = $1, updated_at = now() WHERE id = 1", [toBlock]);
}

export function startIndexer() {
  if (running) return () => undefined;
  running = true;
  const run = async () => {
    try { await syncChainOnce(); } catch (error) { console.error("Indexer sync failed", error); }
  };
  const interval = setInterval(run, 15_000);
  void run();
  return () => { running = false; clearInterval(interval); };
}
