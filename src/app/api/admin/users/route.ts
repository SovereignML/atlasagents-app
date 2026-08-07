import { NextResponse } from "next/server";
import { auth } from "@/auth";
import type { SQL } from "drizzle-orm";
import {
  db,
  users,
  subscriptions,
  instances,
  adminNotes,
  teams,
  memberships,
  eq,
  and,
  or,
  desc,
  ilike,
  sql,
  inArray,
} from "@/db";

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if ((session.user as { role: string }).role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") || "";
    const status = searchParams.get("status") || "all";

    const conditions: SQL[] = [];

    if (search) {
      const pattern = `%${search}%`;
      const searchCond = or(ilike(users.name, pattern), ilike(users.email, pattern));
      if (searchCond) conditions.push(searchCond);
    }

    if (status === "active") {
      conditions.push(eq(users.isBanned, false));
      conditions.push(eq(users.role, "user"));
    } else if (status === "banned") {
      conditions.push(eq(users.isBanned, true));
    } else if (status === "admins" || status === "admin") {
      // The UI tab sends "admins" (plural). "admin" is accepted too so any
      // existing bookmark / direct API caller keeps working — previously only
      // the singular matched, so the tab silently fell through to no filter
      // and listed every user.
      conditions.push(eq(users.role, "admin"));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    // Hard cap to prevent OOM on large user tables. Admin UI surfaces a
    // search box and status filter, so narrowing within the 500-newest
    // window is the expected workflow. Add explicit pagination UI later
    // if the admin team regularly needs to scroll beyond that.
    const HARD_LIMIT = 500;
    const requestedLimit = Math.min(
      Number(searchParams.get("limit") || HARD_LIMIT),
      HARD_LIMIT,
    );

    const rows = await db.query.users.findMany({
      where,
      columns: {
        id: true,
        name: true,
        email: true,
        role: true,
        isBanned: true,
        bannedAt: true,
        bannedReason: true,
        telegramId: true,
        twitterHandle: true,
        discordId: true,
        createdAt: true,
      },
      orderBy: desc(users.createdAt),
      limit: requestedLimit,
    });

    const userIds = rows.map((r) => r.id);

    const countExpr = sql<number>`count(*)::int`;
    const [subCounts, instCounts, noteCounts, membershipTeams] =
      userIds.length === 0
        ? [[], [], [], []]
        : await Promise.all([
            db
              .select({ userId: subscriptions.userId, count: countExpr })
              .from(subscriptions)
              .where(inArray(subscriptions.userId, userIds))
              .groupBy(subscriptions.userId),
            db
              .select({ userId: instances.userId, count: countExpr })
              .from(instances)
              .where(inArray(instances.userId, userIds))
              .groupBy(instances.userId),
            db
              .select({ userId: adminNotes.userId, count: countExpr })
              .from(adminNotes)
              .where(inArray(adminNotes.userId, userIds))
              .groupBy(adminNotes.userId),
            // Teams each user has access to (via membership) and at what
            // role. Owners always have an "owner" membership row, so this
            // covers owned and member-of teams alike. Surfaced as
            // deep-links to /admin/teams.
            db
              .select({
                userId: memberships.userId,
                id: teams.id,
                name: teams.name,
                role: memberships.role,
              })
              .from(memberships)
              .innerJoin(teams, eq(memberships.teamId, teams.id))
              .where(inArray(memberships.userId, userIds)),
          ]);

    const subMap = new Map(subCounts.map((r) => [r.userId, r.count]));
    const instMap = new Map(instCounts.map((r) => [r.userId, r.count]));
    const noteMap = new Map(noteCounts.map((r) => [r.userId, r.count]));
    const roleRank: Record<string, number> = {
      owner: 0,
      admin: 1,
      developer: 2,
      viewer: 3,
    };
    const teamMap = new Map<string, { id: string; name: string; role: string }[]>();
    for (const t of membershipTeams) {
      const list = teamMap.get(t.userId) ?? [];
      list.push({ id: t.id, name: t.name, role: t.role });
      teamMap.set(t.userId, list);
    }
    for (const list of teamMap.values()) {
      list.sort((a, b) => (roleRank[a.role] ?? 9) - (roleRank[b.role] ?? 9));
    }

    const result = rows.map((u) => ({
      ...u,
      teams: teamMap.get(u.id) ?? [],
      _count: {
        subscriptions: subMap.get(u.id) ?? 0,
        instances: instMap.get(u.id) ?? 0,
        adminNotes: noteMap.get(u.id) ?? 0,
      },
    }));

    return NextResponse.json(result);
  } catch (error) {
    console.error("Failed to fetch users:", error);
    return NextResponse.json(
      { error: "Failed to fetch users" },
      { status: 500 }
    );
  }
}
