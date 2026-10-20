# Getting started

> From sign-up to your first running agent in about five minutes.

Related: [Deploy an agent](deploy-an-agent.md), [Billing & credits](billing-credits.md).

---

## 1. Create your account

Sign up with **email + password** or **Google** (X and Apple are available too where enabled). If you signed up with email, you'll verify your address; if you ever forget your password, use **Forgot password** on the login screen.

Your account starts on the **Free** tier — enough to try a real agent (see [Billing & credits](billing-credits.md)).

## 2. Tour the dashboard

After logging in you land on your **Overview**. The sidebar is grouped into three areas:

**Workspace**
- **Overview** — active/total agents, subscriptions, and a quick "Deploy" button.
- **Monitoring** — live uptime, health, latency, and spend across all your agents.
- **Notifications** — a feed of alerts, deploys, and billing events.

**Agents**
- **Deploy Agent** — the wizard that creates a new agent.
- **My Agents** — every agent you've deployed, with filters.
- **Bring Your Own Server** — connect a server you own ([guide](byos.md)).

**Account**
- **Billing & Credits** — your wallet, plans, usage, and invoices.
- **Team** — members, roles, seats, SSH keys, integrations.
- **Audit Log** — every action on your account (kept 7 days), exportable.
- **Support** — live chat and tickets.
- **Settings / API Keys / SSH Keys** — profile, security, and personal access tokens.

## 3. Deploy your first agent

1. Click **Deploy Agent**.
2. **Agent** — pick the agent you want. **OpenClaw** is the default and works on every plan; **Hermes** and the coding agents (Claude Code, Codex, OpenCode, Pi, Gemini CLI, Grok) add a browser chat UI and an OpenAI-compatible API but need a slightly larger server. (More in [Deploy an agent](deploy-an-agent.md).)
3. **Plan** — choose the plan that fits; each includes a pool of credits and a number of live agents.
4. **Billing** — pick monthly or yearly, review, and deploy.

Your agent gets a name automatically. Rename it any time with the pencil next to its name on its page.

Your agent provisions on a dedicated server (typically seconds, thanks to a warm server pool). When it's **running**, open its page to reveal login credentials and its URL.

## 4. Talk to your agent

On the agent's page, click **reveal** on the credentials card, open the agent URL, and start chatting. From there you can give it custom instructions, connect tools and skills, add a custom domain, or hook it up to Telegram — all covered in [Managing your agent](managing-agents.md).

---

**Next:** [Deploy an agent →](deploy-an-agent.md)
