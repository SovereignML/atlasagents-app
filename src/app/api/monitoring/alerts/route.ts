import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { db, alertRules, instances, and, eq, desc } from "@/db"
import { getUserTeam, requireTeamManage } from "@/lib/team"
import { alertRuleSchema } from "@/lib/validations"
import { apiError } from "@/lib/api-error"

// GET — list the active team's alert rules. Any member may view.
export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const team = await getUserTeam(session.user.id)
    if (!team) return NextResponse.json({ rules: [] })

    const rules = await db.query.alertRules.findMany({
      where: eq(alertRules.teamId, team.teamId),
      orderBy: desc(alertRules.createdAt),
    })
    return NextResponse.json({ rules })
  } catch (err) {
    return apiError("alerts-list", err)
  }
}

// POST — create a rule. Owner/admin only (a fleet-wide rule is a team-level
// action). When instanceId is set, it must belong to the active team.
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const team = await requireTeamManage(session.user.id)
    if (!team) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const parsed = alertRuleSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
    }
    const data = parsed.data

    if (data.instanceId) {
      const owned = await db.query.instances.findFirst({
        where: and(eq(instances.id, data.instanceId), eq(instances.teamId, team.teamId)),
        columns: { id: true },
      })
      if (!owned) {
        return NextResponse.json({ error: "Agent not in this team" }, { status: 400 })
      }
    }

    const [rule] = await db
      .insert(alertRules)
      .values({
        teamId: team.teamId,
        instanceId: data.instanceId ?? null,
        metric: data.metric,
        comparator: data.comparator,
        threshold: data.threshold,
        windowMinutes: data.windowMinutes,
        cooldownMinutes: data.cooldownMinutes,
        enabled: data.enabled,
        createdBy: session.user.id,
      })
      .returning()

    return NextResponse.json({ rule }, { status: 201 })
  } catch (err) {
    return apiError("alerts-create", err)
  }
}
