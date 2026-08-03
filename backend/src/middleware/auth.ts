import { NextFunction, Request, Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { config } from "../config";
import { query } from "../db";
import { appendSetCookie } from "./cookies";
import { canonicalRole, EnterpriseRole, requirePermission as permissionMiddleware } from "../services/identity";

export type Role = EnterpriseRole;
export type AuthPayload = { sub: string; address: string; role: Role; sid: string; version?: number };
const walletAddressPattern = /^0x[a-fA-F0-9]{40}$/;
const sessionCookieName = "neuralbazaar_session";
export const refreshCookieName = "neuralbazaar_refresh";

export function readCookie(header: string | undefined, name: string) {
  if (!header) return undefined;
  const value = header.split(";").map(part => part.trim()).find(part => part.startsWith(`${name}=`));
  if (!value) return undefined;
  try { return decodeURIComponent(value.slice(name.length + 1)); } catch { return undefined; }
}

export function sessionToken(req: Request) {
  const authorization = req.header("authorization");
  return authorization?.startsWith("Bearer ") ? authorization.slice(7) : readCookie(req.header("cookie"), sessionCookieName);
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function cookieAttributes(maxAge: number) {
  const secure = new URL(config.frontendUrl).protocol === "https:";
  const sameSite = secure ? "None" : "Lax";
  return `HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=${sameSite}${secure ? "; Secure" : ""}; Priority=High`;
}

export function setSessionCookie(res: Response, token: string) {
  appendSetCookie(res, `${sessionCookieName}=${encodeURIComponent(token)}; ${cookieAttributes(config.accessTokenTtlSeconds)}`);
}

export function setRefreshCookie(res: Response, token: string) {
  appendSetCookie(res, `${refreshCookieName}=${encodeURIComponent(token)}; ${cookieAttributes(config.refreshTokenTtlSeconds)}`);
}

export function clearSessionCookie(res: Response) {
  appendSetCookie(res, `${sessionCookieName}=; ${cookieAttributes(0)}`);
  appendSetCookie(res, `${refreshCookieName}=; ${cookieAttributes(0)}`);
}

export function createRefreshToken() {
  return randomBytes(48).toString("base64url");
}

declare global {
  namespace Express {
    interface Request { user?: AuthPayload; }
  }
}

export function signAuthToken(payload: AuthPayload) {
  return jwt.sign({ ...payload, version: 2, typ: "access" }, config.jwtSecret, { expiresIn: config.accessTokenTtlSeconds });
}

export async function revokeSession(req: Request) {
  const token = sessionToken(req);
  const refresh = readCookie(req.header("cookie"), refreshCookieName);
  if (token || refresh) await query("UPDATE sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE token_hash = $1 OR refresh_token_hash = $2", [token ? hashToken(token) : "", refresh ? hashToken(refresh) : ""]);
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.apiPrincipal) {
    req.user = { sub: req.apiPrincipal.subject, address: req.apiPrincipal.walletAddress, role: req.apiPrincipal.role, sid: `api:${req.apiPrincipal.id}`, version: 2 };
    return next();
  }

  const token = sessionToken(req);
  if (!token) return res.status(401).json({ error: "Authentication required" });

  let claims: jwt.JwtPayload;
  try {
    const verified = jwt.verify(token, config.jwtSecret);
    if (typeof verified === "string") return res.status(401).json({ error: "Invalid session claims" });
    claims = verified;
  } catch {
    return res.status(401).json({ error: "Invalid or expired session" });
  }

  if ((claims.typ !== undefined && claims.typ !== "access") || typeof claims.sub !== "string" || typeof claims.sid !== "string" || typeof claims.address !== "string" || !walletAddressPattern.test(claims.address)) {
    return res.status(401).json({ error: "Invalid session claims" });
  }

  try {
    const session = await query<{ user_id: string }>(
      "SELECT user_id FROM sessions WHERE session_id = $1 AND token_hash = $2 AND revoked_at IS NULL AND expires_at > now() AND (idle_expires_at IS NULL OR idle_expires_at > now())",
      [claims.sid, hashToken(token)]
    );
    if (!session.rows[0] || session.rows[0].user_id !== claims.sub) return res.status(401).json({ error: "Session has been revoked or expired" });
    await query("UPDATE sessions SET last_seen_at = now(), idle_expires_at = LEAST(expires_at, now() + ($2 * interval '1 minute')) WHERE session_id = $1", [claims.sid, config.sessionIdleTimeoutMinutes]);
    // Never authorize from the role stored in the JWT. An administrator can
    // change a user's role, so load the current identity and role from Postgres
    // on every protected request.
    const result = await query<{ id: string; wallet_address: string; role: Role; account_status: "active" | "suspended" | "banned" | "deleted" }>(
      "SELECT id, wallet_address, role, account_status FROM users WHERE id::text = $1 AND lower(wallet_address) = lower($2)",
      [claims.sub, claims.address]
    );
    const currentUser = result.rows[0];
    if (!currentUser) return res.status(401).json({ error: "User account is not active" });
    if (currentUser.account_status !== "active") return res.status(403).json({ error: "This user account is not active", code: "ACCOUNT_INACTIVE" });
    await query("UPDATE users SET last_active_at = now() WHERE id = $1", [currentUser.id]);

    req.user = { sub: currentUser.id, address: currentUser.wallet_address.toLowerCase(), role: currentUser.role, sid: claims.sid };
    next();
  } catch (error) {
    next(error);
  }
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.some(role => canonicalRole(role) === canonicalRole(req.user!.role))) return res.status(403).json({ error: "Insufficient permissions" });
    next();
  };
}

export const requireAdmin = requireRole("admin");
export const requirePermission = permissionMiddleware;
