# Deploy an agent

> Choosing a runtime, the four-step deploy wizard, and what happens while your agent comes online.

Related: [Getting started](getting-started.md), [Managing your agent](managing-agents.md), [Billing & credits](billing-credits.md).

---

## Choosing a runtime (OpenClaw vs Hermes)

This is the first decision in the wizard. Both run a capable AI agent; they differ in interface and footprint.

| | **OpenClaw** | **Hermes** |
|---|---|---|
| Best for | The default choice for most agents | When you want a browser chat UI **and** an OpenAI-compatible API for your own bots |
| Runs on | Every plan, including the smallest server | Needs **≥ 2 GB RAM** — the wizard blocks it on sub-2 GB plans |
| How you log in | An admin email + password to its own chat UI | An **Open WebUI** browser chat, plus a `/v1` API endpoint for programmatic access |
| Switch later? | Yes — you can change an agent's runtime after deploy (it re-provisions the server) | Yes |

If you're not sure, pick **OpenClaw**. You can switch later.

## The deploy wizard (4 steps)

Open **Dashboard → Deploy Agent**. The wizard has four steps:

1. **Agent** — pick the runtime (OpenClaw or Hermes).
2. **Project** — give the agent a name (a URL-friendly slug is generated automatically) and choose a **use case** category: Automation, DevOps, Support, Research, Content, Sales, Social Media Manager, or Custom.
3. **Plan** — choose a plan. Each plan provisions the same baseline server; plans differ by included **credits**, number of **live agents**, and **team seats**. Hermes-only note: the smallest plans are disabled if they don't meet Hermes' memory requirement.
4. **Billing** — choose **monthly** or **yearly** (yearly saves roughly two months), review the summary, and deploy.

> Your agent always ships as an embeddable **Web Chat** widget on a **dedicated server** — these are fixed, so you won't be asked to choose them. You can add other interfaces (like Telegram) afterward.

On deploy: in production you're sent to **Stripe Checkout** to confirm payment; once paid, provisioning begins. (In development the agent activates immediately.)

## While your agent provisions

Open the agent's page to watch it come online:

- The status moves **provisioning → running**. Most managed deploys claim a pre-warmed server and are ready in seconds; a full cold build (a few minutes) is the fallback when the warm pool is momentarily empty.
- You'll see live **deployment stages** as the server is set up.
- If something fails, you'll get a **Retry** and a **Cancel & delete** option — no charge for a failed provision.

When the status is **running**, head to [Managing your agent](managing-agents.md) to reveal credentials, open the URL, and configure it.

## The Free tier

The Free plan is a **time-boxed demo**: your agent runs for **30 minutes** and is then automatically torn down. It's meant for trying the real experience before you subscribe. Upgrade to any paid plan to keep agents running.

---

**Next:** [Managing your agent →](managing-agents.md)
