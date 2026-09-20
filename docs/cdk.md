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

4. 重新部署 Pages。绑定修改后必须重新部署，Pages Function 才能读取 `CDK_DB`。

本地调试时可以复制 `.dev.vars.example` 为 `.dev.vars`，再使用 Pages Functions 的本地服务器并传入 D1 绑定：

```bash
cp .dev.vars.example .dev.vars
npm run build
npx wrangler pages dev dist --d1 CDK_DB=<本地或远程数据库 ID>
```

## 发放 CDK

部署完成后，可以直接打开管理页面：

```text
https://你的域名/?view=admin
```

输入设置在 Cloudflare Pages 中的 `CDK_ADMIN_TOKEN` 后，即可批量生成、复制、查看状态和撤销 CDK。管理员密钥只保存在当前页面内存中，不会写入 URL、Local Storage 或数据库。

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

## 管理和撤销

- `GET /api/cdk/admin/list?limit=50&offset=0`：查看前缀、使用次数、过期和撤销状态，不返回明文 CDK。
- `POST /api/cdk/admin/revoke`：请求体使用 `{ "code": "CDK-..." }` 或 `{ "id": "..." }`。

## 当前边界

当前项目的 JavaScript 生成器仍然是在浏览器本地生成文本。CDK 已经可以真实发放和服务端验证，页面的“直接生成支付链接”按钮会要求激活成功；如果要让服务端从技术上阻止绕过前端直接生成脚本，还需要把最终支付链接生成接口也迁移到 Pages Function，并在该接口再次校验激活凭据。
