import { afterEach, describe, expect, it, vi } from "vitest";
import { onRequestPost } from "../functions/api/checkout/generate";
import { createActivationToken } from "../functions/api/cdk/_shared";

afterEach(() => vi.unstubAllGlobals());

describe("server-side checkout endpoint", () => {
  it("forwards a validated checkout request and returns only the hosted URL", async () => {
    const secret = "test-session-secret";
    const activationToken = await createActivationToken("cdk-record-id", secret);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      url: "https://checkout.stripe.com/c/pay/cs_test_123",
      checkout_session_id: "cs_test_123",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequestPost({
      env: { CDK_SESSION_SECRET: secret },
      request: new Request("https://tool.example/api/checkout/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          activationToken,
          coupon: "SAVE20",
          country: "sg",
          currency: "sgd",
          accessToken: JSON.stringify({ user: { email: "private@example.com" }, accessToken: "session-token" }),
        }),
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      url: "https://checkout.stripe.com/c/pay/cs_test_123",
      country: "SG",
      currency: "SGD",
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({ authorization: "Bearer session-token" });
    expect(String(init.body)).toContain('"country":"SG"');
    expect(String(init.body)).not.toContain("private@example.com");
  });

  it("rejects an invalid activation token before contacting ChatGPT", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await onRequestPost({
      env: { CDK_SESSION_SECRET: "test-session-secret" },
      request: new Request("https://tool.example/api/checkout/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ activationToken: "not-a-token", coupon: "SAVE20", country: "US", currency: "USD", accessToken: "token" }),
      }),
    });

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
