import { HelpCircle } from "lucide-react"
import type { ReactNode } from "react"
import { CREDIT_TOOLTIP } from "@/configs/plans"

type Props = {
  children: ReactNode
  className?: string
}

/** Accessible hint for “credits” without heavy tooltip libraries */
export function CreditTerm({ children, className = "" }: Props) {
  return (
    <span
      className={`inline-flex items-center gap-0.5 border-b border-dotted border-[var(--text-secondary)] cursor-help ${className}`}
      title={CREDIT_TOOLTIP}
    >
      {children}
      <HelpCircle
        className="w-3.5 h-3.5 shrink-0 text-[var(--text-secondary)]"
        aria-hidden
      />
      <span className="sr-only">{CREDIT_TOOLTIP}</span>
    </span>
  )
}
