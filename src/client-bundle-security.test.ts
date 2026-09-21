// @vitest-environment node

import { build } from "vite";
import { describe, expect, it } from "vitest";

describe("client bundle secret boundary", () => {
  it("does not bundle server-only relay configuration", async () => {
    const result = await build({
      configFile: "vite.config.ts",
      logLevel: "silent",
      build: { write: false },
    });
    const outputs = (Array.isArray(result) ? result : [result]) as Array<{
      output: Array<{ type: "chunk"; code: string } | { type: "asset"; source: string | Uint8Array }>;
    }>;
    const bundleText = outputs.flatMap(({ output }) => output.map((item) => (
      item.type === "chunk" ? item.code : String(item.source)
    ))).join("\n");

    expect(bundleText).not.toContain("CHATGPT_RELAY_SECRET");
    expect(bundleText).not.toContain("CHATGPT_RELAY_URL");
    expect(bundleText).not.toContain("test-relay-secret-never-ship");
    expect(bundleText).not.toContain("/backend-api/payments/checkout");
  }, 30_000);
});
