# Billing & credits

> How credits work, your wallet, runway and auto-pause, top-ups, plans, and invoices.

Related: [Deploy an agent](deploy-an-agent.md), [Teams & collaboration](teams.md).

---

## Credits, in one line

**1 credit = $0.01.** Credits are consumed as your agents use AI and run workflows. Your plan grants a pool of credits each billing period; you can top up any time.

## Your wallet

**Billing & Credits** shows a live wallet with:

- **Balance** and its approximate dollar value.
- **Runway** — how many days your balance lasts at your current burn rate.
- **Daily burn** — split into **compute** (the servers your agents run on) and **AI** (LLM usage).
- **Auto-pause threshold** — a floor below which agents automatically stop, so you're never surprised by a negative balance. You'll get **low-balance warnings** before you hit it.

## Plans

Every self-serve plan provisions the same baseline server; plans differ by included **credits**, **live agents**, and **team seats**.

| Plan | Monthly | Credits / period | Live agents | Team seats |
|------|--------:|-----------------:|:-----------:|:----------:|
| **Free** | $0 | 10 | none always-on (30-min demo) | 1 |
| **Lite** | $9 | 500 | 1 | 2 |
| **Builder** | $19 | 1,000 | 1 | 5 |
| **Operator** | $69 | 2,000 | 3 | 10 |
| **Scale** | $179 | 5,000 | 10 | 25 |
| **Enterprise** | From $499 | Custom | Scalable | Unlimited |
| **Bring Your Own Server** | $2.50 | 100 one-time* | — | 5 |

\* BYOS is management-only: 100 credits if you use managed AI, or bring your own API key and pay your provider directly. See [Bring Your Own Server](byos.md).

**Yearly** billing saves roughly two months versus monthly. The **Free** plan is a 30-minute demo — agents auto-tear-down after the trial. **Enterprise** is custom — contact sales.

## Top-ups & overage packs

Buy more credits any time from the **Top-up** card:

| Pack | Price |
|------|------:|
| 2,000 credits | $25 |
| 10,000 credits | $99 |
| 25,000 credits | $199 |

## Add-ons

| Add-on | Price |
|--------|------:|
| Extra live agent | $29/mo |
| Premium integrations | $49/mo |
| Priority support | $99/mo |
| White-label | $199/mo |
| Custom workflow builds | From $500 |

## Managing payment & invoices

The billing page has three tabs:

- **Plans** — your active/canceled subscriptions and renewal dates.
- **Usage** — per-agent spend over the last 30 days, split compute vs AI.
- **History** — every wallet transaction, with **Download statement (CSV)**.

Use the **Stripe billing portal** button to update your payment method, view invoices, or cancel.

### Transaction types you'll see

Plan grant · Top-up · Daily compute · API (AI) usage · Admin grant · Refund · Plan expiry.

---

**Next:** [Teams & collaboration →](teams.md)
