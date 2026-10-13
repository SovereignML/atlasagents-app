import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { db, eq, users } from "@/db"
import { stripe, isStripeConfigured } from "@/lib/stripe"
import { BRANDING } from "@/configs/branding"
import { stripeIdempotencyKey } from "@/lib/stripe-idempotency"

export async function POST() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (!isStripeConfigured()) {
    return NextResponse.json(
      { error: "Billing portal is not configured" },
      { status: 503 }
    )
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    columns: { stripeCustomerId: true, email: true },
  })

  let customerId = user?.stripeCustomerId
  if (!customerId) {
    const email = user?.email ?? session.user.email ?? undefined
    const customer = await stripe.customers.create(
      { email, metadata: { userId: session.user.id } },
      { idempotencyKey: stripeIdempotencyKey("customer", session.user.id, email) },
    )
    customerId = customer.id
    await db
      .update(users)
      .set({ stripeCustomerId: customerId })
      .where(eq(users.id, session.user.id))
  }

  const portal = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${BRANDING.appUrl}/dashboard/billing`,
  })

  return NextResponse.json({ url: portal.url })
}
