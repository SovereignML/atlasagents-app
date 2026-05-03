import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { z } from "zod"
import { switchTeam } from "@/lib/team"

const switchSchema = z.object({ teamId: z.string().min(1) })

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const parsed = switchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 })
  }

  const ok = await switchTeam(session.user.id, parsed.data.teamId)
  if (!ok) {
    return NextResponse.json({ error: "Not a member of that team" }, { status: 403 })
  }

  return NextResponse.json({ ok: true })
}
