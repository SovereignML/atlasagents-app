import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { db, eq, and, asc, instances, instanceLogs, regions, serverConfigs, users, plans, subscriptions } from "@/db"
import {
  stripe,
  isStripeConfigured,
  isDevBypassAllowed,
  STRIPE_NOT_CONFIGURED,
} from "@/lib/stripe"
import { logAuditEvent } from "@/lib/audit"
import { createSlug } from "@/lib/instance"
import { encryptSecret } from "@/lib/crypto-secret"
import { planUnitAmountCents } from "@/lib/pricing"
import { findPlanBySlug, BYOS_SIGNUP_CREDITS } from "@/configs/plans"
import { fundWallet } from "@/lib/openrouter-billing"
import { BRANDING } from "@/configs/branding"
import { parseAgentConfig } from "@/lib/agent-config"
import { buildAgentFields } from "@/lib/agent-create"
import { provisionBot } from "@/lib/provisioner"
import { describeVmError } from "@/lib/vm-provider"
import { assertPublicHost, BlockedHostError } from "@/lib/net-guard"
import { getUserTeam } from "@/lib/team"
import { isTeamSuspended } from "@/lib/tenant"
import { getTeamAgentLimit, countTeamAgents } from "@/lib/seats"
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
 * Bring Your Own Server deploy. Atlas Agents acts as the management panel for a
 * server the customer already owns: they paste our SSH_FLEET_PUBLIC_KEY into
 * their root authorized_keys and we connect with the fleet key (no VM created).
 * Billing is a flat recurring management fee (Stripe subscription); LLM usage
 * is either metered against the credit wallet ("managed_credits") or paid via
 * the customer's own key ("own_key", stored encrypted).
 */
export async function POST(req: NextRequest) {
  try {
    return await handleByosDeploy(req)
  } catch (err) {
    console.error("[byos/deploy] unhandled error:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Deployment failed" },
      { status: 500 },
    )
  }
}

async function handleByosDeploy(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json()
  const {
    name,
    byosHost,
    byosPort = 22,
    byosUser = "root",
    billingInterval = "month",
    llmMode,
    ownApiKey,
    ownProvider,
    ownBaseUrl,
    ownModel,
    fallbackProvider,
    fallbackApiKey,
    fallbackBaseUrl,
    agentConfig: agentConfigInput,
  } = body as {
    name: string
    byosHost: string
    byosPort?: number
    byosUser?: string
    billingInterval?: "month" | "year"
    llmMode: "managed_credits" | "own_key"
    ownApiKey?: string
    // Which provider the own key is for (catalog id). Defaults to "openrouter".
    ownProvider?: string
    // OpenAI-compatible base URL — only for ownProvider === "custom".
    ownBaseUrl?: string
    // Model slug (persisted to modelSlug) — REQUIRED for a non-OpenRouter
    // provider, which has no default catalog. Ignored for OpenRouter (tier
    // default / post-deploy picker applies).
    ownModel?: string
    // Optional user-supplied fallback (their OWN second key). NOTE: there is
    // deliberately no "fallback = managed OpenRouter" option — a BYO-key agent
    // never falls back to our minted key. Managed access is llmMode only.
    fallbackProvider?: string
    fallbackApiKey?: string
    fallbackBaseUrl?: string
    agentConfig?: unknown
  }

  // ── Validate ──────────────────────────────────────────────────────
  if (!name || !byosHost) {
    return NextResponse.json({ error: "Missing required fields (name, byosHost)" }, { status: 400 })
  }
  if (llmMode !== "managed_credits" && llmMode !== "own_key") {
    return NextResponse.json({ error: "Invalid llmMode" }, { status: 400 })
  }
  if (llmMode === "own_key" && !ownApiKey?.trim()) {
    return NextResponse.json({ error: "An API key is required when bringing your own key" }, { status: 400 })
  }
  if (!Number.isInteger(byosPort) || byosPort < 1 || byosPort > 65535) {
    return NextResponse.json({ error: "Invalid SSH port" }, { status: 400 })
  }

  // SSRF guard: we're about to SSH into this host as root with the fleet key.
  // Reject loopback / link-local / cloud-metadata / RFC1918 targets (and
  // hostnames that resolve to them) before persisting anything.
  try {
    await assertPublicHost(byosHost)
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

  // ── Resolve plan ──────────────────────────────────────────────────
  const planConfig = findPlanBySlug("byos")
  if (!planConfig) {
    return NextResponse.json({ error: "BYOS plan is not configured" }, { status: 500 })
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
        if (cfg.runtime !== "hermes") {
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
        if (requiresHermes(fallbackProviderId) && cfg.runtime !== "hermes") {
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

  // Agents are team-scoped — resolve the active team.
  const team = await getUserTeam(session.user.id)
  if (!team) {
    return NextResponse.json({ error: "No active team" }, { status: 403 })
  }

  // Same gates as the managed deploy path (createInstanceFromAgentFields):
  // a suspended team (or a child of a suspended/de-entitled reseller) cannot
  // deploy, and the per-team agent cap applies to BYOS agents too — otherwise
  // BYOS would be a trivial bypass of both controls.
  if (await isTeamSuspended(team.teamId)) {
    return NextResponse.json(
      { error: "This account is suspended. Contact your administrator." },
      { status: 403 },
    )
  }
  const agentLimit = await getTeamAgentLimit(team.teamId)
  if (agentLimit != null && (await countTeamAgents(team.teamId)) >= agentLimit) {
    return NextResponse.json(
      { error: `Agent limit reached (${agentLimit}). Contact your administrator to raise it.` },
      { status: 403 },
    )
  }

  // ── Insert instance ───────────────────────────────────────────────
  const [instance] = await db
    .insert(instances)
    .values({
      userId: session.user.id,
      teamId: team.teamId,
      name: name.trim(),
      slug: createSlug(name),
      regionId: region.id,
      serverConfigId: serverConfig.id,
      storageGb: serverConfig.storageGb,
      billingInterval,
      status: "pending",
      // Shared agent columns (runtime, webuiEnabled, soul, skills, botToken, …)
      // derived identically to the managed path; deploymentTarget is forced to
      // "byos" in rawCfg above.
      ...agentFields,
      byosHost: byosHost.trim(),
      byosPort,
      byosUser: byosUser.trim() || "root",
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
    userId: session.user.id,
    action: "instance.deploy",
    targetType: "instance",
    targetId: instance.id,
    targetLabel: instance.name,
    meta: {
      plan: "byos",
      byosHost: byosHost.trim(),
      llmMode,
      billingInterval,
      ...(llmMode === "own_key"
        ? { ownProvider: ownProviderId, hasFallback: hasFallbackInput }
        : {}),
    },
  })

  await db.insert(instanceLogs).values({
    instanceId: instance.id,
    level: "info",
    message: `BYOS instance created for ${byosHost.trim()}. LLM mode: ${llmMode}${
      llmMode === "own_key" ? ` (provider: ${ownProviderId})` : ""
    }. Awaiting payment.`,
  })

  const dbPlan = await db.query.plans.findFirst({
    where: and(eq(plans.tier, "byos"), eq(plans.isActive, true)),
  })

  // ── Paid: Stripe Checkout (recurring management fee) ──────────────
  if (isStripeConfigured()) {
    const userRow = await db.query.users.findFirst({
      where: eq(users.id, session.user.id),
      columns: { stripeCustomerId: true },
    })
    let stripeCustomerId = userRow?.stripeCustomerId

    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: session.user.email ?? undefined,
        metadata: { userId: session.user.id },
      })
      stripeCustomerId = customer.id
      await db
        .update(users)
        .set({ stripeCustomerId })
        .where(eq(users.id, session.user.id))
    }

    const unitAmount = planUnitAmountCents(planConfig, billingInterval)

    const checkoutSession = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      mode: "subscription",
      allow_promotion_codes: true,
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `${BRANDING.name} Bring Your Own Server`,
              description: `Management panel for your own server · ${
                llmMode === "own_key" ? "your own API key" : `pay-as-you-go ${BRANDING.name} Credits`
              }`,
            },
            unit_amount: unitAmount,
            recurring: {
              interval: billingInterval === "year" ? "year" : "month",
            },
          },
          quantity: 1,
        },
      ],
      metadata: {
        instanceId: instance.id,
        userId: session.user.id,
        planSlug: "byos",
        interval: billingInterval,
      },
      success_url: `${BRANDING.appUrl}/dashboard/instances/${instance.id}`,
      cancel_url: `${BRANDING.appUrl}/dashboard/byos/connect`,
    })

    return NextResponse.json({
      instanceId: instance.id,
      checkoutUrl: checkoutSession.url,
    })
  }

  // BYOS requires Stripe in production — never SSH-provision a server for free.
  if (!isDevBypassAllowed()) {
    return NextResponse.json(STRIPE_NOT_CONFIGURED, { status: 503 })
  }

  // ── Dev mode: skip Stripe, auto-provision ─────────────────────────
  const instanceId = instance.id
  const userId = session.user.id

  ;(async () => {
    try {
      const freshInstance = await db.query.instances.findFirst({
        where: eq(instances.id, instanceId),
      })
      if (freshInstance) {
        await provisionBot(freshInstance)
      }
    } catch (err) {
      console.error("[byos/deploy] provisionBot failed (dev path):", await describeVmError(err))
    }
  })()

  if (dbPlan) {
    await db.insert(subscriptions).values({
      userId,
      planId: dbPlan.id,
      instanceId,
      interval: billingInterval,
      status: "active",
    })
  }

  // Mirror the webhook's one-time BYOS signup grant for managed-AI users so the
  // dev/no-Stripe path matches production behavior.
  if (llmMode === "managed_credits") {
    try {
      await fundWallet(
        userId,
        BYOS_SIGNUP_CREDITS,
        "plan_deposit",
        "BYOS signup credits",
        instanceId,
        { planMode: "add" },
      )
    } catch (err) {
      console.error("[byos/deploy] BYOS signup credit grant failed (dev path):", err)
    }
  }

  await db.insert(instanceLogs).values({
    instanceId,
    level: "info",
    message: "Dev mode: BYOS instance auto-activated (Stripe not configured).",
  })

  return NextResponse.json({ instanceId })
}
