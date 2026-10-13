# Bring Your Own Server (BYOS)

> Atlas Agents as a pure management panel for a server **you already own**. We don't provision or bill for the box — we install, run, monitor, and configure the agent on it for a flat fee.

BYOS is the answer to "I already have a VPS / dedicated box / homelab machine — can you just run the agent on it?" Yes. You keep ownership and control of the hardware; Atlas Agents connects over SSH and treats it like any other managed instance (logs, restart, config, backups), minus the compute billing.

Related: [BILLING.md](BILLING.md) (the credit-metered LLM mode), [RUNTIMES.md](RUNTIMES.md) (what actually gets installed), [INTEGRATIONS.md](INTEGRATIONS.md) (Drive backups / Cloudflare domains work on BYOS instances too).

---

## What it does (for users)

From **Dashboard → Bring Your Own Server** (`/dashboard/byos`):

1. **Connect a server** (`/dashboard/byos/connect`). The page shows the platform's **fleet public key** (`SSH_FLEET_PUBLIC_KEY`). You paste that one line into the `authorized_keys` of the SSH user on your server — that's how we get in. No agent or daemon to install yourself.
2. **Enter the connection details** — host/IP, SSH port (default `22`), and SSH user (default `root`).
3. **Buy a BYOS plan for that server** — the only paid step. One plan covers every agent you install on that server.
4. **Install agents** onto it. No checkout: choose the runtime and how its LLM calls are paid for (see [LLM modes](#llm-modes)), and Atlas Agents SSHes in and provisions it straight away. Installing is refused (`402`) on a server without a plan.

Connecting and buying a plan are independent: a connected server with no plan costs nothing, and a plan is bought for a specific server.

Once connected, the server appears as a normal instance: open it at `/dashboard/instances/[id]` for status, logs, restart, credentials, backups, and a custom domain.

### Pricing

BYOS is its own plan (`byos` in [`src/configs/plans.ts`](../src/configs/plans.ts)):

| | Price |
|---|---|
| Monthly | **$2.50/mo** per server |
| Yearly | **$30/yr** per server |

This is a flat **management-panel fee only**, charged per server that has a plan (not per agent, and not for connected servers without one). Because Atlas Agents doesn't own the hardware, there is **no compute/VM billing** — unlike the managed-VPS plans, where the server size is part of the price. LLM usage is billed separately and only in `managed_credits` mode (below).

The first `managed_credits` agent installed under a plan adds a **one-time grant of 100 AI credits** (once per plan, claimed as `byos_signup_grant:<subscription id>`) (`BYOS_SIGNUP_CREDITS` in [`src/configs/plans.ts`](../src/configs/plans.ts)); after that, top up your wallet as needed. `own_key` agents get no grant because they pay their provider directly.

### LLM modes

When you connect a server you pick one of two ways to pay for the agent's model calls:

| Mode | What it means | Who pays the LLM bill |
|------|---------------|-----------------------|
| **`managed_credits`** (pay-as-you-go) | The agent uses Atlas Agents's OpenRouter access. Usage is metered against your **credit wallet**. | Your Atlas Agents credits — see [BILLING.md](BILLING.md). |
| **`own_key`** | You paste your **own** LLM provider API key. It's encrypted at rest and injected into the agent. | You, directly to your provider. Atlas Agents never meters it. |

With `own_key` you pay only the server's $2.50/mo plan; with `managed_credits` the plan's first such agent brings 100 starter credits, and usage then draws down your wallet.

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
6–10 minutes for OpenClaw and 10–15 for Hermes + Open WebUI.

Work that does **not** depend on which engine they eventually pick now runs in
the background as soon as the server is connected:

| | at connect | at deploy |
|---|---|---|
| apt, Caddy, Node, swap, both runtimes' accounts | installed | no-ops |
| `hermes-agent` + Open WebUI | installed, Open WebUI pre-booted | restart only |
| `openclaw` | **downloaded into the npm cache only** | installed from cache |
| config, secrets, systemd, health checks, DNS | — | per-instance, always |

OpenClaw is the genuine either/or, and its 225MB / 11,428-file *extract* is what
makes it expensive, so only the download moves. Open WebUI is not part of that
choice — it is Hermes' sidecar and ships everywhere — so installing it early is
what removes the heaviest item from the slow path. The consequence is that a
Hermes deploy ends up faster than an OpenClaw one.

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

The plan belongs to the **server**, not to an agent.

- `POST /api/byos/servers/[serverId]/plan` opens a recurring Stripe Checkout (`mode: "subscription"`, `metadata.type = "byos_plan"`, `metadata.byosServerId`). In dev mode without Stripe it writes an active `Subscription` row directly.
- `handleCheckoutSessionCompleted` records it as a `Subscription` with **`byosServerId` set and no `instanceId`**. If the webhook never arrives, [`checkout-recovery.ts`](../src/lib/checkout-recovery.ts) records it — from the install page (the checkout's `success_url`), from the install route, and from the 60s background sweep. All paths share the `stripe_checkout:<session id>` claim.
- `POST /api/byos/deploy` only checks `findByosPlan(serverId)`: a plan in `active`/`trialing` allows installs; `past_due` keeps existing agents running but blocks new installs.
- **Ending a plan.** A cancel takes effect at period end, so agents run through every month that was paid for. On `customer.subscription.deleted`, the server's running agents are **stopped** (`pauseBot` — systemd stop, nothing deleted) unless another live plan still covers the server. There is no wallet fallback for BYOS. A restart of a stopped agent on a server with no plan is refused (`402`).
- A server with a plan that will renew can't be disconnected; cancel it first (a plan set to cancel at period end doesn't block).
- **Legacy rows.** Before plans were per server, each install opened its own subscription tied to the agent (`instanceId`). Such a live row still counts as a plan for the server its agent is on, so those customers don't have to buy again.

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
POST /api/byos/deploy
```
Auth: user session, resolved through `getEffectiveTeam()` (see
[Impersonation](#impersonation)). Body:

```jsonc
{
  "name": "my-agent",
  "byosServerId": "clx...",   // a connected server that has a BYOS plan
  "llmMode": "managed_credits", // or "own_key"
  "ownApiKey": "sk-...",      // required iff llmMode === "own_key"
  "agentConfig": { /* optional; deployment_target is forced to "byos" */ }
}
```
Returns `{ instanceId }` and starts provisioning. It never returns a checkout URL — buy the plan first (`POST /api/byos/servers/[serverId]/plan`, body `{ "interval": "month" | "year" }`, returns `{ checkoutUrl }`).

**The host is not a parameter.** Connect the server first (`POST /api/byos/servers`), then install onto it by id. The connection — host, port, SSH user — is read off the `ByosServer` row, so an agent can only ever land on a machine this team has connected and we have proven SSH access to. Passing a host here is rejected with `Missing required fields (name, byosServerId)`.

| Status | Meaning |
|--------|---------|
| `402` | The server has no BYOS plan, or its plan is `past_due` (`code: "byos_plan_required"`). |
| `404` | The `byosServerId` isn't connected to the caller's team. |
| `409` | The server's last probe found it unreachable — refresh it and retry. |

### Required environment

BYOS deploys preflight these and return `503` if any are missing:

| Env var | Why |
|---------|-----|
| `SSH_FLEET_PUBLIC_KEY` | Surfaced to the user to paste into their server. |
| `SSH_FLEET_PRIVATE_KEY` | Used to connect to the user's server. |
| `INSTANCE_ENCRYPTION_KEY` | Encrypts the gateway token, admin password, and the optional own API key. |

Optional: `BYOS_PREBAKE_ENABLED=true` turns on the connect-time prebake (above).

BYOS deliberately does **not** require `OPENROUTER_API_KEY`: `managed_credits` instances mint per-instance keys via `OPENROUTER_PROVISIONING_KEY` (see [BILLING.md](BILLING.md)), and `own_key` instances bring their own.
