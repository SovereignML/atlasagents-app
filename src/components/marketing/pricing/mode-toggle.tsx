"use client"

import { useId } from "react"
import { motion } from "framer-motion"
import { spring } from "@/lib/motion"

export type PricingMode = "managed" | "byos"

const MODE_OPTIONS: { value: PricingMode; label: string }[] = [
  { value: "managed", label: "Fully Managed" },
  { value: "byos", label: "Bring Your Own Server" },
]

type Props = {
  value: PricingMode
  onChange: (v: PricingMode) => void
  className?: string
}

export function ModeToggle({ value, onChange, className = "" }: Props) {
  const pillId = useId()
  return (
    <div
      className={`inline-flex rounded-full border border-border-muted p-1 bg-[var(--card-bg)] ${className}`}
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
