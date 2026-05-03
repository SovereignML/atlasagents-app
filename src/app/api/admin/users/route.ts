import { NextResponse } from "next/server";
import { auth } from "@/auth";
import type { SQL } from "drizzle-orm";
import {
  db,
  users,
  subscriptions,
  instances,
  adminNotes,
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
    });

    const userIds = rows.map((r) => r.id);

    const countExpr = sql<number>`count(*)::int`;
    const [subCounts, instCounts, noteCounts] =
      userIds.length === 0
        ? [[], [], []]
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
          ]);

    const subMap = new Map(subCounts.map((r) => [r.userId, r.count]));
    const instMap = new Map(instCounts.map((r) => [r.userId, r.count]));
    const noteMap = new Map(noteCounts.map((r) => [r.userId, r.count]));

    const result = rows.map((u) => ({
      ...u,
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
