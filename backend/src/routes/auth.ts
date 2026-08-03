import { Router } from "express";
import { randomUUID } from "node:crypto";
import rateLimit from "express-rate-limit";
import { SiweMessage } from "siwe";
import { z } from "zod";
import { query, withTransaction } from "../db";
import { config } from "../config";
import { clearSessionCookie, createRefreshToken, hashToken, readCookie, refreshCookieName, requireAuth, revokeSession, setRefreshCookie, setSessionCookie, signAuthToken } from "../middleware/auth";
import { issueCsrfToken } from "../middleware/csrf";
import { validateRequest } from "../middleware/validation";
import { logAuthenticationEvent } from "../services/securityLogger";
import { ensureUsername, normalizeUsername, usernameChangeAllowed } from "../services/username";
import { Role } from "../middleware/auth";

const router = Router();
const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid wallet address");
const authRateLimit = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: true, legacyHeaders: false });

async function issueSession(req: import("express").Request, res: import("express").Response, user: { id: string; wallet_address: string; role: Role }) {
  const sessionId = randomUUID();
  const accessToken = signAuthToken({ sub: user.id, address: user.wallet_address, role: user.role, sid: sessionId });
  const refreshToken = createRefreshToken();
  const deviceId = randomUUID();
  await query(
    `INSERT INTO sessions (session_id, user_id, wallet_address, token_hash, refresh_token_hash, device_id, user_agent, ip_address, expires_at, idle_expires_at)
     VALUES ($1, $2, lower($3), $4, $5, $6, $7, $8, now() + ($9 * interval '1 second'), LEAST(now() + ($9 * interval '1 second'), now() + ($10 * interval '1 minute')))` ,
    [sessionId, user.id, user.wallet_address, hashToken(accessToken), hashToken(refreshToken), deviceId, req.get("user-agent") ?? "", req.ip, config.refreshTokenTtlSeconds, config.sessionIdleTimeoutMinutes]
  );
  setSessionCookie(res, accessToken);
  setRefreshCookie(res, refreshToken);
  return { sessionId, deviceId };
}

router.get("/csrf", (_req, res) => res.json({ token: issueCsrfToken(res) }));

router.post("/nonce", authRateLimit, validateRequest({ body: z.object({ address: addressSchema }) }), async (req, res, next) => {
  try {
    const address = addressSchema.parse(req.body.address).toLowerCase();
    const nonce = randomUUID().replaceAll("-", "");
    await query(
      `INSERT INTO auth_nonces (wallet_address, nonce, expires_at) VALUES ($1, $2, now() + interval '10 minutes')
       ON CONFLICT (wallet_address) DO UPDATE SET nonce = EXCLUDED.nonce, expires_at = EXCLUDED.expires_at`,
      [address, nonce]
    );
    void logAuthenticationEvent({ req, event: "nonce_issued", success: true, walletAddress: address });
    res.json({ nonce });
  } catch (error) { next(error); }
});

router.post("/verify", authRateLimit, validateRequest({ body: z.object({ message: z.string().min(1).max(5000), signature: z.string().min(1).max(500), preferredAccountType: z.enum(["customer", "developer"]).optional() }) }), async (req, res, next) => {
  try {
    const body = z.object({ message: z.string().min(1), signature: z.string().min(1), preferredAccountType: z.enum(["customer", "developer"]).optional() }).parse(req.body);
    const message = new SiweMessage(body.message);
    const address = message.address.toLowerCase();
    addressSchema.parse(address);
    const expectedOrigin = new URL(config.frontendUrl).origin;
    if (message.domain !== new URL(config.frontendUrl).host) return res.status(401).json({ error: "Invalid sign-in domain. Restart the frontend after setting FRONTEND_URL." });
    if (message.uri !== expectedOrigin) return res.status(401).json({ error: "Invalid sign-in origin. Open the app from the configured frontend URL." });
    if (Number(message.chainId) !== config.chainId) return res.status(401).json({ error: `Wrong network. The backend expects chain ID ${config.chainId}.` });
    const nonceResult = await query<{ nonce: string; expires_at: Date }>("SELECT nonce, expires_at FROM auth_nonces WHERE wallet_address = $1", [address]);
    const nonce = nonceResult.rows[0];
    if (!nonce || nonce.expires_at < new Date() || nonce.nonce !== message.nonce) return res.status(401).json({ error: "Invalid or expired nonce" });
    await message.verify({ signature: body.signature, domain: new URL(config.frontendUrl).host, nonce: nonce.nonce });

    const user = await withTransaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock($1)", [918273]);
      const adminCheck = await client.query<{ exists: boolean }>("SELECT EXISTS (SELECT 1 FROM users WHERE role IN ('admin', 'super_admin')) AS exists");
      const firstUser = !adminCheck.rows[0].exists && !config.adminWalletAddress;
      const shouldBeSuperAdmin = address === config.adminWalletAddress || firstUser;
      const result = await client.query<{ id: string; wallet_address: string; role: Role; account_type: "customer" | "developer"; username: string | null; bio: string; avatar_url: string | null; account_status: "active" | "suspended" | "banned" | "deleted" }>(
        `INSERT INTO users (wallet_address, role, account_type) VALUES ($1, $2, $3)
         ON CONFLICT (wallet_address) DO UPDATE SET account_type = EXCLUDED.account_type,
           role = CASE WHEN $4::boolean THEN 'super_admin' ELSE users.role END,
           updated_at = now()
         RETURNING id, wallet_address, role, account_type, username, bio, avatar_url, account_status`, [address, shouldBeSuperAdmin ? "super_admin" : "customer", body.preferredAccountType ?? "customer", shouldBeSuperAdmin]
      );
      const identity = result.rows[0];
      if (!identity || identity.account_status !== "active") {
        const error = new Error("This user account is not active");
        (error as Error & { statusCode: number }).statusCode = 403;
        throw error;
      }
      await ensureUsername(client, identity.id, address);
      await client.query("UPDATE users SET last_login_at = now(), last_active_at = now() WHERE id = $1", [identity.id]);
      const complete = await client.query("SELECT id, wallet_address, role, account_type, username, display_name, bio, avatar_url, banner_url, ens_name, website, github_url, linkedin_url, twitter_url, organization, location, favorite_categories, profile_visibility, badges, verified, created_at FROM users WHERE id = $1", [identity.id]);
      await client.query("DELETE FROM auth_nonces WHERE wallet_address = $1", [address]);
      return complete.rows[0];
    });
    const { sessionId, deviceId } = await issueSession(req, res, user);
    void logAuthenticationEvent({ req, event: "login", success: true, walletAddress: user.wallet_address, userId: user.id, sessionId, deviceId });
    res.json({ user });
  } catch (error) { next(error); }
});

router.post("/logout", async (req, res, next) => {
  try { await revokeSession(req); } catch (error) { return next(error); }
  clearSessionCookie(res);
  res.status(204).end();
});

router.post("/refresh", authRateLimit, async (req, res, next) => {
  try {
    const refreshToken = readCookie(req.header("cookie"), refreshCookieName);
    if (!refreshToken) return res.status(401).json({ error: "Refresh token is required" });
    const result = await query<{ session_id: string; user_id: string; wallet_address: string; role: Role }>(
      `SELECT s.session_id, s.user_id, s.wallet_address, u.role
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.refresh_token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
         AND (s.idle_expires_at IS NULL OR s.idle_expires_at > now())`, [hashToken(refreshToken)]
    );
    const session = result.rows[0];
    if (!session) return res.status(401).json({ error: "Invalid or expired refresh token" });
    const nextRefreshToken = createRefreshToken();
    const accessToken = signAuthToken({ sub: session.user_id, address: session.wallet_address, role: session.role, sid: session.session_id });
    await query(
      `UPDATE sessions SET token_hash = $2, refresh_token_hash = $3, last_seen_at = now(),
         idle_expires_at = LEAST(expires_at, now() + ($4 * interval '1 minute')) WHERE session_id = $1`,
      [session.session_id, hashToken(accessToken), hashToken(nextRefreshToken), config.sessionIdleTimeoutMinutes]
    );
    setSessionCookie(res, accessToken);
    setRefreshCookie(res, nextRefreshToken);
    void logAuthenticationEvent({ req, event: "refresh", success: true, walletAddress: session.wallet_address, userId: session.user_id, sessionId: session.session_id });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

router.get("/sessions", requireAuth, async (req, res, next) => {
  try {
    const result = await query("SELECT session_id, device_id, user_agent, ip_address, created_at, last_seen_at, expires_at, revoked_at, session_id = $2 AS current FROM sessions WHERE user_id = $1 ORDER BY created_at DESC", [req.user!.sub, req.user!.sid]);
    res.json({ sessions: result.rows });
  } catch (error) { next(error); }
});

router.get("/login-history", requireAuth, async (req, res, next) => {
  try {
    const result = await query(
      "SELECT event, success, wallet_address, device_id, ip_address, user_agent, request_id, failure_code, created_at FROM authentication_logs WHERE user_id = $1 OR lower(wallet_address) = lower($2) ORDER BY created_at DESC LIMIT 100",
      [req.user!.sub, req.user!.address]
    );
    res.json({ history: result.rows });
  } catch (error) { next(error); }
});

router.delete("/sessions/:id", requireAuth, validateRequest({ params: z.object({ id: z.string().uuid() }) }), async (req, res, next) => {
  try {
    await query("UPDATE sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE session_id = $1 AND user_id = $2", [req.params.id, req.user!.sub]);
    res.status(204).end();
  } catch (error) { next(error); }
});

router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const result = await query("SELECT id, wallet_address, role, account_type, username, display_name, bio, avatar_url, banner_url, ens_name, website, github_url, linkedin_url, twitter_url, organization, location, favorite_categories, profile_visibility, badges, verified, account_status, created_at, last_active_at FROM users WHERE wallet_address = $1", [req.user!.address]);
    if (!result.rows[0]) return res.status(404).json({ error: "User not found" });
    res.json({ user: result.rows[0] });
  } catch (error) { next(error); }
});

router.patch("/me", requireAuth, async (req, res, next) => {
  try {
    const body = z.object({ username: z.string().optional(), bio: z.string().max(500).optional(), avatarUrl: z.string().url().optional() }).parse(req.body);
    const user = await withTransaction(async client => {
      const current = await client.query<{ id: string; username: string | null; username_changed_at: Date | null }>("SELECT id, username, username_changed_at FROM users WHERE id = $1 FOR UPDATE", [req.user!.sub]);
      if (!current.rows[0]) return null;
      const nextUsername = body.username === undefined ? current.rows[0].username : normalizeUsername(body.username);
      if (nextUsername !== current.rows[0].username) {
        if (!usernameChangeAllowed(current.rows[0].username_changed_at)) {
          const error = new Error("Username changes are limited to once every 30 days");
          (error as Error & { statusCode: number }).statusCode = 409;
          throw error;
        }
        const conflict = await client.query("SELECT 1 FROM users WHERE lower(username) = lower($1) AND id <> $2 UNION ALL SELECT 1 FROM username_history WHERE lower(old_username) = lower($1) LIMIT 1", [nextUsername, req.user!.sub]);
        if (conflict.rows[0]) {
          const error = new Error("Username is already taken");
          (error as Error & { statusCode: number }).statusCode = 409;
          throw error;
        }
        await client.query("INSERT INTO username_history (user_id, old_username, new_username) VALUES ($1, $2, $3)", [req.user!.sub, current.rows[0].username, nextUsername]);
      }
      const result = await client.query("UPDATE users SET username = $2, username_changed_at = CASE WHEN $2 IS DISTINCT FROM username THEN now() ELSE username_changed_at END, bio = COALESCE($3, bio), avatar_url = COALESCE($4, avatar_url), updated_at = now() WHERE id = $1 RETURNING id, wallet_address, role, account_type, username, bio, avatar_url", [req.user!.sub, nextUsername, body.bio, body.avatarUrl]);
      return result.rows[0];
    });
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ user });
  } catch (error) { next(error); }
});

export default router;
