import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { db, instanceLogs, eq, desc } from "@/db"
import { whereUserInstanceVisible } from "@/lib/instance-queries"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { instanceId } = await params

  const instance = await db.query.instances.findFirst({
    where: whereUserInstanceVisible(session.user.id, instanceId),
    columns: {
      id: true,
      status: true,
      ipAddress: true,
      dnsStatus: true,
      tlsStatus: true,
      managedSubdomain: true,
      createdAt: true,
      provisionStage: true,
    },
  })

  if (!instance) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const logs = await db.query.instanceLogs.findMany({
    where: eq(instanceLogs.instanceId, instanceId),
    orderBy: desc(instanceLogs.createdAt),
    limit: 50,
  })

  return NextResponse.json({
    status: instance.status,
    ipAddress: instance.ipAddress,
    dnsStatus: instance.dnsStatus,
    tlsStatus: instance.tlsStatus,
    managedSubdomain: instance.managedSubdomain,
    provisionStage: instance.provisionStage ?? null,
    logs: logs.map((l) => ({
      id: l.id,
      level: l.level,
      message: l.message,
      createdAt: l.createdAt.toISOString(),
    })),
  })
}
