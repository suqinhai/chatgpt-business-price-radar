import { createHmac, randomBytes } from "node:crypto";

export type CheckoutPayload = {
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

export type RelayCheckoutBody = {
  country: string;
  accessToken: string;
  payload: CheckoutPayload;
};

export type SignedRelayRequest = {
  rawBody: string;
  headers: Record<string, string>;
};

/**
 * Serialize exactly once: the returned rawBody is both signed and sent.
 * This module is only imported by the Pages Function and is never part of the browser entry graph.
 */
export function createSignedRelayRequest(body: RelayCheckoutBody, secret: string): SignedRelayRequest {
  const rawBody = JSON.stringify(body);
  const timestamp = Date.now().toString();
  const nonce = randomBytes(24).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${nonce}.${rawBody}`)
    .digest("hex");

  return {
    rawBody,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-relay-timestamp": timestamp,
      "x-relay-nonce": nonce,
      "x-relay-signature": signature,
    },
  };
}

/** A checkout POST is deliberately sent once. There is no retry or redirect-following path here. */
export function postRelayCheckout(
  url: string,
  body: RelayCheckoutBody,
  secret: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const request = createSignedRelayRequest(body, secret);
  return fetcher(url, {
    method: "POST",
    headers: request.headers,
    body: request.rawBody,
    redirect: "manual",
    signal,
  });
}
