/**
 * Scrub credentials and email addresses out of Sentry events before they
 * leave the process. Shared by the server, edge and browser inits as
 * `beforeSend`.
 *
 * SENTRY_DATA_COLLECTION already keeps request headers, cookies, bodies and
 * user info out. This covers what remains: error messages, console arguments
 * (captureConsoleIntegration attaches them as `extra.arguments`), breadcrumbs
 * and URLs, which can carry a bot token, an API key or a customer's email.
 */

const PATTERNS: Array<[RegExp, string]> = [
  // Authorization-style values.
  [/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 [redacted]"],
  // Provider key shapes: Stripe, OpenRouter/OpenAI/Anthropic, GitHub, Resend, Slack.
  [/\b(sk|rk|pk)_(live|test)_[A-Za-z0-9]{8,}/g, "$1_$2_[redacted]"],
  [/\bwhsec_[A-Za-z0-9]{8,}/g, "whsec_[redacted]"],
  [/\bsk-[A-Za-z0-9-_]{16,}/g, "sk-[redacted]"],
  [/\b(ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{16,}/g, "$1_[redacted]"],
  [/\bre_[A-Za-z0-9]{16,}/g, "re_[redacted]"],
  [/\bxox[abpr]-[A-Za-z0-9-]{10,}/g, "xox-[redacted]"],
  // Telegram bot tokens, as in api.telegram.org/bot<token>/.
  [/(?<![0-9])\d{6,12}:[A-Za-z0-9_-]{30,}/g, "[telegram-token]"],
  // JWTs.
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "[jwt]"],
  // Secret-looking query parameters and key=value pairs.
  [
    /\b(token|secret|password|passwd|api[_-]?key|key|signature|sig|code)=([^&\s"']+)/gi,
    "$1=[redacted]",
  ],
  // Email addresses.
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]"],
  // Long hex strings: gateway tokens, webhook ids/secrets, bot tokens we mint.
  [/\b[0-9a-f]{32,}\b/gi, "[hex]"],
]

export function scrubText(text: string): string {
  let out = text
  for (const [re, replacement] of PATTERNS) out = out.replace(re, replacement)
  return out
}

const MAX_DEPTH = 6

/** Return `value` with every string inside it scrubbed. Objects are copied, not mutated. */
export function scrubValue<T>(value: T, depth = 0): T {
  if (typeof value === "string") return scrubText(value) as T
  if (depth >= MAX_DEPTH || value === null || typeof value !== "object") return value
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1)) as T
  if (value instanceof Error) {
    const copy = new Error(scrubText(value.message))
    copy.name = value.name
    copy.stack = value.stack ? scrubText(value.stack) : value.stack
    return copy as T
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = scrubValue(v, depth + 1)
  }
  return out as T
}

type ScrubbableEvent = {
  message?: string
  exception?: { values?: Array<{ value?: string }> }
  breadcrumbs?: Array<{ message?: string; data?: Record<string, unknown> }>
  extra?: Record<string, unknown>
  request?: { url?: string; query_string?: unknown }
  transaction?: string
}

/** Sentry `beforeSend`: scrub the event in place and send it. */
export function scrubSentryEvent<E extends ScrubbableEvent>(event: E): E {
  if (event.message) event.message = scrubText(event.message)
  for (const ex of event.exception?.values ?? []) {
    if (ex.value) ex.value = scrubText(ex.value)
  }
  for (const crumb of event.breadcrumbs ?? []) {
    if (crumb.message) crumb.message = scrubText(crumb.message)
    if (crumb.data) crumb.data = scrubValue(crumb.data)
  }
  if (event.extra) event.extra = scrubValue(event.extra)
  if (event.request) {
    if (event.request.url) event.request.url = scrubText(event.request.url)
    if (event.request.query_string) event.request.query_string = scrubValue(event.request.query_string)
  }
  if (event.transaction) event.transaction = scrubText(event.transaction)
  return event
}
