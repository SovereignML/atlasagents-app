"use client"

type BillingInterval = "month" | "year"

type Props = {
  value: BillingInterval
  onChange: (v: BillingInterval) => void
  className?: string
}

export function BillingIntervalToggle({ value, onChange, className = "" }: Props) {
  return (
    <div
      className={`inline-flex rounded-full border border-[var(--border-color)] p-1 bg-[var(--card-bg)] ${className}`}
      role="group"
      aria-label="Billing interval"
    >
      <button
        type="button"
        onClick={() => onChange("month")}
        className={`px-5 py-2 text-xs font-bold uppercase rounded-full transition-colors ${
          value === "month"
            ? "bg-primary text-black"
            : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        }`}
      >
        Monthly
      </button>
      <button
        type="button"
        onClick={() => onChange("year")}
        className={`px-5 py-2 text-xs font-bold uppercase rounded-full transition-colors ${
          value === "year"
            ? "bg-primary text-black"
            : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        }`}
      >
        Annual
      </button>
    </div>
  )
}

export type { BillingInterval }
