import { databaseUnavailable, json, requireAdmin, type CdkContext, type CdkRecord } from "../_shared";

export const onRequestGet = async (context: CdkContext): Promise<Response> => {
  const unauthorized = requireAdmin(context);
  if (unauthorized) return unauthorized;
  if (!context.env.CDK_DB) return databaseUnavailable();

  const url = new URL(context.request.url);
  const requestedLimit = Number(url.searchParams.get("limit") || 50);
  const requestedOffset = Number(url.searchParams.get("offset") || 0);
  const limit = Number.isInteger(requestedLimit) ? Math.min(100, Math.max(1, requestedLimit)) : 50;
  const offset = Number.isInteger(requestedOffset) ? Math.max(0, requestedOffset) : 0;
  const result = await context.env.CDK_DB.prepare(
    "SELECT id, code_prefix, created_at, expires_at, max_uses, used_count, last_used_at, revoked_at FROM cdks ORDER BY created_at DESC LIMIT ?1 OFFSET ?2",
  ).bind(limit, offset).all<CdkRecord>();

  return json({ ok: true, limit, offset, cdks: result.results });
};

export const onRequest = (context: CdkContext) => {
  if (context.request.method === "OPTIONS") return new Response(null, { status: 204 });
  return json({ ok: false, error: "method_not_allowed", message: "仅支持 GET" }, 405, { allow: "GET" });
};
