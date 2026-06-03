import { NextResponse } from "next/server"
import dns from "node:dns"
import { db, eq, teamBranding } from "@/db"
import { requireBrandingManager } from "@/lib/branding-access"
import { getCnameTarget } from "@/lib/tenant-branding"
import { getOrCreateVerification } from "@/lib/domain-verify"
import { getCustomHostname, mapCustomHostnameStatus } from "@/lib/cloudflare-saas"

// Legacy probes — used only when no Cloudflare custom hostname is registered
// (e.g. local dev without CF for SaaS configured).
async function dnsResolves(domain: string): Promise<boolean> {
  try {
    await dns.promises.lookup(domain)
    return true
  } catch {
    return false
  }
}

async function httpsWorks(domain: string): Promise<boolean> {
  try {
    await fetch(`https://${domain}/`, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(4000),
    })
    return true
  } catch {
    return false
  }
}

// GET — poll DNS + TLS state for the team's custom domain and persist any
// progression. Drives the connect-card status badges.
export async function GET() {
  const guard = await requireBrandingManager()
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status })
  }
  const { teamId, ownerId } = guard

  const row = await db.query.teamBranding.findFirst({
    where: eq(teamBranding.teamId, teamId),
  })
  if (!row?.customDomain) {
    return NextResponse.json({ connected: false })
  }
  const domain = row.customDomain

  let dnsStatus = row.dnsStatus
  let tlsStatus = row.tlsStatus
  let domainVerifiedAt = row.domainVerifiedAt

  if (row.cfCustomHostnameId) {
    // Cloudflare for SaaS is the source of truth: cert active = ownership proven
    // (the customer pointed their CNAME at us and DV completed) and serving live.
    try {
      const ch = await getCustomHostname(row.cfCustomHostnameId)
      const mapped = mapCustomHostnameStatus(ch)
      dnsStatus = mapped.dnsStatus
      tlsStatus = mapped.tlsStatus
      if (mapped.active && !domainVerifiedAt) domainVerifiedAt = new Date()
    } catch (err) {
      console.error("[branding/domain/status] getCustomHostname failed:", err)
    }
  } else {
    // Legacy fallback: probe DNS, then TLS once DNS resolves + ownership verified.
    const dnsReady = await dnsResolves(domain)
    dnsStatus = dnsReady ? "ready" : "pending"
    if (dnsReady && row.domainVerifiedAt) {
      tlsStatus = (await httpsWorks(domain)) ? "issued" : "pending"
    }
  }

  if (
    dnsStatus !== row.dnsStatus ||
    tlsStatus !== row.tlsStatus ||
    domainVerifiedAt !== row.domainVerifiedAt
  ) {
    await db
      .update(teamBranding)
      .set({ dnsStatus, tlsStatus, domainVerifiedAt, updatedAt: new Date() })
      .where(eq(teamBranding.teamId, teamId))
  }

  const verification = await getOrCreateVerification(ownerId, domain)

  return NextResponse.json({
    connected: true,
    domain,
    verified: domainVerifiedAt != null,
    dnsStatus,
    tlsStatus,
    cnameTarget: getCnameTarget(),
    txt: { name: verification.recordName, value: verification.expectedValue },
  })
}
