import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/admin-guard"
import {
  addAllowedModel,
  isAllowedModelKind,
  listAllowedModels,
  removeAllowedModel,
  updateAllowedModel,
} from "@/lib/allowed-models"

/**
 * Admin CRUD for the OpenRouter account-allowlist mirror (AllowedModel).
 * Editing here only updates what the PLATFORM offers/validates — the actual
 * enforcement lives in the OpenRouter account settings, so keep both in sync.
 *
 *   GET             — list all rows
 *   POST   {slug, label?, kind?}            — add (or re-enable) a model
 *   PATCH  {slug, label?, kind?, enabled?}  — edit a model
 *   DELETE {slug}                           — remove a model
 */

export async function GET() {
  const guard = await requireAdmin()
  if (!guard.ok) return guard.res
  return NextResponse.json({ models: await listAllowedModels() })
}

export async function POST(req: Request) {
  const guard = await requireAdmin()
  if (!guard.ok) return guard.res

  let body: { slug?: string; label?: string; kind?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  const slug = body.slug?.trim() ?? ""
  if (!slug) {
    return NextResponse.json({ error: "slug is required" }, { status: 400 })
  }
  const kind = body.kind ?? "chat"
  if (!isAllowedModelKind(kind)) {
    return NextResponse.json(
      { error: "kind must be chat | image | moderation" },
      { status: 400 },
    )
  }

  try {
    const model = await addAllowedModel({
      slug,
      label: body.label?.trim() || slug,
      kind,
    })
    return NextResponse.json({ model })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}

export async function PATCH(req: Request) {
  const guard = await requireAdmin()
  if (!guard.ok) return guard.res

  let body: {
    slug?: string
    label?: string
    kind?: string
    enabled?: boolean
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  const slug = body.slug?.trim() ?? ""
  if (!slug) {
    return NextResponse.json({ error: "slug is required" }, { status: 400 })
  }
  if (body.kind !== undefined && !isAllowedModelKind(body.kind)) {
    return NextResponse.json(
      { error: "kind must be chat | image | moderation" },
      { status: 400 },
    )
  }

  const model = await updateAllowedModel(slug, {
    ...(body.label !== undefined ? { label: body.label.trim() } : {}),
    ...(body.kind !== undefined && isAllowedModelKind(body.kind)
      ? { kind: body.kind }
      : {}),
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

  let body: { slug?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  const slug = body.slug?.trim() ?? ""
  if (!slug) {
    return NextResponse.json({ error: "slug is required" }, { status: 400 })
  }

  const removed = await removeAllowedModel(slug)
  if (!removed) {
    return NextResponse.json({ error: "Unknown slug" }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}
