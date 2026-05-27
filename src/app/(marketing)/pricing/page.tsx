import { PricingMarketingSection } from "@/components/marketing/pricing"

export default function PricingPage() {
  return (
    <div className="relative">
      {/* Soft brand glow behind the hero, fading into the page background. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[480px] opacity-60"
        style={{
          background:
            "radial-gradient(60% 100% at 50% 0%, color-mix(in srgb, var(--primary) 10%, transparent) 0%, transparent 70%)",
        }}
      />
      <div className="relative">
        <PricingMarketingSection />
      </div>
    </div>
  )
}
