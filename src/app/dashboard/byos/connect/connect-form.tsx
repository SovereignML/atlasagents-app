"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Check, Copy, KeyRound, Wallet } from "lucide-react"

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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { AGENT_CATEGORIES } from "@/configs/agent-categories"
import { cn } from "@/lib/utils"

type LlmMode = "managed_credits" | "own_key"
type BillingInterval = "month" | "year"
type Runtime = "openclaw" | "hermes"
type Step = "server" | "agent" | "project" | "billing"

const STEPS: Step[] = ["server", "agent", "project", "billing"]
const STEP_LABELS: Record<Step, string> = {
  server: "Server",
  agent: "Agent",
  project: "Project",
  billing: "Billing",
}

const RUNTIME_OPTIONS: { value: Runtime; label: string; hint: string }[] = [
  { value: "openclaw", label: "OpenClaw", hint: "Default agent runtime" },
  { value: "hermes", label: "Hermes", hint: "Nous Research Hermes (Python)" },
]

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

export function ByosConnectForm({
  fleetPublicKey,
  priceMonthly,
  priceYearly,
}: {
  fleetPublicKey: string | null
  priceMonthly: number
  priceYearly: number
}) {
  const router = useRouter()

  const [step, setStep] = useState<Step>("server")
  const [submitting, setSubmitting] = useState(false)
  const [copied, setCopied] = useState(false)

  // Agent step
  const [runtime, setRuntime] = useState<Runtime>("openclaw")

  // Server step
  const [host, setHost] = useState("")
  const [port, setPort] = useState("22")
  const [user, setUser] = useState("root")
  const [llmMode, setLlmMode] = useState<LlmMode>("managed_credits")
  const [ownApiKey, setOwnApiKey] = useState("")

  // Project step
  const [name, setName] = useState("")
  const [useCase, setUseCase] = useState<string>("")

  // Billing step
  const [interval, setInterval] = useState<BillingInterval>("month")

  const stepIdx = STEPS.indexOf(step)
  const runtimeLabel = RUNTIME_OPTIONS.find((r) => r.value === runtime)?.label ?? runtime
  const selectedCategory = AGENT_CATEGORIES.find((c) => c.slug === useCase)
  const coreActions = selectedCategory?.examples ? [...selectedCategory.examples] : []
  const slugPreview = deploymentSlug(name)

  const fee = interval === "year" ? priceYearly : priceMonthly
  const feeSuffix = interval === "year" ? "/yr" : "/mo"

  const authorizedKeysCmd = fleetPublicKey
    ? `mkdir -p ~/.ssh && echo '${fleetPublicKey}' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`
    : ""

  const canNext = (() => {
    switch (step) {
      case "server":
        return host.trim().length > 0 && (llmMode !== "own_key" || ownApiKey.trim().length > 0)
      case "agent":
        return true
      case "project":
        return name.trim().length >= 2 && !!useCase
      case "billing":
        return true
    }
  })()

  function next() {
    if (stepIdx < STEPS.length - 1) setStep(STEPS[stepIdx + 1])
  }
  function prev() {
    if (stepIdx > 0) setStep(STEPS[stepIdx - 1])
    else router.back()
  }

  async function copyCmd() {
    if (!authorizedKeysCmd) return
    try {
      await navigator.clipboard.writeText(authorizedKeysCmd)
      setCopied(true)
      toast.success("Command copied")
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Couldn't copy. Select and copy manually.")
    }
  }

  async function submit() {
    if (!name.trim()) return toast.error("Give your agent a name")
    if (!host.trim()) return toast.error("Enter your server's host / IP")
    if (!useCase) return toast.error("Pick a use case")
    if (llmMode === "own_key" && !ownApiKey.trim())
      return toast.error("Enter your API key, or switch to our credits")

    setSubmitting(true)
    try {
      const res = await fetch("/api/byos/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          byosHost: host.trim(),
          byosPort: Number(port) || 22,
          byosUser: user.trim() || "root",
          billingInterval: interval,
          llmMode,
          ownApiKey: llmMode === "own_key" ? ownApiKey.trim() : undefined,
          agentConfig: {
            use_case: useCase,
            target_user: "",
            core_actions: coreActions,
            tone: "friendly",
            interface: "web",
            deployment_target: "byos",
            knowledge_source: "none",
            budget_tier: "mid",
            runtime,
          },
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || `Could not connect your server (${res.status})`)
        return
      }
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl
      } else {
        toast.success("Server connected! Provisioning your agent...")
        router.push(`/dashboard/instances/${data.instanceId}`)
      }
    } catch {
      toast.error("Something went wrong")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
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
                  ? "flex items-center gap-2 whitespace-nowrap rounded-lg border border-ring bg-ring/5 px-3 py-2 text-sm font-medium text-foreground ring-1 ring-ring"
                  : isComplete
                    ? "flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
                    : "flex cursor-default items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm text-muted-foreground/50"
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
              {STEP_LABELS[s]}
            </button>
          )
        })}
      </div>

      <Card>
        <CardContent className="space-y-6 py-6">
          {step === "server" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Your Server</h2>
                <p className="text-sm text-muted-foreground">
                  We install and manage the agent on a server you own. Nothing is
                  provisioned on our side.
                </p>
              </div>

              <FieldGroup>
                <div className="grid gap-4 sm:grid-cols-[1fr_120px_140px]">
                  <Field>
                    <FieldLabel htmlFor="byos-host">Host / IP</FieldLabel>
                    <Input
                      id="byos-host"
                      placeholder="203.0.113.10"
                      value={host}
                      onChange={(e) => setHost(e.target.value)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="byos-port">SSH port</FieldLabel>
                    <Input
                      id="byos-port"
                      inputMode="numeric"
                      value={port}
                      onChange={(e) => setPort(e.target.value)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="byos-user">SSH user</FieldLabel>
                    <Input
                      id="byos-user"
                      value={user}
                      onChange={(e) => setUser(e.target.value)}
                    />
                  </Field>
                </div>
                <FieldDescription>
                  Ubuntu 22.04+ is recommended. The SSH user must have root / sudo
                  access.
                </FieldDescription>
              </FieldGroup>

              <div className="space-y-3">
                <div>
                  <p className="text-sm font-medium text-foreground">Grant us SSH access</p>
                  <p className="text-sm text-muted-foreground">
                    Run this on your server (as the SSH user above) so we can connect
                    with our fleet key. We never store a password or your private key.
                  </p>
                </div>
                {fleetPublicKey ? (
                  <div className="flex min-w-0 items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded-md border bg-muted px-3 py-2 font-mono text-xs">
                      {authorizedKeysCmd}
                    </code>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={copyCmd}
                    >
                      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                      {copied ? "Copied" : "Copy command"}
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    The platform SSH fleet key isn&apos;t configured yet. Ask your
                    administrator to set <code>SSH_FLEET_PUBLIC_KEY</code>.
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Model access
                </p>
                <ToggleGroup
                  value={[llmMode]}
                  onValueChange={(v) => v[0] && setLlmMode(v[0] as LlmMode)}
                  className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2"
                  spacing={1}
                >
                  <ToggleGroupItem
                    value="managed_credits"
                    variant="outline"
                    className={cn(
                      "h-auto flex-col items-start whitespace-normal p-4 text-left",
                      SELECTED_GLOW
                    )}
                  >
                    <div className="flex items-center gap-2 font-medium text-foreground">
                      <Wallet className="size-4" /> Use our OpenRouter credits
                    </div>
                    <p className="mt-1.5 text-sm text-muted-foreground">
                      Includes 100 starter credits, then pay-as-you-go from your wallet. We
                      mint a per-agent key, no LLM signup needed.
                    </p>
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    value="own_key"
                    variant="outline"
                    className={cn(
                      "h-auto flex-col items-start whitespace-normal p-4 text-left",
                      SELECTED_GLOW
                    )}
                  >
                    <div className="flex items-center gap-2 font-medium text-foreground">
                      <KeyRound className="size-4" /> Bring my own API key
                    </div>
                    <p className="mt-1.5 text-sm text-muted-foreground">
                      Your agent uses your key and is billed directly by your provider. We
                      never charge for usage.
                    </p>
                  </ToggleGroupItem>
                </ToggleGroup>
                {llmMode === "own_key" && (
                  <Field>
                    <FieldLabel htmlFor="byos-key">Your API key</FieldLabel>
                    <Input
                      id="byos-key"
                      type="password"
                      placeholder="sk-or-..."
                      value={ownApiKey}
                      onChange={(e) => setOwnApiKey(e.target.value)}
                    />
                    <FieldDescription>
                      Stored encrypted at rest and only written to your server&apos;s
                      runtime config.
                    </FieldDescription>
                  </Field>
                )}
              </div>
            </div>
          )}

          {step === "agent" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Choose Your Agent</h2>
                <p className="text-sm text-muted-foreground">
                  Pick the runtime that powers your agent.
                </p>
              </div>

              <div className="space-y-2">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Runtime Engine
                </p>
                <ToggleGroup
                  value={[runtime]}
                  onValueChange={(v) => v[0] && setRuntime(v[0] as Runtime)}
                  className="grid w-full grid-cols-1 gap-2 md:grid-cols-2"
                  spacing={1}
                >
                  {RUNTIME_OPTIONS.map((r) => (
                    <ToggleGroupItem
                      key={r.value}
                      value={r.value}
                      variant="outline"
                      className={cn(
                        "h-auto flex-col items-start whitespace-normal p-4 text-left",
                        SELECTED_GLOW
                      )}
                    >
                      <p className="text-sm font-medium text-foreground">{r.label}</p>
                      <p className="text-xs text-muted-foreground">{r.hint}</p>
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                {runtime === "hermes" && (
                  <p className="text-xs text-muted-foreground">
                    Hermes ships with the Open WebUI chat interface bundled. Your server must have
                    at least 2GB RAM to run Hermes and Open WebUI.
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
                  <FieldLabel htmlFor="byos-name">Agent name</FieldLabel>
                  <Input
                    id="byos-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="my-ai-agent"
                    className={cn(name.trim().length >= 2 && "border-ring ring-1 ring-ring")}
                  />
                  {name.trim().length > 0 && (
                    <FieldDescription className="font-mono">slug: {slugPreview || "-"}</FieldDescription>
                  )}
                  {name.trim().length > 0 && name.trim().length < 2 && (
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
                  {AGENT_CATEGORIES.map((cat) => (
                    <ToggleGroupItem
                      key={cat.slug}
                      value={cat.slug}
                      variant="outline"
                      className={cn(
                        "h-auto flex-col items-start whitespace-normal p-3 text-left",
                        SELECTED_GLOW
                      )}
                    >
                      <p className="text-sm font-medium text-foreground">{cat.name}</p>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                        {cat.description}
                      </p>
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
            </div>
          )}

          {step === "billing" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Billing &amp; Review</h2>
                <p className="text-sm text-muted-foreground">
                  A flat management fee: deploy, monitor, restart, and configure your
                  agent. No compute charges (it&apos;s your server).
                </p>
              </div>

              <ToggleGroup
                value={[interval]}
                onValueChange={(v) => v[0] && setInterval(v[0] as BillingInterval)}
                className="grid w-full grid-cols-2 items-stretch gap-4"
                spacing={1}
              >
                {(["month", "year"] as BillingInterval[]).map((iv) => (
                  <ToggleGroupItem
                    key={iv}
                    value={iv}
                    variant="outline"
                    className={cn(
                      "h-full min-h-[7.5rem] flex-col justify-center gap-1 whitespace-normal p-6 text-center",
                      SELECTED_GLOW
                    )}
                  >
                    <p className="text-lg font-semibold text-foreground">
                      {iv === "month" ? "Monthly" : "Yearly"}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {iv === "month" ? "Pay month-to-month" : "Save ~8% (1 month free)"}
                    </p>
                    <Badge
                      className={cn(
                        "mt-2 bg-emerald-500/20 text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-300",
                        iv !== "year" && "invisible"
                      )}
                    >
                      Best Value
                    </Badge>
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <Card size="sm">
                  <CardHeader>
                    <CardDescription className="text-xs uppercase tracking-wide">
                      Server
                    </CardDescription>
                    <p className="font-medium text-foreground">
                      {user.trim() || "root"}@{host.trim() || "-"}
                      {port && port !== "22" ? `:${port}` : ""}
                    </p>
                  </CardHeader>
                  <CardContent>
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      {llmMode === "own_key" ? (
                        <>
                          <KeyRound className="size-3.5" /> Your own API key
                        </>
                      ) : (
                        <>
                          <Wallet className="size-3.5" /> Our OpenRouter credits
                        </>
                      )}
                    </p>
                  </CardContent>
                </Card>
                <Card size="sm">
                  <CardHeader>
                    <CardDescription className="text-xs uppercase tracking-wide">
                      Agent
                    </CardDescription>
                    <p className="font-medium text-foreground">{selectedCategory?.name ?? "-"}</p>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs text-muted-foreground">Runtime: {runtimeLabel}</p>
                  </CardContent>
                </Card>
                <Card size="sm">
                  <CardHeader>
                    <CardDescription className="text-xs uppercase tracking-wide">
                      Project
                    </CardDescription>
                    <p className="font-medium text-foreground">{name || "-"}</p>
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
                      Billing
                    </CardDescription>
                    <p className="font-medium text-foreground">
                      {interval === "year" ? "Yearly" : "Monthly"}
                    </p>
                  </CardHeader>
                </Card>
              </div>

              <Card className="border-ring bg-ring/5">
                <CardContent className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Management fee</span>
                    <span className="text-foreground">
                      ${fee.toLocaleString()}
                      {feeSuffix}
                    </span>
                  </div>
                  <div className="flex justify-between border-t pt-3">
                    <span className="font-semibold text-foreground">Total</span>
                    <span className="text-xl font-bold text-foreground">
                      ${fee.toLocaleString()}
                      <span className="text-sm font-normal text-muted-foreground">
                        {feeSuffix}
                      </span>
                    </span>
                  </div>
                  {llmMode === "managed_credits" && (
                    <p className="text-xs text-muted-foreground">
                      Includes 100 starter credits. Additional LLM usage is metered from
                      your credit wallet.
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Have a promo code? You can apply it at checkout.
                  </p>
                </CardContent>
              </Card>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <Button variant="outline" onClick={prev}>
          Back
        </Button>
        <div className="flex items-center gap-3">
          {step === STEPS[STEPS.length - 1] ? (
            <Button
              variant="gradient"
              size="pill"
              onClick={submit}
              disabled={submitting || !canNext}
            >
              {submitting ? "Connecting..." : "Connect server & continue"}
            </Button>
          ) : (
            <Button variant="gradient" size="pill" onClick={next} disabled={!canNext}>
              Continue
            </Button>
          )}
        </div>
      </div>
    </>
  )
}
