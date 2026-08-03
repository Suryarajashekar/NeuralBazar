import { RequestHandler } from "express";
import { z, ZodTypeAny } from "zod";

type RequestSchemas = {
  body?: ZodTypeAny;
  params?: ZodTypeAny;
  query?: ZodTypeAny;
};

/// Validate request parts centrally while keeping the existing route handlers
/// and response shapes unchanged. Zod errors are normalized by the app error
/// handler rather than exposing implementation details.
export function validateRequest(schemas: RequestSchemas): RequestHandler {
  return (req, _res, next) => {
    if (schemas.body) schemas.body.parse(req.body);
    if (schemas.params) schemas.params.parse(req.params);
    if (schemas.query) schemas.query.parse(req.query);
    next();
  };
}

export const routeIdSchema = z.object({ id: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/) });
