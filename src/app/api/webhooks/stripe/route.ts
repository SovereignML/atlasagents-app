import { NextRequest, NextResponse } from "next/server"
import { stripe } from "@/lib/stripe"
import {
  handleCheckoutSessionCompleted,
  handleSubscriptionUpdated,
  handleSubscriptionDeleted,
  handleInvoicePaid,
  handleInvoicePaymentFailed,
  handleChargeRefunded,
  handleChargeDisputeCreated,
  handleChargeDisputeClosed,
  handleInvoiceVoided,
  handleInvoiceUpcoming,
} from "@/lib/stripe-events"
import { claimEvent, releaseEvent } from "@/lib/idempotency"

export async function POST(req: NextRequest) {
  const body = await req.text()
  const signature = req.headers.get("stripe-signature")

  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 })
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!webhookSecret) {
    console.error("[stripe webhook] STRIPE_WEBHOOK_SECRET not configured")
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 })
  }

  let event
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error"
    console.error(`[stripe webhook] Signature verification failed: ${msg}`)
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 })
  }

  // Idempotency — Stripe retries on 5xx and sometimes redelivers on its own.
  // Without dedup, `invoice.paid` retries cause duplicate plan-credit deposits.
  // We claim the event up-front; on handler error we release so the retry can
  // re-attempt. See src/lib/idempotency.ts.
  const claimed = await claimEvent("stripe", event.id, event)
  if (!claimed) {
    return NextResponse.json({ received: true, dedup: true })
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutSessionCompleted(event.data.object)
        break
      case "customer.subscription.updated":
        await handleSubscriptionUpdated(event.data.object)
        break
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event.data.object)
        break
      case "invoice.paid":
        await handleInvoicePaid(event.data.object)
        break
      case "invoice.payment_failed":
        await handleInvoicePaymentFailed(event.data.object)
        break
      case "invoice.voided":
        await handleInvoiceVoided(event.data.object)
        break
      case "invoice.upcoming":
        await handleInvoiceUpcoming(event.data.object)
        break
      case "charge.refunded":
        await handleChargeRefunded(event.data.object)
        break
      case "charge.dispute.created":
        await handleChargeDisputeCreated(event.data.object)
        break
      case "charge.dispute.closed":
        await handleChargeDisputeClosed(event.data.object)
        break
      default:
        console.warn(`[stripe-webhook] Unhandled event type: ${event.type}`)
    }
  } catch (err) {
    // Roll back the claim so Stripe's retry can re-attempt.
    await releaseEvent("stripe", event.id)
    console.error(`[stripe webhook] Error handling ${event.type}:`, err)
    return NextResponse.json({ error: "Handler failed" }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}
