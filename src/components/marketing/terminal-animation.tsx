"use client"

import { useEffect, useState } from "react"
import { CheckCircle2, Activity, Globe, Clock } from "lucide-react"

export function TerminalAnimation() {
  const [progress, setProgress] = useState(0)
  const [deployed, setDeployed] = useState(false)

  useEffect(() => {
    if (progress >= 100) {
      setDeployed(true)
      return
    }

    const timeout = setTimeout(() => {
      setProgress((p) => Math.min(p + Math.random() * 15 + 5, 100))
    }, 300)

    return () => clearTimeout(timeout)
  }, [progress])

  return (
    <div className="relative rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-[var(--shadow-sm)] overflow-hidden p-6 sm:p-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-3 h-3 rounded-full bg-red-400/60" />
        <div className="w-3 h-3 rounded-full bg-yellow-400/60" />
        <div className="w-3 h-3 rounded-full bg-green-400/60" />
        <span className="ml-2 text-sm text-[var(--text-secondary)]">
          Agent Deployment
        </span>
      </div>

      {/* Status Card */}
      <div className="space-y-5">
        {/* Progress */}
        <div>
          <div className="flex justify-between text-sm mb-2">
            <span className="text-[var(--text-primary)]">Deploying agent...</span>
            <span className="text-[var(--text-secondary)]">{Math.round(progress)}%</span>
          </div>
          <div className="w-full h-2 rounded-full bg-[var(--bg-secondary)] overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Status indicators */}
        <div className="space-y-3">
          <StatusRow done={progress > 20} label="Runtime initialized" />
          <StatusRow done={progress > 40} label="Model loaded" />
          <StatusRow done={progress > 60} label="Vector store connected" />
          <StatusRow done={progress > 80} label="Endpoint configured" />
          <StatusRow done={deployed} label="Agent deployed successfully" highlight />
        </div>

        {/* Metrics */}
        {deployed && (
          <div className="grid grid-cols-3 gap-3 pt-4 border-t border-[var(--border-color)]">
            <MetricCard icon={<Clock className="w-4 h-4" />} label="Latency" value="42ms" />
            <MetricCard icon={<Activity className="w-4 h-4" />} label="Uptime" value="99.99%" />
            <MetricCard icon={<Globe className="w-4 h-4" />} label="Region" value="US-East" />
          </div>
        )}
      </div>
    </div>
  )
}

function StatusRow({ done, label, highlight }: { done: boolean; label: string; highlight?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <CheckCircle2
        className={`w-5 h-5 shrink-0 transition-colors duration-300 ${
          done
            ? highlight
              ? "text-primary"
              : "text-green-500"
            : "text-[var(--text-secondary)]/30"
        }`}
      />
      <span
        className={`text-sm transition-colors duration-300 ${
          done
            ? highlight
              ? "text-primary font-semibold"
              : "text-[var(--text-primary)]"
            : "text-[var(--text-secondary)]"
        }`}
      >
        {label}
      </span>
    </div>
  )
}

function MetricCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[var(--bg-secondary)] p-3 text-center">
      <div className="flex justify-center text-primary mb-1">{icon}</div>
      <div className="text-xs text-[var(--text-secondary)]">{label}</div>
      <div className="text-sm font-semibold text-[var(--text-primary)]">{value}</div>
    </div>
  )
}
