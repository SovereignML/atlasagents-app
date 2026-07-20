import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getEffectiveUserId } from "@/lib/effective-user"
import { db, instances, eq } from "@/db"
import { whereUserInstanceVisible } from "@/lib/instance-queries"
import { canOperateInstance } from "@/lib/instance-access"
import { reconfigureInstanceIngress } from "@/lib/instance-ingress"
import {
  isValidHostname,
  lookupDomainA,
  lookupDomainNs,
  normalizeHostname,
} from "@/lib/domain-dns"

export async function POST(
  req: NextRequest,
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
  // Setting the domain is an operation — Operator+ on the agent.
  if (!isAdmin && !(await canOperateInstance(effectiveUserId, instance.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  if (instance.status !== "running") {
    return NextResponse.json({ error: "Instance must be running to update domain" }, { status: 400 })
  }
  if (!instance.ipAddress) {
    return NextResponse.json({ error: "Instance has no IP address" }, { status: 400 })
  }

  const body = await req.json().catch(() => ({})) as {
    domain?: string
    /** When true, only run format + NS (+ optional A) checks — no Caddy/DB write. */
    checkOnly?: boolean
  }
  const domain = body.domain ? normalizeHostname(body.domain) || null : null

  if (domain && !isValidHostname(domain)) {
    return NextResponse.json({ error: "Invalid domain format" }, { status: 400 })
  }

  let nsInfo: { apex: string; nameservers: string[] } | null = null
  let resolvedIps: string[] = []
  if (domain) {
    const ns = await lookupDomainNs(domain)
    if (!ns.ok) {
      return NextResponse.json({ error: ns.error }, { status: 400 })
    }
    nsInfo = { apex: ns.apex, nameservers: ns.nameservers }
    resolvedIps = await lookupDomainA(domain)
  }

  if (body.checkOnly) {
    return NextResponse.json({
      ok: true,
      domain,
      apex: nsInfo?.apex ?? null,
      nameservers: nsInfo?.nameservers ?? [],
      resolvedIps,
      expectedIp: instance.ipAddress,
      aRecordMatches:
        Boolean(instance.ipAddress) && resolvedIps.includes(instance.ipAddress!),
    })
  }

  try {
    // Direct (grey-cloud) custom domain — the user points an A record at the box
    // and Caddy provisions Let's Encrypt. The orange-cloud case goes through
    // /cloudflare-domain instead, which passes proxied: true.
    await reconfigureInstanceIngress(instance, { domain, proxied: false })
  } catch (err) {
    console.error(`[domain] Failed to update Caddy config:`, err)
    return NextResponse.json(
      { error: "Failed to update domain configuration" },
      { status: 500 }
    )
  }

  await db
    .update(instances)
    .set({
      domain,
      // This path always renders Caddy for a direct (grey-cloud) domain, so the
      // flag has to follow. Leaving a stale `true` from an earlier
      // Bring-Your-Own-Cloudflare binding would make dns-status skip the
      // exact-IP check and report "ready" off any A record. cfZoneId /
      // cfUserRecordId are left intact so the Cloudflare DELETE route can still
      // clean up a record it created.
      domainProxied: false,
      dnsStatus: domain ? "pending" : null,
      tlsStatus: domain ? "pending" : null,
    })
    .where(eq(instances.id, instanceId))

  return NextResponse.json({
    domain,
    dnsStatus: domain ? "pending" : null,
    tlsStatus: domain ? "pending" : null,
    ipAddress: instance.ipAddress,
    apex: nsInfo?.apex ?? null,
    nameservers: nsInfo?.nameservers ?? [],
    resolvedIps,
    aRecordMatches:
      Boolean(domain && instance.ipAddress) &&
      resolvedIps.includes(instance.ipAddress!),
  })
}
