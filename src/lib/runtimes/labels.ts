import type { RuntimeId } from "./types"

/**
 * Client-safe runtime display labels. The full runtime adapters (and
 * `getRuntime`) transitively import `node:crypto` via `shared.ts`, so they
 * cannot be pulled into client components. This module has no Node imports and
 * is safe in both server and client code. Keep these labels in sync with the
 * adapter `displayName`s in openclaw.ts / hermes.ts.
 */
export const RUNTIME_LABELS: Record<RuntimeId, string> = {
  openclaw: "OpenClaw",
  hermes: "Hermes",
}

/** Resolve a runtime id to its display label, defaulting to OpenClaw. */
export function runtimeLabel(id: string | null | undefined): string {
  return (id && RUNTIME_LABELS[id as RuntimeId]) || "OpenClaw"
}
