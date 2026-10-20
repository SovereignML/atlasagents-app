/**
 * Re-render an instance's public ingress (Caddy + gateway config + sidecar URL)
 * over SSH after its custom domain changes, and restart what needs restarting.
 *
 * Both domain routes go through here — `/api/instances/[id]/domain` (DIY: the
 * user points an A record at the box, Caddy gets a Let's Encrypt cert) and
 * `/api/instances/[id]/cloudflare-domain` (Bring-Your-Own-Cloudflare: we create
 * a proxied/orange-cloud record in the user's zone, so Caddy must serve a
 * self-signed cert instead — ACME can't complete behind the CF edge).
 *
 * This mirrors the provisioner's ingress rendering (see `provisionVps` in
 * provisioner.ts). They used to be separate copies, which is how the two routes
 * silently drifted away from the Hermes runtime: they dropped `upstreamPort`
 * (killing the chat UI route) and ignored `managesOwnConfig` (overwriting the
 * CLI-generated config.yaml with a stub). Keep this the single source of truth.
 */

import type { db } from "@/db"
import { sshInstallCaddyfile, sshRun, sshWriteFile } from "@/lib/ssh"
import { ensureManagedOriginCert } from "@/lib/agent-origin-cert"
import { getRuntime } from "@/lib/runtimes"
import { toolServicesForIds } from "@/configs/agent-tools"
import { decryptSecret } from "@/lib/crypto-secret"
import { routeModel } from "@/lib/model-router"
import { sshTargetForInstance } from "@/lib/ssh-target"
import type { BudgetTier } from "@/lib/agent-config"

type LoadedInstance = NonNullable<
  Awaited<ReturnType<typeof db.query.instances.findFirst>>
>

export type ReconfigureIngressOpts = {
  /** The new custom domain, or null to fall back to the managed subdomain / :80. */
  domain: string | null
  /** True when `domain` sits behind the user's own Cloudflare proxy (orange-cloud). */
  proxied: boolean
}

/**
 * Re-render Caddy for `domain`, refresh anything downstream that embeds the
 * public hostname, and restart the affected services. Throws on failure — the
 * callers persist the new domain only after this resolves, so a failed SSH
 * leaves the DB (and, for the BYO-CF path, the user's DNS) untouched.
 */
export async function reconfigureInstanceIngress(
  instance: LoadedInstance,
  opts: ReconfigureIngressOpts,
): Promise<void> {
  const target = sshTargetForInstance(instance)
  const runtime = getRuntime(instance.runtime)
  const { domain, proxied } = opts

  // Chat UI sidecar: when enabled, Caddy fronts the sidecar and
  // path-routes /v1/* to the loopback-only gateway. Same expression the
  // provisioner uses — without `upstreamPort` the renderer drops to
  // single-upstream mode and the chat UI disappears from the public host.
  const webuiEnabled = Boolean(instance.webuiEnabled) && Boolean(runtime.sidecar)

  // Installs the origin cert for the managed hostname's own zone (the same
  // helper first provision uses), so a domain change never re-renders the
  // managed site block with a cert for the wrong zone, or with none.
  const { useCfOriginTls } = await ensureManagedOriginCert(target, instance.managedSubdomain)

  const caddyContent = runtime.renderCaddyfile({
    domain,
    managedSubdomain: instance.managedSubdomain,
    useCfOriginTls,
    domainUseInternalTls: Boolean(domain) && proxied,
    upstreamPort: webuiEnabled && runtime.sidecar ? runtime.sidecar.port : undefined,
    // Preserve companion-service routes (e.g. `/n8n/`) across a domain change.
    toolServices: toolServicesForIds(instance.enabledTools ?? []).map((s) => ({
      pathPrefix: s.caddyPathPrefix,
      port: s.port,
    })),
  })
  const caddyResult = await sshInstallCaddyfile(target, caddyContent)
  if (caddyResult.code !== 0 && caddyResult.code !== null) {
    throw new Error(
      `Caddy reload failed (exit ${caddyResult.code}): ${caddyResult.stderr || caddyResult.stdout}`,
    )
  }

  // Runtimes that manage their own config (Hermes drives `hermes config set` via
  // its own CLI) must NOT have it hand-rendered — `renderConfig` is only a
  // documented fallback stub for them, and writing it would drop toolsets,
  // terminal.backend, browser.provider and model.base_url. Same guard as the
  // provisioner. For OpenClaw this still re-renders, which is what recomputes
  // controlUi.allowedOrigins for the new domain.
  if (!runtime.managesOwnConfig && instance.gatewayTokenEnc) {
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

  const restartStep = await sshRun(target, `systemctl restart ${runtime.serviceName} 2>&1`)
  if (restartStep.code !== 0 && restartStep.code !== null) {
    throw new Error(
      `systemctl restart ${runtime.serviceName} failed (exit ${restartStep.code}): ${restartStep.stderr || restartStep.stdout}`,
    )
  }
}
