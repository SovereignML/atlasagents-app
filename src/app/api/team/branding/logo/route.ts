import { NextResponse } from "next/server"
import { db, teamBranding, teamBrandingAssets } from "@/db"
import { requireBrandingManager } from "@/lib/branding-access"
import {
  isAssetKind,
  ALLOWED_IMAGE_TYPES,
  MAX_ASSET_BYTES,
  assetUrl,
  KIND_TO_FIELD,
} from "@/lib/branding-assets"
import { logAuditEvent } from "@/lib/audit"

// POST multipart/form-data { kind, file } — store an uploaded brand image in
// Postgres and point the matching teamBranding URL field at the serving route.
export async function POST(req: Request) {
  const guard = await requireBrandingManager()
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status })
  }
  const { userId, teamId } = guard

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: "Expected multipart form data" }, { status: 400 })
  }

  const kind = String(form.get("kind") ?? "")
  if (!isAssetKind(kind)) {
    return NextResponse.json({ error: "Invalid asset kind" }, { status: 400 })
  }

  const file = form.get("file")
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 })
  }
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: "Unsupported image type (use PNG, JPEG, WebP, GIF, SVG, or ICO)" },
      { status: 415 },
    )
  }
  if (file.size > MAX_ASSET_BYTES) {
    return NextResponse.json(
      { error: `File too large (max ${Math.floor(MAX_ASSET_BYTES / 1024)} KB)` },
      { status: 413 },
    )
  }

  const bytes = Buffer.from(await file.arrayBuffer())
  if (bytes.byteLength === 0) {
    return NextResponse.json({ error: "Empty file" }, { status: 400 })
  }
  const dataBase64 = bytes.toString("base64")

  const now = new Date()
  await db
    .insert(teamBrandingAssets)
    .values({ teamId, kind, contentType: file.type, dataBase64 })
    .onConflictDoUpdate({
      target: [teamBrandingAssets.teamId, teamBrandingAssets.kind],
      set: { contentType: file.type, dataBase64, updatedAt: now },
    })

  // Point the branding URL field at the served asset, cache-busted by version.
  const url = assetUrl(teamId, kind, now.getTime())
  await db
    .insert(teamBranding)
    .values({ teamId, [KIND_TO_FIELD[kind]]: url })
    .onConflictDoUpdate({
      target: teamBranding.teamId,
      set: { [KIND_TO_FIELD[kind]]: url, updatedAt: now },
    })

  await logAuditEvent({
    userId,
    action: "branding.asset.upload",
    teamId,
    targetType: "asset",
    targetLabel: kind,
  })

  return NextResponse.json({ url, kind })
}
