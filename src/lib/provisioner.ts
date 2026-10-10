import crypto from "node:crypto"
import { isIP } from "node:net"
import { lookup } from "node:dns/promises"
import type { InferSelectModel } from "drizzle-orm"
import { db, instances, instanceLogs, instanceKnowledge, regions, serverConfigs, providerHealthLogs, sshKeys, eq, and } from "@/db"
import {
  logInstanceEvent,
  transitionInstance,
  withInstanceLock,
  ensureProvisioningFailed,
} from "@/lib/instance-state"
import { reserveHostSlot, FleetEmptyError, FleetFullError } from "@/lib/host-scheduler"
import { rollbackVmOutcome } from "@/lib/rollback-outcome"
import {
  sshDockerRestart,
  sshDockerRm,
  sshDockerRun,
  sshDockerStart,
  sshDockerStop,
  sshPollBootstrap,
  resolveElevation,
  sshRun,
  sshRunScriptLogged,
  sshInstallCaddyfile,
  sshInstallUserAuthorizedKeys,
  type SshStepResult,
  sshSystemctlRestart,
  sshSystemctlStart,
  sshSystemctlStop,
  sshWaitReady,
  type SshTarget,
} from "@/lib/ssh"
import { decryptSecret, encryptSecret } from "@/lib/crypto-secret"
import { mintRuntimeKey, revokeRuntimeKey } from "@/lib/openrouter-provisioning"
import { computeKeyLimitUsd } from "@/lib/openrouter-billing"
import { refundProratedDailyCompute } from "@/lib/daily-billing"
import { getTenantOpenRouterKey, isResellerChildTeam } from "@/lib/tenant"
import {
  generateAdminPassword,
  generateGatewayToken,
  renderEnvFile,
} from "@/lib/runtimes/shared"
import { ENV_KEY_CHANGED, buildEnvKeyUpsertScript } from "@/lib/runtimes/env-upsert"
import { getRuntime, type RuntimeEngine, type RuntimeId } from "@/lib/runtimes"
import { runtimeAcceptsModel } from "@/lib/runtimes/labels"
import { FREE_DEMO_TTL_MS } from "@/configs/plans"
import { isSafeVersion, resolveForRegistry } from "@/lib/runtime-versions"
import {
  APT_OPTS_LITERAL,
  DISABLE_DEAD_APT_SOURCES,
  chromeInstallCommands,
} from "@/lib/runtimes/bootstrap"
import { PROVISION_EVENT } from "@/lib/provision-events"
import { getVmProvider, describeVmError, type VmProvider, type VpsProvider } from "@/lib/vm-provider"
import {
  getVmProviderById,
  getVmProviderBySlug,
  describeProviderError,
} from "@/lib/providers"
import { routeDeployment, logRoutingDecision, type Candidate } from "@/lib/vps-router"
import { MAX_FAILOVER_ATTEMPTS } from "@/configs/routing"
import {
  createAgentSubdomain,
  deleteAgentSubdomain,
  isAgentDnsEnabled,
  isAgentDnsEnabledFor,
} from "@/lib/agent-dns"
import { ensureManagedOriginCert } from "@/lib/agent-origin-cert"
import { originCertFor, primaryAgentZone, zoneForHostname } from "@/lib/agent-zones"
import { deleteDnsRecord, getCloudflareTokenForTeam } from "@/lib/cloudflare"
import { sshTargetForInstance } from "@/lib/ssh-target"
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
  OPENROUTER_BASE_URL,
  type LlmProvider,
} from "@/lib/model-router"
import {
  resolveByoBaseUrl,
  isOpenRouterProvider,
  type ByoProviderId,
} from "@/configs/llm-providers"
import { parseAgentConfig, type BudgetTier } from "@/lib/agent-config"
import { generateIdentityMd } from "@/lib/agent-identity"
import { generateSoul } from "@/lib/soul"
import { defaultSkillsForCategory } from "@/configs/agent-skills"
import {
  enabledToolsForRuntime,
  knowledgeBaseEnabled,
  expandAutoEnabledTools,
  toolServicesForIds,
  AGENT_TOOLS,
  type AgentTool,
} from "@/configs/agent-tools"
import type { TerminalSpec, ToolService, ToolServiceRoute } from "@/lib/runtimes/types"
import { claimWarmVm, isPoolEnabled } from "@/lib/warm-pool"
import { platformOwnsHostVm } from "@/lib/byos-install"

type Instance = InferSelectModel<typeof instances>

/**
 * The role-first persona written to the runtime's workspace `AGENTS.md` (the
 * file the gateway reads on boot). It IS the canonical persona — regenerated
 * from the live config + skills + Knowledge Base flag via `generateSoul`, so the
 * VPS/BYOS agent presents as its role, not as the OpenClaw/Hermes framework.
 * Falls back to the stored `soulMd` (or a minimal default) if the config can't
 * be parsed, so legacy instances still get a persona.
 */
function buildWorkspaceAgentsMd(
  instance: Instance,
  skills: string[] | null,
  hasKnowledgeBase: boolean,
): string {
  const parsed = instance.agentConfig ? parseAgentConfig(instance.agentConfig) : null
  if (parsed?.ok) {
    const skillIds =
      skills && skills.length > 0
        ? skills
        : defaultSkillsForCategory(instance.agentType ?? "custom")
    return generateSoul(parsed.data, skillIds, { hasKnowledgeBase })
  }
  return instance.soulMd ?? "You are a helpful assistant."
}

const BOT_RUNTIME_IMAGE = () =>
  // LEGACY WIRE FORMAT — the GHCR namespace and image name are deliberately
  // NOT renamed in the Atlas Agents rebrand; the published image still lives
  // at this path. See docs/REBRAND-LEGACY-IDENTIFIERS.md.
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
  // Fail closed: a reseller child team whose tenant has NOT configured an
  // OpenRouter provisioning key must never fall back to the platform key (that
  // would silently bill the platform for the tenant's customer). Block the
  // provision instead — the tenant sets their key in the reseller settings.
  if (!tenantKey && (await isResellerChildTeam(instance.teamId))) {
    throw new Error(
      "This reseller has not configured an OpenRouter account yet. Ask your provider to add one before deploying.",
    )
  }
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
      tenantKeyed: Boolean(tenantKey),
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

/** The LLM credential the runtime `.env`/config is written with. */
type ByosLlmCreds = {
  /** The API key that authenticates against `baseUrl`. */
  apiKey: string
  /** OpenAI-compatible base URL the key authenticates against. */
  baseUrl: string
  /** BYO catalog provider id. "openrouter" for managed/non-BYOS instances. */
  providerId: ByoProviderId
  /**
   * Provider token handed to Hermes' `config set model.provider`. "openrouter"
   * for OpenRouter; "openai" for every direct BYO provider (they are all
   * OpenAI-compatible, reached via `model.base_url`).
   */
  providerToken: string
  /** True when the active key is the customer's own (not our minted key). */
  isOwnKey: boolean
}

/** Map a BYO provider id to the token Hermes recognizes for `model.provider`. */
function hermesProviderToken(providerId: ByoProviderId): string {
  return providerId === "openrouter" ? "openrouter" : "openai"
}

/**
 * Resolve which LLM credential + endpoint a BYOS instance's runtime should be
 * provisioned with. Centralizes what used to be a duplicated ternary at the two
 * injection sites so the "own key vs managed key" decision — and the
 * provider/base-URL that comes with it — lives in exactly one place.
 *
 * Hard invariant: a BYO own-key instance NEVER reaches
 * `resolveRuntimeOpenRouterKey` (which mints our managed key). Managed OpenRouter
 * access is structurally reachable only via `byosLlmMode !== "own_key"`, so a
 * customer bringing their own key can never silently fall back to our credits.
 *
 * The active key honors `byosActiveKeySlot`: when it is "fallback" and a
 * fallback key is configured, the fallback provider/key/base-URL become the
 * active credential — this is how the "switch to fallback" action takes effect
 * on the next reprovision.
 */
async function resolveByosLlmCredentials(instance: Instance): Promise<ByosLlmCreds> {
  const isOwnKey = instance.byosLlmMode === "own_key" && !!instance.byosOwnApiKeyEnc

  if (isOwnKey) {
    const useFallback =
      instance.byosActiveKeySlot === "fallback" &&
      !!instance.byosFallbackProvider &&
      !!instance.byosFallbackApiKeyEnc

    if (useFallback) {
      const providerId = (instance.byosFallbackProvider ?? "openrouter") as ByoProviderId
      const baseUrl =
        resolveByoBaseUrl(providerId, instance.byosFallbackBaseUrl) ?? OPENROUTER_BASE_URL
      return {
        apiKey: decryptSecret(instance.byosFallbackApiKeyEnc!),
        baseUrl,
        providerId,
        providerToken: hermesProviderToken(providerId),
        isOwnKey: true,
      }
    }

    const providerId = (instance.byosOwnProvider ?? "openrouter") as ByoProviderId
    const baseUrl =
      resolveByoBaseUrl(providerId, instance.byosOwnBaseUrl) ?? OPENROUTER_BASE_URL
    return {
      apiKey: decryptSecret(instance.byosOwnApiKeyEnc!),
      baseUrl,
      providerId,
      providerToken: hermesProviderToken(providerId),
      isOwnKey: true,
    }
  }

  // Managed / non-BYOS: mint or reuse our OpenRouter key (skipped for the
  // platform NVIDIA switch, which returns "" and pins NVIDIA via routeModel).
  const provider = resolveLlmProvider(instance)
  const apiKey = await resolveRuntimeOpenRouterKey(instance, provider)
  return {
    apiKey,
    baseUrl: routeModel((instance.modelTier ?? "mid") as BudgetTier, provider).baseUrl,
    providerId: "openrouter",
    // Preserve the platform NVIDIA switch: the provider token stays whatever
    // resolveLlmProvider picked ("openrouter" | "nvidia"), which Hermes'
    // renderInitScript already knows how to register.
    providerToken: provider,
    isOwnKey: false,
  }
}

/**
 * Resolve the full LLM provisioning config a runtime's `.env`/config/init-script
 * is written with: the credential (from {@link resolveByosLlmCredentials}) plus
 * the model + fallback model + the provider token/base-URL Hermes needs.
 *
 * - OpenRouter (managed, NVIDIA switch, or a BYO *OpenRouter* key): keeps the
 *   historical path — `effectiveModel` picks the slug and it must pass
 *   `isValidOpenRouterSlug` before a Hermes init runs.
 * - A BYO *direct* provider (OpenAI/Groq/DeepSeek/NVIDIA-key/custom): Hermes-only
 *   (enforced at the API and defensively here). The model is the user-supplied
 *   `modelSlug` verbatim — we can't validate an arbitrary provider's catalog, so
 *   the OpenRouter-slug guard is skipped and the fallback model mirrors it.
 */
async function resolveRuntimeLlmConfig(
  instance: Instance,
  runtime: RuntimeEngine,
): Promise<{
  apiKey: string
  baseUrl: string
  providerToken: string
  model: string
  fallbackModel: string
}> {
  const creds = await resolveByosLlmCredentials(instance)
  const tier = (instance.modelTier ?? "mid") as BudgetTier

  if (creds.isOwnKey && !isOpenRouterProvider(creds.providerId)) {
    // Defensive: OpenClaw's package cannot target a non-OpenRouter endpoint.
    // The API layer already blocks this combination; fail loudly if it slips through.
    if (!runtime.caps.supportsCustomBaseUrl) {
      throw new Error(
        `Provider "${creds.providerId}" requires the Hermes runtime; ` +
          `${runtime.displayName} only supports OpenRouter.`,
      )
    }
    const model = instance.modelSlug?.trim()
    if (!model) {
      throw new Error(
        `A model is required when bringing a ${creds.providerId} key ` +
          `(no default catalog for a direct provider).`,
      )
    }
    return {
      apiKey: creds.apiKey,
      baseUrl: creds.baseUrl,
      providerToken: creds.providerToken,
      model,
      fallbackModel: model,
    }
  }

  // OpenRouter path (managed / NVIDIA switch / BYO OpenRouter key).
  const llmProvider = resolveLlmProvider(instance)
  const route = routeModel(tier, llmProvider)
  const model = effectiveModel({
    runtimeId: runtime.id,
    llmProvider,
    tier,
    modelSlug: instance.modelSlug,
    routedModel: route.model,
  })
  // Claude Code / Codex only drive their own model family, and only through
  // OpenRouter (Anthropic- or OpenAI-compatible endpoints). Fail before boot
  // rather than hand the user an agent that errors on its first message.
  if (runtime.caps.modelSlugPrefixes) {
    if (llmProvider !== "openrouter") {
      throw new Error(`${runtime.displayName} runs on OpenRouter only (provider "${llmProvider}").`)
    }
    if (!runtimeAcceptsModel(runtime.id, model)) {
      throw new Error(
        `${runtime.displayName} cannot use model "${model}" — it needs a ` +
          `${runtime.caps.modelSlugPrefixes.join(" or ")} model.`,
      )
    }
  }
  if (runtime.renderInitScript && !isValidOpenRouterSlug(model)) {
    throw new Error(
      `${runtime.displayName} model "${model}" is not a valid OpenRouter <author>/<slug> ` +
        `(≥64k context required). Set HERMES_MODELS in src/lib/model-router.ts or the HERMES_MODEL env var.`,
    )
  }
  return {
    apiKey: creds.apiKey,
    baseUrl: creds.baseUrl,
    providerToken: creds.providerToken,
    model,
    fallbackModel: route.fallback,
  }
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
    // Tenant-keyed reseller keys live on the tenant's OpenRouter account — revoke
    // with the tenant's provisioning key or the DELETE 404s and the key stays live.
    const override = instance.tenantKeyed
      ? (await getTenantOpenRouterKey(instance.teamId)) ?? undefined
      : undefined
    await revokeRuntimeKey(instance.openRouterKeyId, override)
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
# We replace the Caddyfile wholesale. On a BYOS box that file may be the
# customer's, serving sites that have nothing to do with us, so keep a
# timestamped copy before clobbering it — recovering their config should not
# require a restore from backup. Only the first overwrite makes a .atlas-orig
# copy; later reprovisions roll a dated one so we never lose the true original.
if [ -s /etc/caddy/Caddyfile ]; then
  if [ ! -f /etc/caddy/Caddyfile.atlas-orig ]; then
    cp -a /etc/caddy/Caddyfile /etc/caddy/Caddyfile.atlas-orig || true
  else
    cp -a /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak.\$(date -u +%Y%m%dT%H%M%SZ)" || true
  fi
fi
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

/**
 * Install (or refresh) and start a runtime's browser terminal unit, then wait
 * for ttyd to answer. Best-effort by design — callers log a failure and carry
 * on, because the agent, its API and the chat UI do not depend on it. Exits 2
 * when ttyd is not installed (the bootstrap's apt step is best-effort too).
 *
 * The unit is only restarted when its file changed: a restart kills the tmux
 * session someone may be working in, so a routine reprovision (a skills toggle)
 * must not do it. An unchanged unit is just `start`ed, a no-op if running.
 */
function buildTerminalStartScript(terminal: TerminalSpec): string {
  const unitB64 = Buffer.from(terminal.renderSystemdUnit(), "utf8").toString("base64")
  const svc = bashSingleQuoteForScript(terminal.serviceName)
  return `#!/bin/bash
set -uo pipefail
UNIT=/etc/systemd/system/${terminal.serviceName}.service

echo "=== terminal: install ==="
if ! command -v ttyd >/dev/null 2>&1 || ! command -v tmux >/dev/null 2>&1; then
  echo "ttyd/tmux not installed — browser terminal unavailable" >&2
  exit 2
fi
echo ${bashSingleQuoteForScript(unitB64)} | base64 -d > "\${UNIT}.new"
CHANGED=0
if ! cmp -s "\${UNIT}.new" "\${UNIT}"; then
  mv "\${UNIT}.new" "\${UNIT}"
  systemctl daemon-reload
  CHANGED=1
else
  rm -f "\${UNIT}.new"
fi
systemctl enable ${svc} >/dev/null 2>&1 || true
if [ "\${CHANGED}" = "1" ]; then systemctl restart ${svc}; else systemctl start ${svc}; fi

echo "=== terminal: health ==="
for _ in \$(seq 1 15); do
  if curl -sf -o /dev/null -m 3 "http://127.0.0.1:${terminal.port}${terminal.healthPath}"; then
    echo "=== terminal: ok ==="
    exit 0
  fi
  sleep 1
done
echo "terminal did not answer on :${terminal.port}" >&2
journalctl -u ${svc} --no-pager -n 30 || true
exit 1
`
}

/**
 * Run buildTerminalStartScript and record the outcome. Never throws — a broken
 * terminal is a warning, not a failed deploy.
 */
async function startRuntimeTerminal(
  instanceId: string,
  target: SshTarget,
  runtime: RuntimeEngine,
  stage: VpsStage,
): Promise<void> {
  if (!runtime.terminal) return
  try {
    const step = await sshRunScriptLogged(
      target,
      buildTerminalStartScript(runtime.terminal),
      stage,
      "provision:terminal (ttyd)",
      { timeoutMs: 60_000 },
    )
    await logSshStep(instanceId, step)
    const ok = step.exitCode === 0 || step.exitCode === null
    await logInstanceEvent({
      instanceId,
      level: ok ? "info" : "warn",
      stage,
      action: "terminal_started",
      result: ok ? "ok" : "error",
      message: ok
        ? `${runtime.displayName} browser terminal is up at /terminal (same login as the chat UI).`
        : step.exitCode === 2
          ? "The browser terminal is unavailable on this server (ttyd could not be installed). The agent itself is unaffected."
          : `The browser terminal did not start (exit ${step.exitCode}). The agent itself is unaffected.`,
    })
  } catch (err) {
    await logInstanceEvent({
      instanceId,
      level: "warn",
      stage,
      action: "terminal_started",
      result: "error",
      message: `Could not start the browser terminal: ${err instanceof Error ? err.message : String(err)}`,
    })
  }
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function isLiveMode(): boolean {
  // Live provisioning needs the fleet SSH key plus at least one provider token.
  // Any enabled VPS provider's credential counts — DO is primary, but Linode
  // remains valid so a multi-provider deployment still reports live mode.
  const hasProviderToken = Boolean(
    process.env.DIGITALOCEAN_API_TOKEN || process.env.LINODE_API_TOKEN,
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
/**
 * Whether this instance's bootstrap should pre-bake the browser-tool system
 * dependencies (Google Chrome ~142MB, plus `agent-browser` on Hermes).
 *
 * Tools are opt-in (`agent-tools.ts` has no `defaultEnabled`), and
 * `installToolDependencies()` installs exactly the same set on demand when the
 * tool is switched on later — its own comment says it "mirrors what bootstrap
 * pre-bakes". So a box whose instance has no chromium-requiring tool has no
 * reason to download Chrome during the window the customer is watching.
 *
 * Deliberately NOT applied to the warm pool: a pooled VM has no instance yet,
 * bake time is ours rather than a customer's, and a claim must stay fast — so
 * that path keeps pre-baking unconditionally by omitting the flag.
 */
/**
 * Resolve the concrete versions this instance will be provisioned with, and
 * record them on the row.
 *
 * Two things depend on this. A BYOS box downloads its packages when the server
 * is connected and installs them when an agent is deployed, so re-resolving
 * `latest` at deploy would miss the warm cache and re-download everything.
 * And until now nothing anywhere recorded what version a box actually got:
 * the package is installed once, at bootstrap, with no upgrade path, so an
 * unrecorded version was unrecoverable short of asking the box.
 *
 * Best-effort by design. A registry that is slow or down yields null, the
 * bootstrap falls back to `latest`, and provisioning proceeds exactly as it
 * did before pinning existed — a version lookup must never be able to block a
 * deploy.
 */
async function resolveAndRecordVersions(
  instance: Instance,
  runtime: RuntimeEngine,
): Promise<{ runtimeVersion?: string; sidecarVersion?: string }> {
  const wantsSidecar = Boolean(instance.webuiEnabled) && Boolean(runtime.sidecar)
  const [runtimeVersion, sidecarVersion] = await Promise.all([
    resolveForRegistry(runtime.registry, runtime.npmPackage, runtime.version()),
    wantsSidecar && runtime.sidecar
      ? resolveForRegistry(
          runtime.sidecar.registry,
          runtime.sidecar.packageName,
          runtime.sidecar.version(),
        )
      : Promise.resolve(null),
  ])

  if (runtimeVersion || sidecarVersion) {
    await db
      .update(instances)
      .set({
        ...(runtimeVersion ? { runtimeVersion } : {}),
        ...(sidecarVersion ? { sidecarVersion } : {}),
      })
      .where(eq(instances.id, instance.id))
  }

  return {
    ...(runtimeVersion ? { runtimeVersion } : {}),
    ...(sidecarVersion ? { sidecarVersion } : {}),
  }
}

function wantsBrowserDeps(instance: Instance, runtime: RuntimeEngine): boolean {
  return enabledToolsForRuntime(instance.enabledTools ?? [], runtime.id).some(
    (t) => t.requiresChromium,
  )
}

function usesSystemd(instance: Instance): boolean {
  return instance.deploymentTarget === "vps" || instance.deploymentTarget === "byos"
}

/**
 * SSH target for an existing instance's host. BYOS servers may use a custom
 * port / login user (stored on the row); managed VPS always uses root@22.
 */
function sshTargetFor(instance: Instance): SshTarget {
  return sshTargetForInstance(instance)
}

/* ------------------------------------------------------------------ */
/* Team SSH keys → agent boxes                                         */
/*                                                                     */
/* SSH keys are managed team-wide (Team → SSH tab / the SshKey table)  */
/* and installed on every managed-VPS agent the team owns. Adding or   */
/* removing a key reconciles the full set on each running box, so the  */
/* team's key list is the single source of truth. BYOS is excluded —   */
/* the customer already owns and reaches that server.                  */
/* ------------------------------------------------------------------ */

/** Public keys currently registered to a team. */
async function teamPublicKeys(teamId: string): Promise<string[]> {
  const rows = await db.query.sshKeys.findMany({
    where: eq(sshKeys.teamId, teamId),
    columns: { publicKey: true },
  })
  return rows.map((r) => r.publicKey.trim()).filter(Boolean)
}

/**
 * Reconcile the team's SSH keys onto one running managed-VPS instance. Skips
 * anything we can't (or shouldn't) reach over SSH: BYOS, non-running, no IP,
 * and non-VPS (shared/serverless have no dedicated host). Best-effort — returns
 * a status instead of throwing so callers can fan out over many boxes.
 */
export async function syncInstanceSshKeys(
  instance: Instance,
): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  if (
    instance.deploymentTarget !== "vps" ||
    instance.status !== "running" ||
    !instance.ipAddress
  ) {
    return { ok: true, skipped: true }
  }
  try {
    const keys = await teamPublicKeys(instance.teamId)
    const res = await sshInstallUserAuthorizedKeys(sshTargetFor(instance), keys)
    if (res.code === 0 || res.code === null) return { ok: true }
    return { ok: false, error: (res.stderr || res.stdout || `exit ${res.code}`).trim() }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Reconcile the team's SSH keys across all of the team's running managed-VPS
 * agents. Best-effort and isolated per instance — one unreachable box never
 * blocks the rest. Call after a key is added or removed. Safe to run in the
 * background (fire-and-forget) from an API route.
 */
export async function syncTeamSshKeys(
  teamId: string,
): Promise<{ synced: number; failed: number }> {
  const rows = await db.query.instances.findMany({
    where: and(
      eq(instances.teamId, teamId),
      eq(instances.status, "running"),
      eq(instances.deploymentTarget, "vps"),
    ),
  })
  let synced = 0
  let failed = 0
  await Promise.all(
    rows.map(async (inst) => {
      const r = await syncInstanceSshKeys(inst)
      if (r.skipped) return
      if (r.ok) synced++
      else {
        failed++
        console.warn(
          JSON.stringify({
            kind: "ssh_key_sync_failed",
            instanceId: inst.id,
            teamId,
            error: r.error,
          }),
        )
      }
    }),
  )
  return { synced, failed }
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

    // Demo agents (Free tier) carry a non-null expiresAt seeded at creation.
    // Re-base the clock to go-live so the user gets the full TTL of running
    // time rather than TTL-minus-provisioning. Best-effort — a failed re-stamp
    // just leaves the create-time deadline in place.
    if (instance.expiresAt) {
      try {
        await db
          .update(instances)
          .set({ expiresAt: new Date(Date.now() + FREE_DEMO_TTL_MS) })
          .where(eq(instances.id, instance.id))
      } catch {
        /* keep the create-time expiry */
      }
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
  /**
   * Whether the provider booted the VM from cloud-init. When false, the runtime
   * bootstrap is run over SSH after boot instead of polling for a cloud-init
   * completion marker that will never arrive.
   */
  supportsCloudInit: boolean
  /**
   * True when this VM came from the warm pool — already fully bootstrapped (and
   * bake-finalized). The provisioner skips the bootstrap stage and runs the
   * fast claim path in configureRuntimeOverSsh.
   */
  preBootstrapped?: boolean
  /**
   * Generic public URL pre-assigned to a claimed warm-pool VM (Cloudflare record
   * already created + propagated). When set, provisionVpsBot reuses it and skips
   * the per-instance createAgentSubdomain call on the hot path.
   */
  managedSubdomain?: string | null
  cfRecordId?: string | null
}

/** Cloud-init capability for a provider — defaults true for the legacy VmProvider. */
function providerSupportsCloudInit(provider: VmProvider): boolean {
  return "supportsCloudInit" in provider
    ? (provider as VpsProvider).supportsCloudInit
    : true
}

type AcquireOpts = {
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

  // Resolved only when we are actually rendering a bootstrap — a golden-image
  // boot installs nothing, so there is no version to pin or to record.
  const pins = opts.useGoldenImage
    ? {}
    : await resolveAndRecordVersions(instance, runtime)
  const bootstrapScript = opts.useGoldenImage
    ? undefined
    : runtime.renderBootstrap({
        gatewayPort: runtime.gatewayPort,
        webuiEnabled: Boolean(instance.webuiEnabled) && Boolean(runtime.sidecar),
        browserDeps: wantsBrowserDeps(instance, runtime),
        ...pins,
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
  // A BYOS agent must never reach this function. Everything below it creates,
  // claims or deletes a machine, and a BYOS machine is the customer's hardware.
  // provisionBotLocked already routes byos → provisionByosBot, so this can only
  // fire if that routing is broken by a future refactor — which is exactly when
  // we want a loud throw rather than a warm-pool claim (or a deleteVM in
  // handleFailedAttempt) landing on someone's own server.
  if (!platformOwnsHostVm(instance.deploymentTarget)) {
    throw new Error(
      `acquireBootedVm called for a ${instance.deploymentTarget} instance (${instance.id}); ` +
        "the platform does not own that machine and must not create, claim or destroy it",
    )
  }

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
      supportsCloudInit: providerSupportsCloudInit(provider),
    }
  }

  const input = {
    regionId: instance.regionId,
    serverConfigId: instance.serverConfigId,
    instanceId: instance.id,
  }
  const decision = await routeDeployment(input)

  // Warm pool: try to claim a ready, pre-bootstrapped VM matching a ranked
  // candidate (runtime+provider+plan+region) before creating a cold one. On a
  // hit we skip the whole bootstrap stage and run the fast claim path.
  const webuiEnabled = Boolean(instance.webuiEnabled) && Boolean(runtime.sidecar)
  const claimed = await claimWarmVm({
    runtime: runtime.id,
    webuiEnabled,
    instanceId: instance.id,
    candidates: decision.ranked.map((c) => ({
      providerSlug: c.providerSlug,
      planCode: c.providerPlanCode,
      regionCode: c.providerRegionCode,
    })),
  })
  if (claimed) {
    const provider = await getVmProviderById(claimed.providerId)
    // Persist VM identity + secrets + the baked host fingerprint onto the
    // instance so the rest of provisioning treats it as a normal owned VM and
    // connectAndPin matches the already-known key instead of re-pinning.
    const set: Record<string, unknown> = {
      vmId: claimed.vmId,
      ipAddress: claimed.ipAddress,
      providerId: claimed.providerId,
    }
    if (claimed.rootPasswordEnc) set.rootPasswordEnc = claimed.rootPasswordEnc
    if (claimed.sshHostFingerprint) set.sshHostFingerprint = claimed.sshHostFingerprint
    // Inherit the pool VM's pre-assigned generic URL: the Cloudflare record is
    // already created + propagated, so the instance reuses it (no DNS call on the
    // hot path — see provisionVpsBot step 2b, which skips createAgentSubdomain).
    if (claimed.managedSubdomain) {
      set.managedSubdomain = claimed.managedSubdomain
      set.cfRecordId = claimed.cfRecordId
      set.dnsStatus = "propagating"
    }
    await db.update(instances).set(set).where(eq(instances.id, instance.id))
    await logInstanceEvent({
      instanceId: instance.id,
      stage: "create_vm",
      action: "warm_pool_claimed",
      result: "ok",
      detail: { vmId: claimed.vmId, poolKey: claimed.poolKey },
      message: `Claimed a warm pool VM (${claimed.poolKey}) — skipping bootstrap for a sub-25s deploy.`,
    })
    return {
      provider,
      providerId: claimed.providerId,
      vmId: claimed.vmId,
      ipAddress: claimed.ipAddress,
      useGoldenImage: false,
      supportsCloudInit: providerSupportsCloudInit(provider),
      preBootstrapped: true,
      managedSubdomain: claimed.managedSubdomain,
      cfRecordId: claimed.cfRecordId,
    }
  }

  // Warm pool is the primary delivery path. If it's enabled but had no ready VM
  // matching this deploy, we fall through to cold provisioning (slower) — surface
  // it as a warning so a drained/undersized pool is visible in the timeline.
  if (isPoolEnabled()) {
    await logInstanceEvent({
      instanceId: instance.id,
      level: "warn",
      stage: "create_vm",
      action: "warm_pool_miss",
      result: "error",
      message:
        "Warm pool had no ready VM for this runtime/plan/region — falling back to cold provisioning. The pool may be draining or undersized (check POOL_SIZE_*).",
    })
  }

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
    return {
      provider,
      providerId: null,
      vmId,
      ipAddress,
      useGoldenImage,
      supportsCloudInit: providerSupportsCloudInit(provider),
    }
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
      return {
        provider,
        providerId: candidate.providerId,
        vmId,
        ipAddress,
        useGoldenImage,
        supportsCloudInit: providerSupportsCloudInit(provider),
      }
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

  // The Cloudflare origin cert is no longer read here and baked into the
  // bootstrap (i.e. into cloud-init user-data, which anything on the droplet
  // can read back from the metadata service). configureRuntimeOverSsh installs
  // the one for the hostname's own zone, over SSH — see agent-origin-cert.ts.
  // Still validated up front, so a malformed PEM fails before we pay for a VM.
  originCertFor(primaryAgentZone())
  let vmId: string | undefined = instance.vmId ?? undefined
  let ipAddress: string | undefined = instance.ipAddress ?? undefined
  let currentStage: VpsStage = "create_vm"
  let providerId: string | null = instance.providerId ?? null

  try {
    /* --- 1+2. Route → create VM → wait for boot, with failover ------ */
    const acquired = await acquireBootedVm(instance, runtime, {
      setStage: async (s) => {
        currentStage = s
        await setProvisionStage(instance.id, s)
      },
    })
    vmId = acquired.vmId
    ipAddress = acquired.ipAddress
    providerId = acquired.providerId
    const useGoldenImage = acquired.useGoldenImage
    const supportsCloudInit = acquired.supportsCloudInit
    const fromWarmPool = acquired.preBootstrapped === true

    /* --- 2b. Cloudflare managed subdomain --------------------------- */
    // Warm-pool VMs arrive with a generic URL already created + propagated at
    // bake (acquireBootedVm copied it onto the row). Reuse it and skip the
    // Cloudflare call entirely so DNS never sits on the deploy hot path.
    let managedSubdomainForProvision: string | null =
      acquired.managedSubdomain ?? instance.managedSubdomain ?? null
    const hasPreAssignedUrl = fromWarmPool && Boolean(acquired.managedSubdomain)
    if (hasPreAssignedUrl) {
      await logInstanceEvent({
        instanceId: instance.id,
        stage: currentStage,
        action: "dns_preassigned",
        result: "ok",
        message: `Reusing warm pool pre-assigned URL: ${managedSubdomainForProvision} → ${ipAddress} (already propagated).`,
      })
    }
    if (!hasPreAssignedUrl && isAgentDnsEnabled()) {
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

    /* --- 4. Bootstrap: golden image (skip), cloud-init (poll), or run  */
    /*        the bootstrap over SSH for providers without cloud-init.    */
    if (useGoldenImage || fromWarmPool) {
      currentStage = "bootstrap"
      await setProvisionStage(instance.id, currentStage)
      await logInstanceEvent({
        instanceId: instance.id,
        stage: currentStage,
        action: "bootstrap_complete",
        result: "ok",
        message: fromWarmPool
          ? "Warm pool VM — already bootstrapped and bake-finalized. Skipping cloud-init."
          : "Golden image — bootstrap already complete. Skipping cloud-init.",
      })
    } else if (supportsCloudInit) {
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
    } else {
      // No cloud-init: run the runtime bootstrap over SSH, mirroring the BYOS
      // path. The VM booted a clean Ubuntu image with our fleet key.
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
        "vps:bootstrap (install node/caddy/runtime)",
        { timeoutMs: 600_000 },
      )
      await logSshStep(instance.id, bootstrapStep)
      if (bootstrapStep.exitCode !== 0 && bootstrapStep.exitCode !== null) {
        throw new Error(
          `SSH bootstrap failed (exit ${bootstrapStep.exitCode}): ${
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
    }

    /* --- 5-12. Configure the runtime over SSH (credentials, .env +    */
    /*           config write, Caddy + systemd install, health check,   */
    /*           commit). Shared verbatim with the BYOS path — the only  */
    /*           difference upstream is how we got here (Linode VM vs.   */
    /*           the customer's own server). The LLM credential (managed */
    /*           key vs. BYO key/provider) is resolved inside.           */
    return await configureRuntimeOverSsh(instance, target, ipAddress, runtime, {
      managedSubdomain: managedSubdomainForProvision,
      vmId,
      fromWarmPool,
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
/**
 * Read the runtime version that is ACTUALLY on the box and record it.
 *
 * `resolveAndRecordVersions` records what we *intended* to install, which is
 * enough for a cold install but wrong in two cases: a warm-pool VM was
 * bootstrapped at bake time, long before this instance existed, so nothing
 * ever resolved a version for it; and an intended pin can silently fail to be
 * what landed. Reading `--version` off the box covers both, and the warm pool
 * is the primary managed path — without this, `instances.runtimeVersion` would
 * be NULL for most instances and the column would not answer the question it
 * was added for.
 *
 * Fire-and-forget by design. This is bookkeeping: it must never delay a deploy
 * (the warm-pool claim path is held to ~25s) and must never fail one.
 */
async function recordObservedRuntimeVersion(
  instance: Instance,
  target: SshTarget,
  runtime: RuntimeEngine,
): Promise<void> {
  const res = await sshRun(target, `${runtime.cliBinary} --version 2>/dev/null | head -1`)
  // Runtimes print their version in varying shapes ("openclaw/2026.9.5",
  // "hermes, version 0.19.0"); take the first dotted numeric run.
  const observed = res.stdout.match(/[0-9]+(?:\.[0-9]+)+/)?.[0]
  if (!observed || !isSafeVersion(observed)) return
  if (observed === instance.runtimeVersion) return
  await db
    .update(instances)
    .set({ runtimeVersion: observed })
    .where(eq(instances.id, instance.id))
}

async function configureRuntimeOverSsh(
  instance: Instance,
  target: SshTarget,
  ipAddress: string,
  runtime: RuntimeEngine,
  opts: {
    managedSubdomain: string | null
    vmId: string | undefined
    /**
     * True when the VM came from the warm pool (already bootstrapped +
     * bake-finalized). Enables the fast claim path: skip the runtime's
     * setup/doctor (done at bake) and move the Open WebUI admin seed + the
     * `/v1/models` verification OFF the critical path (run async after commit),
     * so delivery lands under 25s.
     */
    fromWarmPool?: boolean
  },
): Promise<ProvisionResult> {
  const { managedSubdomain, vmId } = opts
  const fromWarmPool = opts.fromWarmPool === true
  // Resolve the LLM credential + endpoint + model (managed key, BYO OpenRouter
  // key, or a BYO direct-provider key with its own base URL). One resolver owns
  // the own-key-vs-managed decision and the model/guard rules. See
  // resolveRuntimeLlmConfig / resolveByosLlmCredentials.
  const llmConfig = await resolveRuntimeLlmConfig(instance, runtime)
  let currentStage: VpsStage = "writing_config"

  // Give the team SSH access to their own managed VPS: install every SSH key on
  // the owning team (managed on the Team → SSH tab) into root's authorized_keys
  // alongside the fleet key. Skipped for BYOS — the customer already owns and
  // can reach that box. Best-effort: a failure here must not fail an otherwise-
  // healthy provision (the box is fully functional without owner SSH; the next
  // key add/remove or re-provision reconciles it).
  if (instance.deploymentTarget !== "byos") {
    try {
      const keys = await teamPublicKeys(instance.teamId)
      const res = await sshInstallUserAuthorizedKeys(target, keys)
      if (res.code === 0 || res.code === null) {
        await logInstanceEvent({
          instanceId: instance.id,
          stage: currentStage,
          message: keys.length
            ? `Installed ${keys.length} team SSH key(s) for root access on the VPS.`
            : "No team SSH keys to install.",
        })
      } else {
        await logInstanceEvent({
          instanceId: instance.id,
          stage: currentStage,
          level: "warn",
          message: `Could not install team SSH keys (exit ${res.code}); continuing. ${
            res.stderr || res.stdout
          }`.trim(),
        })
      }
    } catch (keyErr) {
      await logInstanceEvent({
        instanceId: instance.id,
        stage: currentStage,
        level: "warn",
        message: `Could not install team SSH keys (continuing): ${
          keyErr instanceof Error ? keyErr.message : String(keyErr)
        }`,
      })
    }
  }

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
  const needsAdmin = runtime.caps.nativeAdminLogin || webuiEnabled
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
    openRouterApiKey: llmConfig.apiKey,
    baseUrl: llmConfig.baseUrl,
  })
  // Observability ingest wiring — runtime-agnostic, so both OpenClaw and Hermes
  // emit to the same endpoint with the same token contract.
  env.PLATFORM_EVENT_INGEST_URL = `${NEXT_PUBLIC_GATEWAY_BASE_URL()}/api/instances/${instance.id}/events`
  env.PLATFORM_EVENT_INGEST_TOKEN = eventIngestToken

  const envContent = renderEnvFile(env)
  const envB64 = Buffer.from(envContent, "utf8").toString("base64")

  // Install the origin cert for the zone this hostname is in, on every path —
  // a warm-pool VM never had one baked in, and a box from before a zone move
  // holds the old zone's. See agent-origin-cert.ts.
  const originCert = await ensureManagedOriginCert(target, managedSubdomain)
  const useCfOriginTls = originCert.useCfOriginTls
  if (originCert.warning) {
    await logInstanceEvent({
      instanceId: instance.id,
      stage: currentStage,
      level: "warn",
      message: originCert.warning,
    })
  }
  if (managedSubdomain && !useCfOriginTls) {
    await logInstanceEvent({
      instanceId: instance.id,
      stage: currentStage,
      level: "info",
      message:
        `Managed hostname has no origin certificate for ${originCert.zone ?? "its zone"}; Caddy will use \`tls internal\` (self-signed). Cloudflare SSL must be "Full" (not "Full (strict)") for this to work. For "Full (strict)", set that zone's origin cert (CLOUDFLARE_ORIGIN_CERT_* for the legacy zone, CLOUDFLARE_AGENT_ORIGIN_CERT_* for the agent zone).`,
    })
  }

  const caddyContent = runtime.renderCaddyfile({
    domain: instance.domain,
    managedSubdomain,
    useCfOriginTls,
    // Put the sidecar (Open WebUI :8080) in front; the gateway stays loopback-only.
    upstreamPort: webuiEnabled && runtime.sidecar ? runtime.sidecar.port : undefined,
    // Companion-service routes (e.g. `/n8n/`) present from first boot; the
    // service itself is installed/started by syncToolServices after health.
    toolServices: toolServiceRoutesForInstance(instance),
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
      // Same slug the runtime pins as its own default — the chat UI needs it to
      // pre-select a model for the freshly seeded admin account.
      model: llmConfig.model,
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
          openRouterApiKey: llmConfig.apiKey,
          model: llmConfig.model,
          fallbackModel: llmConfig.fallbackModel,
          baseUrl: llmConfig.baseUrl,
          domain: instance.domain,
          managedSubdomain,
          ipAddress,
          tlsStatus: instance.domain ? instance.tlsStatus : null,
          enabledToolIds: expandAutoEnabledTools(instance.enabledTools ?? []),
        }),
        "utf8",
      ).toString("base64")

  /* Phase A — write .env + openclaw.json + identity files (batch, ~5s) */
  const agentType = instance.agentType ?? "custom"
  const identityOpts = {
    skills: (instance.skills as string[] | null) ?? null,
    hasKnowledgeBase: knowledgeBaseEnabled(instance.enabledTools ?? []),
  }
  const agentsMdB64 = Buffer.from(
    buildWorkspaceAgentsMd(instance, identityOpts.skills, identityOpts.hasKnowledgeBase),
    "utf8",
  ).toString("base64")
  const identityMdB64 = Buffer.from(generateIdentityMd(agentType, identityOpts), "utf8").toString("base64")
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
      provider: llmConfig.providerToken,
      model: llmConfig.model,
      baseUrl: llmConfig.baseUrl,
      enabledToolIds: expandAutoEnabledTools(instance.enabledTools ?? []),
      // Warm-pool VMs already ran setup/doctor at bake — skip them at claim.
      skipSetupAndDoctor: fromWarmPool,
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
    // Warm-pool deploys move this OFF the critical path (run async after commit).
    if (runtime.caps.exposesOpenAiApi && !fromWarmPool) {
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
    // not fail the deploy. Warm-pool deploys move this OFF the critical path.
    if (webuiEnabled && runtime.sidecar && !fromWarmPool) {
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

    // Browser terminal (Claude Code / Codex). Best-effort, never fails the deploy.
    await startRuntimeTerminal(instance.id, target, runtime, currentStage)

    // Companion services (n8n): install + start + seed once the gateway is
    // healthy. Kept off the warm-pool critical path (see runWarmPoolPostChecks).
    // Best-effort — a failure logs a warning but doesn't fail the deploy.
    if (!fromWarmPool) {
      await syncToolServices(instance, instance.enabledTools ?? []).catch(
        async (err) => {
          await logInstanceEvent({
            instanceId: instance.id,
            level: "warn",
            stage: currentStage,
            action: "tool_service_sync",
            result: "error",
            message: `Companion service setup failed: ${err instanceof Error ? err.message : String(err)}`,
          })
        },
      )
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

  // Warm-pool fast path: the gateway is healthy and committed; run the
  // non-essential post-checks (Hermes /v1/models verification + Open WebUI
  // admin seed) asynchronously so they don't count against the <25s delivery
  // budget. Best-effort — a failure only flips a warning event.
  if (fromWarmPool) {
    void runWarmPoolPostChecks({
      instanceId: instance.id,
      target,
      runtime,
      webuiEnabled,
      adminEmail,
      adminPassword,
    }).catch(() => {
      /* observability only — deploy already committed */
    })
  }

  // Bookkeeping, deliberately off the critical path — see the helper.
  void recordObservedRuntimeVersion(instance, target, runtime).catch(() => {
    /* a version we failed to read is not a reason to fail a deploy */
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
 * Off-critical-path post-checks for a warm-pool deploy: verify Hermes'
 * `/v1/models` and seed the Open WebUI admin. Runs AFTER the instance is
 * committed `running`, so it never counts against delivery time. Each step logs
 * its own outcome and is fully best-effort.
 */
async function runWarmPoolPostChecks(opts: {
  instanceId: string
  target: SshTarget
  runtime: RuntimeEngine
  webuiEnabled: boolean
  adminEmail: string
  adminPassword: string
}): Promise<void> {
  const { instanceId, target, runtime, webuiEnabled, adminEmail, adminPassword } = opts

  if (runtime.caps.exposesOpenAiApi) {
    try {
      const modelsStep = await sshRunScriptLogged(
        target,
        buildApiModelsCheckScript({ envPath: runtime.paths.envPath, port: runtime.gatewayPort }),
        "health_check",
        "provision:health (GET /v1/models) [async]",
        { timeoutMs: 60_000 },
      )
      const ok = modelsStep.exitCode === 0 || modelsStep.exitCode === null
      await logInstanceEvent({
        instanceId,
        level: ok ? "info" : "warn",
        stage: "health_check",
        action: "api_models_ok",
        result: ok ? "ok" : "error",
        message: ok
          ? `${runtime.displayName} OpenAI-compatible API verified (/v1/models).`
          : `${runtime.displayName} /v1/models post-check failed — the agent may not answer until the model wires up.`,
      })
    } catch {
      /* best-effort */
    }
  }

  if (webuiEnabled && runtime.sidecar) {
    try {
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
        "health_check",
        "provision:seed (open-webui admin) [async]",
        { timeoutMs: 120_000 },
      )
      const seedOk = seedStep.exitCode === 0 || seedStep.exitCode === null
      await logInstanceEvent({
        instanceId,
        level: seedOk ? "info" : "warn",
        stage: "health_check",
        action: "webui_admin_seeded",
        result: seedOk ? "ok" : "error",
        message: seedOk
          ? "Open WebUI admin account created and public signup disabled."
          : "Could not seed the Open WebUI admin; signup is left open so the first visitor becomes admin.",
      })
    } catch {
      /* best-effort */
    }
  }

  // Companion services (n8n): install + start + seed off the warm-pool critical
  // path. Loads the freshly-committed row so enabledTools + persisted secrets are
  // current. Best-effort — the Caddy `/n8n/` route was already written at claim.
  try {
    const fresh = await db.query.instances.findFirst({
      where: eq(instances.id, instanceId),
    })
    if (fresh) await syncToolServices(fresh, fresh.enabledTools ?? [])
  } catch {
    /* best-effort */
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
/**
 * Resolve a BYOS host to an IPv4 address for a Cloudflare A record. Literal
 * IPv4 passes through; a hostname is resolved to its first A record. Returns
 * null for IPv6-only / unresolvable hosts (the managed subdomain is then
 * skipped and the agent stays reachable by IP).
 */
async function resolveIpv4ForDns(host: string): Promise<string | null> {
  if (isIP(host) === 4) return host
  if (isIP(host) === 6) return null
  try {
    const { address, family } = await lookup(host, { family: 4 })
    return family === 4 ? address : null
  } catch {
    return null
  }
}

async function provisionByosBot(instance: Instance): Promise<ProvisionResult> {
  const runtime = getRuntime(instance.runtime)
  const host = instance.byosHost
  if (!host) {
    throw new Error("BYOS instance is missing byosHost — cannot connect")
  }

  // The Cloudflare origin cert for the managed subdomain is installed by
  // configureRuntimeOverSsh, for the hostname's own zone — same as the managed
  // VPS path. Without one Caddy serves `tls internal`, which needs the zone in
  // "Full" rather than "Full (strict)". Validated up front so a malformed PEM
  // fails before we touch the customer's server.
  originCertFor(primaryAgentZone())
  const port = instance.byosPort ?? 22
  const username = instance.byosUser ?? "root"
  // Elevation is decided after connect via `resolveElevation` (id -u / sudo -n),
  // not guessed from the username — a non-root login named "root" or a
  // sudo-capable account both defeat a string check. Starts unelevated; the
  // real value is set once SSH is ready (before the bootstrap runs).
  const target: SshTarget = {
    host,
    port,
    username,
    instanceId: instance.id,
    elevate: false,
  }
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
        `Could not SSH into ${host}:${port}. Confirm you added the Atlas Agents fleet ` +
          `public key to ${username}'s authorized_keys and that port ${port} is open. ` +
          `(${e instanceof Error ? e.message : String(e)})`,
      )
    }

    // Decide how to gain root for the privileged bootstrap: connect as root
    // directly, or run everything under passwordless sudo. Fails fast with a
    // clear error if neither is possible (rather than an opaque permission
    // denied mid-bootstrap).
    target.elevate = await resolveElevation(target)

    /* --- 2. Bootstrap (install Node + Caddy + runtime) over SSH ----- */
    currentStage = "bootstrap"
    await setProvisionStage(instance.id, currentStage)
    await logInstanceEvent({
      instanceId: instance.id,
      stage: currentStage,
      message: PROVISION_EVENT.bootstrapping,
    })
    const pins = await resolveAndRecordVersions(instance, runtime)
    const bootstrapScript = runtime.renderBootstrap({
      gatewayPort: runtime.gatewayPort,
      webuiEnabled: Boolean(instance.webuiEnabled) && Boolean(runtime.sidecar),
      browserDeps: wantsBrowserDeps(instance, runtime),
      ...pins,
      // The customer's sshd may be on any port, and the box is not ours to
      // firewall — see BootstrapRenderArgs. Passing the wrong port here, or
      // enabling ufw at all, locks the owner out of their own server.
      sshPort: port,
      manageFirewall: false,
    })
    const bootstrapStep = await sshRunScriptLogged(
      target,
      bootstrapScript,
      currentStage,
      "byos:bootstrap (install node/caddy/runtime)",
      // A customer box builds everything from source (no cloud-init, no warm
      // pool) and may sit behind a slow mirror; 600s was tight enough that a
      // Hermes + Open WebUI install could be killed just short of finishing.
      { timeoutMs: 900_000 },
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

    /* --- 2b. Managed subdomain (in the primary agent zone) pointing at the  */
    /*         server, so the agent gets a real HTTPS hostname instead of a   */
    /*         bare IP. Best-effort: a DNS failure (or an unresolvable/IPv6   */
    /*         host) logs a warning and provisioning continues IP-only.       */
    let managedSubdomainForProvision: string | null = instance.managedSubdomain ?? null
    if (isAgentDnsEnabled()) {
      const dnsIp = await resolveIpv4ForDns(host)
      if (!dnsIp) {
        await logInstanceEvent({
          instanceId: instance.id,
          stage: currentStage,
          level: "warn",
          message: `Could not resolve ${host} to an IPv4 address for a managed hostname; the agent stays reachable by IP.`,
        })
      } else {
        try {
          const { name, recordId } = await createAgentSubdomain(instance.id, dnsIp, instance.name)
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
            message: `Cloudflare DNS upserted: ${name} → ${dnsIp} (proxied)`,
          })
        } catch (cfErr) {
          await logInstanceEvent({
            instanceId: instance.id,
            stage: currentStage,
            level: "warn",
            message: `Cloudflare DNS upsert failed (continuing without managed subdomain): ${
              cfErr instanceof Error ? cfErr.message : String(cfErr)
            }`,
          })
        }
      }
    }

    /* --- 3+4. Shared configure-over-SSH (managed subdomain, no VM).    */
    /*   The LLM credential (our minted key vs. the customer's own key + */
    /*   provider/base-URL) is resolved inside via resolveRuntimeLlmConfig. */
    return await configureRuntimeOverSsh(instance, target, host, runtime, {
      managedSubdomain: managedSubdomainForProvision,
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

  const outcome = rollbackVmOutcome(vmId, vmDeleted)
  await logInstanceEvent({
    instanceId,
    level: outcome.level,
    stage: "rollback",
    action: outcome.action,
    result: outcome.result,
    detail: vmId ? { vmId } : undefined,
    message: outcome.message,
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

/** systemd unit name for the runtime's browser terminal, when it has one. */
function terminalServiceFor(instance: Instance): string | undefined {
  return getRuntime(instance.runtime).terminal?.serviceName
}

export async function restartBot(instance: Instance): Promise<void> {
  if (isLiveMode() && instance.ipAddress) {
    if (usesSystemd(instance)) {
      const target = sshTargetFor(instance)
      await sshSystemctlRestart(target, getRuntime(instance.runtime).serviceName)
      const sidecar = sidecarServiceFor(instance)
      if (sidecar) await sshSystemctlRestart(target, sidecar)
      const terminal = terminalServiceFor(instance)
      if (terminal) await sshSystemctlRestart(target, terminal)
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

/**
 * Restart or gracefully reload the Caddy ingress on a self-hosted host.
 * `reload` swaps config with near-zero downtime; `restart` is a full stop/start
 * that briefly drops ingress. Only meaningful on systemd hosts (VPS/BYOS) — the
 * `caddy` unit does not exist on shared-container bots.
 */
export async function restartCaddy(
  instance: Instance,
  mode: "reload" | "restart",
): Promise<void> {
  if (isLiveMode() && instance.ipAddress) {
    if (!usesSystemd(instance)) {
      throw new Error("Caddy is only managed on VPS/BYOS hosts.")
    }
    const target = sshTargetFor(instance)
    const result =
      mode === "restart"
        ? await sshSystemctlRestart(target, "caddy")
        : await sshRun(target, "systemctl reload caddy || systemctl restart caddy")
    if (result.code !== 0 && result.code !== null) {
      throw new Error(result.stderr?.trim() || `caddy ${mode} exited ${result.code}`)
    }
  }
  await logInstanceEvent({
    instanceId: instance.id,
    stage: "restart",
    result: "ok",
    message: isLiveMode() ? `Caddy ${mode}ed.` : `Caddy ${mode} signal received (mock).`,
  })
}

export async function pauseBot(instance: Instance): Promise<void> {
  if (isLiveMode() && instance.ipAddress) {
    if (usesSystemd(instance)) {
      const target = sshTargetFor(instance)
      // Stop the terminal and sidecar before the gateway they depend on.
      const terminal = terminalServiceFor(instance)
      if (terminal) await sshSystemctlStop(target, terminal)
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
      // Start the gateway before the sidecar and terminal that depend on it.
      await sshSystemctlStart(target, getRuntime(instance.runtime).serviceName)
      const sidecar = sidecarServiceFor(instance)
      if (sidecar) await sshSystemctlStart(target, sidecar)
      const terminal = terminalServiceFor(instance)
      if (terminal) await sshSystemctlStart(target, terminal)
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
    instance.managedSubdomain &&
    process.env.CLOUDFLARE_API_TOKEN &&
    !zoneForHostname(instance.managedSubdomain)
  ) {
    // Its zone is no longer configured (e.g. CLOUDFLARE_AGENT_* unset after a
    // cutover was rolled back). Say so rather than leak the record silently.
    await logInstanceEvent({
      instanceId: instance.id,
      level: "warn",
      stage: "delete",
      action: "cf_dns_delete",
      result: "error",
      message: `Cloudflare DNS record for ${instance.managedSubdomain} left in place: its agent zone is not configured (CLOUDFLARE_AGENT_* / CLOUDFLARE_ZONE_ID).`,
    })
  } else if (
    (instance.managedSubdomain || instance.cfRecordId) &&
    isAgentDnsEnabledFor(instance.managedSubdomain)
  ) {
    try {
      // The hostname picks the zone: after a zone move this agent's record is
      // still in whichever zone it was created in.
      await deleteAgentSubdomain(instance.id, instance.cfRecordId, instance.managedSubdomain)
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
      set: { ipAddress: null, deletedIpAddress: instance.ipAddress ?? null },
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
      set: {
        ipAddress: null,
        deletedIpAddress: instance.ipAddress ?? null,
        containerName: null,
        containerPort: null,
      },
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
      set: { ipAddress: null, deletedIpAddress: instance.ipAddress ?? null, vmId: null },
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
          set: { ipAddress: null, deletedIpAddress: instance.ipAddress ?? null, vmId: null },
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
 *   launch from a systemd service). Shares `chromeInstallCommands()` with the
 *   bootstrap, passing the apt flags as a literal because the framing's
 *   `$APT_OPTS` variable does not exist in this standalone script.
 * - `requiresNpmGlobal[runtime]` → `npm install -g <pkg>` (guarded, idempotent).
 *
 * Mirrors what bootstrap pre-bakes (browserInstallStep / agent-browser), so a
 * box provisioned before the tool existed converges to the same state.
 */
function buildToolDepsScript(tools: AgentTool[], runtimeId: RuntimeId): string {
  const steps: string[] = []
  if (tools.some((t) => t.requiresChromium)) {
    // Every box bootstrapped before 2026-10-09 lists Caddy's Cloudsmith repo,
    // which now answers 402 — and one dead source fails the whole
    // `apt-get update` below. See DISABLE_DEAD_APT_SOURCES.
    steps.push(`echo "=== apt_sources ==="\n${DISABLE_DEAD_APT_SOURCES}`)
    // Shared with the bootstrap rather than hand-copied. The copy that used to
    // live here carried only `Acquire::Retries` — no `DPkg::Lock::Timeout` —
    // so enabling the browser tool on an already-running box could fail
    // instantly on the dpkg lock held by unattended-upgrades. That is the
    // BYOS case almost by definition: a real server, not a fresh image.
    steps.push(
      `echo "=== install_chrome ==="\n${chromeInstallCommands(APT_OPTS_LITERAL)}`,
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

/* --- Per-tool companion services (e.g. n8n) ------------------------------ */

/** Caddy routes for the companion services an instance's enabled tools imply. */
function toolServiceRoutesForInstance(instance: Instance): ToolServiceRoute[] {
  return toolServicesForIds(instance.enabledTools ?? []).map((s) => ({
    pathPrefix: s.caddyPathPrefix,
    port: s.port,
  }))
}

/** Every companion service the catalog can provision (enabled or not). */
function allToolServices(): ToolService[] {
  return AGENT_TOOLS.map((t) => t.service).filter((s): s is ToolService => !!s)
}

/**
 * Resolve (and, on first enable, mint + persist) the stable secrets a tool
 * service needs. The encryption key MUST survive restarts/reprovisions — n8n
 * encrypts its saved workflow credentials with it — so it's stored encrypted on
 * the instance and reused. The owner password gates the service's UI and is
 * surfaced to the user (and to the agent for browser control). Only n8n today.
 */
async function resolveToolServiceSecrets(
  instance: Instance,
  service: ToolService,
): Promise<{ encryptionKey: string; ownerEmail: string; ownerPassword: string }> {
  // LEGACY WIRE FORMAT — n8n owner accounts on already-provisioned boxes were
  // created with this synthetic domain. See docs/REBRAND-LEGACY-IDENTIFIERS.md.
  const ownerEmail = `${service.serviceName}+${instance.id.slice(0, 8)}@sovereignml.local`
  let encryptionKey = instance.n8nEncryptionKeyEnc
    ? decryptSecret(instance.n8nEncryptionKeyEnc)
    : ""
  let ownerPassword = instance.n8nOwnerPasswordEnc
    ? decryptSecret(instance.n8nOwnerPasswordEnc)
    : ""

  const patch: Partial<typeof instances.$inferInsert> = {}
  if (!encryptionKey) {
    encryptionKey = generateGatewayToken()
    patch.n8nEncryptionKeyEnc = encryptSecret(encryptionKey)
  }
  if (!ownerPassword) {
    // generateAdminPassword uses a mixed upper/lower/digit alphabet at length
    // 24, satisfying n8n's owner-password policy (>=8 chars, a number + a
    // capital) with overwhelming probability.
    ownerPassword = generateAdminPassword()
    patch.n8nOwnerPasswordEnc = encryptSecret(ownerPassword)
  }
  if (Object.keys(patch).length > 0) {
    await db.update(instances).set(patch).where(eq(instances.id, instance.id))
  }
  return { encryptionKey, ownerEmail, ownerPassword }
}

/**
 * Self-contained bash to bring one companion service up on the box: install the
 * package (idempotent), write its env file + systemd unit, start it, wait for
 * its loopback health endpoint, then seed the owner account. Idempotent on
 * re-run (install upgrades in place; owner setup returning a 4xx is treated as
 * already-seeded). Best-effort seed — a seed failure doesn't fail the script.
 */
function buildProvisionToolServiceScript(opts: {
  service: ToolService
  envB64: string
  ownerEmail: string
  ownerPassword: string
}): string {
  const { service } = opts
  const owner = `${service.systemUser}:${service.systemUser}`
  const setupUrl = `http://127.0.0.1:${service.port}${service.caddyPathPrefix}${service.seedOwner.setupPath}`
  const healthUrl = `http://127.0.0.1:${service.port}${service.healthPath}`
  const payload = JSON.stringify(
    service.seedOwner.buildPayload({
      email: opts.ownerEmail,
      password: opts.ownerPassword,
    }),
  )
  return `#!/bin/bash
set -uo pipefail
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a
${service.installSteps()}
echo "=== tool-service: write_env (${service.serviceName}) ==="
mkdir -p "$(dirname ${bashSingleQuoteForScript(service.envPath)})"
echo ${bashSingleQuoteForScript(opts.envB64)} | base64 -d > ${bashSingleQuoteForScript(service.envPath)} || exit 1
chmod 600 ${bashSingleQuoteForScript(service.envPath)}
chown ${owner} ${bashSingleQuoteForScript(service.envPath)}

echo "=== tool-service: systemd_unit (${service.serviceName}) ==="
cat > "/etc/systemd/system/${service.serviceName}.service" <<'SVCEOF'
${service.renderSystemdUnit()}SVCEOF
systemctl daemon-reload
systemctl enable ${bashSingleQuoteForScript(service.serviceName)}
systemctl restart ${bashSingleQuoteForScript(service.serviceName)}

echo "=== tool-service: wait_health (${service.serviceName}) ==="
HEALTH_OK=0
for _ in $(seq 1 90); do
  if curl -sf -o /dev/null -m 5 ${bashSingleQuoteForScript(healthUrl)}; then
    HEALTH_OK=1
    break
  fi
  if ! systemctl is-active --quiet ${bashSingleQuoteForScript(service.serviceName)}; then
    echo "${service.serviceName} is not active during health wait" >&2
    journalctl -u ${bashSingleQuoteForScript(service.serviceName)} --no-pager -n 50 || true
    break
  fi
  sleep 2
done
if [ "\${HEALTH_OK}" != "1" ]; then
  echo "${service.serviceName} did not become healthy at ${healthUrl}" >&2
  journalctl -u ${bashSingleQuoteForScript(service.serviceName)} --no-pager -n 50 || true
  exit 1
fi
echo "=== tool-service: healthy (${service.serviceName}) ==="

echo "=== tool-service: seed_owner (${service.serviceName}) ==="
SEED_CODE=$(curl -s -o /tmp/toolsvc_seed.out -w '%{http_code}' -m 10 -X POST ${bashSingleQuoteForScript(setupUrl)} -H 'Content-Type: application/json' -d ${bashSingleQuoteForScript(payload)} || echo "000")
if [ "\${SEED_CODE}" = "200" ] || [ "\${SEED_CODE}" = "201" ]; then
  echo "owner account created"
elif [ "\${SEED_CODE}" = "400" ] || [ "\${SEED_CODE}" = "403" ] || [ "\${SEED_CODE}" = "409" ]; then
  echo "owner setup returned \${SEED_CODE} — treating as already-seeded"
else
  echo "warn: owner setup returned \${SEED_CODE} (leaving for manual setup)" >&2
  cat /tmp/toolsvc_seed.out 2>/dev/null || true
fi
echo "=== tool-service: done (${service.serviceName}) ==="
`
}

/**
 * Reconcile the box's companion services (n8n today) with the instance's enabled
 * tools: provision + start + seed each enabled service; stop+disable any that
 * are no longer enabled. Runs over SSH; best-effort per service so one bad
 * service never fails the surrounding reprovision. Caller owns the Caddy route
 * rewrite (see reprovisionBotEnv) — this only manages the service processes.
 * No-op in mock / non-systemd, or when there is nothing to add or remove.
 */
export async function syncToolServices(
  instance: Instance,
  toolIds: string[],
): Promise<void> {
  if (!isLiveMode() || !instance.ipAddress) return
  if (!usesSystemd(instance)) return

  const enabledServices = toolServicesForIds(toolIds)
  const enabledNames = new Set(enabledServices.map((s) => s.serviceName))
  const toTeardown = allToolServices().filter(
    (s) => !enabledNames.has(s.serviceName),
  )
  if (enabledServices.length === 0 && toTeardown.length === 0) return

  const target = sshTargetFor(instance)

  // Tear down removed services first (best-effort). `disable --now` stops +
  // disables; the data dir is intentionally left in place so re-enabling keeps
  // existing workflows.
  for (const svc of toTeardown) {
    await sshRun(
      target,
      `systemctl disable --now ${bashSingleQuoteForScript(svc.serviceName)} 2>/dev/null || true`,
    )
  }
  if (toTeardown.length > 0 && enabledServices.length === 0) {
    await db.insert(instanceLogs).values({
      instanceId: instance.id,
      level: "info",
      message: `Companion service(s) stopped: ${toTeardown.map((s) => s.serviceName).join(", ")}.`,
    })
  }

  if (enabledServices.length === 0) return

  const publicUrl =
    buildPublicGatewayUrl({
      domain: instance.domain,
      managedSubdomain: instance.managedSubdomain,
      tlsStatus: instance.domain ? instance.tlsStatus : null,
      ipAddress: instance.ipAddress,
    })?.url ?? null

  for (const svc of enabledServices) {
    const secrets = await resolveToolServiceSecrets(instance, svc)
    const envContent = renderEnvFile(
      svc.renderEnv({
        instance,
        publicUrl,
        pathPrefix: `${svc.caddyPathPrefix}/`,
        encryptionKey: secrets.encryptionKey,
        ownerEmail: secrets.ownerEmail,
        ownerPassword: secrets.ownerPassword,
      }),
    )
    const script = buildProvisionToolServiceScript({
      service: svc,
      envB64: Buffer.from(envContent, "utf8").toString("base64"),
      ownerEmail: secrets.ownerEmail,
      ownerPassword: secrets.ownerPassword,
    })
    const step = await sshRunScriptLogged(
      target,
      script,
      "installing_service",
      `tools:service ${svc.serviceName}`,
      { timeoutMs: 420_000 }, // npm i -g n8n on a cold box can be slow
    )
    await logSshStep(instance.id, step)
    const ok = step.exitCode === 0 || step.exitCode === null
    await db.insert(instanceLogs).values({
      instanceId: instance.id,
      level: ok ? "info" : "warn",
      message: ok
        ? `Companion service ${svc.serviceName} is up at ${publicUrl ?? ""}${svc.caddyPathPrefix}/.`
        : `Companion service ${svc.serviceName} did not come up cleanly; it will re-apply on the next restart.`,
    })
  }
}

/** Filesystem-safe, unique `.md` filename for a knowledge source. */
function knowledgeFileName(name: string, used: Set<string>): string {
  const base =
    name
      .replace(/^.*[\\/]/, "") // strip any path
      .replace(/\.[^.]+$/, "") // strip extension (we always emit .md)
      .replace(/[^A-Za-z0-9._-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || "source"
  let candidate = `${base}.md`
  let n = 2
  while (used.has(candidate)) candidate = `${base}-${n++}.md`
  used.add(candidate)
  return candidate
}

/**
 * Rebuild the agent's `workspace/knowledge/` directory from `instanceKnowledge`
 * rows, over an already-resolved SSH target. Idempotent: wipes and recreates the
 * dir so deletes propagate. Each source becomes a markdown file (title + optional
 * source URL header + extracted text). Caller owns restart semantics.
 */
async function writeKnowledgeFiles(
  target: ReturnType<typeof sshTargetFor>,
  workspaceDir: string,
  owner: string,
  instanceId: string,
): Promise<void> {
  const { sshWriteFile } = await import("@/lib/ssh")
  const knowledgeDir = `${workspaceDir}/knowledge`
  const rows = await db
    .select()
    .from(instanceKnowledge)
    .where(eq(instanceKnowledge.instanceId, instanceId))

  await sshRun(target, `rm -rf '${knowledgeDir}' && mkdir -p '${knowledgeDir}'`)
  const used = new Set<string>()
  for (const row of rows) {
    const fileName = knowledgeFileName(row.name, used)
    const header =
      row.type === "url" && row.sourceUrl
        ? `# ${row.name}\nSource: ${row.sourceUrl}\n\n`
        : `# ${row.name}\n\n`
    await sshWriteFile(target, `${knowledgeDir}/${fileName}`, header + (row.textContent ?? ""))
  }
  await sshRun(target, `chown -R ${owner} '${knowledgeDir}'`)
}

/**
 * Sync the Knowledge Base corpus to a live instance WITHOUT restarting it.
 * Called by the knowledge API after a source is added/removed — the agent reads
 * workspace files per session, so a restart isn't needed for content changes
 * (enabling/disabling the KB tool itself goes through reprovisionBotEnv, which
 * regenerates the identity files and restarts). No-op in mock / non-systemd.
 */
export async function syncKnowledgeBase(instance: Instance): Promise<void> {
  if (!isLiveMode() || !instance.ipAddress) {
    await db.insert(instanceLogs).values({
      instanceId: instance.id,
      level: "info",
      message: "Knowledge base sync signalled (mock).",
    })
    return
  }
  if (!usesSystemd(instance)) return
  const runtime = getRuntime(instance.runtime)
  const { workspaceDir, systemUser } = runtime.paths
  const owner = `${systemUser}:${systemUser}`
  const target = sshTargetFor(instance)
  await writeKnowledgeFiles(target, workspaceDir, owner, instance.id)
  await db.insert(instanceLogs).values({
    instanceId: instance.id,
    level: "info",
    message: "Knowledge base synced to the agent workspace.",
  })
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
    // email/password it minted at first provision. The CLI engines need the
    // chat UI's login in the env too: it is what guards their /terminal.
    const hasAdminLogin = runtime.caps.nativeAdminLogin || runtime.caps.hasTerminal
    const adminEmail = hasAdminLogin
      ? (instance.openclawAdminEmail ??
        `admin+${instance.id.slice(0, 8)}@${runtime.id}.local`)
      : ""
    const adminPassword = hasAdminLogin
      ? (instance.openclawAdminPasswordEnc
        ? decryptSecret(instance.openclawAdminPasswordEnc)
        : generateAdminPassword())
      : ""

    // Resolve the LLM credential + endpoint + model in one place. BYOS
    // "own_key" instances inject the customer's stored key (honoring the active
    // primary/fallback slot and its provider/base-URL); everyone else uses (or
    // mints) the per-instance OpenRouter key (skipped for NVIDIA-primary bots).
    const llmConfig = await resolveRuntimeLlmConfig(instance, runtime)

    const gatewayToken = instance.gatewayTokenEnc
      ? decryptSecret(instance.gatewayTokenEnc)
      : generateGatewayToken()

    // Reuse the existing ingest token; mint one for legacy instances that
    // predate the column (persisted below so the on-disk token matches the DB).
    const eventIngestToken = instance.eventIngestTokenEnc
      ? decryptSecret(instance.eventIngestTokenEnc)
      : generateGatewayToken()

    const env = runtime.buildEnv({
      instance: hasAdminLogin ? { ...instance, openclawAdminEmail: adminEmail } : instance,
      adminEmail,
      adminPassword,
      gatewayToken,
      openRouterApiKey: llmConfig.apiKey,
      baseUrl: llmConfig.baseUrl,
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
        provider: llmConfig.providerToken,
        model: llmConfig.model,
        baseUrl: llmConfig.baseUrl,
        enabledToolIds: expandAutoEnabledTools(instance.enabledTools ?? []),
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
          openRouterApiKey: llmConfig.apiKey,
          model: llmConfig.model,
          fallbackModel: llmConfig.fallbackModel,
          baseUrl: llmConfig.baseUrl,
          domain: instance.domain,
          managedSubdomain: instance.managedSubdomain,
          ipAddress: instance.ipAddress,
          tlsStatus: instance.tlsStatus,
          enabledToolIds: expandAutoEnabledTools(instance.enabledTools ?? []),
        }),
      )
      await sshRun(target, `chown -R ${owner} '${installDir}/${configSubdir}'`)
    }

    const reprovAgentType = instance.agentType ?? "custom"
    const reprovIdentityOpts = {
      skills: (instance.skills as string[] | null) ?? null,
      hasKnowledgeBase: knowledgeBaseEnabled(instance.enabledTools ?? []),
    }
    await sshRun(target, `mkdir -p '${workspaceDir}'`)
    await sshWriteFile(
      target,
      `${workspaceDir}/AGENTS.md`,
      buildWorkspaceAgentsMd(
        instance,
        reprovIdentityOpts.skills,
        reprovIdentityOpts.hasKnowledgeBase,
      ),
    )
    await sshWriteFile(
      target,
      `${workspaceDir}/IDENTITY.md`,
      generateIdentityMd(reprovAgentType, reprovIdentityOpts),
    )
    await sshRun(target, `chown -R ${owner} '${workspaceDir}'`)

    // Sync the Knowledge Base corpus into workspace/knowledge/ so the agent can
    // read/cite it. Idempotent (rebuilds the dir from the DB each time).
    await writeKnowledgeFiles(target, workspaceDir, owner, instance.id)

    // Rewrite the Caddyfile so companion-service routes (e.g. `/n8n/`) reflect
    // the current enabled-tools set. reprovisionBotEnv historically never
    // touched Caddy, so enabling/disabling n8n post-create would otherwise never
    // get (or lose) its route. renderCaddyfile is the single source of truth
    // (same args as first provision + instance-ingress), so with no companion
    // service the output is unchanged and the reload is a no-op. Best-effort:
    // Caddy runs graceful reload and keeps serving on a bad config.
    const webuiEnabled =
      Boolean(instance.webuiEnabled) && Boolean(runtime.sidecar)
    // Same cert handling as first provision: this is also how a box that was
    // delivered without one (the warm pool, before this fix) gets upgraded to
    // Full (strict) the next time anything reprovisions it.
    const { useCfOriginTls } = await ensureManagedOriginCert(target, instance.managedSubdomain)
    const caddyContent = runtime.renderCaddyfile({
      domain: instance.domain,
      managedSubdomain: instance.managedSubdomain,
      useCfOriginTls,
      domainUseInternalTls: Boolean(instance.domain) && instance.domainProxied,
      upstreamPort:
        webuiEnabled && runtime.sidecar ? runtime.sidecar.port : undefined,
      toolServices: toolServiceRoutesForInstance(instance),
    })
    const caddyResult = await sshInstallCaddyfile(target, caddyContent)
    if (caddyResult.code !== 0 && caddyResult.code !== null) {
      await db.insert(instanceLogs).values({
        instanceId: instance.id,
        level: "warn",
        message: `Caddy reload during reprovision returned exit ${caddyResult.code}; routing may be stale until the next deploy.`,
      })
    }

    await sshSystemctlRestart(target, runtime.serviceName)

    await db.insert(instanceLogs).values({
      instanceId: instance.id,
      level: "info",
      message: `${runtime.displayName} service restarted with new config and identity files.`,
    })

    // Installs the terminal on boxes that predate it; otherwise a no-op unless
    // its unit changed (see buildTerminalStartScript for why it is not restarted).
    await startRuntimeTerminal(instance.id, target, runtime, "writing_config")

    // Keep the chat UI's upstream connection and pre-selected model in step with
    // the gateway's. The init script above re-pinned Hermes' `model.default`;
    // without this the sidecar still offers the model from first provision, so a
    // user who switched models silently keeps chatting to the old one — and a
    // sidecar left on a stale gateway token lists no models at all. Only the four
    // keys below are touched — see buildEnvKeyUpsertScript for why the file is not
    // re-rendered wholesale.
    //
    // reprovisionBotEnv is driven by eight routes (tools, skills, instructions,
    // model, agent-type, token, byos-key, backup-restore), and only some change the
    // model — so the sidecar is restarted ONLY when the value actually moved. A
    // restart drops in-flight chat streams; doing it on every skills toggle would be
    // a visible regression.
    //
    // Best-effort throughout: a stale default is a worse experience, not a broken
    // agent, so nothing here fails the surrounding reprovision.
    if (webuiEnabled && runtime.sidecar) {
      const sidecar = runtime.sidecar
      // The upstream connection, not just the model. A warm-pool VM bakes its
      // sidecar against a placeholder gateway token; claim re-renders the file
      // with the real one, but a box claimed before that landed — or one whose
      // sidecar never restarted to re-read it — is left pointing at the
      // placeholder. Open WebUI then gets 401 from /v1/models, shows an EMPTY
      // model list, and DEFAULT_MODELS has nothing to select: the user opens the
      // chat and cannot send a message. Upserting only DEFAULT_MODELS could never
      // repair that, so a broken bot stayed broken through every reprovision.
      //
      // These four are exactly the keys that can go stale and are safe to rewrite.
      // WEBUI_SECRET_KEY is deliberately NOT among them (rotating it logs out every
      // chat user) and neither is ENABLE_SIGNUP (the admin seed owns it).
      const entries = [
        { key: "OPENAI_API_BASE_URL", value: `http://127.0.0.1:${runtime.gatewayPort}/v1` },
        { key: "OPENAI_API_KEY", value: gatewayToken },
        { key: "ENABLE_PERSISTENT_CONFIG", value: "false" },
        ...(llmConfig.model.trim()
          ? [{ key: "DEFAULT_MODELS", value: llmConfig.model.trim() }]
          : []),
      ]
      const modelStep = await sshRunScriptLogged(
        target,
        buildEnvKeyUpsertScript({ envPath: sidecar.envPath, entries }),
        "writing_config",
        "reprovision:sidecar connection + default model",
        { timeoutMs: 30_000 },
      )
      await logSshStep(instance.id, modelStep)

      if (modelStep.exitCode !== 0 && modelStep.exitCode !== null) {
        await db.insert(instanceLogs).values({
          instanceId: instance.id,
          level: "warn",
          message: `Could not update the chat UI's connection settings (exit ${modelStep.exitCode}); it may keep using the previous model or fail to list models until the next deploy.`,
        })
      } else if (modelStep.stdout.includes(ENV_KEY_CHANGED)) {
        await sshSystemctlRestart(target, sidecar.serviceName)
        await db.insert(instanceLogs).values({
          instanceId: instance.id,
          level: "info",
          message: llmConfig.model.trim()
            ? `Chat UI restarted with default model ${llmConfig.model}.`
            : "Chat UI restarted with refreshed connection settings.",
        })
      }
    }

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
      await deleteAgentSubdomain(instance.id, instance.cfRecordId, instance.managedSubdomain)
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
