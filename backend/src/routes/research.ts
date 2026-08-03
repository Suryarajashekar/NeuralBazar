import { Router } from "express";
import { z } from "zod";
import { query } from "../db";
import { requireAuth } from "../middleware/auth";
import { isSuperAdmin } from "../services/identity";

const router = Router();
const artifactTypes = z.enum(["federated_learning", "zk_ownership", "differential_privacy", "explainability", "carbon", "lineage", "reproducibility"]);

router.get("/artifacts/:modelId", async (req, res, next) => {
  try {
    const result = await query("SELECT ra.* FROM research_artifacts ra JOIN models m ON m.id = ra.model_id WHERE (m.id::text = $1 OR m.model_id_onchain::text = $1) ORDER BY ra.created_at DESC", [req.params.modelId]);
    res.json({ artifacts: result.rows });
  } catch (error) { next(error); }
});

router.get("/compute", async (_req, res, next) => {
  try { const result = await query("SELECT * FROM compute_listings WHERE available = true ORDER BY price_per_hour ASC"); res.json({ listings: result.rows }); } catch (error) { next(error); }
});

router.use(requireAuth);

router.post("/artifacts", async (req, res, next) => {
  try {
    const body = z.object({ modelId: z.string().min(1).optional(), artifactType: artifactTypes, artifact: z.record(z.unknown()).default({}), status: z.enum(["pending", "verified", "rejected"]).default("pending") }).parse(req.body);
    const model = body.modelId ? await query<{ id: string; creator_wallet: string }>("SELECT id, creator_wallet FROM models WHERE id::text = $1 OR model_id_onchain::text = $1", [body.modelId]) : { rows: [] };
    if (body.modelId && (!model.rows[0] || (!isSuperAdmin(req.user!.role) && model.rows[0].creator_wallet.toLowerCase() !== req.user!.address.toLowerCase()))) return res.status(403).json({ error: "Only the model creator can attach research artifacts" });
    const result = await query("INSERT INTO research_artifacts (model_id, owner_user_id, artifact_type, status, artifact) VALUES ($1, $2, $3, $4, $5) RETURNING *", [model.rows[0]?.id ?? null, req.user!.sub, body.artifactType, body.status, body.artifact]);
    res.status(201).json({ artifact: result.rows[0] });
  } catch (error) { next(error); }
});

router.post("/cross-chain", async (req, res, next) => {
  try {
    const body = z.object({ modelId: z.string().min(1), chainId: z.number().int().positive(), contractAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/), tokenId: z.string().max(120).default(""), transactionHash: z.string().max(120).default("") }).parse(req.body);
    const model = await query<{ id: string; creator_wallet: string }>("SELECT id, creator_wallet FROM models WHERE id::text = $1 OR model_id_onchain::text = $1", [body.modelId]);
    if (!model.rows[0]) return res.status(404).json({ error: "Model not found" });
    if (!isSuperAdmin(req.user!.role) && model.rows[0].creator_wallet.toLowerCase() !== req.user!.address.toLowerCase()) return res.status(403).json({ error: "Only the model creator can register a cross-chain deployment" });
    const result = await query("INSERT INTO cross_chain_deployments (model_id, chain_id, contract_address, token_id, status, transaction_hash) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (model_id, chain_id) DO UPDATE SET contract_address = EXCLUDED.contract_address, token_id = EXCLUDED.token_id, transaction_hash = EXCLUDED.transaction_hash RETURNING *", [model.rows[0].id, body.chainId, body.contractAddress, body.tokenId, body.transactionHash ? "submitted" : "pending", body.transactionHash]);
    res.status(201).json({ deployment: result.rows[0] });
  } catch (error) { next(error); }
});

router.get("/dao/proposals", async (_req, res, next) => {
  try { const result = await query("SELECT * FROM dao_proposals ORDER BY created_at DESC LIMIT 100"); res.json({ proposals: result.rows }); } catch (error) { next(error); }
});

router.post("/dao/proposals", async (req, res, next) => {
  try {
    const body = z.object({ title: z.string().min(3).max(200), description: z.string().max(5000).default("") }).parse(req.body);
    const result = await query("INSERT INTO dao_proposals (proposer_user_id, title, description) VALUES ($1, $2, $3) RETURNING *", [req.user!.sub, body.title, body.description]);
    res.status(201).json({ proposal: result.rows[0] });
  } catch (error) { next(error); }
});

router.post("/compute", async (req, res, next) => {
  try {
    const body = z.object({ gpuType: z.string().min(1).max(100), region: z.string().max(100).default(""), pricePerHour: z.number().positive().max(100000), capabilities: z.record(z.unknown()).default({}) }).parse(req.body);
    const result = await query("INSERT INTO compute_listings (provider_user_id, gpu_type, region, price_per_hour, capabilities) VALUES ($1, $2, $3, $4, $5) RETURNING *", [req.user!.sub, body.gpuType, body.region, body.pricePerHour, body.capabilities]);
    res.status(201).json({ listing: result.rows[0] });
  } catch (error) { next(error); }
});

export default router;
