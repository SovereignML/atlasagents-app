# VPS Provider Router

> Where a managed-VPS agent actually gets provisioned. Atlas Agents routes each deploy across **multiple cloud providers** (DigitalOcean, Linode) by score, with hard filters, failover, internal per-provider budgets, and health-aware ranking. This replaces the old single, env-driven Linode path.

For end users this is invisible — you pick a **region** and a **server size** (see [FEATURES.md](FEATURES.md)) and the platform picks the best provider. Everything below is operator/developer facing.

Related: [BILLING.md](BILLING.md) (customer credits — a separate concern from these internal compute budgets), [DEPLOYMENT.md](DEPLOYMENT.md#scheduled-jobs) (the sync crons).

---

## Providers

The catalog ([`src/configs/providers.ts`](../src/configs/providers.ts)) is the static **seed** source for the `providers`, `provider_plans`, `provider_regions`, and `provider_billing` tables. **At runtime the router reads the DB, not this file** — so admins can change priorities, mappings, and budgets without a redeploy.

| Provider | Slug | Credential env | Default priority | Monthly budget (soft / hard) |
|----------|------|----------------|-----------------:|------------------------------|
| DigitalOcean | `digitalocean` | `DIGITALOCEAN_API_TOKEN` | 100 | $3,000 ($2,400 / $3,000) |
| Linode / Akamai | `linode` | `LINODE_API_TOKEN` | 90 | $5,000 ($4,000 / $5,000) |

Each normalized server tier (`server-types.ts` slug) and region maps to a provider-specific plan/region code (`PROVIDER_PLAN_MAP`, `PROVIDER_REGION_MAP`). Tiers are matched on **category + RAM**; vCPU may differ where a provider has no exact match. Not every provider serves every region (e.g. only Linode has a Tokyo POP). Secrets live **only** in env, never in the DB.

---

## Routing

`routeDeployment()` ([`src/lib/vps-router/index.ts`](../src/lib/vps-router/index.ts)) takes a normalized region + server config (+ optional workload type) and returns a **ranked candidate list** (best-first), the chosen provider, and every rejection with a reason. It's a pure read — `logRoutingDecision()` persists the outcome separately.

### Hard filters (rejections)

A candidate provider/plan/region combination is dropped before scoring for any of:

`provider_disabled` · `category_mismatch` (workload requires a category it can't serve) · `region_unavailable` (no mapping) · `region_capacity` (mapping marked unavailable) · `hard_limit_reached` (budget `currentUsageUsd ≥ hardLimitUsd`) · `unhealthy` (most recent health probe is `down`).

### Scoring

Survivors are scored on **six weighted factors** that sum to 1.0 ([`src/configs/routing.ts`](../src/configs/routing.ts), pure logic in [`scoring.ts`](../src/lib/vps-router/scoring.ts)):

| Factor | Weight | How it's computed |
|--------|-------:|-------------------|
| `remainingCredit` | 0.25 | `remaining / monthlyBudget`, **halved** once past the soft limit (still routable until the hard limit). |
| `burnRate` | 0.15 | runway days (`remaining / burnRatePerDay`) toward a 30-day target; no burn → 1. |
| `health` | 0.20 | `up`=1, `degraded`=0.5 (`down` is hard-filtered); ×0.85 if latency > 2000ms; no recent probe → 0.8 optimistic prior. |
| `successRate` | 0.15 | 7-day provisioning success from `routing_logs`, prior-smoothed (`k=5`, prior 0.9) for low-volume providers. |
| `costEfficiency` | 0.15 | `cheapestCandidateCost / thisCost`. |
| `regionAvailability` | 0.10 | provider priority normalized: `0.6 + 0.4 × (priority / maxPriority)`. |

**Pinned** providers (`provider.pinnedRegionId === regionId`) always sort first among candidates that passed the filters; the rest sort by weighted total.

**Workload profiles** override weights: `cpu_intensive` forces dedicated cores and leans on health + track record; `memory_intensive` weights RAM-budget headroom; `burst` chases the cheapest option with budget headroom; `general` uses the base weights.

### Failover

The ranked list drives a failover loop of up to `MAX_FAILOVER_ATTEMPTS` (**3**) providers. The provisioner stamps the final outcome (`succeeded`/`failed`) back onto `routing_logs` for the provider that actually worked, so per-provider success rates stay accurate.

---

## Internal budgets

"Credit" here is **not** a provider account balance — it's a budget *we* configure per provider in `provider_billing`. The router treats this as the source of truth and never calls a provider balance API ([`src/lib/provider-billing.ts`](../src/lib/provider-billing.ts)).

- Columns: `monthlyCreditsUsd`, `currentUsageUsd`, `softLimitUsd`, `hardLimitUsd`, `burnRateUsdPerDay`, `cycleStart`. `remainingUsd = max(0, monthly − usage)`.
- **Accrual:** `accrueProviderUsage()` atomically adds each instance's daily compute cost (from `src/lib/daily-billing.ts`) to the current cycle.
- **Sync:** `runProviderBillingSync()` recomputes each provider's burn rate and, once a cycle exceeds ~30 days, resets usage and rolls `cycleStart` (carrying the last cycle's average burn forward). Run daily from the reconcile cron — see [DEPLOYMENT.md](DEPLOYMENT.md#scheduled-jobs).

---

## Health

`checkProviderHealth()` / `runProviderHealthChecks()` ([`src/lib/provider-health.ts`](../src/lib/provider-health.ts)) probe each provider and write `provider_health_logs` (`status`, `latencyMs`, `checkedAt`). Only probes within the last **30 minutes** (`HEALTH_RECENT_WINDOW_MS`) count toward scoring; `down` is a hard filter.

---

## Admin

Admins manage providers from **`/admin/providers`** (data via `getProvidersOverview()` in [`src/lib/provider-admin.ts`](../src/lib/provider-admin.ts)) — provider status, budgets, recent health, and success rates.

| Route | Purpose |
|-------|---------|
| `GET /api/admin/providers` | Overview of all providers. |
| `PATCH /api/admin/providers/[providerId]` | Enable/disable, set priority, pin to a region. |
| `…/[providerId]/billing` | Adjust the provider's internal budget. |
| `…/[providerId]/health` | Trigger a manual health probe. |

### Tables

`providers`, `provider_plans`, `provider_regions`, `provider_billing`, `provider_health_logs`, `routing_logs`.
