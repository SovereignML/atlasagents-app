import { headers } from "next/headers"
import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { db, users, accounts, eq, and } from "@/db"
import { hashPassword, verifyPassword } from "@/lib/password"
import { isGoogleOAuthConfigured } from "@/lib/oauth"
import { normalizeHost, isCanonicalHost } from "@/lib/host"
import { notify } from "@/lib/notifications/dispatch"

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const user = await db.query.users.findFirst({
      where: eq(users.id, session.user.id),
      columns: {
        id: true,
        name: true,
        email: true,
        image: true,
        hashedPassword: true,
        createdAt: true,
        telegramId: true,
        twitterHandle: true,
        discordId: true,
      },
    })
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 })

    // Check if user has Google account linked
    const googleAccount = await db.query.accounts.findFirst({
      where: and(eq(accounts.userId, user.id), eq(accounts.provider, "google")),
    })

    // Whether the "Connect Google" action is available: Google OAuth must be
    // configured, and we must be on the canonical host (OAuth callback URLs
    // can't be pre-registered for white-label custom domains).
    const h = await headers()
    const host = normalizeHost(h.get("x-forwarded-host") ?? h.get("host"))
    const onCustomDomain = host != null && !isCanonicalHost(host)
    const googleConfigured = !onCustomDomain && isGoogleOAuthConfigured()

    return NextResponse.json({
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      hasPassword: !!user.hashedPassword,
      hasGoogle: !!googleAccount,
      googleConfigured,
      createdAt: user.createdAt,
      telegramId: user.telegramId,
      twitterHandle: user.twitterHandle,
      discordId: user.discordId,
    })
  } catch (error) {
    console.error("Failed to fetch account:", error)
    return NextResponse.json({ error: "Failed to fetch account" }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const { action } = body

    if (action === "update-name") {
      const { name } = body
      if (!name || name.length < 2) return NextResponse.json({ error: "Name must be at least 2 characters" }, { status: 400 })
      await db.update(users).set({ name }).where(eq(users.id, session.user.id))
      return NextResponse.json({ message: "Name updated" })
    }

    if (action === "update-password") {
      const { currentPassword, newPassword } = body
      if (!newPassword || newPassword.length < 6) return NextResponse.json({ error: "New password must be at least 6 characters" }, { status: 400 })

      const user = await db.query.users.findFirst({
        where: eq(users.id, session.user.id),
      })
      if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 })

      // If user has a password, verify current one
      if (user.hashedPassword) {
        if (!currentPassword) return NextResponse.json({ error: "Current password is required" }, { status: 400 })
        const valid = await verifyPassword(currentPassword, user.hashedPassword)
        if (!valid) return NextResponse.json({ error: "Current password is incorrect" }, { status: 400 })
      }

      const hashed = await hashPassword(newPassword)
      await db.update(users).set({ hashedPassword: hashed }).where(eq(users.id, session.user.id))
      await notify({
        userId: session.user.id,
        category: "security",
        type: "password_changed",
        title: "Your password was changed",
        message:
          "The password on your SovereignML account was just updated. If this wasn't you, reset your password immediately.",
        url: "/dashboard/account",
      })
      return NextResponse.json({ message: "Password updated" })
    }

    if (action === "update-socials") {
      const { telegramId, twitterHandle, discordId } = body
      await db
        .update(users)
        .set({
          telegramId: telegramId || null,
          twitterHandle: twitterHandle || null,
          discordId: discordId || null,
        })
        .where(eq(users.id, session.user.id))
      return NextResponse.json({ message: "Socials updated" })
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 })
  } catch (error) {
    console.error("Failed to update account:", error)
    return NextResponse.json({ error: "Failed to update account" }, { status: 500 })
  }
}
