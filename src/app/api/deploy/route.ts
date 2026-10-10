import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { db, eq, and, instances, instanceLogs, sshKeys, users, subscriptions } from "@/db"
import {
  stripe,
  isStripeConfigured,
  isDevBypassAllowed,
  STRIPE_NOT_CONFIGURED,
} from "@/lib/stripe"
import { encryptRootPassword, computeSshFingerprint, isValidPublicKey } from "@/lib/instance"
import { planUnitAmountCents } from "@/lib/pricing"
import { findPlanBySlug } from "@/configs/plans"
import { BRANDING } from "@/configs/branding"
import { parseAgentConfig } from "@/lib/agent-config"
import { getFreeTierUsage, checkFreeDeployAllowed, type FreeRuntime } from "@/lib/free-tier"
import { provisionBot } from "@/lib/provisioner"
import { describeVmError } from "@/lib/vm-provider"
import { addPlanCredits } from "@/lib/wallet"
import { creditGrantSchedule } from "@/lib/plan-period"
import { getEffectiveTeam } from "@/lib/effective-user"
import { createInstanceFromAgentFields } from "@/lib/agent-create"
import { runtimeDeployDenial } from "@/lib/runtime-access"
import { deploySchema } from "@/lib/validations"

export async function POST(req: NextRequest) {
  try {
    return await handleDeploy(req)
  } catch (err) {
    console.error("[deploy] unhandled error:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Deployment failed" },
      { status: 500 },
    )
  }
}

async function handleDeploy(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Identity for this deploy — honors "act as customer": when a tenant admin is
  // acting as a child team, the agent is owned by the child owner and lands in
  // the child team (so funding / OpenRouter tenant-key / ACL resolve correctly),
  // while the audit trail records the real tenant admin (actorUserId). For a
  // normal deploy this is just the signed-in user + their active team.
  const ctx = await getEffectiveTeam()
  if (!ctx) {
    return NextResponse.json({ error: "No active team" }, { status: 403 })
  }
  const { effectiveUserId, actorUserId, teamId } = ctx

  const body = await req.json().catch(() => null)
  const parsed = deploySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }
  const {
    name,
    planSlug,
    regionSlug,
    billingInterval,
    rootPassword,
    sshPublicKey,
    agentConfig: agentConfigInput,
  } = parsed.data

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

  // ── Agent config parsing ──────────────────────────────────────────
  let parsedAgentConfig: ReturnType<typeof parseAgentConfig> | null = null
  if (agentConfigInput) {
    parsedAgentConfig = parseAgentConfig(agentConfigInput)
    if (!parsedAgentConfig.ok) {
      return NextResponse.json({ error: `Invalid agentConfig: ${parsedAgentConfig.error}` }, { status: 400 })
    }
    const denial = runtimeDeployDenial(parsedAgentConfig.data.runtime, session)
    if (denial) return NextResponse.json({ error: denial }, { status: 403 })
  }

  // ── Free tier: per-runtime concurrency + lifetime cap ─────────────
  // One live free agent per runtime (OpenClaw + Hermes), up to a lifetime of
  // FREE_LIFETIME_LIMIT deploys total. See src/lib/free-tier.ts.
  if (planConfig.tier === "free") {
    const runtime: FreeRuntime =
      parsedAgentConfig?.ok && parsedAgentConfig.data.runtime === "hermes"
        ? "hermes"
        : "openclaw"
    const usage = await getFreeTierUsage(effectiveUserId)
    const blocked = checkFreeDeployAllowed(usage, runtime)
    if (blocked) {
      return NextResponse.json(blocked.body, { status: blocked.status })
    }
  }

  // ── SSH key ───────────────────────────────────────────────────────
  let sshKeyId: string | undefined
  if (sshPublicKey) {
    if (!isValidPublicKey(sshPublicKey)) {
      return NextResponse.json({ error: "Invalid SSH public key" }, { status: 400 })
    }
    const fp = computeSshFingerprint(sshPublicKey)
    // SSH keys are shared per team; dedupe the fingerprint within the team.
    const existing = await db.query.sshKeys.findFirst({
      where: and(eq(sshKeys.fingerprint, fp), eq(sshKeys.teamId, teamId)),
    })
    if (existing) {
      sshKeyId = existing.id
    } else {
      const [created] = await db
        .insert(sshKeys)
        .values({
          teamId,
          userId: effectiveUserId,
          name: `key-${fp.slice(7, 19)}`,
          publicKey: sshPublicKey.trim(),
          fingerprint: fp,
        })
        .returning()
      sshKeyId = created.id
    }
  }

  // ── Resolve infra + create the pending instance (shared with restore) ─
  const created = await createInstanceFromAgentFields({
    userId: effectiveUserId,
    actorUserId,
    teamId,
    name,
    agentConfig: parsedAgentConfig?.ok ? parsedAgentConfig.data : null,
    planSlug,
    regionSlug,
    billingInterval,
    sshKeyId,
    rootPasswordEnc: rootPassword ? encryptRootPassword(rootPassword) : undefined,
    auditMeta: { plan: planSlug, region: regionSlug, billingInterval },
  })
  if (!created.ok) {
    return NextResponse.json({ error: created.error }, { status: created.status })
  }
  const { instance, dbPlan } = created

  // ── Free tier: bypass Stripe, auto-provision ──────────────────────
  if (planConfig.tier === "free") {
    const instanceId = instance.id
    const userId = effectiveUserId

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

    // Yearly plans drip the allotment monthly (see creditGrantSchedule); grant
    // one month now and let the monthly-grants sweep top it up.
    const freeSchedule = creditGrantSchedule(billingInterval, null)

    if (dbPlan) {
      await db.insert(subscriptions).values({
        userId,
        planId: dbPlan.id,
        instanceId,
        interval: billingInterval,
        status: "active",
        nextCreditGrantAt: freeSchedule.nextCreditGrantAt,
      })
    }

    if (planConfig.creditsPerPeriod > 0) {
      try {
        // New instance → ADD to the wallet (don't expire other agents' plan
        // credits). Expiry still set so the period-end sweep reclaims unused.
        await addPlanCredits(
          userId,
          planConfig.creditsPerPeriod,
          freeSchedule.expireAt,
          `Free tier grant: ${planConfig.name}`,
          instanceId,
        )
      } catch (err) {
        console.error("[deploy] depositToWallet failed (free tier):", err)
      }
    }

    await db.insert(instanceLogs).values({
      instanceId,
      level: "info",
      message: `Free tier: instance auto-activated. ${planConfig.creditsPerPeriod.toLocaleString()} credits granted.`,
    })

    return NextResponse.json({ instanceId })
  }

  // ── Paid tier: Stripe Checkout ────────────────────────────────────
  if (isStripeConfigured()) {
    const userRow = await db.query.users.findFirst({
      where: eq(users.id, effectiveUserId),
      columns: { stripeCustomerId: true, email: true },
    })
    let stripeCustomerId = userRow?.stripeCustomerId

    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: userRow?.email ?? undefined,
        metadata: { userId: effectiveUserId },
      })
      stripeCustomerId = customer.id
      await db
        .update(users)
        .set({ stripeCustomerId })
        .where(eq(users.id, effectiveUserId))
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
              name: `${BRANDING.name} ${planConfig.name} Plan`,
              description: `${planConfig.creditsPerPeriod.toLocaleString()} credits/${billingInterval === "year" ? "yr" : "mo"}`,
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
        userId: effectiveUserId,
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

  // Paid tier requires Stripe in production — never provision a paid VM for free.
  if (!isDevBypassAllowed()) {
    return NextResponse.json(STRIPE_NOT_CONFIGURED, { status: 503 })
  }

  // ── Dev mode: skip Stripe, auto-activate ──────────────────────────
  const instanceId = instance.id
  const userId = effectiveUserId

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

  // Yearly plans drip the allotment monthly (see creditGrantSchedule); grant
  // one month now and let the monthly-grants sweep top it up.
  const devSchedule = creditGrantSchedule(billingInterval, null)

  if (dbPlan) {
    await db.insert(subscriptions).values({
      userId,
      planId: dbPlan.id,
      instanceId,
      interval: billingInterval,
      status: "active",
      nextCreditGrantAt: devSchedule.nextCreditGrantAt,
    })
  }

  // Dev mode: simulate the Stripe `invoice.paid` deposit so the user
  // actually sees credits arrive when they deploy a paid plan. New instance →
  // ADD (matches the subscription_create branch in handleInvoicePaid).
  if (planConfig.creditsPerPeriod > 0) {
    try {
      await addPlanCredits(
        userId,
        planConfig.creditsPerPeriod,
        devSchedule.expireAt,
        `Dev mode grant: ${planConfig.name} (${billingInterval})`,
        instanceId,
      )
    } catch (err) {
      console.error("[deploy] depositToWallet failed (dev path):", err)
    }
  }

  await db.insert(instanceLogs).values({
    instanceId,
    level: "info",
    message: `Dev mode: instance auto-activated. ${planConfig.creditsPerPeriod.toLocaleString()} credits granted (Stripe not configured).`,
  })

  return NextResponse.json({ instanceId })
}
