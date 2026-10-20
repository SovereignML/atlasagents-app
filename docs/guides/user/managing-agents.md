# Managing your agent

> A tour of the agent detail page — every tab, from credentials and custom domains to tools, skills, monitoring, backups, and sharing.

Related: [Deploy an agent](deploy-an-agent.md), [Teams & collaboration](teams.md), [Billing & credits](billing-credits.md).

---

Open any agent from **My Agents**. The page is organized into tabs. Which tabs and controls you see depends on your access level for that agent (see [sharing](#access--sharing) below).

## Overview

At-a-glance status, the agent's **URL** (managed hostname), and quick actions. When provisioning, this is where you watch the deployment stages and can retry or cancel a failed build.

## Credentials & access

- **Login credentials** — click **reveal** to see the agent's admin email + password (OpenClaw), or the chat page password (Hermes, Claude Code, Codex). Their **Chat** card opens the chat right in the dashboard, already signed in.
- **Gateway token / API key** — reveal and copy the token bots use to call the agent programmatically (for Hermes, this authenticates the `/v1` API).
- **Server access** — the SSH command and root password for the underlying server, plus live **server metrics** (CPU, RAM, disk, uptime) with a reachability probe and a **Refresh** button.

## Custom domain & TLS

By default your agent is reachable at a managed hostname. To use your own:

1. Open the domain/DNS control and enter your domain (e.g. `agent.yourbrand.com`).
2. Add the **A record** (or Cloudflare CNAME) it shows you at your DNS provider.
3. Within a minute or so of DNS propagating, the agent serves HTTPS on your domain with an automatically issued certificate.

Both a raw **custom domain** and a **Cloudflare-managed domain** flow are supported.

## Configuring the agent

- **Agent Type / persona** — set the agent's role and personality.
- **Custom Instructions** — freeform guidance the agent always follows.
- **Model** — choose which LLM the agent uses.
- **Tools** — enable the capabilities the agent can call.
- **Skills** — add packaged skills.
- **Files** — browse and manage the agent's files.

## Interfaces

- **Web** — the embeddable chat widget (always on).
- **Telegram** — paste a bot token to give your agent a Telegram presence. (Discord is coming.)

## Controls

Restart or stop the agent. Stopping halts compute (and compute billing); restarting brings it back.

## Monitoring & logs

- **Monitoring** — uptime, latency, and health, if your operator has uptime monitoring configured.
- **Logs** — recent activity and output from the agent, useful for debugging behavior.

## Backup & restore

Back up an agent's **settings** (config, persona, skills, model, interface) to **your own Google Drive**, and restore later. Backups never contain secrets, IPs, or tokens. You can restore in place (for an existing paid agent) or as a new agent.

## Access & sharing

Share an agent with teammates at three levels:

| Level | Can |
|-------|-----|
| **Viewer** | See the agent and its status |
| **Operator** | Operate it — restart/stop, use controls |
| **Manager** | Full management, including configuration |

Sharing is managed from the **Access** tab. See [Teams & collaboration](teams.md) for how seats and roles work.

## Danger zone

Delete the agent (owner only). This tears down the server, revokes its LLM key, removes DNS, and stops all billing for that agent. It cannot be undone.

---

**Next:** [Billing & credits →](billing-credits.md)
