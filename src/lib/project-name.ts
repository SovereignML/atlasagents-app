// Friendly, slug-style project name generator for the deploy wizard.
// Produces `adjective-noun` names (e.g. "swift-otter") that match the
// `my-ai-agent` placeholder and the `deploymentSlug()` format used on the
// deploy page. Output is always lowercase, hyphenated, >= 2 and <= 60 chars,
// so it satisfies `deploySchema` (name: 1-60 chars) without further cleanup.

const ADJECTIVES = [
  "swift",
  "curious",
  "bold",
  "clever",
  "bright",
  "calm",
  "brave",
  "lucky",
  "noble",
  "quiet",
  "rapid",
  "sleek",
  "stellar",
  "sunny",
  "vivid",
  "witty",
  "amber",
  "cosmic",
  "golden",
  "silent",
] as const

const NOUNS = [
  "otter",
  "falcon",
  "panda",
  "lynx",
  "heron",
  "comet",
  "willow",
  "ember",
  "harbor",
  "maple",
  "raven",
  "fox",
  "badger",
  "marlin",
  "cobra",
  "puffin",
  "wolf",
  "tiger",
  "orca",
  "sparrow",
] as const

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]
}

/** Generate a friendly `adjective-noun` project name slug. */
export function generateProjectName(): string {
  return `${pick(ADJECTIVES)}-${pick(NOUNS)}`
}
