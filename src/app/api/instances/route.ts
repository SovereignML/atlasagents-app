import { NextResponse } from "next/server"
import { db, desc, instances } from "@/db"
import { whereUserInstancesVisible } from "@/lib/instance-queries"
import { getEffectiveUserId } from "@/lib/effective-user"
import { apiError } from "@/lib/api-error"

export async function GET() {
  try {
    const userId = await getEffectiveUserId()
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const rows = await db.query.instances.findMany({
      where: whereUserInstancesVisible(userId),
      with: {
        region: true,
        serverConfig: true,
        logs: {
          orderBy: (logs, { desc: d }) => d(logs.createdAt),
          limit: 5,
        },
      },
      orderBy: desc(instances.createdAt),
    })

    return NextResponse.json(rows)
  } catch (err) {
    return apiError("instances", err)
  }
}
