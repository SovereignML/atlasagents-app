import { NextResponse } from "next/server"
import { DriveNotConnectedError, DriveAuthError } from "@/lib/google-drive"

/**
 * Map a Drive lib error to an HTTP response. Returns a NextResponse for the
 * known connection/auth errors (so the UI can prompt connect/reconnect), or
 * null for anything else (caller should handle / 500).
 */
export function driveErrorResponse(err: unknown): NextResponse | null {
  if (err instanceof DriveNotConnectedError) {
    return NextResponse.json(
      { error: "Connect Google Drive first.", code: "drive_not_connected" },
      { status: 409 },
    )
  }
  if (err instanceof DriveAuthError) {
    return NextResponse.json(
      { error: "Google Drive access expired. Reconnect to continue.", code: "drive_reauth" },
      { status: 409 },
    )
  }
  return null
}
