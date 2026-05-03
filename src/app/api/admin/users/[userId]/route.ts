import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { userUpdateSchema } from "@/lib/validations";
import { db, users, eq } from "@/db";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if ((session.user as { role: string }).role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { userId } = await params;
    const adminId = session.user.id as string;

    const body = await request.json();
    const validation = userUpdateSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid input", details: validation.error.flatten() },
        { status: 400 }
      );
    }

    const { action, role, bannedReason } = validation.data;

    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (action === "role") {
      if (userId === adminId) {
        return NextResponse.json(
          { error: "Cannot modify your own role" },
          { status: 400 }
        );
      }

      const [updatedUser] = await db
        .update(users)
        .set({ role })
        .where(eq(users.id, userId))
        .returning({
          id: users.id,
          name: users.name,
          email: users.email,
          role: users.role,
        });

      return NextResponse.json(updatedUser);
    }

    if (action === "ban") {
      if (userId === adminId) {
        return NextResponse.json(
          { error: "Cannot ban yourself" },
          { status: 400 }
        );
      }

      const [updatedUser] = await db
        .update(users)
        .set({
          isBanned: true,
          bannedAt: new Date(),
          bannedReason: bannedReason || null,
        })
        .where(eq(users.id, userId))
        .returning({
          id: users.id,
          name: users.name,
          email: users.email,
          role: users.role,
          isBanned: users.isBanned,
          bannedAt: users.bannedAt,
          bannedReason: users.bannedReason,
        });

      return NextResponse.json(updatedUser);
    }

    if (action === "unban") {
      const [updatedUser] = await db
        .update(users)
        .set({
          isBanned: false,
          bannedAt: null,
          bannedReason: null,
        })
        .where(eq(users.id, userId))
        .returning({
          id: users.id,
          name: users.name,
          email: users.email,
          role: users.role,
          isBanned: users.isBanned,
          bannedAt: users.bannedAt,
          bannedReason: users.bannedReason,
        });

      return NextResponse.json(updatedUser);
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("Failed to update user:", error);
    return NextResponse.json(
      { error: "Failed to update user" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if ((session.user as { role: string }).role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { userId } = await params;
    const adminId = session.user.id as string;

    if (userId === adminId) {
      return NextResponse.json(
        { error: "Cannot delete yourself" },
        { status: 400 }
      );
    }

    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    await db.delete(users).where(eq(users.id, userId));

    return NextResponse.json({ message: "User deleted successfully" });
  } catch (error) {
    console.error("Failed to delete user:", error);
    return NextResponse.json(
      { error: "Failed to delete user" },
      { status: 500 }
    );
  }
}
