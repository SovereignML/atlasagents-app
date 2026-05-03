"use client"

import { useEffect, useMemo, useState, useCallback } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Badge } from "@/components/ui/badge"

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  running: "bg-primary/10 text-primary border-primary/30",
  provisioning: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  stopped: "bg-[var(--card-bg)] text-[var(--text-secondary)] border-[var(--border-color)]",
  failed_provisioning: "bg-red-500/10 text-red-400 border-red-500/30",
  deleting: "bg-zinc-800/20 text-zinc-400 border-zinc-800/30",
}

type Item = {
  id: string
  name: string
  slug: string
  status: string
  ipAddress: string | null
  regionLabel: string
  serverLabel: string
  vcpu: number
  ramGb: number
  recentLogs: { id: string; level: string; message: string; createdAt: string }[]
}

const FILTERS = [
  "all",
  "running",
  "provisioning",
  "pending",
  "stopped",
  "failed_provisioning",
  "deleting",
] as const
type Filter = (typeof FILTERS)[number]

function mapRowsToItems(
  rows: Array<{
    id: string
    name: string
    slug: string
    status: string
    ipAddress: string | null
    region: { flag: string; name: string }
    serverConfig: { label: string; vcpu: number; ramGb: number }
    logs?: Array<{ id: string; level: string; message: string; createdAt: string | Date }>
  }>,
): Item[] {
  return rows
    .filter((row) => row.status !== "deleted")
    .map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      status: row.status,
      ipAddress: row.ipAddress,
      regionLabel: `${row.region.flag} ${row.region.name}`,
      serverLabel: row.serverConfig.label,
      vcpu: row.serverConfig.vcpu,
      ramGb: row.serverConfig.ramGb,
      recentLogs: (row.logs ?? []).slice(0, 3).map((l) => ({
        id: l.id,
        level: l.level,
        message: l.message,
        createdAt:
          typeof l.createdAt === "string"
            ? l.createdAt
            : new Date(l.createdAt).toISOString(),
      })),
    }))
}

const DELETABLE_STUCK_STATES = new Set(["pending", "failed_provisioning", "failed"])

export function InstancesFilter({ items: initialItems }: { items: Item[] }) {
  const router = useRouter()
  const [items, setItems] = useState(() => initialItems.filter((i) => i.status !== "deleted"))
  const [q, setQ] = useState("")
  const [status, setStatus] = useState<Filter>("all")
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const handleQuickDelete = useCallback(async (e: React.MouseEvent, instance: Item) => {
    e.preventDefault()
    e.stopPropagation()
    if (!confirm(`Delete "${instance.name}"? This cannot be undone.`)) return
    setDeletingId(instance.id)
    try {
      const r = await fetch(`/api/instances/${instance.id}`, { method: "DELETE" })
      if (r.ok) {
        setItems((prev) => prev.filter((i) => i.id !== instance.id))
        router.refresh()
      } else {
        const body = await r.json().catch(() => ({}))
        alert(body.error || "Delete failed")
      }
    } catch {
      alert("Delete failed")
    }
    setDeletingId(null)
  }, [router])

  const hasProvisioning = items.some(
    (i) => i.status === "pending" || i.status === "provisioning" || i.status === "deleting",
  )

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setItems(initialItems.filter((i) => i.status !== "deleted"))
  }, [initialItems])

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    async function poll() {
      try {
        const r = await fetch("/api/instances", { cache: "no-store" })
        if (!r.ok || cancelled) return
        const rows = (await r.json()) as Array<{
          id: string
          name: string
          slug: string
          status: string
          ipAddress: string | null
          region: { flag: string; name: string }
          serverConfig: { label: string; vcpu: number; ramGb: number }
          logs?: Array<{ id: string; level: string; message: string; createdAt: string | Date }>
        }>
        setItems(mapRowsToItems(rows))
      } catch {
        /* retry next interval */
      }
      if (!cancelled) {
        const interval = hasProvisioning ? 4_000 : 12_000
        timer = setTimeout(poll, interval)
      }
    }

    void poll()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [hasProvisioning])

  const filtered = useMemo(
    () =>
      items.filter((i) => {
        if (status !== "all" && i.status !== status) return false
        if (q && !`${i.name} ${i.slug}`.toLowerCase().includes(q.toLowerCase())) return false
        return true
      }),
    [items, q, status]
  )

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name or slug..."
          className="flex-1 min-w-[16rem] bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl px-3 py-2 text-sm font-mono text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/50 focus:outline-none focus:border-primary"
        />
        <div className="flex gap-1">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setStatus(f)}
              className={`px-3 py-2 rounded-lg text-[10px] font-mono border ${
                status === f
                  ? "border-primary text-primary bg-primary/10"
                  : "border-[var(--border-color)] text-[var(--text-secondary)] hover:border-primary"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <p className="text-[10px] font-mono text-[var(--text-secondary)] ml-auto">
          {filtered.length} / {items.length}
        </p>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-[var(--shadow-sm)] p-12 text-center">
          <p className="text-[var(--text-secondary)]">No matches.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((instance) => (
            <Link
              key={instance.id}
              href={`/dashboard/instances/${instance.id}`}
              className="block rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-[var(--shadow-sm)] p-6 space-y-4 hover:border-primary transition-colors"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-3">
                    <h3 className="text-lg font-bold text-[var(--text-primary)]">
                      {instance.name}
                    </h3>
                    <Badge className={STATUS_STYLES[instance.status] || STATUS_STYLES.stopped}>
                      {instance.status}
                    </Badge>
                    {(instance.status === "provisioning" ||
                      instance.status === "pending" ||
                      instance.status === "deleting") && (
                      <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                    )}
                  </div>
                  <p className="text-xs text-[var(--text-secondary)] mt-1 font-mono">
                    {instance.slug}
                    {instance.ipAddress && (
                      <>
                        {" · "}
                        <span className="text-primary">
                          {instance.ipAddress}
                        </span>
                      </>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {DELETABLE_STUCK_STATES.has(instance.status) && (
                    <button
                      onClick={(e) => handleQuickDelete(e, instance)}
                      disabled={deletingId === instance.id}
                      className="px-3 py-1.5 rounded-lg text-[10px] font-mono bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 disabled:opacity-40"
                    >
                      {deletingId === instance.id ? "Deleting..." : "Delete"}
                    </button>
                  )}
                  <span className="text-xs text-[var(--text-secondary)] font-mono">→ Manage</span>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {[
                  { label: "Region", value: instance.regionLabel },
                  { label: "Server", value: instance.serverLabel },
                  { label: "Specs", value: `${instance.vcpu} vCPU · ${instance.ramGb} GB` },
                  { label: "IP", value: instance.ipAddress || "Pending", mono: true },
                ].map((d) => (
                  <div key={d.label} className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-3">
                    <p className="text-[var(--text-secondary)] text-xs font-mono">
                      {d.label}
                    </p>
                    <p className={`text-[var(--text-primary)] mt-0.5 text-sm ${d.mono ? "font-mono text-xs" : ""}`}>
                      {d.value}
                    </p>
                  </div>
                ))}
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  )
}
