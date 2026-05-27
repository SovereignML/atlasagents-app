"use client"

import { useId } from "react"
import { motion } from "framer-motion"
import { spring } from "@/lib/motion"

type BillingInterval = "month" | "year"

type Props = {
  value: BillingInterval
  onChange: (v: BillingInterval) => void
  className?: string
}

const OPTIONS: { value: BillingInterval; label: string }[] = [
  { value: "month", label: "Monthly" },
  { value: "year", label: "Annual" },
]

export function BillingIntervalToggle({ value, onChange, className = "" }: Props) {
  // Namespace the shared layout element per instance so two toggles on one
  // page never animate into each other.
  const pillId = useId()

  return (
    <div
      className={`inline-flex rounded-full border border-border-muted p-1 bg-[var(--card-bg)] ${className}`}
      role="group"
      aria-label="Billing interval"
    >
      {OPTIONS.map((opt) => {
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

export type { BillingInterval }
