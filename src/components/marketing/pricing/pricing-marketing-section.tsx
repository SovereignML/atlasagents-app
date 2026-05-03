"use client"

import { useState } from "react"
import Link from "next/link"
import { PLANS, PRICING_POSITIONING, OVERAGE_PACKS, ADD_ONS, formatUsd } from "@/configs/plans"
import { BRANDING } from "@/configs/branding"
import { ArrowRight } from "lucide-react"
import { BillingIntervalToggle, type BillingInterval } from "./billing-interval-toggle"
import { PricingTierCard } from "./pricing-tier-card"
import { CreditTerm } from "./credit-term"

type Props = {
  /** Home page: tier grid + headline only; full page includes usage, overage, add-ons */
  compact?: boolean
}

export function PricingMarketingSection({ compact = false }: Props) {
  const [interval, setInterval] = useState<BillingInterval>("month")

  return (
    <>
      <section className="max-w-[1400px] mx-auto px-8 pb-10">
        <div className="max-w-[880px]">
          <h1 className="text-[clamp(2rem,5vw,3.75rem)] font-bold leading-[1.1] text-[var(--text-primary)]">
            {PRICING_POSITIONING.headline}
          </h1>
          <p className="mt-4 text-[var(--text-secondary)] text-lg leading-relaxed">
            {PRICING_POSITIONING.subheadline}
          </p>
        </div>

        <div className="mt-10">
          <BillingIntervalToggle value={interval} onChange={setInterval} />
        </div>
      </section>

      <section className="max-w-[1400px] mx-auto px-8 pb-16">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          {PLANS.map((plan) => (
            <PricingTierCard key={plan.slug} plan={plan} interval={interval} />
          ))}
        </div>

        {compact && (
          <p className="mt-10 text-center">
            <Link
              href="/pricing"
              className="inline-flex items-center gap-2 text-sm font-bold text-primary hover:underline"
            >
              Usage, overages & add-ons
              <ArrowRight className="w-4 h-4" />
            </Link>
          </p>
        )}
      </section>

      {!compact && (
        <>
          <section className="max-w-[1000px] mx-auto px-8 pb-16 border-t border-[var(--border-color)] pt-16">
            <h2 className="text-2xl sm:text-[2rem] font-bold text-[var(--text-primary)] mb-3">
              Simple Usage-Based Pricing
            </h2>
            <p className="text-[var(--text-secondary)] text-lg mb-6">
              <CreditTerm>Credits</CreditTerm> power your AI operations.
            </p>
            <ul className="space-y-2 text-[var(--text-primary)]">
              <li className="flex gap-2">
                <span className="text-primary font-mono">&gt;</span>
                AI model usage
              </li>
              <li className="flex gap-2">
                <span className="text-primary font-mono">&gt;</span>
                Workflows
              </li>
              <li className="flex gap-2">
                <span className="text-primary font-mono">&gt;</span>
                Automations
              </li>
              <li className="flex gap-2">
                <span className="text-primary font-mono">&gt;</span>
                Vector search
              </li>
            </ul>
          </section>

          <section className="max-w-[1000px] mx-auto px-8 pb-16">
            <h2 className="text-xl font-bold text-[var(--text-primary)] mb-6">
              Overage packs
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {OVERAGE_PACKS.map((pack) => (
                <div
                  key={pack.credits}
                  className="rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] p-6 text-center shadow-[var(--shadow-sm)]"
                >
                  <p className="text-2xl font-bold text-[var(--text-primary)]">
                    {pack.credits.toLocaleString("en-US")} credits
                  </p>
                  <p className="mt-2 font-mono text-lg text-primary">
                    {formatUsd(pack.priceUsd)}
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-4 text-sm text-[var(--text-secondary)] max-w-xl">
              Only pay for what you use beyond your plan.
            </p>
          </section>

          <section className="max-w-[1000px] mx-auto px-8 pb-20">
            <h2 className="text-xl font-bold text-[var(--text-primary)] mb-6">
              Extend Your AI Workforce
            </h2>
            <ul className="divide-y divide-[var(--border-color)] rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-[var(--shadow-sm)] overflow-hidden">
              {ADD_ONS.map((a) => (
                <li
                  key={a.name}
                  className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 px-5 py-4"
                >
                  <span className="text-[var(--text-primary)] font-medium">{a.name}</span>
                  <span className="font-mono text-primary">{a.price}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="max-w-[1000px] mx-auto px-8 pb-24">
            <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-10 text-center relative overflow-hidden shadow-[var(--shadow-sm)]">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(204,255,0,0.05)_0%,transparent_70%)] pointer-events-none" />
              <div className="relative z-10">
                <h3 className="text-2xl font-bold text-[var(--text-primary)] mb-3">
                  Need a Custom Deployment?
                </h3>
                <p className="text-[var(--text-secondary)] max-w-lg mx-auto mb-6">
                  Talk to us about enterprise infrastructure, SLAs, and credit volume for your organization.
                </p>
                <a
                  href={BRANDING.demoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 btn-gradient font-bold text-sm uppercase px-8 py-4"
                >
                  Contact Sales <ArrowRight className="w-4 h-4" />
                </a>
              </div>
            </div>

            <p className="mt-8 text-[var(--text-secondary)] text-sm text-center font-mono">
              &gt; Payments processed securely via Stripe. Cancel anytime.
            </p>
          </section>
        </>
      )}
    </>
  )
}
