"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Check, Cpu, HardDrive, KeyRound, MemoryStick, Server, Wallet } from "lucide-react"

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
import { AGENT_CATEGORIES, categoryDisplayName } from "@/configs/agent-categories"
import { capacityByRuntime, footprintKey, getFootprint } from "@/configs/agent-footprint"
import {
  BYO_LLM_PROVIDERS,
  getByoProvider,
  requiresHermes,
  type ByoProviderId,
} from "@/configs/llm-providers"
import { cn } from "@/lib/utils"
import { RUNTIME_IDS } from "@/lib/runtimes/ids"
import { RUNTIME_CAPS } from "@/lib/runtimes/labels"
import type { RuntimeId } from "@/lib/runtimes/types"
import { BRANDING } from "@/configs/branding"
import { formatUsd } from "@/configs/plans"

/** The connected server this agent is being installed onto. */
export type InstallServer = {
  id: string
  label: string
  host: string
  port: number
  sshUser: string
  status: string
  hwCpuCores: number | null
  hwRamTotalMb: number | null
  hwDiskTotalGb: number | null
  hwOsName: string | null
  hwOsVersion: string | null
  capacityAgents: number
}

type LlmMode = "managed_credits" | "own_key"
type Runtime = RuntimeId

// The server is already connected and inspected by the time we get here, so
// there is no "Server" step: the flow is about the agent, not the machine.
// Model access is its own step rather than a tail on the server form — it is a
// billing decision, and burying it under an SSH form hid it. There is no
// billing step: the agent's BYOS plan is an available plan the customer already has,
// or is bought at Checkout from the review step's button (see planContext).
type Step = "agent" | "model" | "project" | "review"

const STEPS: Step[] = ["agent", "model", "project", "review"]
const STEP_LABELS: Record<Step, string> = {
  agent: "Agent",
  model: "Model",
  project: "Project",
  review: "Review",
}

const RUNTIME_HINTS: Record<Runtime, string> = {
  openclaw: "Default agent runtime",
  hermes: "Nous Research Hermes (Python)",
  "claude-code": "Anthropic's coding agent, with a browser terminal",
  codex: "OpenAI's coding agent, with a browser terminal",
}

const RUNTIME_OPTIONS: { value: Runtime; label: string; hint: string }[] = RUNTIME_IDS.map(
  (id) => ({ value: id, label: RUNTIME_CAPS[id].label, hint: RUNTIME_HINTS[id] }),
)


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

function gb(mb: number | null): string {
  return mb == null ? "—" : `${Math.round((mb / 1024) * 10) / 10} GB`
}

/**
 * How this install gets its BYOS plan. With an available plan (or a grandfathered
 * per-server plan) it installs straight away; otherwise the button goes to
 * Checkout for a new plan and the agent installs once that is paid.
 */
export type InstallPlanContext = {
  availablePlans: number
  coveredByServerPlan: boolean
  priceMonthly: number
  priceYearly: number
}

export function ByosInstallForm({
  server,
  planContext,
}: {
  server: InstallServer
  planContext: InstallPlanContext
}) {
  /** Footprint key for an engine as BYOS installs it (with its chat UI, if any). */
  const runtimeFootprintKey = (r: Runtime) => footprintKey(r, RUNTIME_CAPS[r].hasSidecar)
  const router = useRouter()

  const [step, setStep] = useState<Step>("agent")
  const [submitting, setSubmitting] = useState(false)
  const needsPayment = !planContext.coveredByServerPlan && planContext.availablePlans === 0
  const [interval, setInterval] = useState<"month" | "year">("month")

  // Agent step
  const [runtime, setRuntime] = useState<Runtime>("openclaw")
  // Engines this account may deploy. Beta engines stay hidden until the server
  // says otherwise (CLI_RUNTIMES_ENABLED, or a platform admin).
  const [availableRuntimes, setAvailableRuntimes] = useState<Runtime[]>(() =>
    RUNTIME_IDS.filter((id) => !RUNTIME_CAPS[id].beta),
  )
  useEffect(() => {
    fetch("/api/runtimes")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => Array.isArray(d?.available) && setAvailableRuntimes(d.available))
      .catch(() => {})
  }, [])

  // Model step
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

  const stepIdx = STEPS.indexOf(step)
  const runtimeLabel = RUNTIME_OPTIONS.find((r) => r.value === runtime)?.label ?? runtime
  const selectedCategory = AGENT_CATEGORIES.find((c) => c.slug === useCase)
  const coreActions = selectedCategory?.examples ? [...selectedCategory.examples] : []
  const slugPreview = deploymentSlug(name)

  // What we measured on this box, against what each runtime needs. Hermes on
  // BYOS always ships a chat UI (agent-create sets webuiEnabled from the
  // runtime), so it is sized with it: "hermes-lite".
  const probed = server.hwCpuCores != null
  const capacity = capacityByRuntime({
    cpuCores: server.hwCpuCores,
    ramTotalMb: server.hwRamTotalMb,
    diskTotalGb: server.hwDiskTotalGb,
  })
  const fitsRuntime = (r: Runtime) => !probed || capacity[runtimeFootprintKey(r)] > 0
  const selectedFootprint = getFootprint(runtimeFootprintKey(runtime))

  // A non-OpenRouter direct key (primary or fallback) only runs on Hermes —
  // OpenClaw's package is hardwired to OpenRouter. When the user picks one, the
  // runtime is forced to Hermes and OpenClaw is disabled on the agent step.
  const ownDef = getByoProvider(ownProvider)
  const forcesHermes =
    llmMode === "own_key" &&
    (requiresHermes(ownProvider) ||
      (fallbackEnabled && requiresHermes(fallbackProvider)))

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (forcesHermes && runtime !== "hermes") setRuntime("hermes")
  }, [forcesHermes, runtime])

  // Model-step completeness for the own-key path.
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
      case "agent":
        return true
      case "model":
        return ownKeyReady
      case "project":
        return name.trim().length >= 2 && !!useCase
      case "review":
        return true
    }
  })()

  function next() {
    if (stepIdx < STEPS.length - 1) setStep(STEPS[stepIdx + 1])
  }
  function prev() {
    if (stepIdx > 0) setStep(STEPS[stepIdx - 1])
    else router.push("/dashboard/byos")
  }

  async function submit() {
    if (!name.trim()) return toast.error("Give your agent a name")
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
          // The server, not a host: the API reads the connection off the
          // connected row so the agent is linked to the machine it lands on.
          byosServerId: server.id,
          // Only used when no plan is available and this install buys one.
          interval,
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
        toast.error(data.error || `Could not install your agent (${res.status})`)
        return
      }
      if (data.checkoutUrl) {
        // Paying for the agent's plan; it installs once that goes through.
        window.location.href = data.checkoutUrl
        return
      } else {
        toast.success("Installing your agent...")
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
      {/* The machine, stated once and not editable here. Changing which server
          an agent goes on means picking a different one from the list. */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-border bg-card px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Server className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium text-foreground">{server.label}</span>
          <span className="truncate font-mono text-xs text-muted-foreground">
            {server.sshUser}@{server.host}
            {server.port !== 22 ? `:${server.port}` : ""}
          </span>
        </div>
        {probed && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Cpu className="size-3.5" />
              {server.hwCpuCores} vCPU
            </span>
            <span className="flex items-center gap-1.5">
              <MemoryStick className="size-3.5" />
              {gb(server.hwRamTotalMb)}
            </span>
            <span className="flex items-center gap-1.5">
              <HardDrive className="size-3.5" />
              {server.hwDiskTotalGb != null ? `${server.hwDiskTotalGb} GB` : "—"}
            </span>
            {server.hwOsName && (
              <span>{`${server.hwOsName} ${server.hwOsVersion ?? ""}`.trim()}</span>
            )}
          </div>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          onClick={() => router.push("/dashboard/byos")}
        >
          Change server
        </Button>
      </div>

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
          {step === "agent" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Choose Your Agent</h2>
                <p className="text-sm text-muted-foreground">
                  Pick the runtime that powers your agent. We size it against the
                  hardware we measured on {server.label}.
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
                    if (forcesHermes && !RUNTIME_CAPS[v[0] as Runtime].supportsCustomBaseUrl) return
                    setRuntime(v[0] as Runtime)
                  }}
                  className="grid w-full grid-cols-1 gap-2 md:grid-cols-2"
                  spacing={1}
                >
                  {RUNTIME_OPTIONS.filter((r) => availableRuntimes.includes(r.value)).map((r) => {
                    const disabled = forcesHermes && !RUNTIME_CAPS[r.value].supportsCustomBaseUrl
                    const fits = fitsRuntime(r.value)
                    const fp = getFootprint(runtimeFootprintKey(r.value))
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
                        <p className="text-sm font-medium text-foreground">
                          {r.label}
                          {RUNTIME_CAPS[r.value].beta && (
                            <span className="ml-2 text-[10px] font-normal text-muted-foreground uppercase">Beta</span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">{r.hint}</p>
                        {fp && (
                          <p
                            className={cn(
                              "mt-1.5 text-xs",
                              probed && !fits ? "text-amber-500" : "text-muted-foreground"
                            )}
                          >
                            Needs ~{fp.vcpu} vCPU · {gb(fp.ramMb)} RAM · {fp.diskGb} GB disk
                            {probed && !fits ? " — tight on this server" : ""}
                          </p>
                        )}
                      </ToggleGroupItem>
                    )
                  })}
                </ToggleGroup>
                {forcesHermes && (
                  <p className="text-xs text-muted-foreground">
                    Your chosen key provider runs on Hermes, so the other engines
                    aren&apos;t available for this agent.
                  </p>
                )}
                {probed && !fitsRuntime(runtime) && selectedFootprint && (
                  <p className="text-xs text-amber-500">
                    {server.label} has {server.hwCpuCores} vCPU and{" "}
                    {gb(server.hwRamTotalMb)} of RAM, which is below what{" "}
                    {selectedFootprint.label}{" "}
                    usually wants once the OS is accounted for. It&apos;s your hardware,
                    so we won&apos;t stop you — but expect it to be slow.
                  </p>
                )}
                {runtime === "hermes" && (
                  <p className="text-xs text-muted-foreground">
                    Hermes runs a Python agent alongside its chat page, which is
                    what makes it the heavier of the two.
                  </p>
                )}
              </div>
            </div>
          )}

          {step === "model" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Model access</h2>
                <p className="text-sm text-muted-foreground">
                  How your agent pays for the model it runs on. This is separate from
                  the management fee — you can change it later from the agent&apos;s
                  page.
                </p>
              </div>

              <div className="space-y-2">
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
                      <p className="text-sm font-medium text-foreground">
                        {categoryDisplayName(cat.slug, runtime)}
                      </p>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                        {cat.description}
                      </p>
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
            </div>
          )}

          {step === "review" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Review</h2>
                <p className="text-sm text-muted-foreground">
                  Covered by {server.label}&apos;s BYOS plan — installing adds nothing to
                  your bill. No compute charges (it&apos;s your server).
                </p>
              </div>


              <div className="grid grid-cols-2 gap-4 text-sm">
                <Card size="sm">
                  <CardHeader>
                    <CardDescription className="text-xs uppercase tracking-wide">
                      Server
                    </CardDescription>
                    <p className="font-medium text-foreground">{server.label}</p>
                  </CardHeader>
                  <CardContent>
                    <p className="truncate font-mono text-xs text-muted-foreground">
                      {server.sshUser}@{server.host}
                      {server.port !== 22 ? `:${server.port}` : ""}
                    </p>
                  </CardContent>
                </Card>
                <Card size="sm">
                  <CardHeader>
                    <CardDescription className="text-xs uppercase tracking-wide">
                      Agent
                    </CardDescription>
                    <p className="font-medium text-foreground">
                      {useCase ? categoryDisplayName(useCase, runtime) : "-"}
                    </p>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs text-muted-foreground">Runtime: {runtimeLabel}</p>
                  </CardContent>
                </Card>
                <Card size="sm">
                  <CardHeader>
                    <CardDescription className="text-xs uppercase tracking-wide">
                      Model
                    </CardDescription>
                    <p className="font-medium text-foreground">
                      {llmMode === "own_key"
                        ? `Your ${ownDef?.label ?? "own"} key`
                        : `${BRANDING.name} Credits`}
                    </p>
                  </CardHeader>
                  <CardContent>
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      {llmMode === "own_key" ? (
                        <>
                          <KeyRound className="size-3.5" />
                          {fallbackEnabled ? "With a fallback key" : "No fallback"}
                        </>
                      ) : (
                        <>
                          <Wallet className="size-3.5" /> Metered from your wallet
                        </>
                      )}
                    </p>
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
              </div>

              <p className="text-xs text-muted-foreground">
                {planContext.coveredByServerPlan
                  ? `Covered by ${server.label}'s server plan.`
                  : planContext.availablePlans > 0
                    ? `Uses 1 of your ${planContext.availablePlans} available BYOS ${
                        planContext.availablePlans === 1 ? "plan" : "plans"
                      }.`
                    : `Needs a BYOS plan: ${formatUsd(planContext.priceMonthly)}/mo or ${formatUsd(
                        planContext.priceYearly,
                      )}/yr. You'll pay at Stripe, and the agent installs as soon as that's done.`}
                {llmMode === "managed_credits" &&
                  ` The first ${BRANDING.name} Credits agent on a plan adds 100 starter credits; LLM usage is metered from your credit wallet.`}
              </p>
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
            <>
              {needsPayment && (
                <ToggleGroup
                  value={[interval]}
                  onValueChange={(v) => v[0] && setInterval(v[0] as "month" | "year")}
                  variant="outline"
                  size="sm"
                  aria-label="Billing interval"
                >
                  <ToggleGroupItem value="month">
                    {formatUsd(planContext.priceMonthly)}/mo
                  </ToggleGroupItem>
                  <ToggleGroupItem value="year">
                    {formatUsd(planContext.priceYearly)}/yr
                  </ToggleGroupItem>
                </ToggleGroup>
              )}
              <Button
                variant="gradient"
                size="pill"
                onClick={submit}
                disabled={submitting || !canNext}
              >
                {needsPayment
                  ? submitting
                    ? "Opening checkout..."
                    : "Continue to payment"
                  : submitting
                    ? "Installing..."
                    : "Install agent"}
              </Button>
            </>
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
