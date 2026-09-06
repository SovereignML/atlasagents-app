# Agent Control & Human-in-the-Loop (Atlas Agents App channel)

> **Status:** Design (not yet built). Target: let the **Atlas Agents mobile app** be the
> place a user approves/denies agent actions and answers agent questions — the same
> workflow OpenClaw & Hermes already do over Telegram, but **without requiring Telegram**.

Related: [`RUNTIMES.md`](RUNTIMES.md) (OpenClaw / Hermes), the Bot Factory fields in
[`src/db/schema.ts`](../src/db/schema.ts), the Telegram proxy
[`src/app/tg/[webhookId]/route.ts`](../src/app/tg/%5BwebhookId%5D/route.ts), and the
mobile bearer-token API (still in a WIP patch — see [Dependencies](#dependencies--sequencing)).

---

## 1. Goal

An agent running on a user's box sometimes needs a human: *"OK to buy this $40 domain?"*,
*"which of these two options?"*, *"paste the client's address."* Today the runtimes can ask
via a **Telegram bot**. We want the **Atlas Agents app** to be that surface — a native
approval/control channel — so a customer only needs our app, **not** a Telegram account.

Non-negotiables:

- **No Telegram dependency** for the end user.
- **No fork of the runtimes.** Reuse what OpenClaw & Hermes already do.
- Works **identically** for both runtimes.
- Two-way: agent → user (the ask) **and** user → agent (the answer), with the agent resuming.

---

## 2. How agent approval works today (Telegram)

Each agent (`instances` row) can own a Telegram bot — the **"Bot Factory"** fields in
[`src/db/schema.ts`](../src/db/schema.ts): `botToken`, `telegramBotTokenEnc`,
`telegramWebhookId`, `telegramWebhookSecretEnc`, `botHostId`.

- **Outbound (agent → user):** the runtime process, inside the container, calls the Telegram
  Bot API **directly** to message the user. The platform is *not* in this path.
- **Inbound (user → agent):** Telegram POSTs the reply to
  [`/tg/<telegramWebhookId>`](../src/app/tg/%5BwebhookId%5D/route.ts); the platform verifies the
  `X-Telegram-Bot-Api-Secret-Token`, looks up the instance, and **forwards the raw update** to the
  agent's own endpoint `http://<ip>:<containerPort>/telegram` with an `x-bot-token` header.
- **Provisioning:** [`interfaces/connect`](../src/app/api/instances/%5BinstanceId%5D/interfaces/connect/route.ts)
  validates the token (`getMe`), calls `setWebhook`, persists it encrypted, and
  `reprovisionBotEnv()` ([`src/lib/provisioner.ts`](../src/lib/provisioner.ts)) pushes the token
  into the container env (`BOT_TOKEN` / `TELEGRAM_BOT_TOKEN`).

**The approval brain lives in the runtime, which speaks the Telegram Bot protocol.**

---

## 3. The two runtimes' connection systems (researched)

Both runtimes talk to Telegram through a standard bot library, **default to long-polling
`getUpdates`**, and — critically — let you **override the Bot API base URL**. This is the hook
we exploit.

| | **OpenClaw** | **Hermes** (Nous Research) |
|---|---|---|
| Library | grammY (Node) + runner (per-chat sequencing) | python-telegram-bot (messaging gateway) |
| Default transport | **Long-poll `getUpdates`** (webhook optional) | **Long-poll `getUpdates`** (webhook optional) |
| Bot token config | `channels.telegram.botToken` | `TELEGRAM_BOT_TOKEN` env / gateway config |
| **Base-URL override** | **`channels.telegram.apiRoot`** (base only, no `/bot<token>`) | **`platforms.telegram.extra.base_url`** (+ `base_file_url`, `local_mode: true`) |
| DM gating | `dmPolicy: "pairing" \| "allowlist" \| "open"` | `telegram.allow_from` / `TELEGRAM_ALLOWED_USERS` |
| Buttons | inline keyboards + `callback_query` (callback_data routing) | inline keyboards + `callback_query` |
| Methods used | `getMe`, `sendMessage`, `editMessageText`, `answerCallbackQuery`, `setMyCommands`, `getUpdates`, `deleteWebhook`/`setWebhook`, `sendChatAction`, `setMessageReaction` | same core set |
| Config location | agent JSON config (rendered by `renderConfig()`) | `~/.hermes/config.yaml` / `~/.hermes/gateway.json` |

**Takeaway:** point `apiRoot` / `base_url` at **Atlas Agents** and implement the Bot API
methods above, and the agent will "talk to Telegram" — except Telegram is us, and the human is
the Atlas Agents app.

> Sources: OpenClaw docs (`docs.openclaw.ai/channels/telegram`, `/gateway/config-channels`;
> issue `openclaw/openclaw#28535` added `apiRoot`); Hermes docs
> (`hermes-agent.nousresearch.com/docs/user-guide/messaging/telegram`).

---

## 4. The design: Atlas Agents *is* the Bot API server

```
Agent (OpenClaw grammY / Hermes ptb)
  │  apiRoot / base_url  ->  https://app.atlasagents.dev/botapi
  │  botToken            ->  a Atlas Agents-issued SYNTHETIC token (maps to user+instance)
  │
  │  (a) long-polls getUpdates ───────────────►┐
  │  (b) sendMessage("Buy $40 domain?" + buttons)
  ▼                                            │
Atlas Agents backend  =  Telegram-compatible Bot API server (/botapi)
  ├─ records an AgentActionRequest (status=pending)
  ├─ notify()/FCM push ───────────────────────► Atlas Agents App  (approval inbox)
  │                                                     │  user taps Approve
  └─ enqueues a callback_query update  ◄────────────────┘  (POST /api/agents/../respond)
       returned on the agent's next getUpdates(a) → grammY/ptb routes callback_data → agent resumes
```

The agent is **oblivious**: it thinks it's using Telegram. We never touch runtime code — only
config (`apiRoot`/`base_url` + a synthetic token) pushed via `reprovisionBotEnv()`.

### Why "Atlas Agents as a fake Telegram" and not a brand-new channel

A native, non-Telegram channel would mean forking **both** grammY-based OpenClaw and
ptb-based Hermes. Impersonating the Bot API they *already* speak is a well-worn pattern
(Telegram ships a self-hostable "local Bot API server" for exactly this) and costs **zero**
runtime changes. If we later want real Telegram too, it still works — the agent can point at
real Telegram and us independently.

---

## 5. What we implement

### 5.1 The `/botapi` server (Bot-API-compatible)

Route: `POST|GET /botapi/bot<token>/<method>` (mirror Telegram's URL shape). `<token>` is the
**synthetic per-agent token**; resolve it → `(userId, instanceId)` (constant-time compare, like
the events ingest token). Minimum method surface (from §3):

| Method | Behavior in Atlas Agents |
|---|---|
| `getMe` | Return a synthetic bot `User` (id derived from the token) so the library validates on startup. |
| `getUpdates` | **Long-poll.** Block up to `timeout`s; return queued updates for this agent (the human's answers as `message` / `callback_query`). This is how answers reach the agent. |
| `sendMessage` | **The ask.** Parse text + `reply_markup.inline_keyboard`; create an `AgentActionRequest`; return a synthetic `Message` (with `message_id`); fire the notification + FCM push. |
| `editMessageText` / `editMessageReplyMarkup` | Update the stored request (e.g. strip buttons once answered / stream edits). |
| `answerCallbackQuery` | Ack the button press (no-op toast); mark delivery. |
| `setMyCommands`, `deleteWebhook`, `setWebhook`, `sendChatAction`, `setMessageReaction` | Accept + `{ ok: true }` (no-ops or lightweight state) so the library's startup/among-turn calls succeed. |
| `getFile` / file paths (Hermes `base_file_url`) | Phase 2 — only needed for media approvals; text+buttons don't require it. |

All responses use Telegram's envelope: `{ "ok": true, "result": ... }`.

### 5.2 Update injection (the answer → agent)

When the user responds in the app, enqueue a Telegram-shaped **`callback_query`** update
(carrying the original button's `callback_data`) — or a `message` update for free-text answers —
onto that agent's queue. The agent's next `getUpdates` long-poll drains it. This mirrors exactly
what [`/tg/<webhookId>`](../src/app/tg/%5BwebhookId%5D/route.ts) does today, minus real Telegram.
(If an agent is ever configured in **webhook** mode instead, POST the update to its
`/telegram` endpoint instead — support both.)

### 5.3 Data model (new)

- **`agentActionRequests`** — `id`, `instanceId`, `userId`, `chatId` (synthetic), `messageId`,
  `type` (`approval` | `choice` | `input`), `text`, `buttons` (jsonb: label + callback_data),
  `status` (`pending` | `answered` | `expired`), `response` (jsonb), `createdAt`, `answeredAt`,
  `expiresAt`.
- **`agentUpdateQueue`** — pending Bot-API updates per instance awaiting `getUpdates` drain
  (`id`, `instanceId`, `updateId`, `payload` jsonb, `createdAt`). (Or reuse a lightweight table +
  `update_id` cursor.)
- **`pushTokens`** — `userId`, `token`, `platform` (`ios` | `android`), `lastSeenAt` (for FCM).
- **Synthetic bot token** — reuse the encrypted per-agent secret pattern
  (`telegramBotTokenEnc` style) or a dedicated `appChannelTokenEnc` column on `instances`.

### 5.4 Mobile & notification surface

- **FCM push** (chosen: Firebase, both platforms): new `deliverPush()` channel in
  [`src/lib/notifications/channels/`](../src/lib/notifications/channels), a `push` entry in the
  channel enum ([`src/lib/notifications/types.ts`](../src/lib/notifications/types.ts)), and a new
  **`actions`** category (default **on** for `inApp` + `push` — approvals must not be silently
  muted). Backend uses Firebase Admin (HTTP v1) keyed by `FCM_SERVICE_ACCOUNT`.
- **Mobile endpoints** (bearer-token API):
  - `POST /api/mobile/push-tokens` — register/refresh the device FCM token on login.
  - `GET  /api/agents/:instanceId/requests?status=pending` — the approval inbox.
  - `POST /api/agents/:instanceId/requests/:reqId/respond` — `{ decision, value? }`. ACL:
    **Operator+** via `canOperateInstance()` ([`src/lib/instance-access.ts`](../src/lib/instance-access.ts)).
- **Mobile UI** (`sovereignml-mobile`): an "Awaiting your approval" inbox + per-request
  Approve / Deny / reply, plus a badge fed by push.

---

## 6. The wait model (recommended)

**Block at the tool level, with a timeout + safe default** — *not* whole-agent suspend/resume.

The wait lives inside the agent's own "ask the human" turn: after `sendMessage`, the runtime
**long-polls `getUpdates`** waiting for the answer (this is already how both runtimes behave).
We bound it: if no response within `expiresAt` (default ~15 min, configurable to hours), the
request goes `expired` and we inject a **safe-default** answer (deny/skip). This gives real
gate-keeping (a purchase can't proceed without an explicit yes) with **no** need to serialize and
rehydrate an agent across restarts — which neither runtime is built to do. Add
"continue-with-other-work" semantics later only if a use case demands it.

---

## 7. Provisioning changes

Extend `reprovisionBotEnv()` / the runtime `renderConfig()` to write, per agent:

- **OpenClaw:** `channels.telegram.apiRoot = "https://app.atlasagents.dev/botapi"`,
  `channels.telegram.botToken = <synthetic>`, `dmPolicy` = open/pairing as desired.
- **Hermes:** `platforms.telegram.extra.base_url = "https://app.atlasagents.dev/botapi/bot"`
  (+ `base_file_url` when media is added), `TELEGRAM_BOT_TOKEN = <synthetic>`.

No new container image needed — this is config only (verify exact JSON/YAML shape against the
`sovereign-bot-runtime` image's config renderers in
[`src/lib/runtimes/openclaw.ts`](../src/lib/runtimes/openclaw.ts) /
[`hermes.ts`](../src/lib/runtimes/hermes.ts)).

---

## 8. Security

- **Synthetic token = the agent's credential to `/botapi`.** Encrypted at rest; constant-time
  compare; a leak scopes to one agent (same blast radius as the events ingest token).
- **ACL on responses:** only **Operator+** on the instance may approve
  (`canOperateInstance`); viewers can watch, not decide.
- **No secrets to the app repo / no Telegram PII.** The synthetic token never leaves our infra;
  the mobile app only holds its user bearer token.
- Rate-limit `getUpdates` long-polls per agent; cap queue depth.

---

## 9. Dependencies & sequencing

1. **Land the mobile bearer-token API** (`/api/auth/mobile/*`) — currently only in the WIP patch
   `_backups/app-api-worktree-wip.patch`, **not on `main`**. Everything mobile rides on this.
2. **Core loop:** `agentActionRequests` + `agentUpdateQueue` tables → the `/botapi` server
   (`getMe`, `getUpdates`, `sendMessage`, `answerCallbackQuery`, edits) → update injection.
3. **Provisioning:** wire `apiRoot`/`base_url` + synthetic token via `reprovisionBotEnv()`.
4. **FCM push** channel + `pushTokens` + mobile registration.
5. **Mobile UI:** approval inbox + respond.
6. **(Optional)** keep real Telegram as a parallel channel.

---

## 10. Open questions

- Exact JSON/YAML config shape the `sovereign-bot-runtime` image expects for `apiRoot` /
  `base_url` (confirm against the image's runtime config, not just upstream docs).
- Do we need `getFile`/`base_file_url` (media in approvals) in v1, or defer?
- One synthetic bot per agent, or one per (agent × user) for multi-seat teams?
- Group/thread semantics — `chatId` mapping when a team shares an agent.

---

## References

- OpenClaw Telegram channel & `apiRoot`: `docs.openclaw.ai/channels/telegram`,
  `docs.openclaw.ai/gateway/config-channels`, `github.com/openclaw/openclaw` (issue #28535).
- Hermes messaging gateway & `base_url`: `github.com/NousResearch/hermes-agent`,
  `hermes-agent.nousresearch.com/docs/user-guide/messaging/telegram`.
- Telegram Bot API (method contracts / update shapes): `core.telegram.org/bots/api`.
- In-repo: [`RUNTIMES.md`](RUNTIMES.md), [`src/app/tg/[webhookId]/route.ts`](../src/app/tg/%5BwebhookId%5D/route.ts),
  [`src/lib/provisioner.ts`](../src/lib/provisioner.ts),
  [`src/lib/notifications/`](../src/lib/notifications).
