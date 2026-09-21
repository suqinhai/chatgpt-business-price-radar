import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sample from "../public/data/sample-prices.json";
import App from "./App";

describe("application routes", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    window.localStorage.clear();
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({ ok: true, json: async () => sample }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("uses the checkout generator as the only homepage", async () => {
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Business 长链生成" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "价格雷达" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "CDK 管理" })).not.toBeInTheDocument();
    expect(screen.queryByText("一眼看懂，全球月付差多少。")).not.toBeInTheDocument();
    expect(window.location.pathname).toBe("/");
  });

  it("serves the admin page only at /admin", async () => {
    window.history.replaceState({}, "", "/admin");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "CDK 管理台" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/admin");
  });

  it("canonicalizes the legacy admin query URL", async () => {
    window.history.replaceState({}, "", "/?view=admin");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "CDK 管理台" })).toBeInTheDocument();
    await waitFor(() => expect(window.location.pathname).toBe("/admin"));
    expect(window.location.search).toBe("");
  });

  it("hides legacy price and generator query routes behind the homepage", async () => {
    window.history.replaceState({}, "", "/?view=prices");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Business 长链生成" })).toBeInTheDocument();
    await waitFor(() => expect(window.location.pathname).toBe("/"));
    expect(window.location.search).toBe("");
  });

  it("responds to direct generator URL navigation with region defaults", async () => {
    render(<App />);

    expect(screen.getByLabelText(/国家 ISO 缩写/)).toHaveValue("US");
    expect(screen.getByLabelText(/货币 ISO 缩写/)).toHaveValue("EGP");

    window.history.pushState({}, "", "/?view=generator&country=JP&currency=JPY");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await waitFor(() => expect(screen.getByLabelText(/国家 ISO 缩写/)).toHaveValue("JP"));
    expect(screen.getByLabelText(/货币 ISO 缩写/)).toHaveValue("JPY");
    await waitFor(() => expect(window.location.pathname).toBe("/"));
  });

  it("blocks an empty coupon, then copies valid generated code without storing the coupon", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(<App />);

    const copyButton = screen.getByRole("button", { name: /复制代码/ });
    expect(copyButton).toHaveAttribute("aria-disabled", "true");
    await user.click(copyButton);
    const coupon = screen.getByPlaceholderText("例如：XXXXXXXXXXXX");
    expect(coupon).toHaveFocus();
    expect(screen.getByText("请输入优惠码")).toBeInTheDocument();

    await user.type(coupon, "SAVE20");
    expect(copyButton).toHaveAttribute("aria-disabled", "false");
    await user.click(screen.getByRole("button", { name: /复制代码/ }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('const COUPON = "SAVE20"'));
    expect(window.location.search).not.toContain("SAVE20");
    expect(window.localStorage.getItem("coupon")).toBeNull();
  });

  it("downloads valid code and resets to US and EGP", async () => {
    const user = userEvent.setup();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const createObjectURL = vi.fn(() => "blob:checkout-script");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
    render(<App />);

    await user.type(screen.getByPlaceholderText("例如：XXXXXXXXXXXX"), "SAVE20");
    await user.clear(screen.getByLabelText(/国家 ISO 缩写/));
    await user.type(screen.getByLabelText(/国家 ISO 缩写/), "sg");
    await user.click(screen.getByRole("button", { name: /下载/ }));
    expect(createObjectURL).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:checkout-script");

    await user.click(screen.getByRole("button", { name: /恢复默认值/ }));
    expect(screen.getByLabelText(/国家 ISO 缩写/)).toHaveValue("US");
    expect(screen.getByLabelText(/货币 ISO 缩写/)).toHaveValue("EGP");
  });

  it("accepts complete session JSON in manual token mode without storing it", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(<App />);

    expect(screen.getByRole("radio", { name: /自动获取/ })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: /手动粘贴/ }));
    const tokenInput = screen.getByPlaceholderText("粘贴 accessToken 或完整 Session JSON");
    const sessionJson = JSON.stringify({
      user: { email: "private@example.com" },
      accessToken: "session-access-token",
    });
    fireEvent.change(tokenInput, { target: { value: sessionJson } });
    await user.type(screen.getByPlaceholderText("例如：XXXXXXXXXXXX"), "SAVE20");
    await user.click(screen.getByRole("button", { name: /复制代码/ }));

    const copiedScript = writeText.mock.calls[0][0] as string;
    expect(copiedScript).toContain('const accessToken = "session-access-token"');
    expect(copiedScript).not.toContain("private@example.com");
    expect(copiedScript).not.toContain("/api/auth/session");
    expect(window.location.search).not.toContain("session-access-token");
    expect(Object.values(window.localStorage)).not.toContain("session-access-token");

    await user.click(screen.getByRole("radio", { name: /自动获取/ }));
    expect(screen.queryByPlaceholderText("粘贴 accessToken 或完整 Session JSON")).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /手动粘贴/ }));
    expect(screen.getByPlaceholderText("粘贴 accessToken 或完整 Session JSON")).toHaveValue("");
  });

  it("only exposes the Team generator", async () => {
    render(<App />);
    expect(screen.getByRole("tab", { name: /Team 优惠/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("tab", { name: /Codex 按量/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /账单查询/ })).not.toBeInTheDocument();
  });
});
