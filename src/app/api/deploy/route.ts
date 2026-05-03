import { NextRequest, NextResponse } from "next/server"
import crypto from "node:crypto"
import { auth } from "@/auth"
import { db, eq, and, asc, instances, instanceLogs, regions, serverConfigs, sshKeys, users, plans, subscriptions } from "@/db"
import { stripe, isStripeConfigured } from "@/lib/stripe"
import { logAuditEvent } from "@/lib/audit"
import { createSlug, encryptRootPassword, computeSshFingerprint, isValidPublicKey } from "@/lib/instance"
import { planUnitAmountCents } from "@/lib/pricing"
import { findPlanBySlug } from "@/configs/plans"
import { BRANDING } from "@/configs/branding"
import { parseAgentConfig } from "@/lib/agent-config"
import { selectSkills } from "@/configs/skill-map"
import { generateSoul } from "@/lib/soul"
import { routeModel } from "@/lib/model-router"
import { provisionBot } from "@/lib/provisioner"
import { describeVmError } from "@/lib/vm-provider"
import { grantCredits } from "@/lib/credits"

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json()
  const {
    name,
    planSlug = "builder",
    regionSlug,
    billingInterval = "month",
    rootPassword,
    sshPublicKey,
    agentConfig: agentConfigInput,
  } = body as {
    name: string
    planSlug?: string
    regionSlug?: string
    billingInterval?: "month" | "year"
    rootPassword?: string
    sshPublicKey?: string
    agentConfig?: unknown
  }

  if (!name) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
  }

  // ── Resolve plan ──────────────────────────────────────────────────
  const planConfig = findPlanBySlug(planSlug)
  if (!planConfig) {
    return NextResponse.json({ error: "Invalid plan" }, { status: 400 })
  }
  if (planConfig.cta === "contact-sales") {
    return NextResponse.json({ error: "Enterprise plans require contacting sales" }, { status: 400 })
  }
  if (!planConfig.serverConfigSlug) {
    return NextResponse.json({ error: "Plan has no server configuration" }, { status: 400 })
  }

  // ── Free tier: enforce 1 free instance per user ───────────────────
  if (planConfig.tier === "free") {
    const existingFree = await db.query.subscriptions.findFirst({
      where: and(
        eq(subscriptions.userId, session.user.id),
        eq(subscriptions.status, "active"),
      ),
      with: { plan: true },
    })
    if (existingFree && existingFree.plan.tier === "free") {
      return NextResponse.json(
        { error: "You already have a free instance. Upgrade to deploy more agents." },
        { status: 409 },
      )
    }
  }

  // ── Agent config parsing ──────────────────────────────────────────
  let parsedAgentConfig: ReturnType<typeof parseAgentConfig> | null = null
  if (agentConfigInput) {
    parsedAgentConfig = parseAgentConfig(agentConfigInput)
    if (!parsedAgentConfig.ok) {
      return NextResponse.json({ error: `Invalid agentConfig: ${parsedAgentConfig.error}` }, { status: 400 })
    }
  }

  const isVps = parsedAgentConfig?.ok
    ? parsedAgentConfig.data.deployment_target === "vps"
    : !!regionSlug

  if (isVps) {
    const required = [
      "SSH_FLEET_PRIVATE_KEY",
      "SSH_FLEET_PUBLIC_KEY",
      "OPENROUTER_API_KEY",
      "INSTANCE_ENCRYPTION_KEY",
    ]
    const missing = required.filter((k) => !process.env[k])
    if (missing.length > 0) {
      console.error("[deploy] VPS provisioning not configured; missing env:", missing.join(", "))
      return NextResponse.json(
        { error: "VPS provisioning is not configured on this server" },
        { status: 503 }
      )
    }
  }

  // ── Resolve region + server config from plan ──────────────────────
  let region = regionSlug
    ? await db.query.regions.findFirst({ where: eq(regions.slug, regionSlug) })
    : null

  if (!region) {
    region = await db.query.regions.findFirst({
      where: eq(regions.available, true),
      orderBy: asc(regions.sortOrder),
    })
  }

  const serverConfig = await db.query.serverConfigs.findFirst({
    where: eq(serverConfigs.slug, planConfig.serverConfigSlug),
  })

  if (!region) {
    return NextResponse.json({ error: "No available region found" }, { status: 500 })
  }
  if (!serverConfig) {
    return NextResponse.json({ error: "No active server config found" }, { status: 500 })
  }
  if (isVps && !region.available) {
    return NextResponse.json({ error: "Invalid or unavailable region" }, { status: 400 })
  }

  // ── SSH key ───────────────────────────────────────────────────────
  let sshKeyId: string | undefined
  if (sshPublicKey) {
    if (!isValidPublicKey(sshPublicKey)) {
      return NextResponse.json({ error: "Invalid SSH public key" }, { status: 400 })
    }
    const fp = computeSshFingerprint(sshPublicKey)
    const existing = await db.query.sshKeys.findFirst({
      where: eq(sshKeys.fingerprint, fp),
    })
    if (existing) {
      sshKeyId = existing.id
    } else {
      const [created] = await db
        .insert(sshKeys)
        .values({
          userId: session.user.id,
          name: `key-${fp.slice(7, 19)}`,
          publicKey: sshPublicKey.trim(),
          fingerprint: fp,
        })
        .returning()
      sshKeyId = created.id
    }
  }

  // ── Agent fields ──────────────────────────────────────────────────
  let agentFields: {
    agentType: string | null
    agentConfig: unknown
    soulMd: string | null
    skills: unknown
    modelTier: string | null
    botToken: string | null
    deploymentTarget: string | null
    interfaceKind: string | null
  } = {
    agentType: null,
    agentConfig: null,
    soulMd: null,
    skills: null,
    modelTier: null,
    botToken: null,
    deploymentTarget: null,
    interfaceKind: null,
  }
  if (parsedAgentConfig?.ok) {
    const cfg = parsedAgentConfig.data
    const skills = selectSkills(cfg)
    const soulMd = generateSoul(cfg, skills)
    routeModel(cfg.budget_tier)
    const botToken = "sk_bot_" + crypto.randomBytes(24).toString("hex")
    agentFields = {
      agentType: cfg.use_case,
      agentConfig: cfg,
      soulMd,
      skills,
      modelTier: cfg.budget_tier,
      botToken,
      deploymentTarget: cfg.deployment_target,
      interfaceKind: cfg.interface,
    }
  }

  // ── Insert instance ───────────────────────────────────────────────
  const [instance] = await db
    .insert(instances)
    .values({
      userId: session.user.id,
      name: name.trim(),
      slug: createSlug(name),
      regionId: region.id,
      serverConfigId: serverConfig.id,
      sshKeyId,
      storageGb: serverConfig.storageGb,
      billingInterval,
      status: "pending",
      rootPasswordEnc: rootPassword ? encryptRootPassword(rootPassword) : undefined,
      ...agentFields,
    })
    .returning()

  await logAuditEvent({
    userId: session.user.id,
    action: "instance.deploy",
    targetType: "instance",
    targetId: instance.id,
    targetLabel: instance.name,
    meta: { plan: planSlug, region: regionSlug, billingInterval },
  })

  // ── Resolve the DB plan row ───────────────────────────────────────
  const dbPlan = await db.query.plans.findFirst({
    where: and(eq(plans.tier, planConfig.tier), eq(plans.isActive, true)),
  })

  await db.insert(instanceLogs).values({
    instanceId: instance.id,
    level: "info",
    message: `Instance created. Plan: ${planConfig.name}, Server: ${serverConfig.label}, Region: ${region.name}. Awaiting payment.`,
  })

  // ── Free tier: bypass Stripe, auto-provision ──────────────────────
  if (planConfig.tier === "free") {
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
        console.error(
          "[deploy] provisionBot failed (free tier):",
          await describeVmError(err),
        )
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

    if (planConfig.creditsPerPeriod > 0) {
      try {
        await grantCredits(userId, planConfig.creditsPerPeriod, `subscription:${planConfig.slug}:initial`)
      } catch (err) {
        console.error("[deploy] grantCredits failed (free tier):", err)
      }
    }

    await db.insert(instanceLogs).values({
      instanceId,
      level: "info",
      message: "Free tier: instance auto-activated (no payment required).",
    })

    return NextResponse.json({ instanceId })
  }

  // ── Paid tier: Stripe Checkout ────────────────────────────────────
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
              name: `${BRANDING.name} — ${planConfig.name} Plan`,
              description: `${serverConfig.vcpu} vCPU, ${serverConfig.ramGb} GB RAM, ${serverConfig.storageGb} GB storage · ${planConfig.creditsPerPeriod.toLocaleString()} credits/${billingInterval === "year" ? "yr" : "mo"}`,
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
        planSlug: planConfig.slug,
        interval: billingInterval,
      },
      success_url: `${BRANDING.appUrl}/dashboard/instances/${instance.id}`,
      cancel_url: `${BRANDING.appUrl}/dashboard/deploy`,
    })

    return NextResponse.json({
      instanceId: instance.id,
      checkoutUrl: checkoutSession.url,
    })
  }

  // ── Dev mode: skip Stripe, auto-activate ──────────────────────────
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
      console.error(
        "[deploy] provisionBot failed (dev path):",
        await describeVmError(err),
      )
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

  await db.insert(instanceLogs).values({
    instanceId,
    level: "info",
    message: "Dev mode: instance auto-activated (Stripe not configured).",
  })

  return NextResponse.json({ instanceId })
}
