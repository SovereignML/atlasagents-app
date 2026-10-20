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
| How you log in | An admin email + password to its own chat UI | A chat page at the agent's own address (sign in with the email and password under **Access → Chat Login**), plus a `/v1` API endpoint for programmatic access |
| Switch later? | No — an agent's runtime is fixed at deploy; deploy a new agent instead | No |

If you're not sure, pick **OpenClaw**. The coding agents (Claude Code, Codex, OpenCode, Pi, Gemini CLI, Grok) work like Hermes and add a browser terminal; Gemini CLI and Grok are also on the Free plan.

## The deploy wizard (3 steps)

Open **Dashboard → Deploy Agent**. The wizard has three steps:

1. **Agent** — pick the agent: OpenClaw, Hermes, or (where enabled) a coding agent — Claude Code, Codex, OpenCode, Pi, Gemini CLI or Grok. A link such as `/dashboard/deploy?runtime=grok` opens the wizard with that agent already picked.
2. **Plan** — choose a plan. Each plan provisions the same baseline server; plans differ by included **credits**, number of **live agents**, and **team seats**. Plans too small for the chosen agent are disabled.
3. **Billing** — choose **monthly** or **yearly** (yearly saves roughly two months), review the summary, and deploy.

There is no name or use-case step: every agent starts from its engine's default setup and gets a name automatically. To rename it, click the pencil next to its name on the agent's page (only the name changes, never its URL).

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
