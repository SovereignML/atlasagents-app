/**
 * One-shot data migration: SQLite → PostgreSQL
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/migrate-sqlite-to-pg.ts
 *
 * Requires better-sqlite3 to be available (keep it installed until migration
 * is confirmed, then uninstall it).
 *
 * Safe to re-run — all writes use upsert (idempotent).
 */

import Database from "better-sqlite3"
import { PrismaClient } from "@prisma/client"

const SQLITE_PATH = process.env.SQLITE_PATH ?? "./prisma/dev.db"
const BATCH = 500

const sqlite = new Database(SQLITE_PATH, { readonly: true })
const pg = new PrismaClient()

async function migrateTable<T>(
  label: string,
  rows: T[],
  fn: (batch: T[]) => Promise<void>
) {
  if (rows.length === 0) {
    console.log(`[${label}] 0 rows — skipping`)
    return
  }
  console.log(`[${label}] Migrating ${rows.length} rows...`)
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH)
    await fn(batch)
    console.log(`  [${label}] ${Math.min(i + BATCH, rows.length)}/${rows.length}`)
  }
}

function parseJson(val: string | null | undefined): unknown {
  if (val == null || val === "") return null
  try {
    return JSON.parse(val)
  } catch {
    return val
  }
}

async function main() {
  console.log(`Reading from SQLite: ${SQLITE_PATH}`)
  console.log("Writing to PostgreSQL via DATABASE_URL\n")

  // ── 1. Independent tables (no foreign keys) ──────────────────────────────

  const users: any[] = sqlite.prepare("SELECT * FROM User").all()
  await migrateTable("User", users, async (batch) => {
    await pg.$transaction(
      batch.map((r) =>
        pg.user.upsert({
          where: { id: r.id },
          create: {
            id: r.id,
            name: r.name,
            email: r.email,
            emailVerified: r.emailVerified ? new Date(r.emailVerified) : null,
            hashedPassword: r.hashedPassword,
            image: r.image,
            role: r.role,
            isBanned: Boolean(r.isBanned),
            bannedAt: r.bannedAt ? new Date(r.bannedAt) : null,
            bannedReason: r.bannedReason,
            telegramId: r.telegramId,
            twitterHandle: r.twitterHandle,
            discordId: r.discordId,
            stripeCustomerId: r.stripeCustomerId,
            credits: r.credits,
            createdAt: new Date(r.createdAt),
            updatedAt: new Date(r.updatedAt),
          },
          update: {},
        })
      )
    )
  })

  const verificationTokens: any[] = sqlite
    .prepare("SELECT * FROM VerificationToken")
    .all()
  await migrateTable("VerificationToken", verificationTokens, async (batch) => {
    await pg.$transaction(
      batch.map((r) =>
        pg.verificationToken.upsert({
          where: { identifier_token: { identifier: r.identifier, token: r.token } },
          create: {
            identifier: r.identifier,
            token: r.token,
            expires: new Date(r.expires),
          },
          update: {},
        })
      )
    )
  })

  const plans: any[] = sqlite.prepare("SELECT * FROM Plan").all()
  await migrateTable("Plan", plans, async (batch) => {
    await pg.$transaction(
      batch.map((r) =>
        pg.plan.upsert({
          where: { id: r.id },
          create: {
            id: r.id,
            slug: r.slug,
            name: r.name,
            description: r.description,
            tier: r.tier,
            stripePriceIdMonthly: r.stripePriceIdMonthly,
            stripePriceIdYearly: r.stripePriceIdYearly,
            features: (parseJson(r.features) as string[]) ?? [],
            isActive: Boolean(r.isActive),
            sortOrder: r.sortOrder,
            creditsPerPeriod: r.creditsPerPeriod,
            createdAt: new Date(r.createdAt),
            updatedAt: new Date(r.updatedAt),
          },
          update: {},
        })
      )
    )
  })

  const regions: any[] = sqlite.prepare("SELECT * FROM Region").all()
  await migrateTable("Region", regions, async (batch) => {
    await pg.$transaction(
      batch.map((r) =>
        pg.region.upsert({
          where: { id: r.id },
          create: {
            id: r.id,
            slug: r.slug,
            name: r.name,
            country: r.country,
            flag: r.flag,
            available: Boolean(r.available),
            sortOrder: r.sortOrder,
          },
          update: {},
        })
      )
    )
  })

  const serverConfigs: any[] = sqlite.prepare("SELECT * FROM ServerConfig").all()
  await migrateTable("ServerConfig", serverConfigs, async (batch) => {
    await pg.$transaction(
      batch.map((r) =>
        pg.serverConfig.upsert({
          where: { id: r.id },
          create: {
            id: r.id,
            slug: r.slug,
            category: r.category,
            label: r.label,
            vcpu: r.vcpu,
            ramGb: r.ramGb,
            storageGb: r.storageGb,
            priceMonthly: r.priceMonthly,
            priceYearly: r.priceYearly,
            sortOrder: r.sortOrder,
            isActive: Boolean(r.isActive),
          },
          update: {},
        })
      )
    )
  })

  const botHosts: any[] = sqlite.prepare("SELECT * FROM BotHost").all()
  await migrateTable("BotHost", botHosts, async (batch) => {
    await pg.$transaction(
      batch.map((r) =>
        pg.botHost.upsert({
          where: { id: r.id },
          create: {
            id: r.id,
            label: r.label,
            vmId: String(r.linodeId),
            ipAddress: r.ipAddress,
            region: r.region,
            plan: r.plan,
            capacity: r.capacity,
            status: r.status,
            createdAt: new Date(r.createdAt),
            updatedAt: new Date(r.updatedAt),
          },
          update: {},
        })
      )
    )
  })

  // ── 2. FK-dependent tables ────────────────────────────────────────────────

  const accounts: any[] = sqlite.prepare("SELECT * FROM Account").all()
  await migrateTable("Account", accounts, async (batch) => {
    await pg.$transaction(
      batch.map((r) =>
        pg.account.upsert({
          where: {
            provider_providerAccountId: {
              provider: r.provider,
              providerAccountId: r.providerAccountId,
            },
          },
          create: {
            id: r.id,
            userId: r.userId,
            type: r.type,
            provider: r.provider,
            providerAccountId: r.providerAccountId,
            refresh_token: r.refresh_token,
            access_token: r.access_token,
            expires_at: r.expires_at,
            token_type: r.token_type,
            scope: r.scope,
            id_token: r.id_token,
            session_state: r.session_state,
          },
          update: {},
        })
      )
    )
  })

  const sessions: any[] = sqlite.prepare("SELECT * FROM Session").all()
  await migrateTable("Session", sessions, async (batch) => {
    await pg.$transaction(
      batch.map((r) =>
        pg.session.upsert({
          where: { sessionToken: r.sessionToken },
          create: {
            id: r.id,
            sessionToken: r.sessionToken,
            userId: r.userId,
            expires: new Date(r.expires),
          },
          update: {},
        })
      )
    )
  })

  const sshKeys: any[] = sqlite.prepare("SELECT * FROM SshKey").all()
  await migrateTable("SshKey", sshKeys, async (batch) => {
    await pg.$transaction(
      batch.map((r) =>
        pg.sshKey.upsert({
          where: { id: r.id },
          create: {
            id: r.id,
            userId: r.userId,
            name: r.name,
            publicKey: r.publicKey,
            fingerprint: r.fingerprint,
            createdAt: new Date(r.createdAt),
          },
          update: {},
        })
      )
    )
  })

  const adminNotes: any[] = sqlite.prepare("SELECT * FROM AdminNote").all()
  await migrateTable("AdminNote", adminNotes, async (batch) => {
    await pg.$transaction(
      batch.map((r) =>
        pg.adminNote.upsert({
          where: { id: r.id },
          create: {
            id: r.id,
            userId: r.userId,
            authorId: r.authorId,
            content: r.content,
            createdAt: new Date(r.createdAt),
          },
          update: {},
        })
      )
    )
  })

  const creditLedger: any[] = sqlite
    .prepare("SELECT * FROM CreditLedger ORDER BY createdAt ASC")
    .all()
  await migrateTable("CreditLedger", creditLedger, async (batch) => {
    await pg.$transaction(
      batch.map((r) =>
        pg.creditLedger.upsert({
          where: { id: r.id },
          create: {
            id: r.id,
            userId: r.userId,
            delta: r.delta,
            reason: r.reason,
            balance: r.balance,
            createdAt: new Date(r.createdAt),
          },
          update: {},
        })
      )
    )
  })

  // Instance depends on User, Region, ServerConfig, SshKey?, BotHost?
  const instances: any[] = sqlite.prepare("SELECT * FROM Instance").all()
  await migrateTable("Instance", instances, async (batch) => {
    await pg.$transaction(
      batch.map((r) =>
        pg.instance.upsert({
          where: { id: r.id },
          create: {
            id: r.id,
            userId: r.userId,
            name: r.name,
            slug: r.slug,
            regionId: r.regionId,
            serverConfigId: r.serverConfigId,
            sshKeyId: r.sshKeyId,
            storageGb: r.storageGb,
            billingInterval: r.billingInterval,
            status: r.status,
            ipAddress: r.ipAddress,
            rootPasswordEnc: r.rootPasswordEnc,
            stripeSubscriptionId: r.stripeSubscriptionId,
            agentType: r.agentType,
            agentConfig: parseJson(r.agentConfig) as object | null,
            soulMd: r.soulMd,
            skills: parseJson(r.skills) as string[] | null,
            modelTier: r.modelTier,
            botToken: r.botToken,
            lastActiveAt: r.lastActiveAt ? new Date(r.lastActiveAt) : null,
            deploymentTarget: r.deploymentTarget,
            interfaceKind: r.interfaceKind,
            telegramBotTokenEnc: r.telegramBotTokenEnc,
            telegramUsername: r.telegramUsername,
            botHostId: r.botHostId,
            containerName: r.containerName,
            containerPort: r.containerPort,
            vmId: r.linodeId ? String(r.linodeId) : null,
            createdAt: new Date(r.createdAt),
            updatedAt: new Date(r.updatedAt),
          },
          update: {},
        })
      )
    )
  })

  // Subscription depends on User, Plan, Instance?
  const subscriptions: any[] = sqlite.prepare("SELECT * FROM Subscription").all()
  await migrateTable("Subscription", subscriptions, async (batch) => {
    await pg.$transaction(
      batch.map((r) =>
        pg.subscription.upsert({
          where: { id: r.id },
          create: {
            id: r.id,
            userId: r.userId,
            planId: r.planId,
            instanceId: r.instanceId,
            stripeSubscriptionId: r.stripeSubscriptionId,
            stripePriceId: r.stripePriceId,
            interval: r.interval,
            status: r.status,
            currentPeriodEnd: r.currentPeriodEnd ? new Date(r.currentPeriodEnd) : null,
            cancelAtPeriodEnd: Boolean(r.cancelAtPeriodEnd),
            createdAt: new Date(r.createdAt),
            updatedAt: new Date(r.updatedAt),
          },
          update: {},
        })
      )
    )
  })

  const usageEvents: any[] = sqlite.prepare("SELECT * FROM UsageEvent").all()
  await migrateTable("UsageEvent", usageEvents, async (batch) => {
    await pg.$transaction(
      batch.map((r) =>
        pg.usageEvent.upsert({
          where: { id: r.id },
          create: {
            id: r.id,
            instanceId: r.instanceId,
            userId: r.userId,
            kind: r.kind,
            amount: r.amount,
            meta: parseJson(r.meta) as object | null,
            createdAt: new Date(r.createdAt),
          },
          update: {},
        })
      )
    )
  })

  const instanceLogs: any[] = sqlite.prepare("SELECT * FROM InstanceLog").all()
  await migrateTable("InstanceLog", instanceLogs, async (batch) => {
    await pg.$transaction(
      batch.map((r) =>
        pg.instanceLog.upsert({
          where: { id: r.id },
          create: {
            id: r.id,
            instanceId: r.instanceId,
            level: r.level,
            message: r.message,
            createdAt: new Date(r.createdAt),
          },
          update: {},
        })
      )
    )
  })

  console.log("\n✅ Migration complete. Verify row counts with the SQL in the plan.")
}

main()
  .catch((err) => {
    console.error("Migration failed:", err)
    process.exit(1)
  })
  .finally(async () => {
    await pg.$disconnect()
    sqlite.close()
  })
