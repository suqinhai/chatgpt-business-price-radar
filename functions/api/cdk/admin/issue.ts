import {
  databaseUnavailable,
  generateCode,
  hashCode,
  json,
  nowIso,
  readJson,
  requireAdmin,
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

  const quantity = Number.isInteger(body.quantity) ? Number(body.quantity) : 1;
  const maxUses = Number.isInteger(body.maxUses) ? Number(body.maxUses) : 1;
  const expiresAt = body.expiresAt == null || body.expiresAt === "" ? null : String(body.expiresAt);

  if (quantity < 1 || quantity > 100 || maxUses < 1 || maxUses > 100) {
    return json({ ok: false, error: "invalid_limits", message: "quantity 和 maxUses 必须在 1 到 100 之间" }, 400);
  }
  if (expiresAt && (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now())) {
    return json({ ok: false, error: "invalid_expiry", message: "expiresAt 必须是未来的 ISO 日期" }, 400);
  }

  const createdAt = nowIso();
  const codes = Array.from({ length: quantity }, () => generateCode());
  const statements = await Promise.all(codes.map(async (code) => context.env.CDK_DB!.prepare(
    "INSERT INTO cdks (id, code_hash, code_prefix, created_at, expires_at, max_uses, used_count) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)",
  ).bind(
    crypto.randomUUID(),
    await hashCode(code),
    code.slice(0, 8),
    createdAt,
    expiresAt,
    maxUses,
  )));

  const results = await context.env.CDK_DB.batch(statements);
  if (results.some((result) => !result.success)) {
    return json({ ok: false, error: "issue_failed", message: "生成 CDK 失败，数据库事务已回滚" }, 500);
  }

  return json({ ok: true, count: codes.length, maxUses, expiresAt, codes });
};

export const onRequest = (context: CdkContext) => {
  if (context.request.method === "OPTIONS") return new Response(null, { status: 204 });
  return json({ ok: false, error: "method_not_allowed", message: "仅支持 POST" }, 405, { allow: "POST" });
};
