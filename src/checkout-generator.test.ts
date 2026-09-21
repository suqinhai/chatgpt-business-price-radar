import { describe, expect, it } from "vitest";
import {
  CHECKOUT_CURRENCIES,
  DEFAULT_CHECKOUT_COUNTRY,
  DEFAULT_CHECKOUT_CURRENCY,
  extractAccessToken,
  isSupportedCheckoutCurrency,
  normalizeIsoInput,
  validateCheckoutInput,
} from "./checkout-generator";

describe("checkout form validation", () => {
  it("keeps the requested defaults and exact supported currency list", () => {
    expect(DEFAULT_CHECKOUT_COUNTRY).toBe("US");
    expect(DEFAULT_CHECKOUT_CURRENCY).toBe("EGP");
    expect(CHECKOUT_CURRENCIES).toHaveLength(39);
    expect(isSupportedCheckoutCurrency("egp")).toBe(true);
    expect(isSupportedCheckoutCurrency("TRY")).toBe(false);
  });

  it("normalizes ISO input and validates every field", () => {
    expect(normalizeIsoInput(" u-s1 ", 2)).toBe("US");
    expect(validateCheckoutInput({
      coupon: "",
      country: "USA",
      currency: "TRY",
      existingWorkspaceId: "",
      autoOpen: false,
      accessTokenMode: "auto",
      accessToken: "",
    }))
      .toEqual({
        coupon: "请输入优惠码",
        country: "请输入 2 位英文字母国家代码",
        currency: "请选择支持的货币代码",
      });
  });

  it("accepts a raw access token or extracts one from complete session JSON", () => {
    expect(extractAccessToken("  eyJraw.token  ")).toBe("eyJraw.token");
    expect(extractAccessToken(JSON.stringify({ user: { name: "Kai" }, accessToken: "eyJsession.token" })))
      .toBe("eyJsession.token");
    expect(extractAccessToken(JSON.stringify({ session: { access_token: "nested-token" } })))
      .toBe("nested-token");
    expect(extractAccessToken('{"user":true}')).toBeNull();
    expect(extractAccessToken("{")).toBeNull();
  });

  it("requires an extractable token in manual mode", () => {
    expect(validateCheckoutInput({
      coupon: "SAVE20",
      country: "US",
      currency: "EGP",
      existingWorkspaceId: "",
      autoOpen: false,
      accessTokenMode: "manual",
      accessToken: '{"user":true}',
    })).toEqual({ accessToken: "未能从输入内容中提取 accessToken" });
  });

});
