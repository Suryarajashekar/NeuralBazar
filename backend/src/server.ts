import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import multer from "multer";
import { config } from "./config";
import authRoutes from "./routes/auth";
import modelRoutes from "./routes/models";
import uploadRoutes from "./routes/uploads";
import ratingRoutes from "./routes/ratings";
import reportRoutes from "./routes/reports";
import adminRoutes from "./routes/admin";

const app = express();
app.set("trust proxy", 1);
app.use(helmet());
app.use(cors({ origin: config.frontendUrl, credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }));

// Session authentication uses an HttpOnly cookie. Reject browser mutations
// from an unexpected origin so the cookie cannot be used for cross-site writes.
app.use((req, res, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    const origin = req.header("origin");
    const hasSessionCookie = req.header("cookie")?.split(";").some(part => part.trim().startsWith("neuralbazaar_session="));
    if ((origin && origin !== new URL(config.frontendUrl).origin) || (hasSessionCookie && origin !== new URL(config.frontendUrl).origin)) return res.status(403).json({ error: "Request origin is not allowed" });
  }
  next();
});

app.get("/health", (_req, res) => res.json({ status: "ok", service: "neuralbazaar-api", timestamp: new Date().toISOString() }));
app.use("/api/auth", authRoutes);
app.use("/api/models", modelRoutes);
app.use("/api/uploads", uploadRoutes);
app.use("/api/ratings", ratingRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/admin", adminRoutes);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error);
  if (error instanceof multer.MulterError) {
    const statusCode = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    return res.status(statusCode).json({ error: statusCode === 413 ? "Uploaded file exceeds the size limit" : "Invalid multipart upload" });
  }
  const statusCode = typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : 500;
  const message = statusCode < 500 && error instanceof Error ? error.message : "Unexpected server error";
  return res.status(statusCode).json({ error: message });
});

app.listen(config.port, () => {
  console.log(`NeuralBazaar API listening on port ${config.port}`);
});
