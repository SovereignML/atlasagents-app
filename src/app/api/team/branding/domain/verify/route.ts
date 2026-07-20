import { NextResponse } from "next/server"
import { db, eq, teamBranding } from "@/db"
import { requireBrandingManager } from "@/lib/branding-access"
import { verifyDomain } from "@/lib/domain-verify"
import { logAuditEvent } from "@/lib/audit"

// POST — check the published TXT record and, on success, mark the team's
// custom domain as verified (which is what lets it resolve and get a cert).
export async function POST() {
  const guard = await requireBrandingManager()
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status })
  }
  const { userId, teamId, ownerId } = guard

  const row = await db.query.teamBranding.findFirst({
    where: eq(teamBranding.teamId, teamId),
    columns: { customDomain: true },
  })
  if (!row?.customDomain) {
    return NextResponse.json({ error: "No custom domain set" }, { status: 400 })
  }

  const result = await verifyDomain(ownerId, row.customDomain)

  if (result.verified) {
    await db
      .update(teamBranding)
      .set({ domainVerifiedAt: new Date(), updatedAt: new Date() })
      .where(eq(teamBranding.teamId, teamId))

    await logAuditEvent({
      userId,
      action: "branding.domain.verify",
      teamId,
      targetType: "domain",
      targetLabel: row.customDomain,
    })
  }

  return NextResponse.json(result)
}
