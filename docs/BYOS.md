# Bring Your Own Server (BYOS)

> SovereignML as a pure management panel for a server **you already own**. We don't provision or bill for the box — we install, run, monitor, and configure the agent on it for a flat fee.

BYOS is the answer to "I already have a VPS / dedicated box / homelab machine — can you just run the agent on it?" Yes. You keep ownership and control of the hardware; SovereignML connects over SSH and treats it like any other managed instance (logs, restart, config, backups), minus the compute billing.

Related: [BILLING.md](BILLING.md) (the credit-metered LLM mode), [RUNTIMES.md](RUNTIMES.md) (what actually gets installed), [INTEGRATIONS.md](INTEGRATIONS.md) (Drive backups / Cloudflare domains work on BYOS instances too).

---

## What it does (for users)

From **Dashboard → Bring Your Own Server** (`/dashboard/byos`):

1. **Connect a server** (`/dashboard/byos/connect`). The page shows the platform's **fleet public key** (`SSH_FLEET_PUBLIC_KEY`). You paste that one line into the `authorized_keys` of the SSH user on your server — that's how we get in. No agent or daemon to install yourself.
2. **Enter the connection details** — host/IP, SSH port (default `22`), and SSH user (default `root`).
3. **Choose how the agent's LLM calls are paid for** (see [LLM modes](#llm-modes) below).
4. **Pay the flat management fee** and SovereignML SSHes in and provisions the agent on your box.

Once connected, the server appears as a normal instance: open it at `/dashboard/instances/[id]` for status, logs, restart, credentials, backups, and a custom domain.

### Pricing

BYOS is its own plan (`byos` in [`src/configs/plans.ts`](../src/configs/plans.ts)):

| | Price |
|---|---|
| Monthly | **$29/mo** |
| Yearly | **$290/yr** (~2 months free) |

This is a flat **management-panel fee only**. Because SovereignML doesn't own the hardware, there is **no compute/VM billing** — unlike the managed-VPS plans, where the server size is part of the price. LLM usage is billed separately and only in `managed_credits` mode (below).

### LLM modes

When you connect a server you pick one of two ways to pay for the agent's model calls:

| Mode | What it means | Who pays the LLM bill |
|------|---------------|-----------------------|
| **`managed_credits`** (pay-as-you-go) | The agent uses SovereignML's OpenRouter access. Usage is metered against your **credit wallet**. | Your SovereignML credits — see [BILLING.md](BILLING.md). |
| **`own_key`** | You paste your **own** LLM provider API key. It's encrypted at rest and injected into the agent. | You, directly to your provider. SovereignML never meters it. |

You only pay the $29/mo panel fee in `own_key` mode; in `managed_credits` you also draw down credits as the agent runs.

---

## How it works (for developers)

### No VM is created

The defining difference from the managed-VPS path: **no provider VM is allocated**. The flow in [`src/app/api/byos/deploy/route.ts`](../src/app/api/byos/deploy/route.ts):

- The user pastes `SSH_FLEET_PUBLIC_KEY` into their own root `authorized_keys`; the control plane connects with the matching `SSH_FLEET_PRIVATE_KEY`. The fleet public key is intentionally surfaced in the UI — it's public key material.
- To satisfy the `instances` foreign keys without a real Linode/DO/OVH plan, the row points at a **sentinel** server config (`byos-managed`) and a **`self-hosted`** region (falling back to the first region if the BYOS seed hasn't run). These are placeholders, not billable compute.
- `provisionBot()` ([`src/lib/provisioner.ts`](../src/lib/provisioner.ts)) then runs the normal install over SSH against the user's host — same runtime install as a managed instance (see [RUNTIMES.md](RUNTIMES.md)).

### Billing path

- The deploy resolves the `byos` plan via `findPlanBySlug("byos")` and, if Stripe is configured, opens a **recurring** Stripe Checkout subscription for the flat fee (`planUnitAmountCents(planConfig, billingInterval)`), with `mode: "subscription"`.
- If Stripe is **not** configured (dev mode), the instance auto-activates, a local `subscriptions` row is written, and `provisionBot()` runs immediately.

### Instance columns (on the `instances` table)

| Column | Meaning |
|--------|---------|
| `deploymentTarget` | Set to `"byos"` — this is how BYOS instances are filtered in the dashboard. |
| `byosHost` | The user's server hostname/IP. |
| `byosPort` | SSH port (default `22`, validated `1–65535`). |
| `byosUser` | SSH user (default `root`). |
| `byosLlmMode` | `"managed_credits"` or `"own_key"`. |
| `byosOwnApiKeyEnc` | The user's own API key, encrypted via `encryptSecret()` — only set when `byosLlmMode === "own_key"`. |

### API

```
POST /api/byos/deploy
```
Auth: user session. Body:

```jsonc
{
  "name": "my-agent",
  "byosHost": "1.2.3.4",
  "byosPort": 22,              // optional, default 22
  "byosUser": "root",         // optional, default "root"
  "billingInterval": "month", // or "year"
  "llmMode": "managed_credits", // or "own_key"
  "ownApiKey": "sk-...",      // required iff llmMode === "own_key"
  "agentConfig": { /* optional; deployment_target is forced to "byos" */ }
}
```
Returns `{ instanceId, checkoutUrl }` when Stripe is configured (redirect the user to `checkoutUrl`), or `{ instanceId }` in dev mode.

### Required environment

BYOS deploys preflight these and return `503` if any are missing:

| Env var | Why |
|---------|-----|
| `SSH_FLEET_PUBLIC_KEY` | Surfaced to the user to paste into their server. |
| `SSH_FLEET_PRIVATE_KEY` | Used to connect to the user's server. |
| `INSTANCE_ENCRYPTION_KEY` | Encrypts the gateway token, admin password, and the optional own API key. |

BYOS deliberately does **not** require `OPENROUTER_API_KEY`: `managed_credits` instances mint per-instance keys via `OPENROUTER_PROVISIONING_KEY` (see [BILLING.md](BILLING.md)), and `own_key` instances bring their own.
