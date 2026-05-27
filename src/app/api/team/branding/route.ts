import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/auth"
import { db, eq, teamBranding } from "@/db"
import { getUserTeam, canManageTeam } from "@/lib/team"
import { teamHasWhiteLabel } from "@/lib/white-label"
import { isValidCssColor } from "@/lib/tenant-branding"
import { requireBrandingManager } from "@/lib/branding-access"
import { logAuditEvent } from "@/lib/audit"

// Empty string clears a field (stored as null); omitted keys are left untouched.
const colorField = z
  .union([z.literal(""), z.string().trim().refine(isValidCssColor, "Invalid color")])
  .nullish()

// An uploaded asset served by /api/branding-asset/<teamId>/<kind>?v=<ts>.
const ASSET_PATH_RE = /^\/api\/branding-asset\/[A-Za-z0-9_-]+\/[A-Za-z]+(?:\?v=\d+)?$/

function isHttpsUrl(v: string): boolean {
  if (!v.startsWith("https://") || v.length > 2048) return false
  try {
    new URL(v)
    return true
  } catch {
    return false
  }
}

// Accepts an external https URL OR an internal uploaded-asset path.
const imageRefField = z
  .union([
    z.literal(""),
    z
      .string()
      .trim()
      .max(2048)
      .refine(
        (v) => ASSET_PATH_RE.test(v) || isHttpsUrl(v),
        "Must be an https URL or an uploaded image",
      ),
  ])
  .nullish()

const patchSchema = z.object({
  brandName: z.union([z.literal(""), z.string().trim().max(60)]).nullish(),
  supportEmail: z.union([z.literal(""), z.string().trim().email().max(254)]).nullish(),
  logoUrl: imageRefField,
  logoMarkUrl: imageRefField,
  faviconUrl: imageRefField,
  primaryLight: colorField,
  accentLight: colorField,
  primaryDark: colorField,
  accentDark: colorField,
  brandingEnabled: z.boolean().optional(),
})

/** "" → null, undefined → leave out (so PATCH stays partial). */
function pickUpdates(data: z.infer<typeof patchSchema>) {
  const updates: Record<string, string | boolean | null> = {}
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue
    updates[key] = value === "" ? null : value
  }
  return updates
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const ctx = await getUserTeam(session.user.id)
  if (!ctx) return NextResponse.json({ error: "No team" }, { status: 404 })

  const [row, entitled] = await Promise.all([
    db.query.teamBranding.findFirst({ where: eq(teamBranding.teamId, ctx.teamId) }),
    teamHasWhiteLabel(ctx.teamId),
  ])

  return NextResponse.json({
    branding: row ?? null,
    entitled,
    canManage: canManageTeam(ctx.role),
  })
}

export async function PATCH(req: Request) {
  const guard = await requireBrandingManager()
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status })
  }
  const { userId, teamId } = guard

  const body = await req.json().catch(() => null)
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const updates = pickUpdates(parsed.data)

  await db
    .insert(teamBranding)
    .values({ teamId, ...updates })
    .onConflictDoUpdate({
      target: teamBranding.teamId,
      set: { ...updates, updatedAt: new Date() },
    })

  await logAuditEvent({
    userId,
    action: "branding.update",
    teamId,
    meta: { fields: Object.keys(updates) },
  })

  const row = await db.query.teamBranding.findFirst({
    where: eq(teamBranding.teamId, teamId),
  })
  return NextResponse.json({ branding: row })
}
