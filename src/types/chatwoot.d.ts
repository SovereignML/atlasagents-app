// Ambient typings for the Chatwoot website SDK injected at runtime.
// See https://www.chatwoot.com/docs/product/channels/live-chat/sdk/setup

interface ChatwootSDK {
  run(config: { websiteToken: string; baseUrl: string }): void
}

interface ChatwootUserAttributes {
  name?: string
  email?: string
  identifier_hash?: string
  avatar_url?: string
}

interface ChatwootInstance {
  setUser(identifier: string, attributes: ChatwootUserAttributes): void
  setCustomAttributes(attributes: Record<string, unknown>): void
  setColorScheme(scheme: "light" | "dark" | "auto"): void
  reset(): void
  toggle(state?: "open" | "close"): void
  toggleBubbleVisibility(visibility: "show" | "hide"): void
}

interface Window {
  chatwootSDK?: ChatwootSDK
  $chatwoot?: ChatwootInstance
  chatwootSettings?: Record<string, unknown>
}
