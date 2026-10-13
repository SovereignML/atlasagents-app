import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAdmin } from "@/lib/admin-guard"
import { db, teams, teamBranding, eq } from "@/db"
import { logAuditEvent } from "@/lib/audit"
import { deleteCustomHostname, cfSaasConfigured } from "@/lib/cloudflare-saas"

const schema = z.object({
  whiteLabelEnabled: z.boolean(),
})

/**
 * PATCH /api/admin/teams/[teamId]
 *
 * Platform-admin white-label toggle. `Team.whiteLabelEnabled` is the sole source
 * of truth for white-label entitlement (branding, custom domains, reseller
 * panel), so flipping it here grants or revokes the feature for the team live.
 * Recorded in the audit log.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ teamId: string }> },
) {
  const guard = await requireAdmin()
  if (!guard.ok) return guard.res

  const { teamId } = await params
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 },
    )
  }
  const { whiteLabelEnabled } = parsed.data

  const team = await db.query.teams.findFirst({
    where: eq(teams.id, teamId),
    columns: { id: true, name: true },
  })
  if (!team) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 })
  }

  await db
    .update(teams)
    .set({ whiteLabelEnabled })
    .where(eq(teams.id, teamId))

  // Revocation teardown: the entitlement contract (white-label.ts) is that
  // flipping the flag off stops cert renewal immediately. Tear down the team's
  // Cloudflare-for-SaaS custom hostname so its DV cert stops auto-renewing and
  // the domain no longer resolves to a tenant. Best-effort — a CF failure must
  // not block the toggle (the branding row is cleared regardless; a reconciler
  // sweep can catch a stranded CF hostname). Stored config is preserved apart
  // from the domain fields, so re-enabling re-registers cleanly.
  if (!whiteLabelEnabled) {
    const branding = await db.query.teamBranding.findFirst({
      where: eq(teamBranding.teamId, teamId),
      columns: { cfCustomHostnameId: true },
    })
    if (branding?.cfCustomHostnameId && cfSaasConfigured()) {
      try {
        await deleteCustomHostname(branding.cfCustomHostnameId)
      } catch (err) {
        console.error(`[admin.whitelabel_toggle] CF hostname teardown failed for team ${teamId}:`, err)
      }
    }
    if (branding) {
      await db
        .update(teamBranding)
        .set({
          cfCustomHostnameId: null,
          customDomain: null,
          domainVerifiedAt: null,
          dnsStatus: null,
          tlsStatus: null,
        })
        .where(eq(teamBranding.teamId, teamId))
    }
  }

  await logAuditEvent({
    userId: guard.userId,
    action: "admin.whitelabel_toggle",
    targetType: "team",
    targetId: team.id,
    targetLabel: team.name,
    meta: { whiteLabelEnabled },
  })

  return NextResponse.json({ ok: true, id: team.id, whiteLabelEnabled })
}
