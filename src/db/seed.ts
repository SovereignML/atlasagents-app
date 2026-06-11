// Seed — upserts for regions, server configs, plans, and admin user using Drizzle's
// onConflictDoUpdate. Run with `npm run db:seed`.

import { hashSync } from "bcryptjs"
import { REGIONS } from "../configs/regions"
import { SERVER_TYPES } from "../configs/server-types"
import { PLANS } from "../configs/plans"
import {
  PROVIDERS,
  PROVIDER_PLAN_MAP,
  PROVIDER_REGION_MAP,
} from "../configs/providers"
import {
  db,
  users,
  regions,
  serverConfigs,
  plans,
  providers,
  providerPlans,
  providerRegions,
  providerBilling,
  pool,
  notInArray,
} from "./index"

async function main() {
  // 1. Admin user
  const adminEmail = process.env.ADMIN_EMAIL || "admin@sovereignml.com"
  const adminPassword = process.env.ADMIN_PASSWORD || "admin123456"

  // Never seed the well-known dev default password into a production DB.
  // Set ADMIN_PASSWORD explicitly, or create the admin afterwards with
  // `npm run make-admin` (interactive password prompt).
  if (process.env.NODE_ENV === "production" && !process.env.ADMIN_PASSWORD) {
    console.warn(
      "[seed] NODE_ENV=production and ADMIN_PASSWORD is unset — skipping admin " +
        "user seed. Run `npm run make-admin` to create the first admin.",
    )
  } else {
    await db
      .insert(users)
      .values({
        email: adminEmail,
        name: "Admin",
        hashedPassword: hashSync(adminPassword, 10),
        role: "admin",
        // Pre-verified so the seeded admin never sees the verify-email banner.
        // (Existing DBs: UPDATE "User" SET "emailVerified" = now() WHERE email = ...)
        emailVerified: new Date(),
      })
      .onConflictDoNothing({ target: users.email })
  }

  // 2. Regions
  for (const region of REGIONS) {
    await db
      .insert(regions)
      .values({
        slug: region.slug,
        name: region.name,
        country: region.country,
        flag: region.flag,
        available: region.available,
        sortOrder: region.sortOrder,
        providerRegion: region.providerRegion,
      })
      .onConflictDoUpdate({
        target: regions.slug,
        set: {
          name: region.name,
          country: region.country,
          flag: region.flag,
          available: region.available,
          sortOrder: region.sortOrder,
          providerRegion: region.providerRegion,
        },
      })
  }

  // Deactivate regions no longer in the config
  const regionSlugs = REGIONS.map((r) => r.slug)
  await db
    .update(regions)
    .set({ available: false })
    .where(notInArray(regions.slug, regionSlugs))

  // 3. Server configs
  for (const config of SERVER_TYPES) {
    await db
      .insert(serverConfigs)
      .values({
        slug: config.slug,
        category: config.category,
        label: config.label,
        vcpu: config.vcpu,
        ramGb: config.ramGb,
        storageGb: config.storageGb,
        priceMonthly: config.priceMonthly,
        priceYearly: config.priceYearly,
        sortOrder: config.sortOrder,
        isActive: config.isActive,
        providerPlan: config.providerPlan,
      })
      .onConflictDoUpdate({
        target: serverConfigs.slug,
        set: {
          category: config.category,
          label: config.label,
          vcpu: config.vcpu,
          ramGb: config.ramGb,
          storageGb: config.storageGb,
          priceMonthly: config.priceMonthly,
          priceYearly: config.priceYearly,
          sortOrder: config.sortOrder,
          isActive: config.isActive,
          providerPlan: config.providerPlan,
        },
      })
  }

  // Deactivate server configs no longer in the config
  const serverSlugs = SERVER_TYPES.map((s) => s.slug)
  await db
    .update(serverConfigs)
    .set({ isActive: false })
    .where(notInArray(serverConfigs.slug, serverSlugs))

  // 4. Subscription plans
  for (const plan of PLANS) {
    const credits = plan.creditsPerPeriod
    await db
      .insert(plans)
      .values({
        slug: plan.slug,
        name: plan.name,
        description: plan.description,
        tier: plan.tier,
        stripePriceIdMonthly: plan.stripePriceIdMonthly || null,
        stripePriceIdYearly: plan.stripePriceIdYearly || null,
        features: plan.features,
        isActive: plan.isActive,
        sortOrder: plan.sortOrder,
        creditsPerPeriod: credits,
      })
      .onConflictDoUpdate({
        target: plans.slug,
        set: {
          name: plan.name,
          description: plan.description,
          tier: plan.tier,
          stripePriceIdMonthly: plan.stripePriceIdMonthly || null,
          stripePriceIdYearly: plan.stripePriceIdYearly || null,
          features: plan.features,
          isActive: plan.isActive,
          sortOrder: plan.sortOrder,
          creditsPerPeriod: credits,
        },
      })
  }

  // 5. BYOS sentinel rows. Bring-Your-Own-Server instances have no Linode
  // region or server config, but Instance.regionId / serverConfigId are
  // NOT NULL. These sentinels satisfy the FKs without a nullable-column
  // migration. `self-hosted` is unavailable so it never shows in the VPS
  // region picker; `byos-managed` has priceMonthly 0 so daily-billing charges
  // nothing for it (we also skip BYOS explicitly in daily-billing). Upserted
  // here, after the deactivation passes above, so they keep these values.
  await db
    .insert(regions)
    .values({
      slug: "self-hosted",
      name: "Self-hosted",
      country: "",
      flag: "🖥️",
      available: false,
      sortOrder: 999,
      providerRegion: "",
    })
    .onConflictDoUpdate({
      target: regions.slug,
      set: { name: "Self-hosted", available: false, providerRegion: "" },
    })

  await db
    .insert(serverConfigs)
    .values({
      slug: "byos-managed",
      category: "BYOS",
      label: "Customer server",
      vcpu: 0,
      ramGb: 0,
      storageGb: 0,
      priceMonthly: 0,
      priceYearly: 0,
      sortOrder: 999,
      isActive: true,
      providerPlan: "",
    })
    .onConflictDoUpdate({
      target: serverConfigs.slug,
      set: {
        category: "BYOS",
        label: "Customer server",
        priceMonthly: 0,
        priceYearly: 0,
        isActive: true,
        providerPlan: "",
      },
    })

  // 6. VPS Providers + per-provider plan/region mappings + budgets.
  for (const p of PROVIDERS) {
    await db
      .insert(providers)
      .values({
        slug: p.slug,
        name: p.name,
        enabled: p.enabled,
        priority: p.defaultPriority,
        credentialEnvKey: p.credentialEnvKey,
      })
      .onConflictDoUpdate({
        target: providers.slug,
        // Don't clobber admin overrides (enabled/priority/pin) on re-seed — only
        // refresh static metadata.
        set: { name: p.name, credentialEnvKey: p.credentialEnvKey },
      })
  }

  // id lookups by slug for FK wiring.
  const providerRows = await db.query.providers.findMany()
  const serverConfigRows = await db.query.serverConfigs.findMany()
  const regionRows = await db.query.regions.findMany()
  const providerIdBySlug = new Map(providerRows.map((r) => [r.slug, r.id]))
  const serverConfigIdBySlug = new Map(serverConfigRows.map((r) => [r.slug, r.id]))
  const regionIdBySlug = new Map(regionRows.map((r) => [r.slug, r.id]))

  // Plans
  let planMappings = 0
  for (const mapping of PROVIDER_PLAN_MAP) {
    const serverConfigId = serverConfigIdBySlug.get(mapping.serverConfigSlug)
    if (!serverConfigId) continue
    for (const [slug, plan] of Object.entries(mapping.codes)) {
      const providerId = providerIdBySlug.get(slug)
      if (!providerId || !plan) continue
      await db
        .insert(providerPlans)
        .values({
          providerId,
          serverConfigId,
          providerPlanCode: plan.code,
          monthlyCostUsd: plan.monthlyCostUsd,
          enabled: true,
        })
        .onConflictDoUpdate({
          target: [providerPlans.providerId, providerPlans.serverConfigId],
          set: { providerPlanCode: plan.code, monthlyCostUsd: plan.monthlyCostUsd },
        })
      planMappings++
    }
  }

  // Regions
  let regionMappings = 0
  for (const mapping of PROVIDER_REGION_MAP) {
    const regionId = regionIdBySlug.get(mapping.regionSlug)
    if (!regionId) continue
    for (const [slug, region] of Object.entries(mapping.codes)) {
      const providerId = providerIdBySlug.get(slug)
      if (!providerId || !region) continue
      await db
        .insert(providerRegions)
        .values({
          providerId,
          regionId,
          providerRegionCode: region.code,
          available: region.available ?? true,
        })
        .onConflictDoUpdate({
          target: [providerRegions.providerId, providerRegions.regionId],
          set: { providerRegionCode: region.code, available: region.available ?? true },
        })
      regionMappings++
    }
  }

  // Billing budgets (don't clobber accrued usage / burn rate on re-seed).
  for (const p of PROVIDERS) {
    const providerId = providerIdBySlug.get(p.slug)
    if (!providerId) continue
    await db
      .insert(providerBilling)
      .values({
        providerId,
        monthlyCreditsUsd: p.budget.monthlyCreditsUsd,
        softLimitUsd: p.budget.softLimitUsd,
        hardLimitUsd: p.budget.hardLimitUsd,
      })
      .onConflictDoUpdate({
        target: providerBilling.providerId,
        set: {
          monthlyCreditsUsd: p.budget.monthlyCreditsUsd,
          softLimitUsd: p.budget.softLimitUsd,
          hardLimitUsd: p.budget.hardLimitUsd,
        },
      })
  }

  console.log(
    `Seed complete: ${REGIONS.length} regions, ${SERVER_TYPES.length} server configs, ${PLANS.length} plans, ` +
      `${PROVIDERS.length} providers (${planMappings} plan + ${regionMappings} region mappings), BYOS sentinels, 1 admin user.`,
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await pool.end()
  })
