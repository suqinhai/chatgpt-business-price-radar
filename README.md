# Business Toolkit

一个独立的 ChatGPT Business 支付链接生成工具。首页提供 Team 优惠支付链接生成；管理员可在 `/admin` 管理 CDK。

> 本项目不是 OpenAI 官方产品，与 OpenAI 没有隶属、合作或背书关系。实际价格、税费、付款资格和地区可用性以结账页为准。

## 功能

- 探测完整的 ISO 3166-1 alpha-2 国家和地区代码。
- 仅展示标准 ChatGPT Business 月付价格，不包含年付或非营利套餐。
- 显示官方原币价格、人民币/美元估算、含税或未含税口径。
- 支持搜索、筛选、排序以及桌面表格和移动端卡片。
- 从任意地区一键带入国家和货币；配置国家中继后，由服务端经对应国家出口请求 ChatGPT 并返回 Team 结账链接。
- Team 优惠生成器支持 39 种货币、已有空间 UUID、实时预览和支付链接复制。
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

生成器允许粘贴原始 `accessToken` 或 `/api/auth/session` 返回的完整 JSON；服务端只提取其中的 `accessToken`，在内存中的单次 checkout 请求里使用，随后只返回 HTTPS 支付链接。服务端不保存 Token，也不会把 Token 写入生成的链接、日志、数据库或错误响应。

主流程只提供服务端生成支付链接，不再生成把 Access Token 带入浏览器执行的 checkout 脚本。账单结果可能包含敏感付款资料，请勿分享控制台输出。请仅在有权操作的账号中使用，并以实际 ChatGPT 页面结果为准。

### 服务端链接生成与国家中继

`POST /api/checkout/generate` 会使用激活 CDK 后签发的短期 activation token，校验国家、货币、优惠码和 Access Token。启用国家中继后，Pages Function 会在服务端把项目原有 checkout payload、所选国家和 Access Token 发给中继；`country` 会标准化为大写两位代码，并始终与 `payload.billing_details.country` 一致。

每个中继 POST 都使用新的 24 字节随机 nonce，并对 `timestamp.nonce.rawBody` 做 HMAC-SHA256 签名。签名后的 `rawBody` 会原样发送；checkout POST 不自动重试，也不跟随重定向。中继 URL 只能来自服务端环境变量，浏览器请求不能指定或覆盖目标地址，因此该接口不会成为任意 URL 代理。

要启用服务端链接生成，请在 Cloudflare Pages 设置 `CDK_SESSION_SECRET`（随机长密钥），然后重新部署。该密钥用于签发有效期约 15 分钟的 activation token；缺少密钥时，CDK 激活和生成接口会返回配置错误，而不会消耗 CDK。

国家中继采用成对配置：

- `CHATGPT_RELAY_URL`：已部署的 HTTPS checkout 中继端点。
- `CHATGPT_RELAY_SECRET`：与中继共享的 HMAC 密钥，只能存放在服务端 Secret 中。

两项都存在时使用国家中继；只存在一项时返回 `relay_configuration_invalid`，不会静默直连；两项都不存在时保留原有的 ChatGPT 直连行为。不要在 `wrangler.jsonc`、前端 `VITE_*` 变量、仓库文件或 CI 日志中写入真实密钥。

中继的已知错误会被转换为不含上游原文、Access Token、代理地址或堆栈的安全响应，包括签名/时间错误、Token 无效、nonce 重放、限流、国家出口不可用、连接/上游异常和 checkout 参数拒绝。

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
5. 在 Pages 项目的服务端设置 `CDK_SESSION_SECRET`、`CHATGPT_RELAY_URL` 和 `CHATGPT_RELAY_SECRET`；真实值不要提交到仓库或配置为 `VITE_*` 变量。
6. 打开 **Actions → Refresh prices and deploy Cloudflare Pages → Run workflow**，执行首次发布。

首次发布前，工作流会从 `https://<项目名>.pages.dev/data/prices.json` 读取上一份快照；如果没有快照，会使用首次覆盖率保护（至少 20 个有效地区）。采价或覆盖率检查失败时不会覆盖线上版本。

Cloudflare Pages 的 Direct Upload 支持通过 Wrangler 和 GitHub Actions 持续部署。静态资源不会消耗 Pages Functions 的请求额度；CDK 和 checkout 接口由 Pages Functions 提供。

## 计费与免责声明

ChatGPT Business 按标准席位计费，通常至少需要两个标准席位。本站表格显示的是接口返回的**每用户月价**，不代表两席位总账单。企业税号、VAT/GST、反向征税、发卡行汇率和手续费都可能改变最终金额。

- [OpenAI Business 官方价格页](https://openai.com/business/pricing/)
- [OpenAI Business 账单与席位说明](https://help.openai.com/en/articles/8792536)

## 授权与归属

代码采用 [MIT License](LICENSE)。

ChatGPT 与 OpenAI 是其各自权利人的商标。本项目仅作描述性使用。项目受到 PriceAI 信息架构的启发，但没有复制 PriceAI 的代码、品牌、素材、价格快照或线上数据；详见 [NOTICE.md](NOTICE.md)。
