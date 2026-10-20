import { and, asc, eq, isNotNull, ne, notInArray } from "drizzle-orm"

import { db, allowedModels, instances } from "@/db"
import { HERMES_MIN_CONTEXT, runtimeAcceptsModel, runtimeCaps } from "@/lib/runtimes/labels"
import {
  ALLOWED_OPENROUTER_MODELS,
  OPENROUTER_BASE_URL,
  isValidOpenRouterSlug,
  type AllowedModelKind,
} from "@/lib/model-router"

export type AllowedModelRow = typeof allowedModels.$inferSelect

const KINDS: AllowedModelKind[] = ["chat", "image", "moderation"]

export function isAllowedModelKind(value: string): value is AllowedModelKind {
  return (KINDS as string[]).includes(value)
}

/**
 * Minimum context window Hermes tolerates — it rejects (crash-loops on) any model
 * below this at startup, so the per-instance Hermes picker only offers models at or
 * above it. Kept here next to the selectable-models filter that enforces it.
 */
export { HERMES_MIN_CONTEXT }

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
  /** Context window from the catalog, when known — gates Hermes-compatibility. */
  contextLength?: number | null
}): Promise<AllowedModelRow> {
  const slug = args.slug.trim()
  if (!isValidOpenRouterSlug(slug)) {
    throw new Error("slug must be a valid OpenRouter <author>/<slug>")
  }
  const label = args.label.trim() || slug
  const contextLength = args.contextLength ?? null
  const [row] = await db
    .insert(allowedModels)
    .values({ slug, label, kind: args.kind, contextLength })
    .onConflictDoUpdate({
      target: allowedModels.slug,
      // Don't clobber a known contextLength with null on a bare re-enable.
      set: {
        label,
        kind: args.kind,
        enabled: true,
        ...(contextLength != null ? { contextLength } : {}),
      },
    })
    .returning()
  return row
}

/**
 * Backfill/refresh `contextLength` for every allowlisted model from the public
 * OpenRouter catalog (no key needed). Idempotent — safe to re-run; rows whose slug
 * isn't in the catalog are left untouched. Returns how many rows were updated.
 */
export async function syncModelMetadata(): Promise<{ updated: number }> {
  const res = await fetch(`${OPENROUTER_BASE_URL}/models`, { cache: "no-store" })
  if (!res.ok) throw new Error(`OpenRouter /models ${res.status}`)
  const json = (await res.json()) as {
    data?: { id: string; context_length?: number }[]
  }
  const ctxBySlug = new Map<string, number>()
  for (const m of json.data ?? []) {
    if (typeof m.context_length === "number") ctxBySlug.set(m.id, m.context_length)
  }

  const rows = await listAllowedModels()
  let updated = 0
  for (const row of rows) {
    const ctx = ctxBySlug.get(row.slug)
    if (ctx != null && ctx !== row.contextLength) {
      await db
        .update(allowedModels)
        .set({ contextLength: ctx })
        .where(eq(allowedModels.slug, row.slug))
      updated++
    }
  }
  return { updated }
}

/**
 * Replace the allowlist with the recommended catalog (`ALLOWED_OPENROUTER_MODELS`):
 * every other row is deleted, every recommended one is added (or re-enabled,
 * with its curated label), then context windows are refreshed from the public
 * catalog so the engines with a context floor can offer them. The OpenRouter
 * account allowlist is separate and must be changed to match by hand.
 *
 * Agents keep any per-agent model they were given; `staleAgents` counts the
 * live ones whose model is no longer listed, so they can be moved.
 */
export async function resetAllowedModelsToRecommended(): Promise<{
  removed: string[]
  kept: number
  contextUpdated: number
  staleAgents: number
}> {
  const slugs = ALLOWED_OPENROUTER_MODELS.map((m) => m.slug)
  const removed = await db.transaction(async (tx) => {
    const gone = await tx
      .delete(allowedModels)
      .where(notInArray(allowedModels.slug, slugs))
      .returning({ slug: allowedModels.slug })
    for (const m of ALLOWED_OPENROUTER_MODELS) {
      await tx
        .insert(allowedModels)
        .values({ slug: m.slug, label: m.label, kind: m.kind })
        .onConflictDoUpdate({
          target: allowedModels.slug,
          set: { label: m.label, kind: m.kind, enabled: true },
        })
    }
    return gone.map((r) => r.slug)
  })
  let contextUpdated = 0
  try {
    contextUpdated = (await syncModelMetadata()).updated
  } catch (e) {
    // The catalog is public but can be down; the admin can press Sync later.
    console.warn("[allowed-models] context sync after reset failed:", e)
  }
  const stale = await db
    .select({ id: instances.id })
    .from(instances)
    .where(
      and(
        isNotNull(instances.modelSlug),
        notInArray(instances.modelSlug, slugs),
        ne(instances.status, "deleted"),
      ),
    )
  return { removed, kept: slugs.length, contextUpdated, staleAgents: stale.length }
}

/** True for a chat model that satisfies the runtime's constraints. */
function isSelectableForRuntime(row: AllowedModelRow, runtimeId: string): boolean {
  if (!row.enabled || row.kind !== "chat") return false
  // Claude Code / Codex can only drive their own model family.
  if (!runtimeAcceptsModel(runtimeId, row.slug)) return false
  // Hermes needs a known ≥64k context; OpenClaw has no floor.
  const { minContext } = runtimeCaps(runtimeId)
  if (minContext != null) {
    return row.contextLength != null && row.contextLength >= minContext
  }
  return true
}

/**
 * Models a user may pick for an instance's runtime: enabled chat models, further
 * filtered to ≥64k context for Hermes. Single source of truth for both the
 * per-instance picker UI and its PATCH validation. `runtimeId` NULL → OpenClaw.
 */
export async function selectableModelsForRuntime(
  runtimeId: string | null,
): Promise<AllowedModelRow[]> {
  const runtime = runtimeId ?? "openclaw"
  const rows = await listAllowedModels()
  return rows.filter((r) => isSelectableForRuntime(r, runtime))
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
