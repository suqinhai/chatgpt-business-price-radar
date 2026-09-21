import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { onRequestPost } from "../functions/api/checkout/generate";
import {
  createSignedRelayRequest,
  postRelayCheckout,
  type CheckoutPayload,
  type RelayCheckoutBody,
} from "../functions/api/checkout/_relay";
import { createActivationToken, type CdkEnv } from "../functions/api/cdk/_shared";

const SESSION_SECRET = "test-session-secret";
const RELAY_SECRET = "test-relay-secret-never-ship";
const RELAY_URL = "https://relay.example.com/internal/chatgpt/checkout";
const ACCESS_TOKEN = "private-access-token-never-return";

const payload: CheckoutPayload = {
  plan_name: "chatgptteamplan",
  team_plan_data: {
    workspace_name: "xxx",
    price_interval: "month",
    seat_quantity: 2,
  },
  billing_details: { country: "US", currency: "USD" },
  cancel_url: "https://chatgpt.com/?promoCode=SAVE20",
  promo_code: "SAVE20",
  checkout_ui_mode: "hosted",
};

const relayBody: RelayCheckoutBody = {
  country: "US",
  accessToken: ACCESS_TOKEN,
  payload,
};

async function invokeCheckout(
  envOverrides: Partial<CdkEnv> = {},
  bodyOverrides: Record<string, unknown> = {},
): Promise<Response> {
  const activationToken = await createActivationToken("cdk-record-id", SESSION_SECRET);
  return onRequestPost({
    env: { CDK_SESSION_SECRET: SESSION_SECRET, ...envOverrides },
    request: new Request("https://tool.example/api/checkout/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        activationToken,
        coupon: "SAVE20",
        country: "us",
        currency: "usd",
        accessToken: ACCESS_TOKEN,
        ...bodyOverrides,
      }),
    }),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("checkout relay signing", () => {
  it("signs timestamp, nonce, and the exact serialized body with HMAC-SHA256", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_797_777_123_456);
    const signed = createSignedRelayRequest(relayBody, RELAY_SECRET);
    const timestamp = signed.headers["x-relay-timestamp"];
    const nonce = signed.headers["x-relay-nonce"];
    const expected = createHmac("sha256", RELAY_SECRET)
      .update(`${timestamp}.${nonce}.${signed.rawBody}`)
      .digest("hex");

    expect(timestamp).toBe("1797777123456");
    expect(nonce).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(signed.headers["x-relay-signature"]).toBe(expected);
  });

  it("sends the same rawBody that was signed without serializing it again", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
    await postRelayCheckout(
      RELAY_URL,
      relayBody,
      RELAY_SECRET,
      new AbortController().signal,
      fetchMock as typeof fetch,
    );

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    const rawBody = String(init.body);
    const expected = createHmac("sha256", RELAY_SECRET)
      .update(`${headers["x-relay-timestamp"]}.${headers["x-relay-nonce"]}.${rawBody}`)
      .digest("hex");

    expect(url).toBe(RELAY_URL);
    expect(rawBody).toBe(JSON.stringify(relayBody));
    expect(headers["x-relay-signature"]).toBe(expected);
  });

  it("generates a new nonce for every request", () => {
    const first = createSignedRelayRequest(relayBody, RELAY_SECRET);
    const second = createSignedRelayRequest(relayBody, RELAY_SECRET);
    expect(first.headers["x-relay-nonce"]).not.toBe(second.headers["x-relay-nonce"]);
  });

  it("does not retry or follow redirects for a checkout POST", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
    await postRelayCheckout(
      RELAY_URL,
      relayBody,
      RELAY_SECRET,
      new AbortController().signal,
      fetchMock as typeof fetch,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST", redirect: "manual" });
  });
});

describe("server-side checkout endpoint", () => {
  it("uses the country relay and preserves the existing checkout payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      url: "https://checkout.stripe.com/c/pay/cs_test_relay",
      checkoutSessionId: "cs_test_relay",
      country: "US",
      network: "country-relay",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await invokeCheckout({
      CHATGPT_RELAY_URL: RELAY_URL,
      CHATGPT_RELAY_SECRET: RELAY_SECRET,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      url: "https://checkout.stripe.com/c/pay/cs_test_relay",
      checkoutSessionId: "cs_test_relay",
      country: "US",
      currency: "USD",
      network: "country-relay",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const sent = JSON.parse(String(init.body)) as RelayCheckoutBody;
    expect(url).toBe(RELAY_URL);
    expect(sent).toEqual({ country: "US", accessToken: ACCESS_TOKEN, payload });
    expect(sent.country).toBe(sent.payload.billing_details.country);
    expect(sent).not.toHaveProperty("url");
  });

  it("keeps the original direct behavior when both relay variables are absent", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      url: "https://checkout.stripe.com/c/pay/cs_test_direct",
      checkout_session_id: "cs_test_direct",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await invokeCheckout();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      checkoutSessionId: "cs_test_direct",
      network: "direct",
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://chatgpt.com/backend-api/payments/checkout");
    expect(init.headers).toMatchObject({ authorization: `Bearer ${ACCESS_TOKEN}` });
    expect(String(init.body)).toBe(JSON.stringify(payload));
  });

  it.each([
    [{ CHATGPT_RELAY_URL: RELAY_URL }, "secret is missing"],
    [{ CHATGPT_RELAY_SECRET: RELAY_SECRET }, "URL is missing"],
  ] as const)("fails closed when only one relay variable is configured: %s", async (env, _caseName) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await invokeCheckout(env);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: "relay_configuration_invalid" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["request_expired", 401],
    ["invalid_signature", 401],
    ["chatgpt_auth_failed", 401],
    ["replayed_nonce", 409],
    ["rate_limited", 429],
    ["country_proxy_unavailable", 503],
    ["proxy_connect_failed", 502],
    ["upstream_unavailable", 502],
    ["checkout_rejected", 400],
    ["invalid_payload", 400],
  ])("maps relay error %s to a safe %i response", async (error, expectedStatus) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: false,
      error,
      message: `unsafe upstream details ${ACCESS_TOKEN} ${RELAY_SECRET}`,
      stack: "internal stack",
      proxyIp: "192.0.2.10",
    }), { status: expectedStatus }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await invokeCheckout({
      CHATGPT_RELAY_URL: RELAY_URL,
      CHATGPT_RELAY_SECRET: RELAY_SECRET,
    });
    const responseText = await response.text();

    expect(response.status).toBe(expectedStatus);
    expect(JSON.parse(responseText)).toMatchObject({ ok: false, error });
    expect(responseText).not.toContain(ACCESS_TOKEN);
    expect(responseText).not.toContain(RELAY_SECRET);
    expect(responseText).not.toContain("192.0.2.10");
    expect(responseText).not.toContain("internal stack");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid activation token before contacting either upstream", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await onRequestPost({
      env: {
        CDK_SESSION_SECRET: SESSION_SECRET,
        CHATGPT_RELAY_URL: RELAY_URL,
        CHATGPT_RELAY_SECRET: RELAY_SECRET,
      },
      request: new Request("https://tool.example/api/checkout/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          activationToken: "not-a-token",
          coupon: "SAVE20",
          country: "US",
          currency: "USD",
          accessToken: ACCESS_TOKEN,
        }),
      }),
    });

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
