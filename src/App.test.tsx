import { cleanup, render, screen, waitFor } from "@testing-library/react";
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

  it("does not expose a browser checkout script or store the token", async () => {
    render(<App />);

    expect(screen.queryByRole("button", { name: /复制代码/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /下载脚本/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Access Token 不会写入浏览器脚本/)).not.toBeInTheDocument();
    expect(window.location.search).not.toContain("accessToken");
    expect(Object.values(window.localStorage)).not.toContain("accessToken");
  });

  it("only exposes the Team generator", async () => {
    render(<App />);
    expect(screen.getByRole("tab", { name: /Team 优惠/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("tab", { name: /Codex 按量/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /账单查询/ })).not.toBeInTheDocument();
  });
});
