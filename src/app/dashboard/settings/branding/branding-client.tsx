"use client"

import { useCallback, useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PageContainer, PageHeader } from "@/components/layout/page-container"

export type BrandingState = {
  brandName: string
  supportEmail: string
  logoUrl: string
  logoMarkUrl: string
  faviconUrl: string
  primaryLight: string
  accentLight: string
  primaryDark: string
  accentDark: string
  brandingEnabled: boolean
}

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

function ColorInput({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  // The native picker only emits hex; the text field accepts hex/rgb too.
  const swatch = HEX_RE.test(value.trim()) ? value.trim() : "#015efe"
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} swatch`}
          value={swatch}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-10 shrink-0 cursor-pointer rounded-md border border-input bg-transparent p-1"
        />
        <Input
          value={value}
          placeholder="#015efe"
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </Field>
  )
}

function AssetField({
  label,
  hint,
  value,
  onChange,
  onUpload,
}: {
  label: string
  hint?: string
  value: string
  onChange: (v: string) => void
  onUpload: (file: File) => Promise<void>
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <div className="flex gap-2">
        <Input
          value={value}
          placeholder="https://… or upload an image"
          onChange={(e) => onChange(e.target.value)}
        />
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/x-icon,image/vnd.microsoft.icon"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0]
            if (!f) return
            setBusy(true)
            try {
              await onUpload(f)
            } finally {
              setBusy(false)
              if (inputRef.current) inputRef.current.value = ""
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? "Uploading…" : "Upload"}
        </Button>
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </Field>
  )
}

type DomainStatus = {
  connected: boolean
  domain?: string
  verified?: boolean
  dnsStatus?: string | null
  tlsStatus?: string | null
  cnameTarget?: string
  txt?: { name: string; value: string }
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <Badge variant={ok ? "default" : "secondary"} className="font-normal">
      {ok ? "✓ " : "… "}
      {label}
    </Badge>
  )
}

function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(value)
          toast.success("Copied")
        }}
        className="truncate rounded-md border bg-muted/40 px-2 py-1.5 text-left font-mono text-xs hover:bg-muted"
        title="Click to copy"
      >
        {value}
      </button>
    </div>
  )
}

function CustomDomainCard() {
  const [status, setStatus] = useState<DomainStatus | null>(null)
  const [domain, setDomain] = useState("")
  const [pending, startTransition] = useTransition()

  const refresh = useCallback(async () => {
    const res = await fetch("/api/team/branding/domain/status")
    if (res.ok) setStatus(await res.json())
  }, [])

  useEffect(() => {
    // Initial load: setState runs only after the fetch resolves (async), so
    // there's no synchronous cascading render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
  }, [refresh])

  // Poll while connected but not fully live.
  useEffect(() => {
    if (!status?.connected) return
    if (status.verified && status.tlsStatus === "issued") return
    const t = setInterval(() => void refresh(), 8000)
    return () => clearInterval(t)
  }, [status, refresh])

  function connect() {
    startTransition(async () => {
      const res = await fetch("/api/team/branding/domain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error(data?.error ?? "Failed to connect domain")
        return
      }
      toast.success("Domain connected. Add the DNS records below.")
      await refresh()
    })
  }

  function verify() {
    startTransition(async () => {
      const res = await fetch("/api/team/branding/domain/verify", { method: "POST" })
      const data = await res.json().catch(() => null)
      if (data?.verified) toast.success("Domain ownership verified")
      else toast.error(data?.reason ?? "Verification failed. Check the TXT record.")
      await refresh()
    })
  }

  function remove() {
    startTransition(async () => {
      const res = await fetch("/api/team/branding/domain", { method: "DELETE" })
      if (!res.ok) {
        toast.error("Failed to remove domain")
        return
      }
      toast.success("Domain removed")
      setStatus({ connected: false })
      setDomain("")
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Custom domain</CardTitle>
        <CardDescription>
          Serve the dashboard on your own domain (e.g. app.yourbrand.com).
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!status?.connected ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <Field className="flex-1">
              <FieldLabel>Domain</FieldLabel>
              <Input
                value={domain}
                placeholder="app.yourbrand.com"
                onChange={(e) => setDomain(e.target.value)}
              />
            </Field>
            <Button onClick={connect} disabled={pending || !domain.trim()}>
              {pending ? "Connecting…" : "Connect domain"}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm">{status.domain}</span>
              <StatusPill ok={!!status.verified} label="Ownership" />
              <StatusPill ok={status.dnsStatus === "ready"} label="DNS" />
              <StatusPill ok={status.tlsStatus === "issued"} label="TLS" />
            </div>

            {!status.verified && status.txt && (
              <div className="rounded-lg border p-4 space-y-3">
                <p className="text-sm font-medium">1. Prove ownership</p>
                <p className="text-xs text-muted-foreground">
                  Add this TXT record at your DNS host, then click Verify.
                </p>
                <CopyRow label="TXT name" value={status.txt.name} />
                <CopyRow label="TXT value" value={status.txt.value} />
                <Button size="sm" onClick={verify} disabled={pending}>
                  {pending ? "Checking…" : "Verify"}
                </Button>
              </div>
            )}

            {status.cnameTarget && (
              <div className="rounded-lg border p-4 space-y-3">
                <p className="text-sm font-medium">2. Point your domain</p>
                <p className="text-xs text-muted-foreground">
                  Add a CNAME record for{" "}
                  <span className="font-mono">{status.domain}</span> pointing to:
                </p>
                <CopyRow label="CNAME target" value={status.cnameTarget} />
                {status.verified && status.tlsStatus === "issued" && (
                  <p className="text-xs text-foreground">
                    Your domain is live. 🎉
                  </p>
                )}
              </div>
            )}

            <Button variant="destructive" size="sm" onClick={remove} disabled={pending}>
              Remove domain
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function BrandingClient({ initial }: { initial: BrandingState }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [s, setS] = useState<BrandingState>(initial)

  const set = <K extends keyof BrandingState>(key: K, value: BrandingState[K]) =>
    setS((prev) => ({ ...prev, [key]: value }))

  async function uploadAsset(
    kind: "logo" | "logoMark" | "favicon",
    field: keyof BrandingState,
    file: File,
  ) {
    const fd = new FormData()
    fd.append("kind", kind)
    fd.append("file", file)
    const res = await fetch("/api/team/branding/logo", { method: "POST", body: fd })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      toast.error(data?.error ?? "Upload failed")
      return
    }
    // The upload route already persisted the URL field; mirror it locally and
    // refresh so the live dashboard (sidebar/favicon) picks it up immediately.
    set(field, data.url as string)
    toast.success("Uploaded")
    router.refresh()
  }

  function save() {
    startTransition(async () => {
      const res = await fetch("/api/team/branding", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(s),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        toast.error(data?.error ?? "Failed to save branding")
        return
      }
      toast.success("Branding saved")
      router.refresh()
    })
  }

  const previewColor = HEX_RE.test(s.primaryLight.trim()) ? s.primaryLight.trim() : "#015efe"

  return (
    <PageContainer>
      <PageHeader
        title="Branding"
        description="White-label your team's dashboard. End-users on your custom domain see your brand instead of SovereignML."
        actions={
          <Button onClick={save} disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Brand identity</CardTitle>
          <CardDescription>
            Name, logos, and support email shown across the dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel>Brand name</FieldLabel>
              <Input
                value={s.brandName}
                placeholder="SovereignML"
                maxLength={60}
                onChange={(e) => set("brandName", e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel>Support email</FieldLabel>
              <Input
                type="email"
                value={s.supportEmail}
                placeholder="support@yourbrand.com"
                onChange={(e) => set("supportEmail", e.target.value)}
              />
            </Field>
            <AssetField
              label="Logo (expanded)"
              hint="Shown in the sidebar header. Upload an image or paste an https URL."
              value={s.logoUrl}
              onChange={(v) => set("logoUrl", v)}
              onUpload={(f) => uploadAsset("logo", "logoUrl", f)}
            />
            <AssetField
              label="Logo mark (collapsed icon)"
              hint="Square mark shown when the sidebar is collapsed."
              value={s.logoMarkUrl}
              onChange={(v) => set("logoMarkUrl", v)}
              onUpload={(f) => uploadAsset("logoMark", "logoMarkUrl", f)}
            />
            <AssetField
              label="Favicon"
              hint="Browser tab icon. PNG, SVG, or ICO."
              value={s.faviconUrl}
              onChange={(v) => set("faviconUrl", v)}
              onUpload={(f) => uploadAsset("favicon", "faviconUrl", f)}
            />
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Theme colors</CardTitle>
          <CardDescription>
            Primary brand color and highlight accent, per light and dark mode.
            Accepts hex (#015efe) or rgb().
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            <ColorInput
              label="Primary (light)"
              value={s.primaryLight}
              onChange={(v) => set("primaryLight", v)}
            />
            <ColorInput
              label="Accent (light)"
              value={s.accentLight}
              onChange={(v) => set("accentLight", v)}
            />
            <ColorInput
              label="Primary (dark)"
              value={s.primaryDark}
              onChange={(v) => set("primaryDark", v)}
            />
            <ColorInput
              label="Accent (dark)"
              value={s.accentDark}
              onChange={(v) => set("accentDark", v)}
            />
          </div>

          <div className="mt-6 rounded-lg border p-4">
            <p className="mb-3 text-xs font-medium text-muted-foreground">Preview</p>
            <div className="flex items-center gap-3">
              {s.logoUrl.trim() ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={s.logoUrl.trim()}
                  alt={s.brandName || "Logo"}
                  className="h-7 w-auto max-w-[160px] object-contain"
                />
              ) : (
                <span className="text-lg font-semibold tracking-tight">
                  {s.brandName || "SovereignML"}
                </span>
              )}
              <span
                className="rounded-md px-3 py-1.5 text-sm font-medium text-white"
                style={{ backgroundColor: previewColor }}
              >
                Primary button
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      <CustomDomainCard />

      <Card>
        <CardHeader>
          <CardTitle>Status</CardTitle>
          <CardDescription>
            Turn white-label off to temporarily revert your team to the default
            SovereignML look without deleting this configuration.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <input
              id="brandingEnabled"
              type="checkbox"
              checked={s.brandingEnabled}
              onChange={(e) => set("brandingEnabled", e.target.checked)}
              className="size-4 rounded border-input"
            />
            <Label htmlFor="brandingEnabled">White-label branding enabled</Label>
          </div>
        </CardContent>
      </Card>
    </PageContainer>
  )
}
