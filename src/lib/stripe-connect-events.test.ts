import { describe, it, expect, vi, beforeEach } from "vitest"

// Synthetic end-to-end check of the CONNECTED-account (reseller) webhook
// handlers — proves the entitlement path without a real Stripe account or DB:
// a completed Connect checkout must (a) record the child's subscription with the
// tenant's connectAccountId, and (b) stamp the child team's agent/seat caps from
// the chosen plan. Also guards the money-separation scoping (event.account) and
// the past_due transition. Mocks @/db like the dns-status route test.

const teamsFindFirst = vi.fn()
const tenantPlansFindFirst = vi.fn()
const insertValues = vi.fn()
const updateCalls: { table: string; set: Record<string, unknown> }[] = []

vi.mock("@/db", () => {
  const tag = (name: string) => ({ __table: name })
  const teams = tag("teams")
  const subscriptions = tag("subscriptions")
  const tenantConfig = tag("tenantConfig")
  const tenantPlans = tag("tenantPlans")
  return {
    eq: () => ({}),
    and: () => ({}),
    teams,
    subscriptions,
    tenantConfig,
    tenantPlans,
    db: {
      query: {
        teams: { findFirst: (...a: unknown[]) => teamsFindFirst(...a) },
        tenantPlans: { findFirst: (...a: unknown[]) => tenantPlansFindFirst(...a) },
      },
      insert: () => ({
        values: (v: Record<string, unknown>) => {
          insertValues(v)
          return { onConflictDoUpdate: () => Promise.resolve() }
        },
      }),
      update: (table: { __table: string }) => ({
        set: (v: Record<string, unknown>) => {
          updateCalls.push({ table: table.__table, set: v })
          return { where: () => Promise.resolve() }
        },
      }),
    },
  }
})

const {
  handleConnectCheckoutCompleted,
  handleConnectSubscriptionUpdated,
  handleConnectSubscriptionDeleted,
  handleConnectInvoicePaymentFailed,
} = await import("./stripe-connect-events")

const ACCOUNT = "acct_tenant123"
const CHILD = "team_child_1"
const PLAN = "tplan_pro"

function checkoutSession(over: Record<string, unknown> = {}) {
  return {
    subscription: "sub_abc",
    metadata: { childTeamId: CHILD, tenantPlanId: PLAN },
    ...over,
  } as never
}

beforeEach(() => {
  vi.clearAllMocks()
  updateCalls.length = 0
  teamsFindFirst.mockResolvedValue({ ownerId: "owner_1" })
  tenantPlansFindFirst.mockResolvedValue({ agentLimit: 5, seatLimit: 10 })
})

describe("handleConnectCheckoutCompleted — subscription attribution", () => {
  it("records the child sub with the tenant's connectAccountId + teamId", async () => {
    await handleConnectCheckoutCompleted(checkoutSession(), ACCOUNT)

    expect(insertValues).toHaveBeenCalledTimes(1)
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: CHILD,
        connectAccountId: ACCOUNT,
        stripeSubscriptionId: "sub_abc",
        status: "active",
        userId: "owner_1",
      }),
    )
  })

  it("stamps the child team's caps from the chosen plan", async () => {
    await handleConnectCheckoutCompleted(checkoutSession(), ACCOUNT)

    const teamUpdate = updateCalls.find((c) => c.table === "teams")
    expect(teamUpdate).toBeDefined()
    expect(teamUpdate!.set).toEqual({ agentLimit: 5, seatLimit: 10 })
  })

  it("does NOT touch team caps when no plan is attached", async () => {
    await handleConnectCheckoutCompleted(
      checkoutSession({ metadata: { childTeamId: CHILD } }),
      ACCOUNT,
    )
    expect(insertValues).toHaveBeenCalledTimes(1) // sub still recorded
    expect(updateCalls.find((c) => c.table === "teams")).toBeUndefined()
    expect(tenantPlansFindFirst).not.toHaveBeenCalled()
  })

  it("is a no-op without a connected account id (money-separation guard)", async () => {
    await handleConnectCheckoutCompleted(checkoutSession(), undefined)
    expect(insertValues).not.toHaveBeenCalled()
    expect(updateCalls).toHaveLength(0)
  })

  it("is a no-op when the child team is missing", async () => {
    teamsFindFirst.mockResolvedValue(undefined)
    await handleConnectCheckoutCompleted(checkoutSession(), ACCOUNT)
    expect(insertValues).not.toHaveBeenCalled()
  })
})

describe("connected subscription lifecycle scoping", () => {
  it("updates status on subscription.updated", async () => {
    await handleConnectSubscriptionUpdated(
      { id: "sub_abc", status: "active", cancel_at_period_end: false, current_period_end: 0 } as never,
      ACCOUNT,
    )
    const subUpdate = updateCalls.find((c) => c.table === "subscriptions")
    expect(subUpdate?.set).toMatchObject({ status: "active" })
  })

  it("marks canceled on subscription.deleted", async () => {
    await handleConnectSubscriptionDeleted({ id: "sub_abc" } as never, ACCOUNT)
    expect(updateCalls.find((c) => c.table === "subscriptions")?.set).toMatchObject({
      status: "canceled",
    })
  })

  it("marks past_due on a failed invoice payment", async () => {
    await handleConnectInvoicePaymentFailed({ subscription: "sub_abc" } as never, ACCOUNT)
    expect(updateCalls.find((c) => c.table === "subscriptions")?.set).toMatchObject({
      status: "past_due",
    })
  })

  it("ignores lifecycle events with no connected account id", async () => {
    await handleConnectSubscriptionUpdated({ id: "sub_abc", status: "active" } as never, undefined)
    await handleConnectSubscriptionDeleted({ id: "sub_abc" } as never, undefined)
    await handleConnectInvoicePaymentFailed({ subscription: "sub_abc" } as never, undefined)
    expect(updateCalls).toHaveLength(0)
  })
})
