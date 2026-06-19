import Link from "next/link"
import { BRANDING } from "@/configs/branding"
import { Reveal, RevealGroup, RevealItem } from "@/components/marketing/motion/reveal"

const LAST_UPDATED = "May 30, 2026" // {{TODO: confirm effective date on legal sign-off}}

const sections = [
  {
    id: "overview",
    title: "Overview",
    content: `SovereignML ("we", "us", or "our") operates the SovereignML AI operations platform at sovereignml.com. This Privacy Policy explains what data we collect, why we collect it, how we use it, and your rights regarding your personal information.

By creating an account or using our services, you agree to the collection and use of information as described in this policy. If you do not agree, please discontinue use of the platform.`,
  },
  {
    id: "data-collected",
    title: "Data We Collect",
    subsections: [
      {
        title: "Account Information",
        content: "When you register, we collect your name, email address, and password (stored as a bcryptjs hash, never in plaintext). If you sign in via Google OAuth, we receive your name, email, and profile picture from Google.",
      },
      {
        title: "Agent & Deployment Data",
        content: "We store the configuration of every agent you deploy: project name, region, compute tier, billing interval, and extra storage. We also store an IP address for each agent instance. Root passwords, if provided, are encrypted at rest using AES-256-GCM with a per-instance initialization vector.",
      },
      {
        title: "Billing Information",
        content: "Billing is processed by Stripe. We do not store credit card numbers or payment details on our servers. We store Stripe subscription IDs, plan identifiers, billing intervals, status, and renewal dates. Your payment method is stored and managed exclusively by Stripe.",
      },
      {
        title: "SSH Keys",
        content: "If you add SSH keys via the dashboard, we store the public key material and fingerprint. Private keys are never transmitted to or stored by us.",
      },
      {
        title: "Social & Contact Data",
        content: "Optionally, you may add a Telegram ID, Twitter/X handle, or Discord ID to your account profile. This information is stored only if you provide it and can be removed at any time from Account Settings.",
      },
      {
        title: "Usage & Log Data",
        content: "We collect server-side logs for debugging and operational purposes. Logs may include request timestamps, endpoint paths, HTTP status codes, and error messages. Logs do not contain request bodies or sensitive user data.",
      },
      {
        title: "Cookies & Sessions",
        content: "We use signed, JWT-based session cookies to keep you authenticated. These are httpOnly, secure cookies that do not contain your password or payment information, only a signed token encoding your user ID and role.",
      },
    ],
  },
  {
    id: "how-we-use",
    title: "How We Use Your Data",
    items: [
      "To create and maintain your account",
      "To provision, manage, and monitor your AI agents",
      "To process payments and manage subscriptions via Stripe",
      "To send transactional emails (password resets, deployment confirmations) via Resend",
      "To enforce platform security, detect abuse, and apply rate limits",
      "To provide customer support when you contact us",
      "To improve the platform — including agent performance and our models over time — based only on aggregated, anonymized usage patterns. You can opt out of analytics-based product improvement by contacting privacy@sovereignml.com. {{TODO: legal review — confirm opt-out wording and mechanism}}",
    ],
  },
  {
    id: "data-sharing",
    title: "Data Sharing & Third Parties",
    subsections: [
      {
        title: "Stripe",
        content: "Payment processing. Stripe's Privacy Policy applies to payment data. We share only what Stripe requires to process transactions: your email and subscription details.",
      },
      {
        title: "Resend",
        content: "Transactional email delivery. We share your email address with Resend solely to deliver platform emails (password resets, notifications). Resend does not use your data for marketing.",
      },
      {
        title: "Google",
        content: "If you use Google OAuth, Google shares your name, email, and profile picture with us per Google's OAuth scope. We do not share data back to Google.",
      },
      {
        title: "No Advertising",
        content: "We do not sell, rent, or share your personal data with advertisers, data brokers, or any third parties for marketing purposes.",
      },
      {
        title: "Legal Requirements",
        content: "We may disclose your data if required by law, court order, or to protect the rights and safety of SovereignML, our users, or the public.",
      },
    ],
  },
  {
    id: "data-security",
    title: "Data Security",
    content: `We implement industry-standard security measures:

• Passwords are hashed with bcryptjs (10 salt rounds), never stored or logged in plaintext
• Root passwords are encrypted at rest using AES-256-GCM with per-instance IVs
• Password reset tokens are stored as SHA-256 hashes; the plaintext token only ever exists in the reset email link
• All data queries are scoped to your user ID; cross-user data access requires admin role
• Session cookies are JWT-signed with a secret key, httpOnly, and secure
• HTTPS is enforced on all production endpoints

No system is completely secure. We encourage you to use a strong, unique password and enable two-factor authentication on any email account associated with SovereignML.`,
  },
  {
    id: "data-retention",
    title: "Data Retention",
    content: `We retain your data for as long as your account is active. If you delete your account:

• Your profile, agents, subscriptions, and SSH keys are permanently deleted from our database
• Active Stripe subscriptions are cancelled
• Server logs may retain anonymized request metadata for up to 30 days for operational purposes
• Backup snapshots may retain data for up to 14 days before permanent deletion

You can request account deletion by contacting us at the address below.`,
  },
  {
    id: "your-rights",
    title: "Your Rights",
    content: `Depending on your jurisdiction, you may have the following rights:

• Access: Request a copy of the personal data we hold about you
• Correction: Update inaccurate or incomplete data via Account Settings
• Deletion: Request permanent deletion of your account and associated data
• Portability: Request your data in a structured, machine-readable format
• Restriction: Request that we limit processing of your data in certain circumstances
• Objection: Object to processing based on legitimate interests

To exercise any of these rights, contact us at the address below. We will respond within 30 days.`,
  },
  {
    id: "children",
    title: "Children's Privacy",
    content: "SovereignML is not directed at children under 16. We do not knowingly collect personal information from anyone under 16. If we become aware that we have collected personal information from a child, we will delete it promptly.",
  },
  {
    id: "changes",
    title: "Changes to This Policy",
    content: "We may update this Privacy Policy from time to time. When we do, we will update the \"Last Updated\" date at the top of this page. For material changes, we will notify you by email or via a notice on the platform before the change takes effect. Continued use of SovereignML after changes take effect constitutes acceptance of the updated policy.",
  },
  {
    id: "contact",
    title: "Contact",
    content: `For privacy-related questions, data requests, or to report a concern, contact us at:

SovereignML
Email: privacy@sovereignml.com
Website: sovereignml.com`,
  },
]

export const metadata = {
  title: "Privacy Policy | SovereignML",
  description: "How SovereignML collects, uses, and protects your personal information.",
}

export default function PrivacyPage() {
  return (
    <div className="max-w-[900px] mx-auto px-8 py-16">
      {/* Header */}
      <Reveal className="border-l-4 border-primary pl-8 mb-12">
        <div className="text-primary text-xs mb-3 opacity-80">
          Legal
        </div>
        <h1 className="text-[clamp(2rem,4vw,3.5rem)] font-bold text-[var(--text-primary)] mb-4">
          Privacy Policy
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

            {"items" in s && s.items && (
              <ul className="space-y-2">
                {s.items.map((item) => (
                  <li key={item} className="flex items-start gap-3 text-sm text-[var(--text-secondary)]">
                    <span className="text-primary mt-0.5">&rsaquo;</span>
                    {item}
                  </li>
                ))}
              </ul>
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
            href="/terms"
            className="text-[var(--text-secondary)] hover:text-primary transition-colors"
          >
            Terms of Service
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
