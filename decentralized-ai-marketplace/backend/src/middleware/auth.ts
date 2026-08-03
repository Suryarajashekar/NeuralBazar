import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config";
import { query } from "../db";

export type Role = "buyer" | "creator" | "moderator" | "admin";
export type AuthPayload = { sub: string; address: string; role: Role };
const walletAddressPattern = /^0x[a-fA-F0-9]{40}$/;
const sessionCookieName = "neuralbazaar_session";

function readCookie(header: string | undefined, name: string) {
  if (!header) return undefined;
  const value = header.split(";").map(part => part.trim()).find(part => part.startsWith(`${name}=`));
  if (!value) return undefined;
  try { return decodeURIComponent(value.slice(name.length + 1)); } catch { return undefined; }
}

function sessionToken(req: Request) {
  const authorization = req.header("authorization");
  return authorization?.startsWith("Bearer ") ? authorization.slice(7) : readCookie(req.header("cookie"), sessionCookieName);
}

export function setSessionCookie(res: Response, token: string) {
  const secure = new URL(config.frontendUrl).protocol === "https:";
  const sameSite = secure ? "None" : "Lax";
  res.setHeader("Set-Cookie", `${sessionCookieName}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=604800; SameSite=${sameSite}${secure ? "; Secure" : ""}`);
}

export function clearSessionCookie(res: Response) {
  const secure = new URL(config.frontendUrl).protocol === "https:";
  const sameSite = secure ? "None" : "Lax";
  res.setHeader("Set-Cookie", `${sessionCookieName}=; HttpOnly; Path=/; Max-Age=0; SameSite=${sameSite}${secure ? "; Secure" : ""}`);
}

declare global {
  namespace Express {
    interface Request { user?: AuthPayload; }
  }
}

export function signAuthToken(payload: AuthPayload) {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: "7d" });
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
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

  if (typeof claims.sub !== "string" || typeof claims.address !== "string" || !walletAddressPattern.test(claims.address)) {
    return res.status(401).json({ error: "Invalid session claims" });
  }

  try {
    // Never authorize from the role stored in the JWT. An administrator can
    // change a user's role, so load the current identity and role from Postgres
    // on every protected request.
    const result = await query<{ id: string; wallet_address: string; role: Role }>(
      "SELECT id, wallet_address, role FROM users WHERE id::text = $1 AND lower(wallet_address) = lower($2)",
      [claims.sub, claims.address]
    );
    const currentUser = result.rows[0];
    if (!currentUser) return res.status(401).json({ error: "User account is not active" });

    req.user = { sub: currentUser.id, address: currentUser.wallet_address.toLowerCase(), role: currentUser.role };
    next();
  } catch (error) {
    next(error);
  }
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ error: "Insufficient permissions" });
    next();
  };
}

export const requireAdmin = requireRole("admin");
