import { NextRequest, NextResponse } from "next/server"
import { apiError } from "@/lib/api-error"

import { db, warmVms, eq } from "@/db"
import { requireAdmin } from "@/lib/admin-guard"
import { destroyWarmVm } from "@/lib/warm-pool"
import { logAuditEvent } from "@/lib/audit"

// DELETE /api/admin/warm-pool/:warmVmId
//
// Admin-only. Removes a single pre-baked (warm) VM from the pool. The pool
// self-refills, so a destroyed slot is replaced by the next refill pass.
//
//   - Non-claimed rows: destroyWarmVm deletes the provider VM + Cloudflare
//     record + the DB row.
//   - `claimed` rows: the VM now belongs to a live instance — drop the row ONLY
//     (never delete the VM out from under a running agent), mirroring the reap
//     guard in refillWarmPool().
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ warmVmId: string }> },
) {
  const guard = await requireAdmin()
  if (!guard.ok) return guard.res

  const { warmVmId } = await params
  const row = await db.query.warmVms.findFirst({
    where: eq(warmVms.id, warmVmId),
  })
  if (!row) {
    return NextResponse.json({ error: "Warm VM not found" }, { status: 404 })
  }

  try {
    if (row.status === "claimed") {
      // The instance owns this VM now — drop the tracking row, keep the VM.
      await db.delete(warmVms).where(eq(warmVms.id, row.id))
    } else {
      await destroyWarmVm(row)
    }
  } catch (err) {
    return apiError(`warm-pool destroy ${warmVmId}`, err, "Destroy failed.")
  }

  await logAuditEvent({
    userId: guard.userId,
    action: "admin.warm_pool.destroy",
    targetType: "warm_vm",
    targetId: row.id,
    targetLabel: row.poolKey,
    meta: { vmId: row.vmId, status: row.status },
  })

  return NextResponse.json({ status: "destroyed" })
}
