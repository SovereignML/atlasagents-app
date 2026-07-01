import Link from "next/link"
import { BRANDING } from "@/configs/branding"
import { Reveal, RevealGroup, RevealItem } from "@/components/marketing/motion/reveal"

const LAST_UPDATED = "June 30, 2026"

const sections = [
  {
    id: "overview",
    title: "Overview",
    content: `This Refund Policy explains when and how refunds are issued on SovereignML ("the Platform"). We aim to be fair: where you have prepaid for compute or credits you have not used, the unused portion may be refundable within the window described below. It supplements the billing terms set out in our Terms of Service. By subscribing to a paid plan or purchasing credits, you agree to this Refund Policy.`,
  },
  {
    id: "eligibility",
    title: "Refund Window",
    content: `Refund requests for unused credits or unused prepaid compute must be submitted within 14 days of the charge you are asking us to refund. Requests made after 14 days are not eligible. Refunds are issued to the original payment method and remove the corresponding unused balance from your account, so the same funds cannot be both refunded and spent.

All refunds are net of payment-processing fees. Our payment processor retains its processing fee (approximately 2.9% + $0.30 per transaction) even when a charge is refunded; that non-recoverable fee is deducted from any refund amount.`,
  },
  {
    id: "credits-refund",
    title: "Unused Credits",
    content: `Credits are prepaid balance used for AI workloads, automations, and compute. Only credits you purchased directly (top-ups) are eligible for a cash refund, and only to the extent they remain unused at the time of your request, within the 14-day window above.

The following credits are not refundable for cash: credits already consumed; credits included with a subscription plan (these are a periodic allotment that expires at the end of each billing period); and promotional, bonus, or admin-granted credits. A refund of unused purchased credits is valued at the standard rate of $0.01 per credit, less processing fees.`,
  },
  {
    id: "compute-refund",
    title: "Unused Compute",
    content: `Platform-hosted agents are billed for compute one day at a time. If you delete an agent partway through a day, the unused portion of that day's compute is automatically returned to your credit balance — no request needed. You are only ever charged for compute time your agents have actually used.

Because compute is billed as it is consumed rather than far in advance, there is no large block of prepaid, unused compute to refund separately. Compute already consumed by a running agent is non-refundable.`,
  },
  {
    id: "subscriptions",
    title: "Subscription Plans",
    content: `Paid plans are billed in advance for a billing period (monthly or yearly) and include a credit allotment and one or more live agents. If you cancel within 14 days of a plan charge, you may request a refund of the unused portion of that billing period, calculated on a simple pro-rata basis: the days remaining in the period divided by the total days in the period, applied to the amount paid, less any credits already consumed beyond your plan allotment and less processing fees.

Time already elapsed in the period, the value of any plan credits already used, and one-time setup or onboarding fees are non-refundable. Bring-Your-Own-Server (BYOS) management subscriptions follow the same pro-rata rule for the unused portion of the period.`,
  },
  {
    id: "non-refundable",
    title: "What Is Not Refundable",
    content: `To keep pricing sustainable and fair to all customers, the following are non-refundable:

• Credits and compute already consumed.
• Subscription-included, promotional, bonus, or admin-granted credits.
• Payment-processing fees (deducted from every refund).
• Charges where the refund request is made more than 14 days after the charge.
• One-time setup, onboarding, migration, or professional-services fees.
• Third-party costs already incurred on your behalf (for example, compute already run, AI usage already metered, or domain registrations).
• Enterprise or custom agreements, which are governed by the refund terms of their order form or contract.`,
  },
  {
    id: "billing-errors",
    title: "Billing Errors",
    content: `If you believe you were charged in error (for example, a duplicate charge, an incorrect amount, or a charge after a confirmed cancellation), contact us at billing@sovereignml.com within 14 days of the charge.

We will review eligible billing-error claims and, where a charge is confirmed to be in error, issue a correction or refund to the original payment method.`,
  },
  {
    id: "renewals",
    title: "Renewals & Cancellations",
    content: `Subscriptions automatically renew at the end of each billing cycle. You may cancel at any time from your dashboard; cancellation takes effect at the end of the current period unless you also request a refund of the unused portion under the Subscription Plans section above. It is your responsibility to cancel before a renewal date if you do not wish to be charged for the next period.

Charges from a renewal that was not cancelled in time are eligible for a refund only under the 14-day window and pro-rata rules described above.`,
  },
  {
    id: "service-disruption",
    title: "Service Disruptions",
    content: `Service-level commitments and any related credits are governed by our SLA. Where the SLA provides for service credits, those credits are your sole and exclusive remedy for covered downtime and are not paid out as cash refunds.`,
  },
  {
    id: "how-to-request",
    title: "How to Request a Refund",
    content: `To request a refund, email billing@sovereignml.com from the email address associated with your account. Include the charge date, amount, and a brief description of your request. For unused-credit or unused-compute refunds, tell us which charge you would like reviewed; we will confirm the eligible amount, net of fees, before processing.

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

SovereignML L.L.C.
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
          &copy; {new Date().getFullYear()} {BRANDING.legalEntity}. All rights reserved.
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
