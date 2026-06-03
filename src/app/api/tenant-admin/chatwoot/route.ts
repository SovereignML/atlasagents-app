import { NextResponse } from "next/server"
import { z } from "zod"
import { db, eq, tenantConfig } from "@/db"
import { requireTenantAdmin, isTenantGuardError } from "@/lib/tenant-admin-access"
import { getTenantConfig } from "@/lib/tenant"
import { encryptSecret, decryptSecret } from "@/lib/crypto-secret"
import { logAuditEvent } from "@/lib/audit"

// GET — current Chatwoot config for the tenant. Secrets are never returned;
// callers get booleans indicating whether they're set.
export async function GET() {
  const admin = await requireTenantAdmin()
  if (isTenantGuardError(admin)) {
    return NextResponse.json({ error: admin.error }, { status: admin.status })
  }
  const cfg = await getTenantConfig(admin.tenantTeamId)
  return NextResponse.json({
    chatwoot: {
      baseUrl: cfg?.chatwootBaseUrl ?? "",
      accountId: cfg?.chatwootAccountId ?? "",
      inboxId: cfg?.chatwootInboxId ?? "",
      websiteToken: cfg?.chatwootWebsiteToken ?? "",
      hasApiToken: Boolean(cfg?.chatwootApiTokenEnc),
      hasHmacToken: Boolean(cfg?.chatwootHmacTokenEnc),
    },
  })
}

const putSchema = z.object({
  baseUrl: z.string().url(),
  accountId: z.string().min(1),
  inboxId: z.string().min(1),
  websiteToken: z.string().optional(),
  // Secrets: omit to keep the stored value; empty string clears it.
  apiToken: z.string().optional(),
  hmacToken: z.string().optional(),
})

// PUT — upsert the tenant's bring-your-own Chatwoot config, verifying the
// credentials with a cheap API call before saving.
export async function PUT(req: Request) {
  const admin = await requireTenantAdmin()
  if (isTenantGuardError(admin)) {
    return NextResponse.json({ error: admin.error }, { status: admin.status })
  }

  const body = await req.json().catch(() => null)
  const parsed = putSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 })
  }
  const { baseUrl, accountId, inboxId, websiteToken, apiToken, hmacToken } = parsed.data
  const normalizedBase = baseUrl.replace(/\/$/, "")

  const existing = await getTenantConfig(admin.tenantTeamId)
  const effectiveToken =
    apiToken && apiToken.length > 0
      ? apiToken
      : existing?.chatwootApiTokenEnc
        ? decryptSecret(existing.chatwootApiTokenEnc)
        : null
  if (!effectiveToken) {
    return NextResponse.json({ error: "API access token is required" }, { status: 400 })
  }

  // Verify-on-save: list inboxes to confirm base URL + token + account are valid.
  try {
    const res = await fetch(`${normalizedBase}/api/v1/accounts/${accountId}/inboxes`, {
      headers: { api_access_token: effectiveToken },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) {
      return NextResponse.json(
        { error: `Chatwoot rejected the credentials (HTTP ${res.status})` },
        { status: 400 },
      )
    }
  } catch {
    return NextResponse.json(
      { error: "Could not reach Chatwoot at that base URL" },
      { status: 400 },
    )
  }

  const set: Record<string, unknown> = {
    chatwootBaseUrl: normalizedBase,
    chatwootAccountId: accountId,
    chatwootInboxId: inboxId,
    chatwootWebsiteToken: websiteToken ?? existing?.chatwootWebsiteToken ?? null,
    updatedAt: new Date(),
  }
  if (apiToken !== undefined) {
    set.chatwootApiTokenEnc = apiToken.length > 0 ? encryptSecret(apiToken) : null
  }
  if (hmacToken !== undefined) {
    set.chatwootHmacTokenEnc = hmacToken.length > 0 ? encryptSecret(hmacToken) : null
  }

  await db
    .insert(tenantConfig)
    .values({
      teamId: admin.tenantTeamId,
      chatwootBaseUrl: normalizedBase,
      chatwootAccountId: accountId,
      chatwootInboxId: inboxId,
      chatwootWebsiteToken: websiteToken ?? null,
      chatwootApiTokenEnc: encryptSecret(effectiveToken),
      chatwootHmacTokenEnc:
        hmacToken && hmacToken.length > 0 ? encryptSecret(hmacToken) : null,
    })
    .onConflictDoUpdate({ target: tenantConfig.teamId, set })

  await logAuditEvent({
    userId: admin.userId,
    action: "tenant.chatwoot.update",
    teamId: admin.tenantTeamId,
    targetType: "team",
    targetId: admin.tenantTeamId,
  })

  return NextResponse.json({ ok: true })
}
