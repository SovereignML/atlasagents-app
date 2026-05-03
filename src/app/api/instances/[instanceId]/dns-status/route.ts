import { NextRequest, NextResponse } from "next/server"
import dns from "node:dns"
import { auth } from "@/auth"
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
  const instance = await db.query.instances.findFirst({
    where: isAdmin ? eq(instances.id, instanceId) : whereUserInstanceVisible(session.user.id, instanceId),
  })
  if (!instance) {
    return NextResponse.json({ error: "Instance not found" }, { status: 404 })
  }
  if (!isAdmin && instance.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  if (instance.status === "deleted") {
    return NextResponse.json({ error: "Instance not found" }, { status: 404 })
  }

  // Probe the managed Cloudflare subdomain when present, otherwise the
  // user-supplied custom domain. If neither is set, DNS state stays NULL.
  const probeHost = instance.managedSubdomain ?? instance.domain
  const isManaged = Boolean(instance.managedSubdomain)

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
    if (isManaged) {
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
