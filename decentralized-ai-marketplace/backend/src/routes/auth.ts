import { Router } from "express";
import { randomUUID } from "node:crypto";
import { SiweMessage } from "siwe";
import { z } from "zod";
import { query, withTransaction } from "../db";
import { config } from "../config";
import { clearSessionCookie, requireAuth, setSessionCookie, signAuthToken } from "../middleware/auth";

const router = Router();
const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid wallet address");

router.post("/nonce", async (req, res, next) => {
  try {
    const address = addressSchema.parse(req.body.address).toLowerCase();
    const nonce = randomUUID().replaceAll("-", "");
    await query(
      `INSERT INTO auth_nonces (wallet_address, nonce, expires_at) VALUES ($1, $2, now() + interval '10 minutes')
       ON CONFLICT (wallet_address) DO UPDATE SET nonce = EXCLUDED.nonce, expires_at = EXCLUDED.expires_at`,
      [address, nonce]
    );
    res.json({ nonce });
  } catch (error) { next(error); }
});

router.post("/verify", async (req, res, next) => {
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
      const adminCheck = await client.query<{ exists: boolean }>("SELECT EXISTS (SELECT 1 FROM users WHERE role = 'admin') AS exists");
      const firstUser = !adminCheck.rows[0].exists && !config.adminWalletAddress;
      const shouldBeAdmin = address === config.adminWalletAddress || firstUser;
      const result = await client.query<{ id: string; wallet_address: string; role: "buyer" | "creator" | "moderator" | "admin"; account_type: "customer" | "developer"; username: string | null; bio: string; avatar_url: string | null }>(
        `INSERT INTO users (wallet_address, role, account_type) VALUES ($1, $2, $3)
         ON CONFLICT (wallet_address) DO UPDATE SET account_type = EXCLUDED.account_type,
           role = CASE WHEN $4::boolean THEN 'admin' ELSE users.role END,
           updated_at = now()
         RETURNING id, wallet_address, role, account_type, username, bio, avatar_url`, [address, shouldBeAdmin ? "admin" : "buyer", body.preferredAccountType ?? "customer", shouldBeAdmin]
      );
      await client.query("DELETE FROM auth_nonces WHERE wallet_address = $1", [address]);
      return result.rows[0];
    });
    const token = signAuthToken({ sub: user.id, address: user.wallet_address, role: user.role });
    setSessionCookie(res, token);
    res.json({ user });
  } catch (error) { next(error); }
});

router.post("/logout", (_req, res) => {
  clearSessionCookie(res);
  res.status(204).end();
});

router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const result = await query("SELECT id, wallet_address, role, account_type, username, bio, avatar_url, created_at FROM users WHERE wallet_address = $1", [req.user!.address]);
    if (!result.rows[0]) return res.status(404).json({ error: "User not found" });
    res.json({ user: result.rows[0] });
  } catch (error) { next(error); }
});

router.patch("/me", requireAuth, async (req, res, next) => {
  try {
    const body = z.object({ username: z.string().min(2).max(40).optional(), bio: z.string().max(500).optional(), avatarUrl: z.string().url().optional() }).parse(req.body);
    const result = await query("UPDATE users SET username = COALESCE($2, username), bio = COALESCE($3, bio), avatar_url = COALESCE($4, avatar_url), updated_at = now() WHERE wallet_address = $1 RETURNING id, wallet_address, role, account_type, username, bio, avatar_url", [req.user!.address, body.username, body.bio, body.avatarUrl]);
    res.json({ user: result.rows[0] });
  } catch (error) { next(error); }
});

export default router;
