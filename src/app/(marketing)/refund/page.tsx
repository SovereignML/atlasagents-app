import Link from "next/link"
import { BRANDING } from "@/configs/branding"
import { Reveal, RevealGroup, RevealItem } from "@/components/marketing/motion/reveal"

const LAST_UPDATED = "January 1, 2025"

const sections = [
  {
    id: "overview",
    title: "Overview",
    content: `This Refund Policy explains when and how refunds are issued for subscriptions and charges on SovereignML ("the Platform"). It supplements the billing terms set out in our Terms of Service. By subscribing to a paid plan, you agree to this Refund Policy.`,
  },
  {
    id: "all-sales-final",
    title: "All Sales Are Final",
    content: `All sales are final. SovereignML does not offer refunds for monthly or yearly subscriptions, including partial-period refunds for unused time.

When you cancel a subscription, cancellation takes effect at the end of the current billing period. You retain access to paid features until that period ends, and no partial refund is issued for the remainder of the term.`,
  },
  {
    id: "billing-errors",
    title: "Billing Errors",
    content: `If you believe you were charged in error (for example, a duplicate charge, an incorrect amount, or a charge after a confirmed cancellation), contact us at billing@sovereignml.com within 14 days of the charge.

We will review eligible billing-error claims and, where a charge is confirmed to be in error, issue a correction or refund to the original payment method.`,
  },
  {
    id: "failed-cancellations",
    title: "Renewals & Cancellations",
    content: `Subscriptions automatically renew at the end of each billing cycle. It is your responsibility to cancel before the renewal date if you do not wish to be charged for the next period. You may cancel at any time from your dashboard.

Charges incurred because a subscription was not cancelled before its renewal date are not eligible for a refund.`,
  },
  {
    id: "credits",
    title: "Usage Credits",
    content: `Credit-based usage for AI workloads, workflows, and automations is consumed as you use the Platform. Consumed credits are non-refundable. Unused credits are forfeited on cancellation or termination and do not carry a cash value.`,
  },
  {
    id: "service-disruption",
    title: "Service Disruptions",
    content: `Service-level commitments and any related credits are governed by our SLA. Where the SLA provides for service credits, those credits are your sole and exclusive remedy for covered downtime and are not paid out as cash refunds.`,
  },
  {
    id: "how-to-request",
    title: "How to Request a Refund",
    content: `To request a refund for an eligible billing error, email billing@sovereignml.com from the email address associated with your account. Include the charge date, amount, and a brief description of the issue.

We aim to respond to refund requests within 5 business days. Approved refunds are issued to the original payment method and may take additional time to appear, depending on your bank or card issuer.`,
  },
  {
    id: "changes",
    title: "Changes to This Policy",
    content: `SovereignML reserves the right to update this Refund Policy at any time. Material changes will be reflected by updating the "Last updated" date above. Continued use of the Platform after changes are posted constitutes acceptance of the revised policy.`,
  },
  {
    id: "contact",
    title: "Contact",
    content: `For questions about this Refund Policy or a specific charge, contact us:

SovereignML
Email: billing@sovereignml.com
Website: sovereignml.com`,
  },
]

export const metadata = {
  title: "Refund Policy | SovereignML",
  description: "How refunds and billing-error corrections are handled on the SovereignML AI operations platform.",
}

export default function RefundPage() {
  return (
    <div className="max-w-[900px] mx-auto px-8 py-16">
      {/* Header */}
      <Reveal className="border-l-4 border-primary pl-8 mb-12">
        <div className="text-primary text-xs mb-3 opacity-80">
          Legal
        </div>
        <h1 className="text-[clamp(2rem,4vw,3.5rem)] font-bold text-[var(--text-primary)] mb-4">
          Refund Policy
        </h1>
        <p className="text-[var(--text-secondary)] text-sm">
          Last updated: {LAST_UPDATED}
        </p>
      </Reveal>

      {/* Nav */}
      <Reveal delay={0.05} className="rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-[var(--shadow-sm)] p-6 mb-12">
        <p className="text-primary text-xs mb-4">
          Contents
        </p>
        <ol className="space-y-2">
          {sections.map((s, i) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                className="text-sm text-[var(--text-secondary)] hover:text-primary transition-colors"
              >
                {i + 1}. {s.title}
              </a>
            </li>
          ))}
        </ol>
      </Reveal>

      {/* Sections */}
      <RevealGroup className="space-y-12">
        {sections.map((s, i) => (
          <RevealItem as="section" key={s.id} id={s.id} className="scroll-mt-[100px]">
            <h2 className="text-xl font-bold text-[var(--text-primary)] mb-4 pb-3 border-b border-[var(--border-color)]">
              <span className="text-primary mr-2 font-mono">
                {String(i + 1).padStart(2, "0")}.
              </span>
              {s.title}
            </h2>

            <div className="text-[var(--text-secondary)] text-sm leading-relaxed whitespace-pre-line">
              {s.content}
            </div>
          </RevealItem>
        ))}
      </RevealGroup>

      {/* Footer links */}
      <div className="mt-16 pt-8 border-t border-[var(--border-color)] flex flex-col sm:flex-row gap-4 justify-between items-start">
        <p className="text-[var(--text-secondary)] text-sm">
          &copy; {new Date().getFullYear()} {BRANDING.name}. All rights reserved.
        </p>
        <div className="flex gap-6 text-sm">
          <Link
            href="/terms"
            className="text-[var(--text-secondary)] hover:text-primary transition-colors"
          >
            Terms of Service
          </Link>
          <Link
            href="/privacy"
            className="text-[var(--text-secondary)] hover:text-primary transition-colors"
          >
            Privacy Policy
          </Link>
        </div>
      </div>
    </div>
  )
}
