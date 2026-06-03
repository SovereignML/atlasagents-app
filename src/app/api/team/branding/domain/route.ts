import { NextResponse } from "next/server"
import { z } from "zod"
import { db, eq, and, ne, teamBranding } from "@/db"
import { requireBrandingManager } from "@/lib/branding-access"
import { normalizeCustomDomain, getCnameTarget } from "@/lib/tenant-branding"
import { getOrCreateVerification } from "@/lib/domain-verify"
import {
  cfSaasConfigured,
  createCustomHostname,
  findCustomHostnameByName,
  deleteCustomHostname,
} from "@/lib/cloudflare-saas"
import { logAuditEvent } from "@/lib/audit"

const connectSchema = z.object({ domain: z.string().min(1) })

// POST — attach a custom dashboard domain to the team. Registers a Cloudflare
// for SaaS custom hostname (edge TLS) and mints the TXT record the owner can
// publish to prove ownership. Until Cloudflare reports the cert active (polled
// by the status route), the domain stays unverified and does not resolve.
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

  // If this team had a different domain bound, tear down its old custom hostname.
  const existing = await db.query.teamBranding.findFirst({
    where: eq(teamBranding.teamId, teamId),
    columns: { customDomain: true, cfCustomHostnameId: true },
  })
  if (
    existing?.cfCustomHostnameId &&
    existing.customDomain &&
    existing.customDomain !== domain
  ) {
    await deleteCustomHostname(existing.cfCustomHostnameId).catch(() => {})
  }

  // Ownership verification is keyed by the team OWNER for a stable row.
  const verification = await getOrCreateVerification(ownerId, domain)

  // Register (or reuse) the Cloudflare custom hostname. When CF for SaaS isn't
  // configured (local dev), fall back to the legacy TXT-only verification so
  // the flow still works without an edge.
  let cfCustomHostnameId: string | null = null
  let domainVerifiedAt: Date | null = verification.verified ? new Date() : null
  if (cfSaasConfigured()) {
    try {
      const ch =
        (await findCustomHostnameByName(domain).catch(() => null)) ??
        (await createCustomHostname(domain))
      cfCustomHostnameId = ch.id
    } catch (err) {
      console.error("[branding/domain] createCustomHostname failed:", err)
      return NextResponse.json(
        { error: "Could not register the domain with our edge. Try again shortly." },
        { status: 502 },
      )
    }
    // Serving is gated on CF reporting the cert active (status route flips this).
    domainVerifiedAt = null
  }

  await db
    .insert(teamBranding)
    .values({
      teamId,
      customDomain: domain,
      cfCustomHostnameId,
      domainVerifiedAt,
      dnsStatus: "pending",
      tlsStatus: "pending",
    })
    .onConflictDoUpdate({
      target: teamBranding.teamId,
      set: {
        customDomain: domain,
        cfCustomHostnameId,
        domainVerifiedAt,
        dnsStatus: "pending",
        tlsStatus: "pending",
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
    verified: domainVerifiedAt != null,
    txt: { name: verification.recordName, value: verification.expectedValue },
    cnameTarget: getCnameTarget(),
  })
}

// DELETE — detach the custom domain (keeps other branding intact) and remove
// the Cloudflare custom hostname.
export async function DELETE() {
  const guard = await requireBrandingManager()
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status })
  }
  const { userId, teamId } = guard

  const row = await db.query.teamBranding.findFirst({
    where: eq(teamBranding.teamId, teamId),
    columns: { customDomain: true, cfCustomHostnameId: true },
  })

  if (row?.cfCustomHostnameId) {
    await deleteCustomHostname(row.cfCustomHostnameId).catch((err) =>
      console.error("[branding/domain] deleteCustomHostname failed:", err),
    )
  }

  await db
    .update(teamBranding)
    .set({
      customDomain: null,
      cfCustomHostnameId: null,
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
