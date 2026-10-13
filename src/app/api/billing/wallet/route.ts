import { NextRequest, NextResponse } from "next/server"
import { db, eq, desc, walletTransactions, users } from "@/db"
import { getEffectiveUserId } from "@/lib/effective-user"
import { getOrCreateWallet } from "@/lib/wallet"
import {
  stripe,
  isStripeConfigured,
  isDevBypassAllowed,
  STRIPE_NOT_CONFIGURED,
} from "@/lib/stripe"
import {
  CREDITS_PER_USD,
  MIN_TOPUP_CREDITS,
  creditsToUsd,
} from "@/lib/credit-pricing"
import { readJsonBody } from "@/lib/request-body"
import { walletTopupSchema } from "@/lib/validations"
import { stripeIdempotencyKey, windowKey } from "@/lib/stripe-idempotency"

/**
 * GET /api/billing/wallet
 *
 * Returns the user's credit balance, the minimum (low-water mark), and
 * recent transactions. All numbers are integer credits.
 */
export async function GET() {
  const userId = await getEffectiveUserId()
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const wallet = await getOrCreateWallet(userId)

  const transactions = await db.query.walletTransactions.findMany({
    where: eq(walletTransactions.walletId, wallet.id),
    orderBy: desc(walletTransactions.createdAt),
    limit: 50,
  })

  return NextResponse.json({
    credits: Math.round(wallet.balance),
    minimumCredits: Math.round(wallet.minimumBalance),
    creditsPerUsd: CREDITS_PER_USD,
    transactions: transactions.map((t) => ({
      id: t.id,
      credits: Math.round(t.amount),
      balanceAfter: Math.round(t.balanceAfter),
      type: t.type,
      description: t.description,
      instanceId: t.instanceId,
      createdAt: t.createdAt,
    })),
  })
}

/**
 * POST /api/billing/wallet
 *
 * Buy credits. Body: `{ credits: number }` (minimum 500 = $5).
 * In dev (no Stripe key) we deposit immediately; otherwise we redirect
 * the caller to a Stripe Checkout session.
 */
export async function POST(req: NextRequest) {
  const userId = await getEffectiveUserId()
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await readJsonBody(req, walletTopupSchema)
  if (!body.ok) return body.res

  const credits = body.data.credits
  if (!credits || credits < MIN_TOPUP_CREDITS) {
    return NextResponse.json(
      { error: `Minimum top-up is ${MIN_TOPUP_CREDITS} credits` },
      { status: 400 },
    )
  }

  const amountUsd = creditsToUsd(credits)

  if (!isStripeConfigured()) {
    if (!isDevBypassAllowed()) {
      // Production with missing/invalid Stripe keys: never grant free credits.
      return NextResponse.json(STRIPE_NOT_CONFIGURED, { status: 503 })
    }
    // Dev mode: deposit directly without Stripe. fundWallet also raises and
    // re-enables the user's OpenRouter key caps.
    const { fundWallet } = await import("@/lib/openrouter-billing")
    const balance = await fundWallet(
      userId,
      credits,
      "topup",
      `Dev top-up: ${credits.toLocaleString()} credits`,
    )
    return NextResponse.json({ credits: balance, devMode: true })
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { email: true, stripeCustomerId: true },
  })
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }

  let customerId = user.stripeCustomerId
  if (!customerId) {
    // Same params and key as every other customer create, so concurrent
    // first purchases can't make two customers for one user.
    const customer = await stripe.customers.create(
      { email: user.email, metadata: { userId } },
      { idempotencyKey: stripeIdempotencyKey("customer", userId, user.email) },
    )
    customerId = customer.id
    await db.update(users).set({ stripeCustomerId: customerId }).where(eq(users.id, userId))
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: Math.round(amountUsd * 100),
          product_data: {
            name: `${credits.toLocaleString()} credits`,
            description: `Adds ${credits.toLocaleString()} credits to your balance ($${amountUsd.toFixed(2)})`,
          },
        },
        quantity: 1,
      },
    ],
    metadata: {
      type: "wallet_topup",
      userId,
      credits: String(credits),
    },
    success_url: `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/dashboard/billing?topup=success`,
    cancel_url: `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/dashboard/billing`,
  }, {
    // A double click or retry within the minute reuses the same session.
    idempotencyKey: stripeIdempotencyKey("wallet-topup", userId, customerId, credits, windowKey()),
  })

  return NextResponse.json({ checkoutUrl: session.url })
}
