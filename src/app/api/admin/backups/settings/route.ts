import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { db, r2BackupConfig, eq } from "@/db"
import { encryptSecret } from "@/lib/crypto-secret"
import { requireAdmin } from "@/lib/admin-guard"
import { logAuditEvent } from "@/lib/audit"
import { getR2Config, testR2Connection, defaultR2Endpoint, type R2Config } from "@/lib/r2"

export const dynamic = "force-dynamic"

/** Load the singleton config row (or null). */
async function loadRow() {
  return db.query.r2BackupConfig.findFirst()
}

/**
 * GET /api/admin/backups/settings — non-secret config + a `configured` flag.
 * Never returns the decrypted keys.
 */
export async function GET() {
  const guard = await requireAdmin()
  if (!guard.ok) return guard.res

  const row = await loadRow()
  return NextResponse.json({
    configured: !!row,
    config: row
      ? {
          accountId: row.accountId,
          bucket: row.bucket,
          endpoint: row.endpoint ?? "",
          retentionCount: row.retentionCount,
          hasAccessKeyId: !!row.accessKeyIdEnc,
          hasSecretAccessKey: !!row.secretAccessKeyEnc,
          updatedAt: row.updatedAt,
        }
      : null,
  })
}

const putSchema = z.object({
  accountId: z.string().trim().min(1, "Account ID is required"),
  bucket: z.string().trim().min(1, "Bucket is required"),
  endpoint: z.string().trim().url().or(z.literal("")).optional(),
  // Secrets: blank means "keep existing" on update.
  accessKeyId: z.string().optional(),
  secretAccessKey: z.string().optional(),
  retentionCount: z.coerce.number().int().min(1).max(365).optional(),
})

/** PUT /api/admin/backups/settings — upsert the singleton R2 config. */
export async function PUT(req: NextRequest) {
  const guard = await requireAdmin()
  if (!guard.ok) return guard.res

  const parsed = putSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    )
  }
  const input = parsed.data
  const existing = await loadRow()

  // Secrets are required on first save; optional (keep existing) on update.
  if (!existing && (!input.accessKeyId || !input.secretAccessKey)) {
    return NextResponse.json(
      { error: "Access key ID and secret access key are required." },
      { status: 400 },
    )
  }

  const values = {
    accountId: input.accountId,
    bucket: input.bucket,
    endpoint: input.endpoint ? input.endpoint : null,
    retentionCount: input.retentionCount ?? existing?.retentionCount ?? 14,
    updatedByUserId: guard.userId,
    ...(input.accessKeyId ? { accessKeyIdEnc: encryptSecret(input.accessKeyId) } : {}),
    ...(input.secretAccessKey
      ? { secretAccessKeyEnc: encryptSecret(input.secretAccessKey) }
      : {}),
  }

  if (existing) {
    await db.update(r2BackupConfig).set(values).where(eq(r2BackupConfig.id, existing.id))
  } else {
    await db.insert(r2BackupConfig).values({
      ...values,
      accessKeyIdEnc: encryptSecret(input.accessKeyId as string),
      secretAccessKeyEnc: encryptSecret(input.secretAccessKey as string),
    })
  }

  await logAuditEvent({
    userId: guard.userId,
    action: "admin.backup.config",
    targetType: "r2_backup_config",
    meta: { accountId: input.accountId, bucket: input.bucket },
  })

  return NextResponse.json({ success: true })
}

const testSchema = z.object({
  accountId: z.string().trim().optional(),
  bucket: z.string().trim().optional(),
  endpoint: z.string().trim().optional(),
  accessKeyId: z.string().optional(),
  secretAccessKey: z.string().optional(),
})

/**
 * POST /api/admin/backups/settings — test connectivity. Tests the credentials
 * in the body when fully provided (test-before-save), otherwise the saved config.
 */
export async function POST(req: NextRequest) {
  const guard = await requireAdmin()
  if (!guard.ok) return guard.res

  const body = testSchema.safeParse(await req.json().catch(() => ({})))
  const b = body.success ? body.data : {}

  try {
    let cfg: R2Config
    if (b.accountId && b.bucket && b.accessKeyId && b.secretAccessKey) {
      cfg = {
        accountId: b.accountId,
        bucket: b.bucket,
        endpoint: b.endpoint || defaultR2Endpoint(b.accountId),
        accessKeyId: b.accessKeyId,
        secretAccessKey: b.secretAccessKey,
        retentionCount: 14,
      }
    } else {
      cfg = await getR2Config()
    }
    await testR2Connection(cfg)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Connection failed." },
      { status: 400 },
    )
  }
}
