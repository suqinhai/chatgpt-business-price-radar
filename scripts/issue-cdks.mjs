const endpoint = process.env.CDK_ISSUER_URL?.replace(/\/$/, "");
const adminToken = process.env.CDK_ADMIN_TOKEN;
const quantity = Number(process.env.CDK_QUANTITY || 1);
const maxUses = Number(process.env.CDK_MAX_USES || 1);
const expiresAt = process.env.CDK_EXPIRES_AT || undefined;

if (!endpoint || !adminToken) {
  console.error("Set CDK_ISSUER_URL and CDK_ADMIN_TOKEN before issuing CDKs.");
  process.exit(1);
}

const response = await fetch(`${endpoint}/api/cdk/admin/issue`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${adminToken}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({ quantity, maxUses, expiresAt }),
});

const payload = await response.json().catch(() => ({}));
if (!response.ok || !payload.ok) {
  console.error(payload.message || `CDK issue request failed (${response.status})`);
  process.exit(1);
}

console.log(payload.codes.join("\n"));
