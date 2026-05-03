import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { db, instances, eq } from "@/db"
import { whereUserInstanceVisible } from "@/lib/instance-queries"
import { sshInstallCaddyfile, sshRun, sshVmHasCloudflareOriginCerts } from "@/lib/ssh"
import { OPENCLAW_SERVICE_NAME, renderCaddyfile } from "@/lib/openclaw"
import { buildGatewayAllowedOrigins } from "@/lib/instance-gateway-access"

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
  const instance = await db.query.instances.findFirst({
    where: isAdmin ? eq(instances.id, instanceId) : whereUserInstanceVisible(session.user.id, instanceId),
  })
  if (!instance) {
    return NextResponse.json({ error: "Instance not found" }, { status: 404 })
  }
  if (!isAdmin && instance.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  if (instance.status !== "running") {
    return NextResponse.json({ error: "Instance must be running to update domain" }, { status: 400 })
  }
  if (!instance.ipAddress) {
    return NextResponse.json({ error: "Instance has no IP address" }, { status: 400 })
  }

  const body = await req.json().catch(() => ({})) as { domain?: string }
  const domain = body.domain?.trim().toLowerCase() || null

  if (domain && !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)) {
    return NextResponse.json({ error: "Invalid domain format" }, { status: 400 })
  }

  const target = { host: instance.ipAddress }

  try {
    const useCfOriginTls =
      Boolean(instance.managedSubdomain) && (await sshVmHasCloudflareOriginCerts(target))
    const caddyContent = renderCaddyfile({
      domain,
      managedSubdomain: instance.managedSubdomain,
      useCfOriginTls,
    })
    const caddyResult = await sshInstallCaddyfile(target, caddyContent)
    if (caddyResult.code !== 0 && caddyResult.code !== null) {
      throw new Error(
        `Caddy reload failed (exit ${caddyResult.code}): ${caddyResult.stderr || caddyResult.stdout}`,
      )
    }

    const allowedOrigins = buildGatewayAllowedOrigins({
      domain,
      managedSubdomain: instance.managedSubdomain,
      ipAddress: instance.ipAddress,
      tlsStatus: domain ? (instance.tlsStatus ?? "pending") : null,
    })
    const OPENCLAW_DIR = "/opt/openclaw"
    const originStep = await sshRun(
      target,
      `sudo -u openclaw HOME=${OPENCLAW_DIR} /usr/bin/openclaw config set gateway.controlUi.allowedOrigins '${JSON.stringify(allowedOrigins)}' 2>&1`,
    )
    if (originStep.code !== 0 && originStep.code !== null) {
      throw new Error(
        `openclaw config set allowedOrigins failed (exit ${originStep.code}): ${originStep.stderr || originStep.stdout}`,
      )
    }
    const restartStep = await sshRun(
      target,
      `systemctl restart ${OPENCLAW_SERVICE_NAME} 2>&1`,
    )
    if (restartStep.code !== 0 && restartStep.code !== null) {
      throw new Error(
        `systemctl restart ${OPENCLAW_SERVICE_NAME} failed (exit ${restartStep.code}): ${restartStep.stderr || restartStep.stdout}`,
      )
    }
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
      dnsStatus: domain ? "pending" : null,
      tlsStatus: domain ? "pending" : null,
    })
    .where(eq(instances.id, instanceId))

  return NextResponse.json({
    domain,
    dnsStatus: domain ? "pending" : null,
    tlsStatus: domain ? "pending" : null,
    ipAddress: instance.ipAddress,
  })
}
