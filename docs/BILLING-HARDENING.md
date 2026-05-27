# Billing Hardening

> Crash-safety, reconciliation, and operability work layered on top of the credit/wallet model described in [BILLING.md](BILLING.md). The model is unchanged — `Wallet.balance` is still the source of truth and `WalletTransaction` is still the append-only ledger. This doc records what was hardened and how to operate it.

Related: [BILLING.md](BILLING.md) (the model), [PROVIDERS.md](PROVIDERS.md) (the separate internal compute budget).

---

## What changed

### Phase 1 — crash-safety on the money paths

- **Transaction-scoped wallet core.** [`src/lib/wallet.ts`](../src/lib/wallet.ts) now exposes `depositWithinTx` / `deductWithinTx` (take a Drizzle `tx`) under the standalone `depositToWallet` / `deductFromWallet`. This lets a caller commit a balance change *atomically with its own side-effect*.
- **Atomic usage-sync.** [`src/lib/openrouter-usage.ts`](../src/lib/openrouter-usage.ts) deducts credits **and** advances the per-instance `openRouterUsageUsd` pointer in **one transaction**. Previously a crash between the two re-charged the same OpenRouter delta on the next poll (double-billing) or dropped usage. Now it's exactly-once.
- **Per-instance daily-billing idempotency.** [`src/lib/daily-billing.ts`](../src/lib/daily-billing.ts) claims `daily_billing:<day>:<instanceId>` **inside the same transaction** as that instance's charge (was a single day-wide claim taken before the loop). A mid-loop crash or double trigger now re-runs cleanly: already-billed instances are skipped (`alreadyBilled` in the report), the rest are charged exactly once, and a thrown error rolls back both the claim and the charge so it retries.
- **Clawbacks lower the OpenRouter cap.** A refund / lost dispute / voided paid invoice now drops `lifetimeFundedCredits` by the full reversed amount (`reduceLifetimeFunded`) and re-syncs the per-key spend caps, so a refunded user's key can't keep spending up to the old, higher cap. See `clawBackFunds` in [`src/lib/billing/index.ts`](../src/lib/billing/index.ts).

### Phase 2 — reconciliation & integrity

- **[`src/lib/billing-reconcile.ts`](../src/lib/billing-reconcile.ts)** — detect-and-report (no auto-heal):
  - **Ledger integrity** — `Wallet.balance` must equal `Σ WalletTransaction.amount`. Any drift means a write bypassed the wallet functions.
  - **Bigint dual-write drift** — `balanceCents` must equal `ROUND(balance)` on rows that have been written since Commit 2 (see Phase 3).
  - **OpenRouter usage drift** — authoritative key spend vs our pointer; flags `pointer_ahead` (over-charge signature) and large `uncharged_usage` (a stuck/un-polled key). Bounded by `BILLING_RECONCILE_MAX_KEYS` and best-effort.
- **Wiring.** Runs from the existing reconcile cron ([`/api/admin/reconcile`](../src/app/api/admin/reconcile/route.ts), `Promise.allSettled`) and raises **de-duped** `billing_drift` admin notifications for serious findings (`alertBillingReconcile`).
- **Health endpoint.** [`GET /api/admin/billing/health`](../src/app/api/admin/billing/health/route.ts) returns a cheap snapshot (ledger + totals + open drift, no OpenRouter calls). `?full=1` runs the live usage-drift scan and raises alerts.

### Phase 3 — architecture

- **Billing façade.** [`src/lib/billing/`](../src/lib/billing/index.ts) is the single public surface for moving credits — three verbs that keep the wallet and the OpenRouter caps in lockstep in one place: `fund` (deposit + raise caps), `charge` (`deductFromWallet`), `clawBack` (`clawBackFunds`: deduct + un-fund + lower caps). Plus `adminAdjustCredits` for manual grants/removals. New code should import from `@/lib/billing`.
- **Bigint migration — Commit 2 (dual-write) shipped.** Every wallet write now mirrors `balance`→`balanceCents` and creation seeds both (1 credit = 1 cent). `balance` (float) remains **authoritative**; reads are unchanged. **Commit 3** (flip reads to bigint, drop the float columns + the dead `User.credits` column) is a later destructive migration — do it only once the bigint-drift check has been clean in production for a few days.
- **`User.credits` is dead** — nothing reads or writes it for billing; flagged in the schema for removal with bigint Commit 3.

### Phase 4 — operability

- **Admin billing dashboard** at [`/admin/billing`](../src/app/admin/billing/page.tsx): outstanding credits, lifetime funded, ledger/bigint health, open drift alerts, recent reversals & adjustments, a **manual adjustment** form, and a "Run full reconcile" button.
- **Manual credit adjustment.** [`POST /api/admin/billing/adjust`](../src/app/api/admin/billing/adjust/route.ts) (`{ userId|email, credits, reason }`, credits signed) → ledger `admin_grant` + audit log (`admin.credit_adjust`) + user notification.

### Phase 5 — user-facing UX

- **Per-agent usage breakdown (30d)** and a **burn rate that includes AI usage** (7-day average) for a realistic runway, on [`/dashboard/billing`](../src/app/dashboard/billing/page.tsx).
- **Tiered low-balance warning** ([`src/lib/low-balance.ts`](../src/lib/low-balance.ts)): warns once/day when balance enters the band between the pause floor and `floor × LOW_BALANCE_WARN_MULTIPLIER` (default 2×) — *before* the hard pause. Called after charges in usage-sync and daily-billing.
- **Credit statement CSV** at [`GET /api/billing/statement`](../src/app/api/billing/statement/route.ts) + a download button on the billing page.

---

## Operating it

| Env var | Default | Purpose |
|---|---|---|
| `BILLING_DRIFT_USD` | `1` | USD gap (real vs pointer) before usage drift is flagged. |
| `BILLING_RECONCILE_MAX_KEYS` | `250` | Cap on per-run OpenRouter key polls in the reconcile. |
| `LOW_BALANCE_WARN_MULTIPLIER` | `2` | Warn when balance ≤ minimum × this (and > minimum). |

- **Drift alerts** show up as unresolved `billing_drift` admin notifications and on `/admin/billing`. They are NOT auto-healed — investigate, then adjust manually (the adjustment form) and resolve the notification.
- **`?full=1`** on the health endpoint (or the dashboard button) forces a live key-polling scan; the cheap snapshot is safe to poll continuously.

## Tests

`npm run test:billing-hardening` (needs `TEST_USER_ID` + a dev DB) covers dual-write, the settlement + un-fund clawback mechanic, and claim+charge idempotency. `test:wallet-race` and `test:openrouter-usage-sync` still cover the lock and the poller.

## Still open (deliberately deferred)

- **Bigint Commit 3** — flip reads to `balanceCents`, drop the float wallet columns and `User.credits`. Gate on a few clean days of the bigint-drift check.
- **Auto-heal** for usage drift — currently detect-and-report only; a verified-safe heal (set pointer = authoritative, charge/credit the gap) can come once drift patterns are understood.
