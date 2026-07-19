// Chatwoot integration — server-side helpers.
//
// Every helper takes a resolved `ChatwootConfig` so the SAME code serves two
// cases:
//   • the platform Chatwoot (env config) for normal customers, and
//   • a white-label tenant's OWN Chatwoot (bring-your-own creds, stored
//     encrypted on tenantConfig) for that tenant's end-customers.
// Resolve which one applies with `resolveChatwootForTeam(teamId)`.
//
// Everything degrades gracefully: with no usable config the helpers no-op
// (return skipped/null/false/[]) so callers fall back to email.

import { createHmac } from "node:crypto"
import { decryptSecret } from "./crypto-secret"
import { getTenantForTeam, getTenantConfig } from "./tenant"
import { assertPublicHost } from "@/lib/net-guard"

/** Everything needed to talk to one Chatwoot account/inbox via the API. */
export type ChatwootConfig = {
  baseUrl: string
  apiToken: string
  accountId: string
  inboxId: string
  hmacToken: string | null
  /** True when the base URL came from a tenant-admin (untrusted) config row,
   * so `cwFetch` must SSRF-guard the host before each outbound request. */
  tenantSourced?: boolean
}

/** Public config the live-chat widget needs (no secrets). */
export type ChatwootWidgetConfig = { baseUrl: string; websiteToken: string }

/** Platform-wide Chatwoot from env, or null if not fully configured. */
export function platformChatwootConfig(): ChatwootConfig | null {
  const baseUrl = process.env.NEXT_PUBLIC_CHATWOOT_BASE_URL?.replace(/\/$/, "")
  const apiToken = process.env.CHATWOOT_API_ACCESS_TOKEN
  const accountId = process.env.CHATWOOT_ACCOUNT_ID
  const inboxId = process.env.CHATWOOT_INBOX_ID
  if (!baseUrl || !apiToken || !accountId || !inboxId) return null
  return {
    baseUrl,
    apiToken,
    accountId,
    inboxId,
    hmacToken: process.env.CHATWOOT_HMAC_TOKEN || null,
  }
}

function platformWidgetConfig(): ChatwootWidgetConfig | null {
  const baseUrl = process.env.NEXT_PUBLIC_CHATWOOT_BASE_URL?.replace(/\/$/, "")
  const websiteToken = process.env.NEXT_PUBLIC_CHATWOOT_WEBSITE_TOKEN
  if (!baseUrl || !websiteToken) return null
  return { baseUrl, websiteToken }
}

/**
 * The Chatwoot a given team's tickets should use: the team's parent tenant's
 * BYO Chatwoot when fully configured, otherwise the platform Chatwoot, otherwise
 * null (caller falls back to email).
 */
export async function resolveChatwootForTeam(
  teamId: string | null | undefined,
): Promise<ChatwootConfig | null> {
  if (teamId) {
    const tenantId = await getTenantForTeam(teamId)
    if (tenantId) {
      const cfg = await getTenantConfig(tenantId)
      if (
        cfg?.chatwootBaseUrl &&
        cfg.chatwootApiTokenEnc &&
        cfg.chatwootAccountId &&
        cfg.chatwootInboxId
      ) {
        return {
          baseUrl: cfg.chatwootBaseUrl.replace(/\/$/, ""),
          apiToken: decryptSecret(cfg.chatwootApiTokenEnc),
          accountId: cfg.chatwootAccountId,
          inboxId: cfg.chatwootInboxId,
          hmacToken: cfg.chatwootHmacTokenEnc ? decryptSecret(cfg.chatwootHmacTokenEnc) : null,
          tenantSourced: true,
        }
      }
    }
  }
  return platformChatwootConfig()
}

/**
 * A tenant's OWN Chatwoot config, or null — NEVER the platform fallback. Use
 * this for the reseller (tenant-admin) agent-facing surfaces: the support inbox
 * and conversation actions. `resolveChatwootForTeam`'s platform fallback is
 * correct for CUSTOMER ticket creation (graceful degradation), but on the
 * tenant-admin side it would point the reseller's inbox at the PLATFORM's
 * Chatwoot account — exposing (and letting them reply to / resolve) every
 * platform customer's conversations. A tenant without their own Chatwoot must
 * simply see an empty, unconfigured inbox.
 *
 * `tenantTeamId` is the tenant's own team id (the reseller), not a child team.
 */
export async function resolveTenantChatwootOrNull(
  tenantTeamId: string,
): Promise<ChatwootConfig | null> {
  const cfg = await getTenantConfig(tenantTeamId)
  if (
    cfg?.chatwootBaseUrl &&
    cfg.chatwootApiTokenEnc &&
    cfg.chatwootAccountId &&
    cfg.chatwootInboxId
  ) {
    return {
      baseUrl: cfg.chatwootBaseUrl.replace(/\/$/, ""),
      apiToken: decryptSecret(cfg.chatwootApiTokenEnc),
      accountId: cfg.chatwootAccountId,
      inboxId: cfg.chatwootInboxId,
      hmacToken: cfg.chatwootHmacTokenEnc ? decryptSecret(cfg.chatwootHmacTokenEnc) : null,
      tenantSourced: true,
    }
  }
  return null
}

/** Widget (public) config for a team: tenant's if set, else platform. */
export async function resolveChatwootWidgetForTeam(
  teamId: string | null | undefined,
): Promise<ChatwootWidgetConfig | null> {
  if (teamId) {
    const tenantId = await getTenantForTeam(teamId)
    if (tenantId) {
      const cfg = await getTenantConfig(tenantId)
      if (cfg?.chatwootBaseUrl && cfg.chatwootWebsiteToken) {
        return {
          baseUrl: cfg.chatwootBaseUrl.replace(/\/$/, ""),
          websiteToken: cfg.chatwootWebsiteToken,
        }
      }
    }
  }
  return platformWidgetConfig()
}

/** True when `cfg` is usable (non-null). */
export function chatwootConfigured(cfg: ChatwootConfig | null): cfg is ChatwootConfig {
  return Boolean(cfg)
}

/**
 * HMAC-SHA256 of the user identifier, keyed by the config's HMAC token. The
 * widget passes this as `identifier_hash` so Chatwoot trusts the identity.
 * Returns null when no HMAC token is configured (identity validation off).
 */
export function chatwootIdentifierHash(
  cfg: ChatwootConfig | null,
  identifier: string,
): string | null {
  if (!cfg?.hmacToken) return null
  return createHmac("sha256", cfg.hmacToken).update(identifier).digest("hex")
}

type ContactInbox = { source_id: string; inbox?: { id: number } }
type SearchContact = { id: number; email?: string | null; contact_inboxes?: ContactInbox[] }

async function cwFetch(cfg: ChatwootConfig, path: string, init: RequestInit): Promise<unknown> {
  if (cfg.tenantSourced) {
    const url = new URL(cfg.baseUrl)
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error(`Chatwoot base URL has unsupported protocol: ${url.protocol}`)
    }
    await assertPublicHost(url.hostname)
  }
  const res = await fetch(`${cfg.baseUrl}/api/v1/accounts/${cfg.accountId}${path}`, {
    ...init,
    // Fail fast: a slow/unreachable Chatwoot host must not hang the request
    // that's awaiting it (the in-app ticket POST). Aborts after 10s.
    signal: AbortSignal.timeout(10_000),
    headers: {
      "Content-Type": "application/json",
      // Hyphenated on purpose: nginx drops underscore headers by default
      // (underscores_in_headers off), and Rails normalizes both spellings
      // to the same key — so this reaches Chatwoot through any proxy.
      "api-access-token": cfg.apiToken,
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
export async function createSupportConversation(
  cfg: ChatwootConfig | null,
  args: {
    userId: string
    name: string
    email: string
    subject: string
    message: string
    priority: string
  },
): Promise<CreateConversationResult> {
  if (!cfg) return { status: "skipped" }
  const inbox = Number(cfg.inboxId)

  try {
    let contactId: number | null = null
    let sourceId: string | null = null

    // 1. Reuse an existing contact for this email if one exists.
    const search = (await cwFetch(cfg, `/contacts/search?q=${encodeURIComponent(args.email)}`, {
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
      const created = (await cwFetch(cfg, `/contacts`, {
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
      const ci = (await cwFetch(cfg, `/contacts/${contactId}/contact_inboxes`, {
        method: "POST",
        body: JSON.stringify({ inbox_id: inbox }),
      })) as { source_id?: string; payload?: { source_id?: string } }
      sourceId = ci.source_id ?? ci.payload?.source_id ?? null
    }
    if (!sourceId) throw new Error("no source_id for inbox")

    const content = `**${args.subject}**\n\n${args.message}`

    // 4. Open the conversation AND seed its first (incoming) message in one
    //    atomic call. Posting the message separately (the previous approach)
    //    could leave an empty conversation shell in the inbox if that second
    //    call failed — `message` inline avoids that entirely.
    const conversation = (await cwFetch(cfg, `/conversations`, {
      method: "POST",
      body: JSON.stringify({
        source_id: sourceId,
        inbox_id: inbox,
        contact_id: contactId,
        additional_attributes: { priority: args.priority, subject: args.subject },
        message: { content },
      }),
    })) as { id?: number }
    const conversationId = conversation.id
    if (!conversationId) throw new Error("no conversation id returned")

    // 5. Belt-and-suspenders: confirm the message actually landed. Chatwoot
    //    creates the inline message synchronously, so this GET reliably sees
    //    it and the fallback POST only fires if the seed genuinely failed —
    //    no duplicate in the normal path.
    const seeded = await getConversationMessages(cfg, conversationId)
    const hasBody = seeded.some((m) => m.content.trim().length > 0)
    if (!hasBody) {
      await cwFetch(cfg, `/conversations/${conversationId}/messages`, {
        method: "POST",
        body: JSON.stringify({ content, message_type: "incoming" }),
      })
    }

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
export async function getConversationMessages(
  cfg: ChatwootConfig | null,
  conversationId: number,
): Promise<ChatMessage[]> {
  if (!cfg) return []
  try {
    const data = (await cwFetch(cfg, `/conversations/${conversationId}/messages`, {
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
  cfg: ChatwootConfig | null,
  conversationId: number,
  content: string,
): Promise<boolean> {
  if (!cfg) return false
  try {
    await cwFetch(cfg, `/conversations/${conversationId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content, message_type: "incoming" }),
    })
    return true
  } catch (err) {
    console.error("[chatwoot] postConversationReply failed:", err)
    return false
  }
}

/**
 * Post a reply as the AGENT (outgoing) — used by the tenant support inbox where
 * the tenant answers their own end-customers. Returns true on success.
 */
export async function postAgentReply(
  cfg: ChatwootConfig | null,
  conversationId: number,
  content: string,
): Promise<boolean> {
  if (!cfg) return false
  try {
    await cwFetch(cfg, `/conversations/${conversationId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content, message_type: "outgoing" }),
    })
    return true
  } catch (err) {
    console.error("[chatwoot] postAgentReply failed:", err)
    return false
  }
}

/** Live conversation state used to drive the in-app ticket status badge. */
export type ConversationState = {
  status: string // open | resolved | pending | snoozed
  assigneeName: string | null
}

type CwConversation = {
  status?: string | null
  meta?: { assignee?: { name?: string | null } | null } | null
}

/**
 * Read a conversation's status and assigned agent so the customer can see
 * whether their ticket is being handled. Returns null if unconfigured or on
 * any error (the detail view then keeps the locally-stored status).
 */
export async function getConversation(
  cfg: ChatwootConfig | null,
  conversationId: number,
): Promise<ConversationState | null> {
  if (!cfg) return null
  try {
    const data = (await cwFetch(cfg, `/conversations/${conversationId}`, {
      method: "GET",
    })) as CwConversation
    return {
      status: typeof data.status === "string" ? data.status : "open",
      assigneeName: data.meta?.assignee?.name ?? null,
    }
  } catch (err) {
    console.error("[chatwoot] getConversation failed:", err)
    return null
  }
}

/**
 * Resolve or reopen the conversation so admins see the customer's action in
 * Chatwoot. Returns true on success, false if unconfigured or the call fails.
 */
export async function setConversationStatus(
  cfg: ChatwootConfig | null,
  conversationId: number,
  status: "resolved" | "open",
): Promise<boolean> {
  if (!cfg) return false
  try {
    await cwFetch(cfg, `/conversations/${conversationId}/toggle_status`, {
      method: "POST",
      body: JSON.stringify({ status }),
    })
    return true
  } catch (err) {
    console.error("[chatwoot] setConversationStatus failed:", err)
    return false
  }
}

// ──────────────────────────────────────────────────────────────────────
// Tenant support inbox — list conversations for the agent-facing view.
// ──────────────────────────────────────────────────────────────────────

export type ChatConversation = {
  id: number
  status: string
  contactName: string | null
  subject: string | null
  updatedAt: number
}

type CwListConversation = {
  id: number
  status?: string | null
  additional_attributes?: { subject?: string | null } | null
  meta?: { sender?: { name?: string | null } | null } | null
  timestamp?: number | null
  last_activity_at?: number | null
}

/**
 * List conversations in the config's inbox (newest activity first), for the
 * tenant support inbox. Returns [] if unconfigured or on error.
 */
export async function listConversations(
  cfg: ChatwootConfig | null,
  opts?: { status?: "open" | "resolved" | "pending" | "all" },
): Promise<ChatConversation[]> {
  if (!cfg) return []
  const status = opts?.status ?? "open"
  try {
    const data = (await cwFetch(
      cfg,
      `/conversations?inbox_id=${encodeURIComponent(cfg.inboxId)}&status=${status}`,
      { method: "GET" },
    )) as { data?: { payload?: CwListConversation[] }; payload?: CwListConversation[] }
    const payload = data.data?.payload ?? data.payload ?? []
    return payload
      .map<ChatConversation>((c) => ({
        id: c.id,
        status: typeof c.status === "string" ? c.status : "open",
        contactName: c.meta?.sender?.name ?? null,
        subject: c.additional_attributes?.subject ?? null,
        updatedAt: c.last_activity_at ?? c.timestamp ?? 0,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  } catch (err) {
    console.error("[chatwoot] listConversations failed:", err)
    return []
  }
}
