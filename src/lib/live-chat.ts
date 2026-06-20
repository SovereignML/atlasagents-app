/**
 * Cross-component control for the live-chat (Chatwoot) widget's visibility.
 *
 * Users can hide the chat bubble via the small × on the widget; the preference
 * is persisted in localStorage and broadcast so the widget reacts immediately
 * and the Support page can re-enable it. All helpers are SSR-safe no-ops.
 */

const STORAGE_KEY = "sml.livechat.hidden"
const EVENT = "livechat:visibility"

export function isLiveChatHidden(): boolean {
  if (typeof window === "undefined") return false
  return window.localStorage.getItem(STORAGE_KEY) === "1"
}

export function setLiveChatHidden(hidden: boolean): void {
  if (typeof window === "undefined") return
  if (hidden) window.localStorage.setItem(STORAGE_KEY, "1")
  else window.localStorage.removeItem(STORAGE_KEY)
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { hidden } }))
}

export function onLiveChatVisibilityChange(
  cb: (hidden: boolean) => void,
): () => void {
  const handler = (e: Event) =>
    cb((e as CustomEvent<{ hidden: boolean }>).detail.hidden)
  window.addEventListener(EVENT, handler)
  return () => window.removeEventListener(EVENT, handler)
}

/**
 * Re-enables (if the user had hidden it) and opens the live-chat window.
 * No-ops gracefully when Chatwoot isn't configured/loaded yet.
 */
export function openLiveChat(): void {
  setLiveChatHidden(false)
  const cw = window.$chatwoot
  if (!cw) return
  cw.toggleBubbleVisibility("show")
  cw.toggle("open")
}
