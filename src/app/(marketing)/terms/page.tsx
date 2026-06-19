import Link from "next/link"
import { BRANDING } from "@/configs/branding"
import { Reveal, RevealGroup, RevealItem } from "@/components/marketing/motion/reveal"

const LAST_UPDATED = "May 30, 2026" // {{TODO: confirm effective date on legal sign-off}}

const sections = [
  {
    id: "acceptance",
    title: "Acceptance of Terms",
    content: `By accessing or using SovereignML ("the Platform"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree to these Terms, you may not use the Platform.

These Terms apply to all users, including free-tier users, paid subscribers, and administrators. SovereignML reserves the right to update these Terms at any time. Continued use after changes are posted constitutes acceptance.`,
  },
  {
    id: "description",
    title: "Service Description",
    content: `SovereignML is an AI operations platform that allows users to deploy, manage, and scale intelligent AI agents. The Platform includes:

• A web dashboard for deploying and monitoring agents
• A deployment wizard with compute and billing configuration
• Billing management via Stripe subscriptions
• Account management including SSH keys, social profiles, and security settings
• An Admin Panel accessible to users with the admin role

Features described in documentation or marketing materials may be subject to plan availability. SovereignML reserves the right to modify, suspend, or discontinue features at any time.`,
  },
  {
    id: "accounts",
    title: "Accounts & Registration",
    subsections: [
      {
        title: "Eligibility",
        content: "You must be at least 16 years old to create an account. By registering, you represent that you meet this requirement.",
      },
      {
        title: "Account Security",
        content: "You are responsible for maintaining the confidentiality of your account credentials. You must not share your password or allow unauthorized access to your account. Notify us immediately at security@sovereignml.com if you suspect unauthorized access.",
      },
      {
        title: "Accurate Information",
        content: "You must provide accurate, current, and complete information during registration. Providing false information may result in account suspension or termination.",
      },
      {
        title: "One Account Per User",
        content: "Each person may maintain only one account. Creating multiple accounts to circumvent rate limits, bans, or plan restrictions is prohibited.",
      },
    ],
  },
  {
    id: "plans-billing",
    title: "Plans & Billing",
    subsections: [
      {
        title: "Subscription Plans",
        content: "SovereignML offers subscription tiers including Free, Builder, Operator, Scale, and Enterprise (custom pricing). Plans are credit-based for AI usage, workflows, automations, and related services. Features and limits vary by tier. Current plan details are available at sovereignml.com/pricing.",
      },
      {
        title: "Payment",
        content: "All payments are processed by Stripe. By subscribing, you authorize us to charge your payment method on a recurring basis (monthly or yearly, as selected at deploy time). All prices are in USD.",
      },
      {
        title: "Renewals & Cancellation",
        content: "Subscriptions automatically renew at the end of each billing cycle. You may cancel at any time from your dashboard. Cancellation takes effect at the end of the current billing period. No partial refunds are issued.",
      },
      {
        title: "Failed Payments",
        content: "If a payment fails, your subscription enters past_due status. Service may be suspended if payment is not resolved within 7 days. We will notify you by email before suspending service.",
      },
      {
        title: "Refunds",
        content: "All sales are final. We do not offer refunds for monthly or yearly subscriptions, including partial-period refunds. If you believe you were charged in error, contact billing@sovereignml.com within 14 days of the charge.",
      },
      {
        title: "Price Changes",
        content: "SovereignML reserves the right to change subscription prices. We will provide at least 30 days' notice by email before any price change takes effect for existing subscribers.",
      },
    ],
  },
  {
    id: "acceptable-use",
    title: "Acceptable Use",
    content: `You agree not to use SovereignML to:

• Violate any applicable law or regulation
• Infringe the intellectual property rights of others
• Upload or deploy agents that distribute malware, spyware, or ransomware
• Conduct unauthorized penetration testing, port scanning, or network exploitation
• Generate or distribute spam, phishing content, or unsolicited communications
• Impersonate another person or entity
• Attempt to gain unauthorized access to other users' accounts or data
• Use the platform to mine cryptocurrency
• Overload, disrupt, or degrade platform infrastructure
• Circumvent rate limits, usage caps, or access controls
• Deploy agents for illegal surveillance, stalking, or harassment

Violation of these terms may result in immediate account suspension or termination without refund.`,
  },
  {
    id: "agents-content",
    title: "AI Agents & Your Content",
    subsections: [
      {
        title: "Ownership",
        content: "You retain ownership of any content, data, or configurations you create using SovereignML. By using the Platform, you grant SovereignML a limited, non-exclusive license to store and process your content solely to provide the service.",
      },
      {
        title: "Agent Behavior",
        content: "You are responsible for the behavior and outputs of agents you deploy. SovereignML provides the infrastructure. You are responsible for the tasks, prompts, and integrations you configure your agents to perform.",
      },
      {
        title: "Cloud Infrastructure",
        content: "Agent deployment provisions infrastructure on enterprise-grade cloud providers. You acknowledge that service availability depends on upstream provider status. {{TODO: legal review}}",
      },
      {
        title: "Data Use & Product Improvement",
        content: "We may use aggregated, anonymized data derived from platform usage to operate, secure, and improve the Platform, including improving agent performance and our models over time. We do not sell your data. You can opt out of analytics-based product improvement by contacting us at privacy@sovereignml.com. {{TODO: legal review — confirm scope, wording, and opt-out mechanism}}",
      },
    ],
  },
  {
    id: "termination",
    title: "Termination & Suspension",
    content: `SovereignML may suspend or terminate your account at any time, with or without notice, if:

• You violate these Terms of Service
• You engage in fraudulent, abusive, or illegal activity
• Required by law or court order

You may delete your account at any time from your account settings or by contacting us. Upon termination, your data is permanently deleted (see our Privacy Policy for retention timelines).

SovereignML is not liable for any loss resulting from account termination.`,
  },
  {
    id: "disclaimers",
    title: "Disclaimers",
    content: `THE PLATFORM IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED. SOVEREIGNML DOES NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE, OR MEET YOUR SPECIFIC REQUIREMENTS.

TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, SOVEREIGNML DISCLAIMS ALL WARRANTIES INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.

AI agents may produce inaccurate, incomplete, or unexpected outputs. You are solely responsible for validating agent outputs before relying on them for business decisions.`,
  },
  {
    id: "liability",
    title: "Limitation of Liability",
    content: `TO THE MAXIMUM EXTENT PERMITTED BY LAW, SOVEREIGNML AND ITS AFFILIATES SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING LOST PROFITS, DATA LOSS, OR BUSINESS INTERRUPTION.

SOVEREIGNML'S TOTAL LIABILITY TO YOU FOR ANY CLAIMS ARISING FROM USE OF THE PLATFORM SHALL NOT EXCEED THE AMOUNT YOU PAID TO SOVEREIGNML IN THE 12 MONTHS PRECEDING THE CLAIM.

Some jurisdictions do not allow limitation of liability for consequential or incidental damages; in such jurisdictions, liability is limited to the maximum extent permitted by law.`,
  },
  {
    id: "ip",
    title: "Intellectual Property",
    content: `SovereignML, its logo, design system, software, and documentation are the intellectual property of SovereignML and are protected by copyright, trademark, and other laws.

You may not copy, modify, distribute, reverse-engineer, or create derivative works of the Platform without express written permission.

Open-source components used in the Platform remain subject to their respective licenses.`,
  },
  {
    id: "governing-law",
    title: "Governing Law",
    content: `These Terms are governed by the laws of the jurisdiction in which SovereignML is incorporated, without regard to conflict of law provisions.

Any disputes arising from these Terms or the Platform shall first be submitted to good-faith negotiation. If unresolved, disputes shall be settled by binding arbitration, except that either party may seek injunctive relief in court for IP violations.`,
  },
  {
    id: "contact",
    title: "Contact",
    content: `For questions about these Terms, contact us:

SovereignML
Email: legal@sovereignml.com
Website: sovereignml.com`,
  },
]

export const metadata = {
  title: "Terms of Service | SovereignML",
  description: "Terms and conditions governing your use of the SovereignML AI operations platform.",
}

export default function TermsPage() {
  return (
    <div className="max-w-[900px] mx-auto px-8 py-16">
      {/* Header */}
      <Reveal className="border-l-4 border-primary pl-8 mb-12">
        <div className="text-primary text-xs mb-3 opacity-80">
          Legal
        </div>
        <h1 className="text-[clamp(2rem,4vw,3.5rem)] font-bold text-[var(--text-primary)] mb-4">
          Terms of Service
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

            {"content" in s && typeof s.content === "string" && (
              <div className="text-[var(--text-secondary)] text-sm leading-relaxed whitespace-pre-line">
                {s.content}
              </div>
            )}

            {"subsections" in s && s.subsections && (
              <div className="space-y-6">
                {s.subsections.map((sub) => (
                  <div key={sub.title} className="border-l-2 border-primary/30 pl-4">
                    <p className="font-bold text-[var(--text-primary)] mb-2 text-sm">
                      {sub.title}
                    </p>
                    <p className="text-[var(--text-secondary)] text-sm leading-relaxed">{sub.content}</p>
                  </div>
                ))}
              </div>
            )}
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
            href="/privacy"
            className="text-[var(--text-secondary)] hover:text-primary transition-colors"
          >
            Privacy Policy
          </Link>
          <Link
            href="/sla"
            className="text-[var(--text-secondary)] hover:text-primary transition-colors"
          >
            SLA
          </Link>
        </div>
      </div>
    </div>
  )
}
