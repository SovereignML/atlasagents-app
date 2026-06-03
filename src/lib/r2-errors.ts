import { NextResponse } from "next/server"
import { R2NotConfiguredError } from "@/lib/r2"

/**
 * Map an R2 lib error to an HTTP response. Returns a NextResponse for the known
 * "not configured" case (so the UI can prompt the admin to add credentials), or
 * null for anything else (caller should handle / 500).
 */
export function r2ErrorResponse(err: unknown): NextResponse | null {
  if (err instanceof R2NotConfiguredError) {
    return NextResponse.json(
      { error: err.message, code: "r2_not_configured" },
      { status: 409 },
    )
  }
  return null
}
