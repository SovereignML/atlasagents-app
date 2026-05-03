// Pure pricing functions. Used by both the deploy wizard (preview) and
// the /api/checkout endpoint, so there's a single source of truth.

import { STORAGE_PRICE_PER_GB_MONTH, type ServerTypeConfig } from "@/configs/server-types"
import type { PlanConfig } from "@/configs/plans"

export type BillingInterval = "month" | "year"

// ── Plan-based pricing (customer-facing) ────────────────────────────

export type PlanPriceBreakdown = {
  planName: string
  planSlug: string
  price: number
  interval: BillingInterval
  yearlyDiscountApplied: boolean
}

export function calcPlanPrice(
  plan: Pick<PlanConfig, "name" | "slug" | "displayPriceMonthly" | "displayPriceYearly">,
  interval: BillingInterval,
): PlanPriceBreakdown {
  const isYearly = interval === "year"
  return {
    planName: plan.name,
    planSlug: plan.slug,
    price: isYearly ? plan.displayPriceYearly : plan.displayPriceMonthly,
    interval,
    yearlyDiscountApplied: isYearly,
  }
}

/** Stripe unit_amount in cents for a plan checkout session */
export function planUnitAmountCents(
  plan: Pick<PlanConfig, "displayPriceMonthly" | "displayPriceYearly">,
  interval: BillingInterval,
): number {
  const price = interval === "year"
    ? plan.displayPriceYearly
    : plan.displayPriceMonthly
  return Math.round(price * 100)
}

// ── Internal cost pricing (server cost, not shown to customers) ─────

export type PriceBreakdown = {
  serverPrice: number
  storagePrice: number
  subtotal: number
  total: number
  interval: BillingInterval
  yearlyDiscountApplied: boolean
}

export type PriceInput = {
  serverConfig: Pick<ServerTypeConfig, "priceMonthly" | "priceYearly">
  storageGb: number
  interval: BillingInterval
}

export function calcInstancePrice({
  serverConfig,
  storageGb,
  interval,
}: PriceInput): PriceBreakdown {
  const isYearly = interval === "year"
  const serverPrice = isYearly
    ? serverConfig.priceYearly
    : serverConfig.priceMonthly

  const monthlyStorage = storageGb * STORAGE_PRICE_PER_GB_MONTH
  const storagePrice = isYearly ? monthlyStorage * 12 : monthlyStorage

  const subtotal = serverPrice + storagePrice
  const total = round2(subtotal)

  return {
    serverPrice: round2(serverPrice),
    storagePrice: round2(storagePrice),
    subtotal: round2(subtotal),
    total,
    interval,
    yearlyDiscountApplied: isYearly,
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function formatUsd(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)
}
