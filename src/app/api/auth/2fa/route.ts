import { NextResponse } from "next/server"

import { auth } from "@/auth"
import { db, users, eq } from "@/db"
import { verifyPassword } from "@/lib/password"
import { rateLimit } from "@/lib/rate-limit"
import { verifyTotpToken } from "@/lib/totp"
import {
  consumeBackupCode,
  createTwoFactorSetup,
  decryptTotpSecret,
  encryptTotpSecret,
  generateBackupCodes,
} from "@/lib/two-factor"
import { readJsonBody } from "@/lib/request-body"
import { twoFactorActionSchema } from "@/lib/validations"

async function getCurrentUser() {
  const session = await auth()
  if (!session?.user?.id) return null
  const user = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
  })
  return user ?? null
}

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  return NextResponse.json({
    enabled: user.twoFactorEnabled,
    backupCodesRemaining: user.twoFactorEnabled
      ? (user.twoFactorBackupCodes?.length ?? 0)
      : 0,
    enrolledAt: user.twoFactorEnrolledAt,
  })
}

export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // Rate-limit 2FA mutations per user — generous but enough to slow brute
  // force attempts against the verify endpoint.
  if (!(await rateLimit(`2fa:${user.id}`, 20, 5 * 60 * 1000))) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 })
  }

  const parsed = await readJsonBody(request, twoFactorActionSchema)
  if (!parsed.ok) return parsed.res
  const body = parsed.data
  const action = body.action

  if (action === "setup") {
    if (user.twoFactorEnabled) {
      return NextResponse.json(
        { error: "Two-factor authentication is already enabled. Disable it first." },
        { status: 400 },
      )
    }
    const setup = createTwoFactorSetup({
      accountName: user.email,
      issuer: "SovereignML",
    })
    // Stash the encrypted secret on the user row but do NOT flip
    // `twoFactorEnabled` until they verify their first code.
    await db
      .update(users)
      .set({
        twoFactorSecret: encryptTotpSecret(setup.secret),
        twoFactorEnabled: false,
        twoFactorBackupCodes: null,
        twoFactorEnrolledAt: null,
      })
      .where(eq(users.id, user.id))

    return NextResponse.json({
      secret: setup.secret,
      otpauthUri: setup.otpauthUri,
    })
  }

  if (action === "verify-setup") {
    const code = String(body?.code ?? "").trim()
    if (!code) {
      return NextResponse.json({ error: "Code is required" }, { status: 400 })
    }
    if (!user.twoFactorSecret) {
      return NextResponse.json(
        { error: "No pending 2FA enrollment. Start setup first." },
        { status: 400 },
      )
    }
    if (user.twoFactorEnabled) {
      return NextResponse.json(
        { error: "Two-factor authentication is already enabled." },
        { status: 400 },
      )
    }

    let secret: string
    try {
      secret = decryptTotpSecret(user.twoFactorSecret)
    } catch {
      return NextResponse.json(
        { error: "Stored 2FA secret could not be decoded. Restart setup." },
        { status: 500 },
      )
    }

    if (!verifyTotpToken(code, secret)) {
      return NextResponse.json({ error: "Invalid code. Try again." }, { status: 400 })
    }

    const { plaintext, hashed } = await generateBackupCodes()
    await db
      .update(users)
      .set({
        twoFactorEnabled: true,
        twoFactorBackupCodes: hashed,
        twoFactorEnrolledAt: new Date(),
      })
      .where(eq(users.id, user.id))

    return NextResponse.json({
      enabled: true,
      backupCodes: plaintext,
    })
  }

  if (action === "regenerate-backup-codes") {
    if (!user.twoFactorEnabled) {
      return NextResponse.json(
        { error: "Two-factor authentication is not enabled." },
        { status: 400 },
      )
    }
    const code = String(body?.code ?? "").trim()
    if (!user.twoFactorSecret) {
      return NextResponse.json({ error: "Missing 2FA secret." }, { status: 500 })
    }
    const secret = decryptTotpSecret(user.twoFactorSecret)
    if (!code || !verifyTotpToken(code, secret)) {
      const backupOk = code ? await consumeBackupCode(user.id, code) : false
      if (!backupOk) {
        return NextResponse.json({ error: "Invalid 2FA code." }, { status: 400 })
      }
    }

    const { plaintext, hashed } = await generateBackupCodes()
    await db
      .update(users)
      .set({ twoFactorBackupCodes: hashed })
      .where(eq(users.id, user.id))

    return NextResponse.json({ backupCodes: plaintext })
  }

  if (action === "disable") {
    if (!user.twoFactorEnabled) {
      return NextResponse.json(
        { error: "Two-factor authentication is not enabled." },
        { status: 400 },
      )
    }

    const password = String(body?.password ?? "")
    const code = String(body?.code ?? "").trim()

    // Require either the current password OR a valid TOTP/backup code to
    // disable. Either of these proves possession of the second factor or
    // ownership of the primary credential.
    let passwordOk = false
    if (password && user.hashedPassword) {
      passwordOk = await verifyPassword(password, user.hashedPassword)
    }

    let codeOk = false
    if (code) {
      if (user.twoFactorSecret) {
        try {
          codeOk = verifyTotpToken(code, decryptTotpSecret(user.twoFactorSecret))
        } catch {
          codeOk = false
        }
      }
      if (!codeOk) {
        codeOk = await consumeBackupCode(user.id, code)
      }
    }

    if (!passwordOk && !codeOk) {
      return NextResponse.json(
        { error: "Provide your current password or a valid 2FA code to disable." },
        { status: 400 },
      )
    }

    await db
      .update(users)
      .set({
        twoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorBackupCodes: null,
        twoFactorEnrolledAt: null,
      })
      .where(eq(users.id, user.id))

    return NextResponse.json({ enabled: false })
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 })
}
