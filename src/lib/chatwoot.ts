// Chatwoot integration — server-side helpers.
//
// Two responsibilities:
//   1. `chatwootIdentifierHash` — HMAC used by the live-chat widget to
//      verify the logged-in user (Chatwoot "identity validation").
//   2. `createSupportConversation` — turns an in-app ticket into a
//      contact + conversation in the Chatwoot inbox via the Application API.
//
// Everything degrades gracefully: if the env vars below are unset the
// helpers no-op (return null) so callers can fall back to email.

import { createHmac } from "node:crypto"

const baseUrl = process.env.NEXT_PUBLIC_CHATWOOT_BASE_URL?.replace(/\/$/, "")
const apiToken = process.env.CHATWOOT_API_ACCESS_TOKEN
const accountId = process.env.CHATWOOT_ACCOUNT_ID
const inboxId = process.env.CHATWOOT_INBOX_ID
const hmacToken = process.env.CHATWOOT_HMAC_TOKEN

/** True when the server has everything needed to create tickets via the API. */
export function chatwootConfigured(): boolean {
  return Boolean(baseUrl && apiToken && accountId && inboxId)
}

/**
 * HMAC-SHA256 of the user identifier, keyed by CHATWOOT_HMAC_TOKEN. The widget
 * passes this as `identifier_hash` so Chatwoot trusts the supplied identity.
 * Returns null when no HMAC token is configured (identity validation off).
 */
export function chatwootIdentifierHash(identifier: string): string | null {
  if (!hmacToken) return null
  return createHmac("sha256", hmacToken).update(identifier).digest("hex")
}

type ContactInbox = { source_id: string; inbox?: { id: number } }
type SearchContact = { id: number; email?: string | null; contact_inboxes?: ContactInbox[] }

async function cwFetch(path: string, init: RequestInit): Promise<unknown> {
  const res = await fetch(`${baseUrl}/api/v1/accounts/${accountId}${path}`, {
    ...init,
    // Fail fast: a slow/unreachable Chatwoot host must not hang the request
    // that's awaiting it (the in-app ticket POST). Aborts after 10s.
    signal: AbortSignal.timeout(10_000),
    headers: {
      "Content-Type": "application/json",
      api_access_token: apiToken as string,
      ...(init.headers ?? {}),
    },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`Chatwoot ${init.method ?? "GET"} ${path} → ${res.status}: ${body.slice(0, 300)}`)
  }
  return res.json()
}

/**
 * Outcome of a ticket → Chatwoot push. `skipped` means Chatwoot isn't
 * configured; `failed` carries the error so the caller can log/surface why
 * delivery fell back to email instead of silently swallowing it.
 */
export type CreateConversationResult =
  | { status: "created"; conversationId: number; contactId: number }
  | { status: "skipped" }
  | { status: "failed"; error: string }

/**
 * Create (or reuse) a contact for the user and open a conversation carrying
 * the ticket body as an incoming message. Returns the Chatwoot ids on success,
 * `skipped` if unconfigured, or `failed` (with the reason) if any API call
 * errors — the caller falls back to email in the last two cases.
 */
export async function createSupportConversation(args: {
  userId: string
  name: string
  email: string
  subject: string
  message: string
  priority: string
}): Promise<CreateConversationResult> {
  if (!chatwootConfigured()) return { status: "skipped" }
  const inbox = Number(inboxId)

  try {
    let contactId: number | null = null
    let sourceId: string | null = null

    // 1. Reuse an existing contact for this email if one exists.
    const search = (await cwFetch(`/contacts/search?q=${encodeURIComponent(args.email)}`, {
      method: "GET",
    })) as { payload?: SearchContact[] }
    const existing = search.payload?.find(
      (c) => c.email?.toLowerCase() === args.email.toLowerCase(),
    )
    if (existing) {
      contactId = existing.id
      sourceId = existing.contact_inboxes?.find((ci) => ci.inbox?.id === inbox)?.source_id ?? null
    }

    // 2. Otherwise create the contact (bound to our inbox → yields a source_id).
    if (!contactId) {
      const created = (await cwFetch(`/contacts`, {
        method: "POST",
        body: JSON.stringify({
          inbox_id: inbox,
          name: args.name,
          email: args.email,
          identifier: args.userId,
        }),
      })) as { payload?: { contact?: SearchContact } }
      const contact = created.payload?.contact
      contactId = contact?.id ?? null
      sourceId =
        contact?.contact_inboxes?.find((ci) => ci.inbox?.id === inbox)?.source_id ??
        contact?.contact_inboxes?.[0]?.source_id ??
        null
    }
    if (!contactId) throw new Error("no contact id returned")

    // 3. Ensure a contact_inbox (source_id) exists for the target inbox.
    if (!sourceId) {
      const ci = (await cwFetch(`/contacts/${contactId}/contact_inboxes`, {
        method: "POST",
        body: JSON.stringify({ inbox_id: inbox }),
      })) as { source_id?: string; payload?: { source_id?: string } }
      sourceId = ci.source_id ?? ci.payload?.source_id ?? null
    }
    if (!sourceId) throw new Error("no source_id for inbox")

    // 4. Open the conversation.
    const conversation = (await cwFetch(`/conversations`, {
      method: "POST",
      body: JSON.stringify({
        source_id: sourceId,
        inbox_id: inbox,
        contact_id: contactId,
        additional_attributes: { priority: args.priority, subject: args.subject },
      }),
    })) as { id?: number }
    const conversationId = conversation.id
    if (!conversationId) throw new Error("no conversation id returned")

    // 5. Post the ticket body as the first (incoming) message.
    await cwFetch(`/conversations/${conversationId}/messages`, {
      method: "POST",
      body: JSON.stringify({
        content: `**${args.subject}**\n\n${args.message}`,
        message_type: "incoming",
      }),
    })

    return { status: "created", conversationId, contactId }
  } catch (err) {
    console.error("[chatwoot] createSupportConversation failed:", err)
    return { status: "failed", error: err instanceof Error ? err.message : String(err) }
  }
}

// ──────────────────────────────────────────────────────────────────────
// Conversation thread — read messages / post replies for a ticket's
// Chatwoot conversation, powering the in-app ticket detail view.
// ──────────────────────────────────────────────────────────────────────

export type ChatMessage = {
  id: number
  content: string
  author: "customer" | "agent" | "system"
  createdAt: number // unix seconds (Chatwoot's `created_at`)
  senderName: string | null
}

// Chatwoot message_type: 0 incoming (customer), 1 outgoing (agent),
// 2 activity (system note), 3 template.
type CwMessage = {
  id: number
  content?: string | null
  message_type?: number
  created_at?: number
  sender?: { name?: string | null } | null
}

/**
 * Fetch the messages of a Chatwoot conversation, oldest first, normalized for
 * display. Returns [] if unconfigured or on any error (the detail view still
 * renders the locally-stored ticket).
 */
export async function getConversationMessages(conversationId: number): Promise<ChatMessage[]> {
  if (!chatwootConfigured()) return []
  try {
    const data = (await cwFetch(`/conversations/${conversationId}/messages`, {
      method: "GET",
    })) as { payload?: CwMessage[] }
    return (data.payload ?? [])
      .filter((m) => typeof m.content === "string" && m.content.trim().length > 0)
      .map<ChatMessage>((m) => ({
        id: m.id,
        content: m.content as string,
        author: m.message_type === 1 ? "agent" : m.message_type === 0 ? "customer" : "system",
        createdAt: m.created_at ?? 0,
        senderName: m.sender?.name ?? null,
      }))
      .sort((a, b) => a.createdAt - b.createdAt)
  } catch (err) {
    console.error("[chatwoot] getConversationMessages failed:", err)
    return []
  }
}

/**
 * Post a reply from the in-app user (the customer) into the conversation.
 * Returns true on success, false if unconfigured or the API call fails.
 */
export async function postConversationReply(
  conversationId: number,
  content: string,
): Promise<boolean> {
  if (!chatwootConfigured()) return false
  try {
    await cwFetch(`/conversations/${conversationId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content, message_type: "incoming" }),
    })
    return true
  } catch (err) {
    console.error("[chatwoot] postConversationReply failed:", err)
    return false
  }
}
