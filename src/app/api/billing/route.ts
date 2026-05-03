import { NextResponse } from "next/server"
import { db, eq, desc, subscriptions } from "@/db"
import { getEffectiveUserId } from "@/lib/effective-user"

export async function GET() {
  const userId = await getEffectiveUserId()
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rows = await db.query.subscriptions.findMany({
    where: eq(subscriptions.userId, userId),
    with: {
      plan: true,
      instance: {
        with: { serverConfig: true, region: true },
      },
    },
    orderBy: desc(subscriptions.createdAt),
  })

  return NextResponse.json(rows)
}
