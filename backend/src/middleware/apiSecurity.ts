import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Request, RequestHandler } from "express";
import { query } from "../db";
import { config } from "../config";
import { EnterpriseRole } from "../services/identity";

export type ApiPrincipal = {
  id: string;
  subject: string;
  walletAddress: string;
  role: EnterpriseRole;
};

declare global {
  namespace Express {
    interface Request {
      apiPrincipal?: ApiPrincipal;
      rawBody?: Buffer;
      requestId?: string;
    }
  }
}

function safeEqual(left: Buffer, right: Buffer) {
  return left.length === right.length && timingSafeEqual(left, right);
}

function parseHeader(value: string | undefined) {
  if (!value) return undefined;
  const separator = value.indexOf(".");
  if (separator <= 0 || separator === value.length - 1) return undefined;
  return { id: value.slice(0, separator), secret: value.slice(separator + 1) };
}

function decodeSignature(value: string) {
  try {
    const base64 = Buffer.from(value, "base64url");
    if (base64.length === 32) return base64;
  } catch { /* try hex below */ }
  try {
    const hex = Buffer.from(value, "hex");
    return hex.length === 32 ? hex : undefined;
  } catch { return undefined; }
}

function bodyDigest(req: Express.Request) {
  const body = (req as Request & { body?: unknown }).body;
  return createHash("sha256").update(req.rawBody ?? (body === undefined ? "" : JSON.stringify(body))).digest("hex");
}

export function apiRequestSecurity(): RequestHandler {
  return async (req, res, next) => {
    const supplied = req.header("x-api-key");
    const signatureHeadersPresent = Boolean(req.header("x-request-signature") || req.header("x-request-timestamp") || req.header("x-request-nonce"));
    if (!supplied && !signatureHeadersPresent) return next();
    const parsed = parseHeader(supplied);
    const key = parsed && config.apiKeys.find(item => item.id === parsed.id);
    const managedKey = parsed && !key ? await query<{ id: string; secret_hash: Buffer; subject: string; wallet_address: string; role: EnterpriseRole }>("SELECT id, secret_hash, owner_user_id::text AS subject, u.wallet_address, k.role FROM managed_api_keys k JOIN users u ON u.id = k.owner_user_id WHERE k.id = $1 AND k.revoked_at IS NULL AND u.account_status = 'active'", [parsed.id]).then(result => result.rows[0]) : undefined;
    const effectiveKey = key ?? (managedKey ? { id: managedKey.id, secret: parsed!.secret, secretHash: managedKey.secret_hash, subject: managedKey.subject, walletAddress: managedKey.wallet_address, role: managedKey.role } : undefined);
    if (!parsed || !effectiveKey || !safeEqual(createHash("sha256").update(parsed.secret).digest(), effectiveKey.secretHash)) {
      return res.status(401).json({ error: "Invalid API credentials" });
    }

    const timestamp = Number(req.header("x-request-timestamp"));
    const nonce = req.header("x-request-nonce") ?? "";
    const suppliedSignature = decodeSignature(req.header("x-request-signature") ?? "");
    if (!Number.isSafeInteger(timestamp) || Math.abs(Math.floor(Date.now() / 1000) - timestamp) > config.requestSigningMaxSkewSeconds || !/^[a-zA-Z0-9_-]{16,128}$/.test(nonce) || !suppliedSignature) {
      return res.status(401).json({ error: "Invalid request signature" });
    }

    const canonical = `${timestamp}.${nonce}.${req.method}.${req.originalUrl}.${bodyDigest(req)}`;
    const expectedSignature = createHmac("sha256", effectiveKey.secret).update(canonical).digest();
    if (!safeEqual(expectedSignature, suppliedSignature)) return res.status(401).json({ error: "Invalid request signature" });

    try {
      const replay = await query(
        `INSERT INTO api_request_nonces (api_key_id, nonce, expires_at)
         VALUES ($1, $2, now() + ($3 * interval '1 second'))
         ON CONFLICT (api_key_id, nonce) DO NOTHING RETURNING nonce`,
        [effectiveKey.id, nonce, config.requestSigningMaxSkewSeconds]
      );
      if (!replay.rows[0]) return res.status(409).json({ error: "Request has already been used" });
      if (managedKey) await query("UPDATE managed_api_keys SET last_used_at = now() WHERE id = $1", [effectiveKey.id]);
      req.apiPrincipal = { id: effectiveKey.id, subject: effectiveKey.subject, walletAddress: effectiveKey.walletAddress, role: effectiveKey.role };
      return next();
    } catch (error) {
      return next(error);
    }
  };
}
