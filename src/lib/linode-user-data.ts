import { gzipSync } from "node:zlib"

// Pure (no DB, no network): linode.ts uses it, and the tests import it.

/** Linode refuses user-data larger than this once decoded (its API's own limit). */
export const LINODE_USER_DATA_MAX_BYTES = 16384

/**
 * The `metadata.user_data` for a bootstrap script: base64 of the script, or of
 * the script gzip-compressed when it is over Linode's 16 KB limit (the
 * universal warm-pool image is ~38 KB). cloud-init recognises gzip user-data
 * and decompresses it before running the script, so the box sees the same
 * bytes either way. Small scripts go as before, uncompressed.
 */
export function linodeUserData(script: string): string {
  const raw = Buffer.from(script, "utf8")
  if (raw.length <= LINODE_USER_DATA_MAX_BYTES) return raw.toString("base64")
  const gz = gzipSync(raw, { level: 9 })
  if (gz.length > LINODE_USER_DATA_MAX_BYTES) {
    throw new Error(`bootstrap is ${gz.length} bytes gzip-compressed, over Linode's ${LINODE_USER_DATA_MAX_BYTES}-byte user-data limit`)
  }
  return gz.toString("base64")
}
