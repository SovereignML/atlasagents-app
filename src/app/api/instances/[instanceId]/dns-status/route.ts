import { NextRequest, NextResponse } from "next/server"
import dns from "node:dns"
import { auth } from "@/auth"
import { getEffectiveUserId } from "@/lib/effective-user"
import { db, instances, eq } from "@/db"
import { whereUserInstanceVisible } from "@/lib/instance-queries"

type DnsStatus = "pending" | "propagating" | "ready" | "error"
type TlsStatus = "pending" | "issued" | "failed"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { instanceId } = await params
  const isAdmin = (session.user as { role?: string }).role === "admin"
  const effectiveUserId = (await getEffectiveUserId()) ?? session.user.id
  const instance = await db.query.instances.findFirst({
    where: isAdmin ? eq(instances.id, instanceId) : whereUserInstanceVisible(effectiveUserId, instanceId),
  })
  if (!instance) {
    return NextResponse.json({ error: "Instance not found" }, { status: 404 })
  }
  // Read-only — whereUserInstanceVisible already enforces visibility (Viewer+).
  if (instance.status === "deleted") {
    return NextResponse.json({ error: "Instance not found" }, { status: 404 })
  }

  // Probe the CUSTOM domain when one is set, falling back to the managed
  // subdomain. The custom domain is what the user is actually waiting on, what
  // the DnsCard renders, and what buildPublicGatewayUrl gates https:// on. The
  // managed subdomain is live from the moment the platform mints it, so probing
  // it in preference would report "ready"/"issued" off a hostname nobody is
  // waiting for while the custom domain sits unresolved.
  const probeHost = instance.domain ?? instance.managedSubdomain

  // Is the host we're about to probe behind a Cloudflare proxy? A proxied host
  // resolves to CF anycast IPs and never to the origin, so an exact-IP match is
  // impossible — any A record means it's live. The platform's managed subdomain
  // is always proxied (see createAgentSubdomain); a custom domain is proxied only
  // on the Bring-Your-Own-Cloudflare path.
  const proxied = instance.domain ? instance.domainProxied : true

  if (!probeHost) {
    return NextResponse.json({
      domain: null,
      managedSubdomain: null,
      dnsStatus: null,
      tlsStatus: null,
      resolvedIps: [],
      expectedIp: instance.ipAddress,
    })
  }

  let resolvedIps: string[] = []
  let dnsStatus: DnsStatus = (instance.dnsStatus as DnsStatus) ?? "pending"
  try {
    resolvedIps = await dns.promises.resolve4(probeHost)
    if (proxied) {
      // Cloudflare-proxied: any A record means CF anycast IPs are live —
      // that's "ready" from our perspective. The origin IP is hidden.
      if (resolvedIps.length > 0) dnsStatus = "ready"
    } else if (instance.ipAddress && resolvedIps.includes(instance.ipAddress)) {
      dnsStatus = "ready"
    } else if (resolvedIps.length > 0) {
      dnsStatus = "propagating"
    }
  } catch {
    // NXDOMAIN / NOTFOUND — still pending.
    dnsStatus = "pending"
  }

  let tlsStatus: TlsStatus = (instance.tlsStatus as TlsStatus) ?? "pending"
  if (dnsStatus === "ready") {
    try {
      const probe = await fetch(`https://${probeHost}/`, {
        method: "HEAD",
        redirect: "manual",
        signal: AbortSignal.timeout(5000),
      })
      if (probe.status < 500) tlsStatus = "issued"
    } catch {
      // Cert may not yet be issued — leave as-is.
    }
  }

  if (dnsStatus !== instance.dnsStatus || tlsStatus !== instance.tlsStatus) {
    await db
      .update(instances)
      .set({ dnsStatus, tlsStatus })
      .where(eq(instances.id, instance.id))
  }

  return NextResponse.json({
    domain: instance.domain,
    managedSubdomain: instance.managedSubdomain,
    dnsStatus,
    tlsStatus,
    resolvedIps,
    expectedIp: instance.ipAddress,
  })
}
