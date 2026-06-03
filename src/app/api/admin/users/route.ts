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
    } else if (status === "admin") {
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
    const [subCounts, instCounts, noteCounts, ownedTeams] =
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
            // Teams each user OWNS — white-label entitlement keys off the team
            // owner, so these are the teams an admin would toggle. Surfaced as
            // deep-links to /admin/teams.
            db
              .select({ ownerId: teams.ownerId, id: teams.id, name: teams.name })
              .from(teams)
              .where(inArray(teams.ownerId, userIds)),
          ]);

    const subMap = new Map(subCounts.map((r) => [r.userId, r.count]));
    const instMap = new Map(instCounts.map((r) => [r.userId, r.count]));
    const noteMap = new Map(noteCounts.map((r) => [r.userId, r.count]));
    const teamMap = new Map<string, { id: string; name: string }[]>();
    for (const t of ownedTeams) {
      const list = teamMap.get(t.ownerId) ?? [];
      list.push({ id: t.id, name: t.name });
      teamMap.set(t.ownerId, list);
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
