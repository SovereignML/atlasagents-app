import { NextResponse } from "next/server"
import dns from "node:dns"
import { db, eq, teamBranding } from "@/db"
import { requireBrandingManager } from "@/lib/branding-access"
import { getCnameTarget } from "@/lib/tenant-branding"
import { getOrCreateVerification } from "@/lib/domain-verify"

// Whether the domain resolves to anything (CNAME flattening / ALIAS records
// mean we can't insist on an exact CNAME match — actual serving is gated by the
// TLS-authorize endpoint, not this probe).
async function dnsResolves(domain: string): Promise<boolean> {
  try {
    await dns.promises.lookup(domain)
    return true
  } catch {
    return false
  }
}

// Whether HTTPS terminates (cert issued) — any HTTP response means the TLS
// handshake succeeded; only connection/TLS errors throw.
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

  const dnsReady = await dnsResolves(domain)
  const dnsStatus = dnsReady ? "ready" : "pending"

  // Only probe TLS once DNS resolves and ownership is verified.
  let tlsStatus = row.tlsStatus
  if (dnsReady && row.domainVerifiedAt) {
    tlsStatus = (await httpsWorks(domain)) ? "issued" : "pending"
  }

  if (dnsStatus !== row.dnsStatus || tlsStatus !== row.tlsStatus) {
    await db
      .update(teamBranding)
      .set({ dnsStatus, tlsStatus, updatedAt: new Date() })
      .where(eq(teamBranding.teamId, teamId))
  }

  const verification = await getOrCreateVerification(ownerId, domain)

  return NextResponse.json({
    connected: true,
    domain,
    verified: row.domainVerifiedAt != null,
    dnsStatus,
    tlsStatus,
    cnameTarget: getCnameTarget(),
    txt: { name: verification.recordName, value: verification.expectedValue },
  })
}
