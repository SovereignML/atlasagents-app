import { NextResponse } from "next/server"
import { db, eq, teamBranding } from "@/db"
import { requireBrandingManager } from "@/lib/branding-access"
import { verifyDomain } from "@/lib/domain-verify"
import { cfSaasConfigured } from "@/lib/cloudflare-saas"
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
    columns: { customDomain: true, cfCustomHostnameId: true },
  })
  if (!row?.customDomain) {
    return NextResponse.json({ error: "No custom domain set" }, { status: 400 })
  }

  const result = await verifyDomain(ownerId, row.customDomain)

  // In Cloudflare-for-SaaS mode the domain is only truly "verified" once the CF
  // cert goes active (the customer pointed their CNAME and DV completed) — that
  // stamp happens in the status route / reconciler. Stamping domainVerifiedAt on
  // a TXT match alone here would map a host that isn't actually serving. So in CF
  // mode we confirm ownership (TXT) but leave activation to the cert check.
  const cfMode = cfSaasConfigured() && Boolean(row.cfCustomHostnameId)

  if (result.verified && !cfMode) {
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

  return NextResponse.json(
    cfMode ? { ...result, pendingCertActivation: true } : result,
  )
}
