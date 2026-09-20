import {
  changesOf,
  databaseUnavailable,
  hashCode,
  json,
  normalizeCode,
  readJson,
  requireAdmin,
  nowIso,
  type CdkContext,
} from "../_shared";

export const onRequestPost = async (context: CdkContext): Promise<Response> => {
  const unauthorized = requireAdmin(context);
  if (unauthorized) return unauthorized;
  if (!context.env.CDK_DB) return databaseUnavailable();

  let body: Record<string, unknown>;
  try {
    body = await readJson(context.request);
  } catch {
    return json({ ok: false, error: "invalid_json", message: "请求格式无效" }, 400);
  }

  const code = normalizeCode(body.code);
  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!code && !id) return json({ ok: false, error: "missing_target", message: "请提供 CDK 或记录 id" }, 400);

  const result = code
    ? await context.env.CDK_DB.prepare("UPDATE cdks SET revoked_at = ?1 WHERE code_hash = ?2 AND revoked_at IS NULL").bind(nowIso(), await hashCode(code)).run()
    : await context.env.CDK_DB.prepare("UPDATE cdks SET revoked_at = ?1 WHERE id = ?2 AND revoked_at IS NULL").bind(nowIso(), id).run();

  if (!result.success || changesOf(result) !== 1) {
    return json({ ok: false, error: "not_found_or_revoked", message: "CDK 不存在或已经撤销" }, 404);
  }
  return json({ ok: true, message: "CDK 已撤销" });
};

export const onRequest = (context: CdkContext) => {
  if (context.request.method === "OPTIONS") return new Response(null, { status: 204 });
  return json({ ok: false, error: "method_not_allowed", message: "仅支持 POST" }, 405, { allow: "POST" });
};
