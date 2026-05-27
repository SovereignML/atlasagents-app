"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Loader2, Search, Trash2 } from "lucide-react"

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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { runtimeLabel } from "@/lib/runtimes/labels"

type InstanceStatus =
  | "pending"
  | "running"
  | "provisioning"
  | "stopped"
  | "failed_provisioning"
  | "failed"
  | "deleting"
  | string

function statusBadgeVariant(status: InstanceStatus): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "running":
      return "default"
    case "failed":
    case "failed_provisioning":
      return "destructive"
    case "provisioning":
    case "pending":
    case "deleting":
      return "outline"
    case "stopped":
    default:
      return "secondary"
  }
}

type Item = {
  id: string
  name: string
  slug: string
  status: string
  ipAddress: string | null
  runtime: string | null
  deploymentTarget: string | null
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
    runtime?: string | null
    deploymentTarget?: string | null
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
      runtime: row.runtime ?? null,
      deploymentTarget: row.deploymentTarget ?? null,
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
      <div className="flex flex-wrap items-center gap-3">
        <InputGroup className="min-w-64 flex-1">
          <InputGroupAddon align="inline-start">
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or slug..."
          />
        </InputGroup>
        <ToggleGroup
          value={[status]}
          onValueChange={(v) => {
            const next = v[0]
            if (next) setStatus(next as Filter)
          }}
          variant="outline"
          size="sm"
        >
          {FILTERS.map((f) => (
            <ToggleGroupItem key={f} value={f} className="font-mono text-[10px]">
              {f}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <p className="ml-auto font-mono text-[10px] text-muted-foreground">
          {filtered.length} / {items.length}
        </p>
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
        <div className="space-y-4">
          {filtered.map((instance) => (
            <Link key={instance.id} href={`/dashboard/instances/${instance.id}`} className="block">
              <Card className="transition-colors hover:border-primary/50">
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-semibold text-foreground">{instance.name}</h3>
                        <Badge variant={statusBadgeVariant(instance.status)}>{instance.status}</Badge>
                        {instance.deploymentTarget === "vps" && (
                          <Badge variant="outline">{runtimeLabel(instance.runtime)}</Badge>
                        )}
                        {(instance.status === "provisioning" ||
                          instance.status === "pending" ||
                          instance.status === "deleting") && (
                          <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />
                        )}
                      </div>
                      <p className="mt-1 font-mono text-xs text-muted-foreground">
                        {instance.slug}
                        {instance.ipAddress && (
                          <>
                            {" · "}
                            <span className="text-primary">{instance.ipAddress}</span>
                          </>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      {DELETABLE_STUCK_STATES.has(instance.status) && (
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={deletingId === instance.id}
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            setPendingDelete(instance)
                          }}
                        >
                          {deletingId === instance.id ? (
                            <Loader2 data-icon="inline-start" className="animate-spin" />
                          ) : (
                            <Trash2 data-icon="inline-start" />
                          )}
                          {deletingId === instance.id ? "Deleting..." : "Delete"}
                        </Button>
                      )}
                      <span className="font-mono text-xs text-muted-foreground">→ Manage</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                    {[
                      { label: "Region", value: instance.regionLabel },
                      { label: "Server", value: instance.serverLabel },
                      { label: "Specs", value: `${instance.vcpu} vCPU · ${instance.ramGb} GB` },
                      { label: "IP", value: instance.ipAddress || "Pending", mono: true },
                    ].map((d) => (
                      <div key={d.label} className="rounded-lg border bg-muted/40 p-3">
                        <p className="font-mono text-xs text-muted-foreground">{d.label}</p>
                        <p className={`mt-0.5 text-sm text-foreground ${d.mono ? "font-mono text-xs" : ""}`}>
                          {d.value}
                        </p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
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
