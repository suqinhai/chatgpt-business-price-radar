# CDK 发放与验证

项目现在使用 Cloudflare Pages Functions + D1 保存 CDK 元数据。原始 CDK 只在发放接口响应中返回一次，D1 只保存 SHA-256 哈希，不保存可直接使用的明文。

## 一次性配置

1. 创建 D1 数据库：

   ```bash
   npx wrangler d1 create chatgpt-business-price-radar-cdks
   npx wrangler d1 migrations apply chatgpt-business-price-radar-cdks --remote
   ```

2. 在 Cloudflare Pages 项目的 **Settings → Functions → Bindings** 添加 D1 绑定：

   - Variable name: `CDK_DB`
   - Database: `chatgpt-business-price-radar-cdks`

3. 设置管理员密钥。管理员密钥只放在 Cloudflare Secret 中，不要写进仓库：

   ```bash
   npx wrangler pages secret put CDK_ADMIN_TOKEN --project-name=chatgpt-business-price-radar
   ```

4. 设置用于短期生成授权的随机密钥。它与管理员密钥用途不同：

   ```bash
   npx wrangler pages secret put CDK_SESSION_SECRET --project-name=chatgpt-business-price-radar
   ```

   `CDK_SESSION_SECRET` 不会返回给浏览器；激活成功后只会签发一个约 15 分钟有效的 activation token。

5. 成对设置 checkout 国家中继地址和 HMAC 密钥。两者都存在时启用中继，只设置一个会让生成接口明确报配置错误：

   ```bash
   npx wrangler pages secret put CHATGPT_RELAY_URL --project-name=chatgpt-business-price-radar
   npx wrangler pages secret put CHATGPT_RELAY_SECRET --project-name=chatgpt-business-price-radar
   ```

   在命令提示后分别输入已部署的 HTTPS 中继地址和共享密钥。不要把真实密钥写进命令历史、仓库、`wrangler.jsonc` 或任何 `VITE_*` 变量。

6. 重新部署 Pages。绑定或 Secret 修改后必须重新部署，Pages Function 才能读取新配置。

本地调试时可以复制 `.dev.vars.example` 为 `.dev.vars`，再使用 Pages Functions 的本地服务器并传入 D1 绑定：

```bash
cp .dev.vars.example .dev.vars
npm run build
npx wrangler pages dev dist --d1 CDK_DB=<本地或远程数据库 ID>
```

## 发放 CDK

部署完成后，可以直接打开管理页面：

```text
https://你的域名/admin
```

输入设置在 Cloudflare Pages 中的 `CDK_ADMIN_TOKEN` 后，即可批量生成、复制、分页查看状态和撤销 CDK。新生成批次的明文会暂存在当前页面内存中，列表中的“复制 CDK”按钮仅对这批明文可用；管理员密钥只保存在当前页面内存中，不会写入 URL、Local Storage 或数据库。旧的 `/?view=admin` 链接会自动跳转到 `/admin`。

也可以通过命令行发放：

管理员接口为 `POST /api/cdk/admin/issue`，需要：

```http
Authorization: Bearer <CDK_ADMIN_TOKEN>
Content-Type: application/json
```

请求体支持：

```json
{
  "quantity": 10,
  "maxUses": 1,
  "expiresAt": "2026-12-31T23:59:59.000Z"
}
```

也可以使用脚本：

```powershell
$env:CDK_ISSUER_URL = "https://chatgpt-business-price-radar.pages.dev"
$env:CDK_ADMIN_TOKEN = "从 Cloudflare Secret 管理器获取"
$env:CDK_QUANTITY = "10"
$env:CDK_MAX_USES = "1"
npm run cdk:issue
```

脚本输出的 CDK 需要安全保存或交付给购买者；接口不会再次返回同一批明文 CDK。

## 用户激活

页面会向 `POST /api/cdk/activate` 发送：

```json
{ "code": "CDK-ABCD-EFGH-JKLM" }
```

服务端会校验格式、哈希、撤销状态、过期时间和剩余次数，并使用带条件的 SQL 更新保证并发激活不会重复消耗。默认 `maxUses` 是 1；激活失败不会改变使用次数。

配置 `CDK_SESSION_SECRET` 后，响应还会包含短期 `activationToken`。该 token 仅用于下一步服务端生成请求，不包含 CDK 明文。

## 服务端生成支付链接

前端会把激活 token、所选国家和货币、优惠码、已有空间 ID（可选）以及用户主动粘贴的 Access Token 发送到 `POST /api/checkout/generate`。接口在内存中提取 Access Token，并只返回 HTTPS 支付链接；不会把 Access Token 写入 D1、URL、日志、错误响应或客户端 bundle。

配置 `CHATGPT_RELAY_URL` 与 `CHATGPT_RELAY_SECRET` 后，Pages Function 会在服务端向固定环境变量中的中继地址发送一次 POST。请求外层包含大写两位 `country`、Access Token 和项目原有 checkout payload；外层国家与 `billing_details.country` 始终一致。每次请求生成新的 nonce，并严格签名实际发送的原始 JSON 字符串。该 POST 不自动重试，也不接受浏览器传入目标 URL。

两项中继变量都未设置时，接口保留原有的 ChatGPT 直连行为；只设置其中一项时会返回 `relay_configuration_invalid`，不会静默回退。中继错误只映射为稳定错误码和安全提示，不透传原始上游响应、代理 IP 或内部堆栈。

## 管理和撤销

- `GET /api/cdk/admin/list?limit=50&offset=0`：分页查看前缀、使用次数、过期和撤销状态，响应中的 `total` 用于计算总页数；接口不返回明文 CDK。
- `POST /api/cdk/admin/revoke`：请求体使用 `{ "code": "CDK-..." }` 或 `{ "id": "..." }`。

## 当前边界

“直接生成支付链接”走 Pages Function；配置中继后，中继签名密钥与实际 checkout 请求都只存在于服务端执行路径。请只在你有权操作的账号中使用；第三方接口、促销资格和 ChatGPT 风控规则可能调整，最终结果以 ChatGPT 结账页为准。
