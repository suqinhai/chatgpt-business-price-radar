import {
  ArrowLeft,
  Check,
  Code2,
  Copy,
  Download,
  ExternalLink,
  Info,
  KeyRound,
  LockKeyhole,
  MapPin,
  RotateCcw,
  Search,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_ACCESS_TOKEN_MODE,
  DEFAULT_CHECKOUT_COUNTRY,
  DEFAULT_CHECKOUT_CURRENCY,
  generateCheckoutScript,
  isSupportedCheckoutCurrency,
  normalizeIsoInput,
  validateCheckoutInput,
  type AccessTokenMode,
  type CheckoutScriptInput,
} from "./checkout-generator";
import type { GeneratorTool } from "./script-generators";
import { formatLocal } from "./lib";
import type { PriceRow } from "./types";

type CheckoutGeneratorProps = {
  initialTool?: GeneratorTool;
  initialCountry?: string;
  initialCurrency?: string;
  countries: PriceRow[];
  onBack: () => void;
  onToolChange: (tool: GeneratorTool) => void;
};

type FormField = "coupon" | "country" | "currency" | "existingWorkspaceId" | "accessToken";
type FormErrors = Partial<Record<FormField, string>>;

const formatUsd = (amount: number) => `$${new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(amount)}`;

const formatDate = (value?: string) => {
  const date = value ? new Date(value) : new Date();
  if (!Number.isFinite(date.getTime())) return "实时更新";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
};

export default function CheckoutGenerator({
  initialCountry = DEFAULT_CHECKOUT_COUNTRY,
  initialCurrency = DEFAULT_CHECKOUT_CURRENCY,
  countries,
  onBack,
  onToolChange,
}: CheckoutGeneratorProps) {
  const [coupon, setCoupon] = useState("");
  const [country, setCountry] = useState(initialCountry);
  const [currency, setCurrency] = useState(initialCurrency);
  const [existingWorkspaceId, setExistingWorkspaceId] = useState("");
  const [autoOpen, setAutoOpen] = useState(false);
  const [accessTokenMode, setAccessTokenMode] = useState<AccessTokenMode>(DEFAULT_ACCESS_TOKEN_MODE);
  const [accessToken, setAccessToken] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [notice, setNotice] = useState("");
  const [activationCode, setActivationCode] = useState("");
  const [cdkActivated, setCdkActivated] = useState(false);
  const [activationBusy, setActivationBusy] = useState(false);
  const [activationError, setActivationError] = useState("");
  const [generated, setGenerated] = useState(false);
  const [copied, setCopied] = useState(false);

  const activationRef = useRef<HTMLInputElement>(null);
  const couponRef = useRef<HTMLInputElement>(null);
  const visibleCouponRef = useRef<HTMLInputElement>(null);
  const countryRef = useRef<HTMLInputElement>(null);
  const currencyRef = useRef<HTMLInputElement>(null);
  const workspaceIdRef = useRef<HTMLInputElement>(null);
  const accessTokenRef = useRef<HTMLInputElement>(null);
  const visibleTokenRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setCountry(initialCountry || DEFAULT_CHECKOUT_COUNTRY);
    setCurrency(initialCurrency || DEFAULT_CHECKOUT_CURRENCY);
    setErrors({});
    setGenerated(false);
  }, [initialCountry, initialCurrency]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(""), 2600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const pricedCountries = useMemo(
    () => [...countries]
      .filter((row) => isSupportedCheckoutCurrency(row.currencyCode))
      .sort((a, b) => a.usdAmount - b.usdAmount || a.countryName.localeCompare(b.countryName, "zh-CN")),
    [countries],
  );

  const commonCountries = pricedCountries.slice(0, 9);
  const selectedCountry = useMemo(
    () => pricedCountries.find((row) => row.countryCode === country.toUpperCase() && row.currencyCode === currency.toUpperCase())
      || pricedCountries.find((row) => row.currencyCode === currency.toUpperCase())
      || pricedCountries.find((row) => row.countryCode === country.toUpperCase())
      || pricedCountries[0],
    [country, currency, pricedCountries],
  );

  const checkoutInput: CheckoutScriptInput = {
    coupon: coupon.trim(),
    country: selectedCountry?.countryCode || country.toUpperCase(),
    currency: selectedCountry?.currencyCode || currency.toUpperCase(),
    existingWorkspaceId: existingWorkspaceId.trim(),
    autoOpen,
    accessTokenMode,
    accessToken: accessToken.trim(),
  };

  const currentErrors = () => validateCheckoutInput(checkoutInput);
  const source = useMemo(() => {
    const previewToken = accessTokenMode === "manual"
      ? accessToken.trim() || "PASTE_ACCESS_TOKEN_HERE"
      : "";
    return generateCheckoutScript({
      ...checkoutInput,
      coupon: checkoutInput.coupon || "XXXXXXXXXXXX",
      country: /^[A-Z]{2}$/.test(checkoutInput.country) ? checkoutInput.country : DEFAULT_CHECKOUT_COUNTRY,
      currency: isSupportedCheckoutCurrency(checkoutInput.currency) ? checkoutInput.currency : DEFAULT_CHECKOUT_CURRENCY,
      existingWorkspaceId: currentErrors().existingWorkspaceId ? "" : checkoutInput.existingWorkspaceId,
      accessToken: previewToken,
    });
  }, [coupon, country, currency, existingWorkspaceId, autoOpen, accessTokenMode, accessToken, selectedCountry?.countryCode, selectedCountry?.currencyCode]);

  const isInputValid = Object.keys(currentErrors()).length === 0;

  const clearError = (field: FormField) => {
    if (!errors[field]) return;
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const chooseCountry = (row: PriceRow) => {
    setCountry(row.countryCode);
    setCurrency(row.currencyCode);
    setGenerated(false);
    clearError("country");
    clearError("currency");
  };

  const focusField = (field: FormField, legacy = false) => {
    if (field === "coupon") (legacy ? couponRef.current : visibleCouponRef.current)?.focus();
    if (field === "country") countryRef.current?.focus();
    if (field === "currency") currencyRef.current?.focus();
    if (field === "existingWorkspaceId") workspaceIdRef.current?.focus();
    if (field === "accessToken") (legacy ? accessTokenRef.current : visibleTokenRef.current)?.focus();
  };

  const validateAndFocus = (legacy = false) => {
    const nextErrors = currentErrors();
    setErrors(nextErrors);
    const firstError = Object.keys(nextErrors)[0] as FormField | undefined;
    if (firstError) focusField(firstError, legacy);
    return !firstError;
  };

  const handleGenerate = () => {
    if (!cdkActivated) {
      activationRef.current?.focus();
      setNotice("请先激活 CDK");
      return;
    }
    if (!coupon.trim()) {
      setErrors((current) => ({ ...current, coupon: "请输入优惠码" }));
      visibleCouponRef.current?.focus();
      setNotice("请填写 Business 优惠码");
      return;
    }
    if (!accessToken.trim()) {
      setAccessTokenMode("manual");
      setErrors((current) => ({ ...current, accessToken: "请输入 Access Token 或 Session JSON" }));
      visibleTokenRef.current?.focus();
      setNotice("请填写 Access Token 或 Session JSON");
      return;
    }
    if (!validateAndFocus()) {
      setNotice("请检查标红的参数");
      return;
    }
    setGenerated(true);
    setNotice("支付链接脚本已生成");
  };

  const activateCode = async () => {
    const code = activationCode.trim();
    if (!code) {
      activationRef.current?.focus();
      setNotice("请输入购买获得的 CDK");
      return;
    }
    setActivationBusy(true);
    setActivationError("");
    try {
      const response = await fetch("/api/cdk/activate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const payload = await response.json().catch(() => ({})) as { ok?: boolean; message?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.message || "CDK 无效、已过期或已使用");
      setCdkActivated(true);
      setNotice("CDK 已激活，可以生成支付长链");
    } catch (error) {
      const message = error instanceof Error && error.message !== "Failed to fetch"
        ? error.message
        : "CDK 服务暂时不可用，请稍后重试";
      setCdkActivated(false);
      setActivationError(message);
      setNotice(message);
    } finally {
      setActivationBusy(false);
    }
  };

  const copyCode = async () => {
    if (!validateAndFocus(true)) {
      setNotice("请先完成必填参数");
      return;
    }
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(source);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = source;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand?.("copy");
      textarea.remove();
    }
    setCopied(true);
    setNotice("完整代码已复制到剪贴板");
    window.setTimeout(() => setCopied(false), 1800);
  };

  const downloadCode = () => {
    if (!validateAndFocus(true)) {
      setNotice("请先完成必填参数");
      return;
    }
    const blob = new Blob([source], { type: "text/javascript;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "chatgpt-team-checkout.js";
    link.click();
    URL.revokeObjectURL(url);
    setNotice("代码文件已下载");
  };

  const reset = () => {
    setCoupon("");
    setCountry(DEFAULT_CHECKOUT_COUNTRY);
    setCurrency(DEFAULT_CHECKOUT_CURRENCY);
    setExistingWorkspaceId("");
    setAutoOpen(false);
    setAccessTokenMode(DEFAULT_ACCESS_TOKEN_MODE);
    setAccessToken("");
    setActivationCode("");
    setCdkActivated(false);
    setActivationBusy(false);
    setActivationError("");
    setGenerated(false);
    setErrors({});
    setNotice("已恢复默认值");
  };

  return (
    <div className="generator-page screenshot-generator-page">
      <section className="generator-hero">
        <div>
          <button className="back-link ui-hidden-control" type="button" onClick={onBack}><ArrowLeft size={15} /> 返回价格雷达</button>
          <span className="eyebrow"><Code2 size={15} /> BUSINESS TOOLKIT · LONG LINK</span>
          <h1>Business <em>长链生成</em></h1>
          <p>查询 ChatGPT Business 地区价格，并通过服务端生成与所选地区匹配的支付链接。</p>
        </div>
        <div className="generator-promise">
          <MapPin size={22} />
          <div><strong>按地区匹配</strong><span>先选开通地区，再核对支付信息与最终金额。</span></div>
        </div>
      </section>

      <section className="activation-card" aria-labelledby="activation-title">
        <div className="activation-copy">
          <span className="activation-kicker">激活生成权限</span>
          <strong id="activation-title">使用购买获得的一次性 CDK</strong>
        </div>
        <div className="activation-form">
          <label htmlFor="activation-cdk">CDK</label>
          <div className={`activation-input-row ${cdkActivated ? "activated" : ""}`}>
            {cdkActivated ? <Check size={17} aria-hidden="true" /> : <KeyRound size={17} aria-hidden="true" />}
            <input
              ref={activationRef}
              id="activation-cdk"
              value={activationCode}
              onChange={(event) => {
                setActivationCode(event.target.value);
                setCdkActivated(false);
                setActivationError("");
              }}
              placeholder="CDK-XXXX-XXXX-XXXX"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={Boolean(activationError)}
            />
            <button type="button" onClick={activateCode} disabled={activationBusy || cdkActivated}>
              {cdkActivated ? "已激活" : activationBusy ? "验证中…" : "激活 CDK"}
            </button>
          </div>
          <small>未激活时可以查看价格，但不能生成支付长链</small>
          {activationError ? <em className="activation-error" role="alert">{activationError}</em> : null}
        </div>
      </section>

      <div className="ui-hidden-control" role="tablist" aria-label="脚本类型">
        <button role="tab" aria-selected="true" onClick={() => onToolChange("checkout")}>Team 优惠</button>
      </div>

      <section className="generator-workspace" aria-labelledby="generator-title">
        <div className="generator-form-panel">
          <div className="generator-section-head region-section-head">
            <h2 id="generator-title">选择开通地区</h2>
            <span className="service-pill">服务端价格源</span>
          </div>

          <div className="region-picker" aria-label="地区选择">
            <span className="region-group-label">低价常用国家</span>
            <div className="region-picker-grid">
              {commonCountries.map((row) => (
                <button
                  className={`region-card ${selectedCountry?.countryCode === row.countryCode ? "active" : ""}`}
                  key={row.countryCode}
                  type="button"
                  onClick={() => chooseCountry(row)}
                  aria-pressed={selectedCountry?.countryCode === row.countryCode}
                >
                  <strong>{row.countryName}</strong>
                  <span><small>USD</small> {formatUsd(row.usdAmount)}</span>
                  <em>{formatLocal(row)}</em>
                </button>
              ))}
            </div>

            <label className="region-select-label" htmlFor="checkout-region-select">其他国家</label>
            <div className="region-search">
              <Search size={16} aria-hidden="true" />
              <select
                id="checkout-region-select"
                aria-label="其他国家"
                value={selectedCountry?.countryCode || ""}
                onChange={(event) => {
                  const row = pricedCountries.find((item) => item.countryCode === event.target.value);
                  if (row) chooseCountry(row);
                }}
              >
                {pricedCountries.length ? null : <option value="">暂无价格数据</option>}
                {pricedCountries.map((row) => (
                  <option key={row.countryCode} value={row.countryCode}>{row.countryName} ({row.countryCode})</option>
                ))}
              </select>
              <span>{selectedCountry?.currencyCode || currency}</span>
            </div>
          </div>

          {selectedCountry ? (
            <article className="selected-price-card" aria-live="polite">
              <div className="selected-price-head">
                <div><h3>{selectedCountry.countryName}</h3><span>{selectedCountry.countryCode} / {selectedCountry.currencyCode}</span></div>
                <div><small>折合美元</small><strong>{formatUsd(selectedCountry.usdAmount)}</strong></div>
              </div>
              <dl>
                <div><dt>当地单席位月价</dt><dd>{formatLocal(selectedCountry)}</dd></div>
                <div><dt>按1席位优惠</dt><dd>{formatUsd(selectedCountry.usdAmount)}</dd></div>
              </dl>
            </article>
          ) : (
            <div className="selected-price-empty">价格数据加载中…</div>
          )}

          <p className="price-footnote">实时汇率 · ExchangeRate-API · {formatDate(selectedCountry?.fetchedAt)}。5 折金额仅为估算，优惠资格、税费和最终实付以结账页为准。</p>
        </div>

        <div className="generator-result-panel">
          <div className="generator-section-head direct-title">
            <h2>直接生成支付链接</h2>
          </div>

          <label className={`direct-field ${errors.coupon ? "has-error" : ""}`}>
            <span><b>*</b> Business 优惠码</span>
            <div><KeyRound size={16} aria-hidden="true" /><input ref={visibleCouponRef} value={coupon} onChange={(event) => { setCoupon(event.target.value); setGenerated(false); clearError("coupon"); }} placeholder="优惠码或 ChatGPT 优惠链接" autoComplete="off" spellCheck={false} aria-invalid={Boolean(errors.coupon)} /></div>
            {errors.coupon ? <em role="alert">{errors.coupon}</em> : null}
          </label>

          <div className="access-help">
            <strong>怎么获取 Access Token?</strong>
            <ol>
              <li>先在同一浏览器登录 ChatGPT。</li>
              <li>打开 <a href="https://chatgpt.com/api/auth/session" target="_blank" rel="noreferrer">chatgpt.com/api/auth/session <ExternalLink size={11} /></a></li>
              <li>复制其中的 <code>accessToken</code>，或者复制整页 JSON 粘贴到下方。</li>
            </ol>
          </div>

          <label className={`direct-token-slot ${errors.accessToken ? "has-error" : ""}`}>
            <span className="direct-token-label"><b>*</b> Access Token 或 Session JSON</span>
            <textarea
              ref={visibleTokenRef}
              value={accessToken}
              onChange={(event) => {
                setAccessTokenMode("manual");
                setAccessToken(event.target.value);
                setGenerated(false);
                clearError("accessToken");
              }}
              placeholder="粘贴 Access Token，或完整的 Session JSON"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={Boolean(errors.accessToken)}
            />
            {errors.accessToken ? <em role="alert">{errors.accessToken}</em> : null}
          </label>

          <button className="direct-generate-button" type="button" disabled={!cdkActivated} onClick={handleGenerate}>
            <LockKeyhole size={16} /> {cdkActivated ? "生成支付链接" : "激活 CDK 后生成"}
          </button>

          {generated ? (
            <section className="generated-output" aria-label="生成结果">
              <div>
                <span>支付脚本已就绪</span>
                <small>复制后在已登录 ChatGPT 的页面控制台中运行</small>
              </div>
              <div className="generated-actions">
                <button type="button" onClick={downloadCode}><Download size={14} /> 下载</button>
                <button type="button" onClick={copyCode}>{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "已复制" : "复制代码"}</button>
              </div>
            </section>
          ) : null}
        </div>
      </section>

      <section className="ui-hidden-control" aria-label="高级参数与本地输出">
        <input ref={couponRef} value={coupon} onChange={(event) => setCoupon(event.target.value)} placeholder="例如：XXXXXXXXXXXX" />
        <label>已有 Codex 空间 ID<input ref={workspaceIdRef} value={existingWorkspaceId} onChange={(event) => setExistingWorkspaceId(event.target.value.trim())} /></label>
        <label>国家 ISO 缩写<input ref={countryRef} value={country} onChange={(event) => setCountry(normalizeIsoInput(event.target.value, 2))} /></label>
        <label>货币 ISO 缩写<input ref={currencyRef} value={currency} onChange={(event) => setCurrency(normalizeIsoInput(event.target.value, 3))} /></label>
        <label><input type="radio" name="access-token-mode" checked={accessTokenMode === "auto"} onChange={() => { setAccessTokenMode("auto"); setAccessToken(""); }} /> 自动获取</label>
        <label><input type="radio" name="access-token-mode" checked={accessTokenMode === "manual"} onChange={() => setAccessTokenMode("manual")} /> 手动粘贴</label>
        {accessTokenMode === "manual" ? <input ref={accessTokenRef} value={accessToken} onChange={(event) => setAccessToken(event.target.value)} placeholder="粘贴 accessToken 或完整 Session JSON" /> : null}
        <label><input type="checkbox" checked={autoOpen} onChange={(event) => setAutoOpen(event.target.checked)} /> 生成成功后自动打开支付页面</label>
        <button type="button" onClick={downloadCode} aria-disabled={!isInputValid}><Download size={14} /> 下载</button>
        <button type="button" onClick={copyCode} aria-disabled={!isInputValid}>{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "已复制" : "复制代码"}</button>
        <button type="button" onClick={reset}><RotateCcw size={13} /> 恢复默认值</button>
      </section>

      <section className="generator-disclaimer"><Info size={18} /><p><strong>请仅在你有权操作的账号中使用。</strong> 第三方接口、促销资格和结账规则可能调整，实际结果以 ChatGPT 页面为准。</p></section>
      {notice ? <div className="generator-toast" role="status">{notice}</div> : null}
    </div>
  );
}
