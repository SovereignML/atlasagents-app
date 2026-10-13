import { NextRequest, NextResponse } from "next/server"
import { apiError } from "@/lib/api-error"
import { auth } from "@/auth"
import { db, eq, and, asc, byosServers, instances, instanceLogs, regions, serverConfigs } from "@/db"
import { logAuditEvent } from "@/lib/audit"
import { createSlug } from "@/lib/instance"
import { encryptSecret } from "@/lib/crypto-secret"
import { BYOS_SIGNUP_CREDITS } from "@/configs/plans"
import { fundWallet } from "@/lib/openrouter-billing"
import { parseAgentConfig } from "@/lib/agent-config"
import { buildAgentFields } from "@/lib/agent-create"
import { provisionBot } from "@/lib/provisioner"
import { describeVmError } from "@/lib/vm-provider"
import { assertPublicHost, BlockedHostError } from "@/lib/net-guard"
import { getEffectiveTeam } from "@/lib/effective-user"
import { byosConnectionFields, installBlockedReason, planBlockedReason } from "@/lib/byos-install"
import { findByosPlan } from "@/lib/byos-plan"
import { recoverByosPlanCheckout } from "@/lib/checkout-recovery"
import { claimEvent, releaseEvent } from "@/lib/idempotency"
import { isTeamSuspended } from "@/lib/tenant"
import { canDeploy, DEPLOY_ROLE_DENIED } from "@/lib/team"
import { readJsonBody } from "@/lib/request-body"
import { byosDeploySchema } from "@/lib/validations"
import { getTeamAgentLimit, countTeamAgents } from "@/lib/seats"
import { runtimeCaps } from "@/lib/runtimes/labels"
import { runtimeDeployDenial } from "@/lib/runtime-access"
import {
  getByoProvider,
  isByoProviderId,
  requiresHermes,
  type ByoProviderId,
} from "@/configs/llm-providers"

const BYOS_SERVER_CONFIG_SLUG = "byos-managed"
const BYOS_REGION_SLUG = "self-hosted"

/**
 * Validate a user-supplied "custom" OpenAI-compatible base URL: it must be a
 * well-formed https URL whose host is public (same SSRF guard we apply to the
 * SSH host — the platform will make outbound requests to this endpoint). Returns
 * the trimmed URL on success. Throws `BlockedHostError` for a private/blocked
 * host; returns null for a malformed / non-https URL.
 */
async function validateCustomBaseUrl(raw: string | undefined): Promise<string | null> {
  const trimmed = raw?.trim()
  if (!trimmed) return null
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  if (url.protocol !== "https:") return null
  await assertPublicHost(url.hostname)
  return trimmed
}

/**
 * Install an agent onto a server the customer has already connected.
 *
 * Takes a `byosServerId`, never a raw host: the machine was connected (and SSH
 * access proven) for free beforehand via /api/byos/servers, and this route
 * reads the connection off that row. Accepting a host here meant the paid flow
 * re-asked for a machine we were already talking to, and the resulting instance
 * had no link back to the server — leaving `agentCount`, the idle-server cap
 * and the disconnect guard all reading zero.
 *
 * No VM is created, and no checkout is opened. Paying for BYOS is a separate
 * step: a BYOS plan is bought per server (POST /api/byos/servers/[id]/plan),
 * and this route only checks that the server has one — one plan covers every
 * agent on its server. LLM usage is either metered against the credit wallet
 * ("managed_credits") or paid via the customer's own key ("own_key", stored
 * encrypted).
 */
export async function POST(req: NextRequest) {
  try {
    return await handleByosDeploy(req)
  } catch (err) {
    return apiError("byos/deploy", err, "Deployment failed.")
  }
}

async function handleByosDeploy(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Identity for this install — honors impersonation / "act as customer",
  // exactly as the managed deploy path does (src/app/api/deploy/route.ts).
  // This route used to scope by `session.user.id` while every BYOS *page* used
  // getEffectiveUserId(), so an admin viewing-as a customer could open the
  // wizard and then get a 403 (or, worse, silently write the row into their own
  // team). The agent is owned and billed to `effectiveUserId` — the customer —
  // while the audit trail records the real admin as `actorUserId`.
  const ctx = await getEffectiveTeam()
  if (!ctx) {
    return NextResponse.json({ error: "No active team" }, { status: 403 })
  }
  const { effectiveUserId, actorUserId, teamId } = ctx
  // Same role gate as the managed deploy path (createInstanceFromAgentFields).
  if (!canDeploy(ctx.role)) {
    return NextResponse.json({ error: DEPLOY_ROLE_DENIED }, { status: 403 })
  }

  // The connected server to install onto is named by id: the connection (host,
  // port, user) is read off that row, never accepted from the caller, so an
  // agent can only land on a server this team has connected. `ownProvider` is
  // the catalog id the own key is for (default "openrouter"); `ownBaseUrl` is
  // only for "custom"; `ownModel` is required for a non-OpenRouter provider.
  // There is deliberately no "fallback = managed OpenRouter": a BYO-key agent
  // never falls back to our minted key. Managed access is llmMode only.
  const parsedBody = await readJsonBody(req, byosDeploySchema)
  if (!parsedBody.ok) return parsedBody.res
  const {
    name,
    byosServerId,
    llmMode,
    ownApiKey,
    ownProvider,
    ownBaseUrl,
    ownModel,
    fallbackProvider,
    fallbackApiKey,
    fallbackBaseUrl,
    agentConfig: agentConfigInput,
  } = parsedBody.data

  // ── Validate ──────────────────────────────────────────────────────
  if (!name || !byosServerId) {
    return NextResponse.json(
      { error: "Missing required fields (name, byosServerId)" },
      { status: 400 },
    )
  }
  if (llmMode !== "managed_credits" && llmMode !== "own_key") {
    return NextResponse.json({ error: "Invalid llmMode" }, { status: 400 })
  }
  if (llmMode === "own_key" && !ownApiKey?.trim()) {
    return NextResponse.json({ error: "An API key is required when bringing your own key" }, { status: 400 })
  }

  // ── Gates, then the server ────────────────────────────────────────
  // Agents are team-scoped, and so is the server: a serverId belonging to
  // another team must not resolve, or one customer could install onto (and be
  // billed for) another customer's machine.
  //
  // Same gates as the managed deploy path (createInstanceFromAgentFields):
  // a suspended team (or a child of a suspended/de-entitled reseller) cannot
  // deploy, and the per-team agent cap applies to BYOS agents too — otherwise
  // BYOS would be a trivial bypass of both controls.
  if (await isTeamSuspended(teamId)) {
    return NextResponse.json(
      { error: "This account is suspended. Contact your administrator." },
      { status: 403 },
    )
  }
  const agentLimit = await getTeamAgentLimit(teamId)
  if (agentLimit != null && (await countTeamAgents(teamId)) >= agentLimit) {
    return NextResponse.json(
      { error: `Agent limit reached (${agentLimit}). Contact your administrator to raise it.` },
      { status: 403 },
    )
  }

  const byosServer = await db.query.byosServers.findFirst({
    where: and(eq(byosServers.id, byosServerId), eq(byosServers.teamId, teamId)),
  })
  if (!byosServer) {
    return NextResponse.json(
      { error: "That server isn't connected to this account. Connect it first." },
      { status: 404 },
    )
  }
  const blocked = installBlockedReason(byosServer)
  if (blocked) {
    return NextResponse.json({ error: blocked }, { status: 409 })
  }

  // SSRF guard: we're about to SSH into this host with the fleet key. The
  // address was already checked when the server was connected, but DNS can be
  // repointed between then and now, so re-check before we dial.
  try {
    await assertPublicHost(byosServer.host)
  } catch (err) {
    if (err instanceof BlockedHostError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    throw err
  }

  // ── Env preflight ─────────────────────────────────────────────────
  // BYOS needs the fleet key (to connect) and the encryption key (for the
  // gateway token / admin password / optional own API key). It does NOT need
  // OPENROUTER_API_KEY — managed keys are minted via OPENROUTER_PROVISIONING_KEY
  // and own-key users supply their own.
  const required = ["SSH_FLEET_PRIVATE_KEY", "SSH_FLEET_PUBLIC_KEY", "INSTANCE_ENCRYPTION_KEY"]
  const missing = required.filter((k) => !process.env[k])
  if (missing.length > 0) {
    console.error("[byos/deploy] BYOS provisioning not configured; missing env:", missing.join(", "))
    return NextResponse.json(
      { error: "BYOS provisioning is not configured on this server" },
      { status: 503 },
    )
  }

  // ── Plan gate — BEFORE any DB write ───────────────────────────────
  // Installing is free; the server must already have a BYOS plan. If it
  // doesn't, ask Stripe once — the customer may have just paid and the webhook
  // hasn't landed (checkout-recovery.ts). Refusing before the INSERT matters:
  // countTeamAgents() counts every non-deleted row against the agent cap, so a
  // stranded row per attempt would turn this message into "Agent limit reached".
  let plan = await findByosPlan(byosServer.id)
  if (!plan && (await recoverByosPlanCheckout(byosServer.id, effectiveUserId))) {
    plan = await findByosPlan(byosServer.id)
  }
  const planBlocked = planBlockedReason(plan)
  if (planBlocked || !plan) {
    return NextResponse.json(
      { error: planBlocked, code: "byos_plan_required" },
      { status: 402 },
    )
  }

  // ── Resolve the BYOS sentinel server config + region ──────────────
  const serverConfig = await db.query.serverConfigs.findFirst({
    where: eq(serverConfigs.slug, BYOS_SERVER_CONFIG_SLUG),
  })
  let region = await db.query.regions.findFirst({
    where: eq(regions.slug, BYOS_REGION_SLUG),
  })
  // Fall back to any region so the row's NOT NULL FK is always satisfiable
  // even if the BYOS seed hasn't run yet.
  if (!region) {
    region = await db.query.regions.findFirst({ orderBy: asc(regions.sortOrder) })
  }
  if (!serverConfig) {
    return NextResponse.json(
      { error: "BYOS server config missing. Run the seed (npm run db:seed)" },
      { status: 500 },
    )
  }
  if (!region) {
    return NextResponse.json({ error: "No region available" }, { status: 500 })
  }

  // ── Agent config (force the BYOS deployment target) ───────────────
  const rawCfg =
    agentConfigInput && typeof agentConfigInput === "object"
      ? { ...(agentConfigInput as Record<string, unknown>), deployment_target: "byos" }
      : { use_case: name, deployment_target: "byos", runtime: "openclaw" }

  const parsedAgentConfig = parseAgentConfig(rawCfg)
  if (!parsedAgentConfig.ok) {
    return NextResponse.json({ error: `Invalid agentConfig: ${parsedAgentConfig.error}` }, { status: 400 })
  }
  const cfg = parsedAgentConfig.data
  const runtimeDenial = runtimeDeployDenial(cfg.runtime, session)
  if (runtimeDenial) return NextResponse.json({ error: runtimeDenial }, { status: 403 })
  // Derive the shared agent columns the same way the managed deploy path does
  // (soul, skills, botToken, runtime, and — critically — webuiEnabled, which
  // Hermes needs so the Open WebUI sidecar is installed and fronted by Caddy).
  const agentFields = buildAgentFields(cfg)

  // ── BYO provider + optional fallback validation (own_key only) ─────
  // Normalized values persisted below. NULL provider ⇒ "openrouter" downstream.
  let ownProviderId: ByoProviderId = "openrouter"
  let ownBaseUrlClean: string | null = null
  let ownModelClean: string | null = null
  let fallbackProviderId: ByoProviderId | null = null
  let fallbackBaseUrlClean: string | null = null
  const hasFallbackInput = !!(fallbackProvider || fallbackApiKey || fallbackBaseUrl)

  if (llmMode === "own_key") {
    ownProviderId = (ownProvider ?? "openrouter") as ByoProviderId
    if (!isByoProviderId(ownProviderId)) {
      return NextResponse.json({ error: "Unknown key provider" }, { status: 400 })
    }
    try {
      if (ownProviderId === "custom") {
        ownBaseUrlClean = await validateCustomBaseUrl(ownBaseUrl)
        if (!ownBaseUrlClean) {
          return NextResponse.json(
            { error: "A valid https base URL is required for a custom provider" },
            { status: 400 },
          )
        }
      }
      // Non-OpenRouter direct keys only work on Hermes (OpenClaw is OpenRouter-only)
      // and need an explicit model (no default catalog for a direct provider).
      if (requiresHermes(ownProviderId)) {
        const label = getByoProvider(ownProviderId)?.label ?? ownProviderId
        if (!runtimeCaps(cfg.runtime).supportsCustomBaseUrl) {
          return NextResponse.json(
            { error: `${label} keys require the Hermes runtime` },
            { status: 400 },
          )
        }
        ownModelClean = ownModel?.trim() || null
        if (!ownModelClean) {
          return NextResponse.json(
            { error: `A model is required when bringing a ${label} key` },
            { status: 400 },
          )
        }
      }

      if (hasFallbackInput) {
        fallbackProviderId = (fallbackProvider ?? "") as ByoProviderId
        if (!isByoProviderId(fallbackProviderId)) {
          return NextResponse.json({ error: "Unknown fallback provider" }, { status: 400 })
        }
        if (!fallbackApiKey?.trim()) {
          return NextResponse.json(
            { error: "A fallback key is required when adding a fallback provider" },
            { status: 400 },
          )
        }
        if (fallbackProviderId === "custom") {
          fallbackBaseUrlClean = await validateCustomBaseUrl(fallbackBaseUrl)
          if (!fallbackBaseUrlClean) {
            return NextResponse.json(
              { error: "A valid https base URL is required for a custom fallback provider" },
              { status: 400 },
            )
          }
        }
        if (requiresHermes(fallbackProviderId) && !runtimeCaps(cfg.runtime).supportsCustomBaseUrl) {
          const label = getByoProvider(fallbackProviderId)?.label ?? fallbackProviderId
          return NextResponse.json(
            { error: `${label} fallback keys require the Hermes runtime` },
            { status: 400 },
          )
        }
      }
    } catch (err) {
      if (err instanceof BlockedHostError) {
        return NextResponse.json({ error: err.message }, { status: 400 })
      }
      throw err
    }
  }

  // ── Insert instance ───────────────────────────────────────────────
  const [instance] = await db
    .insert(instances)
    .values({
      userId: effectiveUserId,
      teamId,
      name: name.trim(),
      slug: createSlug(name),
      regionId: region.id,
      serverConfigId: serverConfig.id,
      storageGb: serverConfig.storageGb,
      // Informational: the agent itself isn't billed, its server's plan is.
      billingInterval: plan.interval,
      status: "pending",
      // Shared agent columns (runtime, webuiEnabled, soul, skills, botToken, …)
      // derived identically to the managed path; deploymentTarget is forced to
      // "byos" in rawCfg above.
      ...agentFields,
      // Links the agent to the connected server AND copies the connection onto
      // the instance row, which is what the provisioner, the metrics cron and
      // sshTargetForInstance read. Both halves, always — see byos-install.ts.
      ...byosConnectionFields(byosServer),
      byosLlmMode: llmMode,
      byosOwnApiKeyEnc:
        llmMode === "own_key" && ownApiKey ? encryptSecret(ownApiKey.trim()) : null,
      // Provider the own key is for + custom base URL (own_key only).
      byosOwnProvider: llmMode === "own_key" ? ownProviderId : null,
      byosOwnBaseUrl: llmMode === "own_key" ? ownBaseUrlClean : null,
      // A non-OpenRouter direct provider has no default catalog — pin the
      // user-supplied model as the per-instance override. Overrides any
      // modelSlug from agentFields (which BYOS doesn't set).
      ...(ownModelClean ? { modelSlug: ownModelClean } : {}),
      // Optional user-supplied fallback (their own second key). Never our key.
      byosFallbackProvider:
        llmMode === "own_key" && hasFallbackInput ? fallbackProviderId : null,
      byosFallbackApiKeyEnc:
        llmMode === "own_key" && hasFallbackInput && fallbackApiKey
          ? encryptSecret(fallbackApiKey.trim())
          : null,
      byosFallbackBaseUrl:
        llmMode === "own_key" && hasFallbackInput ? fallbackBaseUrlClean : null,
      byosActiveKeySlot: "primary",
      byosKeyStatus: "unknown",
    })
    .returning()

  await logAuditEvent({
    // The REAL actor, with the customer recorded as onBehalfOf — same contract
    // as createInstanceFromAgentFields. Undefined for a normal self-serve
    // install, where actor and owner are the same person.
    userId: actorUserId,
    onBehalfOfUserId: actorUserId !== effectiveUserId ? effectiveUserId : undefined,
    teamId,
    action: "instance.deploy",
    targetType: "instance",
    targetId: instance.id,
    targetLabel: instance.name,
    meta: {
      plan: "byos",
      byosServerId: byosServer.id,
      byosHost: byosServer.host,
      llmMode,
      byosPlanSubscriptionId: plan.subscriptionId,
      ...(llmMode === "own_key"
        ? { ownProvider: ownProviderId, hasFallback: hasFallbackInput }
        : {}),
    },
  })

  await db.insert(instanceLogs).values({
    instanceId: instance.id,
    level: "info",
    message: `BYOS instance created on ${byosServer.label} (${byosServer.host}). LLM mode: ${llmMode}${
      llmMode === "own_key" ? ` (provider: ${ownProviderId})` : ""
    }. Covered by the server's BYOS plan — installing now.`,
  })

  // ── Provision (background — it takes minutes) ─────────────────────
  const instanceId = instance.id
  ;(async () => {
    try {
      const fresh = await db.query.instances.findFirst({ where: eq(instances.id, instanceId) })
      if (fresh?.status === "pending") await provisionBot(fresh)
    } catch (err) {
      console.error(`[byos/deploy] provisionBot failed for ${instanceId}:`, await describeVmError(err))
    }
  })()

  // ── One-time starter credits, once per plan ───────────────────────
  // Managed-AI agents draw on the wallet, so the first one installed under a
  // plan seeds it with BYOS_SIGNUP_CREDITS. Keyed on the plan, not the agent,
  // so installing more agents doesn't mint more credits. Legacy per-agent plans
  // already received theirs on their first invoice. Best-effort: a failed grant
  // must not fail an install that is already under way, so it is released for
  // the next install to retry.
  if (llmMode === "managed_credits" && !plan.legacy) {
    const grantKey = plan.subscriptionId
    if (await claimEvent("byos_signup_grant", grantKey)) {
      try {
        await fundWallet(
          effectiveUserId,
          BYOS_SIGNUP_CREDITS,
          "plan_deposit",
          "BYOS signup credits",
          instanceId,
          { planMode: "add" },
        )
      } catch (err) {
        await releaseEvent("byos_signup_grant", grantKey)
        console.error(`[byos/deploy] BYOS signup credit grant failed for ${instanceId}:`, err)
      }
    }
  }

  return NextResponse.json({ instanceId })
}
