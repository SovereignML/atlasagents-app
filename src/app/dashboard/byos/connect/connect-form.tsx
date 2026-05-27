"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Check, Copy, KeyRound, Server, Wallet } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"

type LlmMode = "managed_credits" | "own_key"
type BillingInterval = "month" | "year"

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

  const [name, setName] = useState("")
  const [host, setHost] = useState("")
  const [port, setPort] = useState("22")
  const [user, setUser] = useState("root")
  const [llmMode, setLlmMode] = useState<LlmMode>("managed_credits")
  const [ownApiKey, setOwnApiKey] = useState("")
  const [interval, setInterval] = useState<BillingInterval>("month")
  const [submitting, setSubmitting] = useState(false)
  const [copied, setCopied] = useState(false)

  const authorizedKeysCmd = fleetPublicKey
    ? `mkdir -p ~/.ssh && echo '${fleetPublicKey}' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`
    : ""

  async function copyCmd() {
    if (!authorizedKeysCmd) return
    try {
      await navigator.clipboard.writeText(authorizedKeysCmd)
      setCopied(true)
      toast.success("Command copied")
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Couldn't copy — select and copy manually")
    }
  }

  async function submit() {
    if (!name.trim()) return toast.error("Give your agent a name")
    if (!host.trim()) return toast.error("Enter your server's host / IP")
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
          agentConfig: { use_case: name.trim(), deployment_target: "byos", runtime: "openclaw" },
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || "Could not connect your server")
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

  const fee = interval === "year" ? priceYearly : priceMonthly
  const feeSuffix = interval === "year" ? "/yr" : "/mo"

  return (
    <div className="space-y-6">
      {/* 1. Agent + server details */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="size-4" /> Your server
          </CardTitle>
          <CardDescription>
            We install and manage the agent on a server you own. Nothing is
            provisioned on our side.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="byos-name">Agent name</FieldLabel>
              <Input
                id="byos-name"
                placeholder="My support agent"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
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
        </CardContent>
      </Card>

      {/* 2. Grant SSH access */}
      <Card>
        <CardHeader>
          <CardTitle>Grant us SSH access</CardTitle>
          <CardDescription>
            Run this on your server (as the SSH user above) so we can connect
            with our fleet key. We never store a password or your private key.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {fleetPublicKey ? (
            <>
              <pre className="overflow-x-auto rounded-md border bg-muted/50 p-3 text-xs leading-relaxed">
                {authorizedKeysCmd}
              </pre>
              <Button type="button" variant="outline" size="sm" onClick={copyCmd}>
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                {copied ? "Copied" : "Copy command"}
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              The platform SSH fleet key isn&apos;t configured yet. Ask your
              administrator to set <code>SSH_FLEET_PUBLIC_KEY</code>.
            </p>
          )}
        </CardContent>
      </Card>

      {/* 3. LLM choice */}
      <Card>
        <CardHeader>
          <CardTitle>Model access</CardTitle>
          <CardDescription>
            Choose how your agent reaches the LLM.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <ChoiceCard
              active={llmMode === "managed_credits"}
              onClick={() => setLlmMode("managed_credits")}
              icon={<Wallet className="size-4" />}
              title="Use our OpenRouter credits"
              body="Pay-as-you-go from your credit wallet. We mint a per-agent key — no LLM signup needed."
            />
            <ChoiceCard
              active={llmMode === "own_key"}
              onClick={() => setLlmMode("own_key")}
              icon={<KeyRound className="size-4" />}
              title="Bring my own API key"
              body="Your agent uses your key and is billed directly by your provider. We never charge for usage."
            />
          </div>
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
        </CardContent>
      </Card>

      {/* 4. Fee + submit */}
      <Card>
        <CardHeader>
          <CardTitle>Management fee</CardTitle>
          <CardDescription>
            A flat fee for the management panel — deploy, monitor, restart, and
            configure your agent. No compute charges (it&apos;s your server).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <ToggleGroup
              value={[interval]}
              onValueChange={(v) => v[0] && setInterval(v[0] as BillingInterval)}
              spacing={1}
            >
              <ToggleGroupItem value="month" variant="outline">
                Monthly
              </ToggleGroupItem>
              <ToggleGroupItem value="year" variant="outline">
                Yearly
              </ToggleGroupItem>
            </ToggleGroup>
            <div className="text-right">
              <div className="text-2xl font-bold tracking-tight">
                ${fee.toLocaleString()}
                <span className="text-sm font-normal text-muted-foreground">
                  {feeSuffix}
                </span>
              </div>
              {llmMode === "managed_credits" && (
                <div className="text-xs text-muted-foreground">+ usage from wallet</div>
              )}
            </div>
          </div>
          <Button className="w-full" onClick={submit} disabled={submitting}>
            {submitting ? "Connecting..." : "Connect server & continue"}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

function ChoiceCard({
  active,
  onClick,
  icon,
  title,
  body,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  title: string
  body: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-lg border p-4 text-left transition-colors",
        active
          ? "border-primary ring-1 ring-primary bg-primary/5"
          : "border-border hover:border-foreground/30",
      )}
    >
      <div className="flex items-center gap-2 font-medium">
        {icon}
        {title}
      </div>
      <p className="mt-1.5 text-sm text-muted-foreground">{body}</p>
    </button>
  )
}
