import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getEffectiveUserId } from "@/lib/effective-user"
import { db, instances, eq } from "@/db"
import { whereUserInstanceVisible } from "@/lib/instance-queries"
import { canOperateInstance } from "@/lib/instance-access"
import { reconfigureInstanceIngress } from "@/lib/instance-ingress"
import { logAuditEvent } from "@/lib/audit"
import {
  getCloudflareTokenForTeam,
  listZones,
  findRecordByName,
  upsertDnsRecord,
  deleteDnsRecord,
  getZoneSslMode,
  patchZoneSetting,
  isCloudflareAuthError,
  type CfCtx,
} from "@/lib/cloudflare"
import { cloudflareErrorResponse } from "@/lib/cloudflare-errors"
import { readJsonBody } from "@/lib/request-body"
import { cloudflareDomainSchema } from "@/lib/validations"

const HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/
const LABEL_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/

type LoadedInstance = NonNullable<
  Awaited<ReturnType<typeof db.query.instances.findFirst>>
>

async function loadInstance(
  req: NextRequest,
  instanceId: string,
): Promise<
  | { error: NextResponse }
  | { instance: LoadedInstance; userId: string }
> {
  const session = await auth()
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  }
  const isAdmin = (session.user as { role?: string }).role === "admin"
  const effectiveUserId = (await getEffectiveUserId()) ?? session.user.id
  const instance = await db.query.instances.findFirst({
    where: isAdmin
      ? eq(instances.id, instanceId)
      : whereUserInstanceVisible(effectiveUserId, instanceId),
  })
  if (!instance) {
    return { error: NextResponse.json({ error: "Instance not found" }, { status: 404 }) }
  }
  // Binding/removing a domain is an operation — requires Operator+ on the agent.
  if (!isAdmin && !(await canOperateInstance(effectiveUserId, instance.id))) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  }
  return { instance, userId: session.user.id }
}

/**
 * Re-render Caddy for a domain that is proxied through the user's own
 * Cloudflare (orange-cloud), so it gets `tls internal` rather than Let's
 * Encrypt. Shared with the DIY /domain route — see instance-ingress.ts.
 */
function reconfigureCaddy(
  instance: LoadedInstance,
  domain: string | null,
  proxied: boolean,
): Promise<void> {
  return reconfigureInstanceIngress(instance, { domain, proxied })
}

/**
 * POST /api/instances/[instanceId]/cloudflare-domain
 *
 * Body: { zoneId, label?, overwrite? }. Puts the agent on a subdomain of one
 * of the user's OWN Cloudflare zones: creates a proxied (orange-cloud) A record
 * → the instance IP, sets the zone SSL mode to "Full" if needed, and re-renders
 * Caddy with `tls internal`.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> },
) {
  const { instanceId } = await params
  const loaded = await loadInstance(req, instanceId)
  if ("error" in loaded) return loaded.error
  const { instance, userId } = loaded

  if (instance.status !== "running") {
    return NextResponse.json({ error: "Instance must be running to set a domain" }, { status: 400 })
  }
  if (!instance.ipAddress) {
    return NextResponse.json({ error: "Instance has no IP address" }, { status: 400 })
  }

  const parsed = await readJsonBody(req, cloudflareDomainSchema)
  if (!parsed.ok) return parsed.res
  const body = parsed.data
  const zoneIdParam = body.zoneId
  const label = (body.label ?? "").trim().toLowerCase()
  if (label && label !== "@" && !LABEL_RE.test(label)) {
    return NextResponse.json({ error: "Invalid subdomain label" }, { status: 400 })
  }

  try {
    const token = await getCloudflareTokenForTeam(instance.teamId)
    const zones = await listZones(token)
    const zone = zones.find((z) => z.id === zoneIdParam)
    if (!zone) {
      return NextResponse.json(
        { error: "That zone isn't accessible with the connected token." },
        { status: 400 },
      )
    }

    const host = !label || label === "@" ? zone.name : `${label}.${zone.name}`
    if (!HOST_RE.test(host)) {
      return NextResponse.json({ error: "Resulting hostname is invalid" }, { status: 400 })
    }

    const ctx: CfCtx = { token, zoneId: zone.id }

    // Collision guard: refuse to clobber an existing record that points
    // elsewhere unless the caller explicitly opts in.
    const existing = await findRecordByName(host, ctx)
    if (existing && existing.content !== instance.ipAddress && !body.overwrite) {
      return NextResponse.json(
        {
          error: `An A record for ${host} already exists (→ ${existing.content}). Confirm to overwrite it.`,
          code: "cloudflare_record_conflict",
          existingContent: existing.content,
        },
        { status: 409 },
      )
    }

    // Reconfigure the box FIRST — if SSH/Caddy fails we haven't touched the
    // user's DNS or zone settings yet.
    try {
      await reconfigureCaddy(instance, host, true)
    } catch (err) {
      console.error("[cloudflare-domain] Caddy reconfigure failed:", err)
      return NextResponse.json(
        { error: "Failed to update the server's TLS/proxy configuration." },
        { status: 500 },
      )
    }

    // Create/point the proxied A record.
    const rec = await upsertDnsRecord(
      { name: host, ip: instance.ipAddress, proxied: true },
      ctx,
    )

    // Remove a stale record from a previous binding (different hostname/zone).
    if (
      instance.cfUserRecordId &&
      instance.cfZoneId &&
      (instance.cfUserRecordId !== rec.id || instance.cfZoneId !== zone.id)
    ) {
      try {
        await deleteDnsRecord(instance.cfUserRecordId, {
          token,
          zoneId: instance.cfZoneId,
        })
      } catch {
        // best-effort; old record may already be gone
      }
    }

    // Zone-wide SSL mode. Proxied + self-signed origin needs "Full" (NOT
    // strict). Only raise it from a weaker mode; never downgrade a stricter
    // one. This setting affects EVERY hostname in the user's zone.
    let sslWarning: string | undefined
    try {
      const mode = await getZoneSslMode(ctx)
      if (mode === "strict") {
        sslWarning =
          "Your zone's SSL/TLS mode is Full (strict). A self-signed origin can return error 526. Switch it to 'Full', or install a Cloudflare Origin certificate."
      } else if (mode === null || mode === "off" || mode === "flexible") {
        await patchZoneSetting("ssl", "full", ctx)
      }
      // mode === "full": already correct, leave it.
    } catch (err) {
      if (isCloudflareAuthError(err)) {
        sslWarning =
          "Couldn't set the zone SSL mode (token lacks Zone Settings:Edit). Set your zone's SSL/TLS encryption mode to 'Full' in Cloudflare so HTTPS works."
      } else {
        sslWarning = `Couldn't adjust the zone SSL mode: ${(err as Error).message}`
      }
    }

    await db
      .update(instances)
      .set({
        domain: host,
        domainProxied: true,
        cfZoneId: zone.id,
        cfUserRecordId: rec.id,
        dnsStatus: "pending",
        tlsStatus: "pending",
      })
      .where(eq(instances.id, instance.id))

    await logAuditEvent({
      userId,
      action: "cloudflare.domain.set",
      targetType: "instance",
      targetId: instance.id,
      targetLabel: host,
    })

    return NextResponse.json({
      domain: host,
      domainProxied: true,
      dnsStatus: "pending",
      tlsStatus: "pending",
      sslWarning,
    })
  } catch (err) {
    const mapped = cloudflareErrorResponse(err)
    if (mapped) return mapped
    console.error("[cloudflare-domain] failed:", err instanceof Error ? err.message : err)
    return NextResponse.json({ error: "Failed to configure the Cloudflare domain." }, { status: 500 })
  }
}

/**
 * DELETE /api/instances/[instanceId]/cloudflare-domain
 *
 * Removes the proxied A record from the user's zone (best-effort) and reverts
 * the instance to its managed subdomain / IP. Still clears the binding locally
 * even if Cloudflare is disconnected.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> },
) {
  const { instanceId } = await params
  const loaded = await loadInstance(req, instanceId)
  if ("error" in loaded) return loaded.error
  const { instance, userId } = loaded

  if (instance.status !== "running") {
    return NextResponse.json({ error: "Instance must be running to change domain" }, { status: 400 })
  }
  if (!instance.ipAddress) {
    return NextResponse.json({ error: "Instance has no IP address" }, { status: 400 })
  }

  const removed = instance.domain

  // Delete the user-zone record if we still have a token for it.
  if (instance.cfUserRecordId && instance.cfZoneId) {
    try {
      const token = await getCloudflareTokenForTeam(instance.teamId)
      await deleteDnsRecord(instance.cfUserRecordId, { token, zoneId: instance.cfZoneId })
    } catch {
      // Cloudflare disconnected or record already gone — proceed; the binding
      // is cleared locally regardless.
    }
  }

  try {
    await reconfigureCaddy(instance, null, false)
  } catch (err) {
    console.error("[cloudflare-domain] Caddy revert failed:", err)
    return NextResponse.json(
      { error: "Failed to update the server's configuration." },
      { status: 500 },
    )
  }

  await db
    .update(instances)
    .set({
      domain: null,
      domainProxied: false,
      cfZoneId: null,
      cfUserRecordId: null,
      dnsStatus: null,
      tlsStatus: null,
    })
    .where(eq(instances.id, instance.id))

  await logAuditEvent({
    userId,
    action: "cloudflare.domain.remove",
    targetType: "instance",
    targetId: instance.id,
    targetLabel: removed ?? undefined,
  })

  return NextResponse.json({ domain: null })
}
