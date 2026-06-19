"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  Check,
  MessageSquare,
  PenTool,
  Search,
  Settings,
  Share2,
  Terminal,
  TrendingUp,
  Zap,
  type LucideIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { PageContainer, PageHeader } from "@/components/layout/page-container"
import { RuntimeLogo } from "@/components/dashboard/runtime-logo"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { AGENT_CATEGORIES } from "@/configs/agent-categories"
import { BRANDING } from "@/configs/branding"
import { DEPLOYABLE_PLANS, PLANS, type PlanConfig } from "@/configs/plans"
import { SERVER_TYPES, type ServerTypeConfig } from "@/configs/server-types"
import { calcPlanPrice, formatUsd } from "@/lib/pricing"
import type { BillingInterval } from "@/lib/pricing"
import { cn } from "@/lib/utils"

type Interface = "web" | "telegram" | "discord" | "api"
type DeploymentTarget = "vps" | "shared" | "serverless"
type Runtime = "openclaw" | "hermes"

type AgentConfig = {
  use_case: string
  target_user: string
  core_actions: string[]
  tone: string
  interface: Interface
  deployment_target: DeploymentTarget
  knowledge_source: string
  budget_tier: string
  runtime: Runtime
}

// Interface and deployment target are fixed for the self-serve wizard: every
// agent ships as an embeddable Web Chat widget on a dedicated VPS. They stay as
// constants so the agentConfig payload keeps its shape, but the user no longer
// picks them.
const FIXED_INTERFACE: Interface = "web"
const FIXED_DEPLOYMENT_TARGET: DeploymentTarget = "vps"

const RUNTIME_OPTIONS: { value: Runtime; label: string; hint: string; enabled: boolean }[] = [
  { value: "openclaw", label: "OpenClaw", hint: "Default agent runtime", enabled: true },
  { value: "hermes", label: "Hermes", hint: "Nous Research Hermes (Python)", enabled: true },
]

// Map the lucide icon names referenced in agent-categories.ts to their
// components so the use-case cards can render an icon per category.
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  Zap,
  Terminal,
  MessageSquare,
  Search,
  PenTool,
  TrendingUp,
  Share2,
  Settings,
}

type Step = "agent" | "project" | "plan" | "billing"
const ALL_STEPS: Step[] = ["agent", "project", "plan", "billing"]

const SELECTED_GLOW =
  "aria-pressed:border-ring aria-pressed:ring-1 aria-pressed:ring-ring aria-pressed:bg-ring/15 aria-pressed:hover:bg-ring/20 aria-pressed:text-foreground " +
  "data-[state=on]:border-ring data-[state=on]:ring-1 data-[state=on]:ring-ring data-[state=on]:bg-ring/15 data-[state=on]:hover:bg-ring/20 data-[state=on]:text-foreground"

function deploymentSlug(raw: string) {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

const STEP_LABELS: Record<Step, string> = {
  agent: "Agent",
  project: "Project",
  plan: "Plan",
  billing: "Billing",
}

function resolveServerForPlan(plan: PlanConfig): ServerTypeConfig | null {
  if (!plan.serverConfigSlug) return null
  return SERVER_TYPES.find((s) => s.slug === plan.serverConfigSlug) ?? null
}

export default function DeployPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>("agent")
  const [deploying, setDeploying] = useState(false)

  const [projectName, setProjectName] = useState("")
  const [useCase, setUseCase] = useState<string>("")
  const [runtime, setRuntime] = useState<Runtime>("openclaw")

  const [billingInterval, setBillingInterval] = useState<BillingInterval>("month")
  const [selectedPlan, setSelectedPlan] = useState<PlanConfig | null>(null)

  const selectedServer = selectedPlan ? resolveServerForPlan(selectedPlan) : null

  const STEPS = ALL_STEPS
  const stepIdx = STEPS.indexOf(step)
  const selectedCategoryObj = AGENT_CATEGORIES.find((c) => c.slug === useCase)

  const coreActions = selectedCategoryObj?.examples ? [...selectedCategoryObj.examples] : []

  // Hermes always boxes Open WebUI as a sidecar, which needs ≥2GB RAM. With the
  // runtime now chosen before the plan, we gate plan selection instead: a
  // sub-2GB plan (the Free Nanode) can't host Hermes.
  function planSupportsRuntime(plan: PlanConfig): boolean {
    if (runtime !== "hermes") return true
    const server = resolveServerForPlan(plan)
    return !!server && server.ramGb >= 2
  }

  const canNext = (() => {
    switch (step) {
      case "agent":
        return !!runtime
      case "project":
        return projectName.trim().length >= 2 && !!useCase
      case "plan":
        return !!selectedPlan
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

  const planPrice = selectedPlan ? calcPlanPrice(selectedPlan, billingInterval) : null

  async function handleDeploy() {
    if (!projectName.trim() || !selectedPlan) return
    setDeploying(true)
    try {
      const res = await fetch("/api/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: projectName.trim(),
          planSlug: selectedPlan.slug,
          billingInterval,
          agentConfig: {
            use_case: useCase,
            target_user: "",
            core_actions: coreActions,
            tone: "friendly",
            interface: FIXED_INTERFACE,
            deployment_target: FIXED_DEPLOYMENT_TARGET,
            knowledge_source: "none",
            budget_tier: "mid",
            runtime,
          } satisfies AgentConfig,
          interfaceBinding: { kind: FIXED_INTERFACE, mode: "immediate" },
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || `Deployment failed (${res.status})`)
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
    <PageContainer>
      <PageHeader
        title="Deploy a new agent"
        description="No code, no DevOps. Three steps to launch into your own private instance."
      />

      <div className="flex items-center gap-1 overflow-x-auto pb-2">
        {STEPS.map((s, i) => {
          const isActive = s === step
          const isComplete = i < stepIdx
          const isFuture = i > stepIdx
          return (
            <button
              key={s}
              type="button"
              onClick={() => i <= stepIdx && setStep(s)}
              disabled={isFuture}
              className={
                isActive
                  ? "flex items-center gap-2 whitespace-nowrap rounded-full border border-ring bg-ring/5 px-3 py-2 text-sm font-medium text-foreground ring-1 ring-ring"
                  : isComplete
                    ? "flex items-center gap-2 whitespace-nowrap rounded-full px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
                    : "flex cursor-default items-center gap-2 whitespace-nowrap rounded-full px-3 py-2 text-sm text-muted-foreground/50"
              }
            >
              <span
                className={
                  isActive
                    ? "flex size-6 items-center justify-center rounded-full bg-ring text-xs font-bold text-background"
                    : isComplete
                      ? "flex size-6 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white"
                      : "flex size-6 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground"
                }
              >
                {isComplete ? <Check className="size-3.5" /> : i + 1}
              </span>
              {`${i + 1} · ${STEP_LABELS[s]}`}
            </button>
          )
        })}
      </div>

      <Card>
        <CardContent className="space-y-6 py-6">
          {step === "agent" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Choose Your Agent</h2>
                <p className="text-sm text-muted-foreground">
                  Pick the runtime that powers your bot.
                </p>
              </div>

              <div className="space-y-2">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Runtime Engine
                </p>
                <ToggleGroup
                  value={[runtime]}
                  onValueChange={(v) => {
                    const next = v[0] as Runtime | undefined
                    if (!next) return
                    setRuntime(next)
                    // Switching to Hermes invalidates a sub-2GB plan (Free) —
                    // clear it so the form can't deploy an unsupported combo.
                    if (
                      next === "hermes" &&
                      selectedPlan &&
                      (resolveServerForPlan(selectedPlan)?.ramGb ?? 0) < 2
                    ) {
                      setSelectedPlan(null)
                    }
                  }}
                  className="grid w-full grid-cols-1 gap-2 md:grid-cols-2"
                  spacing={1}
                >
                  {RUNTIME_OPTIONS.map((r) => {
                    const isSelected = runtime === r.value
                    return (
                      <ToggleGroupItem
                        key={r.value}
                        value={r.value}
                        disabled={!r.enabled}
                        variant="outline"
                        className={cn(
                          "relative h-auto flex-col items-start gap-3 whitespace-normal p-4 text-left",
                          SELECTED_GLOW
                        )}
                      >
                        {isSelected && (
                          <span className="absolute top-3 right-3 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground">
                            <Check className="size-3" />
                          </span>
                        )}
                        <div className="grid size-[52px] place-items-center rounded-[13px] border border-border bg-muted">
                          <RuntimeLogo
                            runtime={r.value}
                            alt={`${r.label} logo`}
                            size={30}
                            className="size-[30px]"
                          />
                        </div>
                        <div className="flex w-full items-center justify-between gap-2">
                          <p className="text-base font-semibold text-foreground">{r.label}</p>
                          {!r.enabled && (
                            <Badge variant="outline" className="text-[10px]">
                              Coming soon
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">{r.hint}</p>
                      </ToggleGroupItem>
                    )
                  })}
                </ToggleGroup>
                {runtime === "hermes" && (
                  <p className="text-xs text-muted-foreground">
                    Hermes ships with the Open WebUI chat interface bundled: you&apos;ll get a web
                    chat UI at <span className="font-mono">/</span> and the OpenAI-compatible API at{" "}
                    <span className="font-mono">/v1</span> on the same public URL. Requires a plan
                    with at least 2GB RAM.
                  </p>
                )}
              </div>
            </div>
          )}

          {step === "project" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Project</h2>
                <p className="text-sm text-muted-foreground">Name your agent and pick a use case.</p>
              </div>

              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="project-name">Project Name</FieldLabel>
                  <Input
                    id="project-name"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    placeholder="my-ai-agent"
                    className={cn(
                      projectName.trim().length >= 2 && "border-ring ring-1 ring-ring"
                    )}
                  />
                  {projectName.trim().length > 0 && projectName.trim().length < 2 && (
                    <FieldDescription className="text-amber-500">
                      Enter at least 2 characters to continue.
                    </FieldDescription>
                  )}
                </Field>
              </FieldGroup>

              <div className="space-y-2">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Use Case</p>
                <ToggleGroup
                  value={useCase ? [useCase] : []}
                  onValueChange={(v) => v[0] && setUseCase(v[0])}
                  className="grid w-full grid-cols-2 gap-2 md:grid-cols-4"
                  spacing={1}
                >
                  {AGENT_CATEGORIES.map((cat) => {
                    const Icon = CATEGORY_ICONS[cat.icon] ?? Settings
                    return (
                      <ToggleGroupItem
                        key={cat.slug}
                        value={cat.slug}
                        variant="outline"
                        className={cn(
                          "h-auto flex-col items-start gap-2 whitespace-normal p-3 text-left",
                          SELECTED_GLOW
                        )}
                      >
                        <span className="grid size-9 place-items-center rounded-lg border border-border bg-muted text-foreground">
                          <Icon className="size-4" />
                        </span>
                        <div>
                          <p className="text-sm font-medium text-foreground">{cat.name}</p>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            Runs on {RUNTIME_OPTIONS.find((r) => r.value === runtime)?.label ?? runtime}
                          </p>
                        </div>
                        <p className="line-clamp-2 text-xs text-muted-foreground">
                          {cat.description}
                        </p>
                      </ToggleGroupItem>
                    )
                  })}
                </ToggleGroup>
              </div>
            </div>
          )}

          {step === "plan" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Choose Your Plan</h2>
                <p className="text-sm text-muted-foreground">
                  Each plan includes dedicated infrastructure, credits, and support.
                </p>
              </div>

              <ToggleGroup
                orientation="vertical"
                value={selectedPlan ? [selectedPlan.slug] : []}
                onValueChange={(v) => {
                  const slug = v[0]
                  if (!slug) return
                  const p = DEPLOYABLE_PLANS.find((x) => x.slug === slug)
                  if (p && planSupportsRuntime(p)) setSelectedPlan(p)
                }}
                className="flex w-full flex-col gap-3"
                spacing={1}
              >
                {DEPLOYABLE_PLANS.map((plan) => {
                  const server = resolveServerForPlan(plan)
                  const price = plan.displayPriceMonthly
                  const showSpecs = plan.tier !== "free"
                  const runtimeBlocked = !planSupportsRuntime(plan)
                  return (
                    <ToggleGroupItem
                      key={plan.slug}
                      value={plan.slug}
                      disabled={runtimeBlocked}
                      variant="outline"
                      className={cn(
                        "h-auto w-full flex-col items-stretch whitespace-normal p-5 text-left",
                        plan.highlight && "ring-1 ring-primary/20",
                        SELECTED_GLOW
                      )}
                    >
                      <div className="flex w-full items-start justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-lg font-semibold text-foreground">{plan.name}</p>
                            {plan.highlight && (
                              <Badge className="font-mono text-[10px]">Popular</Badge>
                            )}
                            {runtimeBlocked && (
                              <Badge variant="outline" className="text-[10px]">
                                Needs ≥2GB plan
                              </Badge>
                            )}
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground">{plan.description}</p>
                        </div>
                        <div className="text-right">
                          {price === 0 ? (
                            <p className="text-2xl font-bold text-foreground">Free</p>
                          ) : (
                            <p className="text-2xl font-bold text-foreground">
                              ${price}
                              <span className="text-sm font-normal text-muted-foreground">/mo</span>
                            </p>
                          )}
                        </div>
                      </div>
                      {showSpecs && server && (
                        <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                          <span>{server.vcpu} vCPU</span>
                          <span>{server.ramGb} GB RAM</span>
                          <span>{server.storageGb} GB Storage</span>
                          <span>{plan.creditsPerPeriod.toLocaleString()} credits/mo</span>
                        </div>
                      )}
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {plan.features.slice(0, 3).map((f) => (
                          <Badge key={f} variant="outline" className="text-[10px]">
                            {f}
                          </Badge>
                        ))}
                      </div>
                    </ToggleGroupItem>
                  )
                })}
              </ToggleGroup>

              {enterprisePlan && (
                <Card>
                  <CardContent>
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-lg font-semibold text-foreground">
                          {enterprisePlan.name}
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {enterprisePlan.description}
                        </p>
                      </div>
                      <p className="text-lg font-bold text-foreground">
                        {enterprisePlan.enterprisePriceLabel}
                      </p>
                    </div>
                    <div className="mt-4">
                      <a
                        href={BRANDING.demoUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
                      >
                        Contact Sales &rarr;
                      </a>
                    </div>
                  </CardContent>
                </Card>
              )}

              {selectedPlan && selectedPlan.tier !== "free" && selectedServer && (
                <Card className="bg-muted/40">
                  <CardHeader>
                    <CardDescription className="font-mono text-[10px] tracking-[0.1em] uppercase text-primary">
                      Your plan includes
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                    <div>
                      <p className="text-xs text-muted-foreground">CPU</p>
                      <p className="font-medium text-foreground">{selectedServer.vcpu} vCPU</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Memory</p>
                      <p className="font-medium text-foreground">{selectedServer.ramGb} GB RAM</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Storage</p>
                      <p className="font-medium text-foreground">{selectedServer.storageGb} GB</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Credits</p>
                      <p className="font-medium text-foreground">
                        {selectedPlan.creditsPerPeriod.toLocaleString()}/mo
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}

            </div>
          )}

          {step === "billing" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Billing &amp; Review</h2>
                <p className="text-sm text-muted-foreground">
                  Choose a billing cycle, confirm your configuration, and deploy.
                </p>
              </div>

              {selectedPlan && selectedPlan.tier !== "free" && (
                <ToggleGroup
                  value={[billingInterval]}
                  onValueChange={(v) => v[0] && setBillingInterval(v[0] as BillingInterval)}
                  className="grid w-full grid-cols-2 items-stretch gap-4"
                  spacing={1}
                >
                  {(["month", "year"] as BillingInterval[]).map((interval) => (
                    <ToggleGroupItem
                      key={interval}
                      value={interval}
                      variant="outline"
                      className={cn(
                        "h-full min-h-[7.5rem] flex-col justify-center gap-1 whitespace-normal p-6 text-center",
                        SELECTED_GLOW
                      )}
                    >
                      <p className="text-lg font-semibold text-foreground">
                        {interval === "month" ? "Monthly" : "Yearly"}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {interval === "month" ? "Pay month-to-month" : "Save ~17% (2 months free)"}
                      </p>
                      <Badge
                        className={cn(
                          "mt-2 bg-emerald-500/20 text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-300",
                          interval !== "year" && "invisible"
                        )}
                      >
                        Best Value
                      </Badge>
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              )}

              <Card className="border-ring ring-1 ring-ring bg-ring/5">
                <CardHeader>
                  <div className="flex items-center gap-4">
                    <div className="grid size-14 shrink-0 place-items-center rounded-[13px] border border-border bg-muted">
                      <RuntimeLogo
                        runtime={runtime}
                        alt={`${RUNTIME_OPTIONS.find((r) => r.value === runtime)?.label ?? runtime} logo`}
                        size={32}
                        className="size-8"
                      />
                    </div>
                    <div className="min-w-0">
                      <CardDescription className="font-mono text-xs uppercase tracking-wide text-primary">
                        Agent
                      </CardDescription>
                      <p className="truncate text-base font-semibold text-foreground">
                        {projectName || selectedCategoryObj?.name || "-"}
                      </p>
                      <p className="truncate font-mono text-xs text-muted-foreground">
                        slug: {slugPreview || "-"}
                      </p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground">
                    Use case:{" "}
                    <span className="text-foreground">{selectedCategoryObj?.name ?? "-"}</span>
                    {"  ·  Runtime: "}
                    <span className="text-foreground">
                      {RUNTIME_OPTIONS.find((r) => r.value === runtime)?.label ?? runtime}
                    </span>
                  </p>
                  {coreActions.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {coreActions.map((a) => (
                        <Badge key={a} variant="outline" className="text-[10px]">
                          {a}
                        </Badge>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <Card size="sm">
                  <CardHeader>
                    <CardDescription className="text-xs uppercase tracking-wide">
                      Project
                    </CardDescription>
                    <p className="font-medium text-foreground">{projectName}</p>
                  </CardHeader>
                  <CardContent>
                    <p className="font-mono text-xs text-muted-foreground">
                      slug: {slugPreview || "-"}
                    </p>
                  </CardContent>
                </Card>
                <Card size="sm">
                  <CardHeader>
                    <CardDescription className="text-xs uppercase tracking-wide">
                      Plan
                    </CardDescription>
                    <p className="font-medium text-foreground">{selectedPlan?.name ?? "-"}</p>
                  </CardHeader>
                </Card>
                {selectedPlan && selectedPlan.tier !== "free" && selectedServer && (
                  <Card size="sm">
                    <CardHeader>
                      <CardDescription className="text-xs uppercase tracking-wide">
                        Infrastructure
                      </CardDescription>
                      <p className="font-medium text-foreground">
                        {selectedServer.vcpu} vCPU, {selectedServer.ramGb} GB RAM
                      </p>
                    </CardHeader>
                  </Card>
                )}
                {selectedPlan && selectedPlan.tier !== "free" && (
                  <Card size="sm">
                    <CardHeader>
                      <CardDescription className="text-xs uppercase tracking-wide">
                        Billing
                      </CardDescription>
                      <p className="font-medium text-foreground">
                        {billingInterval === "year" ? "Yearly" : "Monthly"}
                      </p>
                    </CardHeader>
                  </Card>
                )}
              </div>

              {selectedPlan && (
                <Card className="border-ring bg-ring/5">
                  <CardContent className="space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{selectedPlan.name} Plan</span>
                      <span className="text-foreground">
                        {selectedPlan.tier === "free"
                          ? "Free"
                          : planPrice
                            ? formatUsd(planPrice.price)
                            : "-"}
                      </span>
                    </div>
                    <div className="flex justify-between border-t pt-3">
                      <span className="font-semibold text-foreground">Est. cost</span>
                      <span className="text-xl font-bold text-primary">
                        {selectedPlan.tier === "free" ? (
                          "$0.00"
                        ) : planPrice ? (
                          <>
                            {formatUsd(planPrice.price)}
                            <span className="text-sm font-normal text-muted-foreground">
                              /{billingInterval === "year" ? "year" : "month"}
                            </span>
                          </>
                        ) : (
                          "-"
                        )}
                      </span>
                    </div>
                    {planPrice?.yearlyDiscountApplied && selectedPlan.tier !== "free" && (
                      <p className="text-xs text-emerald-600 dark:text-emerald-400">
                        ~17% savings with yearly billing
                      </p>
                    )}
                    {selectedPlan.tier !== "free" && (
                      <p className="text-xs text-muted-foreground">
                        Have a promo code? You can apply it at checkout.
                      </p>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <Button variant="outline" onClick={prev} disabled={stepIdx === 0}>
          Back
        </Button>
        <div className="flex items-center gap-3">
          {step === STEPS[STEPS.length - 1] ? (
            <Button
              variant="gradient"
              size="pill"
              onClick={handleDeploy}
              disabled={deploying || !canNext}
            >
              {deploying
                ? "Deploying..."
                : selectedPlan?.tier === "free"
                  ? "Deploy Free Agent"
                  : "Deploy Agent"}
            </Button>
          ) : (
            <Button variant="gradient" size="pill" onClick={next} disabled={!canNext}>
              Continue
            </Button>
          )}
        </div>
      </div>
    </PageContainer>
  )
}
