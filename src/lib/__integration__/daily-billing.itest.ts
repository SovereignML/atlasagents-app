// Integration tests for daily billing's claim lifecycle against a REAL postgres
// database. The property under test is a transaction boundary — the claim
// commits inside the billing tx while `pauseBot` runs outside it — which is
// exactly what a unit test with a mocked db cannot observe. See
// src/lib/daily-billing.ts and the claim-with-release contract in
// src/lib/idempotency.ts.
//
// `./db-env` MUST be imported first — it redirects DATABASE_URL at the test DB
// before `@/db` is evaluated.
import "./db-env"

import { beforeEach, describe, expect, it, vi } from "vitest"
import { createId } from "@paralleldrive/cuid2"

// `runDailyBilling` reaches pauseBot / logInstanceEvent through dynamic
// `import()`, and notify / createAdminNotification through static imports.
// Mock all four: the real modules pull in the provisioner (3.9k lines, SSH,
// provider SDKs) and would send real notifications. Only pauseBot's behaviour
// is under test; the rest just need to not fire.
const pauseBot = vi.fn<(instance: unknown) => Promise<void>>()
vi.mock("@/lib/provisioner", () => ({ pauseBot: (i: unknown) => pauseBot(i) }))
vi.mock("@/lib/instance-state", () => ({ logInstanceEvent: vi.fn(async () => {}) }))
vi.mock("@/lib/admin-notify", () => ({ createAdminNotification: vi.fn(async () => {}) }))
vi.mock("@/lib/notifications/dispatch", () => ({ notify: vi.fn(async () => {}) }))

import { runDailyBilling } from "@/lib/daily-billing"
import { depositToWallet, getWalletCredits } from "@/lib/wallet"
import { usdToCredits } from "@/lib/credit-pricing"
import {
  db,
  users,
  teams,
  regions,
  serverConfigs,
  instances,
  processedEvents,
  and,
  eq,
  sql,
} from "@/db"

/** The daily cost the fixture below bills: priceMonthly / DAYS_PER_MONTH. */
const PRICE_MONTHLY = 30
const DAILY_COST_CREDITS = usdToCredits(PRICE_MONTHLY / 30)

/** A running, non-BYOS instance owned by a funded-or-not user. */
async function seedRunningInstance(): Promise<{ userId: string; instanceId: string }> {
  const [user] = await db
    .insert(users)
    .values({ email: `${createId()}@itest.local` })
    .returning({ id: users.id })

  const [team] = await db
    .insert(teams)
    .values({ name: "itest team", ownerId: user.id })
    .returning({ id: teams.id })

  const suffix = createId()
  const [region] = await db
    .insert(regions)
    .values({ slug: `itest-${suffix}`, name: "Test", country: "US", flag: "🇺🇸" })
    .returning({ id: regions.id })

  const [config] = await db
    .insert(serverConfigs)
    .values({
      slug: `itest-${suffix}`,
      category: "standard",
      label: "Test 2GB",
      vcpu: 1,
      ramGb: 2,
      storageGb: 50,
      priceMonthly: PRICE_MONTHLY,
      priceYearly: PRICE_MONTHLY * 12,
    })
    .returning({ id: serverConfigs.id })

  const [instance] = await db
    .insert(instances)
    .values({
      userId: user.id,
      teamId: team.id,
      name: "itest agent",
      slug: `itest-${suffix}`,
      regionId: region.id,
      serverConfigId: config.id,
      storageGb: 50,
      status: "running",
    })
    .returning({ id: instances.id })

  return { userId: user.id, instanceId: instance.id }
}

/** Does a `daily_billing` claim exist for this instance on this billing day? */
async function claimExists(billingDay: string, instanceId: string): Promise<boolean> {
  const rows = await db
    .select()
    .from(processedEvents)
    .where(
      and(
        eq(processedEvents.source, "daily_billing"),
        eq(processedEvents.eventId, `${billingDay}:${instanceId}`),
      ),
    )
  return rows.length > 0
}

describe("daily billing — claim lifecycle (DB-backed)", () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    pauseBot.mockImplementation(async () => {})
    // Instance → Team/User and Wallet → User are ON DELETE CASCADE, so clearing
    // users clears the fixture. ProcessedEvent has no FK, so truncate it too.
    await db.execute(sql`DELETE FROM "User"`)
    await db.execute(sql`DELETE FROM "Region"`)
    await db.execute(sql`DELETE FROM "ServerConfig"`)
    await db.execute(sql`TRUNCATE TABLE "ProcessedEvent"`)
  })

  it("releases the claim when pauseBot fails, so the instance is retried", async () => {
    // The regression this file exists for. Before the fix, the claim committed
    // in-tx, pauseBot threw outside it, and the claim stood — leaving the agent
    // running, uncharged, and skipped as `already_billed` for the rest of the
    // day. One free day of compute per failure, reported only as a log line.
    const { userId, instanceId } = await seedRunningInstance()
    // Fund below (dailyCost + minimumBalance) so the deduction returns ok:false.
    await depositToWallet(userId, 10, "topup")

    pauseBot.mockRejectedValueOnce(new Error("provider API 503"))

    const report = await runDailyBilling()

    expect(report.errors.join("\n")).toContain("pauseBot failed")
    // NOT counted as stopped — the instance is still running.
    expect(report.stopped).toBe(0)
    expect(await claimExists(report.billingDay, instanceId)).toBe(false)

    // The retry is the whole point: a later run in the same day must re-attempt
    // rather than short-circuit on a stale claim.
    pauseBot.mockImplementation(async () => {})
    const retry = await runDailyBilling()
    expect(retry.alreadyBilled).toBe(0)
    expect(retry.stopped).toBe(1)
    expect(await claimExists(retry.billingDay, instanceId)).toBe(true)
  })

  it("keeps the claim when pauseBot succeeds, so the day is not re-processed", async () => {
    const { userId, instanceId } = await seedRunningInstance()
    await depositToWallet(userId, 10, "topup")

    const first = await runDailyBilling()
    expect(first.stopped).toBe(1)
    expect(first.errors).toEqual([])
    expect(await claimExists(first.billingDay, instanceId)).toBe(true)
    expect(pauseBot).toHaveBeenCalledTimes(1)

    const second = await runDailyBilling()
    expect(second.alreadyBilled).toBe(1)
    expect(second.stopped).toBe(0)
    // The instance must not be paused twice for the same billing day.
    expect(pauseBot).toHaveBeenCalledTimes(1)
  })

  it("a successful charge keeps its claim and is never billed twice", async () => {
    // Guards the other direction: release-on-pause-failure must not weaken the
    // charged path into claim-on-success, which would let a re-run double-bill.
    const { userId } = await seedRunningInstance()
    await depositToWallet(userId, DAILY_COST_CREDITS * 10, "topup")
    const funded = await getWalletCredits(userId)

    const first = await runDailyBilling()
    expect(first.charged).toBe(1)
    expect(first.stopped).toBe(0)
    expect(await getWalletCredits(userId)).toBe(funded - DAILY_COST_CREDITS)

    const second = await runDailyBilling()
    expect(second.alreadyBilled).toBe(1)
    expect(second.charged).toBe(0)
    // Balance unchanged — the claim, not a balance check, is what prevents it.
    expect(await getWalletCredits(userId)).toBe(funded - DAILY_COST_CREDITS)
    expect(pauseBot).not.toHaveBeenCalled()
  })
})
