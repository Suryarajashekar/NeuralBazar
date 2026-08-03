import { randomBytes, timingSafeEqual } from "node:crypto";
import { RequestHandler, Response } from "express";
import { config } from "../config";
import { appendSetCookie } from "./cookies";

export const csrfCookieName = "neuralbazaar_csrf";
const mutatingMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function cookieValue(header: string | undefined, name: string) {
  const part = header?.split(";").map(value => value.trim()).find(value => value.startsWith(`${name}=`));
  if (!part) return "";
  try { return decodeURIComponent(part.slice(name.length + 1)); } catch { return ""; }
}

function secureCookieAttributes() {
  const secure = new URL(config.frontendUrl).protocol === "https:";
  return `Path=/; Max-Age=${config.refreshTokenTtlSeconds}; SameSite=${secure ? "None" : "Lax"}${secure ? "; Secure" : ""}; Priority=High`;
}

export function setCsrfCookie(res: Response, token: string) {
  appendSetCookie(res, `${csrfCookieName}=${encodeURIComponent(token)}; ${secureCookieAttributes()}`);
}

export function issueCsrfToken(res: Response) {
  const token = randomBytes(32).toString("base64url");
  setCsrfCookie(res, token);
  return token;
}

function sameOrigin(req: import("express").Request) {
  const expected = new URL(config.frontendUrl).origin;
  const origin = req.header("origin");
  if (origin) return origin === expected;
  const referer = req.header("referer");
  if (referer) {
    try { return new URL(referer).origin === expected; } catch { return false; }
  }
  return true;
}

export const csrfProtection: RequestHandler = (req, res, next) => {
  if (!mutatingMethods.has(req.method)) return next();
  if (!sameOrigin(req)) return res.status(403).json({ error: "Request origin is not allowed" });

  const hasCookieSession = Boolean(cookieValue(req.header("cookie"), "neuralbazaar_session") || cookieValue(req.header("cookie"), "neuralbazaar_refresh"));
  const isBearer = req.header("authorization")?.startsWith("Bearer ");
  if (!hasCookieSession || isBearer || req.apiPrincipal) return next();

  const expected = cookieValue(req.header("cookie"), csrfCookieName);
  const supplied = req.header("x-csrf-token") ?? "";
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  if (!expected || !supplied || left.length !== right.length || !timingSafeEqual(left, right)) return res.status(403).json({ error: "CSRF validation failed" });
  next();
};
