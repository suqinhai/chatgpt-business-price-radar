import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CdkAdmin from "./CdkAdmin";

const response = (body: unknown, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => body,
});

const record = {
  id: "record-1",
  code_prefix: "CDK-ABCD",
  created_at: "2026-09-20T08:00:00.000Z",
  expires_at: null,
  max_uses: 1,
  used_count: 0,
  last_used_at: null,
  revoked_at: null,
};

describe("CDK admin page", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("authenticates with an in-memory admin token and loads records", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(response({ ok: true, cdks: [record] }));
    vi.stubGlobal("fetch", fetchMock);

    render(<CdkAdmin onBack={() => undefined} />);
    await user.type(screen.getByLabelText("管理员密钥"), "private-admin-token");
    await user.click(screen.getByRole("button", { name: "验证并连接" }));

    expect(await screen.findByText("CDK-ABCD-••••-••••")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/cdk/admin/list?limit=20&offset=0", expect.objectContaining({
      headers: expect.objectContaining({ authorization: "Bearer private-admin-token" }),
    }));
    expect(Object.values(window.localStorage)).not.toContain("private-admin-token");
    expect(window.location.href).not.toContain("private-admin-token");
  });

  it("issues a batch and exposes the plaintext codes once", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ ok: true, cdks: [] }))
      .mockResolvedValueOnce(response({ ok: true, codes: ["CDK-ABCD-EFGH-JKLM", "CDK-WXYZ-2345-6789"] }))
      .mockResolvedValueOnce(response({ ok: true, cdks: [record] }));
    vi.stubGlobal("fetch", fetchMock);

    render(<CdkAdmin onBack={() => undefined} />);
    await user.type(screen.getByLabelText("管理员密钥"), "admin-token");
    await user.click(screen.getByRole("button", { name: "验证并连接" }));
    await user.click(screen.getByRole("button", { name: "生成 CDK" }));

    expect(await screen.findByText(/CDK-ABCD-EFGH-JKLM/)).toBeInTheDocument();
    expect(fetchMock.mock.calls[1][0]).toBe("/api/cdk/admin/issue");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ quantity: 10, maxUses: 1, expiresAt: null });

    await user.click(screen.getByRole("button", { name: "复制全部" }));
    expect(writeText).toHaveBeenCalledWith("CDK-ABCD-EFGH-JKLM\nCDK-WXYZ-2345-6789");

    await user.click(screen.getByRole("button", { name: "复制 CDK" }));
    expect(writeText).toHaveBeenLastCalledWith("CDK-ABCD-EFGH-JKLM");
  });

  it("paginates the CDK inventory", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ ok: true, cdks: [record], total: 21 }))
      .mockResolvedValueOnce(response({ ok: true, cdks: [{ ...record, id: "record-21" }], total: 21 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<CdkAdmin onBack={() => undefined} />);
    await user.type(screen.getByLabelText("管理员密钥"), "admin-token");
    await user.click(screen.getByRole("button", { name: "验证并连接" }));

    expect(await screen.findByText("第 1 / 2 页")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "下一页" }));

    expect(await screen.findByText("第 2 / 2 页")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith("/api/cdk/admin/list?limit=20&offset=20", expect.objectContaining({
      headers: expect.objectContaining({ authorization: "Bearer admin-token" }),
    }));
  });

  it("requires a second click before revoking a record", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ ok: true, cdks: [record] }))
      .mockResolvedValueOnce(response({ ok: true, message: "CDK 已撤销" }))
      .mockResolvedValueOnce(response({ ok: true, cdks: [{ ...record, revoked_at: "2026-09-20T09:00:00.000Z" }] }));
    vi.stubGlobal("fetch", fetchMock);

    render(<CdkAdmin onBack={() => undefined} />);
    await user.type(screen.getByLabelText("管理员密钥"), "admin-token");
    await user.click(screen.getByRole("button", { name: "验证并连接" }));
    await user.click(await screen.findByRole("button", { name: "撤销" }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "确认撤销" }));
    expect(await screen.findByText("已撤销")).toBeInTheDocument();
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ id: "record-1" });
  });
});
