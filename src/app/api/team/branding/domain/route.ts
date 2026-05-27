import { NextResponse } from "next/server"
import { z } from "zod"
import { db, eq, and, ne, teamBranding } from "@/db"
import { requireBrandingManager } from "@/lib/branding-access"
import { normalizeCustomDomain, getCnameTarget } from "@/lib/tenant-branding"
import { getOrCreateVerification } from "@/lib/domain-verify"
import { logAuditEvent } from "@/lib/audit"

const connectSchema = z.object({ domain: z.string().min(1) })

// POST — attach a custom dashboard domain to the team and mint the TXT record
// the owner must publish to prove ownership.
export async function POST(req: Request) {
  const guard = await requireBrandingManager()
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status })
  }
  const { userId, teamId, ownerId } = guard

  const body = await req.json().catch(() => null)
  const parsed = connectSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 })
  }

  const domain = normalizeCustomDomain(parsed.data.domain)
  if (!domain) {
    return NextResponse.json(
      { error: "Enter a valid domain (e.g. app.yourbrand.com)" },
      { status: 400 },
    )
  }

  // Globally unique across teams.
  const taken = await db.query.teamBranding.findFirst({
    where: and(eq(teamBranding.customDomain, domain), ne(teamBranding.teamId, teamId)),
    columns: { teamId: true },
  })
  if (taken) {
    return NextResponse.json(
      { error: "That domain is already in use by another team", code: "domain_conflict" },
      { status: 409 },
    )
  }

  // Ownership verification is keyed by the team OWNER for a stable row.
  const verification = await getOrCreateVerification(ownerId, domain)

  await db
    .insert(teamBranding)
    .values({
      teamId,
      customDomain: domain,
      domainVerifiedAt: verification.verified ? new Date() : null,
      dnsStatus: "pending",
      tlsStatus: null,
    })
    .onConflictDoUpdate({
      target: teamBranding.teamId,
      set: {
        customDomain: domain,
        domainVerifiedAt: verification.verified ? new Date() : null,
        dnsStatus: "pending",
        tlsStatus: null,
        updatedAt: new Date(),
      },
    })

  await logAuditEvent({
    userId,
    action: "branding.domain.set",
    teamId,
    targetType: "domain",
    targetLabel: domain,
  })

  return NextResponse.json({
    domain,
    verified: verification.verified,
    txt: { name: verification.recordName, value: verification.expectedValue },
    cnameTarget: getCnameTarget(),
  })
}

// DELETE — detach the custom domain (keeps other branding intact).
export async function DELETE() {
  const guard = await requireBrandingManager()
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status })
  }
  const { userId, teamId } = guard

  const row = await db.query.teamBranding.findFirst({
    where: eq(teamBranding.teamId, teamId),
    columns: { customDomain: true },
  })

  await db
    .update(teamBranding)
    .set({
      customDomain: null,
      domainVerifiedAt: null,
      dnsStatus: null,
      tlsStatus: null,
      updatedAt: new Date(),
    })
    .where(eq(teamBranding.teamId, teamId))

  await logAuditEvent({
    userId,
    action: "branding.domain.remove",
    teamId,
    targetType: "domain",
    targetLabel: row?.customDomain ?? undefined,
  })

  return NextResponse.json({ ok: true })
}
