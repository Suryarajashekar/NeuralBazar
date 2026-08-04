import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import multer from "multer";
import { ZodError } from "zod";
import { config } from "./config";
import authRoutes from "./routes/auth";
import modelRoutes from "./routes/models";
import uploadRoutes from "./routes/uploads";
import ratingRoutes from "./routes/ratings";
import reportRoutes from "./routes/reports";
import adminRoutes from "./routes/admin";
import { apiRequestSecurity } from "./middleware/apiSecurity";
import { csrfProtection } from "./middleware/csrf";
import { abuseDetection, requestContext } from "./middleware/security";
import { logAdminEvent, logAuditEvent, logAuthenticationEvent } from "./services/securityLogger";
import { metricsMiddleware } from "./middleware/metrics";
import { prometheusMetrics } from "./services/metrics";
import { query } from "./db";
import reputationRoutes from "./routes/reputation";
import benchmarkRoutes from "./routes/benchmarks";
import discoveryRoutes from "./routes/discovery";
import versioningRoutes from "./routes/versioning";
import marketplaceExtrasRoutes from "./routes/marketplaceExtras";
import analyticsRoutes from "./routes/analytics";
import accountRoutes from "./routes/account";
import adminLimitedRoutes from "./routes/adminLimited";
import communityRoutes from "./routes/community";
import organizationRoutes from "./routes/organizations";
import researchRoutes from "./routes/research";
import userRoutes from "./routes/users";
import adminEnterpriseRoutes from "./routes/adminEnterprise";
import assistantRoutes from "./routes/assistant";
import playgroundRoutes from "./routes/playground";

const app = express();
app.set("trust proxy", config.trustProxy);
app.use(requestContext);
app.use(metricsMiddleware);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'none'"],
      objectSrc: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: "no-referrer" },
  hsts: process.env.NODE_ENV === "production" ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false
}));
app.use(cors({
  origin: config.frontendUrl,
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-CSRF-Token", "X-API-Key", "X-Request-Id", "X-Request-Timestamp", "X-Request-Nonce", "X-Request-Signature"]
}));
app.use(express.json({
  limit: "2mb",
  verify: (req, _res, buffer) => { (req as express.Request).rawBody = Buffer.from(buffer); }
}));
app.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }));
app.use(abuseDetection);
app.use(apiRequestSecurity());
app.use(csrfProtection);

// Log security-sensitive requests after the final status is known. Payloads
// and credentials are intentionally excluded from the log metadata.
app.use((req, res, next) => {
  res.once("finish", () => {
    const outcome = res.statusCode < 400 ? "success" : "failure";
    if (req.path.startsWith("/api/admin")) void logAdminEvent({ req, action: `${req.method} ${req.path}`, outcome, target: req.path, metadata: { status: res.statusCode } });
    else if (req.path.startsWith("/api/auth")) void logAuthenticationEvent({ req, event: `${req.method.toLowerCase()}_${req.path.replaceAll("/", "_")}`, success: outcome === "success", walletAddress: typeof req.body?.address === "string" ? req.body.address : undefined, failureCode: outcome === "failure" ? `http_${res.statusCode}` : undefined, metadata: { status: res.statusCode } });
    else if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) void logAuditEvent({ req, action: `${req.method} ${req.path}`, outcome, resource: req.path, metadata: { status: res.statusCode } });
  });
  next();
});

app.get("/health", (_req, res) => res.json({ status: "ok", service: "neuralbazaar-api", timestamp: new Date().toISOString() }));
app.get("/health/live", (_req, res) => res.json({ status: "ok", service: "neuralbazaar-api" }));
app.get("/health/ready", async (_req, res) => {
  try { await query("SELECT 1"); res.json({ status: "ready", service: "neuralbazaar-api" }); }
  catch { res.status(503).json({ status: "not_ready", service: "neuralbazaar-api" }); }
});
app.get("/metrics", (_req, res) => { res.type("text/plain").send(prometheusMetrics()); });

// Persist coarse API usage for enterprise billing/quotas. Credentials and
// payloads are never stored; anonymous requests are covered by Prometheus.
app.use((req, res, next) => {
  const started = process.hrtime.bigint();
  res.once("finish", () => {
    const user = req.user;
    if (!user || !/^[0-9a-f-]{36}$/i.test(user.sub)) return;
    const organizationId = req.header("x-organization-id");
    const org = organizationId && /^[0-9a-f-]{36}$/i.test(organizationId) ? organizationId : null;
    const principal = (req as express.Request & { apiPrincipal?: { id?: string } }).apiPrincipal;
    const promptKey = req.header("x-prompt-key")?.trim().slice(0, 120) || "";
    void query(
      "INSERT INTO api_usage (organization_id, user_id, api_key_id, endpoint, status_code, latency_ms, metadata) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [org, user.sub, principal?.id ?? "", req.path.slice(0, 200), res.statusCode, Number(process.hrtime.bigint() - started) / 1_000_000, { prompt: promptKey, method: req.method }]
    ).catch(error => console.error("API usage log failed", error));
  });
  next();
});
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/profile", userRoutes);
app.use("/api/models", modelRoutes);
app.use("/api/assistant", assistantRoutes);
app.use("/api/playground", playgroundRoutes);
app.use("/api/uploads", uploadRoutes);
app.use("/api/ratings", ratingRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/admin", adminEnterpriseRoutes);
app.use("/api/reputation", reputationRoutes);
app.use("/api/benchmarks", benchmarkRoutes);
app.use("/api/versioning", versioningRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/account", accountRoutes);
app.use("/api/admin/limited", adminLimitedRoutes);
app.use("/api/community", communityRoutes);
app.use("/api/organizations", organizationRoutes);
app.use("/api/research", researchRoutes);
app.use("/api", discoveryRoutes);
app.use("/api", marketplaceExtrasRoutes);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error);
  const requestId = _req.requestId;
  if (res.headersSent) return;
  if (error instanceof multer.MulterError) {
    const statusCode = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    return res.status(statusCode).json({ error: statusCode === 413 ? "Uploaded file exceeds the size limit" : "Invalid multipart upload", code: error.code, requestId });
  }
  if (error instanceof ZodError) return res.status(400).json({ error: "Request validation failed", code: "VALIDATION_ERROR", fields: error.issues.map(issue => issue.path.join(".")).filter(Boolean), requestId });
  const statusCode = typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : 500;
  const safeMessage = error instanceof Error && error.name === "UploadValidationError" ? error.message : statusCode >= 500 ? "Unexpected server error" : "Request could not be processed";
  return res.status(statusCode).json({ error: safeMessage, code: statusCode >= 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR", requestId });
});

app.listen(config.port, () => {
  console.log(`NeuralBazaar API listening on port ${config.port}`);
});
