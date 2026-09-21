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

5. 重新部署 Pages。绑定或 Secret 修改后必须重新部署，Pages Function 才能读取新配置。

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

前端会把激活 token、所选国家和货币、优惠码、已有空间 ID（可选）以及用户主动粘贴的 Access Token 发送到 `POST /api/checkout/generate`。接口在内存中提取 Access Token，调用 ChatGPT 的 checkout API，并只返回 HTTPS 支付链接；不会把 Access Token 写入 D1、URL 或日志。

该接口提交的是 ChatGPT checkout payload 的 `billing_details`，不是 IP 伪装。Cloudflare Pages 无法把出口地址切换成任意第三方 IP 清单中的地址；`all.json` 中的 IP/端口条目也不等同于可用的 HTTP/SOCKS 代理，不能直接用于服务端登录或绕过地区限制。

## 管理和撤销

- `GET /api/cdk/admin/list?limit=50&offset=0`：分页查看前缀、使用次数、过期和撤销状态，响应中的 `total` 用于计算总页数；接口不返回明文 CDK。
- `POST /api/cdk/admin/revoke`：请求体使用 `{ "code": "CDK-..." }` 或 `{ "id": "..." }`。

## 当前边界

页面仍保留浏览器本地脚本作为后备输出，但“直接生成支付链接”已经走 Pages Function。请只在你有权操作的账号中使用；第三方接口、促销资格和 ChatGPT 风控规则可能调整，最终结果以 ChatGPT 结账页为准。
