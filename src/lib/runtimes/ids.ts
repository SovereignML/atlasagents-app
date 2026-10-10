/**
 * Every runtime id, in display order. The single list the `RuntimeId` type,
 * the agent-config zod enum and the registries are all derived from, so adding
 * an engine is one edit here plus the places the type checker then demands.
 *
 * No imports on purpose: safe in client components and in `agent-config.ts`.
 */
export const RUNTIME_IDS = ["openclaw", "hermes"] as const
