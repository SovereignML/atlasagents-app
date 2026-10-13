// Closing an account keeps the money trail. Deleting the User row used to
// cascade to the wallet, its transactions, the credit ledger and the user's
// own audit trail; those foreign keys are now RESTRICT and admins close
// accounts instead (src/lib/account-closure.ts).
//
// `./db-env` MUST be imported first — it redirects DATABASE_URL at the test DB
// before `@/db` is evaluated.
import "./db-env"

import { beforeEach, describe, expect, it } from "vitest"
import { createId } from "@paralleldrive/cuid2"
import {
  db,
  users,
  wallets,
  walletTransactions,
  auditLogs,
  teams,
  memberships,
  sessions,
  eq,
  sql,
} from "@/db"
import { depositToWallet } from "@/lib/wallet"
import { closeUserAccount, closedAccountEmail } from "@/lib/account-closure"

async function seedUser(): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({ email: `${createId()}@itest.local`, name: "Pat", hashedPassword: "x" })
    .returning({ id: users.id })
  return row.id
}

describe("account closure (DB-backed)", () => {
  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE "User" CASCADE`)
  })

  it("refuses a hard delete of a user with a wallet", async () => {
    const userId = await seedUser()
    await depositToWallet(userId, 1_000, "topup", "itest")
    await expect(db.delete(users).where(eq(users.id, userId))).rejects.toThrow()
  })

  it("anonymizes the user and keeps wallet, transactions and audit rows", async () => {
    const userId = await seedUser()
    await depositToWallet(userId, 1_000, "topup", "itest")
    await db.insert(auditLogs).values({ userId, action: "instance.deploy" })
    await db.insert(sessions).values({
      sessionToken: createId(),
      userId,
      expires: new Date(Date.now() + 60_000),
    })

    expect(await closeUserAccount(userId)).toEqual({ ok: true })

    const row = await db.query.users.findFirst({ where: eq(users.id, userId) })
    expect(row?.deletedAt).toBeInstanceOf(Date)
    expect(row?.email).toBe(closedAccountEmail(userId))
    expect(row?.name).toBeNull()
    expect(row?.hashedPassword).toBeNull()

    const wallet = await db.query.wallets.findFirst({ where: eq(wallets.userId, userId) })
    expect(wallet?.balance).toBe(1_000)
    const txns = await db.select().from(walletTransactions).where(eq(walletTransactions.walletId, wallet!.id))
    expect(txns.length).toBeGreaterThan(0)
    expect(await db.select().from(auditLogs).where(eq(auditLogs.userId, userId))).toHaveLength(1)
    expect(await db.select().from(sessions).where(eq(sessions.userId, userId))).toHaveLength(0)
  })

  it("refuses while the user owns a team other people belong to", async () => {
    const owner = await seedUser()
    const member = await seedUser()
    const [team] = await db.insert(teams).values({ name: "T", ownerId: owner }).returning()
    await db.insert(memberships).values([
      { teamId: team.id, userId: owner, role: "owner" },
      { teamId: team.id, userId: member, role: "developer" },
    ])
    const result = await closeUserAccount(owner)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(409)
  })

  it("refuses to close an account twice", async () => {
    const userId = await seedUser()
    expect((await closeUserAccount(userId)).ok).toBe(true)
    const again = await closeUserAccount(userId)
    expect(again.ok).toBe(false)
  })
})
