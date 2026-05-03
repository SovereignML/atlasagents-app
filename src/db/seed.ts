// Seed — upserts for regions, server configs, plans, and admin user using Drizzle's
// onConflictDoUpdate. Run with `npm run db:seed`.

import { hashSync } from "bcryptjs"
import { REGIONS } from "../configs/regions"
import { SERVER_TYPES } from "../configs/server-types"
import { PLANS } from "../configs/plans"
import {
  db,
  users,
  regions,
  serverConfigs,
  plans,
  pool,
  notInArray,
} from "./index"

async function main() {
  // 1. Admin user
  const adminEmail = process.env.ADMIN_EMAIL || "admin@sovereignml.com"
  const adminPassword = process.env.ADMIN_PASSWORD || "admin123456"

  await db
    .insert(users)
    .values({
      email: adminEmail,
      name: "Admin",
      hashedPassword: hashSync(adminPassword, 10),
      role: "admin",
    })
    .onConflictDoNothing({ target: users.email })

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

  console.log(
    `Seed complete: ${REGIONS.length} regions, ${SERVER_TYPES.length} server configs, ${PLANS.length} plans, 1 admin user.`,
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
