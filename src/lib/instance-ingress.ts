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
 * (killing the Open WebUI route) and ignored `managesOwnConfig` (overwriting the
 * CLI-generated config.yaml with a stub). Keep this the single source of truth.
 */

import type { db } from "@/db"
import {
  sshInstallCaddyfile,
  sshRun,
  sshWriteFile,
  sshVmHasCloudflareOriginCerts,
} from "@/lib/ssh"
import { getRuntime } from "@/lib/runtimes"
import type { SidecarSpec } from "@/lib/runtimes/types"
import { decryptSecret } from "@/lib/crypto-secret"
import { routeModel } from "@/lib/model-router"
import { buildPublicGatewayUrl } from "@/lib/instance-gateway-access"
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

function bashSingleQuoteForScript(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
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
  const target = { host: instance.ipAddress as string, instanceId: instance.id }
  const runtime = getRuntime(instance.runtime)
  const { domain, proxied } = opts

  // Open WebUI sidecar (Hermes): when enabled, Caddy fronts the sidecar and
  // path-routes /v1/* to the loopback-only gateway. Same expression the
  // provisioner uses — without `upstreamPort` the renderer drops to
  // single-upstream mode and the chat UI disappears from the public host.
  const webuiEnabled = Boolean(instance.webuiEnabled) && Boolean(runtime.sidecar)

  const useCfOriginTls =
    Boolean(instance.managedSubdomain) && (await sshVmHasCloudflareOriginCerts(target))

  const caddyContent = runtime.renderCaddyfile({
    domain,
    managedSubdomain: instance.managedSubdomain,
    useCfOriginTls,
    domainUseInternalTls: Boolean(domain) && proxied,
    upstreamPort: webuiEnabled && runtime.sidecar ? runtime.sidecar.port : undefined,
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

  if (webuiEnabled && runtime.sidecar) {
    await refreshSidecarPublicUrl(instance, runtime.sidecar, domain)
  }
}

/**
 * Open WebUI bakes its public URL into WEBUI_URL at provision time; after a
 * domain change the stale value produces wrong absolute links and redirects.
 *
 * Patch that ONE key in place. Do not re-render the sidecar env file wholesale:
 * `renderEnv` takes `enableSignup`, and the provisioner deliberately flips
 * ENABLE_SIGNUP=false once the admin account is seeded. A full re-render would
 * silently reopen public signup on the agent's chat UI.
 */
async function refreshSidecarPublicUrl(
  instance: LoadedInstance,
  sidecar: SidecarSpec,
  domain: string | null,
): Promise<void> {
  const publicUrl =
    buildPublicGatewayUrl({
      domain,
      managedSubdomain: instance.managedSubdomain,
      // A freshly-bound domain has no cert yet — buildPublicGatewayUrl only
      // returns https:// once tlsStatus is "issued".
      tlsStatus: domain ? (instance.tlsStatus ?? "pending") : null,
      ipAddress: instance.ipAddress,
    })?.url ?? null
  if (!publicUrl) return

  const target = { host: instance.ipAddress as string, instanceId: instance.id }
  const envPath = bashSingleQuoteForScript(sidecar.envPath)
  const service = bashSingleQuoteForScript(sidecar.serviceName)
  // `|` as the sed delimiter — the value is a URL and contains slashes.
  const value = bashSingleQuoteForScript(publicUrl)

  const step = await sshRun(
    target,
    `set -uo pipefail
ENV_PATH=${envPath}
URL=${value}
if grep -q '^WEBUI_URL=' "\${ENV_PATH}"; then
  sed -i "s|^WEBUI_URL=.*|WEBUI_URL=\${URL}|" "\${ENV_PATH}"
else
  echo "WEBUI_URL=\${URL}" >> "\${ENV_PATH}"
fi
systemctl restart ${service} 2>&1`,
  )
  if (step.code !== 0 && step.code !== null) {
    throw new Error(
      `refreshing ${sidecar.serviceName} WEBUI_URL failed (exit ${step.code}): ${step.stderr || step.stdout}`,
    )
  }
}
