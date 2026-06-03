// Cloudflare R2 client + config helpers for admin database backups.
//
// R2 is S3-compatible, so we use the AWS S3 SDK pointed at the account's R2
// endpoint. Credentials live in the singleton `R2BackupConfig` row (secrets
// encrypted at rest with INSTANCE_ENCRYPTION_KEY) — never in env. Load them via
// getR2Config(); everything else takes the resolved config so callers decrypt
// exactly once per request.

import {
  S3Client,
  HeadBucketCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3"
import { Upload } from "@aws-sdk/lib-storage"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import type { Readable } from "node:stream"

import { db } from "@/db"
import { decryptSecret } from "@/lib/crypto-secret"

/** Thrown when no R2 credentials have been saved yet. Mapped to HTTP 409. */
export class R2NotConfiguredError extends Error {
  constructor() {
    super("Cloudflare R2 is not configured. Add your credentials first.")
    this.name = "R2NotConfiguredError"
  }
}

/** Prefix under which all backup objects are stored in the bucket. */
export const BACKUP_PREFIX = "backups/"

export type R2Config = {
  accountId: string
  bucket: string
  endpoint: string
  accessKeyId: string
  secretAccessKey: string
  retentionCount: number
}

/** Default S3 endpoint for an R2 account when none is explicitly configured. */
export function defaultR2Endpoint(accountId: string): string {
  return `https://${accountId}.r2.cloudflarestorage.com`
}

/**
 * Load and decrypt the singleton R2 config. Throws R2NotConfiguredError if no
 * row exists yet. Keep the returned secrets out of logs.
 */
export async function getR2Config(): Promise<R2Config> {
  const row = await db.query.r2BackupConfig.findFirst()
  if (!row) throw new R2NotConfiguredError()
  return {
    accountId: row.accountId,
    bucket: row.bucket,
    endpoint: row.endpoint || defaultR2Endpoint(row.accountId),
    accessKeyId: decryptSecret(row.accessKeyIdEnc),
    secretAccessKey: decryptSecret(row.secretAccessKeyEnc),
    retentionCount: row.retentionCount,
  }
}

/** Build an S3 client bound to an R2 account. */
export function r2Client(cfg: R2Config): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: cfg.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  })
}

/**
 * Stream an arbitrarily large body to R2. `lib-storage`'s Upload handles
 * multipart chunking for streams, so pg_dump's stdout can be piped straight in
 * without buffering the whole dump in memory.
 *
 * Byte accounting is the caller's job (e.g. via a counting PassThrough) —
 * attaching a `data` listener here would flip the stream into flowing mode and
 * race with Upload's own reads.
 */
export async function uploadStreamToR2(
  cfg: R2Config,
  key: string,
  body: Readable,
  contentType = "application/octet-stream",
): Promise<void> {
  const client = r2Client(cfg)
  try {
    const upload = new Upload({
      client,
      params: { Bucket: cfg.bucket, Key: key, Body: body, ContentType: contentType },
    })
    await upload.done()
  } finally {
    client.destroy()
  }
}

export type R2Object = { key: string; size: number; lastModified: Date | null }

/** List backup objects (newest first), paging through the bucket prefix. */
export async function listR2Backups(cfg: R2Config): Promise<R2Object[]> {
  const client = r2Client(cfg)
  const out: R2Object[] = []
  try {
    let token: string | undefined
    do {
      const res = await client.send(
        new ListObjectsV2Command({
          Bucket: cfg.bucket,
          Prefix: BACKUP_PREFIX,
          ContinuationToken: token,
        }),
      )
      for (const o of res.Contents ?? []) {
        if (!o.Key) continue
        out.push({
          key: o.Key,
          size: o.Size ?? 0,
          lastModified: o.LastModified ?? null,
        })
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined
    } while (token)
  } finally {
    client.destroy()
  }
  out.sort((a, b) => (b.lastModified?.getTime() ?? 0) - (a.lastModified?.getTime() ?? 0))
  return out
}

/** Delete a single object from the bucket. */
export async function deleteR2Object(cfg: R2Config, key: string): Promise<void> {
  const client = r2Client(cfg)
  try {
    await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }))
  } finally {
    client.destroy()
  }
}

/** Fetch an object's body as a Node Readable stream (for restore). */
export async function getR2Object(cfg: R2Config, key: string): Promise<Readable> {
  const client = r2Client(cfg)
  // Note: we intentionally do NOT destroy the client here — the returned stream
  // keeps the underlying connection alive until the caller drains it.
  const res = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }))
  if (!res.Body) throw new Error(`R2 object has no body: ${key}`)
  return res.Body as Readable
}

/** Presigned GET URL so the browser can download a dump directly from R2. */
export async function presignDownload(
  cfg: R2Config,
  key: string,
  expiresInSeconds = 300,
): Promise<string> {
  const client = r2Client(cfg)
  try {
    return await getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: cfg.bucket, Key: key }),
      { expiresIn: expiresInSeconds },
    )
  } finally {
    client.destroy()
  }
}

/**
 * Validate credentials + bucket access with a HeadBucket. Returns true on
 * success; throws the underlying SDK error otherwise (caller maps to a message).
 */
export async function testR2Connection(cfg: R2Config): Promise<true> {
  const client = r2Client(cfg)
  try {
    await client.send(new HeadBucketCommand({ Bucket: cfg.bucket }))
    return true
  } finally {
    client.destroy()
  }
}
