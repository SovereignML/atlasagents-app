"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { REGIONS, type RegionConfig } from "@/configs/regions"
import { SERVER_TYPES, type ServerTypeConfig } from "@/configs/server-types"
import { DEPLOYABLE_PLANS, PLANS, type PlanConfig } from "@/configs/plans"
import { calcPlanPrice, formatUsd } from "@/lib/pricing"
import type { BillingInterval } from "@/lib/pricing"
import { AGENT_CATEGORIES } from "@/configs/agent-categories"
import { BRANDING } from "@/configs/branding"

type Interface = "web" | "telegram" | "discord" | "api"
type DeploymentTarget = "vps" | "shared" | "serverless"

type AgentConfig = {
  use_case: string
  target_user: string
  core_actions: string[]
  tone: string
  interface: Interface
  deployment_target: DeploymentTarget
  knowledge_source: string
  budget_tier: string
}

const INTERFACES: { value: Interface; label: string; hint: string; enabled: boolean }[] = [
  { value: "web", label: "Web Chat", hint: "Embeddable widget on your site", enabled: true },
  { value: "telegram", label: "Telegram", hint: "Bot under your Telegram handle", enabled: false },
  { value: "discord", label: "Discord", hint: "Invite to your server", enabled: false },
  { value: "api", label: "REST API", hint: "Programmatic access only", enabled: false },
]

const DEPLOYMENT_TARGETS: { value: DeploymentTarget; label: string; hint: string; enabled: boolean }[] = [
  { value: "vps", label: "Dedicated VPS", hint: "Single-tenant, single instance, isolated", enabled: true },
  { value: "shared", label: "Shared Cluster", hint: "Multi-tenant pool, cheapest, autoscaled", enabled: false },
  { value: "serverless", label: "Serverless (Managed)", hint: "We run it — pay per request only", enabled: false },
]

type Step = "project" | "interface" | "plan" | "advanced" | "billing"
const ALL_STEPS: Step[] = ["project", "interface", "plan", "advanced", "billing"]

function deploymentSlug(raw: string) {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

const STEP_LABELS: Record<Step, string> = {
  project: "Project",
  interface: "Interface",
  plan: "Plan",
  advanced: "Advanced",
  billing: "Billing",
}

function resolveServerForPlan(plan: PlanConfig): ServerTypeConfig | null {
  if (!plan.serverConfigSlug) return null
  return SERVER_TYPES.find((s) => s.slug === plan.serverConfigSlug) ?? null
}

export default function DeployPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>("project")
  const [deploying, setDeploying] = useState(false)

  // Project + agent intake (merged)
  const [projectName, setProjectName] = useState("")
  const [useCase, setUseCase] = useState<string>("")
  const [interfaceKind, setInterfaceKind] = useState<Interface>("web")
  const [deploymentTarget] = useState<DeploymentTarget>("vps")

  const [selectedRegion, setSelectedRegion] = useState<RegionConfig | null>(null)
  const [billingInterval, setBillingInterval] = useState<BillingInterval>("month")
  const [selectedPlan, setSelectedPlan] = useState<PlanConfig | null>(null)
  const [rootPassword, setRootPassword] = useState("")
  const [sshKey, setSshKey] = useState("")

  const selectedServer = selectedPlan ? resolveServerForPlan(selectedPlan) : null

  const STEPS = ALL_STEPS
  const stepIdx = STEPS.indexOf(step)
  const selectedCategoryObj = AGENT_CATEGORIES.find((c) => c.slug === useCase)

  const coreActions = selectedCategoryObj?.examples ? [...selectedCategoryObj.examples] : []

  const canNext = (() => {
    switch (step) {
      case "project":
        return projectName.trim().length >= 2 && !!useCase
      case "interface":
        return !!interfaceKind && !!deploymentTarget && !!selectedRegion
      case "plan":
        return !!selectedPlan
      case "advanced":
        return true
      case "billing":
        return true
    }
  })()

  function next() {
    if (stepIdx < STEPS.length - 1) setStep(STEPS[stepIdx + 1])
  }
  function prev() {
    if (stepIdx > 0) setStep(STEPS[stepIdx - 1])
  }

  const planPrice = selectedPlan
    ? calcPlanPrice(selectedPlan, billingInterval)
    : null

  async function handleDeploy() {
    if (!projectName.trim() || !selectedPlan || !selectedRegion) return
    setDeploying(true)
    try {
      const res = await fetch("/api/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: projectName.trim(),
          planSlug: selectedPlan.slug,
          regionSlug: selectedRegion.slug,
          billingInterval,
          rootPassword: rootPassword || undefined,
          sshPublicKey: sshKey || undefined,
          agentConfig: {
            use_case: useCase,
            target_user: "",
            core_actions: coreActions,
            tone: "friendly",
            interface: interfaceKind,
            deployment_target: deploymentTarget,
            knowledge_source: "none",
            budget_tier: "mid",
          } satisfies AgentConfig,
          interfaceBinding: { kind: interfaceKind, mode: "immediate" },
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || "Deployment failed")
        return
      }
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl
      } else {
        toast.success("Instance created! Redirecting...")
        router.push(`/dashboard/instances/${data.instanceId}`)
      }
    } catch {
      toast.error("Something went wrong")
    } finally {
      setDeploying(false)
    }
  }

  const slugPreview = deploymentSlug(projectName)

  const enterprisePlan = PLANS.find((p) => p.tier === "enterprise")

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Deploy AI Agent</h1>
        <p className="text-[var(--text-secondary)] mt-1">Configure and launch your AI agent infrastructure.</p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-1 overflow-x-auto pb-2">
        {STEPS.map((s, i) => (
          <button
            key={s}
            onClick={() => i <= stepIdx && setStep(s)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm whitespace-nowrap transition-all duration-200 ${
              s === step
                ? "bg-[var(--accent-dim)] text-[var(--accent-color)] font-medium border border-[var(--accent-color)]/30"
                : i < stepIdx
                ? "text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                : "text-[var(--text-secondary)]/50 cursor-default"
            }`}
          >
            <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
              s === step
                ? "bg-[var(--accent-color)] text-black"
                : i < stepIdx
                ? "bg-emerald-600 text-[var(--text-primary)]"
                : "bg-[var(--card-bg)] text-[var(--text-secondary)]"
            }`}>
              {i < stepIdx ? "\u2713" : i + 1}
            </span>
            {STEP_LABELS[s]}
          </button>
        ))}
      </div>

      {/* Step content */}
      <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] p-6 md:p-8">
        {/* STEP: Project (name + use case + target user + tone + templates) */}
        {step === "project" && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-1">Project</h2>
              <p className="text-sm text-[var(--text-secondary)]">Name your agent and pick a use case.</p>
            </div>

            <div>
              <label className="block text-xs uppercase tracking-wide text-[var(--text-secondary)] mb-2">Project Name</label>
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="my-ai-agent"
                className="w-full bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl px-4 py-3 text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/50 focus:outline-none focus:border-blue-500/50 transition-colors"
              />
              {projectName.trim().length > 0 && (
                <p className="text-[11px] font-mono text-[var(--text-secondary)] mt-2">
                  slug: {slugPreview || "—"}
                </p>
              )}
              {projectName.trim().length > 0 && projectName.trim().length < 2 && (
                <p className="text-xs text-amber-400/90 mt-1">
                  Enter at least 2 characters to continue.
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs uppercase tracking-wide text-[var(--text-secondary)] mb-2">Use Case</label>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {AGENT_CATEGORIES.map((cat) => (
                  <button
                    key={cat.slug}
                    onClick={() => setUseCase(cat.slug)}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      useCase === cat.slug
                        ? "border-[var(--accent-color)] bg-[var(--accent-dim)]"
                        : "border-[var(--border-color)] bg-[var(--card-bg)] hover:border-[var(--accent-color)]"
                    }`}
                  >
                    <p className="text-[var(--text-primary)] font-medium text-sm">{cat.name}</p>
                    <p className="text-[var(--text-secondary)] text-xs mt-1 line-clamp-2">{cat.description}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* STEP: Interface (interface + deployment target + location) */}
        {step === "interface" && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-1">Interface & Deployment</h2>
              <p className="text-sm text-[var(--text-secondary)]">
                Choose where users reach the bot, how it runs, and where it lives.
              </p>
            </div>

            <div>
              <label className="block text-xs uppercase tracking-wide text-[var(--text-secondary)] mb-2">Interface · where users reach the bot</label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {INTERFACES.map((i) => (
                  <button
                    key={i.value}
                    disabled={!i.enabled}
                    onClick={() => i.enabled && setInterfaceKind(i.value)}
                    className={`w-full p-3 rounded-xl border text-left transition-all ${
                      !i.enabled
                        ? "border-[var(--border-color)]/50 bg-[var(--card-bg)]/50 opacity-50 cursor-not-allowed"
                        : interfaceKind === i.value
                        ? "border-[var(--accent-color)] bg-[var(--accent-dim)]"
                        : "border-[var(--border-color)] bg-[var(--card-bg)] hover:border-[var(--accent-color)]"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-[var(--text-primary)] text-sm font-medium">{i.label}</p>
                      {!i.enabled && (
                        <span className="text-[10px] text-[var(--text-secondary)]/60 border border-zinc-700 rounded-full px-1.5 py-0.5">Coming soon</span>
                      )}
                    </div>
                    <p className="text-[var(--text-secondary)] text-xs">{i.hint}</p>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs uppercase tracking-wide text-[var(--text-secondary)] mb-2">Deployment Target · how the bot runs</label>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                {DEPLOYMENT_TARGETS.map((d) => (
                  <button
                    key={d.value}
                    disabled={!d.enabled}
                    onClick={() => {}}
                    className={`w-full p-3 rounded-xl border text-left transition-all ${
                      !d.enabled
                        ? "border-[var(--border-color)]/50 bg-[var(--card-bg)]/50 opacity-50 cursor-not-allowed"
                        : deploymentTarget === d.value
                        ? "border-[var(--accent-color)] bg-[var(--accent-dim)]"
                        : "border-[var(--border-color)] bg-[var(--card-bg)] hover:border-[var(--accent-color)]"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-[var(--text-primary)] text-sm font-medium">{d.label}</p>
                      {!d.enabled && (
                        <span className="text-[10px] text-[var(--text-secondary)]/60 border border-zinc-700 rounded-full px-1.5 py-0.5">Coming soon</span>
                      )}
                    </div>
                    <p className="text-[var(--text-secondary)] text-xs">{d.hint}</p>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs uppercase tracking-wide text-[var(--text-secondary)] mb-2">Location · server region</label>
              <div className="flex items-center justify-between border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-2.5 rounded-xl mb-3">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[var(--accent-color)] animate-pulse" />
                  <p className="text-xs font-mono text-[var(--text-primary)]">All regions operational</p>
                </div>
                <p className="text-[10px] font-mono text-[var(--text-secondary)]/70">live</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {REGIONS.map((r) => (
                  <button
                    key={r.slug}
                    disabled={!r.available}
                    onClick={() => setSelectedRegion(r)}
                    className={`flex items-center gap-4 p-4 rounded-xl border transition-all text-left ${
                      selectedRegion?.slug === r.slug
                        ? "border-[var(--accent-color)] bg-[var(--accent-dim)]"
                        : r.available
                        ? "border-[var(--border-color)] bg-[var(--card-bg)] hover:border-[var(--accent-color)] hover:bg-[var(--card-hover)]"
                        : "border-[var(--border-color)]/50 bg-[var(--card-bg)]/50 opacity-50 cursor-not-allowed"
                    }`}
                  >
                    <span className="text-2xl">{r.flag}</span>
                    <div>
                      <p className="text-[var(--text-primary)] font-medium text-sm">{r.name}</p>
                      <p className="text-[var(--text-secondary)] text-xs">{r.country}</p>
                    </div>
                    {!r.available && (
                      <span className="ml-auto text-xs text-[var(--text-secondary)]/50 border border-zinc-800 rounded-full px-2 py-0.5">Soon</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* STEP: Plan */}
        {step === "plan" && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-1">Choose Your Plan</h2>
              <p className="text-sm text-[var(--text-secondary)]">
                Each plan includes dedicated infrastructure, credits, and support.
              </p>
            </div>

            <div className="space-y-3">
              {DEPLOYABLE_PLANS.map((plan) => {
                const server = resolveServerForPlan(plan)
                const isSelected = selectedPlan?.slug === plan.slug
                const price = plan.displayPriceMonthly
                return (
                  <button
                    key={plan.slug}
                    onClick={() => setSelectedPlan(plan)}
                    className={`w-full p-5 rounded-xl border text-left transition-all ${
                      isSelected
                        ? "border-[var(--accent-color)] bg-[var(--accent-dim)]"
                        : "border-[var(--border-color)] bg-[var(--card-bg)] hover:border-[var(--accent-color)]"
                    } ${plan.highlight ? "ring-1 ring-[var(--accent-color)]/20" : ""}`}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-[var(--text-primary)] font-semibold text-lg">{plan.name}</p>
                          {plan.highlight && (
                            <span className="text-[10px] bg-[var(--accent-color)] text-black px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">
                              Popular
                            </span>
                          )}
                        </div>
                        <p className="text-[var(--text-secondary)] text-sm mt-1">{plan.description}</p>
                      </div>
                      <div className="text-right">
                        {price === 0 ? (
                          <p className="text-[var(--text-primary)] font-bold text-2xl">Free</p>
                        ) : (
                          <p className="text-[var(--text-primary)] font-bold text-2xl">
                            ${price}<span className="text-[var(--text-secondary)] text-sm font-normal">/mo</span>
                          </p>
                        )}
                      </div>
                    </div>
                    {server && (
                      <div className="mt-3 flex flex-wrap gap-3 text-xs text-[var(--text-secondary)]">
                        <span>{server.vcpu} vCPU</span>
                        <span>{server.ramGb} GB RAM</span>
                        <span>{server.storageGb} GB Storage</span>
                        <span>{plan.creditsPerPeriod.toLocaleString()} credits/mo</span>
                      </div>
                    )}
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {plan.features.slice(0, 3).map((f) => (
                        <span key={f} className="text-[10px] border border-[var(--border-color)] rounded-full px-2 py-0.5 text-[var(--text-secondary)]">
                          {f}
                        </span>
                      ))}
                    </div>
                  </button>
                )
              })}

              {enterprisePlan && (
                <div className="w-full p-5 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] opacity-80">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-[var(--text-primary)] font-semibold text-lg">{enterprisePlan.name}</p>
                      <p className="text-[var(--text-secondary)] text-sm mt-1">{enterprisePlan.description}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[var(--text-primary)] font-bold text-lg">{enterprisePlan.enterprisePriceLabel}</p>
                    </div>
                  </div>
                  {(() => {
                    const server = resolveServerForPlan(enterprisePlan)
                    return server ? (
                      <div className="mt-3 flex flex-wrap gap-3 text-xs text-[var(--text-secondary)]">
                        <span>{server.vcpu} vCPU</span>
                        <span>{server.ramGb} GB RAM</span>
                        <span>{server.storageGb} GB Storage</span>
                      </div>
                    ) : null
                  })()}
                  <div className="mt-4">
                    <a
                      href={BRANDING.demoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 text-sm font-medium text-[var(--accent-color)] hover:underline"
                    >
                      Contact Sales &rarr;
                    </a>
                  </div>
                </div>
              )}
            </div>

            {selectedPlan && selectedServer && (
              <div className="border border-[var(--border-color)] bg-[var(--bg-secondary)] rounded-xl p-4">
                <p className="text-[10px] uppercase tracking-[0.1em] font-mono text-[var(--accent-color)] mb-2">
                  Your plan includes
                </p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <div>
                    <p className="text-[var(--text-secondary)] text-xs">CPU</p>
                    <p className="text-[var(--text-primary)] font-medium">{selectedServer.vcpu} vCPU</p>
                  </div>
                  <div>
                    <p className="text-[var(--text-secondary)] text-xs">Memory</p>
                    <p className="text-[var(--text-primary)] font-medium">{selectedServer.ramGb} GB RAM</p>
                  </div>
                  <div>
                    <p className="text-[var(--text-secondary)] text-xs">Storage</p>
                    <p className="text-[var(--text-primary)] font-medium">{selectedServer.storageGb} GB</p>
                  </div>
                  <div>
                    <p className="text-[var(--text-secondary)] text-xs">Credits</p>
                    <p className="text-[var(--text-primary)] font-medium">{selectedPlan.creditsPerPeriod.toLocaleString()}/mo</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* STEP: Advanced (root password + SSH key only) */}
        {step === "advanced" && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-1">Advanced Options</h2>
              <p className="text-sm text-[var(--text-secondary)]">
                Optional configuration. All fields are independent — fill only what you need.
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-[var(--text-primary)] mb-2">Root Password</label>
                <input
                  type="password"
                  value={rootPassword}
                  onChange={(e) => setRootPassword(e.target.value)}
                  placeholder="Leave blank for auto-generated"
                  className="w-full bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl px-4 py-3 text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/50 focus:outline-none focus:border-blue-500/50 transition-colors"
                />
              </div>

              <div>
                <label className="block text-sm text-[var(--text-primary)] mb-2">SSH Public Key</label>
                <textarea
                  value={sshKey}
                  onChange={(e) => setSshKey(e.target.value)}
                  placeholder="ssh-ed25519 AAAA..."
                  rows={3}
                  className="w-full bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl px-4 py-3 text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/50 focus:outline-none focus:border-blue-500/50 transition-colors font-mono text-sm resize-none"
                />
              </div>

              <p className="text-[11px] font-mono text-[var(--text-secondary)]">
                Custom domains can be configured after deployment from the instance Controls tab.
              </p>
            </div>
          </div>
        )}

        {/* STEP: Billing (includes Review summary + Deploy) */}
        {step === "billing" && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-1">Billing & Review</h2>
              <p className="text-sm text-[var(--text-secondary)]">
                Choose a billing cycle, confirm your configuration, and deploy.
              </p>
            </div>

            {selectedPlan && selectedPlan.tier !== "free" && (
              <div className="grid grid-cols-2 gap-4">
                {(["month", "year"] as BillingInterval[]).map((interval) => (
                  <button
                    key={interval}
                    onClick={() => setBillingInterval(interval)}
                    className={`p-6 rounded-xl border text-center transition-all ${
                      billingInterval === interval
                        ? "border-[var(--accent-color)] bg-[var(--accent-dim)]"
                        : "border-[var(--border-color)] bg-[var(--card-bg)] hover:border-[var(--accent-color)]"
                    }`}
                  >
                    <p className="text-[var(--text-primary)] font-semibold text-lg">
                      {interval === "month" ? "Monthly" : "Yearly"}
                    </p>
                    <p className="text-[var(--text-secondary)] text-sm mt-1">
                      {interval === "month" ? "Pay month-to-month" : "Save ~17% (2 months free)"}
                    </p>
                    {interval === "year" && (
                      <span className="inline-block mt-2 text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full">
                        Best Value
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}

            <div className="space-y-4">
              <div className="bg-[var(--card-bg)] rounded-xl p-4 border border-[var(--accent-color)]/30">
                <p className="text-[var(--accent-color)] text-xs uppercase tracking-wide mb-2 font-mono">Agent</p>
                <p className="text-[var(--text-primary)] font-medium">{selectedCategoryObj?.name ?? "—"}</p>
                <p className="text-[var(--text-secondary)] text-xs mt-1">
                  Interface: <span className="text-[var(--text-primary)] capitalize">{interfaceKind}</span> ·
                  <span className="ml-1">Deploy: <span className="text-[var(--text-primary)] capitalize">{deploymentTarget}</span></span>
                </p>
                {coreActions.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {coreActions.map((a) => (
                      <span key={a} className="text-[10px] border border-[var(--border-color)] rounded-full px-2 py-0.5 text-[var(--text-secondary)]">{a}</span>
                    ))}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="bg-[var(--card-bg)] rounded-xl p-4">
                  <p className="text-[var(--text-secondary)] text-xs uppercase tracking-wide mb-1">Project</p>
                  <p className="text-[var(--text-primary)] font-medium">{projectName}</p>
                  <p className="text-[var(--text-secondary)] text-xs mt-2 font-mono">
                    slug: {slugPreview || "—"}
                  </p>
                </div>
                <div className="bg-[var(--card-bg)] rounded-xl p-4">
                  <p className="text-[var(--text-secondary)] text-xs uppercase tracking-wide mb-1">Plan</p>
                  <p className="text-[var(--text-primary)] font-medium">{selectedPlan?.name ?? "—"}</p>
                </div>
                {selectedRegion && (
                  <div className="bg-[var(--card-bg)] rounded-xl p-4">
                    <p className="text-[var(--text-secondary)] text-xs uppercase tracking-wide mb-1">Region</p>
                    <p className="text-[var(--text-primary)] font-medium">{selectedRegion.flag} {selectedRegion.name}</p>
                  </div>
                )}
                {selectedServer && (
                  <div className="bg-[var(--card-bg)] rounded-xl p-4">
                    <p className="text-[var(--text-secondary)] text-xs uppercase tracking-wide mb-1">Infrastructure</p>
                    <p className="text-[var(--text-primary)] font-medium">{selectedServer.vcpu} vCPU, {selectedServer.ramGb} GB RAM</p>
                  </div>
                )}
                {selectedPlan && selectedPlan.tier !== "free" && (
                  <div className="bg-[var(--card-bg)] rounded-xl p-4">
                    <p className="text-[var(--text-secondary)] text-xs uppercase tracking-wide mb-1">Billing</p>
                    <p className="text-[var(--text-primary)] font-medium">{billingInterval === "year" ? "Yearly" : "Monthly"}</p>
                  </div>
                )}
                {sshKey && (
                  <div className="bg-[var(--card-bg)] rounded-xl p-4">
                    <p className="text-[var(--text-secondary)] text-xs uppercase tracking-wide mb-1">SSH Key</p>
                    <p className="text-[var(--text-primary)] font-medium font-mono text-xs truncate">{sshKey.slice(0, 40)}...</p>
                  </div>
                )}
              </div>

              {selectedPlan && (
                <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-6 space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-[var(--text-secondary)]">{selectedPlan.name} Plan</span>
                    <span className="text-[var(--text-primary)]">
                      {selectedPlan.tier === "free"
                        ? "Free"
                        : planPrice
                        ? formatUsd(planPrice.price)
                        : "—"}
                    </span>
                  </div>
                  <div className="border-t border-[var(--border-color)] pt-3 flex justify-between">
                    <span className="text-[var(--text-primary)] font-semibold">Total</span>
                    <span className="text-[var(--text-primary)] font-bold text-xl">
                      {selectedPlan.tier === "free" ? (
                        "$0.00"
                      ) : planPrice ? (
                        <>
                          {formatUsd(planPrice.price)}
                          <span className="text-[var(--text-secondary)] text-sm font-normal">
                            /{billingInterval === "year" ? "year" : "month"}
                          </span>
                        </>
                      ) : (
                        "—"
                      )}
                    </span>
                  </div>
                  {planPrice?.yearlyDiscountApplied && selectedPlan.tier !== "free" && (
                    <p className="text-emerald-400 text-xs">~17% savings with yearly billing</p>
                  )}
                  {selectedPlan.tier !== "free" && (
                    <p className="text-[var(--text-secondary)] text-xs">
                      Have a promo code? You can apply it at checkout.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Navigation buttons */}
      <div className="flex items-center justify-between">
        <button
          onClick={prev}
          disabled={stepIdx === 0}
          className="px-6 py-3 rounded-xl border border-[var(--border-color)] text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--text-secondary)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          Back
        </button>
        <div className="flex items-center gap-3">
          {step === STEPS[STEPS.length - 1] ? (
            <button
              onClick={handleDeploy}
              disabled={deploying || !canNext}
              className="btn-primary font-semibold px-8 py-3 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {deploying ? "Deploying..." : selectedPlan?.tier === "free" ? "Deploy Free Agent" : "Deploy Agent"}
            </button>
          ) : (
            <button
              onClick={next}
              disabled={!canNext}
              className="btn-primary font-semibold px-8 py-3 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Continue
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
