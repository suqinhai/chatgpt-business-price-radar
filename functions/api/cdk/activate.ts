import {
  changesOf,
  databaseUnavailable,
  hashCode,
  isExpired,
  json,
  methodNotAllowed,
  normalizeCode,
  nowIso,
  readJson,
  createActivationToken,
  type CdkContext,
} from "./_shared";

export const onRequestPost = async (context: CdkContext): Promise<Response> => {
  if (!context.env.CDK_DB) return databaseUnavailable();
  const sessionSecret = context.env.CDK_SESSION_SECRET?.trim();
  if (!sessionSecret) {
    return json({
      ok: false,
      error: "checkout_service_unconfigured",
      message: "支付链接服务尚未完成配置，请联系管理员",
    }, 503);
  }

  let body: Record<string, unknown>;
  try {
    body = await readJson(context.request);
  } catch {
    return json({ ok: false, error: "invalid_json", message: "请求格式无效" }, 400);
  }

  const code = normalizeCode(body.code);
  if (!code) {
    return json({ ok: false, error: "invalid_code_format", message: "CDK 格式应为 CDK-XXXX-XXXX-XXXX" }, 400);
  }

  const record = await context.env.CDK_DB.prepare(
    "SELECT id, code_prefix, created_at, expires_at, max_uses, used_count, last_used_at, revoked_at FROM cdks WHERE code_hash = ?1",
  ).bind(await hashCode(code)).first<{
    id: string;
    expires_at: string | null;
    max_uses: number;
    used_count: number;
    revoked_at: string | null;
  }>();

  // Do not disclose whether a code exists, has expired, or was revoked.
  if (!record || record.revoked_at || isExpired(record.expires_at) || record.used_count >= record.max_uses) {
    return json({ ok: false, error: "invalid_or_used_code", message: "CDK 无效、已过期或已使用" }, 400);
  }

  const usedAt = nowIso();
  const result = await context.env.CDK_DB.prepare(
    "UPDATE cdks SET used_count = used_count + 1, last_used_at = ?1 WHERE id = ?2 AND revoked_at IS NULL AND used_count < max_uses",
  ).bind(usedAt, record.id).run();

  // The conditional update makes concurrent activation attempts safe.
  if (!result.success || changesOf(result) !== 1) {
    return json({ ok: false, error: "invalid_or_used_code", message: "CDK 无效、已过期或已使用" }, 400);
  }

  return json({
    ok: true,
    message: "CDK 激活成功",
    expiresAt: record.expires_at,
    remainingUses: Math.max(0, record.max_uses - record.used_count - 1),
    activationToken: await createActivationToken(record.id, sessionSecret),
  });
};

export const onRequestOptions = () => new Response(null, {
  status: 204,
  headers: { "cache-control": "no-store" },
});

export const onRequest = () => methodNotAllowed();
