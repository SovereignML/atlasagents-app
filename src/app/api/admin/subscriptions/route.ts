import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/admin-guard"
import { db, eq, and, desc, inArray, instances, subscriptions } from "@/db"
import type { SQL } from "drizzle-orm"

export async function GET(request: Request) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return guard.res

    const { searchParams } = new URL(request.url)
    const search = searchParams.get("search") || ""
    const status = searchParams.get("status") || ""

    const conditions: SQL[] = []
    if (status) {
      conditions.push(eq(subscriptions.status, status))
    }

    const subs = await db.query.subscriptions.findMany({
      where: conditions.length > 0 ? and(...conditions) : undefined,
      with: { user: true, plan: true },
      orderBy: desc(subscriptions.createdAt),
    })

    // Fetch the instances in a separate batched query and stitch them back
    // on. Nesting the 77-column `instance` relation inside the query above
    // makes Drizzle build a json_build_object() that overflows Postgres'
    // 100-argument function cap. A top-level select over instances avoids
    // the cap while preserving the full instance shape the client expects.
    const instanceIds = [
      ...new Set(
        subs.map((s) => s.instanceId).filter((id): id is string => id !== null),
      ),
    ]
    const instanceRows = instanceIds.length
      ? await db.query.instances.findMany({
          where: inArray(instances.id, instanceIds),
          with: { serverConfig: true, region: true },
        })
      : []
    const instanceById = new Map(instanceRows.map((i) => [i.id, i]))
    const allSubs = subs.map((s) => ({
      ...s,
      instance: s.instanceId ? instanceById.get(s.instanceId) ?? null : null,
    }))

    if (search) {
      const lower = search.toLowerCase()
      return NextResponse.json(
        allSubs.filter(
          (s) =>
            s.user?.name?.toLowerCase().includes(lower) ||
            s.user?.email?.toLowerCase().includes(lower)
        )
      )
    }

    return NextResponse.json(allSubs)
  } catch (error) {
    console.error("Failed to fetch subscriptions:", error)
    return NextResponse.json(
      { error: "Failed to fetch subscriptions" },
      { status: 500 }
    )
  }
}
