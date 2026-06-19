"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowUpRight, Bot, Loader2, MoreHorizontal, Search, Trash2 } from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { runtimeLabel } from "@/lib/runtimes/labels"
import { RuntimeLogo } from "@/components/dashboard/runtime-logo"

type InstanceStatus =
  | "pending"
  | "running"
  | "provisioning"
  | "stopped"
  | "failed_provisioning"
  | "failed"
  | "deleting"
  | string

// Colored status dot + label. Dot hue conveys health; the label keeps it
// accessible without relying on color alone.
function StatusPill({ status }: { status: InstanceStatus }) {
  const tone =
    status === "running"
      ? "bg-emerald-500"
      : status === "failed" || status === "failed_provisioning"
        ? "bg-rose-500"
        : status === "stopped"
          ? "bg-zinc-400"
          : "bg-amber-500"
  const pulse =
    status === "provisioning" || status === "pending" || status === "deleting"
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-foreground">
      <span className={`size-2 rounded-full ${tone} ${pulse ? "animate-pulse" : ""}`} />
      <span className="capitalize">{status.replace(/_/g, " ")}</span>
    </span>
  )
}

type Item = {
  id: string
  name: string
  slug: string
  status: string
  ipAddress: string | null
  runtime: string | null
  deploymentTarget: string | null
  serverLabel: string
  vcpu: number
  ramGb: number
  priceMonthly: number
  recentLogs: { id: string; level: string; message: string; createdAt: string }[]
}

const FILTERS = [
  { label: "All", value: "all" },
  { label: "Running", value: "running" },
  { label: "Provisioning", value: "provisioning" },
  { label: "Pending", value: "pending" },
  { label: "Stopped", value: "stopped" },
  { label: "Failed", value: "failed_provisioning" },
  { label: "Deleting", value: "deleting" },
] as const
type Filter = (typeof FILTERS)[number]["value"]

type Sort = "newest" | "name" | "status"

const STATUS_ORDER: Record<string, number> = {
  running: 0,
  provisioning: 1,
  pending: 2,
  deleting: 3,
  stopped: 4,
  failed_provisioning: 5,
  failed: 6,
}

function mapRowsToItems(
  rows: Array<{
    id: string
    name: string
    slug: string
    status: string
    ipAddress: string | null
    runtime?: string | null
    deploymentTarget?: string | null
    serverConfig: { label: string; vcpu: number; ramGb: number; priceMonthly?: number }
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
      runtime: row.runtime ?? null,
      deploymentTarget: row.deploymentTarget ?? null,
      serverLabel: row.serverConfig.label,
      vcpu: row.serverConfig.vcpu,
      ramGb: row.serverConfig.ramGb,
      priceMonthly: row.serverConfig.priceMonthly ?? 0,
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
  const [sort, setSort] = useState<Sort>("newest")
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Item | null>(null)

  const handleConfirmDelete = useCallback(async () => {
    if (!pendingDelete) return
    setDeletingId(pendingDelete.id)
    try {
      const r = await fetch(`/api/instances/${pendingDelete.id}`, { method: "DELETE" })
      if (r.ok) {
        setItems((prev) => prev.filter((i) => i.id !== pendingDelete.id))
        router.refresh()
      } else {
        const body = await r.json().catch(() => ({}))
        alert(body.error || "Delete failed")
      }
    } catch {
      alert("Delete failed")
    }
    setDeletingId(null)
    setPendingDelete(null)
  }, [pendingDelete, router])

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
          runtime?: string | null
          deploymentTarget?: string | null
          region: { flag: string; name: string }
          serverConfig: { label: string; vcpu: number; ramGb: number; priceMonthly?: number }
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

  const filtered = useMemo(() => {
    const list = items.filter((i) => {
      if (status !== "all" && i.status !== status) return false
      if (q && !`${i.name} ${i.slug}`.toLowerCase().includes(q.toLowerCase())) return false
      return true
    })
    if (sort === "name") {
      list.sort((a, b) => a.name.localeCompare(b.name))
    } else if (sort === "status") {
      list.sort(
        (a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9)
      )
    }
    // "newest" keeps the server order (createdAt desc).
    return list
  }, [items, q, status, sort])

  // Highest daily cost among running agents, for relative usage bars.
  const maxDailyCost = useMemo(
    () =>
      Math.max(
        0.01,
        ...items.filter((i) => i.status === "running").map((i) => i.priceMonthly / 30)
      ),
    [items]
  )

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <InputGroup className="w-full max-w-xs">
          <InputGroupAddon align="inline-start">
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or slug..."
          />
        </InputGroup>
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <Button
              key={f.value}
              size="sm"
              variant={status === f.value ? "default" : "outline"}
              className={`h-auto rounded-full px-3.5 py-1.5 text-xs ${
                status === f.value ? "" : "bg-secondary"
              }`}
              onClick={() => setStatus(f.value)}
            >
              {f.label}
            </Button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-3">
          <Select value={sort} onValueChange={(v) => v && setSort(v as Sort)}>
            <SelectTrigger size="sm" className="w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest</SelectItem>
              <SelectItem value="name">Name A–Z</SelectItem>
              <SelectItem value="status">Status</SelectItem>
            </SelectContent>
          </Select>
          <p className="font-mono text-xs text-muted-foreground">
            {filtered.length} / {items.length}
          </p>
        </div>
      </div>

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-8">
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Search />
                </EmptyMedia>
                <EmptyTitle>No matches</EmptyTitle>
                <EmptyDescription>Try a different search or filter.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3.5">
          {filtered.map((instance) => {
            const dailyCost = instance.priceMonthly / 30
            const isRunning = instance.status === "running"
            const canDelete = DELETABLE_STUCK_STATES.has(instance.status)
            const runtimeId = instance.runtime ?? "openclaw"
            return (
              <div
                key={instance.id}
                className="group rounded-2xl border border-border bg-card p-[22px]"
              >
                {/* ── Top row ── */}
                <div className="flex items-start gap-4">
                  <div className="flex size-[46px] shrink-0 items-center justify-center rounded-xl border border-border bg-secondary text-primary">
                    <Bot className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <p className="truncate text-[17px] font-semibold text-foreground">
                        {instance.name}
                      </p>
                      {isRunning ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-xs text-foreground">
                          <span className="size-1.5 rounded-full bg-emerald-500 shadow-[0_0_7px_#34d27b]" />
                          running
                        </span>
                      ) : (
                        <StatusPill status={instance.status} />
                      )}
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1">
                        <RuntimeLogo runtime={runtimeId} size={13} className="size-[13px]" />
                        <span className="font-mono text-xs text-muted-foreground">
                          {runtimeLabel(instance.runtime)}
                        </span>
                      </span>
                    </div>
                    <p className="mt-1.5 truncate font-mono text-xs text-muted-foreground">
                      {instance.slug}
                      {instance.ipAddress ? ` · ${instance.ipAddress}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Link
                      href={`/dashboard/instances/${instance.id}`}
                      className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                    >
                      Manage
                      <ArrowUpRight className="size-4" />
                    </Link>
                    {canDelete && (
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              size="sm"
                              variant="ghost"
                              className="size-8 px-0"
                              aria-label="More actions"
                              disabled={deletingId === instance.id}
                            >
                              {deletingId === instance.id ? (
                                <Loader2 className="size-4 animate-spin" />
                              ) : (
                                <MoreHorizontal className="size-4" />
                              )}
                            </Button>
                          }
                        />
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => setPendingDelete(instance)}
                          >
                            <Trash2 />
                            Delete agent
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </div>

                {/* ── Footer: 3-up sub-tiles ── */}
                <div className="mt-4 grid grid-cols-3 gap-3">
                  <div className="rounded-[11px] border border-border bg-sidebar p-[13px_15px]">
                    <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                      Server
                    </p>
                    <p className="mt-1 truncate text-sm text-foreground">{instance.serverLabel}</p>
                  </div>
                  <div className="rounded-[11px] border border-border bg-sidebar p-[13px_15px]">
                    <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                      Specs
                    </p>
                    <p className="mt-1 truncate text-sm text-foreground">
                      {instance.vcpu} vCPU · {instance.ramGb} GB
                    </p>
                  </div>
                  <div className="rounded-[11px] border border-border bg-sidebar p-[13px_15px]">
                    <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                      Cost / day
                    </p>
                    {isRunning ? (
                      <div className="mt-1 space-y-1.5">
                        <span className="font-mono text-sm text-foreground">
                          ${dailyCost.toFixed(2)}
                        </span>
                        <Progress value={(dailyCost / maxDailyCost) * 100} />
                      </div>
                    ) : (
                      <p className="mt-1 text-sm text-muted-foreground">—</p>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this agent?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete
                ? `"${pendingDelete.name}" will be removed. This action cannot be undone.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
