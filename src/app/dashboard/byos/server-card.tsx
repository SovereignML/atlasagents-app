"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Cpu, HardDrive, Loader2, MemoryStick, Plus, RefreshCw, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type ServerCardData = {
  id: string
  label: string
  host: string
  port: number
  sshUser: string
  status: string
  lastError: string | null
  lastCheckedAt: string | null
  hwCpuCores: number | null
  hwRamTotalMb: number | null
  hwDiskTotalGb: number | null
  hwDiskUsedGb: number | null
  hwOsName: string | null
  hwOsVersion: string | null
  hwKernel: string | null
  capacityAgents: number
  agentCount: number
}

function gb(mb: number | null): string {
  return mb == null ? "—" : `${Math.round((mb / 1024) * 10) / 10} GB`
}

function relative(iso: string | null): string {
  if (!iso) return "never"
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (secs < 60) return "just now"
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}

/**
 * One connected server. Shows the hardware we actually measured over SSH —
 * never a plan's nominal figures, which for BYOS are all zero.
 */
export function ServerCard({ server }: { server: ServerCardData }) {
  const router = useRouter()
  const [busy, setBusy] = useState<"refresh" | "disconnect" | null>(null)

  const reachable = server.status === "reachable"
  const probed = server.hwCpuCores != null
  const free = Math.max(0, server.capacityAgents - server.agentCount)

  async function refresh() {
    setBusy("refresh")
    try {
      const res = await fetch(`/api/byos/servers/${server.id}`, { method: "POST" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Refresh failed")
      toast.success("Server details refreshed")
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Refresh failed")
    } finally {
      setBusy(null)
    }
  }

  async function disconnect() {
    setBusy("disconnect")
    try {
      const res = await fetch(`/api/byos/servers/${server.id}`, { method: "DELETE" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Couldn't disconnect")
      toast.success("Server disconnected. Nothing on the machine was changed.")
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't disconnect")
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "size-2 shrink-0 rounded-full",
                reachable ? "bg-emerald-500" : "bg-destructive",
              )}
              aria-hidden
            />
            <h3 className="truncate text-base font-semibold text-foreground">{server.label}</h3>
          </div>
          <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
            {server.sshUser}@{server.host}
            {server.port !== 22 ? `:${server.port}` : ""}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={refresh} disabled={busy !== null}>
            {busy === "refresh" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Refresh
          </Button>
          {server.agentCount === 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={disconnect}
              disabled={busy !== null}
              aria-label={`Disconnect ${server.label}`}
            >
              {busy === "disconnect" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
            </Button>
          )}
        </div>
      </div>

      {!reachable && server.lastError && (
        <p className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {server.lastError}
        </p>
      )}

      {/* The measured machine. */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat icon={<Cpu className="h-3.5 w-3.5" />} label="CPU">
          {server.hwCpuCores != null ? `${server.hwCpuCores} vCPU` : "—"}
        </Stat>
        <Stat icon={<MemoryStick className="h-3.5 w-3.5" />} label="Memory">
          {gb(server.hwRamTotalMb)}
        </Stat>
        <Stat icon={<HardDrive className="h-3.5 w-3.5" />} label="Disk">
          {server.hwDiskTotalGb != null
            ? `${server.hwDiskUsedGb ?? 0}/${server.hwDiskTotalGb} GB`
            : "—"}
        </Stat>
        <Stat label="OS">
          {server.hwOsName ? `${server.hwOsName} ${server.hwOsVersion ?? ""}`.trim() : "—"}
        </Stat>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <p className="text-sm text-muted-foreground">
          {!probed ? (
            "Not inspected yet."
          ) : server.agentCount === 0 ? (
            <>
              No agents yet — room for about{" "}
              <span className="text-foreground">{server.capacityAgents}</span>.
            </>
          ) : (
            <>
              <span className="text-foreground">{server.agentCount}</span>{" "}
              {server.agentCount === 1 ? "agent" : "agents"} running
              {free > 0 ? `, room for about ${free} more` : ""}.
            </>
          )}
          <span className="ml-2 text-xs">Checked {relative(server.lastCheckedAt)}.</span>
        </p>

        <Button
          size="sm"
          variant="gradient"
          disabled={!reachable}
          render={
            <Link href={`/dashboard/byos/deploy?serverId=${server.id}`}>
              <Plus data-icon="inline-start" />
              Install agent
            </Link>
          }
        />
      </div>
    </div>
  )
}

function Stat({
  icon,
  label,
  children,
}: {
  icon?: React.ReactNode
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
        {icon}
        {label}
      </p>
      <p className="mt-1 truncate text-sm text-foreground">{children}</p>
    </div>
  )
}
