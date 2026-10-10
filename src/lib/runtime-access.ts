import { RUNTIME_IDS } from "@/lib/runtimes/ids"
import { runtimeAvailableTo, runtimeCaps } from "@/lib/runtimes/labels"
import type { RuntimeId } from "@/lib/runtimes/types"

/**
 * Server-side gate for beta runtimes (Claude Code, Codex). Off by default:
 * set `CLI_RUNTIMES_ENABLED=true` to offer them to every customer. Platform
 * admins can always pick them, so the engines can be dogfooded on production
 * before the flag flips.
 */
export function cliRuntimesEnabled(): boolean {
  return process.env.CLI_RUNTIMES_ENABLED?.trim() === "true"
}

type SessionLike = { user?: { role?: string } | null } | null | undefined

function viewerOf(session: SessionLike) {
  return {
    betaEnabled: cliRuntimesEnabled(),
    isAdmin: (session?.user as { role?: string } | undefined)?.role === "admin",
  }
}

/** The runtime ids this viewer may deploy, in display order. */
export function availableRuntimesFor(session: SessionLike): RuntimeId[] {
  const viewer = viewerOf(session)
  return RUNTIME_IDS.filter((id) => runtimeAvailableTo(id, viewer))
}

/**
 * Null when the viewer may deploy `runtime`; otherwise a 403-ready message.
 * The wizards hide unavailable engines, so this only fires for a stale page or
 * a hand-built request.
 */
export function runtimeDeployDenial(runtime: string, session: SessionLike): string | null {
  if (runtimeAvailableTo(runtime, viewerOf(session))) return null
  return `${runtimeCaps(runtime).label} is not available on this account yet.`
}
