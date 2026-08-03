import { Request } from "express";
import { query } from "../db";

type Metadata = Record<string, unknown>;

function clean(value: string | undefined, max = 500) {
  return (value ?? "").slice(0, max);
}

async function safeInsert(statement: string, params: unknown[]) {
  try {
    await query(statement, params);
  } catch (error) {
    // Security telemetry must never take down a marketplace request. Keep the
    // failure visible to operators without returning database details to users.
    console.error("Security log write failed", error instanceof Error ? error.message : "unknown error");
  }
}

export function requestContext(req: Request) {
  return {
    requestId: req.requestId ?? "",
    ipAddress: clean(req.ip, 100),
    userAgent: clean(req.get("user-agent"), 500),
    sessionId: req.user?.sid ?? ""
  };
}

export function logAuditEvent(input: {
  req?: Request;
  action: string;
  resource?: string;
  resourceId?: string;
  outcome: "success" | "failure";
  actorSub?: string;
  actorWallet?: string;
  metadata?: Metadata;
}) {
  const ctx = input.req ? requestContext(input.req) : { requestId: "", ipAddress: "", userAgent: "", sessionId: "" };
  return safeInsert(
    `INSERT INTO audit_logs (actor_sub, actor_wallet, action, resource, resource_id, outcome, request_id, session_id, ip_address, user_agent, metadata)
     VALUES ($1, lower($2), $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)`,
    [input.actorSub ?? input.req?.user?.sub ?? "", input.actorWallet ?? input.req?.user?.address ?? "", clean(input.action, 120), clean(input.resource, 120), clean(input.resourceId, 120), input.outcome, ctx.requestId, ctx.sessionId, ctx.ipAddress, ctx.userAgent, JSON.stringify(input.metadata ?? {})]
  );
}

export function logAdminEvent(input: { req: Request; action: string; outcome: "success" | "failure"; target?: string; metadata?: Metadata }) {
  const ctx = requestContext(input.req);
  return safeInsert(
    `INSERT INTO admin_logs (actor_sub, actor_wallet, action, target, outcome, request_id, session_id, ip_address, user_agent, metadata)
     VALUES ($1, lower($2), $3, $4, $5, $6, $7, $8, $9, $10::jsonb)`,
    [input.req.user?.sub ?? "", input.req.user?.address ?? "", clean(input.action, 120), clean(input.target, 200), input.outcome, ctx.requestId, ctx.sessionId, ctx.ipAddress, ctx.userAgent, JSON.stringify(input.metadata ?? {})]
  );
}

export function logAuthenticationEvent(input: {
  req: Request;
  event: string;
  success: boolean;
  walletAddress?: string;
  userId?: string;
  sessionId?: string;
  deviceId?: string;
  failureCode?: string;
  metadata?: Metadata;
}) {
  const ctx = requestContext(input.req);
  return safeInsert(
    `INSERT INTO authentication_logs (event, success, wallet_address, user_id, session_id, device_id, ip_address, user_agent, request_id, failure_code, metadata)
     VALUES ($1, $2, lower($3), NULLIF($4, '')::uuid, $5, $6, $7, $8, $9, $10, $11::jsonb)`,
    [clean(input.event, 80), input.success, input.walletAddress ?? "", input.userId ?? "", input.sessionId ?? "", clean(input.deviceId, 120), ctx.ipAddress, ctx.userAgent, ctx.requestId, clean(input.failureCode, 120), JSON.stringify(input.metadata ?? {})]
  );
}
