"use client"

import Link from "next/link"
import { useEffect, useRef } from "react"
import Navbar from "@/components/layout/navbar"
import Footer from "@/components/layout/footer"
import { PlaygroundWidget } from "@/components/marketing/playground-widget"
import { SmoothScrollProvider } from "@/components/marketing/motion/smooth-scroll-provider"
import { TrustedNetwork } from "@/components/marketing/sections/trusted-network"
import { AgentDecisionGraph } from "@/components/marketing/sections/agent-decision-graph"
import { MissionControlPlanner } from "@/components/marketing/sections/mission-control-planner"
import { CapabilityTimeline } from "@/components/marketing/sections/capability-timeline"
import { CaseStudyCarousel } from "@/components/marketing/sections/case-study-carousel"
import { AgentConfigurator } from "@/components/marketing/sections/agent-configurator"
import { PricingElevation } from "@/components/marketing/sections/pricing-elevation"

import { KnowledgeBaseFAQ } from "@/components/marketing/sections/knowledge-base-faq"
import { ConvergenceCTA } from "@/components/marketing/sections/convergence-cta"

/* ─── Hero Section: Floating Avatars ─── */
function FloatingAvatars() {
  const avatarRefs = useRef<(HTMLImageElement | null)[]>([])

  useEffect(() => {
    avatarRefs.current.forEach((avatar, index) => {
      if (!avatar) return
      avatar.animate(
        [
          { transform: index === 2 ? "translateX(-50%) translateY(0px)" : "translateY(0px)" },
          { transform: index === 2 ? `translateX(-50%) translateY(${-8 - (index % 3) * 4}px)` : `translateY(${-8 - (index % 3) * 4}px)` },
          { transform: index === 2 ? "translateX(-50%) translateY(0px)" : "translateY(0px)" },
        ],
        {
          duration: 3500 + index * 600,
          iterations: Infinity,
          easing: "ease-in-out",
        }
      )
    })
  }, [])

  const avatarPositions = [
    "top-[38%] left-[calc(50%-350px)]",
    "top-[24%] left-[calc(50%-220px)]",
    "top-[18%] left-[50%] -translate-x-1/2",
    "top-[26%] left-[calc(50%+180px)]",
    "top-[40%] left-[calc(50%+320px)]",
  ]

  const seeds = ["Sophie", "Luna", "Milo", "Aneka", "Felix"]
  const colors = ["d4e157", "ce93d8", "81c784", "80deea", "aed581"]

  return (
    <>
      {seeds.map((seed, i) => (
        <img
          key={seed}
          ref={(el) => { avatarRefs.current[i] = el }}
          src={`https://api.dicebear.com/9.x/bottts/svg?seed=${seed}&backgroundColor=${colors[i]}`}
          alt={`Avatar ${i + 1}`}
          className={`absolute w-[54px] h-[54px] rounded-full shadow-[0_8px_16px_rgba(0,0,0,0.08)] border-2 border-white/60 bg-white ${avatarPositions[i]}`}
        />
      ))}
    </>
  )
}

/* ─── Hero Section: Background Blurs ─── */
function HeroBlurs() {
  const blurBotRef = useRef<HTMLDivElement>(null)
  const blurWaveRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (blurBotRef.current) {
      blurBotRef.current.animate(
        [
          { transform: "rotate(-15deg) translateY(0px)" },
          { transform: "rotate(-12deg) translateY(-10px)" },
          { transform: "rotate(-15deg) translateY(0px)" },
        ],
        { duration: 6000, iterations: Infinity, easing: "ease-in-out" }
      )
    }
    if (blurWaveRef.current) {
      blurWaveRef.current.animate(
        [
          { transform: "translateY(0px) scale(1)" },
          { transform: "translateY(-15px) scale(1.05)" },
          { transform: "translateY(0px) scale(1)" },
        ],
        { duration: 7000, iterations: Infinity, easing: "ease-in-out" }
      )
    }
  }, [])

  return (
    <>
      <div
        ref={blurBotRef}
        className="absolute top-[50%] left-[calc(50%-400px)] w-[110px] h-[110px] blur-[5px] -rotate-[15deg] opacity-85 pointer-events-none"
      >
        <svg width="100%" height="100%" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
          <path d="M5 40 v20 a10 10 0 0 0 10 10 h10 v-40 h-10 a10 10 0 0 0 -10 10 z" fill="#cbd5e1" />
          <path d="M95 40 v20 a10 10 0 0 1 -10 10 h-10 v-40 h10 a10 10 0 0 1 10 10 z" fill="#cbd5e1" />
          <rect x="20" y="25" width="60" height="50" rx="15" fill="#f8fafc" />
          <rect x="30" y="35" width="40" height="30" rx="8" fill="#1e293b" />
          <circle cx="42" cy="50" r="4.5" fill="#f8fafc" />
          <circle cx="58" cy="50" r="4.5" fill="#f8fafc" />
        </svg>
      </div>
      <svg
        ref={blurWaveRef}
        className="absolute top-[45%] right-[calc(50%-400px)] w-[180px] h-[120px] blur-[12px] opacity-70 pointer-events-none"
        viewBox="0 0 100 100"
      >
        <path d="M 0 80 Q 20 20 40 50 T 80 10 T 100 40" stroke="#bae6fd" strokeWidth="12" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </>
  )
}

export default function Home() {
  return (
    <SmoothScrollProvider>
      <Navbar />
      <main className="relative z-10 min-h-screen">
        {/* ─── HERO (unchanged) ─── */}
        <section className="w-full min-h-screen flex items-center justify-center relative overflow-hidden pt-24 bg-gradient-to-b from-[var(--bg-color)] via-[var(--bg-color)] to-[var(--bg-secondary)]">
          <div className="absolute inset-0 pointer-events-none opacity-[0.04] bg-grid-lines" />
          <HeroBlurs />
          <FloatingAvatars />

          <div className="relative z-10 text-center flex flex-col items-center px-4 mt-10">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-[var(--accent-color)]/20 bg-[var(--accent-color)]/10 mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-color)] animate-[pulse-glow_2s_ease-in-out_infinite]" />
              <span className="text-xs font-medium text-[var(--accent-color)]">New — Multi-Agent Orchestration</span>
            </div>
            <h1 className="m-0 leading-[1.1] tracking-[-1.5px]">
              <span className="relative inline-block text-[clamp(2.5rem,5vw,68px)] font-bold text-[var(--text-primary)]">
                Run your
                <svg className="absolute -bottom-[22px] -left-[5px] w-[320px] h-[40px] -z-10 pointer-events-none" viewBox="0 0 320 40">
                  <path d="M 5 15 Q 155 5 310 22" stroke="#7eb943" strokeWidth="4" fill="none" strokeLinecap="round" />
                  <path d="M 30 25 Q 160 15 290 28" stroke="#5d962a" strokeWidth="2.5" fill="none" strokeLinecap="round" />
                </svg>
              </span>
              <br />
              <span className="relative inline-block text-[clamp(2.5rem,5vw,68px)] font-bold text-[var(--text-primary)]">
              Own AI Agents
              </span>
            </h1>

            <p className="text-lg text-[var(--text-secondary)] max-w-[600px] leading-relaxed mt-7 mx-auto">
              Deploy AI agents for support, sales, and operations in minutes.<br />
              No coding required. You own your data. Cancel anytime.
            </p>

            <div className="mt-8">
              <Link href="/login?deploy=true" className="btn-gradient">
                <span className="flex items-center justify-center">
                  <svg width="24" height="24" viewBox="0 0 24 24">
                    <path d="M1 10 v4 a2 2 0 0 0 2 2 h1 v-8 h-1 a2 2 0 0 0 -2 2 z" fill="#8bc34a" />
                    <path d="M23 10 v4 a2 2 0 0 1 -2 2 h-1 v-8 h1 a2 2 0 0 1 2 2 z" fill="#8bc34a" />
                    <rect x="4" y="5" width="16" height="14" rx="4" fill="#f0f0f0" />
                    <rect x="6" y="7" width="12" height="10" rx="2" fill="#1c1c1c" />
                    <circle cx="9" cy="12" r="1.5" fill="#8bc34a" />
                    <circle cx="15" cy="12" r="1.5" fill="#8bc34a" />
                  </svg>
                </span>
                Get Started Free
              </Link>
            </div>

            <p className="mt-4 text-sm text-[var(--text-muted)]">
              Free plan available &middot; No credit card required
            </p>
          </div>

          <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-[var(--bg-secondary)] to-transparent pointer-events-none" />
        </section>

        {/* ─── Living System Sections ─── */}
        <TrustedNetwork />
        <AgentDecisionGraph />
        <MissionControlPlanner />
        <CapabilityTimeline />
        <CaseStudyCarousel />
        <AgentConfigurator />
        <PricingElevation />
        <KnowledgeBaseFAQ />
        <ConvergenceCTA />
      </main>
      <Footer />
      <PlaygroundWidget />
    </SmoothScrollProvider>
  )
}
