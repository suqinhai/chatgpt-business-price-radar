import { describe, expect, it } from "vitest";
import { generateCode, hashCode, normalizeCode } from "../functions/api/cdk/_shared";

describe("CDK primitives", () => {
  it("generates codes in the customer-facing format", () => {
    const code = generateCode();
    expect(code).toMatch(/^CDK-[A-Z0-9]{4}(?:-[A-Z0-9]{4}){2}$/);
    expect(normalizeCode(code.toLowerCase())).toBe(code);
  });

  it("normalizes pasted codes but rejects malformed values", () => {
    expect(normalizeCode(" cdk-abcd-efgh-jklm ")).toBe("CDK-ABCD-EFGH-JKLM");
    expect(normalizeCode("CDK-ABCD-EFGH")).toBeNull();
    expect(normalizeCode("")).toBeNull();
  });

  it("hashes codes deterministically without returning the code", async () => {
    const hash = await hashCode("CDK-ABCD-EFGH-JKLM");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(await hashCode("CDK-ABCD-EFGH-JKLM")).toBe(hash);
    expect(hash).not.toContain("ABCD");
  });
});
