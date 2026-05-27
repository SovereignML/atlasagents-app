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

function ShieldIcon() {
  return (
    <svg
      className="text-hero/90"
      fill="none"
      height="20"
      viewBox="0 0 20 20"
      width="20"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M7.70833 9.58352L9.16667 11.0419L12.2917 7.91683M16.875 9.9271V5.18413C16.875 4.82544 16.6455 4.50699 16.3052 4.39357L10.2635 2.37968C10.0925 2.32266 9.9075 2.32266 9.7365 2.37968L3.69481 4.39357C3.35453 4.50699 3.125 4.82544 3.125 5.18413V9.9271C3.125 14.0709 6.66667 16.0419 10 17.8401C13.3333 16.0419 16.875 14.0709 16.875 9.9271Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.25"
      />
    </svg>
  )
}

function StatusSpinner() {
  return (
    <svg
      className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[14px] h-[12px] animate-spin"
      fill="none"
      height="12"
      style={{ animationDuration: "2s" }}
      viewBox="0 0 14 12"
      width="14"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M2.40381 1.40381C1.80023 2.00739 1.32144 2.72394 0.994783 3.51256C0.668128 4.30117 0.5 5.14641 0.5 6C0.5 6.85359 0.668127 7.69883 0.994783 8.48744C1.32144 9.27606 1.80023 9.99261 2.40381 10.5962"
        stroke="var(--color-hero)"
        strokeOpacity="0.12"
      />
      <path
        d="M11.5962 1.40381C12.1998 2.00739 12.6786 2.72394 13.0052 3.51256C13.3319 4.30117 13.5 5.14641 13.5 6C13.5 6.85359 13.3319 7.69883 13.0052 8.48744C12.6786 9.27606 12.1998 9.99261 11.5962 10.5962"
        stroke="var(--color-hero)"
        strokeOpacity="0.12"
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
      { href: "/#pricing", label: "Pricing" },
      { href: "/docs", label: "Docs", external: true },
      { href: "/docs#faq", label: "Resources" },
      { href: BRANDING.demoUrl, label: "Book a Demo", external: true },
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
    <footer className="relative overflow-x-clip pb-14 max-lg:pt-[188px] lg:pb-[129px] lg:-mt-[130px]">
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
      <div className="relative mx-auto mb-[84px] max-w-[1320px] pt-10 lg:mb-36 lg:pt-[454px]">
        {/* Decorative vertical lines */}
        <div className="footer-cta-line-1 pointer-events-none absolute top-[255px] h-[1096px] w-full max-lg:hidden">
          <div className="absolute top-0 left-0 h-full w-px" />
          <div className="absolute top-0 right-0 h-full w-px" />
        </div>
        <div className="footer-cta-line-2 pointer-events-none absolute -top-[159px] h-[1096px] max-lg:hidden" style={{ width: "1120px", left: "calc(50% - 560px)" }}>
          <div className="absolute top-0 left-0 h-full w-px" />
          <div className="absolute top-0 right-0 h-full w-px" />
        </div>
        <div className="footer-cta-line-3 pointer-events-none absolute top-[228px] h-[593px] max-lg:hidden" style={{ width: "793px", left: "calc(50% - 396.5px)" }}>
          <div className="absolute top-0 left-0 h-full w-px" />
          <div className="absolute top-0 right-0 h-full w-px" />
        </div>

        {/* CTA headline */}
        <Reveal className="relative mx-auto mb-10 max-w-[360px] text-center text-hero-white text-[clamp(2rem,4.5vw,46px)] leading-[1.04] tracking-[-0.46px] font-serif lg:max-w-[500px]" style={{ fontWeight: 400 }}>
          <div className="absolute -top-[35.5px] lg:-top-[82px] left-0 right-0 h-px bg-hero/[0.06]" />
          Be ready for whatever you launch next
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
      <div className="relative mx-auto mb-8 flex max-w-[390px] gap-2 text-[15px] leading-5 max-lg:flex-wrap max-lg:gap-y-10 max-lg:px-[31px] lg:mb-20 lg:max-w-[976px] lg:gap-6">
        {footerSections.map((section) => (
          <div key={section.title} className="flex-1 max-lg:min-w-[40%]">
            <h3 className="mb-6 text-hero/[0.56] lg:mb-4">{section.title}</h3>
            <div className="relative flex flex-col">
              {section.links.map((link) => {
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

      {/* Status pill + line */}
      <div
        className="relative mx-auto mb-10 flex max-w-[390px] items-center max-lg:px-[31px] lg:mb-[72px] lg:max-w-[976px] lg:gap-6"
        style={{ "--color": "var(--color-hero)" } as React.CSSProperties}
      >
        <div className="relative flex gap-1.5 rounded-full p-1.5 pr-4 text-hero/90 text-[15px] leading-5 border border-hero/[0.06]">
          <div className="relative w-5 h-5 flex items-center justify-center">
            <div className="w-1 h-1 rounded-full bg-hero" />
            <StatusSpinner />
          </div>
          <div>All systems normal</div>
        </div>
        <div className="h-px flex-1 lg:bg-hero/[0.06]" />
      </div>

      {/* Compliance row */}
      <div className="relative mx-auto flex max-w-[976px] justify-between text-[15px] leading-5">
        <div className="flex flex-wrap items-center gap-2 max-lg:w-full max-lg:justify-center">
          <div className="text-hero/40 max-lg:w-full max-lg:text-center">
            Yes, of course we&apos;re...
          </div>
          <div className="flex items-center gap-1.5 text-hero/90">
            <div className="flex gap-1">
              <ShieldIcon />
              <div>SOC 2,</div>
            </div>
            <div className="flex gap-1">
              <ShieldIcon />
              <div>GDPR,<span className="text-hero/40"> and</span></div>
            </div>
            <div className="flex gap-1">
              <ShieldIcon />
              <div>HIPAA<span className="text-hero/40"> compliant</span></div>
            </div>
          </div>
        </div>
        <div className="max-lg:hidden" />
      </div>

      {/* Bottom copyright */}
      <div className="relative mx-auto mt-14 lg:mt-24 text-center">
        <p className="text-hero/30 text-sm">
          &copy; {new Date().getFullYear()} {BRANDING.name}. All rights reserved.
        </p>
      </div>
    </footer>
  )
}
