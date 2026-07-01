import Image from "next/image"
import Link from "next/link"
import { BRANDING } from "@/configs/branding"
import { Reveal } from "@/components/marketing/motion/reveal"

function ExternalLinkArrow() {
  return (
    <svg
      className="-translate-x-1 translate-y-1 opacity-0 blur-[1px] transition-all duration-200 group-hover:translate-x-0 group-hover:translate-y-0 group-hover:opacity-100 group-hover:blur-[0px] group-hover:delay-100"
      fill="none"
      height="20"
      viewBox="0 0 20 20"
      width="20"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M13.5 11.9286V6.5M13.5 6.5H8.07143M13.5 6.5L6.5 13.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeOpacity="0.9"
        strokeWidth="1.25"
      />
    </svg>
  )
}

const footerSections = [
  {
    title: "Platform",
    links: [
      { href: "/#agents", label: "Agents" },
      { href: "/#features", label: "Features" },
      { href: "/login?deploy=true", label: "Deploy" },
      { href: "/#pricing", label: "Pricing" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/docs", label: "Docs", external: true },
      { href: "/team", label: "Team" },
      { href: "/careers", label: "Careers" },
      { href: "/docs#faq", label: "Resources" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/terms", label: "Terms" },
      { href: "/privacy", label: "Privacy" },
      { href: "/refund", label: "Refunds" },
      { href: "/sla", label: "SLA" },
    ],
  },
  {
    title: "Connect",
    links: [
      { href: BRANDING.twitter, label: "X (Twitter)", external: true },
      { href: BRANDING.linkedin, label: "LinkedIn", external: true },
      { href: BRANDING.github, label: "GitHub", external: true },
    ],
  },
] as const

export default function Footer() {
  return (
    <footer className="relative -mt-8 overflow-hidden pb-4 lg:-mt-16 lg:pb-6">
      {/* Footer background gradient layer */}
      <div className="footer-background pointer-events-none absolute bottom-0 left-0 h-[2709px] w-full">
        <div className="absolute top-[1183px] lg:top-[886px] left-1/2 -translate-x-1/2 w-[3088px] h-[960px] pointer-events-none dark:hidden">
          <div className="absolute top-0 left-0 h-[960px] w-[1440px]">
            <Image
              alt=""
              aria-hidden
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 max-w-none bg-drift"
              width={1884}
              height={1124}
              loading="lazy"
              src="/assets/footer/background-transition.avif"
            />
          </div>
          <div className="absolute top-0 right-0 h-[960px] w-[1440px]">
            <Image
              alt=""
              aria-hidden
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 max-w-none bg-drift bg-drift--reverse"
              width={1884}
              height={1124}
              loading="lazy"
              src="/assets/footer/background-transition.avif"
            />
          </div>
        </div>
      </div>

      {/* CTA area */}
      <div className="relative mx-auto mb-12 max-w-[1320px] pt-8 lg:mb-20 lg:pt-20">
        {/* Decorative vertical lines */}
        <div className="footer-cta-line-1 pointer-events-none absolute top-[120px] h-[480px] w-full max-lg:hidden">
          <div className="absolute top-0 left-0 h-full w-px" />
          <div className="absolute top-0 right-0 h-full w-px" />
        </div>
        <div className="footer-cta-line-2 pointer-events-none absolute -top-[80px] h-[720px] max-lg:hidden" style={{ width: "1120px", left: "calc(50% - 560px)" }}>
          <div className="absolute top-0 left-0 h-full w-px" />
          <div className="absolute top-0 right-0 h-full w-px" />
        </div>
        <div className="footer-cta-line-3 pointer-events-none absolute top-[100px] h-[400px] max-lg:hidden" style={{ width: "793px", left: "calc(50% - 396.5px)" }}>
          <div className="absolute top-0 left-0 h-full w-px" />
          <div className="absolute top-0 right-0 h-full w-px" />
        </div>

        {/* CTA headline */}
        <Reveal className="relative mx-auto mb-10 max-w-[360px] text-center text-hero-white text-[clamp(2rem,4.5vw,46px)] leading-[1.04] tracking-[-0.46px] font-serif lg:max-w-[500px]" style={{ fontWeight: 400 }}>
          <div className="absolute -top-[35.5px] lg:-top-[82px] left-0 right-0 h-px bg-hero/[0.06]" />
          Own the agents that run your business
        </Reveal>

        {/* CTA button row */}
        <div className="relative h-11">
          <div className="absolute -bottom-[39.5px] lg:-bottom-[66px] left-0 right-0 h-px bg-hero/[0.06]" />
          <div className="flex items-center gap-[25px] h-full">
            <div className="h-px flex-1 bg-hero/[0.06]" />
            <a href={BRANDING.demoUrl} target="_blank" rel="noopener noreferrer">
              <button
                className="relative z-[2] flex items-center justify-center cursor-pointer rounded-full h-11 lg:h-9 px-[18px] outline-offset-2 focus-visible:outline focus-visible:outline-hero-white btn-antimetal"
                type="button"
              >
                <span className="relative text-[15px] font-[450] leading-5">
                  Book a demo
                </span>
              </button>
            </a>
            <div className="h-px flex-1 bg-hero/[0.06]" />
          </div>
        </div>
      </div>

      {/* Footer links — 4 column layout */}
      <div className="relative mx-auto flex max-w-[390px] gap-2 text-[15px] leading-5 max-lg:flex-wrap max-lg:gap-y-10 max-lg:px-[31px] lg:max-w-[976px] lg:gap-6">
        {footerSections.map((section) => (
          <div key={section.title} className="flex-1 max-lg:min-w-[40%]">
            <h3 className="mb-6 text-hero/[0.56] lg:mb-4">{section.title}</h3>
            <div className="relative flex flex-col">
              {section.links
                .filter((link) => !("hidden" in link && link.hidden))
                .map((link) => {
                const isExternal = "external" in link && link.external
                const className =
                  "group relative flex w-max rounded-full py-2 text-hero-white outline-offset-2 focus-visible:outline focus-visible:outline-hero-white"

                if (isExternal) {
                  return (
                    <a
                      key={link.label}
                      className={className}
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {link.label}
                      <ExternalLinkArrow />
                    </a>
                  )
                }

                return (
                  <Link key={link.label} className={className} href={link.href}>
                    {link.label}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Bottom copyright */}
      <div className="relative mx-auto mt-6 text-center lg:mt-8">
        <p className="text-hero/30 text-sm">
          &copy; {new Date().getFullYear()} {BRANDING.name}. All rights reserved.
        </p>
      </div>
    </footer>
  )
}
