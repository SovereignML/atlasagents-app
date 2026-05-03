import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { db, eq, and, desc, subscriptions } from "@/db"
import type { SQL } from "drizzle-orm"

export async function GET(request: Request) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    if ((session.user as { role: string }).role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const search = searchParams.get("search") || ""
    const status = searchParams.get("status") || ""

    const conditions: SQL[] = []
    if (status) {
      conditions.push(eq(subscriptions.status, status))
    }

    const allSubs = await db.query.subscriptions.findMany({
      where: conditions.length > 0 ? and(...conditions) : undefined,
      with: {
        user: true,
        plan: true,
        instance: { with: { serverConfig: true, region: true } },
      },
      orderBy: desc(subscriptions.createdAt),
    })

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
