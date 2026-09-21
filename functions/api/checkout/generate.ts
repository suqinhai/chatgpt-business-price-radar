import {
  json,
  methodNotAllowed,
  readJson,
  verifyActivationToken,
  type CdkContext,
} from "../cdk/_shared";

const CHATGPT_CHECKOUT_URL = "https://chatgpt.com/backend-api/payments/checkout";
const MAX_BODY_BYTES = 64 * 1024;
const SUPPORTED_CURRENCIES = new Set([
  "USD", "AUD", "CAD", "GBP", "EUR", "CLP", "JPY", "INR", "IDR", "PKR", "THB", "MYR", "TWD",
  "VND", "PHP", "NGN", "ZAR", "KZT", "TZS", "EGP", "BRL", "SEK", "CZK", "PLN", "DKK", "NOK",
  "KRW", "COP", "MXN", "PEN", "HUF", "QAR", "RON", "ILS", "AED", "SGD", "NZD", "CHF", "SAR",
]);

type CheckoutPayload = {
  plan_name: "chatgptteamplan";
  team_plan_data: {
    workspace_name: string;
    price_interval: "month";
    seat_quantity: 2;
    existing_workspace_id?: string;
  };
  billing_details: { country: string; currency: string };
  cancel_url: string;
  promo_code: string;
  checkout_ui_mode: "hosted";
};

function stringValue(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const result = value.trim();
  if (!result || result.length > maxLength || /[\u0000-\u001f\u007f]/.test(result)) return null;
  return result;
}

function extractAccessToken(value: unknown, depth = 0): string | null {
  if (depth > 4 || value == null) return null;
  if (typeof value === "string") {
    const token = value.trim().replace(/^Bearer\s+/i, "").replace(/\s+/g, "");
    return token && token.length <= 16 * 1024 ? token : null;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    if (Array.isArray(value)) {
      for (const child of value) {
        const token = extractAccessToken(child, depth + 1);
        if (token) return token;
      }
    }
    return null;
  }
  for (const [key, child] of Object.entries(value)) {
    if ((key === "accessToken" || key === "access_token") && typeof child === "string") {
      const token = extractAccessToken(child, depth + 1);
      if (token) return token;
    }
  }
  for (const child of Object.values(value)) {
    const token = extractAccessToken(child, depth + 1);
    if (token) return token;
  }
  return null;
}

function readToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;
  if (!raw.startsWith("{") && !raw.startsWith("[") && !raw.startsWith('"')) {
    return extractAccessToken(raw);
  }
  try {
    return extractAccessToken(JSON.parse(raw));
  } catch {
    return null;
  }
}

function normalizeCoupon(value: unknown): string | null {
  const raw = stringValue(value, 512);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const coupon = url.searchParams.get("promoCode") || url.searchParams.get("promo_code");
    if (coupon) return stringValue(coupon, 128);
  } catch {
    // A plain promo code is the normal input; it is not required to be a URL.
  }
  return raw.length <= 128 ? raw : null;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function upstreamMessage(status: number): { status: number; error: string; message: string } {
  if (status === 401 || status === 403) {
    return { status: 401, error: "chatgpt_auth_failed", message: "ChatGPT 凭证无效或已过期，请重新获取 Access Token" };
  }
  if (status === 429) {
    return { status: 429, error: "chatgpt_rate_limited", message: "ChatGPT 暂时限制了请求，请稍后重试" };
  }
  if (status >= 400 && status < 500) {
    return { status: 400, error: "checkout_rejected", message: "ChatGPT 拒绝了结账请求，请核对优惠码、账户和地区" };
  }
  return { status: 502, error: "chatgpt_unavailable", message: "ChatGPT 结账服务暂时不可用，请稍后重试" };
}

export const onRequestPost = async (context: CdkContext): Promise<Response> => {
  const secret = context.env.CDK_SESSION_SECRET?.trim();
  if (!secret) {
    return json({ ok: false, error: "checkout_service_unconfigured", message: "支付链接服务尚未完成配置，请联系管理员" }, 503);
  }

  let body: Record<string, unknown>;
  try {
    const contentLength = Number(context.request.headers.get("content-length") || 0);
    if (contentLength > MAX_BODY_BYTES) throw new Error("request_too_large");
    body = await readJson(context.request);
  } catch {
    return json({ ok: false, error: "invalid_json", message: "请求格式无效" }, 400);
  }

  const activationToken = stringValue(body.activationToken, 2048);
  if (!activationToken || !(await verifyActivationToken(activationToken, secret))) {
    return json({ ok: false, error: "activation_required", message: "请先激活有效的 CDK" }, 403);
  }

  const coupon = normalizeCoupon(body.coupon);
  const country = stringValue(body.country, 2)?.toUpperCase();
  const currency = stringValue(body.currency, 3)?.toUpperCase();
  const accessToken = readToken(body.accessToken);
  const workspaceId = stringValue(body.existingWorkspaceId, 64) || "";

  if (!coupon) return json({ ok: false, error: "invalid_coupon", message: "请输入有效的优惠码或优惠链接" }, 400);
  if (!country || !/^[A-Z]{2}$/.test(country)) return json({ ok: false, error: "invalid_country", message: "国家代码无效" }, 400);
  if (!currency || !SUPPORTED_CURRENCIES.has(currency)) return json({ ok: false, error: "invalid_currency", message: "货币代码暂不支持" }, 400);
  if (!accessToken) return json({ ok: false, error: "invalid_access_token", message: "未能从输入内容中提取 Access Token" }, 400);
  if (workspaceId && !isUuid(workspaceId)) return json({ ok: false, error: "invalid_workspace_id", message: "已有空间 ID 无效" }, 400);

  const payload: CheckoutPayload = {
    plan_name: "chatgptteamplan",
    team_plan_data: {
      workspace_name: "xxx",
      price_interval: "month",
      seat_quantity: 2,
      ...(workspaceId ? { existing_workspace_id: workspaceId } : {}),
    },
    billing_details: { country, currency },
    cancel_url: `https://chatgpt.com/?promoCode=${encodeURIComponent(coupon)}`,
    promo_code: coupon,
    checkout_ui_mode: "hosted",
  };

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), 25_000);
  let response: Response;
  try {
    response = await fetch(CHATGPT_CHECKOUT_URL, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        origin: "https://chatgpt.com",
        referer: "https://chatgpt.com/",
      },
      body: JSON.stringify(payload),
      signal: abortController.signal,
    });
  } catch {
    clearTimeout(timeout);
    return json({ ok: false, error: "chatgpt_unavailable", message: "无法连接 ChatGPT 结账服务，请稍后重试" }, 502);
  }
  clearTimeout(timeout);

  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const failure = upstreamMessage(response.status);
    return json({ ok: false, error: failure.error, message: failure.message }, failure.status);
  }

  const rawUrl = [data.url, data.stripe_hosted_url, data.checkout_url].find((value): value is string => typeof value === "string");
  if (!rawUrl) return json({ ok: false, error: "checkout_url_missing", message: "ChatGPT 未返回支付链接" }, 502);
  let checkoutUrl: URL;
  try {
    checkoutUrl = new URL(rawUrl);
  } catch {
    return json({ ok: false, error: "checkout_url_invalid", message: "ChatGPT 返回了无效的支付链接" }, 502);
  }
  if (checkoutUrl.protocol !== "https:") {
    return json({ ok: false, error: "checkout_url_invalid", message: "ChatGPT 返回了不安全的支付链接" }, 502);
  }

  return json({
    ok: true,
    url: checkoutUrl.href,
    checkoutSessionId: typeof data.checkout_session_id === "string" ? data.checkout_session_id : null,
    country,
    currency,
    network: "direct",
    note: "服务端按所选地区提交账单参数；Cloudflare Pages 无法把出口 IP 切换为第三方 IP 池中的地址。",
  });
};

export const onRequestOptions = () => new Response(null, {
  status: 204,
  headers: { "cache-control": "no-store" },
});

export const onRequest = (context: CdkContext) => {
  if (context.request.method === "OPTIONS") return onRequestOptions();
  return methodNotAllowed();
};
