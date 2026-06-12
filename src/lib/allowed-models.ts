import { asc, eq } from "drizzle-orm"

import { db, allowedModels } from "@/db"
import {
  ALLOWED_OPENROUTER_MODELS,
  isValidOpenRouterSlug,
  type AllowedModelKind,
} from "@/lib/model-router"

export type AllowedModelRow = typeof allowedModels.$inferSelect

const KINDS: AllowedModelKind[] = ["chat", "image", "moderation"]

export function isAllowedModelKind(value: string): value is AllowedModelKind {
  return (KINDS as string[]).includes(value)
}

/**
 * The DB is the runtime source of truth for the account allowlist; the code
 * constant only seeds an empty table (first boot / fresh database) so the
 * dashboard starts populated without a manual seed step.
 */
async function seedIfEmpty(): Promise<void> {
  const existing = await db
    .select({ slug: allowedModels.slug })
    .from(allowedModels)
    .limit(1)
  if (existing.length > 0) return
  await db
    .insert(allowedModels)
    .values(
      ALLOWED_OPENROUTER_MODELS.map((m) => ({
        slug: m.slug,
        label: m.label,
        kind: m.kind,
      })),
    )
    .onConflictDoNothing()
}

export async function listAllowedModels(): Promise<AllowedModelRow[]> {
  await seedIfEmpty()
  return db.select().from(allowedModels).orderBy(asc(allowedModels.label))
}

/** Slugs bots may use (enabled rows only). */
export async function allowedModelSlugs(): Promise<Set<string>> {
  const rows = await listAllowedModels()
  return new Set(rows.filter((r) => r.enabled).map((r) => r.slug))
}

export async function addAllowedModel(args: {
  slug: string
  label: string
  kind: AllowedModelKind
}): Promise<AllowedModelRow> {
  const slug = args.slug.trim()
  if (!isValidOpenRouterSlug(slug)) {
    throw new Error("slug must be a valid OpenRouter <author>/<slug>")
  }
  const [row] = await db
    .insert(allowedModels)
    .values({ slug, label: args.label.trim() || slug, kind: args.kind })
    .onConflictDoUpdate({
      target: allowedModels.slug,
      set: { label: args.label.trim() || slug, kind: args.kind, enabled: true },
    })
    .returning()
  return row
}

export async function updateAllowedModel(
  slug: string,
  patch: Partial<{ label: string; kind: AllowedModelKind; enabled: boolean }>,
): Promise<AllowedModelRow | null> {
  const [row] = await db
    .update(allowedModels)
    .set(patch)
    .where(eq(allowedModels.slug, slug))
    .returning()
  return row ?? null
}

export async function removeAllowedModel(slug: string): Promise<boolean> {
  const deleted = await db
    .delete(allowedModels)
    .where(eq(allowedModels.slug, slug))
    .returning({ slug: allowedModels.slug })
  return deleted.length > 0
}
