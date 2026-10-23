/**
 * Every runtime id, in display order. The single list the `RuntimeId` type,
 * the agent-config zod enum and the registries are all derived from, so adding
 * an engine is one edit here plus the places the type checker then demands.
 *
 * No imports on purpose: safe in client components and in `agent-config.ts`.
 */
export const RUNTIME_IDS = ["openclaw", "hermes", "claude-code", "codex", "opencode", "pi", "gemini-cli", "grok"] as const

/**
 * The engines a BYOS server can run: every one but OpenClaw. These are exactly
 * the universal image's engines (runtimes/universal.ts, asserted in its test),
 * which is what the connect-time prebake installs, so every engine offered on
 * BYOS deploys onto an already-warm server.
 */
export const BYOS_RUNTIME_IDS = RUNTIME_IDS.filter(
  (id): id is Exclude<(typeof RUNTIME_IDS)[number], "openclaw"> => id !== "openclaw",
)
