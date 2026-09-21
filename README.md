# Business Toolkit

一个独立的 ChatGPT Business 支付链接生成工具。首页提供 Team 优惠支付链接生成；管理员可在 `/admin` 管理 CDK。

> 本项目不是 OpenAI 官方产品，与 OpenAI 没有隶属、合作或背书关系。实际价格、税费、付款资格和地区可用性以结账页为准。

## 功能

- 探测完整的 ISO 3166-1 alpha-2 国家和地区代码。
- 仅展示标准 ChatGPT Business 月付价格，不包含年付或非营利套餐。
- 显示官方原币价格、人民币/美元估算、含税或未含税口径。
- 支持搜索、筛选、排序以及桌面表格和移动端卡片。
- 从任意地区一键带入国家和货币，由服务端请求 ChatGPT 并返回可访问的 Team 结账链接。
- Team 优惠生成器支持 39 种货币、已有空间 UUID、实时预览、复制和 `.js` 下载。
- Codex 按量生成器支持空间名称、Credit 数量和国家到货币自动匹配。
- 账单查询生成器可查询最近 10 条发票、支付方式和账单资料。
- 优惠码和手动提供的 Token 只在生成请求期间转发，不写入网址、Local Storage 或数据库；服务端不会记录 Token。
- GitHub Actions 每两天刷新，结构异常或覆盖率骤降时停止部署。
- 单个地区暂时失败时，最多沿用 14 天的上次成功结果并标记为“数据暂旧”。

## 本地开发

需要 Node.js 22 或更高版本，推荐 Node.js 24 LTS。

```bash
npm install
npm run dev
```

本地首次打开会使用 `public/data/sample-prices.json` 演示数据。获取真实数据：

```bash
npm run collect
npm run dev
```

生成的 `public/data/prices.json` 已加入 `.gitignore`，不会提交到仓库。

常用检查：

```bash
npm test
npm run typecheck
npm run build
```

## 数据采集规则

采集器位于 `scripts/collect-prices.mjs`：

1. 遍历 249 个 ISO 国家/地区代码。
2. 请求 `https://chatgpt.com/backend-anon/checkout_pricing_config/configs/{CODE}`。
3. 校验返回地区、币种和 `business.month.amount/tax`。
4. 以 Frankfurter 为主要汇率源；未覆盖币种由 `open.er-api.com` 补齐。
5. 通过美元中间价换算：`USD = 本币金额 ÷ USD→本币汇率`，`CNY = USD × USD→CNY汇率`。
6. 不自行加税，只展示接口提供的税务口径。

采集请求不使用 Cookie、设备 ID、会话 ID、登录凭据或浏览器指纹头。

## 页面与路由

- `/`：支付链接生成首页，包含地区价格选择、优惠码、Access Token 和 CDK 解锁流程。
- `/admin`：CDK 管理页，支持批量生成、复制、查询状态和撤销。
- 旧的 `?view=admin`、`?view=prices`、`?view=generator` 等链接会被规范化到上述两个页面，不再暴露其他工具路由。

Team 优惠生成器默认使用 `US / EGP`；已有空间 UUID 可选，优惠码和 Token 不会出现在网址中。

生成器允许粘贴原始 `accessToken` 或 `/api/auth/session` 返回的完整 JSON；服务端只提取其中的 `accessToken`，在内存中的单次请求里调用 ChatGPT 的 checkout 接口，随后只返回 HTTPS 支付链接。服务端不保存 Token，也不会把 Token 写入生成的链接。

页面仍保留“下载脚本”作为故障排查和手动执行的后备方式，但主按钮是“生成支付链接”。账单结果可能包含敏感付款资料，请勿分享控制台输出。请仅在有权操作的账号中使用，并以实际 ChatGPT 页面结果为准。

### 服务端链接生成与 IP 池边界

`POST /api/checkout/generate` 会使用激活 CDK 后签发的短期 activation token，校验国家、货币、优惠码和 Access Token，然后请求 `https://chatgpt.com/backend-api/payments/checkout`。请求体中的 `billing_details.country` 和 `billing_details.currency` 按页面选择提交。

用户提供的 `https://zip.cm.edu.kg.cmliussss.net/all.json` 是 IP/地理位置清单：条目包含 IP、端口和探测元数据，并不是一个可直接供 Cloudflare Pages 使用的 HTTP/SOCKS 代理协议。Cloudflare Worker 也不能通过设置请求头把自身出口 IP 伪装成清单中的地址，因此本项目不会把这些地址当作代理或用于绕过 ChatGPT 的地区、风控或账户限制。若确有合规的企业网络需求，应部署自己控制的代理/中继服务并由管理员审核其法律、服务条款和日志策略；不要把第三方 IP 清单直接接入生产支付流程。

要启用服务端链接生成，请在 Cloudflare Pages 设置 `CDK_SESSION_SECRET`（随机长密钥），然后重新部署。该密钥用于签发有效期约 15 分钟的 activation token；缺少密钥时，CDK 激活和生成接口会返回配置错误，而不会消耗 CDK。

### CDK 发放与验证

生成器的 CDK 通过 Cloudflare Pages Functions + D1 发放和验证。管理员发放、撤销、查询以及 Cloudflare 绑定配置请参阅 [docs/cdk.md](docs/cdk.md)。

### 发布保护

- 首次快照必须包含新鲜的 US、至少一个非 USD 地区、CNY 汇率和至少 20 个有效地区。
- 后续快照总行数不得低于上一线上快照的 90%。
- 任何保护条件失败时，Action 直接失败，不会覆盖当前线上版本。

可通过环境变量调整：

- `PREVIOUS_SNAPSHOT_URL`：上一线上快照地址。
- `PREVIOUS_SNAPSHOT_PATH`：本地上一快照路径。
- `MIN_FIRST_RUN_ROWS`：首次部署最少行数，默认 `20`。
- `OUTPUT_PATH`：输出文件，默认 `public/data/prices.json`。

## Cloudflare Pages 发布

工作流 `.github/workflows/pages.yml` 会在构建前采集价格，然后把 `dist` 上传到 Cloudflare Pages。它在北京时间每天 03:17 唤醒，通过日期门控每两天真正刷新一次；主分支推送和手动运行会立即刷新。

GitHub 可能在公开仓库连续 60 天没有活动后停用定时工作流；如果发生这种情况，请在 Actions 页面重新启用并手动运行一次。

首次配置：

1. 在 Cloudflare **Workers & Pages** 中创建一个 **Direct Upload** 项目，默认项目名为 `chatgpt-business-price-radar`。
2. 创建一个 Cloudflare API Token，授予当前账户的 Pages 编辑权限。
3. 在 GitHub 仓库 **Settings → Secrets and variables → Actions** 中添加：
   - `CLOUDFLARE_API_TOKEN`：上一步生成的 API Token。
   - `CLOUDFLARE_ACCOUNT_ID`：Cloudflare 账户 ID。
4. 如果 Pages 项目不是默认名称，在同一页面的 **Variables** 中添加 `CLOUDFLARE_PAGES_PROJECT`，值为实际项目名。
5. 打开 **Actions → Refresh prices and deploy Cloudflare Pages → Run workflow**，执行首次发布。

首次发布前，工作流会从 `https://<项目名>.pages.dev/data/prices.json` 读取上一份快照；如果没有快照，会使用首次覆盖率保护（至少 20 个有效地区）。采价或覆盖率检查失败时不会覆盖线上版本。

Cloudflare Pages 的 Direct Upload 支持通过 Wrangler 和 GitHub Actions 持续部署。静态资源不会消耗 Pages Functions 的请求额度；项目本身不需要 Pages Function。

## 计费与免责声明

ChatGPT Business 按标准席位计费，通常至少需要两个标准席位。本站表格显示的是接口返回的**每用户月价**，不代表两席位总账单。企业税号、VAT/GST、反向征税、发卡行汇率和手续费都可能改变最终金额。

- [OpenAI Business 官方价格页](https://openai.com/business/pricing/)
- [OpenAI Business 账单与席位说明](https://help.openai.com/en/articles/8792536)

## 授权与归属

代码采用 [MIT License](LICENSE)。

ChatGPT 与 OpenAI 是其各自权利人的商标。本项目仅作描述性使用。项目受到 PriceAI 信息架构的启发，但没有复制 PriceAI 的代码、品牌、素材、价格快照或线上数据；详见 [NOTICE.md](NOTICE.md)。
