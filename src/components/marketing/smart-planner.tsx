"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  Zap, Terminal, MessageSquare, Search, PenTool, TrendingUp, Share2, Settings, ArrowRight,
} from "lucide-react"
import Link from "next/link"
import { AGENT_CATEGORIES } from "@/configs/agent-categories"
import { BRANDING } from "@/configs/branding"
import { easing } from "@/lib/motion"

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Zap, Terminal, MessageSquare, Search, PenTool, TrendingUp, Share2, Settings,
}

const USE_CASES = [
  { label: "Handle support tickets", agentSlug: "support" },
  { label: "Monitor infrastructure", agentSlug: "devops" },
  { label: "Generate content", agentSlug: "content" },
  { label: "Qualify leads", agentSlug: "sales" },
  { label: "Research & analyze", agentSlug: "research" },
  { label: "Automate workflows", agentSlug: "automation" },
  { label: "Manage social media", agentSlug: "social" },
  { label: "Build custom", agentSlug: "custom" },
]

export function SmartPlanner() {
  const [selected, setSelected] = useState<string | null>(null)
  const selectedAgent = AGENT_CATEGORIES.find((a) => a.slug === selected)
  const SelectedIcon = selectedAgent ? ICON_MAP[selectedAgent.icon] ?? Zap : null

  return (
    <div className="glass rounded-3xl p-8 md:p-10 relative overflow-hidden">
      <AnimatePresence mode="wait">
        {!selected ? (
          <motion.div
            key="select"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.3, ease: easing.outExpo }}
          >
            <h3 className="text-xl md:text-2xl font-bold text-text-loud mb-2">
              What should your agent do?
            </h3>
            <p className="text-sm text-text-secondary mb-6">
              Select a task. We configure the rest.
            </p>

            <div className="flex flex-wrap gap-2">
              {USE_CASES.map((uc) => (
                <button
                  key={uc.agentSlug}
                  onClick={() => setSelected(uc.agentSlug)}
                  className="px-4 py-2 text-sm rounded-full border border-border-ghost bg-transparent text-text-secondary hover:border-accent-blue-rest hover:text-accent-blue-rest hover:bg-accent-blue-rest/5 transition-all duration-200 cursor-pointer"
                >
                  {uc.label}
                </button>
              ))}
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="result"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease: easing.outExpo }}
          >
            <div className="flex items-center justify-between mb-6">
              <button
                onClick={() => setSelected(null)}
                className="text-xs text-text-muted hover:text-accent-blue-rest transition-colors cursor-pointer"
              >
                &larr; back
              </button>
            </div>

            {selectedAgent && SelectedIcon && (
              <div className="flex flex-col md:flex-row gap-8">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-xl bg-accent-blue-rest/10 flex items-center justify-center">
                      <SelectedIcon className="w-5 h-5 text-accent-blue-rest" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-text-loud">{selectedAgent.name}</h3>
                      <p className="text-xs text-text-muted">Recommended agent</p>
                    </div>
                  </div>
                  <p className="text-sm text-text-secondary leading-relaxed mb-6">
                    {selectedAgent.description}
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <Link
                      href="/login?deploy=true"
                      className="inline-flex items-center gap-2 btn-gradient text-sm px-6 py-3"
                    >
                      Deploy Now <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                    <a
                      href={BRANDING.demoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 text-sm px-6 py-3 rounded-full border border-border-ghost text-text-loud hover:border-accent-blue-rest transition-colors"
                    >
                      Talk to an expert
                    </a>
                  </div>
                </div>

                {/* Config preview */}
                <div className="md:w-[280px] shrink-0">
                  <div className="rounded-xl bg-[var(--code-bg)] border border-border-muted p-4 font-mono text-xs">
                    <div className="text-text-muted mb-2">config.yml</div>
                    <div className="text-accent-blue-rest">agent: {selectedAgent.slug}</div>
                    <div className="text-text-loud">compute: auto-scaled</div>
                    <div className="text-text-loud">monitoring: enabled</div>
                    <div className="text-text-loud">privacy: strict</div>
                    <div className="text-text-loud">region: auto</div>
                    <span className="inline-block w-1.5 h-3 bg-accent-blue-rest animate-[type-cursor_1s_step-end_infinite] ml-0.5" />
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
