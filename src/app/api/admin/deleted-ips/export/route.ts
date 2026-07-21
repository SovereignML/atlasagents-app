import { NextResponse } from "next/server"

import {
  db,
  instances,
  orphanEvents,
  and,
  desc,
  inArray,
  isNotNull,
} from "@/db"
import { requireAdmin } from "@/lib/admin-guard"

/** Quote a CSV field and escape any embedded double-quotes. */
function csvField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

type Row = {
  source: string
  identifier: string
  ip: string
  releasedAt: string
  detail: string
}

/**
 * GET /api/admin/deleted-ips/export
 *
 * Admin-only. Streams every public IP the platform has released back to a
 * provider pool as CSV — the retained record of which IP each torn-down VM
 * held. Unions two sources:
 *   1. Instances (`deletedIpAddress`) — user agents whose VM was released.
 *   2. OrphanEvent (`ipAddress`) — reconciler-swept orphan VMs and reaped
 *      warm-pool VMs (which have no persistent Instance row).
 *
 * This is the raw feed for audit + dangling-DNS / IP-reuse review.
 */
export async function GET() {
  const guard = await requireAdmin()
  if (!guard.ok) return guard.res

  const instanceRows = await db.query.instances.findMany({
    where: and(
      inArray(instances.status, ["deleted", "deleting"]),
      isNotNull(instances.deletedIpAddress),
    ),
    columns: {
      slug: true,
      id: true,
      deletedIpAddress: true,
      deletedAt: true,
      lastTransitionAt: true,
    },
    orderBy: [desc(instances.deletedAt), desc(instances.lastTransitionAt)],
  })

  const orphanRows = await db
    .select({
      vmId: orphanEvents.vmId,
      ipAddress: orphanEvents.ipAddress,
      detail: orphanEvents.detail,
      resolvedAt: orphanEvents.resolvedAt,
      detectedAt: orphanEvents.detectedAt,
    })
    .from(orphanEvents)
    .where(isNotNull(orphanEvents.ipAddress))
    .orderBy(desc(orphanEvents.detectedAt))
    .limit(5000)

  const rows: Row[] = [
    ...instanceRows.map((r) => ({
      source: "instance",
      identifier: r.slug || r.id,
      ip: r.deletedIpAddress ?? "",
      releasedAt: (r.deletedAt ?? r.lastTransitionAt)?.toISOString() ?? "",
      detail: "",
    })),
    ...orphanRows.map((r) => ({
      // Warm-pool reaps stamp this detail prefix; everything else is a
      // reconciler-swept provider orphan.
      source: r.detail?.startsWith("warm-pool reap") ? "warm" : "orphan",
      identifier: r.vmId,
      ip: r.ipAddress ?? "",
      releasedAt: (r.resolvedAt ?? r.detectedAt)?.toISOString() ?? "",
      detail: r.detail ?? "",
    })),
  ]

  const header = "source,identifier,ip,releasedAt,detail"
  const body = rows.map((r) =>
    [r.source, r.identifier, r.ip, r.releasedAt, r.detail]
      .map((v) => csvField(String(v)))
      .join(","),
  )
  const csv = [header, ...body].join("\n")

  const filename = `deleted-vm-ips-${new Date().toISOString().slice(0, 10)}.csv`

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  })
}
