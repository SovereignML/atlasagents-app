# Billing — Credits & OpenRouter Margin

> How Atlas Agents charges for AI usage. Customers fund a **credit wallet**; agents spend real money on OpenRouter; a background poller reconciles the two with a **guaranteed gross margin** and hard spend caps enforced on OpenRouter's side.

Related: [BYOS.md](BYOS.md) (the `managed_credits` vs `own_key` choice), [RUNTIMES.md](RUNTIMES.md) (what consumes the model budget), [PROVIDERS.md](PROVIDERS.md) (compute budgeting, a separate internal concern).

---

## Credits (for users)

Everything AI-related is billed in **credits**.

- **1 credit = $0.01 USD** (the single source of truth, [`src/lib/credit-pricing.ts`](../src/lib/credit-pricing.ts) → `CREDITS_PER_USD = 100`). Balances are stored and charged as whole integer credits.
- **Each plan grants credits per billing period** (`creditsPerPeriod` in [`src/configs/plans.ts`](../src/configs/plans.ts)): Free 100, Builder 3,000, Operator 12,000, Scale 35,000. Enterprise is custom; BYOS grants none (you either meter against credits you top up, or bring your own key).
  - `creditsPerPeriod` is a **monthly** allotment. **Monthly** subs get it on each Stripe invoice. **Yearly** subs prepay 12 months but the credits are **distributed monthly**, not lumped: the first month is granted on `invoice.paid` and the daily plan-credit sweep ([`src/lib/monthly-grants.ts`](../src/lib/monthly-grants.ts), driven by `POST /api/billing/expire-credits`) drips the remaining 11 months, each a fresh use-it-or-lose-it bucket. `Subscription.nextCreditGrantAt` tracks when the next drip is due.
- **Top-ups / overage packs** when you run low ([`OVERAGE_PACKS`](../src/configs/plans.ts)):

  | Credits | Price |
  |--------:|------:|
  | 2,000 | $25 |
  | 10,000 | $99 |
  | 25,000 | $199 |

  Minimum top-up is 500 credits (~$5, `MIN_TOPUP_CREDITS`).

### What happens when you run out

Each agent's AI access is paused automatically when any of these trip:

- **Wallet drained** — balance falls below the minimum buffer of **200 credits (~$2)** (`DEFAULT_MIN_CREDITS`).
- **Spend cap reached** — see below.
- **Anomalous spend** — a sudden spike (possible leaked key or runaway loop).

When an agent is paused you get a billing notification linking to `/dashboard/billing`; top up to resume.

---

## OpenRouter margin billing (for developers)

The hard problem: customers pay us in credits up front, but the agent spends *real, variable* money on OpenRouter as it runs. We must (a) never let OpenRouter bill us more than we've collected, and (b) keep a predictable margin. This is solved with **per-instance keys + a cumulative cap + a reconciling poller** — and it **replaces** the old synthetic per-token metering that used to live in `/api/usage/ingest`.

### Per-instance runtime keys

Each managed-credit instance gets its **own** OpenRouter key, minted under the parent provisioning key ([`src/lib/openrouter-provisioning.ts`](../src/lib/openrouter-provisioning.ts)):

- Minted with label `sovereign-<instanceId>` (so the reconciler can find our keys), via `mintRuntimeKey()`.
- `OPENROUTER_PROVISIONING_KEY` is the parent account key with provisioning scope. **It is the only OpenRouter credential that stays on the control plane** — a bot VM only ever receives its own minted `sk-or-v1-...` runtime key.
- Persisted on the instance as `openRouterKeyId` (OpenRouter's hash, for revoke/list) and `openRouterKeyEnc` (the runtime key, encrypted; returned by OpenRouter exactly once at mint).
- BYOS `own_key` instances are excluded entirely — they never draw on our wallet.

### The margin and the spend cap

`OPENROUTER_MARGIN` (default **0.9**, override via env, clamped to `(0, 1]`) drives a dual relationship ([`credit-pricing.ts`](../src/lib/credit-pricing.ts)):

```
spend cap (USD)   = lifetime_funded_credits → USD  ×  OPENROUTER_MARGIN     // keyLimitUsdFromCredits
wallet charge     = real_OpenRouter_USD  ÷  OPENROUTER_MARGIN  → credits    // openRouterUsdToCredits
```

- The cap is set **on OpenRouter's side** for each key, so OpenRouter can never bill us more than `margin × revenue` no matter how the poller behaves — a **guaranteed gross margin of `1 − margin`** (10% at 0.9), enforced by the provider, not just by us.
- The cap is **cumulative and monotonic**: it tracks lifetime funded credits (matching OpenRouter's lifetime `usage`/`limit` semantics) and is only ever *raised*, on every funding event — never lowered.
- `fundWallet()` ([`openrouter-billing.ts`](../src/lib/openrouter-billing.ts)) is the single funding entry point: it deposits credits (authoritative, transactional) then best-effort re-syncs the caps via `syncOpenRouterLimitsForUser()`, re-enabling any key disabled for low balance. All funding paths (Stripe top-up, plan renewal, admin grant, dev top-up) should route through it.

### The usage-sync poller

```
POST /api/billing/usage-sync
```
([`src/app/api/billing/usage-sync/route.ts`](../src/app/api/billing/usage-sync/route.ts) → `runOpenRouterUsageSync()` in [`openrouter-usage.ts`](../src/lib/openrouter-usage.ts).)

- **Auth (two ways):** an admin-role session (manual trigger from the admin panel), **or** a bearer token matching `USAGE_SYNC_CRON_TOKEN` (scheduled cron). See [DEPLOYMENT.md](DEPLOYMENT.md#scheduled-jobs).
- **Cadence:** run frequently (~every 10 min). Tighter cadence = less metering lag, but the per-key cap bounds worst-case overspend regardless.
- **What it does per instance:** reads the key's cumulative real spend (`getRuntimeKey().usageUsd`), computes the delta since the stored `openRouterUsageUsd` pointer, charges the wallet for that delta marked up by the margin (`deductFromWallet(..., "api_usage", ...)`), and advances the pointer carefully — usage decreases reset the pointer without charging; sub-credit deltas accumulate until they cross a whole credit; the pointer only advances by the USD the charged credits actually cover, so nothing is lost or double-charged.

### Enforcement

After charging, each instance is checked and hard-stopped if any condition trips (`decideEnforcement` in `src/lib/usage-enforcement.ts`, then `enforce()`):

| Condition | Trigger |
|-----------|---------|
| **Cap hit** | `state.usageUsd >= state.limitUsd` |
| **Anomaly** | one interval's `delta > ANOMALY_USD_PER_INTERVAL` (default **$50**, env-overridable) |
| **Drained** | wallet below the minimum buffer (`isAboveMinimum` false). **Not applied to Free-tier demos** (non-null `expiresAt`): their 10-credit grant is below the 200-credit floor from the start, so they are bounded by the key cap and the 30-minute lifetime instead. |

Enforcement is idempotent: disable the OpenRouter key (`updateRuntimeKey({ disabled: true })`), pause the bot (`pauseBot`), log the instance event, notify the user (billing/low-balance), and alert an admin (anomalies are flagged as the interesting case — a possible leaked token).

### Instance columns (on `instances`)

| Column | Meaning |
|--------|---------|
| `openRouterKeyId` | OpenRouter's hash for the minted key (revoke/list handle). |
| `openRouterKeyEnc` | The runtime key, encrypted at rest. |
| `openRouterUsageUsd` | Last-polled cumulative real spend pointer (USD). |
| `openRouterLimitUsd` | Last-set cumulative cap (USD), mirrored from the OpenRouter side. |

### Environment

| Env var | Default | Purpose |
|---------|---------|---------|
| `OPENROUTER_PROVISIONING_KEY` | — | Parent key for minting/reading/revoking runtime keys. Without it, key minting and the poller no-op silently. |
| `OPENROUTER_MARGIN` | `0.9` | Gross-margin fraction; clamped to `(0, 1]`. |
| `USAGE_SYNC_CRON_TOKEN` | — | Bearer token authorizing the scheduled poller. |
| `ANOMALY_USD_PER_INTERVAL` | `50` | Per-poll USD spike that triggers immediate enforcement + admin alert. |
