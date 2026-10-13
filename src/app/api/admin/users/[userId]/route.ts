import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { userUpdateSchema } from "@/lib/validations";
import { db, users, eq } from "@/db";
import { forgetAccountStatus } from "@/lib/account-status";
import { closeUserAccount } from "@/lib/account-closure";
import { logAuditEvent } from "@/lib/audit";
import { apiError } from "@/lib/api-error";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const guard = await requireAdmin();
    if (!guard.ok) return guard.res;

    const { userId } = await params;
    const adminId = guard.userId;

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

      forgetAccountStatus(userId);
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

      forgetAccountStatus(userId);
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

      forgetAccountStatus(userId);
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

/**
 * "Delete" a user: closes the account (src/lib/account-closure.ts). The row
 * is anonymized and kept, with its wallet, ledger, subscriptions and audit
 * trail; a hard delete would erase that money trail.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const guard = await requireAdmin();
    if (!guard.ok) return guard.res;

    const { userId } = await params;
    const adminId = guard.userId;

    if (userId === adminId) {
      return NextResponse.json(
        { error: "Cannot delete yourself" },
        { status: 400 }
      );
    }

    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { email: true },
    });
    const result = await closeUserAccount(userId);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    forgetAccountStatus(userId);
    await logAuditEvent({
      userId: adminId,
      action: "admin.delete_user",
      targetType: "user",
      targetId: userId,
      targetLabel: user?.email,
      meta: { mode: "closed" },
    });

    return NextResponse.json({ message: "Account closed. Billing and audit records are kept." });
  } catch (error) {
    return apiError(`admin/users delete ${(await params).userId}`, error, "Failed to delete user.");
  }
}
