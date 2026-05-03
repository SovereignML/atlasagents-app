import crypto from "node:crypto"
import type { InferSelectModel } from "drizzle-orm"
import { db, instances, instanceLogs, regions, serverConfigs, eq } from "@/db"
import {
  logInstanceEvent,
  transitionInstance,
  withInstanceLock,
} from "@/lib/instance-state"
import { allocatePort, FleetEmptyError, FleetFullError, pickHost } from "@/lib/host-scheduler"
import {
  buildBootstrapScript,
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
import {
  buildOpenclawEnv,
  generateAdminPassword,
  generateGatewayToken,
  OPENCLAW_GATEWAY_PORT,
  OPENCLAW_SERVICE_NAME,
  OPENCLAW_VERSION,
  OPENCLAW_VPS_MIN_NODE,
  renderCaddyfile,
  renderEnvFile,
  renderOpenclawConfig,
  renderSystemdUnit,
} from "@/lib/openclaw"
import { PROVISION_EVENT } from "@/lib/provision-events"
import { getVmProvider, describeVmError } from "@/lib/vm-provider"
import { createAgentSubdomain, deleteAgentSubdomain } from "@/lib/agent-dns"
import { generateMockIp } from "@/lib/instance"
import { routeModel } from "@/lib/model-router"
import type { BudgetTier } from "@/lib/agent-config"
import { generateAgentsMd, generateIdentityMd } from "@/lib/agent-identity"

type Instance = InferSelectModel<typeof instances>

const BOT_RUNTIME_IMAGE = () =>
  process.env.BOT_RUNTIME_IMAGE || "ghcr.io/sovereignml/sovereign-bot-runtime:latest"

const NEXT_PUBLIC_GATEWAY_BASE_URL = () =>
  process.env.NEXT_PUBLIC_GATEWAY_BASE_URL || "http://localhost:3000"

const OPENROUTER_API_KEY = () => process.env.OPENROUTER_API_KEY || ""

const FALLBACK_REGION = "us-east"
const FALLBACK_PLAN = "g6-standard-2"

const OPENCLAW_DIR = "/opt/openclaw"

function bashSingleQuoteForScript(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/**
 * Phase A — write `.env` + `openclaw.json` + workspace identity files.
 * Replaces the old onboard + 11x sequential `config set` CLI calls with a
 * single script that drops all files. ~5s instead of ~63s.
 */
function buildPhaseWriteConfig(opts: {
  envB64: string
  configB64: string
  agentsMdB64?: string
  identityMdB64?: string
}): string {
  const identityBlock =
    opts.agentsMdB64 && opts.identityMdB64
      ? `
echo "=== provision: write_identity ==="
mkdir -p "\${OC_HOME}/.openclaw/workspace"
echo ${bashSingleQuoteForScript(opts.agentsMdB64)} | base64 -d > "\${OC_HOME}/.openclaw/workspace/AGENTS.md" || exit 1
echo ${bashSingleQuoteForScript(opts.identityMdB64)} | base64 -d > "\${OC_HOME}/.openclaw/workspace/IDENTITY.md" || exit 1
chown -R openclaw:openclaw "\${OC_HOME}/.openclaw/workspace"
`
      : ""

  return `#!/bin/bash
set -euo pipefail
OC_HOME=${bashSingleQuoteForScript(OPENCLAW_DIR)}

echo "=== provision: write_env ==="
echo ${bashSingleQuoteForScript(opts.envB64)} | base64 -d > "\${OC_HOME}/.env" || exit 1
chmod 600 "\${OC_HOME}/.env"
chown openclaw:openclaw "\${OC_HOME}/.env"

echo "=== provision: write_config ==="
mkdir -p "\${OC_HOME}/.openclaw"
echo ${bashSingleQuoteForScript(opts.configB64)} | base64 -d > "\${OC_HOME}/.openclaw/openclaw.json" || exit 1
chown -R openclaw:openclaw "\${OC_HOME}/.openclaw"
${identityBlock}
echo "=== provision: config_dump ==="
cat "\${OC_HOME}/.openclaw/openclaw.json" 2>/dev/null || echo "no config file"

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
function buildPhaseInstallAndStart(opts: { caddyB64: string; unitB64: string }): string {
  return `#!/bin/bash
set -uo pipefail
export SYSTEMD_PAGER=cat
SERVICE=${bashSingleQuoteForScript(OPENCLAW_SERVICE_NAME)}
PORT=${bashSingleQuoteForScript(String(OPENCLAW_GATEWAY_PORT))}
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

echo "=== provision: systemd_unit_file ==="
echo ${bashSingleQuoteForScript(opts.unitB64)} | base64 -d > "/etc/systemd/system/\${SERVICE}.service"
echo "=== provision: systemd_daemon_reload ==="
systemctl daemon-reload
echo "=== provision: systemd_enable ==="
systemctl --no-pager enable "\${SERVICE}"
echo "=== provision: install_service_done ==="

# --- Phase C+D with retry ---
try_start_and_health() {
  echo "=== provision: start ==="
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
    if curl -sf -o /dev/null -m 5 http://127.0.0.1:\${PORT}/; then
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

CD_OK=0
for ATTEMPT in \$(seq 1 \${MAX_CD_RETRIES}); do
  echo "=== provision: attempt \${ATTEMPT}/\${MAX_CD_RETRIES} ==="
  if try_start_and_health; then
    CD_OK=1
    break
  fi
  if [ "\${ATTEMPT}" -lt "\${MAX_CD_RETRIES}" ]; then
    echo "=== provision: retry (attempt \${ATTEMPT} failed, restarting service) ==="
    sleep 3
  fi
done

if [ "\${CD_OK}" != "1" ]; then
  echo "=== provision: all_retries_exhausted ==="
  exit 1
fi

echo "=== provision: done ==="
`
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function isLiveMode(): boolean {
  return Boolean(process.env.LINODE_API_TOKEN && process.env.SSH_FLEET_PRIVATE_KEY)
}

function buildContainerName(instanceId: string): string {
  return `bot_${instanceId.slice(0, 12)}`
}

type BotEnv = Record<string, string>
function buildBotEnv(instance: Instance, extras: BotEnv = {}): BotEnv {
  const tier = (instance.modelTier ?? "mid") as BudgetTier
  const route = routeModel(tier)

  const env: BotEnv = {
    BOT_TOKEN: instance.botToken ?? "",
    SOUL_MD: instance.soulMd ?? "You are a helpful assistant.",
    MODEL: route.model,
    FALLBACK_MODEL: route.fallback,
    OPENROUTER_API_KEY: OPENROUTER_API_KEY(),
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

async function waitForVmRunning(vmId: string, timeoutMs = 180_000): Promise<string> {
  const provider = await getVmProvider()
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
    return { ipAddress, mocked: true }
  }

  if (target === "vps") {
    return provisionVpsBot(instance)
  }
  return provisionSharedBot(instance)
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

    const host = await pickHost()
    const port = await allocatePort(host.id)
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
    await transitionInstance(instance.id, ["provisioning"], "failed_provisioning", {
      error: reason,
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
  opts: { failedStage: VpsStage },
): Promise<void> {
  const baseCommands: [string, string][] = [
    [`journalctl -u ${OPENCLAW_SERVICE_NAME} --no-pager -n 200`, "journal"],
    ["dmesg -T 2>/dev/null | tail -40 || true", "kernel_tail"],
    [`systemctl status ${OPENCLAW_SERVICE_NAME} --no-pager`, "service_status"],
    ["cat /opt/openclaw/.env 2>/dev/null | grep -v API_KEY | grep -v PASSWORD", "env_sanitized"],
    ["ls -la /opt/openclaw/", "workdir_listing"],
    ["which openclaw 2>/dev/null || echo 'not found'", "binary_path"],
    ["node -v 2>/dev/null || echo 'node not found'", "node_version"],
  ]
  const caddyWhenInstalling: [string, string][] =
    opts.failedStage === "installing_service"
      ? [
          ["journalctl -u caddy --no-pager -n 200", "caddy_journal"],
          ["systemctl status caddy --no-pager 2>&1", "caddy_status"],
        ]
      : []
  const commands: [string, string][] = [...caddyWhenInstalling, ...baseCommands]

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

async function provisionVpsBot(instance: Instance): Promise<ProvisionResult> {
  const provider = await getVmProvider()
  const [region, serverConfig] = await Promise.all([
    db.query.regions.findFirst({ where: eq(regions.id, instance.regionId) }),
    db.query.serverConfigs.findFirst({ where: eq(serverConfigs.id, instance.serverConfigId) }),
  ])
  const providerRegion = region?.providerRegion ?? FALLBACK_REGION
  const providerPlan = serverConfig?.providerPlan ?? FALLBACK_PLAN

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

  try {
    /* --- 1. Create VM ------------------------------------------------- */
    const goldenImage = process.env.LINODE_GOLDEN_IMAGE
    const useGoldenImage = Boolean(goldenImage)

    currentStage = "create_vm"
    await setProvisionStage(instance.id, currentStage)
    if (!vmId) {
      await logInstanceEvent({
        instanceId: instance.id,
        stage: currentStage,
        message: `Creating VM (${providerPlan} in ${providerRegion})${useGoldenImage ? ` from golden image ${goldenImage}` : " with cloud-init bootstrap"}...`,
      })

      const bootstrapScript = useGoldenImage
        ? undefined
        : buildBootstrapScript({
            openclawVersion: OPENCLAW_VERSION(),
            minNodeVersion: OPENCLAW_VPS_MIN_NODE,
            cfOriginCertPem,
            cfOriginKeyPem,
          })

      const publicKey = process.env.SSH_FLEET_PUBLIC_KEY
      const rootPassword = generateRootPassword()
      const vm = await provider.createVM({
        label: `sovereign-vps-${instance.id.slice(0, 8)}`,
        plan: providerPlan,
        region: providerRegion,
        rootPassword,
        image: goldenImage || undefined,
        authorizedKeys: publicKey ? [publicKey] : undefined,
        tags: ["sovereignml", "openclaw", "vps"],
        userData: bootstrapScript,
      })
      vmId = vm.id

      await db
        .update(instances)
        .set({ vmId, rootPasswordEnc: encryptSecret(rootPassword) })
        .where(eq(instances.id, instance.id))

      await logInstanceEvent({
        instanceId: instance.id,
        stage: currentStage,
        action: "vm_created",
        result: "ok",
        detail: { vmId },
        message: `VM ${vmId} created${useGoldenImage ? " (golden image)" : " with cloud-init bootstrap"}. Waiting for boot...`,
      })
    }

    /* --- 2. Wait for boot ------------------------------------------- */
    currentStage = "wait_boot"
    await setProvisionStage(instance.id, currentStage)
    if (!ipAddress) {
      ipAddress = await waitForVmRunning(vmId!)
      await db
        .update(instances)
        .set({ ipAddress })
        .where(eq(instances.id, instance.id))
    }

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

    const target: SshTarget = { host: ipAddress }

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

    /* --- 5. Credentials --------------------------------------------- */
    const adminEmail =
      instance.openclawAdminEmail ??
      `admin+${instance.id.slice(0, 8)}@openclaw.local`
    const adminPassword = instance.openclawAdminPasswordEnc
      ? decryptSecret(instance.openclawAdminPasswordEnc)
      : generateAdminPassword()
    const gatewayToken = generateGatewayToken()
    const tier = (instance.modelTier ?? "mid") as BudgetTier
    const route = routeModel(tier)

    /* --- 6. Write .env ---------------------------------------------- */
    currentStage = "writing_config"
    await setProvisionStage(instance.id, currentStage)
    await logInstanceEvent({
      instanceId: instance.id,
      stage: currentStage,
      message: PROVISION_EVENT.writingConfig,
    })

    const env = buildOpenclawEnv({
      instance: { ...instance, openclawAdminEmail: adminEmail },
      adminEmail,
      adminPassword,
      openRouterApiKey: OPENROUTER_API_KEY(),
    })

    const envContent = renderEnvFile(env)
    const envB64 = Buffer.from(envContent, "utf8").toString("base64")

    const useCfOriginTls =
      Boolean(managedSubdomainForProvision) && (await sshVmHasCloudflareOriginCerts(target))
    if (managedSubdomainForProvision && !useCfOriginTls) {
      await logInstanceEvent({
        instanceId: instance.id,
        stage: currentStage,
        level: "info",
        message:
          "Managed hostname has no /etc/caddy/cf origin certificate; Caddy will use `tls internal` (self-signed). Cloudflare SSL must be \"Full\" (not \"Full (strict)\") for this to work. For \"Full (strict)\" provision with CLOUDFLARE_ORIGIN_CERT_PEM and CLOUDFLARE_ORIGIN_CERT_KEY.",
      })
    }

    const caddyContent = renderCaddyfile({
      domain: instance.domain,
      managedSubdomain: managedSubdomainForProvision,
      useCfOriginTls,
    })
    const caddyB64 = Buffer.from(caddyContent, "utf8").toString("base64")

    const unitContent = renderSystemdUnit()
    const unitB64 = Buffer.from(unitContent, "utf8").toString("base64")

    const openclawConfigContent = renderOpenclawConfig({
      gatewayToken,
      openRouterApiKey: OPENROUTER_API_KEY(),
      model: route.model,
      fallbackModel: route.fallback,
      domain: instance.domain,
      managedSubdomain: managedSubdomainForProvision,
      ipAddress,
      tlsStatus: instance.domain ? instance.tlsStatus : null,
    })
    const configB64 = Buffer.from(openclawConfigContent, "utf8").toString("base64")

    /* Phase A — write .env + openclaw.json + identity files (batch, ~5s) */
    const agentType = instance.agentType ?? "custom"
    const agentsMdB64 = Buffer.from(generateAgentsMd(agentType), "utf8").toString("base64")
    const identityMdB64 = Buffer.from(generateIdentityMd(agentType), "utf8").toString("base64")
    const phaseAScript = buildPhaseWriteConfig({ envB64, configB64, agentsMdB64, identityMdB64 })
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

    /* Phase B+C+D — install Caddy + systemd, start service, health check (single SSH session) */
    currentStage = "installing_service"
    await setProvisionStage(instance.id, currentStage)
    const installStep = await sshRunScriptLogged(
      target,
      buildPhaseInstallAndStart({ caddyB64, unitB64 }),
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
    }

    /* --- 12. Commit state ------------------------------------------- */
    currentStage = "commit"
    await setProvisionStage(instance.id, currentStage)
    await transitionInstance(instance.id, ["provisioning"], "running", {
      set: {
        ipAddress,
        vmId,
        containerName: OPENCLAW_SERVICE_NAME,
        containerPort: OPENCLAW_GATEWAY_PORT,
        openclawAdminEmail: adminEmail,
        openclawAdminPasswordEnc:
          instance.openclawAdminPasswordEnc ?? encryptSecret(adminPassword),
        gatewayTokenEnc: encryptSecret(gatewayToken),
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
      message: `Deployment complete. Gateway at ${ipAddress}:${OPENCLAW_GATEWAY_PORT}${
        instance.domain ? ` (domain ${instance.domain})` : ""
      }. Direct access: http://${ipAddress}:${OPENCLAW_GATEWAY_PORT}`,
    })

    return {
      ipAddress,
      containerName: OPENCLAW_SERVICE_NAME,
      containerPort: OPENCLAW_GATEWAY_PORT,
      vmId,
      mocked: false,
    }
  } catch (err) {
    if (ipAddress) {
      try {
        await collectDiagnostics({ host: ipAddress }, instance.id, { failedStage: currentStage })
      } catch {
        // diagnostics collection itself failed — don't mask the original error
      }
    }
    await rollbackProvisioning(instance.id, vmId, currentStage, err)
    throw err
  }
}

async function rollbackProvisioning(
  instanceId: string,
  vmId: string | undefined,
  stage: string,
  err: unknown,
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
    const provider = await getVmProvider()
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

export async function restartBot(instance: Instance): Promise<void> {
  if (isLiveMode() && instance.ipAddress) {
    if (isVps(instance)) {
      await sshSystemctlRestart({ host: instance.ipAddress }, OPENCLAW_SERVICE_NAME)
    } else if (instance.containerName) {
      await sshDockerRestart({ host: instance.ipAddress }, instance.containerName)
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
    if (isVps(instance)) {
      await sshSystemctlStop({ host: instance.ipAddress }, OPENCLAW_SERVICE_NAME)
    } else if (instance.containerName) {
      await sshDockerStop({ host: instance.ipAddress }, instance.containerName)
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
    if (isVps(instance)) {
      await sshSystemctlStart({ host: instance.ipAddress }, OPENCLAW_SERVICE_NAME)
    } else if (instance.containerName) {
      await sshDockerStart({ host: instance.ipAddress }, instance.containerName)
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

  if (!isVps(instance)) {
    if (isLiveMode() && instance.ipAddress && instance.containerName) {
      try {
        await sshDockerRm({ host: instance.ipAddress }, instance.containerName)
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

  const provider = await getVmProvider()
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

export async function reprovisionBotEnv(instance: Instance): Promise<void> {
  if (!isLiveMode() || !instance.ipAddress) {
    await db.insert(instanceLogs).values({
      instanceId: instance.id,
      level: "info",
      message: "Env update signalled (mock).",
    })
    return
  }

  const target = { host: instance.ipAddress }

  if (isVps(instance)) {
    const adminEmail =
      instance.openclawAdminEmail ??
      `admin+${instance.id.slice(0, 8)}@openclaw.local`
    let adminPassword: string
    if (instance.openclawAdminPasswordEnc) {
      adminPassword = decryptSecret(instance.openclawAdminPasswordEnc)
    } else {
      adminPassword = generateAdminPassword()
    }

    const tier = (instance.modelTier ?? "mid") as BudgetTier
    const route = routeModel(tier)

    const env = buildOpenclawEnv({
      instance: { ...instance, openclawAdminEmail: adminEmail },
      adminEmail,
      adminPassword,
      openRouterApiKey: OPENROUTER_API_KEY(),
    })

    const gatewayToken = instance.gatewayTokenEnc
      ? decryptSecret(instance.gatewayTokenEnc)
      : generateGatewayToken()

    const { sshWriteFile } = await import("@/lib/ssh")
    await sshWriteFile(
      target,
      `${OPENCLAW_DIR}/.openclaw/openclaw.json`,
      renderOpenclawConfig({
        gatewayToken,
        openRouterApiKey: OPENROUTER_API_KEY(),
        model: route.model,
        fallbackModel: route.fallback,
        domain: instance.domain,
        managedSubdomain: instance.managedSubdomain,
        ipAddress: instance.ipAddress,
        tlsStatus: instance.tlsStatus,
        soulMd: instance.soulMd,
      }),
    )
    await sshRun(target, `chown -R openclaw:openclaw '${OPENCLAW_DIR}/.openclaw'`)
    await sshWriteFile(
      target,
      `${OPENCLAW_DIR}/.env`,
      renderEnvFile(env),
      { mode: "600" },
    )
    await sshRun(target, `chown openclaw:openclaw '${OPENCLAW_DIR}/.env'`)

    const reprovAgentType = instance.agentType ?? "custom"
    await sshRun(target, `mkdir -p '${OPENCLAW_DIR}/.openclaw/workspace'`)
    await sshWriteFile(
      target,
      `${OPENCLAW_DIR}/.openclaw/workspace/AGENTS.md`,
      generateAgentsMd(reprovAgentType),
    )
    await sshWriteFile(
      target,
      `${OPENCLAW_DIR}/.openclaw/workspace/IDENTITY.md`,
      generateIdentityMd(reprovAgentType),
    )
    await sshRun(target, `chown -R openclaw:openclaw '${OPENCLAW_DIR}/.openclaw/workspace'`)

    await sshSystemctlRestart(target, OPENCLAW_SERVICE_NAME)

    await db.insert(instanceLogs).values({
      instanceId: instance.id,
      level: "info",
      message: "OpenClaw service restarted with new config and identity files.",
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
