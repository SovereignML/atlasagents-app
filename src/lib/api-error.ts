import { NextResponse } from "next/server"

/**
 * Standard 500 response for API routes. Logs the error with a route tag for
 * grep-able server logs, then returns a JSON `{ error }` body so clients get a
 * structured failure instead of a bare Next.js crash page.
 *
 * Usage:
 *   try { … } catch (err) { return apiError("instances", err) }
 */
export function apiError(tag: string, err: unknown) {
  console.error(`[${tag}]`, err)
  const message = err instanceof Error ? err.message : "Internal error"
  return NextResponse.json({ error: message }, { status: 500 })
}
