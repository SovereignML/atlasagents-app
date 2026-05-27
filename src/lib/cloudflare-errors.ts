import { NextResponse } from "next/server"
import {
  CloudflareNotConnectedError,
  CloudflareAuthError,
  isCloudflareAuthError,
} from "@/lib/cloudflare"

/**
 * Map a Cloudflare lib error to an HTTP response. Returns a NextResponse for
 * the known connection/auth errors (so the UI can prompt connect/reconnect),
 * or null for anything else (caller should handle / 500). Mirrors
 * src/lib/drive-errors.ts.
 */
export function cloudflareErrorResponse(err: unknown): NextResponse | null {
  if (err instanceof CloudflareNotConnectedError) {
    return NextResponse.json(
      { error: "Connect Cloudflare first.", code: "cloudflare_not_connected" },
      { status: 409 },
    )
  }
  if (err instanceof CloudflareAuthError || isCloudflareAuthError(err)) {
    return NextResponse.json(
      {
        error:
          "Cloudflare token is invalid or lacks the required scopes. Reconnect to continue.",
        code: "cloudflare_reauth",
      },
      { status: 409 },
    )
  }
  return null
}
