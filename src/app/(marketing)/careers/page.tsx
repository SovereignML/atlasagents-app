import type { Metadata } from "next"
import { ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Reveal, RevealGroup, RevealItem } from "@/components/marketing/motion/reveal"
import { spring } from "@/lib/motion"
import { BRANDING } from "@/configs/branding"

export const metadata: Metadata = {
  title: "Careers",
  description:
    "Help us build the platform that lets anyone deploy agentic AI — no code required.",
}

const values = [
  {
    title: "Agents do the busywork",
    desc: `We run our own product. Support, ops, and monitoring are handled by ${BRANDING.name} agents, so the team works on the hard problems.`,
  },
  {
    title: "Independence by default",
    desc: "Private instances, isolated data, no provider lock-in. We build the way we'd want our own infrastructure run.",
  },
  {
    title: "Small team, real ownership",
    desc: "Everyone ships end to end. If you join, you own a surface of the product — not a ticket queue.",
  },
]

export default function CareersPage() {
  return (
    <div className="max-w-[1200px] mx-auto px-8 py-16">
      <Reveal className="border-l-4 border-primary pl-8 mb-16">
        <div className="text-primary text-xs mb-3 opacity-80">
          Careers
        </div>
        <h1 className="text-[clamp(2.5rem,5vw,4rem)] font-bold text-[var(--text-primary)] mb-4">
          Build the agentic future
        </h1>
        <p className="text-[var(--text-secondary)] text-lg max-w-2xl">
          We&apos;re building the platform that lets anyone launch their own AI
          agents — and the models that will power them next.
        </p>
      </Reveal>

      <RevealGroup className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
        {values.map((value) => (
          <RevealItem
            key={value.title}
            whileHover={{ y: -4, transition: spring.snappy }}
            className="rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-[var(--shadow-sm)] p-10 transition-all duration-300 hover:border-primary hover:shadow-[var(--shadow-hover)]"
          >
            <h2 className="text-xl font-bold text-[var(--text-primary)] mb-3">
              {value.title}
            </h2>
            <p className="text-[var(--text-secondary)] text-sm leading-relaxed">
              {value.desc}
            </p>
          </RevealItem>
        ))}
      </RevealGroup>

      {/* {{TODO: list open roles here once hiring opens; until then we invite
          speculative applications via email.}} */}
      <Reveal className="text-center border-t border-[var(--border-color)] pt-12">
        <h2 className="text-2xl font-bold text-[var(--text-primary)] mb-3">
          No open roles right now
        </h2>
        <p className="text-[var(--text-secondary)] text-sm leading-relaxed max-w-xl mx-auto mb-6">
          We&apos;re a small team and hire deliberately. If you think you can
          make {BRANDING.name} better, we want to hear from you anyway — tell us
          what you&apos;d build.
        </p>
        <Button
          variant="gradient"
          size="lg"
          render={<a href={`mailto:${BRANDING.supportEmail}?subject=Careers`} />}
        >
          Get in touch <ArrowRight />
        </Button>
      </Reveal>
    </div>
  )
}
