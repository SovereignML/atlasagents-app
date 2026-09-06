import type { Metadata } from "next"
import TeamShowcase from "@/components/ui/team-showcase"
import { BRANDING } from "@/configs/branding"

export const metadata: Metadata = {
  title: "Team",
  description: `Meet the team behind ${BRANDING.name}.`,
}

export default function TeamPage() {
  return (
    <div className="max-w-[1200px] mx-auto px-8 py-16">
      <div className="border-l-4 border-primary pl-8 mb-16">
        <div className="text-primary text-xs mb-3 opacity-80">Team</div>
        <h1 className="text-[clamp(2.5rem,5vw,4rem)] font-bold text-[var(--text-primary)] mb-4">
          Meet the Team
        </h1>
        <p className="text-[var(--text-secondary)] text-lg max-w-2xl">
          The people building {BRANDING.name}.
        </p>
      </div>

      <TeamShowcase />
    </div>
  )
}
