import { RequestHandler } from "express";
import { recordRequest } from "../services/metrics";

export const metricsMiddleware: RequestHandler = (req, res, next) => {
  const started = process.hrtime.bigint();
  res.once("finish", () => recordRequest(req.method, req.path, res.statusCode, Number(process.hrtime.bigint() - started) / 1_000_000));
  next();
};

