import { NextResponse } from "next/server"
import { z } from "zod"
import { db, eq, tenantConfig } from "@/db"
import { requireTenantAdmin, isTenantGuardError } from "@/lib/tenant-admin-access"
import { getTenantConfig } from "@/lib/tenant"
import { encryptSecret } from "@/lib/crypto-secret"
import { logAuditEvent } from "@/lib/audit"

// GET — whether the tenant's own OpenRouter provisioning key is set.
export async function GET() {
  const admin = await requireTenantAdmin()
  if (isTenantGuardError(admin)) {
    return NextResponse.json({ error: admin.error }, { status: admin.status })
  }
  const cfg = await getTenantConfig(admin.tenantTeamId)
  return NextResponse.json({ hasKey: Boolean(cfg?.openRouterProvisioningKeyEnc) })
}

const putSchema = z.object({ key: z.string() })

// PUT — set (or clear, with "") the tenant's OpenRouter provisioning key. Their
// end-customers' agent runtime keys are minted against it.
export async function PUT(req: Request) {
  const admin = await requireTenantAdmin()
  if (isTenantGuardError(admin)) {
    return NextResponse.json({ error: admin.error }, { status: admin.status })
  }
  const body = await req.json().catch(() => null)
  const parsed = putSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 })

  const enc = parsed.data.key.length > 0 ? encryptSecret(parsed.data.key) : null

  await db
    .insert(tenantConfig)
    .values({ teamId: admin.tenantTeamId, openRouterProvisioningKeyEnc: enc })
    .onConflictDoUpdate({
      target: tenantConfig.teamId,
      set: { openRouterProvisioningKeyEnc: enc, updatedAt: new Date() },
    })

  await logAuditEvent({
    userId: admin.userId,
    action: "tenant.connect.update",
    teamId: admin.tenantTeamId,
    targetType: "team",
    targetId: admin.tenantTeamId,
    meta: { field: "openRouterKey", set: enc != null },
  })

  return NextResponse.json({ ok: true })
}
