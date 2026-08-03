import { randomUUID } from "node:crypto";
import { RequestHandler } from "express";
import { logAuditEvent } from "../services/securityLogger";

type Counter = { count: number; resetAt: number };
const failures = new Map<string, Counter>();
const WINDOW_MS = 15 * 60_000;
const BLOCK_THRESHOLD = 25;

export const requestContext: RequestHandler = (req, res, next) => {
  const id = req.header("x-request-id")?.slice(0, 100) || randomUUID();
  req.requestId = id;
  res.setHeader("X-Request-Id", id);
  res.setHeader("X-Trace-Id", id);
  next();
};

export const abuseDetection: RequestHandler = (req, res, next) => {
  const key = req.ip || "unknown";
  const existing = failures.get(key);
  if (existing && existing.resetAt > Date.now() && existing.count >= BLOCK_THRESHOLD && req.path.startsWith("/api/auth")) {
    return res.status(429).json({ error: "Too many failed requests; try again later" });
  }

  res.once("finish", () => {
    if (![401, 403, 429].includes(res.statusCode)) return;
    const now = Date.now();
    const current = failures.get(key);
    const entry = !current || current.resetAt <= now ? { count: 1, resetAt: now + WINDOW_MS } : { count: current.count + 1, resetAt: current.resetAt };
    failures.set(key, entry);
    if (entry.count === 5 || entry.count === BLOCK_THRESHOLD) {
      void logAuditEvent({ req, action: "abuse.threshold", resource: req.path, outcome: "failure", metadata: { status: res.statusCode, count: entry.count } });
    }
  });
  if (failures.size > 10_000) {
    for (const [address, entry] of failures) if (entry.resetAt <= Date.now()) failures.delete(address);
  }
  next();
};
