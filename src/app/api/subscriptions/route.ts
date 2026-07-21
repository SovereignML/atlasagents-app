import { NextResponse } from "next/server"
import { db, eq, desc, inArray, instances, subscriptions } from "@/db"
import { getEffectiveUserId } from "@/lib/effective-user"

export async function GET() {
  try {
    const userId = await getEffectiveUserId()
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const rows = await db.query.subscriptions.findMany({
      where: eq(subscriptions.userId, userId),
      with: { plan: true },
      orderBy: desc(subscriptions.createdAt),
    })

    // Fetch the instances in a separate batched query and stitch them back
    // on. Nesting the 77-column `instance` relation inside the query above
    // makes Drizzle build a json_build_object() that overflows Postgres'
    // 100-argument function cap ("cannot pass more than 100 arguments to a
    // function"). Loading instances as a top-level select (plain columns)
    // avoids the cap while preserving the full instance shape the client
    // expects.
    const instanceIds = [
      ...new Set(
        rows.map((r) => r.instanceId).filter((id): id is string => id !== null),
      ),
    ]
    const instanceRows = instanceIds.length
      ? await db.query.instances.findMany({
          where: inArray(instances.id, instanceIds),
          with: { serverConfig: true, region: true },
        })
      : []
    const instanceById = new Map(instanceRows.map((i) => [i.id, i]))

    return NextResponse.json(
      rows.map((row) => {
        const instance = row.instanceId
          ? instanceById.get(row.instanceId) ?? null
          : null
        return {
          ...row,
          instance: instance && instance.status === "deleted" ? null : instance,
        }
      }),
    )
  } catch (error) {
    console.error("Failed to fetch subscriptions:", error)
    return NextResponse.json(
      { error: "Failed to fetch subscriptions" },
      { status: 500 }
    )
  }
}
