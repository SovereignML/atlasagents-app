import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/admin-guard"
import {
  addAllowedModel,
  listAllowedModels,
  removeAllowedModel,
  resetAllowedModelsToRecommended,
  syncModelMetadata,
  updateAllowedModel,
} from "@/lib/allowed-models"
import { logAuditEvent } from "@/lib/audit"
import { readJsonBody } from "@/lib/request-body"
import { adminModelAddSchema, adminModelEditSchema, adminModelRemoveSchema } from "@/lib/validations"

/**
 * Admin CRUD for the OpenRouter account-allowlist mirror (AllowedModel).
 * Editing here only updates what the PLATFORM offers/validates — the actual
 * enforcement lives in the OpenRouter account settings, so keep both in sync.
 *
 *   GET             — list all rows
 *   POST   {action: "sync"}                                — refresh contextLength from catalog
 *   POST   {action: "reset"}                               — replace the list with the recommended catalog
 *   POST   {slug, label?, kind?, contextLength?}           — add (or re-enable) a model
 *   PATCH  {slug, label?, kind?, enabled?}                 — edit a model
 *   DELETE {slug}                                          — remove a model
 */

export async function GET() {
  const guard = await requireAdmin()
  if (!guard.ok) return guard.res
  return NextResponse.json({ models: await listAllowedModels() })
}

export async function POST(req: Request) {
  const guard = await requireAdmin()
  if (!guard.ok) return guard.res

  const parsed = await readJsonBody(req, adminModelAddSchema)
  if (!parsed.ok) return parsed.res
  const body = parsed.data

  // Refresh contextLength for every row from the public OpenRouter catalog.
  if (body.action === "sync") {
    try {
      const result = await syncModelMetadata()
      return NextResponse.json(result)
    } catch (e) {
      return NextResponse.json({ error: String(e) }, { status: 502 })
    }
  }

  if (body.action === "reset") {
    const result = await resetAllowedModelsToRecommended()
    await logAuditEvent({
      userId: guard.userId,
      action: "admin.models.reset",
      targetType: "allowed_models",
      targetId: "all",
      meta: { removed: result.removed, kept: result.kept },
    })
    return NextResponse.json(result)
  }

  const slug = body.slug
  const kind = body.kind ?? "chat"

  try {
    const model = await addAllowedModel({
      slug,
      label: body.label?.trim() || slug,
      kind,
      contextLength:
        typeof body.contextLength === "number" ? body.contextLength : null,
    })
    return NextResponse.json({ model })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}

export async function PATCH(req: Request) {
  const guard = await requireAdmin()
  if (!guard.ok) return guard.res

  const parsed = await readJsonBody(req, adminModelEditSchema)
  if (!parsed.ok) return parsed.res
  const body = parsed.data
  const slug = body.slug

  const model = await updateAllowedModel(slug, {
    ...(body.label !== undefined ? { label: body.label.trim() } : {}),
    ...(body.kind !== undefined ? { kind: body.kind } : {}),
    ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
  })
  if (!model) {
    return NextResponse.json({ error: "Unknown slug" }, { status: 404 })
  }
  return NextResponse.json({ model })
}

export async function DELETE(req: Request) {
  const guard = await requireAdmin()
  if (!guard.ok) return guard.res

  const parsed = await readJsonBody(req, adminModelRemoveSchema)
  if (!parsed.ok) return parsed.res
  const slug = parsed.data.slug

  const removed = await removeAllowedModel(slug)
  if (!removed) {
    return NextResponse.json({ error: "Unknown slug" }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}
