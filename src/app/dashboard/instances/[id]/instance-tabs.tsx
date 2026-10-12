"use client"

import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import {
  Check,
  Cloud,
  CloudUpload,
  Copy,
  Cpu,
  ExternalLink,
  Eye,
  HardDrive,
  Link2,
  Loader2,
  MemoryStick,
  RefreshCw,
  RotateCcw,
  Trash2,
  Unlink,
} from "lucide-react"
import { toast } from "sonner"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
} from "@/components/ui/card"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"
import { buildPublicGatewayUrl } from "@/lib/instance-gateway-access"
import Plan from "@/components/ui/agent-plan"
import { buildDeploymentTasks } from "@/lib/deployment-stages"
import { AutoRefresh } from "@/components/dashboard/auto-refresh"
import { HeartbeatBar, type HeartbeatSample } from "@/components/dashboard/heartbeat-bar"
import { AccessTab } from "./instance-access-tab"
import { ToolsTab } from "./instance-tools-tab"
import { SkillsTab } from "./instance-skills-tab"
import { FilesTab } from "./instance-files-browser"
import { BRANDING } from "@/configs/branding"
import { runtimeCaps } from "@/lib/runtimes/labels"
// Was a hand-maintained copy of this list living in this file, which drifted
// the moment the real catalog changed — it still offered the retired
// "Content Agent". Import the source of truth instead.
import { AGENT_CATEGORIES, categoryDisplayName } from "@/configs/agent-categories"

type InstanceLite = {
  id: string
  name: string
  status: string
  ipAddress: string | null
  serverLabel: string
  vcpu: number
  ramGb: number
  createdAt: string
  domain: string | null
  managedSubdomain: string | null
  dnsStatus: string | null
  tlsStatus: string | null
  domainProxied: boolean
  cfZoneId: string | null
  openclawAdminEmail: string | null
  hasOpenclawPassword: boolean
  hasRootPassword: boolean
  hasGatewayToken: boolean
  deploymentTarget: string | null
  provisionStage: string | null
  agentType: string | null
  customInstructions: string
  runtime: string | null
  runtimeLabel: string
  webuiEnabled: boolean
  byosHost: string | null
  byosPort: number | null
  byosUser: string | null
  byosLlmMode: string | null
  costUsd: number
  lastEventAt: string | null
  hwCpuCores: number | null
  hwCpuLoad1: number | null
  hwRamTotalMb: number | null
  hwRamUsedMb: number | null
  hwDiskTotalGb: number | null
  hwDiskUsedGb: number | null
  hwOsName: string | null
  hwOsVersion: string | null
  hwKernel: string | null
  hwUptimeSec: number | null
  hwHealth: string | null
  hwCheckedAt: string | null
  hwError: string | null
}

type LogLite = { id: string; level: string; message: string; createdAt: string }

type StatusPayload = {
  status: string
  ipAddress: string | null
  dnsStatus: string | null
  tlsStatus: string | null
  managedSubdomain: string | null
  provisionStage: string | null
  logs: LogLite[]
}

type BackupLite = {
  id: string
  fileName: string
  agentName: string
  sizeBytes: number | null
  createdAt: string
}

type DriveInfo = {
  configured: boolean
  connected: boolean
  email: string | null
}

type CloudflareInfo = {
  connected: boolean
}

type KumaInfo = {
  /** Whether the operator has configured Uptime Kuma (env set). Card hidden when false. */
  configured: boolean
  status: string | null
  responseTimeMs: number | null
  uptimeRatio: number | null
  certDaysRemaining: number | null
  checkedAt: string | null
  /** Recent heartbeat history (oldest→newest) for the Kuma-style bar strip. */
  samples: HeartbeatSample[]
}

type CfZone = { id: string; name: string; status: string }

type AccessControl = {
  level: "viewer" | "operator" | "manager" | null
  canOperate: boolean
  canManageAccess: boolean
  isOwnerLike: boolean
}

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "monitoring", label: "Monitoring" },
  { id: "controls", label: "Controls" },
  { id: "tools", label: "Tools" },
  { id: "skills", label: "Skills" },
  { id: "files", label: "Files" },
  { id: "interfaces", label: "Interfaces" },
  { id: "backup", label: "Backup" },
  { id: "logs", label: "Logs" },
  { id: "danger", label: "Danger Zone" },
] as const

function useInstancePolling(initialInstance: InstanceLite, initialLogs: LogLite[]) {
  const [status, setStatus] = useState(initialInstance.status)
  const [ipAddress, setIpAddress] = useState(initialInstance.ipAddress)
  const [dnsStatus, setDnsStatus] = useState(initialInstance.dnsStatus)
  const [tlsStatus, setTlsStatus] = useState(initialInstance.tlsStatus)
  const [managedSubdomain, setManagedSubdomain] = useState(initialInstance.managedSubdomain)
  const [provisionStage, setProvisionStage] = useState(initialInstance.provisionStage)
  const [logs, setLogs] = useState(initialLogs)
  const router = useRouter()
  const prevStatus = useRef(initialInstance.status)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setManagedSubdomain(initialInstance.managedSubdomain)
  }, [initialInstance.managedSubdomain])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProvisionStage(initialInstance.provisionStage)
  }, [initialInstance.provisionStage])

  const isPolling =
    status === "pending" || status === "provisioning" || status === "deleting"

  useEffect(() => {
    if (!isPolling) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    async function poll() {
      try {
        const r = await fetch(`/api/instances/${initialInstance.id}/status`, { cache: "no-store" })
        if (!r.ok || cancelled) return
        const data: StatusPayload = await r.json()
        setStatus(data.status)
        setIpAddress(data.ipAddress)
        setDnsStatus(data.dnsStatus)
        setTlsStatus(data.tlsStatus)
        setManagedSubdomain(data.managedSubdomain)
        setProvisionStage(data.provisionStage ?? null)
        setLogs(data.logs)

        const wasTransient =
          prevStatus.current === "pending" ||
          prevStatus.current === "provisioning" ||
          prevStatus.current === "deleting"
        const nowTransient =
          data.status === "pending" ||
          data.status === "provisioning" ||
          data.status === "deleting"
        if (!nowTransient && wasTransient) {
          prevStatus.current = data.status
          router.refresh()
          return
        }
      } catch {
        /* network error — retry next interval */
      }
      if (!cancelled) {
        timer = setTimeout(poll, 2_000)
      }
    }

    timer = setTimeout(poll, 1_000)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [initialInstance.id, isPolling, router])

  return {
    instance: {
      ...initialInstance,
      status,
      ipAddress,
      dnsStatus,
      tlsStatus,
      managedSubdomain,
      provisionStage,
    },
    logs,
  }
}

export function InstanceTabs({
  active,
  access,
  instance: initialInstance,
  logs: initialLogs,
  drive,
  cloudflare,
  kuma,
  backups,
}: {
  active: string
  access: AccessControl
  instance: InstanceLite
  logs: LogLite[]
  drive: DriveInfo
  cloudflare: CloudflareInfo
  kuma: KumaInfo
  backups: BackupLite[]
}) {
  const { instance, logs } = useInstancePolling(initialInstance, initialLogs)
  const router = useRouter()
  const pathname = usePathname()

  function goTab(id: string) {
    router.push(`${pathname}?tab=${id}`)
  }

  // Gate tabs by the viewer's effective level. Viewers get read-only tabs
  // (Overview/Logs); Operator+ unlocks the operational tabs; only the
  // creator/team-owner sees Danger (delete); managers see Access.
  const baseTabs = TABS.filter((t) => {
    if (t.id === "overview" || t.id === "logs" || t.id === "monitoring") return true
    if (t.id === "danger") return access.isOwnerLike
    return access.canOperate
  })
  const accessTab = { id: "access", label: "Access" } as const
  const tabs: { id: string; label: string }[] = !access.canManageAccess
    ? baseTabs
    : baseTabs.some((t) => t.id === "danger")
      ? baseTabs.flatMap((t): { id: string; label: string }[] =>
          t.id === "danger" ? [accessTab, t] : [t],
        )
      : [...baseTabs, accessTab]

  // If the requested tab isn't permitted (e.g. a deep link), fall back to
  // Overview so the corresponding panel doesn't render.
  const effectiveActive = tabs.some((t) => t.id === active) ? active : "overview"

  // Gate the dashboard behind the deployment cycle: while the agent is still
  // provisioning (or failed / deleting), show only the live deployment stages.
  // useInstancePolling() calls router.refresh() when the instance leaves a
  // transient state, so the full dashboard reveals automatically once running.
  const inDeploymentCycle =
    instance.status === "pending" ||
    instance.status === "provisioning" ||
    instance.status === "failed_provisioning" ||
    instance.status === "deleting"
  if (inDeploymentCycle) {
    return <DeploymentProgress instance={instance} logs={logs} access={access} />
  }

  return (
    <Tabs value={effectiveActive} onValueChange={goTab} className="space-y-6">
      <TabsList variant="pills" className="w-fit">
        {tabs.map((t) => (
          <TabsTrigger key={t.id} value={t.id}>
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value="overview" className="mt-0">
        <OverviewTab instance={instance} logs={logs} kuma={kuma} />
      </TabsContent>
      <TabsContent value="monitoring" className="mt-0">
        <MonitoringTab instance={instance} kuma={kuma} />
      </TabsContent>
      <TabsContent value="controls" className="mt-0">
        <ControlsTab instance={instance} cloudflare={cloudflare} />
      </TabsContent>
      <TabsContent value="tools" className="mt-0">
        <ToolsTab
          instanceId={instance.id}
          runtime={instance.runtime}
          status={instance.status}
        />
      </TabsContent>
      <TabsContent value="skills" className="mt-0">
        <SkillsTab
          instanceId={instance.id}
          runtime={instance.runtime}
          status={instance.status}
        />
      </TabsContent>
      <TabsContent value="files" className="mt-0">
        <FilesTab
          instanceId={instance.id}
          status={instance.status}
          deploymentTarget={instance.deploymentTarget}
          runtimeLabel={instance.runtimeLabel}
        />
      </TabsContent>
      <TabsContent value="interfaces" className="mt-0">
        <InterfacesTab instance={instance} />
      </TabsContent>
      <TabsContent value="backup" className="mt-0">
        <BackupTab instance={instance} drive={drive} initialBackups={backups} />
      </TabsContent>
      <TabsContent value="logs" className="mt-0">
        <LogsTab instanceId={instance.id} logs={logs} />
      </TabsContent>
      <TabsContent value="danger" className="mt-0">
        <DangerTab instance={instance} />
      </TabsContent>
      {access.canManageAccess && (
        <TabsContent value="access" className="mt-0">
          <AccessTab instanceId={instance.id} isOwnerLike={access.isOwnerLike} />
        </TabsContent>
      )}
    </Tabs>
  )
}

function SectionCard({
  title,
  description,
  children,
  footer,
  className,
}: {
  title: string
  description?: string
  children: React.ReactNode
  footer?: React.ReactNode
  className?: string
}) {
  return (
    <Card className={cn("flex h-full flex-col", className)}>
      <CardHeader>
        <CardDescription className="font-mono text-[11px] tracking-[0.14em] uppercase">
          {title}
        </CardDescription>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </CardHeader>
      <CardContent className="flex-1">{children}</CardContent>
      {footer && <CardFooter>{footer}</CardFooter>}
    </Card>
  )
}

function Stat({
  label,
  value,
  icon,
}: {
  label: string
  value: string
  icon?: React.ReactNode
}) {
  return (
    <div>
      <p className="flex items-center gap-1.5 font-mono text-[11px] tracking-[0.14em] uppercase text-muted-foreground">
        {icon}
        {label}
      </p>
      <p className="mt-1 text-sm text-foreground">{value}</p>
    </div>
  )
}

/* ───────────── BYOS BRING-YOUR-OWN-KEY ───────────── */
type ByosKeyInfo = {
  llmMode: string | null
  activeSlot: "primary" | "fallback"
  keyStatus: "unknown" | "ok" | "failing"
  hasFallback: boolean
  ownProvider: string
  ownProviderLabel: string
  fallbackProvider: string | null
  fallbackProviderLabel: string | null
}

const KEY_STATUS_STYLE: Record<ByosKeyInfo["keyStatus"], { label: string; className: string }> = {
  ok: { label: "OK", className: "bg-emerald-500/20 text-emerald-600 dark:text-emerald-300" },
  failing: { label: "Failing", className: "bg-red-500/20 text-red-600 dark:text-red-300" },
  unknown: { label: "Unknown", className: "bg-muted text-muted-foreground" },
}

/**
 * BYOS bring-your-own-key surface: provider, which key slot is live, and its
 * last-observed status. When the user configured an optional fallback (their OWN
 * second key), exposes a manual "switch to fallback / back to primary" action —
 * a platform-level env swap + reprovision. Only rendered for own-key agents.
 */
function ByosKeyCard({ instanceId }: { instanceId: string }) {
  const router = useRouter()
  const [info, setInfo] = useState<ByosKeyInfo | null>(null)
  const [switching, setSwitching] = useState(false)

  const load = async () => {
    try {
      const r = await fetch(`/api/instances/${instanceId}/byos-key`, { cache: "no-store" })
      if (r.ok) setInfo((await r.json()) as ByosKeyInfo)
    } catch {
      // best-effort; the card just stays hidden on failure
    }
  }
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId])

  if (!info || info.llmMode !== "own_key") return null

  const status = KEY_STATUS_STYLE[info.keyStatus] ?? KEY_STATUS_STYLE.unknown
  const activeValue =
    info.activeSlot === "fallback"
      ? `Fallback (${info.fallbackProviderLabel ?? "—"})`
      : "Primary"

  async function switchSlot(slot: "primary" | "fallback") {
    setSwitching(true)
    try {
      const r = await fetch(`/api/instances/${instanceId}/byos-key`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slot }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        toast.error(d.error || "Could not switch key")
        return
      }
      if (d.warning) toast(d.warning)
      else toast.success(slot === "fallback" ? "Switched to fallback key" : "Switched back to primary key")
      await load()
      router.refresh()
    } catch {
      toast.error("Something went wrong")
    } finally {
      setSwitching(false)
    }
  }

  return (
    <SectionCard title="API key">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <Stat label="Provider" value={info.ownProviderLabel} />
        <Stat label="Active key" value={activeValue} />
        <div>
          <p className="font-mono text-[11px] tracking-[0.14em] uppercase text-muted-foreground">
            Status
          </p>
          <Badge className={cn("mt-1", status.className)}>{status.label}</Badge>
        </div>
      </div>
      {info.hasFallback && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={switching || info.activeSlot === "fallback"}
            onClick={() => switchSlot("fallback")}
          >
            Switch to fallback
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={switching || info.activeSlot === "primary"}
            onClick={() => switchSlot("primary")}
          >
            Back to primary
          </Button>
        </div>
      )}
    </SectionCard>
  )
}

/* ───────────── SERVER HARDWARE METRICS ───────────── */
type ServerMetricState = {
  cpuCores: number | null
  cpuLoad1: number | null
  ramTotalMb: number | null
  ramUsedMb: number | null
  diskTotalGb: number | null
  diskUsedGb: number | null
  osName: string | null
  osVersion: string | null
  kernel: string | null
  uptimeSec: number | null
  health: string | null
  checkedAt: string | null
  error: string | null
}

function gbFromMb(mb: number | null): string | null {
  return mb == null ? null : `${(mb / 1024).toFixed(1)} GB`
}

function pct(used: number | null, total: number | null): string | null {
  if (used == null || total == null || total <= 0) return null
  return `${Math.round((used / total) * 100)}%`
}

function fmtUptime(sec: number | null): string {
  if (sec == null || sec < 0) return "-"
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function ServerMetricsCard({ instance }: { instance: InstanceLite }) {
  const [m, setM] = useState<ServerMetricState>({
    cpuCores: instance.hwCpuCores,
    cpuLoad1: instance.hwCpuLoad1,
    ramTotalMb: instance.hwRamTotalMb,
    ramUsedMb: instance.hwRamUsedMb,
    diskTotalGb: instance.hwDiskTotalGb,
    diskUsedGb: instance.hwDiskUsedGb,
    osName: instance.hwOsName,
    osVersion: instance.hwOsVersion,
    kernel: instance.hwKernel,
    uptimeSec: instance.hwUptimeSec,
    health: instance.hwHealth,
    checkedAt: instance.hwCheckedAt,
    error: instance.hwError,
  })
  const [loading, setLoading] = useState(false)

  async function refresh() {
    setLoading(true)
    try {
      const res = await fetch(`/api/instances/${instance.id}/metrics`, { method: "POST" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? "Failed to refresh server metrics")
        return
      }
      if (data.health === "reachable" && data.snapshot) {
        setM({ ...data.snapshot, health: "reachable", checkedAt: data.checkedAt, error: null })
      } else {
        setM((prev) => ({
          ...prev,
          health: "unreachable",
          checkedAt: data.checkedAt ?? prev.checkedAt,
          error: data.error ?? "Server unreachable",
        }))
        toast.error("Could not reach the server")
      }
    } catch {
      toast.error("Failed to refresh server metrics")
    } finally {
      setLoading(false)
    }
  }

  const neverProbed = !m.checkedAt
  const os = m.osName ? `${m.osName}${m.osVersion ? ` (${m.osVersion})` : ""}` : "-"
  const ram =
    m.ramUsedMb != null && m.ramTotalMb != null
      ? `${gbFromMb(m.ramUsedMb)} / ${gbFromMb(m.ramTotalMb)}${
          pct(m.ramUsedMb, m.ramTotalMb) ? ` · ${pct(m.ramUsedMb, m.ramTotalMb)}` : ""
        }`
      : "-"
  const disk =
    m.diskUsedGb != null && m.diskTotalGb != null
      ? `${m.diskUsedGb} / ${m.diskTotalGb} GB${
          pct(m.diskUsedGb, m.diskTotalGb) ? ` · ${pct(m.diskUsedGb, m.diskTotalGb)}` : ""
        }`
      : "-"
  const cpu =
    m.cpuCores != null
      ? `${m.cpuCores} core${m.cpuCores === 1 ? "" : "s"}${m.cpuLoad1 != null ? ` · load ${m.cpuLoad1.toFixed(2)}` : ""}`
      : "-"

  const refreshBtn = (
    <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
      {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
      Refresh
    </Button>
  )

  return (
    <SectionCard title="Server metrics">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {m.health === "reachable" ? (
            <span className="inline-flex items-center gap-1.5 text-[12px] text-foreground/80">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400/70" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
              </span>
              reachable
            </span>
          ) : m.health === "unreachable" ? (
            <span className="inline-flex items-center gap-1.5 text-[12px] text-red-500">
              <span className="inline-flex size-2 rounded-full bg-red-500" />
              unreachable
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <span className="inline-flex size-2 rounded-full bg-muted-foreground/50" />
              not checked yet
            </span>
          )}
          {refreshBtn}
        </div>

        {neverProbed ? (
          <p className="text-xs text-muted-foreground">
            No metrics collected yet. Click Refresh to probe the server now, or wait for the next
            automatic collection.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
              <Stat label="OS" value={os} icon={<Cpu className="size-3" />} />
              <Stat label="Kernel" value={m.kernel ?? "-"} />
              <Stat label="CPU" value={cpu} icon={<Cpu className="size-3" />} />
              <Stat label="Memory" value={ram} icon={<MemoryStick className="size-3" />} />
              <Stat label="Disk" value={disk} icon={<HardDrive className="size-3" />} />
              <Stat label="Uptime" value={fmtUptime(m.uptimeSec)} />
            </div>
            {m.health === "unreachable" && m.error && (
              <p className="text-xs text-red-500">Last probe failed: {m.error}</p>
            )}
            {m.checkedAt && (
              <p className="text-[11px] text-muted-foreground">
                Last checked {new Date(m.checkedAt).toLocaleString()}
              </p>
            )}
          </>
        )}
      </div>
    </SectionCard>
  )
}

/* ───────────── DNS SETUP CARD ───────────── */
function DnsCard({ instance }: { instance: InstanceLite }) {
  const [dnsStatus, setDnsStatus] = useState(instance.dnsStatus)
  const [tlsStatus, setTlsStatus] = useState(instance.tlsStatus)
  const [resolvedIps, setResolvedIps] = useState<string[]>([])
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    async function poll() {
      try {
        const r = await fetch(`/api/instances/${instance.id}/dns-status`, { cache: "no-store" })
        const j = (await r.json()) as {
          dnsStatus: string | null
          tlsStatus: string | null
          resolvedIps?: string[]
        }
        if (cancelled) return
        setDnsStatus(j.dnsStatus)
        setTlsStatus(j.tlsStatus)
        setResolvedIps(j.resolvedIps ?? [])
      } catch {
        /* ignore */
      }
      if (!cancelled && (dnsStatus !== "ready" || tlsStatus !== "issued")) {
        timer = setTimeout(poll, 10_000)
      }
    }
    poll()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance.id])

  async function copyIp() {
    if (!instance.ipAddress) return
    try {
      await navigator.clipboard.writeText(instance.ipAddress)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* ignore */
    }
  }

  const ready = dnsStatus === "ready" && tlsStatus === "issued"
  const url = `https://${instance.domain}`

  return (
    <SectionCard title={ready ? "Agent URL" : "DNS Setup"}>
      {ready ? (
        <div className="space-y-2">
          <p className="text-sm text-foreground">
            Your agent is live at{" "}
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-primary underline"
            >
              {url}
            </a>
          </p>
          <p className="font-mono text-[10px] text-muted-foreground">
            TLS certificate issued. DNS resolved to {resolvedIps.join(", ") || instance.ipAddress}.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Add this <span className="font-mono text-foreground">A</span> record to your DNS provider for{" "}
            <span className="font-mono text-foreground">{instance.domain}</span>:
          </p>
          <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/40 p-3 font-mono text-sm">
            <span className="text-muted-foreground">
              <span className="text-foreground">{instance.domain}</span> →{" "}
              <span className="text-primary">{instance.ipAddress ?? "…"}</span>
            </span>
            <Button size="xs" variant="outline" onClick={copyIp}>
              {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
              {copied ? "Copied" : "Copy IP"}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-4 font-mono text-[10px] uppercase tracking-[0.08em]">
            <span className="text-muted-foreground">
              DNS:{" "}
              <span className={dnsStatus === "ready" ? "text-primary" : "text-amber-500"}>
                {dnsStatus ?? "pending"}
              </span>
            </span>
            <span className="text-muted-foreground">
              TLS:{" "}
              <span className={tlsStatus === "issued" ? "text-primary" : "text-amber-500"}>
                {tlsStatus ?? "pending"}
              </span>
            </span>
            {resolvedIps.length > 0 && (
              <span className="text-muted-foreground">
                resolved: <span className="text-foreground">{resolvedIps.join(", ")}</span>
              </span>
            )}
          </div>
          <p className="font-mono text-[10px] text-muted-foreground/70">
            Polling every 10s. Once DNS propagates, Caddy issues a Let&apos;s Encrypt certificate automatically.
          </p>
        </div>
      )}
    </SectionCard>
  )
}

/* ───────────── MANAGED HOSTNAME ───────────── */
function ManagedHostnameCard({ instance }: { instance: InstanceLite }) {
  const url = buildPublicGatewayUrl({
    domain: null,
    managedSubdomain: instance.managedSubdomain,
    tlsStatus: null,
    ipAddress: instance.ipAddress,
  })?.url
  const [copied, setCopied] = useState(false)

  async function copyUrl() {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* ignore */
    }
  }

  if (!instance.managedSubdomain || instance.domain || !url) return null

  return (
    <SectionCard
      title="Managed hostname"
      description="DNS for this hostname is managed automatically. Open the gateway over HTTPS:"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 p-3 font-mono text-sm">
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="break-all text-primary underline"
        >
          {url}
        </a>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="xs" variant="outline" render={<a href={url} target="_blank" rel="noreferrer" />}>
            <ExternalLink data-icon="inline-start" />
            Open
          </Button>
          <Button size="xs" variant="outline" onClick={copyUrl}>
            {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      </div>
      <p className="mt-2 font-mono text-[10px] text-muted-foreground/70">
        Direct <span className="text-foreground">http://{instance.ipAddress ?? "IP"}</span> on port 80
        still reaches the gateway when the VM firewall allows it.
      </p>
    </SectionCard>
  )
}

/* ───────────── CREDENTIALS CARD ───────────── */
function CredentialsCard({
  instanceId,
  domain,
  managedSubdomain,
  tlsStatus,
  ipAddress,
  runtimeLabel,
  webui,
  terminal,
}: {
  instanceId: string
  domain: string | null
  managedSubdomain: string | null
  tlsStatus: string | null
  ipAddress: string | null
  runtimeLabel: string
  /** When true the admin account is the Open WebUI login (the chat UI sidecar). */
  webui?: boolean
  /** When true the same login also opens the browser terminal at /terminal. */
  terminal?: boolean
}) {
  const [revealed, setRevealed] = useState<{ email: string; password: string; loginUrl: string | null } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function reveal() {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch(`/api/instances/${instanceId}/credentials`, { cache: "no-store" })
      const j = await r.json()
      if (!r.ok) {
        setError(j.error || "Failed to load credentials")
        return
      }
      setRevealed(j)
    } finally {
      setLoading(false)
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast.success("Copied to clipboard")
    } catch {
      toast.error("Copy failed")
    }
  }

  const loginUrl =
    revealed?.loginUrl ??
    buildPublicGatewayUrl({ domain, managedSubdomain, tlsStatus, ipAddress })?.url ??
    null

  return (
    <SectionCard title={webui ? "Open WebUI Login" : "Admin Credentials"}>
      {!revealed ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {webui
              ? `Log into Open WebUI (the web chat UI for your ${runtimeLabel} agent) with the auto-generated admin account.${
                  terminal ? " The same login opens its browser terminal." : ""
                }`
              : `Log into your ${runtimeLabel} agent with the auto-generated admin account.`}
          </p>
          <Button size="sm" onClick={reveal} disabled={loading}>
            {loading && <Loader2 data-icon="inline-start" className="animate-spin" />}
            {loading ? "Loading…" : "Reveal Credentials"}
          </Button>
          {error && <p className="font-mono text-xs text-destructive">{error}</p>}
        </div>
      ) : (
        <div className="space-y-2 text-sm">
          <CredRow label="Email" value={revealed.email} onCopy={() => copy(revealed.email)} />
          <CredRow label="Password" value={revealed.password} onCopy={() => copy(revealed.password)} mono />
          {loginUrl && (
            <p className="mt-2 font-mono text-[10px] text-muted-foreground">
              Login at{" "}
              <a href={loginUrl} target="_blank" rel="noreferrer" className="text-primary underline">
                {loginUrl}
              </a>
            </p>
          )}
          {loginUrl && terminal && (
            <p className="font-mono text-[10px] text-muted-foreground">
              Terminal at{" "}
              <a
                href={`${loginUrl.replace(/\/$/, "")}/terminal/`}
                target="_blank"
                rel="noreferrer"
                className="text-primary underline"
              >
                {`${loginUrl.replace(/\/$/, "")}/terminal/`}
              </a>
            </p>
          )}
        </div>
      )}
    </SectionCard>
  )
}

function CredRow({
  label,
  value,
  onCopy,
  mono,
}: {
  label: string
  value: string
  onCopy: () => void
  mono?: boolean
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-20 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </span>
      <span className={`flex-1 break-all text-sm text-foreground ${mono ? "font-mono" : ""}`}>
        {value}
      </span>
      <Button size="xs" variant="outline" onClick={onCopy}>
        <Copy data-icon="inline-start" />
        Copy
      </Button>
    </div>
  )
}

/* ───────────── SERVER ACCESS CARD ───────────── */
function ServerAccessCard({ instanceId }: { instanceId: string; ipAddress: string | null }) {
  const [revealed, setRevealed] = useState<{
    rootPassword: string | null
    sshCommand: string | null
    gatewayUrl: string | null
  } | null>(null)
  const [loading, setLoading] = useState(false)

  async function reveal() {
    setLoading(true)
    try {
      const r = await fetch(`/api/instances/${instanceId}/credentials`, { cache: "no-store" })
      const j = await r.json()
      if (r.ok) {
        setRevealed({
          rootPassword: j.rootPassword,
          sshCommand: j.sshCommand,
          gatewayUrl: j.gatewayUrl,
        })
      }
    } finally {
      setLoading(false)
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast.success("Copied to clipboard")
    } catch {
      toast.error("Copy failed")
    }
  }

  return (
    <SectionCard title="Server Access">
      {!revealed ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            SSH access and gateway URL for this server.
          </p>
          <Button size="sm" onClick={reveal} disabled={loading}>
            {loading && <Loader2 data-icon="inline-start" className="animate-spin" />}
            {loading ? "Loading…" : "Reveal Access Details"}
          </Button>
        </div>
      ) : (
        <div className="space-y-2 text-sm">
          {revealed.sshCommand && (
            <CredRow label="SSH" value={revealed.sshCommand} onCopy={() => copy(revealed.sshCommand!)} mono />
          )}
          {revealed.rootPassword && (
            <CredRow label="Root Pass" value={revealed.rootPassword} onCopy={() => copy(revealed.rootPassword!)} mono />
          )}
          {revealed.gatewayUrl && (
            <CredRow label="Gateway" value={revealed.gatewayUrl} onCopy={() => copy(revealed.gatewayUrl!)} mono />
          )}
        </div>
      )}
    </SectionCard>
  )
}

/* ───────────── GATEWAY TOKEN CARD ───────────── */
function GatewayTokenCard({
  instanceId,
  runtimeLabel,
  openAiApi,
}: {
  instanceId: string
  runtimeLabel: string
  /** Hermes surfaces the key as an advanced "Gateway API Key"; OpenWebUI is the primary path. */
  openAiApi?: boolean
}) {
  const [token, setToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [copying, setCopying] = useState(false)

  /** Fetches the token from the server. Returns null (and toasts) on failure. */
  async function fetchToken(): Promise<string | null> {
    if (token) return token
    const r = await fetch(`/api/instances/${instanceId}/gateway-token`, { cache: "no-store" })
    const j = (await r.json()) as { gatewayToken?: string; error?: string }
    if (!r.ok) {
      toast.error(j.error || "Failed to fetch token")
      return null
    }
    return j.gatewayToken ?? null
  }

  async function reveal() {
    setLoading(true)
    try {
      const t = await fetchToken()
      if (t !== null) setToken(t)
    } finally {
      setLoading(false)
    }
  }

  /** Copies the token to the clipboard without revealing it in the UI. */
  async function copy() {
    setCopying(true)
    try {
      const t = await fetchToken()
      if (t === null) return
      await navigator.clipboard.writeText(t)
      toast.success("Token copied to clipboard")
    } catch {
      toast.error("Copy failed. Clipboard access blocked")
    } finally {
      setCopying(false)
    }
  }

  return (
    <SectionCard
      title={openAiApi ? "Gateway API Key" : "Gateway Token"}
      description={
        openAiApi
          ? "Advanced: for programmatic access to the OpenAI-compatible API at /v1. Most users can just use Open WebUI above."
          : `Use this token to authenticate with the ${runtimeLabel} Control UI and API.`
      }
    >
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 break-all rounded-lg border bg-muted/40 p-3 font-mono text-sm text-foreground">
          {token ?? "gw_•••••••••••••••••••••"}
        </p>
        <Button
          variant="outline"
          onClick={reveal}
          disabled={loading}
          aria-label="Reveal token"
          className="size-8 shrink-0 px-0"
        >
          {loading ? <Loader2 className="size-4 animate-spin" /> : <Eye className="size-4" />}
        </Button>
        <Button
          variant="outline"
          onClick={copy}
          disabled={copying}
          aria-label="Copy token"
          className="size-8 shrink-0 px-0"
        >
          {copying ? <Loader2 className="size-4 animate-spin" /> : <Copy className="size-4" />}
        </Button>
      </div>
    </SectionCard>
  )
}

/* ───────────── PROVISIONING CARD ───────────── */
const PROVISION_STEPS = [
  { match: "Creating VM", label: "Creating server" },
  { match: "Waiting for boot", label: "Booting server" },
  { match: "Cloudflare DNS upserted", label: "Setting up DNS" },
  { match: "Waiting for SSH", label: "Connecting to server" },
  { match: "Bootstrapping server", label: "Installing dependencies" },
  { match: "bootstrap complete", label: "Server ready" },
  { match: "Writing agent configuration", label: "Writing configuration" },
  { match: "Agent configuration written", label: "Configuration applied" },
  { match: "Caddy reloaded", label: "Routing online" },
  { match: "systemd service active", label: "Service running" },
  { match: "Gateway port listening", label: "Port check passed" },
  { match: "HTTP health check passed", label: "HTTP health check passed" },
  { match: "Deployment complete", label: "Deployment complete" },
  { match: "Selecting shared host", label: "Selecting host" },
  { match: "Starting bot container", label: "Starting container" },
  { match: "Starting provisioning", label: "Initializing" },
  { match: "Mock-provisioned", label: "Provisioned" },
] as const

const PROVISION_STAGE_HINTS: Record<string, string> = {
  create_vm: "Preparing your agent.",
  wait_boot: "Booting your agent.",
  waiting_ssh: "Establishing a secure connection.",
  bootstrap: "Setting up the environment.",
  writing_config: "Writing configuration.",
  installing_service: "Installing services and running health checks.",
  starting_service: "Starting the agent gateway.",
  health_check: "Verifying the agent is responding.",
  commit: "Finalizing deployment.",
}

/* ───────────── DEPLOYMENT PROGRESS (gates the dashboard) ───────────── */
function DeploymentProgress({
  instance,
  logs,
  access,
}: {
  instance: InstanceLite
  logs: LogLite[]
  access: AccessControl
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const isFailed = instance.status === "failed_provisioning"
  const isDeleting = instance.status === "deleting"

  const tasks = buildDeploymentTasks({
    status: instance.status,
    provisionStage: instance.provisionStage,
    deploymentTarget: instance.deploymentTarget,
    logMessages: logs.map((l) => l.message),
  })

  const lastError = logs.find((l) => l.level === "error")

  const stageHint = isFailed
    ? "Deployment failed. Retry to recreate from scratch, or delete the agent."
    : isDeleting
      ? "Deleting this agent…"
      : instance.provisionStage
        ? PROVISION_STAGE_HINTS[instance.provisionStage] ??
          "Still working, safe to leave this page open."
        : "Preparing your deployment…"

  function handleRetry() {
    setError(null)
    startTransition(async () => {
      try {
        const res = await fetch(`/api/instances/${instance.id}/retry`, { method: "POST" })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error || `Retry failed (${res.status})`)
        }
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : "Retry failed")
      }
    })
  }

  function handleDelete() {
    setError(null)
    startTransition(async () => {
      try {
        const res = await fetch(`/api/instances/${instance.id}`, { method: "DELETE" })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error || `Delete failed (${res.status})`)
        }
        router.push("/dashboard/instances")
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : "Delete failed")
      }
    })
  }

  return (
    <SectionCard
      title={isFailed ? "Deployment failed" : isDeleting ? "Deleting" : "Deploying your agent"}
      description={stageHint}
    >
      <div className="space-y-5">
        <Plan tasks={tasks} />

        {isFailed && lastError && (
          <Alert variant="destructive">
            <AlertTitle>Provisioning error</AlertTitle>
            <AlertDescription className="font-mono">{lastError.message}</AlertDescription>
          </Alert>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        {!isDeleting && (
          <div className="flex flex-wrap items-center gap-3">
            {isFailed && access.canOperate && (
              <Button variant="gradient" onClick={handleRetry} disabled={isPending}>
                <RefreshCw data-icon="inline-start" />
                {isPending ? "Retrying…" : "Retry deployment"}
              </Button>
            )}
            {access.isOwnerLike && (
              <AlertDialog>
                <AlertDialogTrigger
                  render={
                    <Button variant="outline" disabled={isPending}>
                      <Trash2 data-icon="inline-start" />
                      {isFailed ? "Delete agent" : "Cancel & delete"}
                    </Button>
                  }
                />
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete {instance.name}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This permanently deletes the agent and tears down any resources
                      created so far. This action cannot be undone. Your remaining
                      credits stay in your account and can be used by a new agent.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel variant="outline">Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      variant="destructive"
                      onClick={handleDelete}
                      disabled={isPending}
                    >
                      {isPending ? "Deleting…" : "Delete"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        )}
      </div>
    </SectionCard>
  )
}

/* ───────────── PROVISIONING CARD ───────────── */
function ProvisioningCard({ instance, logs }: { instance: InstanceLite; logs: LogLite[] }) {
  const logMessages = logs.map((l) => l.message)
  const isFailed = instance.status === "failed_provisioning"
  const isRunning = instance.status === "running"
  const isActive = !isFailed && !isRunning

  const stageHint =
    isActive &&
    (instance.provisionStage
      ? PROVISION_STAGE_HINTS[instance.provisionStage] ??
        "Still working, safe to leave this page open."
      : "Provisioning is starting.")

  const steps = PROVISION_STEPS.filter((s) =>
    logMessages.some((m) => m.includes(s.match))
  )

  const lastError = logs.find((l) => l.level === "error")

  const title = isFailed
    ? "Provisioning Failed"
    : isRunning
      ? "Provisioning Complete"
      : "Provisioning"

  return (
    <SectionCard title={title}>
      <div className="space-y-3">
        {steps.length === 0 && isActive && (
          <div className="flex items-center gap-3">
            <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />
            <span className="text-sm text-muted-foreground">Preparing deployment...</span>
          </div>
        )}
        {steps.map((step, i) => {
          const isLast = i === steps.length - 1
          const isDone = !isLast || isRunning
          return (
            <div key={step.match} className="flex items-center gap-3">
              {isDone ? (
                <span className="flex size-4 items-center justify-center rounded border border-primary bg-primary text-primary-foreground">
                  <Check className="size-3" />
                </span>
              ) : (
                <span className="flex size-4 items-center justify-center">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />
                </span>
              )}
              <span className={`text-sm ${isDone ? "text-foreground" : "text-amber-500"}`}>
                {step.label}
              </span>
            </div>
          )
        })}
        {isFailed && lastError && (
          <Alert variant="destructive">
            <AlertDescription className="font-mono">{lastError.message}</AlertDescription>
          </Alert>
        )}
        {isFailed && (
          <Alert variant="destructive">
            <AlertTitle>This instance failed to provision.</AlertTitle>
            <AlertDescription>You can delete it and try again.</AlertDescription>
          </Alert>
        )}
        {isRunning && (
          <p className="mt-2 font-mono text-xs text-primary">
            Agent is live and ready to accept requests.
          </p>
        )}
        {isActive && stageHint && (
          <p className="mt-1 border-t pt-3 text-xs leading-relaxed text-muted-foreground">
            {stageHint}
          </p>
        )}
      </div>
    </SectionCard>
  )
}

/* ───────────── OVERVIEW ───────────── */
function UptimeCard({ kuma }: { kuma: KumaInfo }) {
  // Hidden entirely when the operator hasn't wired up Uptime Kuma.
  if (!kuma.configured) return null

  if (!kuma.checkedAt) {
    return (
      <SectionCard title="Uptime">
        <p className="text-xs text-muted-foreground">
          Monitoring is enabled, waiting for the first status check.
        </p>
      </SectionCard>
    )
  }

  const isUp = kuma.status === "up"
  const isDown = kuma.status === "down"
  const pillTone = isUp
    ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
    : isDown
      ? "bg-destructive/15 text-destructive"
      : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
  const dotTone = isUp ? "bg-emerald-500" : isDown ? "bg-destructive" : "bg-amber-500"
  const statusLabel = kuma.status
    ? kuma.status.charAt(0).toUpperCase() + kuma.status.slice(1)
    : "Unknown"

  return (
    <SectionCard title="Uptime">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <span
          className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ${pillTone}`}
        >
          <span className={`inline-block h-2 w-2 rounded-full ${dotTone}`} />
          {statusLabel}
        </span>
        <div className="text-right">
          <p className="font-mono text-[10px] tracking-[0.1em] uppercase text-muted-foreground">
            Uptime (24h)
          </p>
          <p className="text-2xl font-bold text-foreground">
            {kuma.uptimeRatio != null ? `${(kuma.uptimeRatio * 100).toFixed(2)}%` : "-"}
          </p>
        </div>
      </div>

      {kuma.samples.length > 0 && (
        <div className="mt-4">
          <HeartbeatBar samples={kuma.samples} count={50} />
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-3">
        <Stat
          label="Response"
          value={kuma.responseTimeMs != null ? `${kuma.responseTimeMs} ms` : "-"}
        />
        <Stat
          label="Cert expiry"
          value={kuma.certDaysRemaining != null ? `${kuma.certDaysRemaining} days` : "-"}
        />
        <Stat label="Last checked" value={new Date(kuma.checkedAt).toLocaleTimeString()} />
      </div>
    </SectionCard>
  )
}

function OverviewTab({
  instance,
  logs,
  kuma,
}: {
  instance: InstanceLite
  logs: LogLite[]
  kuma: KumaInfo
}) {
  const isProvisioning =
    instance.status === "pending" || instance.status === "provisioning"
  const isFailed = instance.status === "failed_provisioning"
  return (
    <div className="w-full space-y-4">
      {(isProvisioning || (isFailed && !instance.ipAddress)) && (
        <ProvisioningCard instance={instance} logs={logs} />
      )}
      {instance.domain && instance.status === "running" && <DnsCard instance={instance} />}
      {instance.managedSubdomain && !instance.domain && instance.status === "running" && (
        <ManagedHostnameCard instance={instance} />
      )}
      {(() => {
        // Engines with an OpenAI-compatible API (Hermes) lead with the chat UI.
        const openAiApi = runtimeCaps(instance.runtime).exposesOpenAiApi
        const gatewayCard =
          instance.hasGatewayToken &&
          (instance.deploymentTarget === "vps" || instance.deploymentTarget === "byos") ? (
            <GatewayTokenCard
              instanceId={instance.id}
              runtimeLabel={instance.runtimeLabel}
              openAiApi={openAiApi}
            />
          ) : null
        const credentialsCard =
          instance.hasOpenclawPassword && instance.status === "running" ? (
            <CredentialsCard
              instanceId={instance.id}
              domain={instance.domain}
              managedSubdomain={instance.managedSubdomain}
              tlsStatus={instance.tlsStatus}
              ipAddress={instance.ipAddress}
              runtimeLabel={instance.runtimeLabel}
              webui={runtimeCaps(instance.runtime).hasSidecar && instance.webuiEnabled}
              terminal={runtimeCaps(instance.runtime).hasTerminal}
            />
          ) : null
        // Hermes leads with the Open WebUI login (primary path) and pushes the
        // gateway API key below it; OpenClaw keeps the token-first ordering.
        return openAiApi ? (
          <>
            {credentialsCard}
            {gatewayCard}
          </>
        ) : (
          <>
            {gatewayCard}
            {credentialsCard}
          </>
        )
      })()}

      <SectionCard title="Deployment">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Stat label="Status" value={instance.status} />
          <Stat label="IP" value={instance.ipAddress || "-"} />
          <Stat label="Domain" value={instance.domain ?? instance.managedSubdomain ?? "-"} />
          <Stat
            label="TLS"
            value={
              instance.domain
                ? instance.tlsStatus ?? "pending"
                : instance.managedSubdomain
                  ? "Cloudflare"
                  : "-"
            }
          />
          <Stat
            label="Runtime"
            value={
              instance.deploymentTarget === "vps" || instance.deploymentTarget === "byos"
                ? instance.runtimeLabel
                : "-"
            }
          />
        </div>
      </SectionCard>

      {instance.status === "running" && <UptimeCard kuma={kuma} />}

      {instance.deploymentTarget === "byos" ? (
        <SectionCard title="Your server">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat
              label="Host"
              value={`${instance.byosUser ?? "root"}@${instance.byosHost ?? instance.ipAddress ?? "-"}${
                instance.byosPort && instance.byosPort !== 22 ? `:${instance.byosPort}` : ""
              }`}
            />
            <Stat
              label="Model access"
              value={
                instance.byosLlmMode === "own_key"
                  ? "Your own API key"
                  : `${BRANDING.name} Credits`
              }
            />
            <Stat label="Managed by" value={`${BRANDING.name} Platform`} />
            <Stat label="Created" value={new Date(instance.createdAt).toLocaleDateString()} />
          </div>
        </SectionCard>
      ) : null}

      {instance.deploymentTarget === "byos" && instance.byosLlmMode === "own_key" && (
        <ByosKeyCard instanceId={instance.id} />
      )}

      {instance.deploymentTarget !== "byos" && (
        <SectionCard title="Overview">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            <Stat label="Model access" value={`${BRANDING.name} Credits`} />
            <Stat label="Managed by" value={`${BRANDING.name} Platform`} />
            <Stat label="Created" value={new Date(instance.createdAt).toLocaleDateString()} />
          </div>
        </SectionCard>
      )}

    </div>
  )
}

/* ───────────── MONITORING ───────────── */
type AgentEventLite = {
  id: string
  type: string
  status: string | null
  model: string | null
  tokensIn: number | null
  tokensOut: number | null
  costUsd: number | null
  latencyMs: number | null
  runId: string | null
  occurredAt: string | null
  createdAt: string
}

function MonitoringTab({ instance, kuma }: { instance: InstanceLite; kuma: KumaInfo }) {
  return (
    <div className="w-full space-y-4">
      {/* Keep the Kuma badge + heartbeat bars live while this tab is open. */}
      {kuma.configured && instance.status === "running" && <AutoRefresh />}
      <SectionCard title="Spend">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Stat label="Total LLM cost" value={`$${(instance.costUsd ?? 0).toFixed(2)}`} />
          <Stat
            label="Last event"
            value={instance.lastEventAt ? new Date(instance.lastEventAt).toLocaleString() : "-"}
          />
        </div>
      </SectionCard>

      {instance.status === "running" && <UptimeCard kuma={kuma} />}

      {instance.status === "running" &&
        (instance.deploymentTarget === "vps" || instance.deploymentTarget === "byos") && (
          <ServerMetricsCard instance={instance} />
        )}

      <AgentEventsPanel instanceId={instance.id} />
    </div>
  )
}

function AgentEventsPanel({ instanceId }: { instanceId: string }) {
  const [events, setEvents] = useState<AgentEventLite[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch(`/api/instances/${instanceId}/events`, { cache: "no-store" })
        const j = (await r.json()) as { events?: AgentEventLite[] }
        if (!cancelled) setEvents(j.events ?? [])
      } catch {
        /* ignore — empty state covers it */
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [instanceId])

  return (
    <SectionCard
      title="Recent activity"
      description="Runs, tool calls, and errors emitted by the agent."
    >
      {loading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : events.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No agent events yet. Activity appears here once the agent&apos;s event pipeline is live.
        </p>
      ) : (
        <div className="space-y-1.5 font-mono text-xs">
          {events.map((e) => (
            <div key={e.id} className="flex flex-wrap items-center gap-2">
              <span
                className={
                  e.status === "error"
                    ? "text-destructive"
                    : e.type === "error"
                      ? "text-destructive"
                      : "text-primary"
                }
              >
                {e.type}
              </span>
              <span className="text-muted-foreground/70">
                {(e.occurredAt ?? e.createdAt).slice(0, 19)}
              </span>
              {e.model && <span className="text-muted-foreground">{e.model}</span>}
              {e.latencyMs != null && <span className="text-muted-foreground">{e.latencyMs}ms</span>}
              {e.costUsd != null && (
                <span className="text-muted-foreground">${e.costUsd.toFixed(4)}</span>
              )}
              {e.status && <span className="text-foreground">{e.status}</span>}
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  )
}

/* ───────────── CONTROLS ───────────── */
function ControlsTab({
  instance,
  cloudflare,
}: {
  instance: InstanceLite
  cloudflare: CloudflareInfo
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [tokenRevealed, setTokenRevealed] = useState<string | null>(null)
  const [tokenLoading, setTokenLoading] = useState(false)

  async function callAction(
    url: string,
    method: "POST" | "DELETE",
    label: string,
    body?: unknown
  ) {
    try {
      const init: RequestInit = { method }
      if (body !== undefined) {
        init.headers = { "Content-Type": "application/json" }
        init.body = JSON.stringify(body)
      }
      const r = await fetch(url, init)
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string }
        toast.error(`${label} failed: ${body.error || r.statusText}`)
        return
      }
      toast.success(`${label} succeeded.`)
      startTransition(() => router.refresh())
    } catch (err) {
      toast.error(`${label} failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const isVps = instance.deploymentTarget === "vps"

  async function revealToken() {
    setTokenLoading(true)
    try {
      const r = await fetch(`/api/instances/${instance.id}/token`, { method: "GET" })
      const j = await r.json()
      if (!r.ok) {
        toast.error(j.error || "Failed to reveal token")
        return
      }
      setTokenRevealed(j.botToken ?? "(not yet assigned)")
    } finally {
      setTokenLoading(false)
    }
  }

  async function rotateToken() {
    setTokenLoading(true)
    try {
      const r = await fetch(`/api/instances/${instance.id}/token`, { method: "POST" })
      const j = (await r.json()) as { botToken?: string; error?: string }
      if (!r.ok) {
        toast.error(j.error || "Failed to rotate token")
        return
      }
      setTokenRevealed(j.botToken ?? "")
      toast.success("Token rotated. Container env updated.")
    } finally {
      setTokenLoading(false)
    }
  }

  async function copyToken() {
    if (!tokenRevealed) return
    try {
      await navigator.clipboard.writeText(tokenRevealed)
      toast.success("Token copied to clipboard.")
    } catch {
      toast.error("Copy failed. Clipboard access blocked.")
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <SectionCard title="Lifecycle">
        <div className="flex flex-col gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={pending}
            onClick={() => callAction(`/api/instances/${instance.id}/restart`, "POST", "Restart")}
          >
            <RefreshCw data-icon="inline-start" />
            {pending ? "Working…" : "Restart Bot"}
          </Button>
          {(instance.deploymentTarget === "vps" || instance.deploymentTarget === "byos") && (
            <>
              <Button
                variant="secondary"
                size="sm"
                disabled={pending}
                onClick={() =>
                  callAction(
                    `/api/instances/${instance.id}/restart-caddy`,
                    "POST",
                    "Reload Web Server",
                    { mode: "reload" }
                  )
                }
              >
                <RefreshCw data-icon="inline-start" />
                {pending ? "Working…" : "Reload Web Server"}
              </Button>
              <AlertDialog>
                <AlertDialogTrigger
                  render={
                    <Button variant="secondary" size="sm" disabled={pending}>
                      <RefreshCw data-icon="inline-start" />
                      Restart Web Server
                    </Button>
                  }
                />
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Restart Web Server?</AlertDialogTitle>
                    <AlertDialogDescription>
                      A hard restart briefly drops all ingress to this instance while the web
                      server stops and starts. Use &ldquo;Reload Web Server&rdquo; for a graceful,
                      near-zero-downtime config reload.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() =>
                        callAction(
                          `/api/instances/${instance.id}/restart-caddy`,
                          "POST",
                          "Restart Web Server",
                          { mode: "restart" }
                        )
                      }
                    >
                      Restart Web Server
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button variant="destructive" size="sm" disabled={pending}>
                  <Trash2 data-icon="inline-start" />
                  Delete Instance
                </Button>
              }
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this instance?</AlertDialogTitle>
                <AlertDialogDescription>
                  This cannot be undone. The VM and all associated data will be removed.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() =>
                    callAction(`/api/instances/${instance.id}`, "DELETE", "Delete").then(() => {
                      router.push("/dashboard/instances")
                    })
                  }
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </SectionCard>
      <CustomInstructionsCard instance={instance} />
      <ModelSelectCard instance={instance} />
      <AgentTypeCard instance={instance} />
      {!isVps && (
        <SectionCard
          title="Bot Token"
          description="API token for programmatic access to this bot."
        >
          <p className="break-all rounded-lg border bg-muted/40 p-3 font-mono text-sm text-foreground">
            {tokenRevealed ?? `sk_bot_•••••••••••••••••••••••••${instance.id.slice(-6)}`}
          </p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="outline" onClick={revealToken} disabled={tokenLoading}>
              {tokenLoading ? "…" : "Reveal"}
            </Button>
            <Button size="sm" variant="outline" onClick={rotateToken} disabled={tokenLoading}>
              <RefreshCw data-icon="inline-start" />
              Rotate
            </Button>
            {tokenRevealed && (
              <Button size="sm" variant="outline" onClick={copyToken}>
                <Copy data-icon="inline-start" />
                Copy
              </Button>
            )}
          </div>
        </SectionCard>
      )}
      {isVps && <DomainManageCard instance={instance} />}
      {isVps && <CloudflareDomainCard instance={instance} cloudflare={cloudflare} />}
      {instance.hasRootPassword && instance.status === "running" && (
        <ServerAccessCard instanceId={instance.id} ipAddress={instance.ipAddress} />
      )}
    </div>
  )
}

/* ───────────── AGENT TYPE CARD ───────────── */
function AgentTypeCard({ instance }: { instance: InstanceLite }) {
  const [agentType, setAgentType] = useState(instance.agentType ?? "custom")
  const [saving, setSaving] = useState(false)
  const router = useRouter()
  const isDirty = agentType !== (instance.agentType ?? "custom")

  async function save() {
    setSaving(true)
    try {
      const r = await fetch(`/api/instances/${instance.id}/agent-type`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentType }),
      })
      const j = await r.json()
      if (!r.ok) {
        toast.error(j.error || "Failed to update agent type")
        return
      }
      if (j.warning) {
        toast.warning(j.warning)
      } else {
        toast.success(`Agent type updated to "${agentType}". Identity files rewritten.`)
      }
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  const current = AGENT_CATEGORIES.find((c) => c.slug === agentType)

  return (
    <SectionCard
      title="Agent Type"
      description="Persona, skills, and identity files on the VM."
    >
      <Select value={agentType} onValueChange={(v) => v && setAgentType(v)}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {AGENT_CATEGORIES.map((cat) => (
              <SelectItem key={cat.slug} value={cat.slug}>
                {categoryDisplayName(cat.slug, instance.runtime)}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {current && (
        <p className="mt-2 font-mono text-[10px] text-muted-foreground">
          Category: <span className="text-foreground">{current.slug}</span>
        </p>
      )}
      {isDirty && (
        <Button size="sm" className="mt-3" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save & Apply"}
        </Button>
      )}
    </SectionCard>
  )
}

/* ───────────── CUSTOM INSTRUCTIONS CARD ───────────── */
const MAX_CUSTOM_INSTRUCTIONS = 4000

function CustomInstructionsCard({ instance }: { instance: InstanceLite }) {
  const [value, setValue] = useState(instance.customInstructions ?? "")
  const [saving, setSaving] = useState(false)
  const router = useRouter()
  const initial = instance.customInstructions ?? ""
  const isDirty = value.trim() !== initial.trim()
  const tooLong = value.length > MAX_CUSTOM_INSTRUCTIONS

  async function save() {
    setSaving(true)
    try {
      const r = await fetch(`/api/instances/${instance.id}/custom-instructions`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customInstructions: value.trim() }),
      })
      const j = await r.json()
      if (!r.ok) {
        toast.error(j.error || "Failed to update custom instructions")
        return
      }
      if (j.warning) toast.warning(j.warning)
      else toast.success("Custom instructions saved. Persona updated.")
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  return (
    <SectionCard
      title="Custom Instructions"
      description="Highest-priority guidance for this agent's persona."
    >
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={5}
        placeholder="e.g. Always reply in Spanish. Escalate billing questions to #finance."
        className="min-h-[120px] resize-y font-mono text-xs"
      />
      <p className="mt-1.5 font-mono text-[10px] text-muted-foreground">
        <span className={cn(tooLong && "text-destructive")}>
          {value.length.toLocaleString()}
        </span>
        {" / "}
        {MAX_CUSTOM_INSTRUCTIONS.toLocaleString()} characters
      </p>
      {isDirty && (
        <Button size="sm" className="mt-3" onClick={save} disabled={saving || tooLong}>
          {saving ? "Saving…" : "Save & Apply"}
        </Button>
      )}
    </SectionCard>
  )
}

/* ───────────── MODEL SELECT CARD ───────────── */
const DEFAULT_MODEL = "__default__"

type ModelTag = "cheap" | "quality" | "allrounder"
type ModelOption = {
  slug: string
  label: string
  contextLength: number | null
  tag: ModelTag | null
}
type ModelInfo = {
  current: string | null
  tierDefault: string
  runtime: string
  options: ModelOption[]
}

function formatContext(ctx: number | null): string | null {
  if (ctx == null) return null
  return ctx >= 1000 ? `${Math.round(ctx / 1000)}k ctx` : `${ctx} ctx`
}

// At-a-glance positioning for the model picker — label + accent color per tag.
const MODEL_TAG_META: Record<ModelTag, { label: string; className: string }> = {
  cheap: {
    label: "Cheap",
    className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  quality: {
    label: "Best output",
    className: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  allrounder: {
    label: "All-rounder",
    className: "border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400",
  },
}

function ModelTagBadge({ tag }: { tag: ModelTag | null }) {
  if (!tag) return null
  const meta = MODEL_TAG_META[tag]
  return (
    <Badge variant="outline" className={cn("ml-1 px-1.5 py-0 text-[10px]", meta.className)}>
      {meta.label}
    </Badge>
  )
}

function ModelSelectCard({ instance }: { instance: InstanceLite }) {
  const [info, setInfo] = useState<ModelInfo | null>(null)
  const [selected, setSelected] = useState<string>(DEFAULT_MODEL)
  const [saving, setSaving] = useState(false)
  const router = useRouter()

  useEffect(() => {
    let active = true
    fetch(`/api/instances/${instance.id}/model`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: ModelInfo | null) => {
        if (!active || !j) return
        setInfo(j)
        setSelected(j.current ?? DEFAULT_MODEL)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [instance.id])

  const initial = info?.current ?? DEFAULT_MODEL
  const isDirty = selected !== initial

  async function save() {
    setSaving(true)
    try {
      const modelSlug = selected === DEFAULT_MODEL ? null : selected
      const r = await fetch(`/api/instances/${instance.id}/model`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelSlug }),
      })
      const j = await r.json()
      if (!r.ok) {
        toast.error(j.error || "Failed to update model")
        return
      }
      if (j.warning) {
        toast.warning(j.warning)
      } else {
        toast.success(
          modelSlug
            ? `Model updated to "${modelSlug}".${instance.status === "running" ? " Agent restarting." : ""}`
            : "Model reset to the tier default.",
        )
      }
      setInfo((prev) => (prev ? { ...prev, current: modelSlug } : prev))
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  const tierDefaultCtx = formatContext(
    info?.options.find((o) => o.slug === info?.tierDefault)?.contextLength ?? null,
  )

  return (
    <SectionCard
      title="Model"
      description="LLM for this agent (runtime-valid models only)."
    >
      {!info ? (
        <p className="text-sm text-muted-foreground">Loading models…</p>
      ) : (
        <>
          <Select value={selected} onValueChange={(v) => v && setSelected(v)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value={DEFAULT_MODEL}>
                  Default for tier ({info.tierDefault})
                </SelectItem>
                {info.options.map((m) => (
                  <SelectItem key={m.slug} value={m.slug}>
                    {m.label}
                    {formatContext(m.contextLength)
                      ? ` · ${formatContext(m.contextLength)}`
                      : ""}
                    <ModelTagBadge tag={m.tag} />
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <p className="mt-2 flex flex-wrap items-center gap-2 font-mono text-[10px] text-muted-foreground">
            <Badge variant="outline">{info.runtime}</Badge>
            <span>
              {selected === DEFAULT_MODEL ? (
                <>
                  Using tier default:{" "}
                  <span className="text-foreground">{info.tierDefault}</span>
                  {tierDefaultCtx ? ` · ${tierDefaultCtx}` : ""}
                </>
              ) : (
                <>
                  Override:{" "}
                  <span className="text-foreground">{selected}</span>
                </>
              )}
            </span>
          </p>
          {info.options.length === 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              No selectable models for this runtime yet. An admin may need to sync model
              metadata in Admin · Models.
            </p>
          )}
          {isDirty && (
            <Button size="sm" className="mt-3" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save & Apply"}
            </Button>
          )}
        </>
      )}
    </SectionCard>
  )
}

/* ───────────── DOMAIN MANAGEMENT CARD ───────────── */
const DOMAIN_FORMAT_RE =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i

type DomainDnsCheck = {
  apex: string | null
  nameservers: string[]
  resolvedIps: string[]
  expectedIp: string | null
  aRecordMatches: boolean
}

function DomainManageCard({ instance }: { instance: InstanceLite }) {
  const [domain, setDomain] = useState(instance.domain ?? "")
  const [saving, setSaving] = useState(false)
  const [checking, setChecking] = useState(false)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [dnsCheck, setDnsCheck] = useState<DomainDnsCheck | null>(null)
  const router = useRouter()

  function validateLocal(raw: string): string | null {
    const trimmed = raw.trim().toLowerCase()
    if (!trimmed) return null
    if (!DOMAIN_FORMAT_RE.test(trimmed)) {
      return "Enter a valid hostname (e.g. agent.example.com)."
    }
    return null
  }

  async function checkDns() {
    const localErr = validateLocal(domain)
    if (localErr) {
      setFieldError(localErr)
      setDnsCheck(null)
      return
    }
    if (!domain.trim()) {
      setFieldError("Enter a domain to check.")
      return
    }
    setChecking(true)
    setFieldError(null)
    try {
      const r = await fetch(`/api/instances/${instance.id}/domain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: domain.trim(), checkOnly: true }),
      })
      const j = (await r.json()) as DomainDnsCheck & { error?: string }
      if (!r.ok) {
        setDnsCheck(null)
        setFieldError(j.error || "DNS check failed")
        return
      }
      setDnsCheck({
        apex: j.apex,
        nameservers: j.nameservers ?? [],
        resolvedIps: j.resolvedIps ?? [],
        expectedIp: j.expectedIp,
        aRecordMatches: Boolean(j.aRecordMatches),
      })
    } finally {
      setChecking(false)
    }
  }

  async function saveDomain() {
    const trimmed = domain.trim()
    if (trimmed) {
      const localErr = validateLocal(trimmed)
      if (localErr) {
        setFieldError(localErr)
        return
      }
    }
    setSaving(true)
    setFieldError(null)
    try {
      const r = await fetch(`/api/instances/${instance.id}/domain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: trimmed || null }),
      })
      const j = (await r.json()) as DomainDnsCheck & { error?: string; domain?: string | null }
      if (!r.ok) {
        setFieldError(j.error || "Failed to update domain")
        toast.error(j.error || "Failed to update domain")
        return
      }
      if (trimmed) {
        setDnsCheck({
          apex: j.apex ?? null,
          nameservers: j.nameservers ?? [],
          resolvedIps: j.resolvedIps ?? [],
          expectedIp: j.expectedIp ?? instance.ipAddress,
          aRecordMatches: Boolean(j.aRecordMatches),
        })
        toast.success(
          j.aRecordMatches
            ? `Domain set to ${trimmed}. A record already points at this agent.`
            : `Domain set to ${trimmed}. Point an A record → ${instance.ipAddress}`,
        )
      } else {
        setDnsCheck(null)
        toast.success("Domain removed.")
      }
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  return (
    <SectionCard
      title="Custom Domain"
      description={
        instance.domain
          ? `Configured: ${instance.domain}`
          : instance.managedSubdomain
            ? `HTTPS: ${instance.managedSubdomain}`
            : "No custom domain. Access via IP only."
      }
    >
      {/*
        autoComplete + data-* attrs keep browser / password-manager autofill
        from dumping a saved username into this hostname field.
      */}
      <div className="space-y-2">
        <Input
          id="instance-custom-domain"
          name="instance-custom-domain"
          type="text"
          inputMode="url"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-1p-ignore
          data-lpignore="true"
          data-bwignore="true"
          data-form-type="other"
          value={domain}
          onChange={(e) => {
            setDomain(e.target.value)
            setFieldError(null)
            setDnsCheck(null)
          }}
          placeholder="agent.example.com"
          className="font-mono"
          aria-invalid={Boolean(fieldError) || undefined}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={checkDns}
            disabled={checking || saving || !domain.trim()}
          >
            {checking ? "Checking…" : "Check DNS"}
          </Button>
          <Button size="sm" onClick={saveDomain} disabled={saving || checking}>
            {saving ? "…" : "Save"}
          </Button>
        </div>
      </div>
      {fieldError && (
        <p className="mt-2 font-mono text-xs text-destructive">{fieldError}</p>
      )}
      {dnsCheck && !fieldError && (
        <div className="mt-3 space-y-1 rounded-lg border bg-muted/40 p-3 font-mono text-[10px] text-muted-foreground">
          {dnsCheck.apex && (
            <p>
              NS at <span className="text-foreground">{dnsCheck.apex}</span>
              {dnsCheck.nameservers.length > 0 && (
                <>
                  :{" "}
                  <span className="text-foreground">
                    {dnsCheck.nameservers.slice(0, 3).join(", ")}
                    {dnsCheck.nameservers.length > 3 ? "…" : ""}
                  </span>
                </>
              )}
            </p>
          )}
          <p>
            A record:{" "}
            {dnsCheck.resolvedIps.length === 0 ? (
              <span className="text-amber-500">not found yet</span>
            ) : dnsCheck.aRecordMatches ? (
              <span className="text-primary">
                points to {dnsCheck.expectedIp} ✓
              </span>
            ) : (
              <span className="text-amber-500">
                {dnsCheck.resolvedIps.join(", ")} (expected {dnsCheck.expectedIp})
              </span>
            )}
          </p>
        </div>
      )}
      {instance.domain && instance.ipAddress && (
        <p className="mt-2 font-mono text-[10px] text-muted-foreground">
          Point <span className="text-foreground">{instance.domain}</span> A record →{" "}
          <span className="text-primary">{instance.ipAddress}</span>
        </p>
      )}
    </SectionCard>
  )
}

/* ───────────── CLOUDFLARE DOMAIN CARD ───────────── */
function CloudflareDomainCard({
  instance,
  cloudflare,
}: {
  instance: InstanceLite
  cloudflare: CloudflareInfo
}) {
  const router = useRouter()
  const [token, setToken] = useState("")
  const [connecting, setConnecting] = useState(false)

  const [zones, setZones] = useState<CfZone[] | null>(null)
  const [zonesError, setZonesError] = useState<string | null>(null)
  const [zoneId, setZoneId] = useState("")
  const [label, setLabel] = useState("")
  const [saving, setSaving] = useState(false)
  const [needOverwrite, setNeedOverwrite] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)

  const bound = instance.domainProxied && Boolean(instance.domain)

  // Lazily load the user's zones once connected.
  useEffect(() => {
    if (!cloudflare.connected) return
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch("/api/integrations/cloudflare/zones", { cache: "no-store" })
        const j = (await r.json()) as { zones?: CfZone[]; error?: string; code?: string }
        if (cancelled) return
        if (!r.ok) {
          setZonesError(j.error || "Could not load zones")
          return
        }
        setZones(j.zones ?? [])
        if (instance.cfZoneId) setZoneId(instance.cfZoneId)
      } catch {
        if (!cancelled) setZonesError("Could not load zones")
      }
    })()
    return () => {
      cancelled = true
    }
  }, [cloudflare.connected, instance.cfZoneId])

  async function connect() {
    if (!token.trim()) return
    setConnecting(true)
    try {
      const r = await fetch("/api/integrations/cloudflare/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.trim() }),
      })
      const j = (await r.json()) as { zonesCount?: number; error?: string }
      if (!r.ok) {
        toast.error(j.error || "Failed to connect Cloudflare")
        return
      }
      toast.success(`Cloudflare connected. ${j.zonesCount ?? 0} domain(s) available.`)
      setToken("")
      router.refresh()
    } finally {
      setConnecting(false)
    }
  }

  async function disconnect() {
    setDisconnecting(true)
    try {
      const r = await fetch("/api/integrations/cloudflare/disconnect", { method: "POST" })
      const j = (await r.json()) as { orphaned?: string[]; error?: string }
      if (!r.ok) {
        toast.error(j.error || "Failed to disconnect")
        return
      }
      if (j.orphaned && j.orphaned.length > 0) {
        toast.warning(
          `Disconnected. ${j.orphaned.length} DNS record(s) remain in your Cloudflare account and must be removed manually: ${j.orphaned.join(", ")}`,
        )
      } else {
        toast.success("Cloudflare disconnected.")
      }
      router.refresh()
    } finally {
      setDisconnecting(false)
    }
  }

  async function save(overwrite = false) {
    if (!zoneId) {
      toast.error("Select a domain first.")
      return
    }
    setSaving(true)
    try {
      const r = await fetch(`/api/instances/${instance.id}/cloudflare-domain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zoneId, label: label.trim(), overwrite }),
      })
      const j = (await r.json()) as {
        domain?: string
        sslWarning?: string
        error?: string
        code?: string
      }
      if (!r.ok) {
        if (j.code === "cloudflare_record_conflict") {
          setNeedOverwrite(true)
          toast.warning(j.error || "A record already exists. Confirm to overwrite.")
          return
        }
        toast.error(j.error || "Failed to set domain")
        return
      }
      setNeedOverwrite(false)
      toast.success(`Agent will be served at ${j.domain}. DNS & TLS propagating…`)
      if (j.sslWarning) toast.warning(j.sslWarning)
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    setRemoving(true)
    try {
      const r = await fetch(`/api/instances/${instance.id}/cloudflare-domain`, {
        method: "DELETE",
      })
      const j = (await r.json()) as { error?: string }
      if (!r.ok) {
        toast.error(j.error || "Failed to remove domain")
        return
      }
      toast.success("Cloudflare domain removed.")
      router.refresh()
    } finally {
      setRemoving(false)
    }
  }

  const selectedZone = zones?.find((z) => z.id === zoneId)
  const previewHost = selectedZone
    ? label.trim() && label.trim() !== "@"
      ? `${label.trim()}.${selectedZone.name}`
      : selectedZone.name
    : null

  // Not connected → token paste flow.
  if (!cloudflare.connected) {
    return (
      <SectionCard
        title="Cloudflare Domain"
        description="Use your Cloudflare zones for a proxied subdomain."
      >
        <div className="space-y-2">
          <Input
            id="cf-api-token"
            name="cf-api-token"
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            data-1p-ignore
            data-lpignore="true"
            data-bwignore="true"
            data-form-type="other"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Cloudflare API token"
            className="font-mono"
            aria-label="Cloudflare API token"
          />
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Token needs <span className="text-foreground">Zone:Read</span>,{" "}
            <span className="text-foreground">Zone:DNS:Edit</span>,{" "}
            <span className="text-foreground">Zone Settings:Edit</span> —{" "}
            <a
              href="https://dash.cloudflare.com/profile/api-tokens"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              create one
            </a>
            .
          </p>
          <Button size="sm" onClick={connect} disabled={connecting || !token.trim()}>
            <Link2 data-icon="inline-start" />
            {connecting ? "Connecting…" : "Connect"}
          </Button>
        </div>
      </SectionCard>
    )
  }

  // Connected → picker.
  return (
    <SectionCard
      title="Cloudflare Domain"
      description={
        bound
          ? `Proxied at ${instance.domain}`
          : "Pick a zone subdomain for this agent."
      }
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <Cloud className="size-3.5 text-primary" />
            Connected
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={disconnect}
            disabled={disconnecting}
          >
            <Unlink data-icon="inline-start" />
            {disconnecting ? "…" : "Disconnect"}
          </Button>
        </div>
      }
    >
      {zonesError ? (
        <Alert variant="destructive">
          <AlertDescription>{zonesError}</AlertDescription>
        </Alert>
      ) : zones === null ? (
        <p className="text-sm text-muted-foreground">Loading your domains…</p>
      ) : zones.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No zones found. Check the token&apos;s scope.
        </p>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-col gap-2">
            <Input
              id="cf-subdomain-label"
              name="cf-subdomain-label"
              type="text"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-1p-ignore
              data-lpignore="true"
              data-bwignore="true"
              data-form-type="other"
              value={label}
              onChange={(e) => {
                setLabel(e.target.value)
                setNeedOverwrite(false)
              }}
              placeholder="subdomain (blank = apex)"
              className="font-mono"
            />
            <Select
              value={zoneId}
              onValueChange={(v) => {
                if (v) setZoneId(v)
                setNeedOverwrite(false)
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a domain…" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {zones.map((z) => (
                    <SelectItem key={z.id} value={z.id}>
                      {z.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          {previewHost && (
            <p className="font-mono text-[10px] text-muted-foreground">
              <span className="text-primary">{previewHost}</span> →{" "}
              <span className="text-foreground">{instance.ipAddress}</span>
            </p>
          )}

          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Saving may set zone SSL/TLS to <span className="text-foreground">Full</span> for
            every hostname in that zone.
          </p>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={needOverwrite ? "destructive" : "default"}
              onClick={() => save(needOverwrite)}
              disabled={saving || !zoneId}
            >
              {saving ? "Saving…" : needOverwrite ? "Overwrite & Save" : "Save & apply"}
            </Button>
            {bound && (
              <Button size="sm" variant="outline" onClick={remove} disabled={removing}>
                {removing ? "Removing…" : "Remove domain"}
              </Button>
            )}
          </div>
        </div>
      )}
    </SectionCard>
  )
}

/* ───────────── INTERFACES ───────────── */
function InterfacesTab({ instance }: { instance: InstanceLite }) {
  const webUrl = buildPublicGatewayUrl({
    domain: instance.domain,
    managedSubdomain: instance.managedSubdomain,
    tlsStatus: instance.tlsStatus,
    ipAddress: instance.ipAddress,
  })?.url
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <SectionCard title="Web">
        <div className="flex items-center justify-between">
          <Badge variant={instance.status === "running" ? "default" : "outline"}>
            {instance.status === "running" ? "bound" : instance.status}
          </Badge>
        </div>
        <p className="mt-3 break-all font-mono text-xs text-muted-foreground">
          {webUrl ?? "-"}
        </p>
      </SectionCard>
      <SectionCard
        title="Telegram"
        description="Bind a Telegram bot token to route Telegram DMs to this agent."
      >
        <p className="mt-3 font-mono text-[10px] text-muted-foreground/70">
          Use{" "}
          <span className="text-foreground">
            POST /api/instances/{instance.id.slice(0, 8)}…/interfaces/connect
          </span>
        </p>
      </SectionCard>
    </div>
  )
}

/* ───────────── LOGS ───────────── */
function LogsTab({ instanceId, logs: polledLogs }: { instanceId: string; logs: LogLite[] }) {
  const [level, setLevel] = useState<"all" | "info" | "warn" | "error">("all")
  const [olderLogs, setOlderLogs] = useState<LogLite[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(false)
  const [initialized, setInitialized] = useState(false)

  const allLogs = useMemo(() => {
    const seen = new Set<string>()
    const merged: LogLite[] = []
    for (const l of polledLogs) {
      if (!seen.has(l.id)) { seen.add(l.id); merged.push(l) }
    }
    for (const l of olderLogs) {
      if (!seen.has(l.id)) { seen.add(l.id); merged.push(l) }
    }
    return merged
  }, [polledLogs, olderLogs])

  const filtered = allLogs.filter((l) => level === "all" || l.level === level)

  async function loadMore() {
    setLoading(true)
    try {
      const qs = new URLSearchParams({ limit: "100" })
      if (cursor) qs.set("cursor", cursor)
      if (level !== "all") qs.set("level", level)
      const r = await fetch(`/api/instances/${instanceId}/logs?${qs}`, { cache: "no-store" })
      if (!r.ok) return
      const data = await r.json() as { logs: LogLite[]; nextCursor: string | null }
      setOlderLogs((prev) => [...prev, ...data.logs])
      setCursor(data.nextCursor)
      setHasMore(data.nextCursor !== null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!initialized) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInitialized(true)
      loadMore()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOlderLogs([])
    setCursor(null)
    setHasMore(true)
    setInitialized(false)
  }, [level])

  useEffect(() => {
    if (!initialized) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInitialized(true)
      loadMore()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialized])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {(["all", "info", "warn", "error"] as const).map((l) => (
          <Button
            key={l}
            size="sm"
            variant={level === l ? "default" : "outline"}
            className="rounded-full"
            onClick={() => setLevel(l)}
          >
            {l === "all" ? "All" : l.charAt(0).toUpperCase() + l.slice(1)}
          </Button>
        ))}
      </div>
      <Card className="max-h-[36rem] overflow-y-auto bg-zinc-950 p-4">
        <div className="space-y-1 font-mono text-xs">
          {filtered.length === 0 && !loading ? (
            <p className="text-muted-foreground">No log entries.</p>
          ) : (
            <>
              {filtered.map((l) => (
                <p key={l.id}>
                  <span className="text-zinc-500">{l.createdAt.slice(0, 19)}</span>{" "}
                  <span
                    className={
                      l.level === "error"
                        ? "text-red-400"
                        : l.level === "warn"
                          ? "text-amber-400"
                          : "text-emerald-400"
                    }
                  >
                    [{l.level}]
                  </span>{" "}
                  <span className="text-zinc-200">{l.message}</span>
                </p>
              ))}
              {hasMore && (
                <Button
                  className="mt-3"
                  size="sm"
                  variant="outline"
                  onClick={loadMore}
                  disabled={loading}
                >
                  {loading ? "Loading…" : "Load More"}
                </Button>
              )}
            </>
          )}
        </div>
      </Card>
    </div>
  )
}

/* ───────────── DANGER ZONE ───────────── */
function DangerTab({ instance }: { instance: InstanceLite }) {
  const router = useRouter()
  const [confirmText, setConfirmText] = useState("")
  const [deleting, setDeleting] = useState(false)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const matches = confirmText === instance.name

  async function doDelete() {
    setDeleting(true)
    setError(null)
    try {
      const r = await fetch(`/api/instances/${instance.id}`, { method: "DELETE" })
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string }
        setError(body.error || r.statusText)
        setDeleting(false)
        return
      }
      router.push("/dashboard/instances")
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card className="border-destructive/30 bg-destructive/5">
        <CardHeader>
          <CardDescription className="font-mono text-[10px] tracking-[0.1em] uppercase text-destructive">
            Delete Instance
          </CardDescription>
          <p className="text-sm text-muted-foreground">
            Permanently deletes this bot, its config, logs, and all associated data. Also destroys
            the agent&apos;s server. This cannot be undone.
          </p>
        </CardHeader>
        <CardContent>
          <AlertDialog
            open={open}
            onOpenChange={(o) => {
              setOpen(o)
              if (!o) {
                setConfirmText("")
                setError(null)
              }
            }}
          >
            <AlertDialogTrigger
              render={
                <Button variant="destructive">
                  <Trash2 data-icon="inline-start" />
                  Delete Instance
                </Button>
              }
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete {instance.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This cannot be undone. Type <span className="font-mono text-destructive">{instance.name}</span> to confirm.
                  Your remaining credits stay in your account and can be used by a new agent.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="confirm">Instance name</FieldLabel>
                  <Input
                    id="confirm"
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder={instance.name}
                    className="font-mono"
                  />
                </Field>
              </FieldGroup>
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>Delete failed: {error}</AlertDescription>
                </Alert>
              )}
              <AlertDialogFooter>
                <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={!matches || deleting}
                  onClick={(e) => {
                    e.preventDefault()
                    doDelete()
                  }}
                >
                  {deleting ? "Deleting…" : "I understand, delete"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  )
}

/* ───────────── BACKUP & RESTORE ───────────── */

function formatBytes(n: number | null): string {
  if (!n) return "-"
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function BackupTab({
  instance,
  drive,
  initialBackups,
}: {
  instance: InstanceLite
  drive: DriveInfo
  initialBackups: BackupLite[]
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const [backups, setBackups] = useState<BackupLite[]>(initialBackups)
  const [connecting, setConnecting] = useState(false)
  const [backingUp, setBackingUp] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  // Surface the OAuth callback result, then strip the `?drive=` param.
  useEffect(() => {
    const status = searchParams.get("drive")
    if (!status) return
    if (status === "connected") toast.success("Google Drive connected.")
    else if (status === "norefresh")
      toast.error("Google didn't return a refresh token. Please try connecting again.")
    else if (status === "noscope")
      toast.error("Google Drive permission was not granted. Reconnect and keep the Drive checkbox checked.")
    else toast.error("Could not connect Google Drive. Please try again.")
    router.replace(`${pathname}?tab=backup`)
    if (status === "connected") router.refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  async function refreshList(fromDrive = false) {
    setRefreshing(true)
    try {
      const r = await fetch(
        `/api/instances/${instance.id}/backups${fromDrive ? "?source=drive" : ""}`,
        { cache: "no-store" },
      )
      const j = (await r.json()) as { backups?: BackupLite[]; error?: string; detail?: string }
      if (!r.ok) {
        toast.error(j.detail || j.error || "Could not load backups.")
        return
      }
      setBackups(j.backups ?? [])
    } finally {
      setRefreshing(false)
    }
  }

  async function connect() {
    setConnecting(true)
    try {
      const r = await fetch(`/api/integrations/drive/connect?instanceId=${instance.id}`)
      const j = (await r.json()) as { url?: string; error?: string }
      if (!r.ok || !j.url) {
        toast.error(j.error || "Could not start Google Drive connection.")
        setConnecting(false)
        return
      }
      window.location.href = j.url
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
      setConnecting(false)
    }
  }

  async function disconnect() {
    const r = await fetch(`/api/integrations/drive/disconnect`, { method: "POST" })
    if (!r.ok) {
      toast.error("Could not disconnect Google Drive.")
      return
    }
    toast.success("Google Drive disconnected.")
    router.refresh()
  }

  async function backupNow() {
    setBackingUp(true)
    try {
      const r = await fetch(`/api/instances/${instance.id}/backup`, { method: "POST" })
      const j = (await r.json()) as {
        backup?: BackupLite
        error?: string
        code?: string
        detail?: string
      }
      if (!r.ok) {
        if (j.code === "drive_reauth") toast.error("Drive access expired. Reconnect to continue.")
        else toast.error(j.detail || j.error || "Backup failed.")
        return
      }
      if (j.backup) setBackups((prev) => [j.backup as BackupLite, ...prev])
      toast.success("Backup saved to Google Drive.")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBackingUp(false)
    }
  }

  if (!drive.configured) {
    return (
      <SectionCard title="Backup & Restore">
        <p className="text-sm text-muted-foreground">
          Google Drive backups aren&apos;t enabled on this platform. Ask your administrator to
          configure Google OAuth credentials.
        </p>
      </SectionCard>
    )
  }

  return (
    <div className="space-y-4">
      <SectionCard
        title="Google Drive"
        description="Back up this agent's settings to your own Google Drive and restore them anytime."
      >
        {drive.connected ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm">
              <Cloud className="size-4 text-primary" />
              <span className="text-foreground">
                Connected{drive.email ? ` as ${drive.email}` : ""}
              </span>
            </div>
            <Button variant="outline" size="sm" onClick={disconnect}>
              <Unlink data-icon="inline-start" />
              Disconnect
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Connect your Google Drive to enable backups.
            </p>
            <Button size="sm" disabled={connecting} onClick={connect}>
              {connecting ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Link2 data-icon="inline-start" />}
              Connect Google Drive
            </Button>
          </div>
        )}
      </SectionCard>

      {drive.connected && (
        <SectionCard
          title="Backups"
          footer={
            <div className="flex items-center gap-2">
              <Button size="sm" disabled={backingUp} onClick={backupNow}>
                {backingUp ? (
                  <Loader2 data-icon="inline-start" className="animate-spin" />
                ) : (
                  <CloudUpload data-icon="inline-start" />
                )}
                Back up now
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={refreshing}
                onClick={() => refreshList(true)}
              >
                <RefreshCw data-icon="inline-start" className={refreshing ? "animate-spin" : ""} />
                Refresh from Drive
              </Button>
            </div>
          }
        >
          {backups.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No backups yet. Click &ldquo;Back up now&rdquo; to create one.
            </p>
          ) : (
            <div className="divide-y divide-border">
              {backups.map((b) => (
                <div
                  key={b.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="truncate font-mono text-sm text-foreground">{b.fileName}</p>
                    <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                      {new Date(b.createdAt).toLocaleString()} · {formatBytes(b.sizeBytes)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <RestoreDialog instance={instance} backup={b} />
                    <DeleteBackupButton
                      instance={instance}
                      backup={b}
                      onDeleted={() => setBackups((prev) => prev.filter((x) => x.id !== b.id))}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      )}
    </div>
  )
}

function RestoreDialog({ instance, backup }: { instance: InstanceLite; backup: BackupLite }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<"new" | "in_place">("new")
  const [name, setName] = useState(backup.agentName)
  const [busy, setBusy] = useState(false)

  async function doRestore() {
    setBusy(true)
    try {
      const r = await fetch(
        `/api/instances/${instance.id}/backups/${backup.id}/restore`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            mode === "new" ? { mode, name } : { mode, targetInstanceId: instance.id },
          ),
        },
      )
      const j = (await r.json()) as {
        success?: boolean
        instanceId?: string
        warning?: string
        error?: string
      }
      if (!r.ok) {
        toast.error(j.error || "Restore failed.")
        return
      }
      setOpen(false)
      if (j.warning) toast.warning(j.warning)
      if (mode === "new" && j.instanceId) {
        toast.success("Agent restored. Provisioning started.")
        router.push(`/dashboard/instances/${j.instanceId}`)
      } else {
        toast.success("Settings restored from backup.")
        router.refresh()
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <RotateCcw data-icon="inline-start" />
            Restore
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Restore from backup</DialogTitle>
          <DialogDescription>
            Restore the settings captured in{" "}
            <span className="font-mono text-foreground">{backup.fileName}</span>.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <ToggleGroup
            value={[mode]}
            onValueChange={(v) => {
              const next = (v[0] as "new" | "in_place") ?? mode
              setMode(next)
            }}
            className="w-full"
          >
            <ToggleGroupItem value="new" className="flex-1">
              New agent
            </ToggleGroupItem>
            <ToggleGroupItem value="in_place" className="flex-1">
              Overwrite this agent
            </ToggleGroupItem>
          </ToggleGroup>

          {mode === "new" ? (
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="restore-name">New agent name</FieldLabel>
                <Input
                  id="restore-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={backup.agentName}
                />
              </Field>
              <p className="text-xs text-muted-foreground">
                Creates a fresh agent on the free tier and starts provisioning. BYOS agents can&apos;t
                be recreated this way.
              </p>
            </FieldGroup>
          ) : (
            <p className="text-sm text-muted-foreground">
              Overwrites <span className="font-mono text-foreground">{instance.name}</span>&apos;s
              settings with this backup. Infrastructure and credentials are kept; a running agent is
              updated live.
            </p>
          )}
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" disabled={busy}>Cancel</Button>} />
          <Button disabled={busy || (mode === "new" && !name.trim())} onClick={doRestore}>
            {busy ? <Loader2 data-icon="inline-start" className="animate-spin" /> : null}
            Restore
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DeleteBackupButton({
  instance,
  backup,
  onDeleted,
}: {
  instance: InstanceLite
  backup: BackupLite
  onDeleted: () => void
}) {
  const [busy, setBusy] = useState(false)

  async function doDelete() {
    setBusy(true)
    try {
      const r = await fetch(`/api/instances/${instance.id}/backups/${backup.id}`, {
        method: "DELETE",
      })
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string }
        toast.error(j.error || "Could not delete backup.")
        return
      }
      toast.success("Backup deleted.")
      onDeleted()
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label="Delete backup">
            <Trash2 />
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this backup?</AlertDialogTitle>
          <AlertDialogDescription>
            Removes <span className="font-mono text-foreground">{backup.fileName}</span> from your
            Google Drive. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={(e) => {
              e.preventDefault()
              doDelete()
            }}
          >
            {busy ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
