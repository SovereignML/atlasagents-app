import { NextRequest, NextResponse } from "next/server"
import { stripe } from "@/lib/stripe"
import {
  handleConnectAccountUpdated,
  handleConnectCheckoutCompleted,
  handleConnectSubscriptionUpdated,
  handleConnectSubscriptionDeleted,
  handleConnectInvoicePaymentFailed,
} from "@/lib/stripe-connect-events"
import { claimEvent, releaseEvent } from "@/lib/idempotency"

// Dedicated endpoint for CONNECTED-account events (reseller billing). Kept
// separate from the platform webhook so the two never cross-process: this one
// records child end-customer subscriptions on the tenant's connected account
// and NEVER funds the platform wallet. Uses its own signing secret.
export async function POST(req: NextRequest) {
  const body = await req.text()
  const signature = req.headers.get("stripe-signature")
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 })
  }

  const webhookSecret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET
  if (!webhookSecret) {
    console.error("[stripe connect webhook] STRIPE_CONNECT_WEBHOOK_SECRET not configured")
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 })
  }

  let event
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error"
    console.error(`[stripe connect webhook] Signature verification failed: ${msg}`)
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 })
  }

  // Defense-in-depth: this endpoint only handles connected-account events.
  if (!event.account) {
    return NextResponse.json({ received: true, ignored: "not a connected event" })
  }

  const claimed = await claimEvent("stripe-connect", event.id, event)
  if (!claimed) {
    return NextResponse.json({ received: true, dedup: true })
  }

  try {
    switch (event.type) {
      case "account.updated":
        await handleConnectAccountUpdated(event.data.object)
        break
      case "checkout.session.completed":
        await handleConnectCheckoutCompleted(event.data.object, event.account)
        break
      case "customer.subscription.updated":
        await handleConnectSubscriptionUpdated(event.data.object, event.account)
        break
      case "customer.subscription.deleted":
        await handleConnectSubscriptionDeleted(event.data.object, event.account)
        break
      case "invoice.payment_failed":
        await handleConnectInvoicePaymentFailed(event.data.object, event.account)
        break
      default:
        console.log(`[stripe connect webhook] Unhandled event type: ${event.type}`)
    }
  } catch (err) {
    await releaseEvent("stripe-connect", event.id)
    console.error(`[stripe connect webhook] Error handling ${event.type}:`, err)
    return NextResponse.json({ error: "Handler failed" }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}
