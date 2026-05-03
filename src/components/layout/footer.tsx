import Link from "next/link"
import { BRANDING } from "@/configs/branding"
import { Github, Linkedin, Twitter, Shield } from "lucide-react"

export default function Footer() {
  return (
    <footer className="relative">
      <div className="h-24 bg-gradient-to-b from-transparent to-[var(--bg-secondary)] pointer-events-none" />

      <div className="bg-[var(--bg-secondary)]">
        <div className="max-w-[1100px] mx-auto px-8 pt-12 pb-8">
          <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_1fr] gap-12 mb-16">
            <div>
              <Link
                href="/"
                className="block text-xl font-bold text-[var(--text-primary)] mb-3"
              >
                SovereignML
              </Link>
              <p className="text-[var(--text-secondary)] text-sm max-w-xs leading-relaxed mb-6">
                {BRANDING.tagline}
              </p>
              <div className="flex items-center gap-4">
                <a
                  href={BRANDING.twitter}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors duration-200"
                  aria-label="X (Twitter)"
                >
                  <Twitter className="w-[18px] h-[18px]" />
                </a>
                <a
                  href={BRANDING.linkedin}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors duration-200"
                  aria-label="LinkedIn"
                >
                  <Linkedin className="w-[18px] h-[18px]" />
                </a>
                <a
                  href={BRANDING.github}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors duration-200"
                  aria-label="GitHub"
                >
                  <Github className="w-[18px] h-[18px]" />
                </a>
              </div>
            </div>

            {[
              {
                title: "Platform",
                links: [
                  { href: "/#agents", label: "Agents" },
                  { href: "/#features", label: "Features" },
                  { href: "/#pricing", label: "Pricing" },
                  { href: "/login?deploy=true", label: "Deploy" },
                ],
              },
              {
                title: "Company",
                links: [
                  { href: "/docs", label: "Documentation" },
                  { href: BRANDING.demoUrl, label: "Book a Demo" },
                  { href: "/docs#faq", label: "Resources" },
                  { href: BRANDING.github, label: "GitHub" },
                ],
              },
              {
                title: "Legal",
                links: [
                  { href: "/terms", label: "Terms" },
                  { href: "/privacy", label: "Privacy" },
                  { href: "/sla", label: "SLA" },
                ],
              },
            ].map((section) => (
              <div key={section.title}>
                <h4 className="text-[var(--text-primary)] text-sm font-semibold mb-6">
                  {section.title}
                </h4>
                <ul className="space-y-3">
                  {section.links.map((link) => {
                    const className =
                      "text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-sm transition-colors duration-200 inline-block"
                    const isExternal = /^https?:\/\//i.test(link.href)
                    const isHashRoute = link.href.startsWith("/") && link.href.includes("#")
                    if (isExternal || isHashRoute) {
                      return (
                        <li key={link.label}>
                          <a
                            href={link.href}
                            className={className}
                            {...(isExternal
                              ? { target: "_blank", rel: "noopener noreferrer" }
                              : {})}
                          >
                            {link.label}
                          </a>
                        </li>
                      )
                    }
                    return (
                      <li key={link.label}>
                        <Link href={link.href} className={className}>
                          {link.label}
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-center gap-2 mb-6">
            <Shield className="w-3.5 h-3.5 text-[var(--text-muted)]" />
            <p className="text-[var(--text-muted)] text-xs">
              SOC 2 · GDPR · HIPAA compliant
            </p>
          </div>

          <div className="text-center border-t border-[var(--border-color)] pt-6">
            <p className="text-[var(--text-muted)] text-sm">
              &copy; {new Date().getFullYear()} {BRANDING.name}. All rights reserved.
            </p>
          </div>
        </div>
      </div>
    </footer>
  )
}
