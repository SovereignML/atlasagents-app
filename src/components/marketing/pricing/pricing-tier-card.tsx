import Link from "next/link"
import { Check, X } from "lucide-react"
import type { PlanConfig } from "@/configs/plans"
import { formatUsd } from "@/configs/plans"
import { BRANDING } from "@/configs/branding"
import type { BillingInterval } from "./billing-interval-toggle"

type Props = {
  plan: PlanConfig
  interval: BillingInterval
}

function PriceBlock({ plan, interval }: Props) {
  if (plan.tier === "enterprise" && plan.enterprisePriceLabel) {
    return (
      <div className="mt-6">
        {plan.enterpriseFullPriceLabel &&
          plan.enterpriseFullPriceLabel !== plan.enterprisePriceLabel && (
            <span className="block text-sm text-text-secondary line-through">
              {plan.enterpriseFullPriceLabel}
            </span>
          )}
        <span className="text-2xl sm:text-3xl font-bold text-text-loud leading-tight">
          {plan.enterprisePriceLabel}
        </span>
      </div>
    )
  }

  if (plan.tier === "free") {
    return (
      <div className="mt-6 flex items-baseline gap-1">
        <span className="text-4xl font-bold text-text-loud">
          {formatUsd(0)}
        </span>
        <span className="text-text-secondary text-sm">/mo</span>
      </div>
    )
  }

  const isYear = interval === "year"
  const amount = isYear ? plan.displayPriceYearly : plan.displayPriceMonthly
  const fullAmount = isYear ? plan.fullPriceYearly : plan.fullPriceMonthly
  const suffix = isYear ? "/year" : "/mo"
  const hasPromo = fullAmount > amount
  // Only plans whose yearly price is less than 12x the monthly price actually
  // get the "2 months free" annual discount (e.g. BYOS is a flat 12x, so no
  // discount — don't show the label there).
  const hasAnnualDiscount = plan.displayPriceYearly < plan.displayPriceMonthly * 12

  return (
    <div className="mt-6">
      <div className="flex items-baseline gap-2 flex-wrap">
        {hasPromo && (
          <span className="text-xl font-bold text-text-secondary line-through">
            {formatUsd(fullAmount)}
          </span>
        )}
        <span className="text-4xl font-bold text-text-loud">
          {formatUsd(amount)}
        </span>
        <span className="text-text-secondary">{suffix}</span>
      </div>
      {hasPromo && (
        <p className="mt-1 text-xs font-mono text-primary">
          Launch pricing
        </p>
      )}
      {isYear && hasAnnualDiscount && (
        <p className="mt-1 text-xs font-mono text-primary">
          2 months free
        </p>
      )}
    </div>
  )
}

function Cta({ plan }: { plan: PlanConfig }) {
  const base =
    "mt-8 block text-center py-3.5 text-sm font-bold uppercase rounded-xl transition-all"

  if (plan.cta === "contact-sales") {
    return (
      <a
        href={BRANDING.demoUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={`${base} border border-border-muted text-text-loud hover:border-primary hover:text-primary`}
      >
        Contact Sales
      </a>
    )
  }

  if (plan.cta === "start-free") {
    return (
      <Link
        href="/login?deploy=true"
        className={`${base} border border-border-muted text-text-loud hover:border-primary hover:text-primary`}
      >
        Start Free
      </Link>
    )
  }

  return (
    <Link
      href="/login?deploy=true"
      className={`${base} ${
        plan.highlight
          ? "btn-gradient"
          : "border border-border-muted text-text-loud hover:border-primary hover:text-primary"
      }`}
    >
      Get Started
    </Link>
  )
}

export function PricingTierCard(props: Props) {
  const { plan } = props

  return (
    <div
      className={`relative flex flex-col h-full p-6 sm:p-8 rounded-2xl border transition-all duration-300 shadow-[var(--shadow-sm)] hover:shadow-[var(--shadow-hover)] ${
        plan.highlight
          ? "border-2 border-primary bg-[var(--card-bg)] shadow-[0_0_20px_rgba(209,241,20,0.12)]"
          : "border-border-muted bg-[var(--card-bg)] hover:border-primary/50"
      } hover:bg-[var(--card-hover)]`}
    >
      {plan.highlight && (
        <div className="absolute -top-3 left-6 bg-primary text-black text-xs font-bold uppercase px-3 py-1 rounded-full">
          Most Popular
        </div>
      )}

      <h2 className="text-xl sm:text-2xl font-bold text-text-loud">
        {plan.name}
      </h2>
      <p className="mt-1 text-sm text-text-secondary">{plan.description}</p>

      <PriceBlock {...props} />

      <ul className="mt-6 space-y-2.5 flex-1">
        {plan.features.map((f) => (
          <li key={f} className="flex items-start gap-2.5 text-sm">
            <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" aria-hidden />
            <span className="text-text-loud leading-snug">{f}</span>
          </li>
        ))}
        {plan.restrictions?.map((r) => (
          <li key={r} className="flex items-start gap-2.5 text-sm text-text-secondary">
            <X className="w-4 h-4 shrink-0 mt-0.5 opacity-60" aria-hidden />
            <span className="leading-snug">{r}</span>
          </li>
        ))}
      </ul>

      <Cta plan={plan} />
    </div>
  )
}
