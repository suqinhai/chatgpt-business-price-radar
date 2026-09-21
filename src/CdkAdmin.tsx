import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardCopy,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";

type CdkRecord = {
  id: string;
  code_prefix: string;
  created_at: string;
  expires_at: string | null;
  max_uses: number;
  used_count: number;
  last_used_at: string | null;
  revoked_at: string | null;
};

type ApiError = { ok?: boolean; message?: string };

type CdkAdminProps = {
  onBack: () => void;
};

const formatDateTime = (value: string | null) => {
  if (!value) return "永久有效";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

const statusOf = (record: CdkRecord) => {
  if (record.revoked_at) return { label: "已撤销", tone: "revoked" };
  if (record.expires_at && Date.parse(record.expires_at) <= Date.now()) return { label: "已过期", tone: "expired" };
  if (record.used_count >= record.max_uses) return { label: "已用完", tone: "used" };
  return { label: "可使用", tone: "active" };
};

const RECORDS_PER_PAGE = 20;

export default function CdkAdmin({ onBack }: CdkAdminProps) {
  const [adminToken, setAdminToken] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [quantity, setQuantity] = useState("10");
  const [maxUses, setMaxUses] = useState("1");
  const [expiresAt, setExpiresAt] = useState("");
  const [records, setRecords] = useState<CdkRecord[]>([]);
  const [page, setPage] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);
  const [generatedCodes, setGeneratedCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState<"connect" | "issue" | "list" | "revoke" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);
  const [copiedRecordId, setCopiedRecordId] = useState<string | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<string | null>(null);

  const activeCount = useMemo(
    () => records.filter((record) => statusOf(record).tone === "active").length,
    [records],
  );
  const pageCount = Math.max(1, Math.ceil(totalRecords / RECORDS_PER_PAGE));

  const request = async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
    const response = await fetch(path, {
      ...init,
      headers: {
        authorization: `Bearer ${adminToken.trim()}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
    });
    const payload = await response.json().catch(() => ({})) as T & ApiError;
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.message || `请求失败（${response.status}）`);
    }
    return payload;
  };

  const loadRecords = async (mode: "connect" | "list" = "list", requestedPage = page) => {
    if (!adminToken.trim()) {
      setError("请输入管理员密钥");
      return;
    }
    const nextPage = Math.max(1, requestedPage);
    setBusy(mode);
    setError("");
    try {
      const offset = (nextPage - 1) * RECORDS_PER_PAGE;
      const payload = await request<{ ok: boolean; cdks: CdkRecord[]; total?: number }>(`/api/cdk/admin/list?limit=${RECORDS_PER_PAGE}&offset=${offset}`);
      setRecords(payload.cdks);
      setTotalRecords(payload.total ?? payload.cdks.length);
      setPage(nextPage);
      setAuthorized(true);
      setNotice(mode === "connect" ? "管理员身份验证成功" : "CDK 列表已刷新");
    } catch (requestError) {
      setAuthorized(false);
      setRecords([]);
      setPage(1);
      setTotalRecords(0);
      setError(requestError instanceof Error ? requestError.message : "无法加载 CDK 列表");
    } finally {
      setBusy(null);
    }
  };

  const issueCodes = async (event: React.FormEvent) => {
    event.preventDefault();
    const parsedQuantity = Number(quantity);
    const parsedMaxUses = Number(maxUses);
    if (!Number.isInteger(parsedQuantity) || parsedQuantity < 1 || parsedQuantity > 100) {
      setError("生成数量必须是 1 到 100 的整数");
      return;
    }
    if (!Number.isInteger(parsedMaxUses) || parsedMaxUses < 1 || parsedMaxUses > 100) {
      setError("可用次数必须是 1 到 100 的整数");
      return;
    }

    let expiry: string | null = null;
    if (expiresAt) {
      const date = new Date(expiresAt);
      if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) {
        setError("过期时间必须晚于当前时间");
        return;
      }
      expiry = date.toISOString();
    }

    setBusy("issue");
    setError("");
    setGeneratedCodes([]);
    try {
      const payload = await request<{ ok: boolean; codes: string[] }>("/api/cdk/admin/issue", {
        method: "POST",
        body: JSON.stringify({ quantity: parsedQuantity, maxUses: parsedMaxUses, expiresAt: expiry }),
      });
      setGeneratedCodes(payload.codes);
      setNotice(`已生成 ${payload.codes.length} 个 CDK`);
      await loadRecords("list", 1);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "生成 CDK 失败");
      setBusy(null);
    }
  };

  const writeClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand?.("copy");
      textarea.remove();
    }
  };

  const copyCodes = async () => {
    if (!generatedCodes.length) return;
    await writeClipboard(generatedCodes.join("\n"));
    setCopied(true);
    setNotice("CDK 已复制到剪贴板");
    window.setTimeout(() => setCopied(false), 1800);
  };

  const copyRecordCode = async (record: CdkRecord) => {
    const code = generatedCodes.find((generatedCode) => generatedCode.startsWith(`${record.code_prefix}-`));
    if (!code) {
      setError("该 CDK 的明文仅在生成时显示，当前页面无法恢复");
      setNotice("");
      return;
    }
    await writeClipboard(code);
    setCopiedRecordId(record.id);
    setError("");
    setNotice("CDK 已复制到剪贴板");
    window.setTimeout(() => setCopiedRecordId((current) => current === record.id ? null : current), 1800);
  };

  const revokeCode = async (id: string) => {
    setBusy("revoke");
    setError("");
    try {
      await request<{ ok: boolean }>("/api/cdk/admin/revoke", {
        method: "POST",
        body: JSON.stringify({ id }),
      });
      setPendingRevoke(null);
      setNotice("CDK 已撤销");
      await loadRecords("list");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "撤销 CDK 失败");
      setBusy(null);
    }
  };

  return (
    <div className="cdk-admin-page">
      <section className="cdk-admin-hero">
        <button className="admin-back" type="button" onClick={onBack}><ArrowLeft size={15} /> 返回工具</button>
        <span className="eyebrow"><ShieldCheck size={15} /> CDK ADMIN CONSOLE</span>
        <h1>CDK <em>管理台</em></h1>
        <p>批量签发、查看使用状态并撤销访问凭据。管理员密钥仅保留在当前页面内存中。</p>
      </section>

      <section className="admin-auth-card" aria-labelledby="admin-auth-title">
        <div>
          <span>管理员身份</span>
          <h2 id="admin-auth-title">连接 CDK 服务</h2>
          <p>使用 Cloudflare Pages 中设置的 <code>CDK_ADMIN_TOKEN</code>。</p>
        </div>
        <form onSubmit={(event) => { event.preventDefault(); void loadRecords("connect"); }}>
          <label htmlFor="admin-token">管理员密钥</label>
          <div className={authorized ? "verified" : ""}>
            {authorized ? <Check size={17} /> : <KeyRound size={17} />}
            <input
              id="admin-token"
              type="password"
              value={adminToken}
              onChange={(event) => {
                setAdminToken(event.target.value);
                setAuthorized(false);
                setRecords([]);
                setPage(1);
                setTotalRecords(0);
                setGeneratedCodes([]);
                setError("");
              }}
              placeholder="输入 CDK_ADMIN_TOKEN"
              autoComplete="off"
              spellCheck={false}
            />
            <button type="submit" disabled={busy === "connect"}>
              {busy === "connect" ? <LoaderCircle className="spin" size={16} /> : null}
              {authorized ? "重新验证" : "验证并连接"}
            </button>
          </div>
        </form>
      </section>

      {error ? <div className="admin-alert error" role="alert">{error}</div> : null}
      {notice ? <div className="admin-alert success" role="status">{notice}</div> : null}

      <section className={`admin-dashboard ${authorized ? "" : "locked"}`} aria-label="CDK 管理功能">
        <div className="admin-issue-panel">
          <div className="admin-section-head">
            <div><span>ISSUE CODES</span><h2>生成新 CDK</h2></div>
            <Sparkles size={20} />
          </div>
          <form onSubmit={issueCodes}>
            <div className="admin-field-grid">
              <label>
                <span>生成数量</span>
                <input type="number" min="1" max="100" step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} disabled={!authorized} />
                <small>单次最多 100 个</small>
              </label>
              <label>
                <span>每个可用次数</span>
                <input type="number" min="1" max="100" step="1" value={maxUses} onChange={(event) => setMaxUses(event.target.value)} disabled={!authorized} />
                <small>一次性 CDK 填 1</small>
              </label>
            </div>
            <label className="admin-expiry-field">
              <span>过期时间 <small>可选</small></span>
              <input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} disabled={!authorized} />
            </label>
            <button className="admin-primary-button" type="submit" disabled={!authorized || busy === "issue"}>
              {busy === "issue" ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={17} />}
              {busy === "issue" ? "正在生成…" : "生成 CDK"}
            </button>
          </form>

          {generatedCodes.length ? (
            <div className="generated-codes" aria-live="polite">
              <div className="generated-codes-head">
                <div><strong>本次生成结果</strong><span>明文只显示这一次，请立即保存</span></div>
                <button type="button" onClick={copyCodes}>{copied ? <Check size={14} /> : <ClipboardCopy size={14} />} {copied ? "已复制" : "复制全部"}</button>
              </div>
              <pre>{generatedCodes.join("\n")}</pre>
            </div>
          ) : null}
        </div>

        <div className="admin-list-panel">
          <div className="admin-section-head">
            <div><span>CODE INVENTORY</span><h2>CDK 列表</h2></div>
            <button type="button" onClick={() => void loadRecords("list")} disabled={!authorized || busy === "list"}>
              <RefreshCw className={busy === "list" ? "spin" : ""} size={15} /> 刷新
            </button>
          </div>
          <div className="admin-list-summary">
            <span>最近记录 <strong>{totalRecords}</strong></span>
            <span>本页可用 <strong>{activeCount}</strong></span>
          </div>
          <div className="cdk-record-list">
            {!authorized ? (
              <div className="admin-empty"><KeyRound size={22} /><span>验证管理员密钥后查看</span></div>
            ) : records.length ? records.map((record) => {
              const status = statusOf(record);
              return (
                <article className="cdk-record" key={record.id}>
                  <div className="cdk-record-main">
                    <div><strong>{record.code_prefix}-••••-••••</strong><span className={`cdk-status ${status.tone}`}>{status.label}</span></div>
                    <small>创建于 {formatDateTime(record.created_at)}</small>
                  </div>
                  <div className="cdk-usage"><span>使用次数</span><strong>{record.used_count} / {record.max_uses}</strong></div>
                  <div className="cdk-expiry"><span>有效期</span><strong>{formatDateTime(record.expires_at)}</strong></div>
                  <div className="cdk-record-actions">
                    {pendingRevoke === record.id ? (
                      <>
                        <button className="confirm" type="button" onClick={() => void revokeCode(record.id)} disabled={busy === "revoke"}>确认撤销</button>
                        <button className="cancel" type="button" onClick={() => setPendingRevoke(null)} aria-label="取消撤销"><X size={14} /></button>
                      </>
                    ) : (
                      <>
                        <button
                          className="copy"
                          type="button"
                          onClick={() => void copyRecordCode(record)}
                          disabled={!generatedCodes.some((generatedCode) => generatedCode.startsWith(`${record.code_prefix}-`))}
                          title={generatedCodes.some((generatedCode) => generatedCode.startsWith(`${record.code_prefix}-`)) ? "复制完整 CDK" : "完整 CDK 仅在生成时显示"}
                        >
                          {copiedRecordId === record.id ? <Check size={14} /> : <ClipboardCopy size={14} />}
                          {copiedRecordId === record.id ? "已复制" : "复制 CDK"}
                        </button>
                        <button type="button" onClick={() => setPendingRevoke(record.id)} disabled={status.tone === "revoked"}><Trash2 size={14} /> 撤销</button>
                      </>
                    )}
                  </div>
                </article>
              );
            }) : (
              <div className="admin-empty"><ShieldCheck size={22} /><span>还没有 CDK 记录</span></div>
            )}
          </div>
          {authorized && totalRecords > 0 ? (
            <nav className="cdk-pagination" aria-label="CDK 列表分页">
              <span>第 {page} / {pageCount} 页</span>
              <div>
                <button type="button" aria-label="上一页" onClick={() => void loadRecords("list", page - 1)} disabled={page <= 1 || busy === "list"}>
                  <ChevronLeft size={14} /> 上一页
                </button>
                <button type="button" aria-label="下一页" onClick={() => void loadRecords("list", page + 1)} disabled={page >= pageCount || busy === "list"}>
                  下一页 <ChevronRight size={14} />
                </button>
              </div>
            </nav>
          ) : null}
        </div>
      </section>
    </div>
  );
}
