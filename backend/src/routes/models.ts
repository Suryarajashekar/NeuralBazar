import { Router } from "express";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import { query, withTransaction } from "../db";
import { requireAuth, requireRole } from "../middleware/auth";
import { config } from "../config";
import { licenseAbi, registryAbi, getProvider } from "../services/chain";
import { ethers } from "ethers";
import { createDecryptTransform, unwrapDataKey } from "../services/modelCrypto";
import { routeIdSchema, validateRequest } from "../middleware/validation";
import { verifyModelManifest } from "../services/modelSecurity";

const router = Router();
const modelInput = z.object({
  modelIdOnchain: z.coerce.bigint().positive(),
  ipfsHash: z.string().min(1).max(200),
  metadataUri: z.string().min(1).max(500),
  contentHash: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
  title: z.string().min(2).max(120),
  description: z.string().min(10).max(5000),
  category: z.string().min(2).max(80),
  tags: z.array(z.string().min(1).max(40)).max(20),
  license: z.string().min(2).max(80),
  screenshots: z.array(z.string().url()).max(8).optional().default([]),
  demoVideoUrl: z.string().url().optional(),
  playgroundUrl: z.string().url().optional(),
  documentationUrl: z.string().url().optional(),
  apiReferenceUrl: z.string().url().optional(),
  supportedLanguages: z.array(z.string().min(1).max(40)).max(20).optional().default([]),
  currentVersion: z.string().regex(/^v?\d+\.\d+\.\d+$/).max(30).optional().default("v1.0.0"),
  contextLength: z.coerce.number().int().positive().max(10_000_000).optional(),
  gpuRequirement: z.string().trim().max(120).optional(),
  changelog: z.array(z.object({ version: z.string().max(30), date: z.string().max(40), summary: z.string().max(300), changes: z.array(z.string().max(300)).max(20) })).max(50).optional().default([])
});

router.get("/", async (req, res, next) => {
  try {
    const search = String(req.query.search ?? "").trim();
    const category = String(req.query.category ?? "").trim();
    const sort = ["trending", "newest", "rating", "downloads", "revenue"].includes(String(req.query.sort)) ? String(req.query.sort) : "newest";
    const access = ["free", "paid"].includes(String(req.query.access)) ? String(req.query.access) : "";
    const type = String(req.query.type ?? "").trim().slice(0, 80);
    const result = await query(
      `SELECT m.*, l.listing_id_onchain, l.price_wei, to_char(l.price_wei / 1000000000000000000.0, 'FM999999990.########') AS price_eth,
              COALESCE(ROUND(AVG(CASE WHEN r.target_type = 'model' THEN r.score END)::numeric, 1), 0) AS rating,
              COUNT(CASE WHEN r.target_type = 'model' THEN 1 END)::int AS rating_count,
              COALESCE(u.username, substring(m.creator_wallet, 1, 10)) AS creator_name,
              to_char(COALESCE((SELECT SUM(p.price_paid_wei) FROM purchases p WHERE p.model_id = m.id), 0) / 1000000000000000000.0, 'FM999999990.########') AS revenue_eth,
              COALESCE((SELECT cr.reputation_score FROM creator_reputation cr JOIN users ru ON ru.id = cr.user_id WHERE lower(ru.wallet_address) = lower(m.creator_wallet)), 0) AS reputation_score,
              COALESCE((SELECT cr.trust_score FROM creator_reputation cr JOIN users ru ON ru.id = cr.user_id WHERE lower(ru.wallet_address) = lower(m.creator_wallet)), 0) AS trust_score,
              (COALESCE(u.verified, false) OR COALESCE((SELECT cr.verified FROM creator_reputation cr JOIN users ru ON ru.id = cr.user_id WHERE lower(ru.wallet_address) = lower(m.creator_wallet)), false)) AS creator_verified
       FROM models m LEFT JOIN users u ON lower(u.wallet_address) = lower(m.creator_wallet)
       LEFT JOIN listings l ON l.model_id_onchain = m.model_id_onchain AND l.active = true
       LEFT JOIN ratings r ON r.target_key = m.id::text
       WHERE m.status = 'published'
         AND m.security_status IN ('verified_safe', 'legacy_unverified')
         AND ($1 = '' OR m.title ILIKE '%' || $1 || '%' OR m.description ILIKE '%' || $1 || '%' OR $1 = ANY(m.tags))
         AND ($2 = '' OR m.category = $2)
         AND ($3 = '' OR lower(m.category) = lower($3) OR lower(m.title) ILIKE '%' || lower($3) || '%' OR EXISTS (SELECT 1 FROM unnest(m.tags) tag WHERE lower(tag) = lower($3)))
         AND ($4 = '' OR ($4 = 'free' AND (l.price_wei IS NULL OR l.price_wei = 0)) OR ($4 = 'paid' AND l.price_wei IS NOT NULL AND l.price_wei > 0))
       GROUP BY m.id, u.username, u.verified, l.listing_id_onchain, l.price_wei
       ORDER BY ${sort === "rating" ? "rating DESC, m.created_at DESC" : sort === "downloads" ? "m.download_count DESC, m.created_at DESC" : sort === "revenue" ? "COALESCE((SELECT SUM(p2.price_paid_wei) FROM purchases p2 WHERE p2.model_id = m.id), 0) DESC, m.created_at DESC" : sort === "trending" ? "m.trending_score DESC, m.view_count DESC, m.created_at DESC" : "m.created_at DESC"}`,
      [search, category, type, access]
    );
    res.json({ models: result.rows });
  } catch (error) { next(error); }
});

router.get("/purchased", requireAuth, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT m.*, p.price_paid_wei, p.purchased_at, p.tx_hash, am.listing_id_onchain
       FROM purchases p JOIN models m ON m.model_id_onchain = p.model_id_onchain
       LEFT JOIN listings am ON am.listing_id_onchain = p.listing_id_onchain
       WHERE lower(p.buyer_wallet) = lower($1) ORDER BY p.purchased_at DESC`, [req.user!.address]
    );
    res.json({ models: result.rows });
  } catch (error) { next(error); }
});

router.get("/mine", requireAuth, requireRole("creator", "admin"), async (req, res, next) => {
  try {
    const result = await query(
      `SELECT m.*, l.listing_id_onchain, l.price_wei, to_char(l.price_wei / 1000000000000000000.0, 'FM999999990.########') AS price_eth, l.active AS listing_active
       FROM models m LEFT JOIN listings l ON l.model_id_onchain = m.model_id_onchain
       WHERE lower(m.creator_wallet) = lower($1) ORDER BY m.created_at DESC`, [req.user!.address]
    );
    res.json({ models: result.rows });
  } catch (error) { next(error); }
});

router.get("/compare", async (req, res, next) => {
  try {
    const ids = Array.from(new Set(String(req.query.ids ?? "").split(",").map(value => value.trim()).filter(Boolean))).slice(0, 4);
    if (!ids.length) return res.json({ models: [] });
    const models = await Promise.all(ids.map(async value => {
      const result = await query(
        `SELECT m.*, l.listing_id_onchain, l.price_wei, to_char(l.price_wei / 1000000000000000000.0, 'FM999999990.########') AS price_eth,
                COALESCE(u.username, substring(m.creator_wallet, 1, 10)) AS creator_name,
                COALESCE((SELECT ROUND(AVG(r.score)::numeric, 1) FROM ratings r WHERE r.target_type = 'model' AND r.target_key = m.id::text), 0) AS rating,
                COALESCE((SELECT COUNT(*)::int FROM ratings r WHERE r.target_type = 'model' AND r.target_key = m.id::text), 0) AS rating_count,
                to_char(COALESCE((SELECT SUM(p.price_paid_wei) FROM purchases p WHERE p.model_id = m.id), 0) / 1000000000000000000.0, 'FM999999990.########') AS revenue_eth,
                (SELECT b.accuracy FROM benchmark_runs b WHERE b.model_id = m.id AND b.status = 'completed' ORDER BY b.created_at DESC LIMIT 1) AS accuracy,
                (SELECT b.latency_ms FROM benchmark_runs b WHERE b.model_id = m.id AND b.status = 'completed' ORDER BY b.created_at DESC LIMIT 1) AS latency_ms,
                (SELECT b.inference_speed FROM benchmark_runs b WHERE b.model_id = m.id AND b.status = 'completed' ORDER BY b.created_at DESC LIMIT 1) AS inference_speed,
                (SELECT b.gpu_memory_mb FROM benchmark_runs b WHERE b.model_id = m.id AND b.status = 'completed' ORDER BY b.created_at DESC LIMIT 1) AS gpu_memory_mb
         FROM models m LEFT JOIN users u ON lower(u.wallet_address) = lower(m.creator_wallet)
         LEFT JOIN listings l ON l.model_id_onchain = m.model_id_onchain AND l.active = true
         WHERE (m.id::text = $1 OR m.model_id_onchain::text = $1) AND m.status = 'published'`, [value]
      );
      return result.rows[0];
    }));
    res.json({ models: models.filter(Boolean) });
  } catch (error) { next(error); }
});

router.get("/:id/blockchain", validateRequest({ params: routeIdSchema }), async (req, res, next) => {
  try {
    const model = await query<{ model_id_onchain: string; creator_wallet: string; ipfs_hash: string; metadata_uri: string; content_hash: string | null }>(
      "SELECT model_id_onchain, creator_wallet, ipfs_hash, metadata_uri, content_hash FROM models WHERE id::text = $1 OR model_id_onchain::text = $1",
      [req.params.id]
    );
    if (!model.rows[0]) return res.status(404).json({ error: "Model not found" });
    const modelId = model.rows[0].model_id_onchain;
    const [licenses, licensePurchases, purchases, reviews] = await Promise.all([
      query("SELECT license_id_onchain, owner_wallet, creator_wallet, model_hash, license_uri, issued_tx_hash, issued_at, updated_at FROM license_tokens WHERE model_id_onchain = $1 ORDER BY issued_at DESC", [modelId]),
      query("SELECT license_id_onchain, buyer_wallet, seller_wallet, price_paid_wei, royalty_paid_wei, tx_hash, purchased_at FROM license_purchases WHERE model_id_onchain = $1 ORDER BY purchased_at DESC", [modelId]),
      query("SELECT buyer_wallet, listing_id_onchain, price_paid_wei, tx_hash, purchased_at FROM purchases WHERE model_id_onchain = $1 ORDER BY purchased_at DESC", [modelId]),
      query("SELECT review_hash, reviewer_wallet, score, review_uri, tx_hash, anchored_at FROM onchain_reviews WHERE model_id_onchain = $1 ORDER BY anchored_at DESC", [modelId])
    ]);
    res.json({ provenance: { ...model.rows[0], licenses: licenses.rows, licensePurchases: licensePurchases.rows, purchases: purchases.rows, immutableReviews: reviews.rows } });
  } catch (error) { next(error); }
});

router.get("/:id", validateRequest({ params: routeIdSchema }), async (req, res, next) => {
  try {
    const result = await query(
      `SELECT m.*, l.listing_id_onchain, l.price_wei, to_char(l.price_wei / 1000000000000000000.0, 'FM999999990.########') AS price_eth,
              COALESCE(u.username, substring(m.creator_wallet, 1, 10)) AS creator_name,
              COALESCE(AVG(CASE WHEN r.target_type = 'model' THEN r.score END), 0) AS rating,
              COUNT(CASE WHEN r.target_type = 'model' THEN 1 END)::int AS rating_count,
              COALESCE(AVG(CASE WHEN r.target_type = 'developer' THEN r.score END), 0) AS developer_rating
              ,to_char(COALESCE((SELECT SUM(p.price_paid_wei) FROM purchases p WHERE p.model_id = m.id), 0) / 1000000000000000000.0, 'FM999999990.########') AS revenue_eth
              ,COALESCE((SELECT cr.reputation_score FROM creator_reputation cr JOIN users ru ON ru.id = cr.user_id WHERE lower(ru.wallet_address) = lower(m.creator_wallet)), 0) AS reputation_score
              ,COALESCE((SELECT cr.trust_score FROM creator_reputation cr JOIN users ru ON ru.id = cr.user_id WHERE lower(ru.wallet_address) = lower(m.creator_wallet)), 0) AS trust_score
              ,(COALESCE(u.verified, false) OR COALESCE((SELECT cr.verified FROM creator_reputation cr JOIN users ru ON ru.id = cr.user_id WHERE lower(ru.wallet_address) = lower(m.creator_wallet)), false)) AS creator_verified
       FROM models m LEFT JOIN users u ON lower(u.wallet_address) = lower(m.creator_wallet)
       LEFT JOIN listings l ON l.model_id_onchain = m.model_id_onchain AND l.active = true
       LEFT JOIN ratings r ON r.target_key = CASE WHEN r.target_type = 'model' THEN m.id::text ELSE lower(m.creator_wallet) END
       WHERE m.id::text = $1 OR m.model_id_onchain::text = $1
       GROUP BY m.id, u.username, u.verified, l.listing_id_onchain, l.price_wei`, [req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Model not found" });
    res.json({ model: result.rows[0] });
  } catch (error) { next(error); }
});

router.post("/", requireAuth, requireRole("creator", "admin"), async (req, res, next) => {
  try {
    const body = modelInput.parse(req.body);
    if (!config.registryAddress || !ethers.isAddress(config.registryAddress)) return res.status(503).json({ error: "Model registry is not configured" });

    const registry = new ethers.Contract(config.registryAddress, registryAbi, getProvider());
    let details: { creator: string; ipfsHash: string; metadataURI: string };
    try {
      details = await registry.modelDetails(body.modelIdOnchain);
    } catch {
      return res.status(404).json({ error: "The on-chain model does not exist" });
    }
    if (details.creator.toLowerCase() !== req.user!.address.toLowerCase()) return res.status(403).json({ error: "Only the on-chain creator can save this model" });
    if (details.ipfsHash !== body.ipfsHash || details.metadataURI !== body.metadataUri) return res.status(409).json({ error: "Database metadata must match the registered on-chain metadata" });
    let anchoredHash = "";
    try { anchoredHash = String(await registry.modelHashOf(body.modelIdOnchain)); } catch { /* pre-Phase-9 registry */ }
    if (body.contentHash && anchoredHash && anchoredHash.toLowerCase() !== `0x${body.contentHash.toLowerCase()}`) return res.status(409).json({ error: "The uploaded artifact hash does not match the on-chain hash" });

    const manifest = await query<{
      upload_id: string;
      original_sha256: string;
      encrypted_sha256: string;
      security_score: number;
      security_status: "verified_safe" | "rejected";
      verified_safe: boolean;
      security_report: Record<string, unknown>;
      signed_manifest: Record<string, unknown>;
      signature: string;
      signature_public_key: string;
      provenance: Record<string, unknown>;
    }>(
      `SELECT upload_id, original_sha256, encrypted_sha256, security_score, security_status, verified_safe, security_report, signed_manifest, signature, signature_public_key, provenance
       FROM upload_manifests
       WHERE lower(owner_wallet) = lower($1) AND ipfs_hash = $2 AND status = 'ready' AND scan_status = 'passed' AND security_status = 'verified_safe' AND verified_safe = true AND security_score >= $3 AND expires_at > now()
       ORDER BY created_at DESC LIMIT 1`, [req.user!.address, body.ipfsHash, config.modelSecurityScoreThreshold]
    );
    if (!manifest.rows[0]) return res.status(409).json({ error: "This model must be uploaded, scanned, and encrypted through the private upload flow first" });
    const manifestRow = manifest.rows[0];
    if (body.contentHash && manifestRow.original_sha256.toLowerCase() !== body.contentHash.toLowerCase()) return res.status(409).json({ error: "The uploaded artifact hash does not match the security manifest" });
    const signedManifestSchema = z.object({
      uploadId: z.string().uuid(),
      ownerWallet: z.string(),
      originalName: z.string(),
      originalSha256: z.string().regex(/^[a-f0-9]{64}$/),
      encryptedSha256: z.string().regex(/^[a-f0-9]{64}$/),
      byteLength: z.number().int().positive(),
      scanner: z.string(),
      securityScore: z.number().int().min(0).max(100),
      securityStatus: z.literal("verified_safe"),
      watermarkDetected: z.boolean(),
      createdAt: z.string()
    });
    const signedManifest = signedManifestSchema.parse(manifestRow.signed_manifest);
    if (!manifestRow.signature || !manifestRow.signature_public_key || !verifyModelManifest(signedManifest, manifestRow.signature, manifestRow.signature_public_key)) {
      return res.status(409).json({ error: "The upload security manifest signature is invalid" });
    }
    if (signedManifest.uploadId !== manifestRow.upload_id || signedManifest.ownerWallet.toLowerCase() !== req.user!.address.toLowerCase() || signedManifest.originalSha256 !== manifestRow.original_sha256 || signedManifest.encryptedSha256 !== manifestRow.encrypted_sha256 || signedManifest.securityScore !== manifestRow.security_score) {
      return res.status(409).json({ error: "The upload security manifest does not match the stored artifact" });
    }

    const result = await withTransaction(async client => {
      const provenance = {
        ...manifestRow.provenance,
        onchain: { modelId: body.modelIdOnchain.toString(), creator: details.creator, ipfsHash: details.ipfsHash, metadataUri: details.metadataURI }
      };
      const inserted = await client.query(
        `INSERT INTO models (model_id_onchain, creator_wallet, ipfs_hash, metadata_uri, content_hash, title, description, category, tags, license, security_score, security_status, verified_safe, security_report, provenance, screenshots, demo_video_url, playground_url, documentation_url, api_reference_url, supported_languages, current_version, context_length, gpu_requirement, changelog)
         VALUES ($1, lower($2), $3, $4, $5, $6, $7, $8, $9, $10, $11, 'verified_safe', true, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
         ON CONFLICT (model_id_onchain) DO UPDATE SET content_hash = EXCLUDED.content_hash, title = EXCLUDED.title, description = EXCLUDED.description, category = EXCLUDED.category, tags = EXCLUDED.tags, license = EXCLUDED.license, screenshots = EXCLUDED.screenshots, demo_video_url = EXCLUDED.demo_video_url, playground_url = EXCLUDED.playground_url, documentation_url = EXCLUDED.documentation_url, api_reference_url = EXCLUDED.api_reference_url, supported_languages = EXCLUDED.supported_languages, current_version = EXCLUDED.current_version, context_length = EXCLUDED.context_length, gpu_requirement = EXCLUDED.gpu_requirement, changelog = EXCLUDED.changelog, security_score = EXCLUDED.security_score, security_status = EXCLUDED.security_status, verified_safe = EXCLUDED.verified_safe, security_report = EXCLUDED.security_report, provenance = EXCLUDED.provenance, updated_at = now()
         RETURNING *`, [body.modelIdOnchain.toString(), req.user!.address, body.ipfsHash, body.metadataUri, body.contentHash ?? (anchoredHash.startsWith("0x") ? anchoredHash.slice(2) : null), body.title, body.description, body.category, body.tags, body.license, manifestRow.security_score, manifestRow.security_report, provenance, body.screenshots, body.demoVideoUrl, body.playgroundUrl, body.documentationUrl, body.apiReferenceUrl, body.supportedLanguages, body.currentVersion, body.contextLength, body.gpuRequirement, JSON.stringify(body.changelog)]
      );
      await client.query("UPDATE upload_manifests SET model_id_onchain = $2, status = 'attached', attached_at = now() WHERE upload_id = $1 AND status = 'ready'", [manifest.rows[0].upload_id, body.modelIdOnchain.toString()]);
      return inserted;
    });
    res.status(201).json({ model: result.rows[0] });
  } catch (error) { next(error); }
});

router.get("/:id/access", requireAuth, validateRequest({ params: routeIdSchema }), async (req, res, next) => {
  try {
    const result = await query<{ id: string; model_id_onchain: string; ipfs_hash: string; title: string; original_name: string; wrapped_key: string; encryption_iv: string }>(
      `SELECT m.model_id_onchain, m.ipfs_hash, m.title, m.id, um.original_name, um.wrapped_key, um.encryption_iv
       FROM models m JOIN upload_manifests um ON um.model_id_onchain = m.model_id_onchain AND um.status = 'attached'
       WHERE (m.id::text = $1 OR m.model_id_onchain::text = $1) AND m.status = 'published'`, [req.params.id]
    );
    const model = result.rows[0];
    if (!model) return res.status(404).json({ error: "Model not found" });
    const { accessAbi } = await import("../services/chain");
    let allowed = false;
    if (config.licenseNFTAddress) {
      const license = new ethers.Contract(config.licenseNFTAddress, licenseAbi, getProvider());
      allowed = await license.hasModelLicense(req.user!.address, BigInt(model.model_id_onchain));
    }
    if (!allowed && config.accessManagerAddress) {
      const accessManager = new ethers.Contract(config.accessManagerAddress, accessAbi, getProvider());
      allowed = await accessManager.hasAccess(req.user!.address, BigInt(model.model_id_onchain));
    }
    if (!allowed) return res.status(403).json({ error: "Purchase access to unlock this model" });

    const gatewayUrl = `${config.pinataGateway.replace(/\/$/, "")}/${model.ipfs_hash}`;
    const gatewayResponse = await fetch(gatewayUrl, { headers: config.pinataGatewayJwt ? { Authorization: `Bearer ${config.pinataGatewayJwt}` } : undefined });
    if (!gatewayResponse.ok || !gatewayResponse.body) return res.status(502).json({ error: "Private model storage is unavailable" });
    const safeFilename = model.original_name.replace(/[^a-zA-Z0-9._-]/g, "_");
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${safeFilename}"`);
    res.setHeader("Cache-Control", "private, no-store");
    try {
      await pipeline(
        Readable.fromWeb(gatewayResponse.body as import("node:stream/web").ReadableStream),
        createDecryptTransform(unwrapDataKey(model.wrapped_key), Buffer.from(model.encryption_iv, "base64")),
        res
      );
      await query("UPDATE models SET download_count = download_count + 1, updated_at = now() WHERE model_id_onchain = $1", [model.model_id_onchain]);
      if (!req.user!.sid.startsWith("api:")) {
        await query("INSERT INTO user_activity (user_id, model_id, activity_type, metadata) VALUES ($1, $2, 'downloaded', $3)", [req.user!.sub, model.id, { source: "private-access" }]);
      }
    } catch (error) {
      if (!res.destroyed) res.destroy(error as Error);
    }
  } catch (error) { next(error); }
});

router.patch("/:id/status", requireAuth, requireRole("moderator", "admin"), validateRequest({ params: routeIdSchema }), async (req, res, next) => {
  try {
    const status = z.enum(["published", "flagged", "suspended", "removed"]).parse(req.body.status);
    if (status === "published") {
      const verification = await query("SELECT verified_safe, security_status, security_score FROM models WHERE id::text = $1", [req.params.id]);
      const row = verification.rows[0];
      if (!row || row.verified_safe !== true || row.security_status !== "verified_safe" || Number(row.security_score) < config.modelSecurityScoreThreshold) {
        return res.status(409).json({ error: "Only a verified-safe model may be published" });
      }
    }
    const result = await query("UPDATE models SET status = $2, updated_at = now() WHERE id::text = $1 RETURNING *", [req.params.id, status]);
    if (!result.rows[0]) return res.status(404).json({ error: "Model not found" });
    res.json({ model: result.rows[0] });
  } catch (error) { next(error); }
});

export default router;
