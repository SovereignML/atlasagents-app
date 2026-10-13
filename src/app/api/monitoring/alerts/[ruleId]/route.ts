import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { db, alertRules, and, eq } from "@/db"
import { requireTeamManage } from "@/lib/team"
import { apiError } from "@/lib/api-error"
import { readJsonBody } from "@/lib/request-body"
import { alertRuleUpdateSchema } from "@/lib/validations"

// PATCH — toggle enabled (or update threshold/window/cooldown). Owner/admin.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ ruleId: string }> },
) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const team = await requireTeamManage(session.user.id)
    if (!team) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const { ruleId } = await params
    const parsed = await readJsonBody(req, alertRuleUpdateSchema)
    if (!parsed.ok) return parsed.res
    const set = parsed.data

    const [updated] = await db
      .update(alertRules)
      .set(set)
      // Team-scoped WHERE so a rule from another team can't be touched.
      .where(and(eq(alertRules.id, ruleId), eq(alertRules.teamId, team.teamId)))
      .returning()

    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ rule: updated })
  } catch (err) {
    return apiError("alerts-update", err)
  }
}

// DELETE — remove a rule. Owner/admin, team-scoped.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ ruleId: string }> },
) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const team = await requireTeamManage(session.user.id)
    if (!team) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const { ruleId } = await params
    const [deleted] = await db
      .delete(alertRules)
      .where(and(eq(alertRules.id, ruleId), eq(alertRules.teamId, team.teamId)))
      .returning({ id: alertRules.id })

    if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return apiError("alerts-delete", err)
  }
}
