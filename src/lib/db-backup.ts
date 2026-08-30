// Admin database backup orchestration: pg_dump → Cloudflare R2, and the guarded
// restore path (R2 → pg_restore). Spawns the postgres client binaries, so the
// app host needs a `postgresql-client` whose major version is >= the server's.
//
// This is platform-level (the whole DB), distinct from the per-agent settings
// backups that go to a user's Google Drive (src/lib/agent-backup.ts).

import { spawn } from "node:child_process"
import { Transform } from "node:stream"
import { pipeline } from "node:stream/promises"

import { db, databaseBackups, desc, eq } from "@/db"
import { logAuditEvent } from "@/lib/audit"
import {
  getR2Config,
  uploadStreamToR2,
  getR2Object,
  deleteR2Object,
  listR2Backups,
  BACKUP_PREFIX,
  type R2Config,
} from "@/lib/r2"

const PG_DUMP = process.env.PG_DUMP_PATH || "pg_dump"
const PG_RESTORE = process.env.PG_RESTORE_PATH || "pg_restore"
const STDERR_CAP = 8192 // keep only the tail of child stderr for reporting

/**
 * Translate DATABASE_URL into libpq env vars + connection flags. Passing the
 * password via PGPASSWORD (env) instead of an argv keeps it out of `ps` output.
 */
function pgConnection(): { env: NodeJS.ProcessEnv; args: string[] } {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL is not set")
  const u = new URL(url)
  const env: NodeJS.ProcessEnv = { ...process.env }
  if (u.password) env.PGPASSWORD = decodeURIComponent(u.password)
  const sslmode = u.searchParams.get("sslmode")
  if (sslmode) env.PGSSLMODE = sslmode
  const database = decodeURIComponent(u.pathname.replace(/^\//, "")) || "postgres"
  const args: string[] = []
  if (u.hostname) args.push("-h", u.hostname)
  if (u.port) args.push("-p", u.port)
  if (u.username) args.push("-U", decodeURIComponent(u.username))
  args.push("-d", database)
  return { env, args }
}

/** Pad to 2 digits for the timestamped filename. */
function pad(n: number): string {
  return String(n).padStart(2, "0")
}

function backupKey(now: Date): { key: string; fileName: string } {
  const stamp =
    `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}` +
    `-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`
    // LEGACY WIRE FORMAT — deliberately NOT renamed in the Atlas Agents
  // rebrand. Existing dumps in the backup bucket are named with this prefix and
// are listed/restored by it.
  // See docs/REBRAND-LEGACY-IDENTIFIERS.md.
  const fileName = `sovereignml-${stamp}.dump`
  return { key: `${BACKUP_PREFIX}${fileName}`, fileName }
}

export type BackupTrigger = "manual" | "scheduled"

export type BackupResult = {
  id: string
  objectKey: string
  fileName: string
  sizeBytes: number
  status: "success"
}

/**
 * Take a full `pg_dump -Fc` of the database and stream it to R2. Records a
 * `DatabaseBackup` row (pending → success/failed), prunes old backups past the
 * configured retention, and writes an audit event. Throws on failure (after
 * marking the row failed and cleaning up any partial object).
 */
export async function runDatabaseBackup(opts: {
  trigger: BackupTrigger
  userId?: string | null
}): Promise<BackupResult> {
  const cfg = await getR2Config() // throws R2NotConfiguredError if unset
  const { key, fileName } = backupKey(new Date())

  const [row] = await db
    .insert(databaseBackups)
    .values({
      objectKey: key,
      fileName,
      status: "pending",
      trigger: opts.trigger,
      createdByUserId: opts.userId ?? null,
    })
    .returning()

  try {
    const sizeBytes = await dumpToR2(cfg, key)

    await db
      .update(databaseBackups)
      .set({ status: "success", sizeBytes, completedAt: new Date() })
      .where(eq(databaseBackups.id, row.id))

    // Audit only manual (user-triggered) runs — auditLogs.userId is a non-null
    // FK, so cron runs (no user) have nothing valid to attribute the event to.
    if (opts.userId) {
      await logAuditEvent({
        userId: opts.userId,
        action: "admin.backup.create",
        targetType: "database_backup",
        targetId: row.id,
        targetLabel: fileName,
        meta: { trigger: opts.trigger, sizeBytes },
      })
    }

    // Best-effort retention prune — never fail the backup over cleanup.
    await pruneOldBackups(cfg).catch((err) =>
      console.error("[db-backup] retention prune failed:", err),
    )

    return { id: row.id, objectKey: key, fileName, sizeBytes, status: "success" }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await db
      .update(databaseBackups)
      .set({ status: "failed", error: message.slice(0, 2000), completedAt: new Date() })
      .where(eq(databaseBackups.id, row.id))
    // Remove any partial/empty object so the bucket only holds good dumps.
    await deleteR2Object(cfg, key).catch(() => {})
    throw err
  }
}

/**
 * Spawn pg_dump and pipe its stdout straight into the R2 multipart upload.
 * Resolves with the dump's byte count; rejects if pg_dump exits non-zero, the
 * binary is missing, or the upload fails.
 */
async function dumpToR2(cfg: R2Config, key: string): Promise<number> {
  const { env, args } = pgConnection()
  const dump = spawn(
    PG_DUMP,
    [...args, "-Fc", "--no-owner", "--no-privileges"],
    { env },
  )

  let stderr = ""
  dump.stderr.on("data", (d: Buffer) => {
    if (stderr.length < STDERR_CAP) stderr += d.toString()
  })

  // Count bytes as they flow through, without disturbing the read path.
  let bytes = 0
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      bytes += chunk.length
      cb(null, chunk)
    },
  })

  // If pg_dump can't start (e.g. ENOENT), tear down the counter so the upload
  // rejects instead of silently uploading an empty object.
  dump.on("error", (err) => counter.destroy(err))

  const exit = new Promise<void>((resolve, reject) => {
    dump.on("close", (code) => {
      if (code === 0) resolve()
      else reject(new Error(`pg_dump exited ${code}: ${stderr.trim() || "no output"}`))
    })
  })

  const upload = uploadStreamToR2(cfg, key, dump.stdout.pipe(counter))

  try {
    await Promise.all([exit, upload])
  } catch (err) {
    dump.kill("SIGTERM")
    throw err
  }

  if (bytes === 0) throw new Error("pg_dump produced an empty backup")
  return bytes
}

/** Delete backups (R2 object + row) beyond the newest `retentionCount` successes. */
async function pruneOldBackups(cfg: R2Config): Promise<void> {
  const keep = Math.max(1, cfg.retentionCount)
  const successes = await db.query.databaseBackups.findMany({
    where: eq(databaseBackups.status, "success"),
    orderBy: [desc(databaseBackups.startedAt)],
  })
  const overflow = successes.slice(keep)
  for (const b of overflow) {
    await deleteR2Object(cfg, b.objectKey).catch((err) =>
      console.error(`[db-backup] failed to delete R2 object ${b.objectKey}:`, err),
    )
    await db.delete(databaseBackups).where(eq(databaseBackups.id, b.id))
  }
}

export type RestoreResult = { ok: true; warnings: string | null }

/**
 * Restore the database from an R2 backup object via `pg_restore --clean`.
 * DESTRUCTIVE: drops and recreates objects, overwriting all live data. Callers
 * must gate this behind an explicit admin confirmation. pg_restore can exit
 * non-zero on benign warnings, so we surface stderr rather than always throwing.
 */
export async function restoreDatabaseFromBackup(opts: {
  key: string
  userId: string
}): Promise<RestoreResult> {
  const cfg = await getR2Config()
  const { env, args } = pgConnection()

  const body = await getR2Object(cfg, opts.key)
  const restore = spawn(
    PG_RESTORE,
    [...args, "--clean", "--if-exists", "--no-owner", "--no-privileges"],
    { env },
  )

  let stderr = ""
  restore.stderr.on("data", (d: Buffer) => {
    if (stderr.length < STDERR_CAP) stderr += d.toString()
  })

  const exit = new Promise<number>((resolve, reject) => {
    restore.on("error", reject)
    restore.on("close", (code) => resolve(code ?? 0))
  })

  // Stream the dump from R2 into pg_restore's stdin. Both must run
  // concurrently — pg_restore won't exit until stdin is fully written.
  const [code] = await Promise.all([exit, pipeline(body, restore.stdin)])

  await logAuditEvent({
    userId: opts.userId,
    action: "admin.backup.restore",
    targetType: "database_backup",
    targetLabel: opts.key,
    meta: { exitCode: code, warnings: stderr.trim().slice(0, 2000) || null },
  })

  if (code !== 0) {
    // Non-zero can mean real failure OR ignorable warnings. Surface the detail.
    throw new Error(`pg_restore exited ${code}: ${stderr.trim() || "no output"}`)
  }

  return { ok: true, warnings: stderr.trim() || null }
}

/**
 * Reconcile DB rows against what's actually in R2 for the admin list: returns
 * the recorded backups annotated with whether the object still exists.
 */
export async function listBackups() {
  const rows = await db.query.databaseBackups.findMany({
    orderBy: [desc(databaseBackups.startedAt)],
    limit: 100,
  })
  let liveKeys: Set<string> | null = null
  try {
    const cfg = await getR2Config()
    const objects = await listR2Backups(cfg)
    liveKeys = new Set(objects.map((o) => o.key))
  } catch {
    // R2 not configured or unreachable — show rows without the live flag.
  }
  return rows.map((r) => ({
    id: r.id,
    objectKey: r.objectKey,
    fileName: r.fileName,
    sizeBytes: r.sizeBytes,
    status: r.status,
    error: r.error,
    trigger: r.trigger,
    startedAt: r.startedAt,
    completedAt: r.completedAt,
    existsInR2: liveKeys ? liveKeys.has(r.objectKey) : null,
  }))
}
