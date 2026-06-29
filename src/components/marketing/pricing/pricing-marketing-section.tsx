"use client"

import { useId, useState } from "react"
import Link from "next/link"
import { motion } from "framer-motion"
import { PLANS, BYOS_PLAN, PRICING_POSITIONING, OVERAGE_PACKS, ADD_ONS, formatUsd } from "@/configs/plans"
import { BRANDING } from "@/configs/branding"
import { ArrowRight, Check, KeyRound, Server, Wallet } from "lucide-react"
import { spring } from "@/lib/motion"
import { Reveal, RevealGroup, RevealItem } from "@/components/marketing/motion/reveal"
import { BillingIntervalToggle, type BillingInterval } from "./billing-interval-toggle"
import { PricingTierCard } from "./pricing-tier-card"
import { CreditTerm } from "./credit-term"

type Props = {
  /** Home page: tier grid + headline only; full page includes usage, overage, add-ons */
  compact?: boolean
}

type PricingMode = "managed" | "byos"

const MODE_OPTIONS: { value: PricingMode; label: string }[] = [
  { value: "managed", label: "Fully Managed" },
  { value: "byos", label: "Bring Your Own Server" },
]

function ModeToggle({
  value,
  onChange,
}: {
  value: PricingMode
  onChange: (v: PricingMode) => void
}) {
  const pillId = useId()
  return (
    <div
      className="inline-flex rounded-full border border-border-muted p-1 bg-[var(--card-bg)]"
      role="group"
      aria-label="Pricing model"
    >
      {MODE_OPTIONS.map((opt) => {
        const active = value === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            className="relative px-5 py-2 text-xs font-bold uppercase rounded-full transition-colors"
          >
            {active && (
              <motion.span
                layoutId={`${pillId}-pill`}
                className="absolute inset-0 rounded-full bg-primary"
                transition={spring.snappy}
              />
            )}
            <span
              className={`relative z-10 transition-colors ${
                active ? "text-black" : "text-text-secondary hover:text-text-loud"
              }`}
            >
              {opt.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function ByosModule({ interval }: { interval: BillingInterval }) {
  const price = interval === "year" ? BYOS_PLAN.displayPriceYearly : BYOS_PLAN.displayPriceMonthly
  return (
    <Reveal
      as="div"
      className="rounded-2xl border border-border-muted bg-[var(--card-bg)] p-8 shadow-[var(--shadow-sm)] transition-shadow duration-300 hover:shadow-[var(--shadow-hover)]"
    >
      <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="max-w-2xl">
          <div className="flex items-center gap-2 text-text-loud">
            <Server className="w-5 h-5 text-primary" />
            <h3 className="text-xl font-bold">{BYOS_PLAN.name}</h3>
          </div>
          <p className="mt-2 text-text-secondary">
            Already have a server? We act as your management panel: deploy,
            monitor, restart, and configure your agent on infrastructure you
            own. Flat fee per server, no compute charges.
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:gap-6 text-sm text-text-loud">
            <span className="flex items-center gap-2">
              <Wallet className="w-4 h-4 text-primary" /> 100 AI credits
              included, then top up as you go
            </span>
            <span className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-primary" /> Or bring your own
              API key
            </span>
          </div>
        </div>
        <div className="flex flex-col items-start lg:items-end gap-3">
          <div className="text-text-loud">
            <span className="text-3xl font-bold">{formatUsd(price)}</span>
            <span className="text-text-secondary text-sm">
              {interval === "year" ? "/yr" : "/mo"} per server
            </span>
          </div>
          <Link
            href="/dashboard/byos/connect"
            className="inline-flex items-center gap-2 btn-gradient font-bold text-sm uppercase px-8 py-4"
          >
            Connect your server <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </Reveal>
  )
}

export function PricingMarketingSection({ compact = false }: Props) {
  const [interval, setInterval] = useState<BillingInterval>("month")
  const [mode, setMode] = useState<PricingMode>("managed")

  const managedPlans = PLANS.filter((plan) => plan.tier !== "byos")

  return (
    <>
      <section className="max-w-[1400px] mx-auto px-8 pb-10">
        <Reveal className="max-w-[880px]">
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border-muted bg-background-faint text-xs font-medium uppercase tracking-wider text-text-secondary mb-5">
            <span className="w-1.5 h-1.5 rounded-full bg-primary" />
            Pricing
          </span>
          <h1 className="text-[clamp(2rem,5vw,3.75rem)] font-bold leading-[1.1] text-text-loud">
            {PRICING_POSITIONING.headline}
          </h1>
          <p className="mt-4 text-text-secondary text-lg leading-relaxed">
            {PRICING_POSITIONING.subheadline}
          </p>
        </Reveal>

        <Reveal delay={0.1} className="mt-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <ModeToggle value={mode} onChange={setMode} />
          <BillingIntervalToggle value={interval} onChange={setInterval} />
        </Reveal>
      </section>

      <section className="max-w-[1400px] mx-auto px-8 pb-16">
        {mode === "managed" ? (
          <RevealGroup className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {managedPlans.map((plan) => (
              <RevealItem
                key={plan.slug}
                whileHover={{ y: -6, transition: spring.snappy }}
              >
                <PricingTierCard plan={plan} interval={interval} />
              </RevealItem>
            ))}
          </RevealGroup>
        ) : (
          <div className="space-y-4">
            <ByosModule interval={interval} />
            <Reveal
              as="div"
              className="rounded-2xl border border-border-muted bg-background-faint p-8"
            >
              <h3 className="text-lg font-bold text-text-loud mb-4">
                What&apos;s included
              </h3>
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2.5">
                {BYOS_PLAN.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm">
                    <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" aria-hidden />
                    <span className="text-text-loud leading-snug">{f}</span>
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>
        )}

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
          <Reveal as="section" className="max-w-[1000px] mx-auto px-8 pb-16 border-t border-border-muted pt-16">
            <h2 className="text-2xl sm:text-[2rem] font-bold text-text-loud mb-3">
              Simple Usage-Based Pricing
            </h2>
            <p className="text-text-secondary text-lg mb-6">
              <CreditTerm>Credits</CreditTerm> power your AI operations.
            </p>
            <ul className="space-y-2 text-text-loud">
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
          </Reveal>

          <section className="max-w-[1000px] mx-auto px-8 pb-16">
            <Reveal as="h2" className="text-xl font-bold text-text-loud mb-6">
              Overage packs
            </Reveal>
            <RevealGroup className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {OVERAGE_PACKS.map((pack) => (
                <RevealItem
                  key={pack.credits}
                  whileHover={{ y: -4, transition: spring.snappy }}
                  className="rounded-2xl border border-border-muted bg-[var(--card-bg)] p-6 text-center shadow-[var(--shadow-sm)] transition-shadow duration-300 hover:shadow-[var(--shadow-hover)]"
                >
                  <p className="text-2xl font-bold text-text-loud">
                    {pack.credits.toLocaleString("en-US")} credits
                  </p>
                  <p className="mt-2 font-mono text-lg text-primary">
                    {formatUsd(pack.priceUsd)}
                  </p>
                </RevealItem>
              ))}
            </RevealGroup>
            <p className="mt-4 text-sm text-text-secondary max-w-xl">
              Only pay for what you use beyond your plan.
            </p>
          </section>

          <Reveal as="section" className="max-w-[1000px] mx-auto px-8 pb-20">
            <h2 className="text-xl font-bold text-text-loud mb-6">
              Extend Your AI Workforce
            </h2>
            <ul className="divide-y divide-[var(--border-color)] rounded-2xl border border-border-muted bg-[var(--card-bg)] shadow-[var(--shadow-sm)] overflow-hidden">
              {ADD_ONS.map((a) => (
                <li
                  key={a.name}
                  className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 px-5 py-4"
                >
                  <span className="text-text-loud font-medium">{a.name}</span>
                  <span className="font-mono text-primary">{a.price}</span>
                </li>
              ))}
            </ul>
          </Reveal>

          <section className="max-w-[1000px] mx-auto px-8 pb-24">
            <Reveal className="rounded-2xl border border-border-muted bg-background-faint p-10 text-center relative overflow-hidden shadow-[var(--shadow-sm)]">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(204,255,0,0.05)_0%,transparent_70%)] pointer-events-none" />
              <div className="relative z-10">
                <h3 className="text-2xl font-bold text-text-loud mb-3">
                  Need a Custom Deployment?
                </h3>
                <p className="text-text-secondary max-w-lg mx-auto mb-6">
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
            </Reveal>

            <p className="mt-8 text-text-secondary text-sm text-center font-mono">
              &gt; Payments processed securely via Stripe. Cancel anytime.
            </p>
          </section>
        </>
      )}
    </>
  )
}
