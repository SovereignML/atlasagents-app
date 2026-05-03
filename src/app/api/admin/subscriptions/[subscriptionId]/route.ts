import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { db, eq, subscriptions } from "@/db"

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ subscriptionId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    if ((session.user as { role: string }).role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { subscriptionId } = await params
    const body = await request.json()
    const { status } = body as { status?: string }

    const existing = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.id, subscriptionId),
    })

    if (!existing) {
      return NextResponse.json({ error: "Subscription not found" }, { status: 404 })
    }

    const updateData: Record<string, unknown> = {}
    if (status) updateData.status = status

    const [updated] = await db
      .update(subscriptions)
      .set(updateData)
      .where(eq(subscriptions.id, subscriptionId))
      .returning()

    return NextResponse.json(updated)
  } catch (error) {
    console.error("Failed to update subscription:", error)
    return NextResponse.json({ error: "Failed to update subscription" }, { status: 500 })
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ subscriptionId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    if ((session.user as { role: string }).role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { subscriptionId } = await params

    const existing = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.id, subscriptionId),
    })

    if (!existing) {
      return NextResponse.json({ error: "Subscription not found" }, { status: 404 })
    }

    await db.delete(subscriptions).where(eq(subscriptions.id, subscriptionId))

    return NextResponse.json({ message: "Subscription deleted" })
  } catch (error) {
    console.error("Failed to delete subscription:", error)
    return NextResponse.json({ error: "Failed to delete subscription" }, { status: 500 })
  }
}
