export type CdkRecord = {
  id: string;
  code_prefix: string;
  created_at: string;
  expires_at: string | null;
  max_uses: number;
  used_count: number;
  last_used_at: string | null;
  revoked_at: string | null;
};

export type D1Statement = {
  bind(...values: unknown[]): D1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: boolean; meta?: { changes?: number } }>;
  run(): Promise<{ success: boolean; meta?: { changes?: number } }>;
};

export type CdkDatabase = {
  prepare(sql: string): D1Statement;
  batch(statements: D1Statement[]): Promise<Array<{ success: boolean; meta?: { changes?: number } }>>;
};

export type CdkEnv = {
  CDK_DB?: CdkDatabase;
  CDK_ADMIN_TOKEN?: string;
  /** Secret used to mint short-lived, in-memory checkout activation grants. */
  CDK_SESSION_SECRET?: string;
};

export type CdkContext = {
  request: Request;
  env: CdkEnv;
};

export const json = (body: unknown, status = 200, extraHeaders: HeadersInit = {}) => new Response(
  JSON.stringify(body),
  {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  },
);

export const methodNotAllowed = () => json({ ok: false, error: "method_not_allowed" }, 405, { allow: "POST" });

export const databaseUnavailable = () => json(
  { ok: false, error: "cdk_database_unavailable", message: "CDK 服务尚未配置数据库" },
  503,
);

export function normalizeCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase().replace(/\s+/g, "");
  return /^CDK-[A-Z0-9]{4}(?:-[A-Z0-9]{4}){2}$/.test(code) ? code : null;
}

export async function hashCode(code: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function generateCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const value = [...bytes].map((byte) => alphabet[byte % alphabet.length]).join("");
  return `CDK-${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8, 12)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function isExpired(expiresAt: string | null, now = Date.now()): boolean {
  return Boolean(expiresAt && (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= now));
}

export function changesOf(result: { meta?: { changes?: number } }): number {
  return result.meta?.changes ?? 0;
}

export function getBearerToken(request: Request): string {
  const header = request.headers.get("authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

export function safeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string): Uint8Array | null {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(normalized);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

async function signActivationPayload(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return encodeBase64Url(new Uint8Array(signature));
}

/** Create a short-lived grant without putting the original CDK or token in the browser URL. */
export async function createActivationToken(recordId: string, secret: string, ttlSeconds = 15 * 60): Promise<string> {
  const payload = encodeBase64Url(new TextEncoder().encode(JSON.stringify({
    sub: recordId,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  })));
  return `${payload}.${await signActivationPayload(payload, secret)}`;
}

/** Verify a grant minted by createActivationToken. The token is intentionally stateless and short-lived. */
export async function verifyActivationToken(token: string, secret: string): Promise<boolean> {
  if (!token || !secret) return false;
  const [payloadPart, signaturePart] = token.split(".");
  if (!payloadPart || !signaturePart || token.length > 2048) return false;
  const expected = await signActivationPayload(payloadPart, secret);
  if (!safeEqual(expected, signaturePart)) return false;
  const bytes = decodeBase64Url(payloadPart);
  if (!bytes) return false;
  try {
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as { sub?: unknown; exp?: unknown };
    return typeof payload.sub === "string"
      && payload.sub.length > 0
      && typeof payload.exp === "number"
      && Number.isFinite(payload.exp)
      && payload.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export function requireAdmin(context: CdkContext): Response | null {
  const expected = context.env.CDK_ADMIN_TOKEN?.trim();
  if (!expected || !safeEqual(getBearerToken(context.request), expected)) {
    return json({ ok: false, error: "admin_unauthorized", message: "管理员凭据无效" }, 401);
  }
  return null;
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 64 * 1024) throw new Error("request_too_large");
  const payload = await request.json() as unknown;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("invalid_json");
  return payload as Record<string, unknown>;
}
