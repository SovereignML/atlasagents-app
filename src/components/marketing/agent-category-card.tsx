"use client"

import {
  Zap,
  Terminal,
  MessageSquare,
  Search,
  PenTool,
  TrendingUp,
  Share2,
  Settings,
} from "lucide-react"
import type { AgentCategory } from "@/configs/agent-categories"

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Zap,
  Terminal,
  MessageSquare,
  Search,
  PenTool,
  TrendingUp,
  Share2,
  Settings,
}

export function AgentCategoryCard({ category }: { category: AgentCategory }) {
  const Icon = ICON_MAP[category.icon] ?? Zap

  return (
    <div
      className="group relative rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg-translucent)] p-6 transition-all duration-300 hover:border-primary hover:bg-[var(--card-hover-translucent)] hover:-translate-y-1 shadow-[var(--shadow-sm)] hover:shadow-[0_10px_30px_var(--card-shadow)] cursor-pointer"
    >
      <Icon className="w-8 h-8 text-primary opacity-80 mb-4" />

      <h3 className="text-xl font-bold text-[var(--text-primary)] mb-2">
        {category.name}
      </h3>

      <p className="text-[var(--text-secondary)] text-sm leading-relaxed mb-4">
        {category.description}
      </p>

      <ul className="space-y-1">
        {category.examples.map((ex) => (
          <li
            key={ex}
            className="text-[0.75rem] text-[var(--text-secondary)] before:content-['>'] before:text-primary before:mr-2"
          >
            {ex}
          </li>
        ))}
      </ul>
    </div>
  )
}
