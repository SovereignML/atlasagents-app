"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Check, Copy, Loader2, ShieldAlert, TriangleAlert } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { cn } from "@/lib/utils"

type Issue = { code: string; message: string; fix: string | null }

/**
 * Connect a server the customer already owns.
 *
 * Deliberately just the connection: host, port, user. No plan, no payment, no
 * agent configuration. We check the machine and show them what we found; they
 * choose an agent afterwards, and that is when anything is charged.
 */
export function ConnectServerForm({
  fleetPublicKey,
  prebakeEnabled = false,
}: {
  fleetPublicKey: string | null
  /** BYOS_PREBAKE_ENABLED: offer to preinstall in the background after connecting. */
  prebakeEnabled?: boolean
}) {
  const router = useRouter()
  const [host, setHost] = useState("")
  const [port, setPort] = useState("22")
  const [sshUser, setSshUser] = useState("root")
  const [label, setLabel] = useState("")
  const [prebakeConsent, setPrebakeConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [blockers, setBlockers] = useState<Issue[]>([])
  const [conflicts, setConflicts] = useState<Issue[]>([])

  const portNum = Number(port)
  const portValid = Number.isInteger(portNum) && portNum >= 1 && portNum <= 65535
  const canSubmit = host.trim().length > 0 && portValid && !busy

  async function copyKey() {
    if (!fleetPublicKey) return
    try {
      await navigator.clipboard.writeText(fleetPublicKey)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Couldn't copy — select the key and copy it manually")
    }
  }

  async function submit() {
    if (!canSubmit) return
    setBusy(true)
    setBlockers([])
    setConflicts([])
    try {
      const res = await fetch("/api/byos/servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          host: host.trim(),
          port: portNum,
          sshUser: sshUser.trim() || "root",
          label: label.trim() || undefined,
          ...(prebakeEnabled ? { prebakeConsent } : {}),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setBlockers(data.blockers ?? [])
        setConflicts(data.conflicts ?? [])
        toast.error(data.error ?? "Couldn't connect to that server")
        return
      }
      setConflicts(data.conflicts ?? [])
      toast.success(
        prebakeEnabled && prebakeConsent
          ? "Server connected — preinstalling in the background, nothing charged"
          : "Server connected — nothing was installed or charged",
      )
      router.push("/dashboard/byos")
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't connect to that server")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid grid-cols-1 gap-[18px] lg:grid-cols-[minmax(0,1fr)_340px] items-start">
      <div className="space-y-[18px]">
        {/* Step 1 — the key they have to install */}
        <div className="rounded-2xl border border-border bg-card p-6">
          <h2 className="text-lg font-semibold text-foreground">1. Give us access</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Add this public key to <code className="font-mono text-xs">~/.ssh/authorized_keys</code>{" "}
            for the user we should log in as. That is the only change you make — there is no
            agent or daemon to install, and we never ask for a password or a key of your own.
          </p>

          {fleetPublicKey ? (
            <div className="mt-4">
              <div className="relative rounded-lg border border-border bg-muted/40 p-3">
                <code className="block break-all pr-10 font-mono text-xs text-foreground">
                  {fleetPublicKey}
                </code>
                <Button
                  size="icon"
                  variant="ghost"
                  className="absolute right-2 top-2 h-7 w-7"
                  onClick={copyKey}
                  aria-label="Copy public key"
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>
          ) : (
            <p className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              The platform SSH key isn&apos;t configured, so servers can&apos;t be connected yet.
              Contact support.
            </p>
          )}
        </div>

        {/* Step 2 — where it is */}
        <div className="rounded-2xl border border-border bg-card p-6">
          <h2 className="text-lg font-semibold text-foreground">2. Where is it?</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            We&apos;ll connect, check the machine, and show you its specs. Nothing is installed
            and nothing is charged at this step.
          </p>

          <FieldGroup className="mt-4">
            <Field>
              <FieldLabel htmlFor="byos-host">Hostname or IP</FieldLabel>
              <Input
                id="byos-host"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="203.0.113.10 or server.example.com"
                autoComplete="off"
                spellCheck={false}
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel htmlFor="byos-port">SSH port</FieldLabel>
                <Input
                  id="byos-port"
                  value={port}
                  inputMode="numeric"
                  onChange={(e) => setPort(e.target.value)}
                  className={cn(!portValid && port !== "" && "border-destructive")}
                />
                {!portValid && port !== "" && (
                  <FieldDescription className="text-destructive">
                    Must be between 1 and 65535.
                  </FieldDescription>
                )}
              </Field>
              <Field>
                <FieldLabel htmlFor="byos-user">SSH user</FieldLabel>
                <Input
                  id="byos-user"
                  value={sshUser}
                  onChange={(e) => setSshUser(e.target.value)}
                  placeholder="root"
                  autoComplete="off"
                />
                <FieldDescription>Needs root, or passwordless sudo.</FieldDescription>
              </Field>
            </div>

            <Field>
              <FieldLabel htmlFor="byos-label">Name (optional)</FieldLabel>
              <Input
                id="byos-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={host.trim() || "prod-1"}
              />
            </Field>
          </FieldGroup>

          {prebakeEnabled && (
            <label className="mt-5 flex items-start gap-3 rounded-lg border border-border p-4 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-primary"
                checked={prebakeConsent}
                onChange={(e) => setPrebakeConsent(e.target.checked)}
              />
              <span>
                <span className="font-medium text-foreground">Preinstall now so deploying is faster</span>
                <span className="mt-1 block text-muted-foreground">
                  We&apos;ll install system packages, Caddy, Node.js and the Hermes engine on this server in the
                  background, before you add an agent. Only tick this if the server isn&apos;t running anything else
                  you depend on: Atlas Agents can&apos;t take full responsibility for software already on a shared
                  machine. If the server already runs a web server or uses port 443, we skip this and install at
                  deploy time instead.
                </span>
              </span>
            </label>
          )}

          {blockers.length > 0 && (
            <div className="mt-5 rounded-lg border border-destructive/40 bg-destructive/10 p-4">
              <p className="flex items-center gap-2 text-sm font-medium text-destructive">
                <ShieldAlert className="h-4 w-4" />
                We can&apos;t run an agent on this server
              </p>
              <ul className="mt-3 space-y-3">
                {blockers.map((b) => (
                  <li key={b.code} className="text-sm">
                    <p className="text-foreground">{b.message}</p>
                    {b.fix && <p className="mt-0.5 text-muted-foreground">{b.fix}</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {conflicts.length > 0 && (
            <div className="mt-5 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
              <p className="flex items-center gap-2 text-sm font-medium text-amber-600 dark:text-amber-400">
                <TriangleAlert className="h-4 w-4" />
                Worth knowing before you install an agent
              </p>
              <ul className="mt-3 space-y-3">
                {conflicts.map((c) => (
                  <li key={c.code} className="text-sm">
                    <p className="text-foreground">{c.message}</p>
                    {c.fix && <p className="mt-0.5 text-muted-foreground">{c.fix}</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-6 flex items-center gap-3">
            <Button onClick={submit} disabled={!canSubmit || !fleetPublicKey}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {busy ? "Checking the server…" : "Connect server"}
            </Button>
            <span className="text-sm text-muted-foreground">Free — you&apos;re not charged to connect.</span>
          </div>
        </div>
      </div>

      <aside className="rounded-2xl border border-border bg-card p-6">
        <h3 className="text-sm font-semibold text-foreground">What we check</h3>
        <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
          <li>That we can log in with the key above</li>
          <li>Operating system and CPU architecture</li>
          <li>CPU, memory and disk — the real numbers</li>
          <li>Whether ports 80 and 443 are free</li>
          <li>Anything already installed we&apos;d disturb</li>
        </ul>
        <p className="mt-4 border-t border-border pt-4 text-sm text-muted-foreground">
          Requires Ubuntu or Debian on 64-bit x86, and a login with root or passwordless sudo.
        </p>
      </aside>
    </div>
  )
}
