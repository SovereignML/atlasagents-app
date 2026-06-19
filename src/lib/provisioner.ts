import crypto from "node:crypto"
import type { InferSelectModel } from "drizzle-orm"
import { db, instances, instanceLogs, regions, serverConfigs, providerHealthLogs, eq } from "@/db"
import {
  logInstanceEvent,
  transitionInstance,
  withInstanceLock,
  ensureProvisioningFailed,
} from "@/lib/instance-state"
import { reserveHostSlot, FleetEmptyError, FleetFullError } from "@/lib/host-scheduler"
import {
  sshDockerRestart,
  sshDockerRm,
  sshDockerRun,
  sshDockerStart,
  sshDockerStop,
  sshPollBootstrap,
  sshRun,
  sshRunScriptLogged,
  sshVmHasCloudflareOriginCerts,
  type SshStepResult,
  sshSystemctlRestart,
  sshSystemctlStart,
  sshSystemctlStop,
  sshWaitReady,
  type SshTarget,
  normalizePem,
  isValidPem,
} from "@/lib/ssh"
import { decryptSecret, encryptSecret } from "@/lib/crypto-secret"
import { mintRuntimeKey, revokeRuntimeKey } from "@/lib/openrouter-provisioning"
import { computeKeyLimitUsd } from "@/lib/openrouter-billing"
import { refundProratedDailyCompute } from "@/lib/daily-billing"
import { getTenantOpenRouterKey } from "@/lib/tenant"
import {
  generateAdminPassword,
  generateGatewayToken,
  renderEnvFile,
} from "@/lib/runtimes/shared"
import { getRuntime, type RuntimeEngine, type RuntimeId } from "@/lib/runtimes"
import { PROVISION_EVENT } from "@/lib/provision-events"
import { getVmProvider, describeVmError, type VmProvider } from "@/lib/vm-provider"
import {
  getVmProviderById,
  getVmProviderBySlug,
  describeProviderError,
} from "@/lib/providers"
import { routeDeployment, logRoutingDecision, type Candidate } from "@/lib/vps-router"
import { MAX_FAILOVER_ATTEMPTS } from "@/configs/routing"
import { createAgentSubdomain, deleteAgentSubdomain } from "@/lib/agent-dns"
import { deleteDnsRecord, getCloudflareTokenForTeam } from "@/lib/cloudflare"
import { generateMockIp } from "@/lib/instance"
import { buildPublicGatewayUrl } from "@/lib/instance-gateway-access"
import { notify } from "@/lib/notifications/dispatch"
import { syncUptimeMonitor, removeUptimeMonitor } from "@/lib/uptime-monitoring"
import {
  routeModel,
  effectiveModel,
  isValidOpenRouterSlug,
  resolveLlmProvider,
  nvidiaKeyForSlot,
  type LlmProvider,
} from "@/lib/model-router"
import type { BudgetTier } from "@/lib/agent-config"
import { generateAgentsMd, generateIdentityMd } from "@/lib/agent-identity"
import { enabledToolsForRuntime, type AgentTool } from "@/configs/agent-tools"

type Instance = InferSelectModel<typeof instances>

const BOT_RUNTIME_IMAGE = () =>
  process.env.BOT_RUNTIME_IMAGE || "ghcr.io/sovereignml/sovereign-bot-runtime:latest"

const NEXT_PUBLIC_GATEWAY_BASE_URL = () =>
  process.env.NEXT_PUBLIC_GATEWAY_BASE_URL || "http://localhost:3000"

/**
 * Legacy shared OpenRouter key. Still used by `buildBotEnv` for shared-cluster
 * bot-runtime containers (their per-instance key migration is a separate
 * change). VPS / OpenClaw instances now mint their own key via
 * `getOrMintInstanceOpenRouterKey` below.
 */
const OPENROUTER_API_KEY = () => process.env.OPENROUTER_API_KEY || ""

/**
 * Return the per-instance OpenRouter runtime key for this instance, minting
 * one via OpenRouter's Provisioning API if it doesn't exist yet.
 *
 * Idempotent across retries — once `openRouterKeyEnc` is persisted on the
 * row, subsequent calls decrypt and return without minting again. The
 * existing per-instance advisory lock around provisionVps/reprovisionBotEnv
 * prevents concurrent mint races.
 *
 * `mintFn` is parameterised so tests can inject a counter (see
 * scripts/test-openrouter-key-mint.ts).
 *
 * If `mintRuntimeKey` throws (e.g. missing OPENROUTER_PROVISIONING_KEY,
 * upstream 5xx, rate limit), the error propagates up through the
 * provisioner's failure path so the instance lands in failed_provisioning
 * with the cause visible in instanceLogs. We do NOT silently fall back to
 * the shared key — that would re-introduce the fleet-wide blast radius
 * this change is intended to eliminate.
 */
export async function getOrMintInstanceOpenRouterKey(
  instance: Instance,
  mintFn: typeof mintRuntimeKey = mintRuntimeKey,
): Promise<string> {
  if (instance.openRouterKeyEnc) {
    return decryptSecret(instance.openRouterKeyEnc)
  }
  // White-label reseller agents mint under the TENANT's own OpenRouter account,
  // so the tenant bears their customers' LLM cost. Those keys are NOT capped by
  // the platform wallet (the tenant's OpenRouter account governs spend) and are
  // excluded from the platform usage-sync poller (see src/lib/openrouter-usage.ts).
  const tenantKey = await getTenantOpenRouterKey(instance.teamId)
  // Otherwise cap the fresh key at the owner's CURRENT spendable balance ×
  // margin (USD) — usage starts at 0, so computeKeyLimitUsd returns exactly the
  // remaining headroom. This is the hard floor on our cost, enforced
  // server-side by OpenRouter even if the usage poller stalls, and (unlike the
  // old lifetime-funded cap) it doesn't hand a reprovisioned key a fresh full
  // ceiling. See src/lib/openrouter-billing.ts.
  const limitUsd = tenantKey ? undefined : await computeKeyLimitUsd(instance.userId)
  // Human-readable label so the key is identifiable in the OpenRouter dashboard
  // (e.g. `Sovereign-OpenClaw-acme-support-bot`). The agent slug is already
  // label-safe. The label is purely cosmetic — orphan detection/cap-drift in the
  // reconciler matches on `instances.openRouterKeyId`, NOT on the label text, so
  // the format can change freely without risking a live key being mis-parsed and
  // revoked. Pre-existing `sovereign-<id>` keys keep working unchanged.
  const { keyId, key } = await mintFn(
    { label: `Sovereign-OpenClaw-${instance.slug}`, limitUsd },
    tenantKey ?? undefined,
  )
  await db
    .update(instances)
    .set({
      openRouterKeyId: keyId,
      openRouterKeyEnc: encryptSecret(key),
      openRouterLimitUsd: limitUsd,
    })
    .where(eq(instances.id, instance.id))
  return key
}

/**
 * Resolve the runtime's OpenRouter key, honoring the instance's LLM provider.
 * NVIDIA-primary bots don't touch OpenRouter at all, so we skip minting (and the
 * OPENROUTER_PROVISIONING_KEY requirement) and return "" — this is what lets the
 * platform run with zero OpenRouter credits. OpenRouter bots mint/reuse as usual.
 */
async function resolveRuntimeOpenRouterKey(
  instance: Instance,
  provider: LlmProvider = "openrouter",
): Promise<string> {
  if (provider === "nvidia") return ""
  return getOrMintInstanceOpenRouterKey(instance)
}

/**
 * Revoke the per-instance OpenRouter runtime key (if any) and clear the
 * persisted ciphertext. Called from `deleteBot` before the state machine
 * transitions to `deleted`. Failures are logged but do NOT block deletion —
 * the reconciler's orphan-key pass picks up anything we miss.
 */
async function revokeInstanceOpenRouterKey(instance: Instance): Promise<void> {
  if (!instance.openRouterKeyId) return
  try {
    await revokeRuntimeKey(instance.openRouterKeyId)
    await db
      .update(instances)
      .set({ openRouterKeyId: null, openRouterKeyEnc: null })
      .where(eq(instances.id, instance.id))
    await logInstanceEvent({
      instanceId: instance.id,
      stage: "delete",
      action: "openrouter_key_revoke",
      result: "ok",
      message: `OpenRouter runtime key ${instance.openRouterKeyId} revoked.`,
    })
  } catch (err) {
    await logInstanceEvent({
      instanceId: instance.id,
      level: "warn",
      stage: "delete",
      action: "openrouter_key_revoke",
      result: "error",
      detail: { keyId: instance.openRouterKeyId },
      message: `OpenRouter key revoke failed (reconciler will retry): ${
        err instanceof Error ? err.message : String(err)
      }`,
    })
  }
}

// Used only on the legacy no-mapping path (routeDeployment returns zero
// candidates). DigitalOcean codes, matching the env-default provider + the
// Frankfurt-only region.
const FALLBACK_REGION = "fra1"
const FALLBACK_PLAN = "s-2vcpu-4gb"

function bashSingleQuoteForScript(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/**
 * Phase A — write `.env` + the runtime's JSON config + workspace identity
 * files. Replaces the old onboard + 11x sequential `config set` CLI calls with
 * a single script that drops all files. ~5s instead of ~63s. All paths,
 * filenames, and the owning system user come from the runtime adapter so this
 * works for OpenClaw, Hermes, or any future runtime.
 */
function buildPhaseWriteConfig(opts: {
  runtime: RuntimeEngine
  envB64: string
  /** Rendered config file. Omitted for `managesOwnConfig` runtimes (Hermes writes its own
   *  config via the CLI in the runtime-init step), in which case the write is skipped. */
  configB64?: string
  agentsMdB64?: string
  identityMdB64?: string
  /** Optional sidecar env file (Hermes → Open WebUI). Written next to the runtime env. */
  sidecarEnvB64?: string
  sidecarEnvPath?: string
}): string {
  const { installDir, configSubdir, configFileName, systemUser, envPath } = opts.runtime.paths
  const owner = `${systemUser}:${systemUser}`

  // When the runtime manages its own config (Hermes), skip the config-file write entirely —
  // the runtime-init step produces it with the package's own CLI. The config dir already
  // exists from bootstrap and the .env dir is created by the write_env step below.
  const configBlock = opts.configB64
    ? `
echo "=== provision: write_config ==="
mkdir -p "\${OC_HOME}/${configSubdir}"
echo ${bashSingleQuoteForScript(opts.configB64)} | base64 -d > "\${OC_HOME}/${configSubdir}/${configFileName}" || exit 1
chown -R ${owner} "\${OC_HOME}/${configSubdir}"
echo "=== provision: config_dump ==="
cat "\${OC_HOME}/${configSubdir}/${configFileName}" 2>/dev/null || echo "no config file"
`
    : `
echo "=== provision: write_config_skipped (runtime manages its own config) ==="
`

  const identityBlock =
    opts.agentsMdB64 && opts.identityMdB64
      ? `
echo "=== provision: write_identity ==="
mkdir -p "\${OC_HOME}/${configSubdir}/workspace"
echo ${bashSingleQuoteForScript(opts.agentsMdB64)} | base64 -d > "\${OC_HOME}/${configSubdir}/workspace/AGENTS.md" || exit 1
echo ${bashSingleQuoteForScript(opts.identityMdB64)} | base64 -d > "\${OC_HOME}/${configSubdir}/workspace/IDENTITY.md" || exit 1
chown -R ${owner} "\${OC_HOME}/${configSubdir}/workspace"
`
      : ""

  // Sidecar env (e.g. Open WebUI). Written to an absolute path the sidecar's
  // systemd unit references via --env-file; owned by the runtime system user.
  const sidecarEnvBlock =
    opts.sidecarEnvB64 && opts.sidecarEnvPath
      ? `
echo "=== provision: write_sidecar_env ==="
mkdir -p "$(dirname ${bashSingleQuoteForScript(opts.sidecarEnvPath)})"
echo ${bashSingleQuoteForScript(opts.sidecarEnvB64)} | base64 -d > ${bashSingleQuoteForScript(opts.sidecarEnvPath)} || exit 1
chmod 600 ${bashSingleQuoteForScript(opts.sidecarEnvPath)}
chown ${owner} ${bashSingleQuoteForScript(opts.sidecarEnvPath)}
`
      : ""

  return `#!/bin/bash
set -euo pipefail
OC_HOME=${bashSingleQuoteForScript(installDir)}
ENV_PATH=${bashSingleQuoteForScript(envPath)}

echo "=== provision: write_env ==="
mkdir -p "$(dirname "\${ENV_PATH}")"
echo ${bashSingleQuoteForScript(opts.envB64)} | base64 -d > "\${ENV_PATH}" || exit 1
chmod 600 "\${ENV_PATH}"
chown ${owner} "\${ENV_PATH}"
${configBlock}${identityBlock}${sidecarEnvBlock}
echo "=== provision: write_config_done ==="
`
}

/** Wall-clock for the merged install+start+health SSH script. */
const PROVISION_INSTALL_START_SSH_TIMEOUT_MS = 300_000

/**
 * Merged Phase B+C+D — install Caddy + systemd, start service, wait for
 * gateway port. Runs in a single SSH session to eliminate connect/auth
 * overhead (~6-9s saved).
 *
 * Phase C+D are wrapped in a retry loop (up to MAX_CD_RETRIES). If the
 * service crashes during the health check, the script restarts the service
 * and re-runs health checks before giving up.
 */
type PhaseService = { serviceName: string; port: number; healthPath: string; unitB64: string }

function buildPhaseInstallAndStart(opts: {
  /** Ordered: dependencies first (gateway), public-facing service last (e.g. sidecar). */
  services: PhaseService[]
  caddyB64: string
}): string {
  const writeUnits = opts.services
    .map(
      (s) =>
        `echo "=== provision: systemd_unit_file (${s.serviceName}) ==="\necho ${bashSingleQuoteForScript(s.unitB64)} | base64 -d > "/etc/systemd/system/${s.serviceName}.service"`,
    )
    .join("\n")
  const enableUnits = opts.services
    .map(
      (s) =>
        `echo "=== provision: systemd_enable (${s.serviceName}) ==="\nsystemctl --no-pager enable ${bashSingleQuoteForScript(s.serviceName)}`,
    )
    .join("\n")
  const startServices = opts.services
    .map(
      (s) =>
        `start_one ${bashSingleQuoteForScript(s.serviceName)} ${bashSingleQuoteForScript(String(s.port))} ${bashSingleQuoteForScript(s.healthPath)} || exit 1`,
    )
    .join("\n")

  return `#!/bin/bash
set -uo pipefail
export SYSTEMD_PAGER=cat
MAX_CD_RETRIES=2

# --- Phase B: Caddy + systemd ---
echo "=== provision: caddyfile_write ==="
echo ${bashSingleQuoteForScript(opts.caddyB64)} | base64 -d > /etc/caddy/Caddyfile

echo "=== provision: caddy_validate ==="
if ! timeout 30s /usr/bin/caddy validate --config /etc/caddy/Caddyfile; then
  echo "caddy validate failed" >&2
  exit 1
fi

echo "=== provision: caddy_restart ==="
systemctl --no-block restart caddy
echo "=== provision: caddy_wait_active ==="
ACTIVE_OK=0
for _ in \$(seq 1 60); do
  if systemctl is-active --quiet caddy; then
    ACTIVE_OK=1
    break
  fi
  if systemctl is-failed --quiet caddy; then
    break
  fi
  sleep 1
done
if [ "\${ACTIVE_OK}" != "1" ]; then
  echo "caddy did not reach active within 60s" >&2
  systemctl status caddy --no-pager -l || true
  journalctl -u caddy --no-pager -n 80 || true
  exit 1
fi
echo "=== provision: caddy_active ==="

${writeUnits}
echo "=== provision: systemd_daemon_reload ==="
systemctl daemon-reload
${enableUnits}
echo "=== provision: install_service_done ==="

# --- Phase C+D with retry, per service ---
try_start_and_health() {
  local SERVICE="\$1" PORT="\$2" HEALTH_PATH="\$3"
  echo "=== provision: start (\${SERVICE}) ==="
  systemctl stop "\${SERVICE}" 2>/dev/null || true
  systemctl reset-failed "\${SERVICE}" 2>/dev/null || true
  sleep 1
  timeout 30s systemctl start "\${SERVICE}" || true

  echo "=== provision: wait_active ==="
  local ACTIVE_OK=0
  for _ in \$(seq 1 30); do
    if systemctl is-active --quiet "\${SERVICE}"; then
      ACTIVE_OK=1
      break
    fi
    sleep 1
  done
  if [ "\${ACTIVE_OK}" != "1" ]; then
    echo "service did not reach active within 30s" >&2
    systemctl is-active "\${SERVICE}" || true
    journalctl -u "\${SERVICE}" --no-pager -n 40
    return 1
  fi
  echo "=== provision: start_service_done ==="

  local INITIAL_RESTARTS
  INITIAL_RESTARTS=\$(systemctl show -p NRestarts --value "\${SERVICE}" 2>/dev/null || echo 0)

  echo "=== provision: wait_port ==="
  local PORT_OK=0
  for _ in \$(seq 1 60); do
    if ss -tlnp 2>/dev/null | grep -q ":\${PORT}"; then
      PORT_OK=1
      break
    fi
    local CUR_RESTARTS
    CUR_RESTARTS=\$(systemctl show -p NRestarts --value "\${SERVICE}" 2>/dev/null || echo 0)
    if [ "\${CUR_RESTARTS}" -gt "\${INITIAL_RESTARTS}" ]; then
      echo "service is crash-looping (\${CUR_RESTARTS} restarts since start)" >&2
      journalctl -u "\${SERVICE}" --no-pager -n 50
      return 1
    fi
    if ! systemctl is-active --quiet "\${SERVICE}"; then
      echo "service crashed during port wait" >&2
      journalctl -u "\${SERVICE}" --no-pager -n 50
      return 1
    fi
    sleep 1
  done
  if [ "\${PORT_OK}" != "1" ]; then
    echo "port \${PORT} not listening after 60s" >&2
    journalctl -u "\${SERVICE}" --no-pager -n 50
    return 1
  fi

  echo "=== provision: http_health ==="
  local HTTP_OK=0
  for _ in \$(seq 1 20); do
    if curl -sf -o /dev/null -m 5 http://127.0.0.1:\${PORT}\${HEALTH_PATH}; then
      HTTP_OK=1
      break
    fi
    local CUR_RESTARTS
    CUR_RESTARTS=\$(systemctl show -p NRestarts --value "\${SERVICE}" 2>/dev/null || echo 0)
    if [ "\${CUR_RESTARTS}" -gt "\${INITIAL_RESTARTS}" ]; then
      echo "service is crash-looping during health check (\${CUR_RESTARTS} restarts)" >&2
      journalctl -u "\${SERVICE}" --no-pager -n 50
      return 1
    fi
    if ! systemctl is-active --quiet "\${SERVICE}"; then
      echo "service crashed during HTTP health check" >&2
      journalctl -u "\${SERVICE}" --no-pager -n 50
      return 1
    fi
    sleep 2
  done
  if [ "\${HTTP_OK}" != "1" ]; then
    echo "HTTP health check failed — gateway not responding on port \${PORT}" >&2
    journalctl -u "\${SERVICE}" --no-pager -n 50
    return 1
  fi

  return 0
}

start_one() {
  local SERVICE="\$1" PORT="\$2" HEALTH_PATH="\$3"
  local CD_OK=0 ATTEMPT
  for ATTEMPT in \$(seq 1 \${MAX_CD_RETRIES}); do
    echo "=== provision: attempt \${ATTEMPT}/\${MAX_CD_RETRIES} (\${SERVICE}) ==="
    if try_start_and_health "\${SERVICE}" "\${PORT}" "\${HEALTH_PATH}"; then
      CD_OK=1
      break
    fi
    if [ "\${ATTEMPT}" -lt "\${MAX_CD_RETRIES}" ]; then
      echo "=== provision: retry (\${SERVICE} attempt \${ATTEMPT} failed, restarting) ==="
      sleep 3
    fi
  done
  if [ "\${CD_OK}" != "1" ]; then
    echo "=== provision: all_retries_exhausted (\${SERVICE}) ==="
    return 1
  fi
  return 0
}

${startServices}

echo "=== provision: done ==="
`
}

/**
 * Seed the sidecar's first (admin) account, then lock signup. Open WebUI has no
 * auto-admin env: the first account created via the signup endpoint becomes
 * admin. We retry while the container's HTTP server warms up; a 400/403 means
 * the account already exists (idempotent on reprovision). On success we flip
 * ENABLE_SIGNUP=false in the env file and restart so the public URL isn't an
 * open registration page.
 */
function buildSeedSidecarAdminScript(opts: {
  port: number
  signupPath: string
  envPath: string
  serviceName: string
  adminEmail: string
  adminPassword: string
}): string {
  const payload = JSON.stringify({
    name: "Admin",
    email: opts.adminEmail,
    password: opts.adminPassword,
  })
  return `#!/bin/bash
set -uo pipefail
SIGNUP_URL="http://127.0.0.1:${opts.port}${opts.signupPath}"
ENV_PATH=${bashSingleQuoteForScript(opts.envPath)}
SERVICE=${bashSingleQuoteForScript(opts.serviceName)}
PAYLOAD=${bashSingleQuoteForScript(payload)}

echo "=== seed: open-webui admin ==="
OK=0
CODE=""
for _ in \$(seq 1 30); do
  CODE=\$(curl -s -o /tmp/owui_signup.out -w '%{http_code}' -m 8 -X POST "\${SIGNUP_URL}" -H 'Content-Type: application/json' -d "\${PAYLOAD}" || echo "000")
  if [ "\${CODE}" = "200" ] || [ "\${CODE}" = "201" ]; then
    OK=1
    break
  fi
  if [ "\${CODE}" = "400" ] || [ "\${CODE}" = "403" ]; then
    echo "admin signup returned \${CODE} — treating as already-seeded"
    OK=1
    break
  fi
  sleep 2
done

if [ "\${OK}" != "1" ]; then
  echo "open-webui admin signup failed (last code \${CODE})" >&2
  cat /tmp/owui_signup.out 2>/dev/null || true
  exit 1
fi

echo "=== seed: lock signup ==="
if grep -q '^ENABLE_SIGNUP=' "\${ENV_PATH}"; then
  sed -i 's/^ENABLE_SIGNUP=.*/ENABLE_SIGNUP=false/' "\${ENV_PATH}"
else
  echo 'ENABLE_SIGNUP=false' >> "\${ENV_PATH}"
fi
systemctl restart "\${SERVICE}"
echo "=== seed: done ==="
`
}

/**
 * Verify the gateway's OpenAI-compatible API actually answers — not just `/health`. Sources
 * the bearer token from the on-box `.env` (so it never lands in our logs) and asserts
 * `GET /v1/models` returns 200 with a non-empty model list. A non-zero exit means provider
 * registration / model routing is broken even though the port is up, so the provision should
 * fail rather than hand the user a gateway that 500s on the first chat. Used by runtimes that
 * expose `/v1` (Hermes).
 */
function buildApiModelsCheckScript(opts: { envPath: string; port: number }): string {
  return `#!/bin/bash
set -uo pipefail
set -a; . ${bashSingleQuoteForScript(opts.envPath)}; set +a

echo "=== provision: v1_models_check ==="
OK=0
CODE=""
for _ in \$(seq 1 5); do
  CODE=\$(curl -s -o /tmp/v1_models.out -w '%{http_code}' -m 10 -H "Authorization: Bearer \${API_SERVER_KEY}" "http://127.0.0.1:${opts.port}/v1/models" || echo 000)
  if [ "\${CODE}" = "200" ]; then OK=1; break; fi
  sleep 2
done
if [ "\${OK}" != "1" ]; then
  echo "/v1/models check failed (last code \${CODE})" >&2
  cat /tmp/v1_models.out 2>/dev/null || true
  exit 1
fi
if ! grep -q '"id"' /tmp/v1_models.out; then
  echo "/v1/models returned no models" >&2
  cat /tmp/v1_models.out 2>/dev/null || true
  exit 1
fi
echo "=== provision: v1_models_ok ==="
`
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function isLiveMode(): boolean {
  // Live provisioning needs the fleet SSH key plus at least one provider token.
  // Any enabled VPS provider's credential counts — DO is primary, but Linode/OVH
  // remain valid so a multi-provider deployment still reports live mode.
  const hasProviderToken = Boolean(
    process.env.DIGITALOCEAN_API_TOKEN ||
      process.env.LINODE_API_TOKEN ||
      process.env.OVH_APP_KEY,
  )
  return hasProviderToken && Boolean(process.env.SSH_FLEET_PRIVATE_KEY)
}

function buildContainerName(instanceId: string): string {
  return `bot_${instanceId.slice(0, 12)}`
}

type BotEnv = Record<string, string>
function buildBotEnv(instance: Instance, extras: BotEnv = {}): BotEnv {
  const tier = (instance.modelTier ?? "mid") as BudgetTier
  const provider = resolveLlmProvider(instance)
  const route = routeModel(tier, provider)

  // NVIDIA-primary bots get the NVIDIA key in the LLM key slot; OpenRouter bots
  // keep the shared OpenRouter key.
  const primaryKey =
    provider === "nvidia" ? nvidiaKeyForSlot("primary") : OPENROUTER_API_KEY()

  const env: BotEnv = {
    BOT_TOKEN: instance.botToken ?? "",
    SOUL_MD: instance.soulMd ?? "You are a helpful assistant.",
    MODEL: route.model,
    FALLBACK_MODEL: route.fallback,
    LLM_PROVIDER: provider,
    LLM_BASE_URL: route.baseUrl,
    OPENROUTER_API_KEY: primaryKey,
    USAGE_INGEST_URL: `${NEXT_PUBLIC_GATEWAY_BASE_URL()}/api/usage/ingest`,
    INSTANCE_ID: instance.id,
    PORT: "3000",
  }

  if (instance.telegramBotTokenEnc) {
    try {
      env.TELEGRAM_BOT_TOKEN = decryptSecret(instance.telegramBotTokenEnc)
    } catch (err) {
      console.warn(`[provisioner] failed to decrypt Telegram token for ${instance.id}:`, err)
    }
  }

  return { ...env, ...extras }
}

async function waitForVmRunning(
  vmId: string,
  provider: VmProvider,
  timeoutMs = 180_000,
): Promise<string> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const vm = await provider.getVM(vmId)
    if (vm.status === "running" && vm.ipv4?.[0]) {
      return vm.ipv4[0]
    }
    await new Promise((r) => setTimeout(r, 3_000))
  }
  throw new Error(`VM ${vmId} did not reach "running" within ${timeoutMs}ms`)
}

function generateRootPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
  const bytes = crypto.randomBytes(24)
  let out = ""
  for (let i = 0; i < 24; i++) {
    out += alphabet[bytes[i] % alphabet.length]
  }
  return out
}

function isVps(instance: Instance): boolean {
  return instance.deploymentTarget === "vps"
}

/**
 * True for deployment targets that run the agent as a systemd unit on a
 * dedicated host (managed Linode VPS or the customer's own BYOS server), as
 * opposed to the shared Docker cluster. Used by the lifecycle functions to
 * pick systemctl vs. docker.
 */
function usesSystemd(instance: Instance): boolean {
  return instance.deploymentTarget === "vps" || instance.deploymentTarget === "byos"
}

/**
 * SSH target for an existing instance's host. BYOS servers may use a custom
 * port / login user (stored on the row); managed VPS always uses root@22.
 */
function sshTargetFor(instance: Instance): SshTarget {
  const target: SshTarget = { host: instance.ipAddress!, instanceId: instance.id }
  if (instance.deploymentTarget === "byos") {
    target.port = instance.byosPort ?? 22
    target.username = instance.byosUser ?? "root"
  }
  return target
}

/* ------------------------------------------------------------------ */
/* provision                                                           */
/* ------------------------------------------------------------------ */

export type ProvisionResult = {
  ipAddress: string
  containerName?: string
  containerPort?: number
  botHostId?: string
  vmId?: string
  mocked: boolean
}

export async function provisionBot(instance: Instance): Promise<ProvisionResult> {
  const target = instance.deploymentTarget ?? "shared"

  const lock = await withInstanceLock(instance.id, async () => {
    return provisionBotLocked(instance, target)
  })

  if (!lock.acquired) {
    await logInstanceEvent({
      instanceId: instance.id,
      level: "warn",
      stage: "provision",
      action: "lock_contended",
      result: "error",
      message: "Another worker is already provisioning this instance. Skipping.",
    })
    throw new Error(`provisionBot already running for ${instance.id}`)
  }

  return lock.result
}

async function provisionBotLocked(
  instance: Instance,
  target: string,
): Promise<ProvisionResult> {
  await transitionInstance(instance.id, ["pending"], "provisioning", {
    bumpAttempts: "provision",
  })

  try {
    let result: ProvisionResult
    if (!isLiveMode()) {
      await logInstanceEvent({
        instanceId: instance.id,
        stage: "provision",
        action: "mock_start",
        message: "Starting provisioning (dev mode)...",
      })
      const ipAddress = instance.ipAddress ?? generateMockIp()
      await transitionInstance(instance.id, ["provisioning"], "running", {
        set: { ipAddress, lastActiveAt: new Date() },
      })
      await logInstanceEvent({
        instanceId: instance.id,
        stage: "provision",
        action: "mock_complete",
        result: "ok",
        message: `Mock-provisioned (${target}). Set LINODE_API_TOKEN + SSH_FLEET_PRIVATE_KEY for real infra.`,
      })
      result = { ipAddress, mocked: true }
    } else if (target === "vps") {
      result = await provisionVpsBot(instance)
    } else if (target === "byos") {
      result = await provisionByosBot(instance)
    } else {
      result = await provisionSharedBot(instance)
    }

    // Register the agent in Uptime Kuma now that it's running and has a public
    // URL. Best-effort: monitoring must never fail a successful deploy
    // (syncUptimeMonitor already swallows its own errors; this guard is belt
    // and suspenders against an unexpected throw).
    try {
      await syncUptimeMonitor(instance.id)
    } catch {
      /* observability only — ignore */
    }

    // Notify the owner that their agent is live. Never let a notification
    // failure surface as a provisioning failure.
    await notify({
      userId: instance.userId,
      category: "provisioning",
      type: "provision_complete",
      title: `Agent "${instance.name}" is live`,
      message: "Your agent has finished deploying and is now running.",
      url: `/dashboard/instances/${instance.id}`,
      instanceId: instance.id,
    })
    return result
  } catch (err) {
    // Guarantee the instance lands in a terminal failed state even when the
    // throw originated before a target provisioner set it (dev/mock path,
    // early errors). No-op when rollbackProvisioning already marked it.
    await ensureProvisioningFailed(
      instance.id,
      err instanceof Error ? err.message : String(err),
    )
    await notify({
      userId: instance.userId,
      category: "provisioning",
      type: "provision_failed",
      title: `Deployment failed for "${instance.name}"`,
      message: "Your agent could not be deployed. Open the dashboard for details and to retry.",
      url: `/dashboard/instances/${instance.id}`,
      instanceId: instance.id,
    })
    throw err
  }
}

/* ------------------------------------------------------------------ */
/* shared-cluster provisioning (Docker on managed fleet — unchanged)   */
/* ------------------------------------------------------------------ */

async function provisionSharedBot(instance: Instance): Promise<ProvisionResult> {
  try {
    await logInstanceEvent({
      instanceId: instance.id,
      stage: "shared",
      action: "pick_host",
      message: "Selecting shared host...",
    })

    // Atomic reservation: picks the host, allocates a port, and persists both
    // onto this instance row under a fleet-wide lock so concurrent deploys
    // can't collide on the same host:port.
    const { host, port } = await reserveHostSlot(instance.id)
    const containerName = buildContainerName(instance.id)

    await logInstanceEvent({
      instanceId: instance.id,
      stage: "shared",
      action: "docker_run",
      message: `Starting bot container on ${host.ipAddress}:${port}...`,
    })

    await sshDockerRun(
      { host: host.ipAddress },
      {
        image: BOT_RUNTIME_IMAGE(),
        containerName,
        hostPort: port,
        env: buildBotEnv(instance),
      },
    )

    await transitionInstance(instance.id, ["provisioning"], "running", {
      set: {
        ipAddress: host.ipAddress,
        botHostId: host.id,
        containerName,
        containerPort: port,
        lastActiveAt: new Date(),
      },
    })
    await logInstanceEvent({
      instanceId: instance.id,
      stage: "shared",
      action: "complete",
      result: "ok",
      message: "Deployment complete. Agent is running.",
    })

    return {
      ipAddress: host.ipAddress,
      containerName,
      containerPort: port,
      botHostId: host.id,
      mocked: false,
    }
  } catch (err) {
    const reason =
      err instanceof FleetEmptyError || err instanceof FleetFullError
        ? err.message
        : await describeVmError(err)
    await logInstanceEvent({
      instanceId: instance.id,
      level: "error",
      stage: "shared",
      action: "failed",
      result: "error",
      message: `Provisioning failed: ${reason}`,
    })
    // Release the reserved slot so a dead deploy doesn't hold a host port /
    // capacity slot (reserveHostSlot persists these up front).
    await transitionInstance(instance.id, ["provisioning"], "failed_provisioning", {
      error: reason,
      set: { containerPort: null, botHostId: null },
    })
    throw err
  }
}

/* ------------------------------------------------------------------ */
/* VPS provisioning (native OpenClaw + systemd + Caddy)                */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _VPS_STAGES = [
  "create_vm",
  "wait_boot",
  "waiting_ssh",
  "bootstrap",
  "writing_config",
  "installing_service",
  "starting_service",
  "health_check",
  "commit",
] as const
type VpsStage = (typeof _VPS_STAGES)[number]

async function setProvisionStage(instanceId: string, stage: VpsStage): Promise<void> {
  await db
    .update(instances)
    .set({ provisionStage: stage })
    .where(eq(instances.id, instanceId))
  await logInstanceEvent({
    instanceId,
    stage,
    action: "stage_enter",
    message: `Entering stage: ${stage}`,
  })
}

async function logSshStep(instanceId: string, step: SshStepResult): Promise<void> {
  const ok = step.exitCode === 0 || step.exitCode === null
  await logInstanceEvent({
    instanceId,
    level: ok ? "info" : "warn",
    stage: step.stage,
    action: "ssh_exec",
    result: ok ? "ok" : "error",
    durationMs: step.durationMs,
    detail: {
      command: step.command,
      exitCode: step.exitCode,
      stdout: step.stdout.slice(0, 4000),
      stderr: step.stderr.slice(0, 4000),
    },
    message: ok
      ? `SSH OK (${step.durationMs}ms): ${step.command.slice(0, 120)}`
      : `SSH FAIL exit=${step.exitCode} (${step.durationMs}ms): ${step.command.slice(0, 120)}`,
  })
}

/**
 * Best-effort remote snapshots after a failed provision. Log level matches
 * command exit: success is `info` so triage is not swamped with false "errors".
 * When `failedStage` is `installing_service`, Caddy journal/status are
 * included first.
 */
async function collectDiagnostics(
  target: SshTarget,
  instanceId: string,
  opts: { failedStage: VpsStage; runtime: RuntimeEngine },
): Promise<void> {
  const { runtime } = opts
  const baseCommands: [string, string][] = [
    [`journalctl -u ${runtime.serviceName} --no-pager -n 200`, "journal"],
    ["dmesg -T 2>/dev/null | tail -40 || true", "kernel_tail"],
    [`systemctl status ${runtime.serviceName} --no-pager`, "service_status"],
    [`cat ${runtime.paths.envPath} 2>/dev/null | grep -v API_KEY | grep -v PASSWORD`, "env_sanitized"],
    [`ls -la ${runtime.paths.installDir}/`, "workdir_listing"],
    [
      `[ -x ${bashSingleQuoteForScript(runtime.cliBinary)} ] && ${bashSingleQuoteForScript(runtime.cliBinary)} --version 2>&1 || echo 'not found'`,
      "binary_path",
    ],
    ["node -v 2>/dev/null || echo 'node not found'", "node_version"],
  ]
  const caddyWhenInstalling: [string, string][] =
    opts.failedStage === "installing_service"
      ? [
          ["journalctl -u caddy --no-pager -n 200", "caddy_journal"],
          ["systemctl status caddy --no-pager 2>&1", "caddy_status"],
        ]
      : []
  const sidecarDiagnostics: [string, string][] = runtime.sidecar
    ? [
        [`journalctl -u ${runtime.sidecar.serviceName} --no-pager -n 200`, "sidecar_journal"],
      ]
    : []
  // Hermes self-diagnostics: `doctor` and `config show` (config.yaml is non-secret; the
  // bearer key + provider key live in .env, which is captured sanitized above).
  const runAsHermes = (sub: string) =>
    `sudo -u ${bashSingleQuoteForScript(runtime.paths.systemUser)} env HOME=${bashSingleQuoteForScript(runtime.paths.installDir)} ${bashSingleQuoteForScript(runtime.cliBinary)} ${sub} 2>&1 || true`
  const hermesDiagnostics: [string, string][] =
    runtime.id === "hermes"
      ? [
          [runAsHermes("doctor"), "hermes_doctor"],
          [runAsHermes("config show"), "hermes_config_show"],
        ]
      : []
  const commands: [string, string][] = [
    ...caddyWhenInstalling,
    ...baseCommands,
    ...sidecarDiagnostics,
    ...hermesDiagnostics,
  ]

  for (const [cmd, label] of commands) {
    try {
      const result = await sshRun(target, cmd)
      const ok = result.code === 0
      const level = ok ? "info" : "error"
      const suffix = ok
        ? " (ok)"
        : ` (exit ${result.code ?? "unknown"})`
      await logInstanceEvent({
        instanceId,
        level,
        stage: "diagnostics",
        action: label,
        detail: {
          stdout: result.stdout.slice(0, 8000),
          stderr: result.stderr.slice(0, 4000),
          code: result.code,
        },
        message: `Diagnostic [${label}]${suffix}`,
      })
    } catch {
      await logInstanceEvent({
        instanceId,
        level: "error",
        stage: "diagnostics",
        action: label,
        result: "error",
        message: `Diagnostic [${label}]: SSH unreachable`,
      })
    }
  }
}

/* ------------------------------------------------------------------ */
/* VM acquisition + automatic failover                                 */
/* ------------------------------------------------------------------ */

type AcquiredVm = {
  provider: VmProvider
  /** Owning provider id (null on the legacy env-default fallback path). */
  providerId: string | null
  vmId: string
  ipAddress: string
  useGoldenImage: boolean
}

type AcquireOpts = {
  cfOriginCertPem?: string
  cfOriginKeyPem?: string
  setStage: (stage: VpsStage) => Promise<void>
}

/** Golden image only applies to the Linode + OpenClaw combination. */
function shouldUseGoldenImage(providerSlug: string | null, runtime: RuntimeEngine): boolean {
  return (
    (providerSlug === "linode" || providerSlug === null) &&
    Boolean(process.env.LINODE_GOLDEN_IMAGE) &&
    runtime.id === "openclaw"
  )
}

/** Create a VM on `provider`, persist vmId, and wait for it to boot + get an IP. */
async function createAndBootVm(
  instance: Instance,
  provider: VmProvider,
  runtime: RuntimeEngine,
  plan: string,
  region: string,
  opts: AcquireOpts & { useGoldenImage: boolean },
): Promise<{ vmId: string; ipAddress: string }> {
  const goldenImage = process.env.LINODE_GOLDEN_IMAGE
  await opts.setStage("create_vm")
  await logInstanceEvent({
    instanceId: instance.id,
    stage: "create_vm",
    message: `Creating VM (${plan} in ${region})${opts.useGoldenImage ? ` from golden image ${goldenImage}` : " with cloud-init bootstrap"}...`,
  })

  const bootstrapScript = opts.useGoldenImage
    ? undefined
    : runtime.renderBootstrap({
        gatewayPort: runtime.gatewayPort,
        cfOriginCertPem: opts.cfOriginCertPem,
        cfOriginKeyPem: opts.cfOriginKeyPem,
        webuiEnabled: Boolean(instance.webuiEnabled) && Boolean(runtime.sidecar),
      })

  const publicKey = process.env.SSH_FLEET_PUBLIC_KEY
  const rootPassword = generateRootPassword()
  const vm = await provider.createVM({
    label: `sovereign-vps-${instance.id.slice(0, 8)}`,
    plan,
    region,
    rootPassword,
    image: opts.useGoldenImage ? goldenImage || undefined : undefined,
    authorizedKeys: publicKey ? [publicKey] : undefined,
    tags: ["sovereignml", runtime.id, "vps"],
    userData: bootstrapScript,
  })
  const vmId = vm.id

  await db
    .update(instances)
    .set({ vmId, rootPasswordEnc: encryptSecret(rootPassword) })
    .where(eq(instances.id, instance.id))

  await logInstanceEvent({
    instanceId: instance.id,
    stage: "create_vm",
    action: "vm_created",
    result: "ok",
    detail: { vmId },
    message: `VM ${vmId} created${opts.useGoldenImage ? " (golden image)" : " with cloud-init bootstrap"}. Waiting for boot...`,
  })

  await opts.setStage("wait_boot")
  const ipAddress = await waitForVmRunning(vmId, provider)
  await db.update(instances).set({ ipAddress }).where(eq(instances.id, instance.id))
  return { vmId, ipAddress }
}

/**
 * One failover attempt failed: log it, mark the provider degraded so the router
 * de-prioritizes it on the next route, and delete any partial VM so we don't
 * leak it before moving to the next candidate.
 */
async function handleFailedAttempt(
  instance: Instance,
  candidate: Candidate,
  err: unknown,
): Promise<void> {
  const reason = await describeProviderError(candidate.providerSlug, err)
  await logInstanceEvent({
    instanceId: instance.id,
    level: "warn",
    stage: "create_vm",
    action: "provider_attempt_failed",
    result: "error",
    detail: { provider: candidate.providerSlug, vmPlan: candidate.providerPlanCode },
    message: `Provider ${candidate.providerName} failed: ${reason}. Failing over to the next provider.`,
  })
  await db.insert(providerHealthLogs).values({
    providerId: candidate.providerId,
    status: "degraded",
    latencyMs: null,
    detail: { failedProvision: reason },
  })

  const fresh = await db.query.instances.findFirst({
    where: eq(instances.id, instance.id),
    columns: { vmId: true },
  })
  if (fresh?.vmId) {
    try {
      const provider = await getVmProviderBySlug(candidate.providerSlug)
      await provider.deleteVM(fresh.vmId)
    } catch {
      // best-effort — the reconciler orphan sweep is the backstop
    }
    await db
      .update(instances)
      .set({ vmId: null, ipAddress: null })
      .where(eq(instances.id, instance.id))
  }
}

/**
 * Resolve a provider and obtain a booted VM with an IP. Routes via the
 * ProviderRouter and fails over across the ranked candidates; on a retry of a
 * partially-provisioned instance it sticks with the provider that owns the
 * existing VM. Falls back to the legacy env-default provider when no
 * provider_plans/provider_regions mapping exists (unseeded — backward compat).
 */
async function acquireBootedVm(
  instance: Instance,
  runtime: RuntimeEngine,
  opts: AcquireOpts,
): Promise<AcquiredVm> {
  // Sticky retry: an earlier attempt already created the VM.
  if (instance.vmId) {
    const provider = await getVmProviderById(instance.providerId)
    let ipAddress = instance.ipAddress ?? undefined
    if (!ipAddress) {
      await opts.setStage("wait_boot")
      ipAddress = await waitForVmRunning(instance.vmId, provider)
      await db.update(instances).set({ ipAddress }).where(eq(instances.id, instance.id))
    }
    return {
      provider,
      providerId: instance.providerId ?? null,
      vmId: instance.vmId,
      ipAddress,
      useGoldenImage: shouldUseGoldenImage(null, runtime),
    }
  }

  const input = {
    regionId: instance.regionId,
    serverConfigId: instance.serverConfigId,
    instanceId: instance.id,
  }
  const decision = await routeDeployment(input)

  // Backward-compat: no provider mapping yet → legacy env-default provider.
  if (decision.ranked.length === 0) {
    const provider = await getVmProvider()
    const [region, serverConfig] = await Promise.all([
      db.query.regions.findFirst({ where: eq(regions.id, instance.regionId) }),
      db.query.serverConfigs.findFirst({ where: eq(serverConfigs.id, instance.serverConfigId) }),
    ])
    const providerRegion = region?.providerRegion ?? FALLBACK_REGION
    const providerPlan = serverConfig?.providerPlan ?? FALLBACK_PLAN
    const useGoldenImage = shouldUseGoldenImage(null, runtime)
    await logInstanceEvent({
      instanceId: instance.id,
      level: "warn",
      stage: "create_vm",
      action: "router_fallback",
      message: "No provider mapping found — using env-default provider (legacy path). Seed provider_plans/provider_regions to enable routing.",
    })
    const { vmId, ipAddress } = await createAndBootVm(
      instance,
      provider,
      runtime,
      providerPlan,
      providerRegion,
      { ...opts, useGoldenImage },
    )
    return { provider, providerId: null, vmId, ipAddress, useGoldenImage }
  }

  const attempts = decision.ranked.slice(0, MAX_FAILOVER_ATTEMPTS)
  let lastErr: unknown = null
  for (const candidate of attempts) {
    const useGoldenImage = shouldUseGoldenImage(candidate.providerSlug, runtime)
    try {
      const provider = await getVmProviderBySlug(candidate.providerSlug)
      await logInstanceEvent({
        instanceId: instance.id,
        stage: "create_vm",
        action: "provider_selected",
        detail: { provider: candidate.providerSlug, score: candidate.score, pinned: candidate.pinned },
        message: `Routing → ${candidate.providerName} (${candidate.providerPlanCode} @ ${candidate.providerRegionCode}, score ${candidate.score.toFixed(3)})`,
      })
      const { vmId, ipAddress } = await createAndBootVm(
        instance,
        provider,
        runtime,
        candidate.providerPlanCode,
        candidate.providerRegionCode,
        { ...opts, useGoldenImage },
      )
      await db
        .update(instances)
        .set({ providerId: candidate.providerId })
        .where(eq(instances.id, instance.id))
      await logRoutingDecision(input, decision, { outcome: "succeeded", chosen: candidate })
      return { provider, providerId: candidate.providerId, vmId, ipAddress, useGoldenImage }
    } catch (err) {
      lastErr = err
      await handleFailedAttempt(instance, candidate, err)
    }
  }

  await logRoutingDecision(input, decision, { outcome: "failed", chosen: null })
  throw lastErr ?? new Error("All candidate providers failed to provision a VM")
}

async function provisionVpsBot(instance: Instance): Promise<ProvisionResult> {
  const runtime = getRuntime(instance.runtime)

  const cfOriginCertPem = process.env.CLOUDFLARE_ORIGIN_CERT_PEM
    ? normalizePem(process.env.CLOUDFLARE_ORIGIN_CERT_PEM)
    : undefined
  const cfOriginKeyPem = process.env.CLOUDFLARE_ORIGIN_CERT_KEY
    ? normalizePem(process.env.CLOUDFLARE_ORIGIN_CERT_KEY)
    : undefined

  if (cfOriginCertPem && !isValidPem(cfOriginCertPem)) {
    throw new Error(
      "CLOUDFLARE_ORIGIN_CERT_PEM is set but does not contain valid PEM data (missing -----BEGIN header). " +
        "Check the env var encoding — multi-line PEM values need real newlines, not literal \\n strings.",
    )
  }
  if (cfOriginKeyPem && !isValidPem(cfOriginKeyPem)) {
    throw new Error(
      "CLOUDFLARE_ORIGIN_CERT_KEY is set but does not contain valid PEM data (missing -----BEGIN header). " +
        "Check the env var encoding — multi-line PEM values need real newlines, not literal \\n strings.",
    )
  }

  let vmId: string | undefined = instance.vmId ?? undefined
  let ipAddress: string | undefined = instance.ipAddress ?? undefined
  let currentStage: VpsStage = "create_vm"
  let providerId: string | null = instance.providerId ?? null

  try {
    /* --- 1+2. Route → create VM → wait for boot, with failover ------ */
    const acquired = await acquireBootedVm(instance, runtime, {
      cfOriginCertPem,
      cfOriginKeyPem,
      setStage: async (s) => {
        currentStage = s
        await setProvisionStage(instance.id, s)
      },
    })
    vmId = acquired.vmId
    ipAddress = acquired.ipAddress
    providerId = acquired.providerId
    const useGoldenImage = acquired.useGoldenImage

    /* --- 2b. Cloudflare managed subdomain --------------------------- */
    let managedSubdomainForProvision: string | null = instance.managedSubdomain ?? null
    if (process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ZONE_ID) {
      try {
        const { name, recordId } = await createAgentSubdomain(
          instance.id,
          ipAddress,
          instance.name,
        )
        managedSubdomainForProvision = name
        await db
          .update(instances)
          .set({
            managedSubdomain: name,
            cfRecordId: recordId,
            dnsStatus: "propagating",
          })
          .where(eq(instances.id, instance.id))
        await logInstanceEvent({
          instanceId: instance.id,
          stage: currentStage,
          message: `Cloudflare DNS upserted: ${name} → ${ipAddress} (proxied)`,
        })
      } catch (cfErr) {
        await logInstanceEvent({
          instanceId: instance.id,
          stage: currentStage,
          message: `Cloudflare DNS upsert failed (continuing without managed subdomain): ${
            cfErr instanceof Error ? cfErr.message : String(cfErr)
          }`,
          level: "warn",
        })
      }
    }

    const target: SshTarget = { host: ipAddress, instanceId: instance.id }

    /* --- 3. Wait for SSH readiness ---------------------------------- */
    currentStage = "waiting_ssh"
    await setProvisionStage(instance.id, currentStage)
    await logInstanceEvent({
      instanceId: instance.id,
      stage: currentStage,
      message: `Server online at ${ipAddress}. Waiting for SSH...`,
    })
    await sshWaitReady(target)

    /* --- 4. Wait for cloud-init bootstrap to complete ---------------- */
    if (useGoldenImage) {
      currentStage = "bootstrap"
      await setProvisionStage(instance.id, currentStage)
      await logInstanceEvent({
        instanceId: instance.id,
        stage: currentStage,
        action: "bootstrap_complete",
        result: "ok",
        message: "Golden image — bootstrap already complete. Skipping cloud-init.",
      })
    } else {
      currentStage = "bootstrap"
      await setProvisionStage(instance.id, currentStage)
      await logInstanceEvent({
        instanceId: instance.id,
        stage: currentStage,
        message: PROVISION_EVENT.bootstrapping,
      })
      await sshPollBootstrap(target)
      await logInstanceEvent({
        instanceId: instance.id,
        stage: currentStage,
        action: "bootstrap_complete",
        result: "ok",
        message: PROVISION_EVENT.bootstrapComplete,
      })
    }

    /* --- 5-12. Configure the runtime over SSH (credentials, .env +    */
    /*           config write, Caddy + systemd install, health check,   */
    /*           commit). Shared verbatim with the BYOS path — the only  */
    /*           difference upstream is how we got here (Linode VM vs.   */
    /*           the customer's own server).                             */
    const openRouterApiKey = await resolveRuntimeOpenRouterKey(
      instance,
      resolveLlmProvider(instance),
    )
    return await configureRuntimeOverSsh(instance, target, ipAddress, runtime, {
      managedSubdomain: managedSubdomainForProvision,
      openRouterApiKey,
      vmId,
    })
  } catch (err) {
    if (ipAddress) {
      try {
        await collectDiagnostics({ host: ipAddress, instanceId: instance.id }, instance.id, { failedStage: currentStage, runtime })
      } catch {
        // diagnostics collection itself failed — don't mask the original error
      }
    }
    await rollbackProvisioning(instance.id, vmId, currentStage, err, providerId)
    throw err
  }
}

/**
 * Steps 5–12 of a host-based provision, shared by the managed-VPS and BYOS
 * paths. By the time this runs the server is reachable over SSH and the
 * runtime's dependencies are installed (Linode cloud-init for VPS, or the
 * bootstrap script run over SSH for BYOS). It writes the runtime `.env` +
 * config, installs Caddy + the systemd unit, starts the service, health-checks
 * it, and commits the instance to `running`.
 *
 * The caller mints/resolves `openRouterApiKey` (so BYOS can inject the
 * customer's own key) and owns failure handling — this function only throws.
 */
async function configureRuntimeOverSsh(
  instance: Instance,
  target: SshTarget,
  ipAddress: string,
  runtime: RuntimeEngine,
  opts: { managedSubdomain: string | null; openRouterApiKey: string; vmId: string | undefined },
): Promise<ProvisionResult> {
  const { managedSubdomain, openRouterApiKey, vmId } = opts
  const llmProvider = resolveLlmProvider(instance)
  let currentStage: VpsStage = "writing_config"

  /* --- 5. Credentials --------------------------------------------- */
  // Open WebUI sidecar (Hermes only): provisioned when the instance opted in
  // and the runtime defines a sidecar.
  const webuiEnabled = Boolean(instance.webuiEnabled) && Boolean(runtime.sidecar)

  // OpenClaw uses an admin email/password for its own dashboard login. Hermes
  // authenticates with a single bearer token (API_SERVER_KEY) and has no admin
  // concept of its own — but when the Open WebUI sidecar is enabled we still
  // mint admin credentials (for the Open WebUI login) and stash them in the
  // dormant openclawAdmin* columns. Note: every new Hermes row now arrives
  // with webuiEnabled=true (Open WebUI is mandatory for Hermes), so the
  // !webuiEnabled branch only applies to legacy rows.
  const needsAdmin = runtime.id !== "hermes" || webuiEnabled
  const adminEmail = needsAdmin
    ? (instance.openclawAdminEmail ??
      `admin+${instance.id.slice(0, 8)}@${runtime.id}.local`)
    : ""
  const adminPassword = needsAdmin
    ? (instance.openclawAdminPasswordEnc
      ? decryptSecret(instance.openclawAdminPasswordEnc)
      : generateAdminPassword())
    : ""
  const gatewayToken = generateGatewayToken()
  // Per-instance observability ingest token (least-privilege, separate from the
  // gateway token) — injected into the env and persisted encrypted at commit.
  const eventIngestToken = generateGatewayToken()
  const webuiSecretKey = webuiEnabled ? generateGatewayToken() : ""
  const tier = (instance.modelTier ?? "mid") as BudgetTier
  const route = routeModel(tier, llmProvider)

  // Hermes pins a ≥64k OpenRouter model via its own CLI (see renderInitScript); routeModel's
  // small `:free` slugs would be rejected by Hermes at startup. Other runtimes keep the
  // routed model. On the NVIDIA switch, Hermes uses the routed NVIDIA model directly.
  // Validate the slug up front so a bad model fails the deploy with a clear
  // error instead of a silent gateway crash loop.
  const initModel = effectiveModel({
    runtimeId: runtime.id,
    llmProvider,
    tier,
    modelSlug: instance.modelSlug,
    routedModel: route.model,
  })
  if (runtime.renderInitScript && !isValidOpenRouterSlug(initModel)) {
    throw new Error(
      `${runtime.displayName} model "${initModel}" is not a valid OpenRouter <author>/<slug> ` +
        `(≥64k context required). Set HERMES_MODELS in src/lib/model-router.ts or the HERMES_MODEL env var.`,
    )
  }

  /* --- 6. Write .env ---------------------------------------------- */
  currentStage = "writing_config"
  await setProvisionStage(instance.id, currentStage)
  await logInstanceEvent({
    instanceId: instance.id,
    stage: currentStage,
    message: PROVISION_EVENT.writingConfig,
  })

  const env = runtime.buildEnv({
    instance: needsAdmin ? { ...instance, openclawAdminEmail: adminEmail } : instance,
    adminEmail,
    adminPassword,
    gatewayToken,
    openRouterApiKey,
  })
  // Observability ingest wiring — runtime-agnostic, so both OpenClaw and Hermes
  // emit to the same endpoint with the same token contract.
  env.PLATFORM_EVENT_INGEST_URL = `${NEXT_PUBLIC_GATEWAY_BASE_URL()}/api/instances/${instance.id}/events`
  env.PLATFORM_EVENT_INGEST_TOKEN = eventIngestToken

  const envContent = renderEnvFile(env)
  const envB64 = Buffer.from(envContent, "utf8").toString("base64")

  const useCfOriginTls =
    Boolean(managedSubdomain) && (await sshVmHasCloudflareOriginCerts(target))
  if (managedSubdomain && !useCfOriginTls) {
    await logInstanceEvent({
      instanceId: instance.id,
      stage: currentStage,
      level: "info",
      message:
        "Managed hostname has no /etc/caddy/cf origin certificate; Caddy will use `tls internal` (self-signed). Cloudflare SSL must be \"Full\" (not \"Full (strict)\") for this to work. For \"Full (strict)\" provision with CLOUDFLARE_ORIGIN_CERT_PEM and CLOUDFLARE_ORIGIN_CERT_KEY.",
    })
  }

  const caddyContent = runtime.renderCaddyfile({
    domain: instance.domain,
    managedSubdomain,
    useCfOriginTls,
    // Put the sidecar (Open WebUI :8080) in front; the gateway stays loopback-only.
    upstreamPort: webuiEnabled && runtime.sidecar ? runtime.sidecar.port : undefined,
  })
  const caddyB64 = Buffer.from(caddyContent, "utf8").toString("base64")

  const unitContent = runtime.renderSystemdUnit()
  const unitB64 = Buffer.from(unitContent, "utf8").toString("base64")

  // Sidecar (Open WebUI): env file + systemd unit, written in Phase A and
  // started alongside the gateway. Points at the public URL for correct
  // absolute links/cookies behind the Cloudflare/Caddy proxy.
  const publicUrl =
    buildPublicGatewayUrl({
      domain: instance.domain,
      managedSubdomain,
      tlsStatus: instance.domain ? instance.tlsStatus : null,
      ipAddress,
    })?.url ?? null
  let sidecarEnvB64: string | undefined
  let sidecarEnvPath: string | undefined
  let sidecarUnitB64: string | undefined
  if (webuiEnabled && runtime.sidecar) {
    const sidecarEnv = runtime.sidecar.renderEnv({
      instance,
      gatewayToken,
      gatewayPort: runtime.gatewayPort,
      secretKey: webuiSecretKey,
      publicUrl,
      enableSignup: true,
    })
    sidecarEnvB64 = Buffer.from(renderEnvFile(sidecarEnv), "utf8").toString("base64")
    sidecarEnvPath = runtime.sidecar.envPath
    sidecarUnitB64 = Buffer.from(runtime.sidecar.renderSystemdUnit(), "utf8").toString("base64")
  }

  // Runtimes that manage their own config (Hermes) skip the hand-rendered file — their
  // renderInitScript writes config.yaml via the package's own CLI in Phase A.5.
  const configB64 = runtime.managesOwnConfig
    ? undefined
    : Buffer.from(
        runtime.renderConfig({
          gatewayToken,
          openRouterApiKey,
          model: initModel,
          fallbackModel: route.fallback,
          domain: instance.domain,
          managedSubdomain,
          ipAddress,
          tlsStatus: instance.domain ? instance.tlsStatus : null,
          enabledToolIds: instance.enabledTools ?? [],
        }),
        "utf8",
      ).toString("base64")

  /* Phase A — write .env + openclaw.json + identity files (batch, ~5s) */
  const agentType = instance.agentType ?? "custom"
  const agentsMdB64 = Buffer.from(generateAgentsMd(agentType), "utf8").toString("base64")
  const identityMdB64 = Buffer.from(generateIdentityMd(agentType), "utf8").toString("base64")
  const phaseAScript = buildPhaseWriteConfig({
    runtime,
    envB64,
    configB64,
    agentsMdB64,
    identityMdB64,
    sidecarEnvB64,
    sidecarEnvPath,
  })
  const phaseAStep = await sshRunScriptLogged(
    target,
    phaseAScript,
    currentStage,
    "provision:phaseA (env, config write)",
    { timeoutMs: 60_000 },
  )
  await logSshStep(instance.id, phaseAStep)

  if (phaseAStep.exitCode !== 0 && phaseAStep.exitCode !== null) {
    throw new Error(
      `Provision phase A failed (exit ${phaseAStep.exitCode}): ${phaseAStep.stderr || phaseAStep.stdout}`,
    )
  }

  await logInstanceEvent({
    instanceId: instance.id,
    stage: currentStage,
    action: "config_written",
    result: "ok",
    message: PROVISION_EVENT.configWritten,
  })

  /* Phase A.5 — runtime self-initialization (Hermes: `hermes setup --non-interactive`,
     `config set` provider+model, `config check`, `doctor`). Runs after the .env is on disk
     and BEFORE the service starts, so the gateway only ever starts against a validated
     config. A non-zero exit hard-fails the provision (→ rollback). No-op for runtimes
     without renderInitScript (OpenClaw). */
  if (runtime.renderInitScript) {
    const initScript = runtime.renderInitScript({
      installDir: runtime.paths.installDir,
      systemUser: runtime.paths.systemUser,
      cliBinary: runtime.cliBinary,
      envPath: runtime.paths.envPath,
      provider: llmProvider,
      model: initModel,
      baseUrl: route.baseUrl,
      enabledToolIds: instance.enabledTools ?? [],
    })
    if (initScript) {
      const initStep = await sshRunScriptLogged(
        target,
        initScript,
        currentStage,
        "provision:phaseA.5 (runtime init + validate)",
        { timeoutMs: 180_000 },
      )
      await logSshStep(instance.id, initStep)
      if (initStep.exitCode !== 0 && initStep.exitCode !== null) {
        throw new Error(
          `Provision runtime init failed (exit ${initStep.exitCode}): ${
            initStep.stderr || initStep.stdout
          }`,
        )
      }
      await logInstanceEvent({
        instanceId: instance.id,
        stage: currentStage,
        action: "runtime_initialized",
        result: "ok",
        message: `${runtime.displayName} initialized and validated (config check + doctor).`,
      })
    }
  }

  /* Phase B+C+D — install Caddy + systemd, start service, health check (single SSH session) */
  currentStage = "installing_service"
  await setProvisionStage(instance.id, currentStage)
  const installStep = await sshRunScriptLogged(
    target,
    buildPhaseInstallAndStart({
      services: [
        {
          serviceName: runtime.serviceName,
          port: runtime.gatewayPort,
          healthPath: runtime.healthPath,
          unitB64,
        },
        ...(webuiEnabled && runtime.sidecar && sidecarUnitB64
          ? [
              {
                serviceName: runtime.sidecar.serviceName,
                port: runtime.sidecar.port,
                healthPath: runtime.sidecar.healthPath,
                unitB64: sidecarUnitB64,
              },
            ]
          : []),
      ],
      caddyB64,
    }),
    currentStage,
    "provision:phaseB+C+D (caddy, systemd, start, health)",
    { timeoutMs: PROVISION_INSTALL_START_SSH_TIMEOUT_MS },
  )
  await logSshStep(instance.id, installStep)
  const installFailed = installStep.exitCode !== 0 && installStep.exitCode !== null
  if (installFailed) {
    const stdout = installStep.stdout
    let failedPhase = "B+C+D"
    if (stdout.includes("caddy validate failed") || !stdout.includes("install_service_done")) {
      failedPhase = "B (caddy/systemd)"
    } else if (stdout.includes("all_retries_exhausted")) {
      failedPhase = "C+D (service start/health — all retries exhausted)"
    } else if (!stdout.includes("start_service_done")) {
      failedPhase = "C (service start)"
    } else if (!stdout.includes("provision: done")) {
      failedPhase = "D (health check)"
    }

    const isHealthOnlyFailure =
      stdout.includes("install_service_done") && !stdout.includes("provision: done")
    const softCommit = isHealthOnlyFailure && process.env.KEEP_FAILED_VMS === "true"

    if (softCommit) {
      await logInstanceEvent({
        instanceId: instance.id,
        level: "warn",
        stage: currentStage,
        action: "soft_commit",
        result: "error",
        message: `Phase ${failedPhase} failed but KEEP_FAILED_VMS=true — soft-committing instance as running so you can SSH in and debug. The VM, Caddy, and systemd unit are all in place.`,
      })
    } else {
      throw new Error(
        `Provision phase ${failedPhase} failed (exit ${installStep.exitCode}): ${installStep.stderr || installStep.stdout}`,
      )
    }
  }

  if (!installFailed) {
    await logInstanceEvent({
      instanceId: instance.id,
      stage: currentStage,
      action: "caddy_reloaded",
      result: "ok",
      message: PROVISION_EVENT.caddyReloaded,
    })
    await logInstanceEvent({
      instanceId: instance.id,
      stage: currentStage,
      action: "service_active",
      result: "ok",
      message: PROVISION_EVENT.serviceActive,
    })

    currentStage = "health_check"
    await setProvisionStage(instance.id, currentStage)
    await logInstanceEvent({
      instanceId: instance.id,
      stage: currentStage,
      action: "port_listening",
      result: "ok",
      message: PROVISION_EVENT.portListening,
    })

    await logInstanceEvent({
      instanceId: instance.id,
      stage: currentStage,
      action: "health_ok",
      result: "ok",
      message: PROVISION_EVENT.httpHealthOk,
    })

    // Hermes: assert the OpenAI-compatible API is actually serving models (provider wired,
    // model accepted) before we point Open WebUI at it. Hard gate — a failure here means the
    // gateway is up but the agent can't talk to a model, so fail the deploy.
    if (runtime.id === "hermes") {
      const modelsStep = await sshRunScriptLogged(
        target,
        buildApiModelsCheckScript({ envPath: runtime.paths.envPath, port: runtime.gatewayPort }),
        currentStage,
        "provision:health (GET /v1/models)",
        { timeoutMs: 60_000 },
      )
      await logSshStep(instance.id, modelsStep)
      if (modelsStep.exitCode !== 0 && modelsStep.exitCode !== null) {
        throw new Error(
          `Provision health check failed — ${runtime.displayName} /v1/models did not return a ` +
            `model list (exit ${modelsStep.exitCode}): ${modelsStep.stderr || modelsStep.stdout}`,
        )
      }
      await logInstanceEvent({
        instanceId: instance.id,
        stage: currentStage,
        action: "api_models_ok",
        result: "ok",
        message: `${runtime.displayName} OpenAI-compatible API verified (/v1/models).`,
      })
    }

    // Seed the Open WebUI admin and lock signup. Best-effort: a failure here
    // leaves signup open (the first visitor self-registers as admin) but does
    // not fail the deploy.
    if (webuiEnabled && runtime.sidecar) {
      const seedStep = await sshRunScriptLogged(
        target,
        buildSeedSidecarAdminScript({
          port: runtime.sidecar.port,
          signupPath: runtime.sidecar.seedAdmin.signupPath,
          envPath: runtime.sidecar.envPath,
          serviceName: runtime.sidecar.serviceName,
          adminEmail,
          adminPassword,
        }),
        currentStage,
        "provision:seed (open-webui admin)",
        { timeoutMs: 120_000 },
      )
      await logSshStep(instance.id, seedStep)
      const seedOk = seedStep.exitCode === 0 || seedStep.exitCode === null
      await logInstanceEvent({
        instanceId: instance.id,
        level: seedOk ? "info" : "warn",
        stage: currentStage,
        action: "webui_admin_seeded",
        result: seedOk ? "ok" : "error",
        message: seedOk
          ? "Open WebUI admin account created and public signup disabled."
          : "Could not seed the Open WebUI admin; signup is left open so the first visitor becomes admin.",
      })
    }
  }

  /* --- 12. Commit state ------------------------------------------- */
  currentStage = "commit"
  await setProvisionStage(instance.id, currentStage)
  const adminFields = needsAdmin
    ? {
        openclawAdminEmail: adminEmail,
        openclawAdminPasswordEnc:
          instance.openclawAdminPasswordEnc ?? encryptSecret(adminPassword),
      }
    : {}
  await transitionInstance(instance.id, ["provisioning"], "running", {
    set: {
      ipAddress,
      vmId,
      containerName: runtime.serviceName,
      containerPort: runtime.gatewayPort,
      ...adminFields,
      gatewayTokenEnc: encryptSecret(gatewayToken),
      eventIngestTokenEnc: encryptSecret(eventIngestToken),
      dnsStatus: instance.domain ? "pending" : null,
      tlsStatus: instance.domain ? "pending" : null,
      provisionStage: "commit",
      failedStage: null,
      lastActiveAt: new Date(),
    },
  })
  await logInstanceEvent({
    instanceId: instance.id,
    stage: "complete",
    result: "ok",
    message: `Deployment complete. ${runtime.displayName} gateway at ${ipAddress}:${runtime.gatewayPort}${
      instance.domain ? ` (domain ${instance.domain})` : ""
    }. Direct access: http://${ipAddress}:${runtime.gatewayPort}`,
  })

  return {
    ipAddress,
    containerName: runtime.serviceName,
    containerPort: runtime.gatewayPort,
    vmId,
    mocked: false,
  }
}

/**
 * Bring Your Own Server provisioning. The customer already owns the box and has
 * pasted our SSH_FLEET_PUBLIC_KEY into its root authorized_keys, so there is no
 * VM to create or destroy. We SSH straight in, run the runtime bootstrap script
 * (the same one VPS gets via cloud-init), then hand off to the shared
 * configure-over-SSH sequence. On failure we never touch their server beyond
 * marking the instance failed.
 */
async function provisionByosBot(instance: Instance): Promise<ProvisionResult> {
  const runtime = getRuntime(instance.runtime)
  const host = instance.byosHost
  if (!host) {
    throw new Error("BYOS instance is missing byosHost — cannot connect")
  }
  const port = instance.byosPort ?? 22
  const username = instance.byosUser ?? "root"
  const target: SshTarget = { host, port, username, instanceId: instance.id }
  let currentStage: VpsStage = "waiting_ssh"

  try {
    /* --- 1. Connect (validates the user added our fleet key) -------- */
    currentStage = "waiting_ssh"
    await setProvisionStage(instance.id, currentStage)
    await db
      .update(instances)
      .set({ ipAddress: host })
      .where(eq(instances.id, instance.id))
    await logInstanceEvent({
      instanceId: instance.id,
      stage: currentStage,
      message: `Connecting to your server at ${host}:${port} as ${username}...`,
    })
    try {
      await sshWaitReady(target)
    } catch (e) {
      throw new Error(
        `Could not SSH into ${host}:${port}. Confirm you added the Sovereign fleet ` +
          `public key to ${username}'s authorized_keys and that port ${port} is open. ` +
          `(${e instanceof Error ? e.message : String(e)})`,
      )
    }

    /* --- 2. Bootstrap (install Node + Caddy + runtime) over SSH ----- */
    currentStage = "bootstrap"
    await setProvisionStage(instance.id, currentStage)
    await logInstanceEvent({
      instanceId: instance.id,
      stage: currentStage,
      message: PROVISION_EVENT.bootstrapping,
    })
    const bootstrapScript = runtime.renderBootstrap({
      gatewayPort: runtime.gatewayPort,
      webuiEnabled: Boolean(instance.webuiEnabled) && Boolean(runtime.sidecar),
    })
    const bootstrapStep = await sshRunScriptLogged(
      target,
      bootstrapScript,
      currentStage,
      "byos:bootstrap (install node/caddy/runtime)",
      { timeoutMs: 600_000 },
    )
    await logSshStep(instance.id, bootstrapStep)
    if (bootstrapStep.exitCode !== 0 && bootstrapStep.exitCode !== null) {
      throw new Error(
        `BYOS bootstrap failed (exit ${bootstrapStep.exitCode}): ${
          bootstrapStep.stderr || bootstrapStep.stdout
        }`,
      )
    }
    await logInstanceEvent({
      instanceId: instance.id,
      stage: currentStage,
      action: "bootstrap_complete",
      result: "ok",
      message: PROVISION_EVENT.bootstrapComplete,
    })

    /* --- 3. Resolve the LLM key (our minted key vs. customer's own) - */
    const openRouterApiKey =
      instance.byosLlmMode === "own_key" && instance.byosOwnApiKeyEnc
        ? decryptSecret(instance.byosOwnApiKeyEnc)
        : await resolveRuntimeOpenRouterKey(instance, resolveLlmProvider(instance))

    /* --- 4. Shared configure-over-SSH (no managed subdomain, no VM) - */
    return await configureRuntimeOverSsh(instance, target, host, runtime, {
      managedSubdomain: null,
      openRouterApiKey,
      vmId: undefined,
    })
  } catch (err) {
    // BYOS owns no VM — collect diagnostics and mark failed, but never delete
    // anything. rollbackProvisioning with vmId=undefined skips all VM deletion.
    if (instance.ipAddress || host) {
      try {
        await collectDiagnostics(target, instance.id, { failedStage: currentStage, runtime })
      } catch {
        // diagnostics failure must not mask the original error
      }
    }
    await rollbackProvisioning(instance.id, undefined, currentStage, err)
    throw err
  }
}

async function rollbackProvisioning(
  instanceId: string,
  vmId: string | undefined,
  stage: string,
  err: unknown,
  providerId: string | null = null,
): Promise<void> {
  const reason = await describeVmError(err)
  await logInstanceEvent({
    instanceId,
    level: "error",
    stage,
    action: "failed",
    result: "error",
    detail: { vmId },
    message: `Provisioning failed at ${stage}: ${reason}`,
  })

  let vmDeleted = false
  const keepVms = process.env.KEEP_FAILED_VMS === "true"
  if (vmId && keepVms) {
    await logInstanceEvent({
      instanceId,
      level: "warn",
      stage: "rollback",
      action: "keep_vm",
      detail: { vmId },
      message: `KEEP_FAILED_VMS=true — VM ${vmId} preserved for debugging. Delete manually when done.`,
    })
  } else if (vmId) {
    const provider = await getVmProviderById(providerId)
    const backoffMs = [1_000, 4_000, 16_000]
    for (let i = 0; i < backoffMs.length; i++) {
      try {
        await provider.deleteVM(vmId)
        vmDeleted = true
        break
      } catch (delErr) {
        await logInstanceEvent({
          instanceId,
          level: "warn",
          stage: "rollback",
          action: "delete_vm_retry",
          result: "error",
          detail: { vmId, attempt: i + 1 },
          message: `deleteVM retry ${i + 1} failed: ${await describeVmError(delErr)}`,
        })
        if (i < backoffMs.length - 1) {
          await new Promise((r) => setTimeout(r, backoffMs[i]))
        }
      }
    }
  }

  const setFields: Record<string, unknown> = { failedStage: stage }
  if (vmDeleted) {
    setFields.vmId = null
    setFields.ipAddress = null
  }

  await transitionInstance(instanceId, ["provisioning"], "failed_provisioning", {
    error: reason,
    set: setFields,
  })

  await logInstanceEvent({
    instanceId,
    level: vmDeleted ? "warn" : "error",
    stage: "rollback",
    action: vmDeleted ? "vm_deleted" : "orphan_pending",
    result: vmDeleted ? "ok" : "error",
    detail: { vmId },
    message: vmDeleted
      ? `Rollback complete. VM ${vmId} deleted.`
      : `Rollback incomplete. VM ${vmId} still exists — awaiting reconciler.`,
  })
}

/* ------------------------------------------------------------------ */
/* lifecycle                                                           */
/* ------------------------------------------------------------------ */

/** systemd unit name for the Open WebUI sidecar, when enabled for this instance. */
function sidecarServiceFor(instance: Instance): string | undefined {
  const runtime = getRuntime(instance.runtime)
  return instance.webuiEnabled && runtime.sidecar ? runtime.sidecar.serviceName : undefined
}

export async function restartBot(instance: Instance): Promise<void> {
  if (isLiveMode() && instance.ipAddress) {
    if (usesSystemd(instance)) {
      const target = sshTargetFor(instance)
      await sshSystemctlRestart(target, getRuntime(instance.runtime).serviceName)
      const sidecar = sidecarServiceFor(instance)
      if (sidecar) await sshSystemctlRestart(target, sidecar)
    } else if (instance.containerName) {
      await sshDockerRestart({ host: instance.ipAddress, instanceId: instance.id }, instance.containerName)
    }
  }
  await db
    .update(instances)
    .set({ lastActiveAt: new Date() })
    .where(eq(instances.id, instance.id))
  await logInstanceEvent({
    instanceId: instance.id,
    stage: "restart",
    result: "ok",
    message: isLiveMode() ? "Service restarted." : "Restart signal received (mock).",
  })
}

export async function pauseBot(instance: Instance): Promise<void> {
  if (isLiveMode() && instance.ipAddress) {
    if (usesSystemd(instance)) {
      const target = sshTargetFor(instance)
      // Stop the sidecar before the gateway it depends on.
      const sidecar = sidecarServiceFor(instance)
      if (sidecar) await sshSystemctlStop(target, sidecar)
      await sshSystemctlStop(target, getRuntime(instance.runtime).serviceName)
    } else if (instance.containerName) {
      await sshDockerStop({ host: instance.ipAddress, instanceId: instance.id }, instance.containerName)
    }
  }
  await transitionInstance(instance.id, ["running"], "stopped")
  await logInstanceEvent({
    instanceId: instance.id,
    level: "warn",
    stage: "pause",
    result: "ok",
    message: "Bot paused.",
  })
}

export async function resumeBot(instance: Instance): Promise<void> {
  if (isLiveMode() && instance.ipAddress) {
    if (usesSystemd(instance)) {
      const target = sshTargetFor(instance)
      // Start the gateway before the sidecar that depends on it.
      await sshSystemctlStart(target, getRuntime(instance.runtime).serviceName)
      const sidecar = sidecarServiceFor(instance)
      if (sidecar) await sshSystemctlStart(target, sidecar)
    } else if (instance.containerName) {
      await sshDockerStart({ host: instance.ipAddress, instanceId: instance.id }, instance.containerName)
    }
  }
  await transitionInstance(instance.id, ["stopped"], "running", {
    set: { lastActiveAt: new Date() },
  })
  await logInstanceEvent({
    instanceId: instance.id,
    stage: "resume",
    result: "ok",
    message: "Bot resumed.",
  })
}

export type DeleteResult = { status: "deleted" | "pending"; vmId?: string }

export async function deleteBot(instance: Instance): Promise<DeleteResult> {
  await transitionInstance(
    instance.id,
    ["pending", "running", "stopped", "failed_provisioning", "provisioning", "failed"],
    "deleting",
    { bumpAttempts: "deletion" },
  )
  await logInstanceEvent({
    instanceId: instance.id,
    level: "warn",
    stage: "delete",
    action: "started",
    message: "Deletion started.",
  })

  // Tear down the Uptime Kuma monitor (best-effort; nulls kumaMonitorId on
  // success). removeUptimeMonitor swallows its own errors and no-ops when Kuma
  // is unconfigured or the instance has no monitor.
  await removeUptimeMonitor(instance.id)

  if (
    process.env.CLOUDFLARE_API_TOKEN &&
    process.env.CLOUDFLARE_ZONE_ID &&
    (instance.managedSubdomain || instance.cfRecordId)
  ) {
    try {
      await deleteAgentSubdomain(instance.id, instance.cfRecordId)
      await db
        .update(instances)
        .set({ managedSubdomain: null, cfRecordId: null })
        .where(eq(instances.id, instance.id))
      await logInstanceEvent({
        instanceId: instance.id,
        stage: "delete",
        action: "cf_dns_deleted",
        message: `Cloudflare DNS record removed for ${instance.managedSubdomain ?? instance.id}.`,
      })
    } catch (cfErr) {
      await logInstanceEvent({
        instanceId: instance.id,
        level: "warn",
        stage: "delete",
        action: "cf_dns_delete",
        result: "error",
        message: `Cloudflare DNS delete failed (continuing): ${
          cfErr instanceof Error ? cfErr.message : String(cfErr)
        }`,
      })
    }
  }

  // Bring-Your-Own-Cloudflare: a record we created in the USER's own zone must
  // be deleted with the USER's token (the platform token can't touch it), so
  // this is intentionally NOT gated on CLOUDFLARE_API_TOKEN. If the user has
  // since disconnected Cloudflare we can't reach it — log the potential orphan.
  if (instance.cfUserRecordId && instance.cfZoneId) {
    try {
      const token = await getCloudflareTokenForTeam(instance.teamId)
      await deleteDnsRecord(instance.cfUserRecordId, {
        token,
        zoneId: instance.cfZoneId,
      })
      await db
        .update(instances)
        .set({ cfUserRecordId: null, cfZoneId: null })
        .where(eq(instances.id, instance.id))
      await logInstanceEvent({
        instanceId: instance.id,
        stage: "delete",
        action: "cf_user_dns_deleted",
        message: `User-zone Cloudflare DNS record removed for ${instance.domain ?? instance.id}.`,
      })
    } catch (cfErr) {
      await logInstanceEvent({
        instanceId: instance.id,
        level: "warn",
        stage: "delete",
        action: "cf_user_dns_delete",
        result: "error",
        message: `User-zone Cloudflare DNS delete failed (possible orphaned record in the user's account): ${
          cfErr instanceof Error ? cfErr.message : String(cfErr)
        }`,
      })
    }
  }

  // Refund the unused slice of today's daily-compute charge (best-effort,
  // idempotent per instance — see refundProratedDailyCompute). No-op for BYOS
  // and for instances not billed today. The credits land back in the owner's
  // wallet for reuse by a future agent.
  try {
    const refunded = await refundProratedDailyCompute(instance)
    if (refunded > 0) {
      await logInstanceEvent({
        instanceId: instance.id,
        stage: "delete",
        action: "compute_refund",
        message: `Refunded ${refunded} prorated compute credits on delete.`,
      })
    }
  } catch (err) {
    await logInstanceEvent({
      instanceId: instance.id,
      level: "warn",
      stage: "delete",
      action: "compute_refund",
      result: "error",
      message: `Prorated compute refund failed (non-blocking): ${
        err instanceof Error ? err.message : String(err)
      }`,
    })
  }

  // Revoke the per-instance OpenRouter runtime key (if any) before any path
  // transitions to `deleted`. No-op for shared-cluster instances (they don't
  // mint per-instance keys) and for dev-mode instances that never got past
  // mocked provisioning. Failures are logged but non-blocking — the
  // reconciler's orphan-key pass sweeps anything we miss.
  await revokeInstanceOpenRouterKey(instance)

  // BYOS: we manage the customer's own server but must never destroy it.
  // Best-effort stop + disable the systemd unit and remove the install dir over
  // SSH, then mark the instance deleted. Their server stays online.
  if (instance.deploymentTarget === "byos") {
    if (isLiveMode() && instance.ipAddress) {
      const runtime = getRuntime(instance.runtime)
      const sidecar = sidecarServiceFor(instance)
      const sidecarCleanup =
        sidecar && runtime.sidecar
          ? `systemctl stop ${sidecar} 2>/dev/null || true; ` +
            `systemctl disable ${sidecar} 2>/dev/null || true; ` +
            `rm -rf ${runtime.sidecar.dataDir} 2>/dev/null || true; `
          : ""
      try {
        await sshRun(
          sshTargetFor(instance),
          sidecarCleanup +
            `systemctl stop ${runtime.serviceName} 2>/dev/null || true; ` +
            `systemctl disable ${runtime.serviceName} 2>/dev/null || true; ` +
            `rm -rf ${runtime.paths.installDir} 2>/dev/null || true`,
        )
      } catch (err) {
        await logInstanceEvent({
          instanceId: instance.id,
          level: "warn",
          stage: "delete",
          action: "byos_cleanup",
          result: "error",
          message: `BYOS cleanup over SSH failed (continuing): ${await describeVmError(err)}`,
        })
      }
    }
    await transitionInstance(instance.id, ["deleting"], "deleted", {
      set: { ipAddress: null },
    })
    await logInstanceEvent({
      instanceId: instance.id,
      level: "warn",
      stage: "delete",
      action: "completed",
      result: "ok",
      message: "BYOS instance removed from management. Your server was left intact.",
    })
    return { status: "deleted" }
  }

  if (!isVps(instance)) {
    if (isLiveMode() && instance.ipAddress && instance.containerName) {
      try {
        await sshDockerRm({ host: instance.ipAddress, instanceId: instance.id }, instance.containerName)
      } catch (err) {
        await logInstanceEvent({
          instanceId: instance.id,
          level: "warn",
          stage: "delete",
          action: "docker_rm",
          result: "error",
          message: `docker rm failed (continuing): ${await describeVmError(err)}`,
        })
      }
    }
    await transitionInstance(instance.id, ["deleting"], "deleted", {
      set: { ipAddress: null, containerName: null, containerPort: null },
    })
    await logInstanceEvent({
      instanceId: instance.id,
      level: "warn",
      stage: "delete",
      action: "completed",
      result: "ok",
      message: "Shared-cluster instance deleted.",
    })
    return { status: "deleted" }
  }

  if (!isLiveMode() || !instance.vmId) {
    await transitionInstance(instance.id, ["deleting"], "deleted", {
      set: { ipAddress: null, vmId: null },
    })
    await logInstanceEvent({
      instanceId: instance.id,
      level: "warn",
      stage: "delete",
      action: "completed",
      result: "ok",
      message: "Instance deleted (no VM to clean up).",
    })
    return { status: "deleted" }
  }

  const provider = await getVmProviderById(instance.providerId)
  const vmId = instance.vmId
  const backoffMs = [1_000, 4_000, 16_000, 60_000, 300_000]
  let lastErr: unknown = null

  for (let i = 0; i < backoffMs.length; i++) {
    try {
      const deleted = await provider.deleteVM(vmId)
      const after = await provider.getVMOrNull(vmId)
      if (after == null || deleted) {
        await transitionInstance(instance.id, ["deleting"], "deleted", {
          set: { ipAddress: null, vmId: null },
        })
        await logInstanceEvent({
          instanceId: instance.id,
          level: "warn",
          stage: "delete",
          action: "completed",
          result: "ok",
          detail: { vmId, attempts: i + 1 },
          message: `VM ${vmId} deleted and verified gone.`,
        })
        return { status: "deleted", vmId }
      }
      lastErr = new Error(`VM ${vmId} still present after DELETE`)
    } catch (err) {
      lastErr = err
    }
    await logInstanceEvent({
      instanceId: instance.id,
      level: "warn",
      stage: "delete",
      action: "retry",
      result: "error",
      detail: { vmId, attempt: i + 1 },
      message: `deleteVM attempt ${i + 1} failed: ${await describeVmError(lastErr)}`,
    })
    if (i < backoffMs.length - 1) {
      await new Promise((r) => setTimeout(r, backoffMs[i]))
    }
  }

  await db
    .update(instances)
    .set({ lastError: `delete retries exhausted: ${await describeVmError(lastErr)}` })
    .where(eq(instances.id, instance.id))
  await logInstanceEvent({
    instanceId: instance.id,
    level: "error",
    stage: "delete",
    action: "pending_reconciler",
    result: "error",
    detail: { vmId },
    message: `VM delete failed after ${backoffMs.length} retries. Reconciler will sweep.`,
  })
  return { status: "pending", vmId }
}

/**
 * Build the idempotent over-SSH script that installs a tool's system
 * dependencies on a running box. Derived purely from the catalog flags so the
 * install set stays in lockstep with `agent-tools.ts`. Returns "" when nothing
 * needs installing (→ caller skips the SSH round-trip).
 *
 * - `requiresChromium` → Google Chrome stable (a real .deb; snap chromium can't
 *   launch from a systemd service). Self-contained mirror of bootstrap's
 *   `browserInstallStep()` (which relies on framing-local vars unavailable here).
 * - `requiresNpmGlobal[runtime]` → `npm install -g <pkg>` (guarded, idempotent).
 *
 * Mirrors what bootstrap pre-bakes (browserInstallStep / agent-browser), so a
 * box provisioned before the tool existed converges to the same state.
 */
function buildToolDepsScript(tools: AgentTool[], runtimeId: RuntimeId): string {
  const steps: string[] = []
  if (tools.some((t) => t.requiresChromium)) {
    steps.push(
      `echo "=== install_chrome ==="
install -d -m 0755 /usr/share/keyrings
curl -fsSL --retry 5 --retry-delay 3 https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list
apt-get -o Acquire::Retries=3 update -y
apt-get -o Acquire::Retries=3 install -y google-chrome-stable fonts-liberation`,
    )
  }
  const npmGlobals = Array.from(
    new Set(
      tools
        .map((t) => t.requiresNpmGlobal?.[runtimeId])
        .filter((p): p is string => !!p),
    ),
  )
  for (const pkg of npmGlobals) {
    steps.push(
      `echo "=== install_npm_global ${pkg} ==="
npm ls -g ${pkg} >/dev/null 2>&1 || npm install -g --no-audit --no-fund ${pkg}`,
    )
  }
  if (steps.length === 0) return ""
  return `#!/bin/bash
set -uo pipefail
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a
${steps.join("\n")}
`
}

/**
 * Install the system dependencies (Chromium, npm globals) that the instance's
 * enabled tools need, over SSH. Install-only — separate from
 * `reprovisionBotEnv` (which rewrites config + restarts). The caller runs this
 * BEFORE reprovision so the gateway restarts against a dependency-ready box.
 * No-op in mock mode, for non-systemd (container) instances, or when no enabled
 * tool needs a system dependency.
 */
export async function installToolDependencies(
  instance: Instance,
  toolIds: string[],
): Promise<void> {
  if (!isLiveMode() || !instance.ipAddress) return
  if (!usesSystemd(instance)) return

  const runtime = getRuntime(instance.runtime)
  const tools = enabledToolsForRuntime(toolIds, runtime.id)
  const script = buildToolDepsScript(tools, runtime.id)
  if (!script) return

  const target = sshTargetFor(instance)
  const step = await sshRunScriptLogged(
    target,
    script,
    "installing_tool_deps",
    "tools:install dependencies",
    { timeoutMs: 300_000 }, // Chromium apt can be slow on a cold box
  )
  await logSshStep(instance.id, step)
  if (step.exitCode !== 0 && step.exitCode !== null) {
    throw new Error(
      `Tool dependency install failed (exit ${step.exitCode}): ${
        step.stderr || step.stdout
      }`,
    )
  }
}

export async function reprovisionBotEnv(instance: Instance): Promise<void> {
  if (!isLiveMode() || !instance.ipAddress) {
    await db.insert(instanceLogs).values({
      instanceId: instance.id,
      level: "info",
      message: "Env update signalled (mock).",
    })
    return
  }

  const target = sshTargetFor(instance)

  if (usesSystemd(instance)) {
    const runtime = getRuntime(instance.runtime)
    const { installDir, configSubdir, configPath, workspaceDir, envPath, systemUser } =
      runtime.paths
    const owner = `${systemUser}:${systemUser}`

    // Hermes has no admin login (bearer-token only). OpenClaw keeps the
    // email/password it minted at first provision.
    const hasAdminLogin = runtime.id !== "hermes"
    const adminEmail = hasAdminLogin
      ? (instance.openclawAdminEmail ??
        `admin+${instance.id.slice(0, 8)}@${runtime.id}.local`)
      : ""
    const adminPassword = hasAdminLogin
      ? (instance.openclawAdminPasswordEnc
        ? decryptSecret(instance.openclawAdminPasswordEnc)
        : generateAdminPassword())
      : ""

    const tier = (instance.modelTier ?? "mid") as BudgetTier
    const llmProvider = resolveLlmProvider(instance)
    const route = routeModel(tier, llmProvider)

    // Resolve the LLM key. BYOS "own_key" instances inject the customer's
    // stored key; everyone else uses (or mints) the per-instance OpenRouter
    // runtime key (skipped for NVIDIA-primary bots). Restart-only paths decrypt
    // the existing key rather than minting again.
    const openRouterApiKey =
      instance.byosLlmMode === "own_key" && instance.byosOwnApiKeyEnc
        ? decryptSecret(instance.byosOwnApiKeyEnc)
        : await resolveRuntimeOpenRouterKey(instance, llmProvider)

    const gatewayToken = instance.gatewayTokenEnc
      ? decryptSecret(instance.gatewayTokenEnc)
      : generateGatewayToken()

    // Reuse the existing ingest token; mint one for legacy instances that
    // predate the column (persisted below so the on-disk token matches the DB).
    const eventIngestToken = instance.eventIngestTokenEnc
      ? decryptSecret(instance.eventIngestTokenEnc)
      : generateGatewayToken()

    const initModel = effectiveModel({
      runtimeId: runtime.id,
      llmProvider,
      tier,
      modelSlug: instance.modelSlug,
      routedModel: route.model,
    })
    if (runtime.renderInitScript && !isValidOpenRouterSlug(initModel)) {
      throw new Error(
        `${runtime.displayName} model "${initModel}" is not a valid OpenRouter <author>/<slug> ` +
          `(≥64k context required). Set HERMES_MODELS in src/lib/model-router.ts or the HERMES_MODEL env var.`,
      )
    }

    const env = runtime.buildEnv({
      instance: hasAdminLogin ? { ...instance, openclawAdminEmail: adminEmail } : instance,
      adminEmail,
      adminPassword,
      gatewayToken,
      openRouterApiKey,
    })
    env.PLATFORM_EVENT_INGEST_URL = `${NEXT_PUBLIC_GATEWAY_BASE_URL()}/api/instances/${instance.id}/events`
    env.PLATFORM_EVENT_INGEST_TOKEN = eventIngestToken

    // Persist a freshly-minted ingest token (legacy instance) so the on-disk
    // value the agent will send matches what the ingest endpoint expects.
    if (!instance.eventIngestTokenEnc) {
      await db
        .update(instances)
        .set({ eventIngestTokenEnc: encryptSecret(eventIngestToken) })
        .where(eq(instances.id, instance.id))
    }

    const { sshWriteFile } = await import("@/lib/ssh")

    // Write the .env first — the runtime-init step (Hermes) reads it.
    await sshWriteFile(target, envPath, renderEnvFile(env), { mode: "600" })
    await sshRun(target, `chown ${owner} '${envPath}'`)

    if (runtime.managesOwnConfig && runtime.renderInitScript) {
      // Hermes re-initializes its config via its own CLI (idempotent) rather than us writing
      // a config file — same path as first provision, so the on-disk schema stays correct and
      // a bad config can't slip back in on an agent-type change.
      const initScript = runtime.renderInitScript({
        installDir,
        systemUser,
        cliBinary: runtime.cliBinary,
        envPath,
        provider: llmProvider,
        model: initModel,
        baseUrl: route.baseUrl,
        enabledToolIds: instance.enabledTools ?? [],
      })
      if (initScript) {
        const initStep = await sshRunScriptLogged(
          target,
          initScript,
          "writing_config",
          "reprovision:runtime init + validate",
          { timeoutMs: 180_000 },
        )
        await logSshStep(instance.id, initStep)
        if (initStep.exitCode !== 0 && initStep.exitCode !== null) {
          throw new Error(
            `Reprovision runtime init failed (exit ${initStep.exitCode}): ${
              initStep.stderr || initStep.stdout
            }`,
          )
        }
      }
    } else {
      await sshWriteFile(
        target,
        configPath,
        runtime.renderConfig({
          gatewayToken,
          openRouterApiKey,
          model: initModel,
          fallbackModel: route.fallback,
          domain: instance.domain,
          managedSubdomain: instance.managedSubdomain,
          ipAddress: instance.ipAddress,
          tlsStatus: instance.tlsStatus,
          soulMd: instance.soulMd,
          enabledToolIds: instance.enabledTools ?? [],
        }),
      )
      await sshRun(target, `chown -R ${owner} '${installDir}/${configSubdir}'`)
    }

    const reprovAgentType = instance.agentType ?? "custom"
    await sshRun(target, `mkdir -p '${workspaceDir}'`)
    await sshWriteFile(
      target,
      `${workspaceDir}/AGENTS.md`,
      generateAgentsMd(reprovAgentType),
    )
    await sshWriteFile(
      target,
      `${workspaceDir}/IDENTITY.md`,
      generateIdentityMd(reprovAgentType),
    )
    await sshRun(target, `chown -R ${owner} '${workspaceDir}'`)

    await sshSystemctlRestart(target, runtime.serviceName)

    await db.insert(instanceLogs).values({
      instanceId: instance.id,
      level: "info",
      message: `${runtime.displayName} service restarted with new config and identity files.`,
    })
  } else if (instance.containerName && instance.containerPort) {
    await sshDockerRun(
      target,
      {
        image: BOT_RUNTIME_IMAGE(),
        containerName: instance.containerName,
        hostPort: instance.containerPort,
        env: buildBotEnv(instance),
        pullFirst: false,
      }
    )
    await db.insert(instanceLogs).values({
      instanceId: instance.id,
      level: "info",
      message: "Container restarted with new env.",
    })
  }
}

/**
 * Retry a failed provision by recreating from scratch. Best-effort teardown of
 * any partial provider VM + managed DNS record, clear all provision-derived
 * columns, move the row back to `pending`, then re-run provisionBot — which,
 * with vmId cleared, provisions a brand-new VM. The OpenRouter key is kept
 * (minting is idempotent and tied to the instance's funded credits).
 */
export async function retryProvisionBot(instance: Instance): Promise<void> {
  if (instance.vmId) {
    try {
      const provider = await getVmProviderById(instance.providerId)
      await provider.deleteVM(instance.vmId)
    } catch (err) {
      await logInstanceEvent({
        instanceId: instance.id,
        level: "warn",
        stage: "provision",
        action: "retry_vm_teardown",
        result: "error",
        message: `Retry: partial VM teardown failed (continuing with a fresh VM): ${
          err instanceof Error ? err.message : String(err)
        }`,
      })
    }
  }
  if (instance.cfRecordId || instance.managedSubdomain) {
    try {
      await deleteAgentSubdomain(instance.id, instance.cfRecordId)
    } catch {
      /* best-effort — the DNS upsert on the next run reconciles this */
    }
  }

  await db
    .update(instances)
    .set({
      vmId: null,
      ipAddress: null,
      managedSubdomain: null,
      cfRecordId: null,
      provisionStage: null,
      failedStage: null,
      lastError: null,
      dnsStatus: null,
      tlsStatus: null,
      // Reset to pending directly (not via transitionInstance) so the reset
      // doesn't depend on a failed_provisioning→pending edge existing in the
      // state machine. provisionBot's own pending→provisioning transition is
      // unambiguously legal.
      status: "pending",
    })
    .where(eq(instances.id, instance.id))

  const fresh = await db.query.instances.findFirst({
    where: eq(instances.id, instance.id),
  })
  if (!fresh) throw new Error(`instance ${instance.id} no longer exists`)
  await provisionBot(fresh)
}
