import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { db, instances, eq } from "@/db"
import { whereUserInstanceVisible } from "@/lib/instance-queries"
import { canOperateInstance } from "@/lib/instance-access"
import { sshInstallCaddyfile, sshRun, sshWriteFile, sshVmHasCloudflareOriginCerts } from "@/lib/ssh"
import { getRuntime } from "@/lib/runtimes"
import { decryptSecret } from "@/lib/crypto-secret"
import { routeModel } from "@/lib/model-router"
import type { BudgetTier } from "@/lib/agent-config"

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
  // Setting the domain is an operation — Operator+ on the agent.
  if (!isAdmin && !(await canOperateInstance(session.user.id, instance.id))) {
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

  const target = { host: instance.ipAddress, instanceId: instance.id }
  const runtime = getRuntime(instance.runtime)

  try {
    const useCfOriginTls =
      Boolean(instance.managedSubdomain) && (await sshVmHasCloudflareOriginCerts(target))
    const caddyContent = runtime.renderCaddyfile({
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

    // Re-render the full gateway config (which recomputes controlUi.allowedOrigins
    // for the new domain) and write it back. This is runtime-agnostic — it avoids
    // depending on a runtime-specific `config set` CLI. The gateway token is
    // preserved by decrypting the persisted ciphertext; the LLM model fields come
    // from the instance's tier. The OpenRouter key is not stored in this config
    // (it lives in .env), so an empty placeholder is fine here.
    if (instance.gatewayTokenEnc) {
      const route = routeModel((instance.modelTier ?? "mid") as BudgetTier)
      const configContent = runtime.renderConfig({
        gatewayToken: decryptSecret(instance.gatewayTokenEnc),
        openRouterApiKey: "",
        model: route.model,
        fallbackModel: route.fallback,
        domain,
        managedSubdomain: instance.managedSubdomain,
        ipAddress: instance.ipAddress,
        tlsStatus: domain ? (instance.tlsStatus ?? "pending") : null,
      })
      const writeStep = await sshWriteFile(target, runtime.paths.configPath, configContent)
      if (writeStep.code !== 0 && writeStep.code !== null) {
        throw new Error(
          `writing ${runtime.displayName} config failed (exit ${writeStep.code}): ${writeStep.stderr || writeStep.stdout}`,
        )
      }
      const owner = runtime.paths.systemUser
      await sshRun(
        target,
        `chown -R ${owner}:${owner} '${runtime.paths.installDir}/${runtime.paths.configSubdir}'`,
      )
    }

    const restartStep = await sshRun(
      target,
      `systemctl restart ${runtime.serviceName} 2>&1`,
    )
    if (restartStep.code !== 0 && restartStep.code !== null) {
      throw new Error(
        `systemctl restart ${runtime.serviceName} failed (exit ${restartStep.code}): ${restartStep.stderr || restartStep.stdout}`,
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
