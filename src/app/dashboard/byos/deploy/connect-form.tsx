"use client"

import { useEffect, useState } from "react"
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
import {
  BYO_LLM_PROVIDERS,
  getByoProvider,
  requiresHermes,
  type ByoProviderId,
} from "@/configs/llm-providers"
import { cn } from "@/lib/utils"
import { BRANDING } from "@/configs/branding"

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
  const [ownProvider, setOwnProvider] = useState<ByoProviderId>("openrouter")
  const [ownBaseUrl, setOwnBaseUrl] = useState("")
  const [ownModel, setOwnModel] = useState("")
  // Optional user-supplied fallback (their OWN second key — never our credits).
  const [fallbackEnabled, setFallbackEnabled] = useState(false)
  const [fallbackProvider, setFallbackProvider] = useState<ByoProviderId>("openrouter")
  const [fallbackApiKey, setFallbackApiKey] = useState("")
  const [fallbackBaseUrl, setFallbackBaseUrl] = useState("")

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

  // A non-OpenRouter direct key (primary or fallback) only runs on Hermes —
  // OpenClaw's package is hardwired to OpenRouter. When the user picks one, the
  // runtime is forced to Hermes and OpenClaw is disabled on the agent step.
  const ownDef = getByoProvider(ownProvider)
  const forcesHermes =
    llmMode === "own_key" &&
    (requiresHermes(ownProvider) ||
      (fallbackEnabled && requiresHermes(fallbackProvider)))

  useEffect(() => {
    if (forcesHermes && runtime !== "hermes") setRuntime("hermes")
  }, [forcesHermes, runtime])

  // Server-step completeness for the own-key path.
  const ownKeyReady =
    llmMode !== "own_key" ||
    (ownApiKey.trim().length > 0 &&
      (ownProvider !== "custom" || ownBaseUrl.trim().length > 0) &&
      (!requiresHermes(ownProvider) || ownModel.trim().length > 0) &&
      (!fallbackEnabled ||
        (fallbackApiKey.trim().length > 0 &&
          (fallbackProvider !== "custom" || fallbackBaseUrl.trim().length > 0))))

  const canNext = (() => {
    switch (step) {
      case "server":
        return host.trim().length > 0 && ownKeyReady
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
    if (llmMode === "own_key") {
      if (!ownApiKey.trim())
        return toast.error("Enter your API key, or switch to our credits")
      if (ownProvider === "custom" && !ownBaseUrl.trim())
        return toast.error("Enter the base URL for your custom provider")
      if (requiresHermes(ownProvider) && !ownModel.trim())
        return toast.error(`Enter the model to use with your ${ownDef?.label ?? ownProvider} key`)
      if (fallbackEnabled) {
        if (!fallbackApiKey.trim())
          return toast.error("Enter your fallback key, or remove the fallback")
        if (fallbackProvider === "custom" && !fallbackBaseUrl.trim())
          return toast.error("Enter the base URL for your custom fallback provider")
      }
    }

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
          ownProvider: llmMode === "own_key" ? ownProvider : undefined,
          ownBaseUrl:
            llmMode === "own_key" && ownProvider === "custom"
              ? ownBaseUrl.trim()
              : undefined,
          ownModel:
            llmMode === "own_key" && requiresHermes(ownProvider)
              ? ownModel.trim()
              : undefined,
          fallbackProvider:
            llmMode === "own_key" && fallbackEnabled ? fallbackProvider : undefined,
          fallbackApiKey:
            llmMode === "own_key" && fallbackEnabled ? fallbackApiKey.trim() : undefined,
          fallbackBaseUrl:
            llmMode === "own_key" && fallbackEnabled && fallbackProvider === "custom"
              ? fallbackBaseUrl.trim()
              : undefined,
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
                      <Wallet className="size-4" /> Use {BRANDING.name} Credits
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
                  <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
                    <Field>
                      <FieldLabel>Where is your key from?</FieldLabel>
                      <ToggleGroup
                        value={[ownProvider]}
                        onValueChange={(v) => {
                          if (!v[0]) return
                          const next = v[0] as ByoProviderId
                          setOwnProvider(next)
                          if (requiresHermes(next)) setRuntime("hermes")
                        }}
                        className="grid w-full grid-cols-2 gap-2 sm:grid-cols-3"
                        spacing={1}
                      >
                        {BYO_LLM_PROVIDERS.map((p) => (
                          <ToggleGroupItem
                            key={p.id}
                            value={p.id}
                            variant="outline"
                            className={cn("h-auto justify-start p-2.5 text-left", SELECTED_GLOW)}
                          >
                            <span className="text-sm font-medium text-foreground">{p.label}</span>
                          </ToggleGroupItem>
                        ))}
                      </ToggleGroup>
                      {requiresHermes(ownProvider) && (
                        <FieldDescription>
                          Direct provider keys run on the Hermes runtime — we&apos;ve set
                          your runtime to Hermes.
                        </FieldDescription>
                      )}
                    </Field>

                    {ownProvider === "custom" && (
                      <Field>
                        <FieldLabel htmlFor="byos-base-url">Base URL</FieldLabel>
                        <Input
                          id="byos-base-url"
                          placeholder="https://api.example.com/v1"
                          value={ownBaseUrl}
                          onChange={(e) => setOwnBaseUrl(e.target.value)}
                        />
                        <FieldDescription>
                          An OpenAI-compatible endpoint (must be a public https URL).
                        </FieldDescription>
                      </Field>
                    )}

                    <Field>
                      <FieldLabel htmlFor="byos-key">Your API key</FieldLabel>
                      <Input
                        id="byos-key"
                        type="password"
                        placeholder={ownDef?.apiKeyPlaceholder ?? "your-api-key"}
                        value={ownApiKey}
                        onChange={(e) => setOwnApiKey(e.target.value)}
                      />
                      <FieldDescription>
                        Stored encrypted at rest and only written to your server&apos;s
                        runtime config.
                      </FieldDescription>
                    </Field>

                    {requiresHermes(ownProvider) && (
                      <Field>
                        <FieldLabel htmlFor="byos-model">Model</FieldLabel>
                        <Input
                          id="byos-model"
                          placeholder="e.g. gpt-5.5"
                          value={ownModel}
                          onChange={(e) => setOwnModel(e.target.value)}
                        />
                        <FieldDescription>
                          The exact model id for your provider — we can&apos;t default it
                          for a direct provider.
                        </FieldDescription>
                      </Field>
                    )}

                    {/* Optional user-supplied fallback — the user's OWN second key. */}
                    {!fallbackEnabled ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setFallbackEnabled(true)}
                      >
                        + Add a fallback key
                      </Button>
                    ) : (
                      <div className="space-y-4 rounded-md border border-dashed p-3">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium text-foreground">Fallback key</p>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setFallbackEnabled(false)}
                          >
                            Remove
                          </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Your own second key. If your primary key fails, switch to it from
                          the agent&apos;s page — we never fall back to our credits.
                        </p>
                        <Field>
                          <FieldLabel>Fallback provider</FieldLabel>
                          <ToggleGroup
                            value={[fallbackProvider]}
                            onValueChange={(v) => {
                              if (!v[0]) return
                              const next = v[0] as ByoProviderId
                              setFallbackProvider(next)
                              if (requiresHermes(next)) setRuntime("hermes")
                            }}
                            className="grid w-full grid-cols-2 gap-2 sm:grid-cols-3"
                            spacing={1}
                          >
                            {BYO_LLM_PROVIDERS.map((p) => (
                              <ToggleGroupItem
                                key={p.id}
                                value={p.id}
                                variant="outline"
                                className={cn(
                                  "h-auto justify-start p-2.5 text-left",
                                  SELECTED_GLOW
                                )}
                              >
                                <span className="text-sm font-medium text-foreground">
                                  {p.label}
                                </span>
                              </ToggleGroupItem>
                            ))}
                          </ToggleGroup>
                        </Field>
                        {fallbackProvider === "custom" && (
                          <Field>
                            <FieldLabel htmlFor="byos-fallback-base-url">Base URL</FieldLabel>
                            <Input
                              id="byos-fallback-base-url"
                              placeholder="https://api.example.com/v1"
                              value={fallbackBaseUrl}
                              onChange={(e) => setFallbackBaseUrl(e.target.value)}
                            />
                          </Field>
                        )}
                        <Field>
                          <FieldLabel htmlFor="byos-fallback-key">Fallback API key</FieldLabel>
                          <Input
                            id="byos-fallback-key"
                            type="password"
                            placeholder={
                              getByoProvider(fallbackProvider)?.apiKeyPlaceholder ?? "your-api-key"
                            }
                            value={fallbackApiKey}
                            onChange={(e) => setFallbackApiKey(e.target.value)}
                          />
                        </Field>
                      </div>
                    )}
                  </div>
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
                  onValueChange={(v) => {
                    if (!v[0]) return
                    // A direct-provider key forces Hermes — ignore attempts to
                    // switch back to OpenClaw.
                    if (forcesHermes && v[0] !== "hermes") return
                    setRuntime(v[0] as Runtime)
                  }}
                  className="grid w-full grid-cols-1 gap-2 md:grid-cols-2"
                  spacing={1}
                >
                  {RUNTIME_OPTIONS.map((r) => {
                    const disabled = forcesHermes && r.value !== "hermes"
                    return (
                      <ToggleGroupItem
                        key={r.value}
                        value={r.value}
                        variant="outline"
                        disabled={disabled}
                        className={cn(
                          "h-auto flex-col items-start whitespace-normal p-4 text-left",
                          SELECTED_GLOW,
                          disabled && "opacity-50"
                        )}
                      >
                        <p className="text-sm font-medium text-foreground">{r.label}</p>
                        <p className="text-xs text-muted-foreground">{r.hint}</p>
                      </ToggleGroupItem>
                    )
                  })}
                </ToggleGroup>
                {forcesHermes && (
                  <p className="text-xs text-muted-foreground">
                    Your chosen key provider runs on Hermes, so OpenClaw isn&apos;t
                    available for this agent.
                  </p>
                )}
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
                          <KeyRound className="size-3.5" /> Your {ownDef?.label ?? "own"} key
                          {fallbackEnabled ? " (+ fallback)" : ""}
                        </>
                      ) : (
                        <>
                          <Wallet className="size-3.5" /> {BRANDING.name} Credits
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
