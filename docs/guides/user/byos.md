# Bring Your Own Server (BYOS)

> Connect a server you already own — a VPS, dedicated box, or homelab — and let SovereignML manage an agent on it.

Related: [Managing your agent](managing-agents.md), [Billing & credits](billing-credits.md).

---

## What BYOS is

With BYOS, SovereignML acts purely as the **management panel** for hardware you own. No VM is created on your behalf, so there's no compute billing — just a flat **$2.50/month** management fee. You get the full agent experience (status, logs, restart, credentials, backups, custom domains) on your own server.

## Connecting a server

1. Go to **Dashboard → Bring Your Own Server → Connect a server**.
2. The page shows the platform's **fleet public SSH key**. Paste that single line into your server's `~/.ssh/authorized_keys`. That's the only setup on your side — there's no agent or daemon to install, and none of your own SSH secrets are stored.
3. Enter your server's **host/IP**, **SSH port** (default 22), and **SSH user** (default root).
4. Choose how the agent's AI is billed:
   - **Managed credits** — pay-as-you-go against your SovereignML credit wallet. You get **100 credits** to start.
   - **Own key** — paste your own LLM API key (stored encrypted). You pay your LLM provider directly; SovereignML doesn't meter AI usage.
5. Confirm the **$2.50/mo** management fee. SovereignML connects over SSH and provisions the agent.

## After connecting

Your server appears in **My Agents** like any other instance, with the same tabs — status, logs, restart, credentials, custom domain, backups — minus the compute-billing pieces (you own the box). If you chose **own key**, you also get a control to switch your primary/fallback API keys.

Everything in [Managing your agent](managing-agents.md) applies from here on.

---

**Next:** [Reseller / white-label →](reseller-whitelabel.md)
