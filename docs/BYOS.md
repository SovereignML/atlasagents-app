# Bring Your Own Server (BYOS)

> Atlas Agents as a pure management panel for a server **you already own**. We don't provision or bill for the box — we install, run, monitor, and configure agents on it for a flat fee per agent.

BYOS is the answer to "I already have a VPS / dedicated box / homelab machine — can you just run the agent on it?" Yes. You keep ownership and control of the hardware; Atlas Agents connects over SSH and treats it like any other managed instance (logs, restart, config, backups), minus the compute billing.

Related: [BILLING.md](BILLING.md) (the credit-metered LLM mode), [RUNTIMES.md](RUNTIMES.md) (what actually gets installed), [INTEGRATIONS.md](INTEGRATIONS.md) (Drive backups / Cloudflare domains work on BYOS instances too).

---

## What it does (for users)

From **Dashboard → Bring Your Own Server** (`/dashboard/byos`) there are two independent things, and neither needs the other:

- **Servers.** Connect as many as you like, for free (`/dashboard/byos/connect`). The page shows the platform's **fleet public key** (`SSH_FLEET_PUBLIC_KEY`); paste that one line into the `authorized_keys` of the SSH user on your server, then enter host/IP, SSH port (default `22`) and SSH user (default `root`). No agent or daemon to install yourself, and no plan needed.
- **BYOS plans.** One plan runs **one agent**, on any of your servers. Buy as many as you like, whenever you like, with zero servers connected; a plan nobody is using yet is **available** and waits for your next install. Cancel any one of them at any time.

To **install an agent**, pick a connected server and fill in the wizard (runtime, and how its LLM calls are paid for — see [LLM modes](#llm-modes)). The install button then:

- **uses one of your available plans** and installs straight away, or
- if none is available, says **Continue to payment**: you pay for a new plan at Stripe, and the agent installs as soon as that's done. Back out of Checkout and nothing is installed — the waiting agent is removed.

**No plan, no agent:** nothing is installed, and there is no agent dashboard, until the agent's plan is paid for. Deleting an agent frees its plan for the next one (it keeps billing until you cancel it).

Once connected, the server appears as a normal instance: open it at `/dashboard/instances/[id]` for status, logs, restart, credentials, backups, and a custom domain.

### Pricing

BYOS is its own plan (`byos` in [`src/configs/plans.ts`](../src/configs/plans.ts)):

| | Price |
|---|---|
| Monthly | **$2.50/mo** per agent |
| Yearly | **$30/yr** per agent |

This is a flat **management-panel fee only**, charged per plan — one plan per agent. Connected servers cost nothing. Because Atlas Agents doesn't own the hardware, there is **no compute/VM billing** — unlike the managed-VPS plans, where the server size is part of the price. LLM usage is billed separately and only in `managed_credits` mode (below).

The first `managed_credits` agent on a plan adds a **one-time grant of 100 AI credits** (once per plan, claimed as `byos_signup_grant:<subscription id>` by whichever path installs that agent) (`BYOS_SIGNUP_CREDITS` in [`src/configs/plans.ts`](../src/configs/plans.ts)); a plan reused after its agent is deleted grants nothing more. After that, top up your wallet as needed. `own_key` agents get no grant because they pay their provider directly.

### LLM modes

When you connect a server you pick one of two ways to pay for the agent's model calls:

| Mode | What it means | Who pays the LLM bill |
|------|---------------|-----------------------|
| **`managed_credits`** (pay-as-you-go) | The agent uses Atlas Agents's OpenRouter access. Usage is metered against your **credit wallet**. | Your Atlas Agents credits — see [BILLING.md](BILLING.md). |
| **`own_key`** | You paste your **own** LLM provider API key. It's encrypted at rest and injected into the agent. | You, directly to your provider. Atlas Agents never meters it. |

With `own_key` you pay only the agent's $2.50/mo plan; with `managed_credits` the plan's first such agent brings 100 starter credits, and usage then draws down your wallet.

---

## How it works (for developers)

### No VM is created

The defining difference from the managed-VPS path: **no provider VM is allocated**. The flow in [`src/app/api/byos/deploy/route.ts`](../src/app/api/byos/deploy/route.ts):

- The user pastes `SSH_FLEET_PUBLIC_KEY` into their own root `authorized_keys`; the control plane connects with the matching `SSH_FLEET_PRIVATE_KEY`. The fleet public key is intentionally surfaced in the UI — it's public key material. This happens once, when the server is **connected** (`/dashboard/byos/connect`), not per agent: by install time we already have SSH and the measured hardware.
- To satisfy the `instances` foreign keys without a real DigitalOcean/Linode plan, the row points at a **sentinel** server config (`byos-managed`) and a **`self-hosted`** region (falling back to the first region if the BYOS seed hasn't run). These are placeholders, not billable compute.
- `provisionBot()` ([`src/lib/provisioner.ts`](../src/lib/provisioner.ts)) then runs the normal install over SSH against the user's host — same runtime install as a managed instance (see [RUNTIMES.md](RUNTIMES.md)).

### Prebake at connect ([`src/lib/byos-prebake.ts`](../src/lib/byos-prebake.ts))

> **Off unless `BYOS_PREBAKE_ENABLED=true`.** Two product questions in plan 007
> are open: which engine is the default (the prebake favours Hermes while the
> deploy wizard defaults to OpenClaw), and the terms wording for preinstalling
> on a customer's server. With the flag off, the connect form shows no consent
> checkbox, nothing runs, and the BYOS deploy script is unchanged.
>
> Wired in [`byos-prebake-job.ts`](../src/lib/byos-prebake-job.ts): the connect
> form records consent, `POST /api/byos/servers` schedules `runPrebake()` with
> `after()` once the response is sent, and `provisionByosBot()` calls
> `checkPrebakedServer()` before the bootstrap. Prebake and deploy share an
> `flock` on `/var/lock/atlas-install.lock`: the prebake gives up if anything
> else is installing, and a deploy waits up to 10 minutes for a running
> prebake.

A BYOS box gets no warm pool and no golden image, so historically every deploy
built from scratch inside the window the customer sat watching — an estimated
6–10 minutes for OpenClaw and 10–15 for Hermes with its old chat UI (Open
WebUI, since replaced by the much smaller AgentWebUI Lite).

Work that does **not** depend on which engine they eventually pick now runs in
the background as soon as the server is connected:

| | at connect | at deploy |
|---|---|---|
| apt, Caddy, Node, swap, both runtimes' accounts | installed | no-ops |
| `hermes-agent` | installed, its CLI warmed | restart only |
| chat UI (AgentWebUI Lite) | — | installed (one small package, seconds) |
| `openclaw` | **downloaded into the npm cache only** | installed from cache |
| config, secrets, systemd, health checks, DNS | — | per-instance, always |

OpenClaw is the genuine either/or, and its 225MB / 11,428-file *extract* is what
makes it expensive, so only the download moves. Hermes is installed outright,
which is what makes a Hermes deploy faster than an OpenClaw one. The chat UI is
small enough to install at deploy.

**Consent is required and is not implied by connecting.** The preflight is
read-only and unprivileged by design; prebake is the moment that stops being
true, so it runs only against a recorded `byosServers.prebakeConsentAt`.

**A box already serving the web is skipped, not prebaked.** The preflight
deliberately does not block on a busy `:443`, an existing Caddyfile, nginx or
apache — it surfaces them and tells the owner they are their call. Installing
Caddy in the background moments later would answer that call for them, so those
servers defer everything to deploy time, where the customer has just asked for
it. Tight disk skips too (deploying still works, it is just slower).

**`prebakeStatus` is for the UI, never for control flow.** The deploy re-runs
the full bootstrap regardless and relies on its idempotency; a separate probe
(`PREBAKE_VERIFY_SCRIPT` + `prebakeUsability()`) reports what is actually on the
box. A customer can `apt remove caddy` or rebuild the machine behind the same
IP, and a deploy that trusted a stale flag would produce a broken agent instead
of a slow one.

### The platform never owns the machine

`deploymentTarget === "byos"` means the host belongs to the customer, and two
lifecycle rules follow from it:

- **BYOS never touches the warm pool.** `provisionBotLocked()` routes `byos` to
  `provisionByosBot()`, which has no VM lifecycle at all — it never creates,
  claims or deletes a machine. The warm pool's failure mode is a create → fail →
  destroy loop, which costs a wasted bill against a pool VM and would be
  destroying someone's hardware here. The routing is the guarantee;
  `acquireBootedVm()` additionally **throws** for a non-platform-owned target
  (`platformOwnsHostVm()` in [`src/lib/byos-install.ts`](../src/lib/byos-install.ts))
  so a future refactor of that routing fails loudly instead of silently.
- **Teardown is an uninstall, not a delete.** Deleting a BYOS agent stops and
  disables the systemd unit and removes the install dir over SSH, then marks the
  instance deleted. The server stays online. There is no `deleteVM` on this path.

A failed BYOS install is also terminal rather than looping: the instance is
marked `failed_provisioning`, `collectDiagnostics()` writes the evidence to
`InstanceLog`, and a retry is an explicit user action. Nothing re-attempts on a
timer, and nothing is destroyed.

### Impersonation

Every BYOS route resolves identity through `getEffectiveTeam()`
([`src/lib/effective-user.ts`](../src/lib/effective-user.ts)), matching
`/api/deploy`. An admin (or a tenant admin acting as a child team) can connect,
refresh, disconnect and install on the customer's behalf, and:

- the server row and the agent are owned by **`effectiveUserId`** — the customer
  — and land in the customer's **`teamId`**;
- the Stripe customer, its email, the checkout metadata and the credit wallet
  are all the customer's;
- the audit trail records the real admin as **`actorUserId`**, with
  `meta.onBehalfOf` naming the customer.

The BYOS *pages* resolve the same way, so the wizard and the route it posts to
always agree on the team. This matters under "act as customer", where the team is
pinned to the cookie's child team rather than that owner's mutable
`activeTeamId` — `getUserTeam(effectiveUserId)` would resolve a different team
than the route writes to.

Note that Checkout still opens against the **customer's** Stripe customer, so an
admin cannot complete a paid BYOS install without the customer's payment method.

### Billing path ([`src/lib/byos-plan.ts`](../src/lib/byos-plan.ts))

A plan belongs to **one agent**, never to a server. A plan is a `Subscription` on the `byos` plan that is either **available** (`instanceId` NULL) or **assigned** (`instanceId` set).

- **Buying ahead.** `POST /api/byos/plans` opens a recurring Stripe Checkout (`mode: "subscription"`, `metadata.type = "byos_plan"`, no server). `handleByosPlanCheckout` records an available plan. In dev mode without Stripe it writes an active available plan directly.
- **Installing.** `POST /api/byos/deploy` inserts the agent `pending`, then `byosInstallPath()` ([`byos-install.ts`](../src/lib/byos-install.ts)) picks how it is covered:
  - a grandfathered per-server plan on that server (below) — install now;
  - else `claimAvailableByosPlan()` — one atomic `UPDATE … FOR UPDATE SKIP LOCKED`, so two installs can't take the same plan — install now;
  - else **Checkout**: a session carrying the agent's `instanceId` (no `type`). `handlePaidSubscriptionCheckout` — the managed pay-then-provision path — records the plan against that agent and provisions it. `recoverPaidCheckout` covers a late webhook from the agent page (the session's `success_url`).
  - A plan in `past_due` is never handed to a new install.
- **Unpaid installs.** Backing out of Checkout returns to the install page with `?abandoned=<id>`, which soft-deletes that agent (`discardUnpaidByosInstall`). The 60s background sweep removes any left `pending` with no plan after 25h (`reapUnpaidByosInstalls`), since a Checkout Session can't be paid after 24h. A payment that lands for an agent already removed is recorded as an available plan.
- **Webhook recovery.** Plans bought ahead are recovered by `recoverByosPlanCheckouts(userId)` (called from `/dashboard/byos?plan=bought`, the success URL, and from the install route) and by the 60s sweep. All paths share the `stripe_checkout:<session id>` claim.
- **Deleting an agent frees its plan** (`releaseByosPlan`) instead of cancelling it in Stripe. The next install takes it.
- **Ending a plan.** Cancel from `/dashboard/byos` (`PATCH /api/byos/plans/[subscriptionId]`, `{ "cancelAtPeriodEnd": true }`, reversible until the period ends) or from the Stripe billing portal. A cancel takes effect at period end, so the agent runs through every month that was paid for. On `customer.subscription.deleted` the plan's agent is **stopped** (`pauseBot` — systemd stop, nothing deleted) by `stopUncoveredByosAgents`. There is no wallet fallback for BYOS. Restarting a stopped agent takes an available plan if the owner has one, and is otherwise refused (`402`).
- **Disconnecting a server** is never blocked by per-agent plans — only by agents still on it (and by a grandfathered per-server plan that will renew).
- **Legacy per-server plans.** Between PR #19 and per-agent plans, a plan was bought per server (`Subscription.byosServerId`) and covered every agent on it. Those rows are grandfathered: they keep covering their server until they end, are never handed out as available plans, and their end stops only the server's agents that have no plan of their own. Older per-agent rows (from before #19) are assigned plans, and they keep #19's rule too: an agent that has never had a plan of its own (installed under #19 on the strength of such a row) is covered while any live plan sits on another agent on its server. An agent that once had its own plan never falls back this way, because its ended row stays pointed at it. When any plan ends, every agent on its server is re-checked (`byosAgentIsCovered`). This is all in code, so moving to per-agent plans needed no data migration.

### Instance columns (on the `instances` table)

| Column | Meaning |
|--------|---------|
| `deploymentTarget` | Set to `"byos"` — this is how BYOS instances are filtered in the dashboard. |
| `byosServerId` | FK to the connected `ByosServer` this agent runs on. The link of record: `agentCount`, the idle-server cap and the disconnect guard all read it. |
| `byosHost` | The user's server hostname/IP. Denormalized from the server row. |
| `byosPort` | SSH port. Denormalized from the server row. |
| `byosUser` | SSH user. Denormalized from the server row. |
| `byosLlmMode` | `"managed_credits"` or `"own_key"`. |
| `byosOwnApiKeyEnc` | The user's own API key, encrypted via `encryptSecret()` — only set when `byosLlmMode === "own_key"`. |

### API

```
POST /api/byos/plans                      { "interval": "month" | "year" }   → { checkoutUrl } (dev: { ok })
PATCH /api/byos/plans/[subscriptionId]    { "cancelAtPeriodEnd": boolean }  → { status, currentPeriodEnd, cancelAtPeriodEnd }
POST /api/byos/deploy
```
Auth: user session, resolved through `getEffectiveTeam()` (see
[Impersonation](#impersonation)). Plans are owned by the effective user. Deploy body:

```jsonc
{
  "name": "my-agent",
  "byosServerId": "clx...",   // a connected server
  "llmMode": "managed_credits", // or "own_key"
  "ownApiKey": "sk-...",      // required iff llmMode === "own_key"
  "interval": "month",        // only used when no plan is available and this install buys one
  "agentConfig": { /* optional; deployment_target is forced to "byos" */ }
}
```
Returns `{ instanceId }` when a plan covered it and provisioning has started, or `{ instanceId, checkoutUrl }` when the agent's plan has to be paid for first — send the customer to `checkoutUrl`; the agent installs once it is paid.

**The host is not a parameter.** Connect the server first (`POST /api/byos/servers`), then install onto it by id. The connection — host, port, SSH user — is read off the `ByosServer` row, so an agent can only ever land on a machine this team has connected and we have proven SSH access to. Passing a host here is rejected with `Missing required fields (name, byosServerId)`.

| Status | Meaning |
|--------|---------|
| `404` | The `byosServerId` isn't connected to the caller's team. |
| `409` | The server's last probe found it unreachable — refresh it and retry. |
| `503` | Stripe isn't configured outside development, so a plan can't be bought. |

### Required environment

BYOS deploys preflight these and return `503` if any are missing:

| Env var | Why |
|---------|-----|
| `SSH_FLEET_PUBLIC_KEY` | Surfaced to the user to paste into their server. |
| `SSH_FLEET_PRIVATE_KEY` | Used to connect to the user's server. |
| `INSTANCE_ENCRYPTION_KEY` | Encrypts the gateway token, admin password, and the optional own API key. |

Optional: `BYOS_PREBAKE_ENABLED=true` turns on the connect-time prebake (above).

BYOS deliberately does **not** require `OPENROUTER_API_KEY`: `managed_credits` instances mint per-instance keys via `OPENROUTER_PROVISIONING_KEY` (see [BILLING.md](BILLING.md)), and `own_key` instances bring their own.
