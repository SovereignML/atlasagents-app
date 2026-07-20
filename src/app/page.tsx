"use client"

import Image from "next/image"
import Link from "next/link"
import { motion, MotionConfig } from "framer-motion"
import Navbar from "@/components/layout/navbar"
import Footer from "@/components/layout/footer"
import { SmoothScrollProvider } from "@/components/marketing/motion/smooth-scroll-provider"
import { AgentWheel } from "@/components/marketing/sections/agent-wheel"
import { MissionControlPlanner } from "@/components/marketing/sections/mission-control-planner"
import { CapabilityTimeline } from "@/components/marketing/sections/capability-timeline"
import { Features } from "@/components/ui/features-8"
// Testimonials section is disabled until real customer quotes exist (see page body).
// import { Testimonials } from "@/components/marketing/sections/testimonials"
import { CompetitorComparison } from "@/components/marketing/sections/competitor-comparison"
import { AgentConfigurator } from "@/components/marketing/sections/agent-configurator"
import { PricingElevation } from "@/components/marketing/sections/pricing-elevation"
import { KnowledgeBaseFAQ } from "@/components/marketing/sections/knowledge-base-faq"
import { ConvergenceCTA } from "@/components/marketing/sections/convergence-cta"
import { IntegrationConstellation } from "@/components/marketing/sections/integration-constellation"
// import { BackedBy } from "@/components/marketing/sections/backed-by"

const lineRevealTransition = (delay: number) => ({
  duration: 0.6,
  ease: [0.16, 1, 0.3, 1] as const,
  delay,
})

function HeroGridLines() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {/* Outer pair — full height */}
      <motion.div
        className="absolute top-0 left-[15%] h-full w-px"
        style={{ transformOrigin: "top", background: "linear-gradient(to bottom, rgba(219,247,255,0.04) 75%, transparent)" }}
        initial={{ scaleY: 0 }}
        animate={{ scaleY: 1 }}
        transition={lineRevealTransition(0.5)}
      />
      <motion.div
        className="absolute top-0 right-[15%] h-full w-px"
        style={{ transformOrigin: "top", background: "linear-gradient(to bottom, rgba(219,247,255,0.04) 75%, transparent)" }}
        initial={{ scaleY: 0 }}
        animate={{ scaleY: 1 }}
        transition={lineRevealTransition(0.5)}
      />

      {/* Middle pair */}
      <motion.div
        className="absolute top-0 left-[28%] h-[85%] w-px"
        style={{ transformOrigin: "top", background: "linear-gradient(to bottom, rgba(219,247,255,0.04) 75%, transparent)" }}
        initial={{ scaleY: 0 }}
        animate={{ scaleY: 1 }}
        transition={lineRevealTransition(0.4)}
      />
      <motion.div
        className="absolute top-0 right-[28%] h-[85%] w-px"
        style={{ transformOrigin: "top", background: "linear-gradient(to bottom, rgba(219,247,255,0.04) 75%, transparent)" }}
        initial={{ scaleY: 0 }}
        animate={{ scaleY: 1 }}
        transition={lineRevealTransition(0.4)}
      />

      {/* Inner pair */}
      <motion.div
        className="absolute top-[7%] left-[37%] h-[70%] w-px"
        style={{ transformOrigin: "top", background: "linear-gradient(to bottom, rgba(219,247,255,0.04) 60%, transparent 90%)" }}
        initial={{ scaleY: 0 }}
        animate={{ scaleY: 1 }}
        transition={lineRevealTransition(0.2)}
      />
      <motion.div
        className="absolute top-[7%] right-[37%] h-[70%] w-px"
        style={{ transformOrigin: "top", background: "linear-gradient(to bottom, rgba(219,247,255,0.04) 60%, transparent 90%)" }}
        initial={{ scaleY: 0 }}
        animate={{ scaleY: 1 }}
        transition={lineRevealTransition(0.2)}
      />

      {/* Innermost pair */}
      <motion.div
        className="absolute top-[14%] left-[44%] h-[60%] w-px"
        style={{ transformOrigin: "top", background: "linear-gradient(to bottom, rgba(219,247,255,0.04) 75%, transparent 90%)" }}
        initial={{ scaleY: 0 }}
        animate={{ scaleY: 1 }}
        transition={lineRevealTransition(0.3)}
      />
      <motion.div
        className="absolute top-[14%] right-[44%] h-[60%] w-px"
        style={{ transformOrigin: "top", background: "linear-gradient(to bottom, rgba(219,247,255,0.04) 75%, transparent 90%)" }}
        initial={{ scaleY: 0 }}
        animate={{ scaleY: 1 }}
        transition={lineRevealTransition(0.3)}
      />

      {/* Horizontal cross lines */}
      <motion.div
        className="absolute left-0 right-0 top-[50%] h-px bg-hero/[0.04]"
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={lineRevealTransition(0.4)}
      />
      <motion.div
        className="absolute left-[15%] right-[15%] top-[20%] h-px bg-hero/[0.04]"
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={lineRevealTransition(0.1)}
      />
    </div>
  )
}

const heroContentVariants = {
  hidden: { opacity: 0, y: 48, filter: "blur(4px)" },
  show: { opacity: 1, y: 0, filter: "blur(0px)" },
}

export default function Home() {
  return (
    <MotionConfig reducedMotion="user">
    <SmoothScrollProvider>
      <Navbar />
      <main className="relative overflow-x-clip min-h-screen">
        {/* ─── Hero background gradient (exact AntiMetal) ─── */}
        <div className="home-hero-background-gradient absolute top-0 left-0 h-[1600px] w-full lg:h-[2070px]">
          <div className="absolute top-[500px] left-1/2 -translate-x-1/2 w-[3088px] h-[960px] pointer-events-none dark:hidden">
            <div className="absolute top-0 left-0 h-[960px] w-[1440px]">
              <Image
                alt=""
                aria-hidden
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 max-w-none"
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
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 max-w-none"
                width={1884}
                height={1124}
                loading="lazy"
                src="/assets/footer/background-transition.avif"
              />
            </div>
          </div>
        </div>

        {/* ─── HERO ─── */}
        <section className="relative w-full min-h-screen flex items-center justify-center overflow-hidden pt-24">
          <HeroGridLines />

          <motion.div
            className="relative z-10 text-center flex flex-col items-center px-4 mt-10"
            initial="hidden"
            animate="show"
            transition={{ staggerChildren: 0.1, delayChildren: 0.4 }}
          >
            <motion.div
              variants={heroContentVariants}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-hero/[0.06] bg-hero/[0.04] mb-6"
              style={{
                boxShadow: "inset 0 0.5px 0.5px color-mix(in srgb, var(--color-hero) 24%, transparent), inset 0 -0.5px 0.5px color-mix(in srgb, var(--color-hero) 24%, transparent)",
              }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-signal animate-[pulse-glow_2s_ease-in-out_infinite]" />
              <span className="text-xs font-medium text-hero-white">New: Multi-Agent Orchestration</span>
            </motion.div>

            <motion.h1
              variants={heroContentVariants}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              className="m-0 leading-[1.04] tracking-[-0.46px] font-serif"
              style={{ fontWeight: 400 }}
            >
              <span className="block text-[clamp(2rem,5vw,46px)] text-hero-white">
                Deploy AI agents that
              </span>
              <span className="block text-[clamp(2rem,5vw,46px)] text-hero-white">
                actually work.
              </span>
            </motion.h1>

            <motion.p
              variants={heroContentVariants}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              className="text-[20px] leading-[26px] tracking-[-0.1px] text-hero-white/80 max-w-[526px] mt-7 mx-auto"
            >
              Pick a runtime, OpenClaw or Hermes, then customize your agent and
              put support, sales, and ops on autopilot. Zero vendor lock-in; your
              own private instance!
            </motion.p>

            <motion.div
              variants={heroContentVariants}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              className="mt-8"
            >
              <Link href="/login?deploy=true"
                className="btn-green text-base"
              >
                Deploy Your First Agent
              </Link>
            </motion.div>

            {/* Vision line — frames the long-term thesis, not a shipped feature. */}
            <motion.p
              variants={heroContentVariants}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              className="mt-8 max-w-[460px] text-xs leading-5 text-hero-white/40"
            >
              We&apos;re building toward agentic AI models trained on the
              real-world work our platform runs every day.
            </motion.p>
          </motion.div>

        </section>

        {/* ─── Living System Sections ─── */}
        <AgentWheel />
        <MissionControlPlanner />
        <CapabilityTimeline />
        <Features />
        {/* <AgentConfigurator /> hidden for now */}
        {/* Integration constellation — central hub orb + tool grid */}
        <IntegrationConstellation />
        {/* Testimonials hidden until real, permissioned customer quotes are
            available — the current entries are illustrative placeholders. */}
        {/* <Testimonials /> */}
        <CompetitorComparison />
        <ConvergenceCTA />
        {/* Trust strip — enable once program memberships + official logos are
            confirmed (see backed-by.tsx). Intentionally left un-rendered. */}
        {/* <BackedBy /> */}
        <PricingElevation />
        {/* Ecosystem/infrastructure strip intentionally not rendered — the product
            does not surface the underlying cloud providers. See logo-cloud-section.tsx */}
        <KnowledgeBaseFAQ />
      </main>
      <Footer />
    </SmoothScrollProvider>
    </MotionConfig>
  )
}
