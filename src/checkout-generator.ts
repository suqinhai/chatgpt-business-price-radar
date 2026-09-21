export const CHECKOUT_CURRENCIES = [
  ["USD", "美元"],
  ["AUD", "澳大利亚元（澳元）"],
  ["CAD", "加拿大元（加元）"],
  ["GBP", "英镑"],
  ["EUR", "欧元"],
  ["CLP", "智利比索"],
  ["JPY", "日元"],
  ["INR", "印度卢比"],
  ["IDR", "印尼盾（印度尼西亚卢比）"],
  ["PKR", "巴基斯坦卢比"],
  ["THB", "泰铢"],
  ["MYR", "马来西亚林吉特"],
  ["TWD", "新台币"],
  ["VND", "越南盾"],
  ["PHP", "菲律宾比索"],
  ["NGN", "尼日利亚奈拉"],
  ["ZAR", "南非兰特"],
  ["KZT", "哈萨克斯坦坚戈"],
  ["TZS", "坦桑尼亚先令"],
  ["EGP", "埃及镑"],
  ["BRL", "巴西雷亚尔"],
  ["SEK", "瑞典克朗"],
  ["CZK", "捷克克朗"],
  ["PLN", "波兰兹罗提"],
  ["DKK", "丹麦克朗"],
  ["NOK", "挪威克朗"],
  ["KRW", "韩元（韩国圆）"],
  ["COP", "哥伦比亚比索"],
  ["MXN", "墨西哥比索"],
  ["PEN", "秘鲁索尔"],
  ["HUF", "匈牙利福林"],
  ["QAR", "卡塔尔里亚尔"],
  ["RON", "罗马尼亚列伊"],
  ["ILS", "以色列新谢克尔"],
  ["AED", "阿联酋迪拉姆"],
  ["SGD", "新加坡元（新元）"],
  ["NZD", "新西兰元（纽元）"],
  ["CHF", "瑞士法郎"],
  ["SAR", "沙特里亚尔"],
] as const;

export const DEFAULT_CHECKOUT_COUNTRY = "US";
export const DEFAULT_CHECKOUT_CURRENCY = "EGP";
export const DEFAULT_ACCESS_TOKEN_MODE = "auto" as const;

const currencyCodes = new Set<string>(CHECKOUT_CURRENCIES.map(([code]) => code));

export type AccessTokenMode = "auto" | "manual";

export type CheckoutScriptInput = {
  coupon: string;
  country: string;
  currency: string;
  existingWorkspaceId: string;
  autoOpen: boolean;
  accessTokenMode: AccessTokenMode;
  accessToken: string;
};

export type CheckoutInputField = "coupon" | "country" | "currency" | "existingWorkspaceId" | "accessToken";
export type CheckoutValidationErrors = Partial<Record<CheckoutInputField, string>>;

export function normalizeIsoInput(value: string, maxLength: number): string {
  return value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, maxLength);
}

export function isSupportedCheckoutCurrency(value: string): boolean {
  return currencyCodes.has(value.toUpperCase());
}

function findAccessToken(value: unknown, depth = 0): string | null {
  if (depth > 4 || value == null || typeof value !== "object") return null;
  for (const [key, child] of Object.entries(value)) {
    if ((key === "accessToken" || key === "access_token") && typeof child === "string" && child.trim()) {
      return child.trim();
    }
  }
  for (const child of Object.values(value)) {
    const token = findAccessToken(child, depth + 1);
    if (token) return token;
  }
  return null;
}

export function extractAccessToken(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[") && !trimmed.startsWith('"')) {
    return trimmed.replace(/^Bearer\s+/i, "").replace(/\s+/g, "") || null;
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    const token = typeof parsed === "string" ? parsed : findAccessToken(parsed);
    return token?.replace(/^Bearer\s+/i, "").replace(/\s+/g, "") || null;
  } catch {
    return null;
  }
}

export function validateCheckoutInput(input: CheckoutScriptInput): CheckoutValidationErrors {
  const errors: CheckoutValidationErrors = {};
  if (!input.coupon.trim()) errors.coupon = "请输入优惠码";
  if (!/^[A-Z]{2}$/.test(input.country)) errors.country = "请输入 2 位英文字母国家代码";
  if (!isSupportedCheckoutCurrency(input.currency)) errors.currency = "请选择支持的货币代码";
  if (input.existingWorkspaceId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.existingWorkspaceId)) {
    errors.existingWorkspaceId = "请输入有效 UUID，或留空新建空间";
  }
  if (input.accessTokenMode === "manual" && !input.accessToken.trim()) {
    errors.accessToken = "请输入 Access Token 或 Session JSON";
  } else if (input.accessTokenMode === "manual" && !extractAccessToken(input.accessToken)) {
    errors.accessToken = "未能从输入内容中提取 accessToken";
  }
  return errors;
}
