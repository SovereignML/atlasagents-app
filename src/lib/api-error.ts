import { NextResponse } from "next/server"

/**
 * Standard 500 response for API routes. Logs the full error with a route tag
 * and a short reference, then returns a generic JSON `{ error, ref }` body.
 *
 * The client never sees `err.message`: it can carry SQL, provider responses,
 * hostnames and file paths. The reference ties a user's report to the log
 * line, and to the Sentry event (sentry.server.config.ts captures
 * console.error).
 *
 * Usage:
 *   try { … } catch (err) { return apiError("instances", err) }
 */
export function apiError(tag: string, err: unknown, fallback = "Something went wrong on our side.") {
  const ref = errorRef()
  console.error(`[${tag}] ref=${ref}`, err)
  return NextResponse.json({ error: `${fallback} Reference: ${ref}`, ref }, { status: 500 })
}

/** A short random id to quote in support requests. */
export function errorRef(): string {
  return globalThis.crypto.randomUUID().slice(0, 8)
}
