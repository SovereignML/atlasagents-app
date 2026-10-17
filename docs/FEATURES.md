# Atlas Agents — Feature List

> AI Operations Platform. Deploy, manage, and scale intelligent AI agents.

> **Feature deep-dives** (the newer subsystems have their own pages):
> [BYOS](BYOS.md) · [Billing & credits](BILLING.md) · [Integrations (Drive / Cloudflare)](INTEGRATIONS.md) · [VPS Provider Router](PROVIDERS.md) · [Runtimes (OpenClaw / Hermes)](RUNTIMES.md)

---

## Platform Overview

Atlas Agents is a production-ready SaaS platform that lets businesses deploy AI agents that automate real work. Think Shopify for AI agents — you pick the type, configure it, and it runs.

---

## Marketing & Landing Pages

### Homepage (`/`)
- **Hero** — Headline (“Run your Own AI Agents”), supporting copy, primary CTA to sign up / deploy, grid-line motion accents; full-viewport hero with branded gradient background
- **Smooth scroll** — Lenis-based `SmoothScrollProvider` wraps the page
- **AgentWheel** — Rotating agent ecosystem visualization
- **MissionControlPlanner** — Mission-control style planner section
- **CapabilityTimeline** — Capability timeline section
- **CaseStudyCarousel** — Industry use-case carousel with stats (`CountUp` animations)
- **AgentConfigurator** — Agent configuration section including embedded **SmartPlanner** wizard (use case → recommendation → next steps)
- **PricingElevation** — Elevated pricing / plan presentation
- **KnowledgeBaseFAQ** — Collapsible FAQ block
- **ConvergenceCTA** — Closing CTA section (magnetic-style buttons, supporting motion)
- **Chrome** — Global `Navbar` and `Footer`; floating **PlaygroundWidget** for on-site interaction

### Pricing Page (`/pricing`)
- Three plan cards with monthly pricing
- **Agent access comparison table** — shows which agent types are available per plan
- Enterprise CTA with demo booking link

### Comparison Page (`/comparison`)
- **Comparison table** — Atlas Agents vs VPS Providers vs DIY Setup (9 features)
- **3 positioning blocks** — "We are not hosting / not just infra / we are an AI operations layer"
- Demo booking CTA

### Additional Marketing Pages
- `/docs` — Documentation hub
- `/community` — Community page
- `/banned` — Account suspension page

---

## Authentication System

### Login (`/login`)
- Email + password credentials
- Google OAuth one-click sign-in
- "Remember me" session persistence via JWT
- Redirects authenticated users to dashboard
- Error states: invalid credentials, banned account

### Registration (`/register`)
- Name, email, password with client-side validation
- Google OAuth registration
- Duplicate email detection (409 response)
- Rate limited: 5 registrations per IP per hour
- Redirect to login with success banner on completion

### Password Reset
- **Forgot password** (`/forgot-password`) — Email-based reset initiation
- **Reset password** (`/reset-password`) — Token-validated new password form
- SHA-256 hashed tokens stored in DB (never in plaintext)
- 1-hour token expiry
- Rate limited: 3 requests per email per hour
- Branded Atlas Agents email template (Resend)

### Session Management
- JWT-based sessions via NextAuth v5
- Role (`user` / `admin`) embedded in JWT
- Middleware (`src/proxy.ts`) protects `/dashboard/*` and `/admin/*`
- Auto-redirect logged-in users away from `/login` and `/register`

---

## User Dashboard

### Overview (`/dashboard`)
- Stats bar: Active Agents, Total Agents, Active Subscriptions
- Agent list with status badges (running / provisioning / stopped / failed / deleted)
- Quick links to each agent's detail page
- Empty state with deploy CTA

### Deploy Agent (`/dashboard/deploy`)
A 5-step guided deployment wizard (`project → interface → plan → advanced → billing`):

| Step | Description |
|------|-------------|
| **1. Project** | Agent name (auto-generated slug) + use case (one of the 8 agent categories) |
| **2. Interface** | Interface kind (**Web** and **API** live today; Telegram/Discord are coming soon), deployment target (**Dedicated VPS** today; Shared Cluster / Serverless coming soon), region, and **runtime engine** ([OpenClaw or Hermes](RUNTIMES.md)) |
| **3. Plan** | Choose a self-serve plan (Free / Builder / Operator / Scale — Enterprise and [BYOS](BYOS.md) have their own flows) |
| **4. Advanced** | Optional: root password, SSH public key |
| **5. Billing** | Monthly vs yearly interval, full config + price review, then deploy |

- The provider for a managed-VPS deploy is chosen automatically — see [VPS Provider Router](PROVIDERS.md).
- Integrates with Stripe Checkout in production; dev mode auto-activates without payment.
- Already own a server? Use [Bring Your Own Server](BYOS.md) instead of this wizard.

### My Agents (`/dashboard/instances`)
- Full list of all deployed agents with status
- Per-agent: region, compute specs, IP address, recent log entries
- Action buttons: Restart, Stop (for running agents)
- Color-coded status badges

### Billing (`/dashboard/billing`)
- **Credit wallet** balance and top-up / overage packs — AI usage is metered in credits (1 credit = $0.01). See [Billing & credits](BILLING.md).
- Estimated monthly cost across active subscriptions
- Active subscription count
- Per-subscription details: plan name, agent, interval, renewal date, price
- Status badges: active, past_due, canceled, incomplete

### Bring Your Own Server (`/dashboard/byos`)
- Connect servers you already own (free); Atlas Agents runs agents on them for a flat fee per agent — one BYOS plan per agent, bought ahead or at install. See [BYOS](BYOS.md).

### Per-agent tools (instance detail page)
- **Backups** — snapshot/restore agent settings to your own Google Drive.
- **Custom domain** — put the agent on a subdomain of your own Cloudflare zone. Both via [Integrations](INTEGRATIONS.md).

### Subscriptions (`/dashboard/subscriptions`)
- All subscription records with plan and pricing
- Billing interval display (monthly / yearly)
- Creation and renewal dates

### SSH Keys (`/dashboard/ssh-keys`)
- List all SSH keys with fingerprints and creation dates
- Keys auto-associated during deployment wizard

### Settings (`/dashboard/account`)
Four settings sections:
1. **Profile** — Display name editing
2. **Security** — Password change (supports password-only and Google-only accounts)
3. **Contact & Socials** — Telegram ID, Twitter handle, Discord ID
4. **Connected Accounts** — Google OAuth connection status

---

## Agent Types (8 Categories)

Defined in [`src/configs/agent-categories.ts`](../src/configs/agent-categories.ts):

| Agent | Slug | Description |
|-------|------|-------------|
| Automation Agent | `automation` | Automate workflows, business operations, and repetitive tasks. |
| DevOps Agent | `devops` | Monitor infrastructure, manage CI/CD, and resolve incidents. |
| Support Agent | `support` | Handle customer inquiries, tickets, and live chat 24/7. |
| Research Agent | `research` | Analyze data, scrape the web, and generate actionable summaries. |
| Content Agent | `content` | Create, schedule, and optimize content across channels. |
| Sales Agent | `sales` | Generate leads, automate outreach, and manage your CRM. |
| Social Media Manager | `social` | Generate content, schedule posts, and grow your audience. |
| Custom Agent | `custom` | Build a bespoke AI agent tailored to your exact requirements. |

---

## Smart Planner

### Landing Page Widget (3-step UI)
1. Select use case from 8 pre-defined tiles
2. See recommended agent type + auto-generated config
3. Choose: Deploy Now or Talk to Expert

### API Endpoint (`POST /api/planner`)
Public endpoint powering the landing page planner and third-party integrations.

**Request:**
```json
{ "useCase": "support" }
```

**Response:**
```json
{
  "agentType": {
    "slug": "support",
    "name": "Support Agent",
    "icon": "MessageSquare",
    "description": "Handle customer inquiries, tickets, and live chat 24/7.",
    "examples": ["Ticket triage & routing", "FAQ auto-response", "Escalation management"]
  },
  "suggestedConfig": {
    "compute": "auto-scaled",
    "monitoring": "enabled",
    "privacy": "strict"
  },
  "suggestedPlan": "builder"
}
```

---

## Pricing & Plans

Seven plans, defined in [`src/configs/plans.ts`](../src/configs/plans.ts). AI usage is metered in **credits** (1 credit = $0.01) granted per billing period — see [Billing & credits](BILLING.md). Monthly/Yearly below are the current launch (promo) prices; full after-launch prices are noted where they differ.

| Plan | Slug | Monthly | Yearly | Full (after launch) | Credits/period | Live agents | For |
|------|------|--------:|-------:|--------------------:|---------------:|------------:|-----|
| Free | `free` | $0 | $0 | $0 | 100 | — (no always-on) | Try and build |
| Lite | `lite` | $9 | $90 | $9 | 500 | 1 | Trying it for real |
| Builder | `builder` | $19 | $190 | $29 | 1,000 | 1 | Solo builders |
| Operator | `operator` | $69 | $690 | $99 | 2,000 | 3 | Growing operations |
| Scale | `scale` | $179 | $1,790 | $249 | 5,000 | 10 | Agencies and teams |
| Enterprise | `enterprise` | From $499 | custom | From $999 | custom | scalable | High-scale orgs (contact sales) |
| Bring Your Own Server | `byos` | $2.50 | $30 | $2.50 | 100 (one-time per plan, managed mode) | — | One agent on your own server ([BYOS](BYOS.md)) |

Billing is monthly or yearly (yearly ≈ 2 months free, ~17% off).

**Overage packs:** 2,000 credits / $25 · 10,000 / $99 · 25,000 / $199 (min top-up 500 credits).
**Add-ons:** extra live agent $29/mo · premium integrations $49/mo · priority support $99/mo · white-label $199/mo · custom workflow builds from $500.

---

## Admin Panel (`/admin`)

Access: users with `role: "admin"` only. Redirects regular users to dashboard.

### Admin Dashboard (`/admin`)
- Platform stats: Total users, active agents, total agents, active subscriptions, stopped agents, banned users
- Recent 10 deployments with user email, region, and status

### User Management (`/admin/users`)
- Full user list with search and status filters (all / active / banned / admin)
- Per-user: agent count, subscription count, ban status
- Actions: change role (user ↔ admin), ban with reason, unban, delete
- Self-protection: cannot ban or delete your own account

### Instance Management (`/admin/instances`)
- All deployments across all users
- Filter and search capabilities

### Subscription Management (`/admin/subscriptions`)
- All subscriptions platform-wide
- Status management

### Revenue (`/admin/revenue`)
- Revenue metrics and subscription analytics

### Admin Notes
- Per-user internal notes via `POST /api/admin/users/[userId]/notes`

### Admin Password Reset
- Force reset any user's password via `POST /api/admin/users/[userId]/reset-password`

---

## API Reference

### Auth APIs

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `POST` | `/api/auth/register` | Create account | Public |
| `POST` | `/api/auth/forgot-password` | Request password reset email | Public |
| `POST` | `/api/auth/reset-password` | Reset password with token | Public |
| `GET` | `/api/auth/account` | Get user profile | User |
| `PATCH` | `/api/auth/account` | Update name/password/socials | User |
| `GET/POST` | `/api/auth/[...nextauth]` | NextAuth handlers | — |

### Agent/Instance APIs

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `POST` | `/api/deploy` | Deploy a new agent | User |
| `GET` | `/api/instances` | List user's agents | User |
| `POST` | `/api/instances/[id]/restart` | Restart an agent | User |
| `POST` | `/api/instances/[id]/delete` | Delete an agent | User |

### Billing APIs

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `GET` | `/api/billing` | Get billing overview | User |
| `GET` | `/api/subscriptions` | List subscriptions | User |
| `POST` | `/api/webhooks/stripe` | Stripe webhook handler | Stripe signature |

### Planner API

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `POST` | `/api/planner` | Get agent recommendation | Public |

### Admin APIs

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `GET` | `/api/admin/stats` | Platform statistics | Admin |
| `GET` | `/api/admin/users` | List all users | Admin |
| `PATCH` | `/api/admin/users/[id]` | Ban/unban/role change | Admin |
| `DELETE` | `/api/admin/users/[id]` | Delete user | Admin |
| `POST` | `/api/admin/users/[id]/notes` | Add admin note | Admin |
| `POST` | `/api/admin/users/[id]/reset-password` | Force password reset | Admin |
| `GET` | `/api/admin/subscriptions` | All subscriptions | Admin |
| `PATCH` | `/api/admin/subscriptions/[id]` | Update subscription | Admin |
| `GET` | `/api/admin/providers` | Provider router overview | Admin |
| `PATCH` | `/api/admin/providers/[id]` | Enable/priority/pin a provider | Admin |

### Feature APIs

These power the subsystems documented in their own pages.

| Method | Endpoint | Description | Doc |
|--------|----------|-------------|-----|
| `POST` | `/api/byos/deploy` | Install an agent onto a connected server (uses an available BYOS plan, or returns a Checkout URL for one) | [BYOS](BYOS.md) |
| `POST` | `/api/byos/plans` | Buy a BYOS plan (one agent) — no server needed | [BYOS](BYOS.md) |
| `PATCH` | `/api/byos/plans/[subscriptionId]` | Cancel a BYOS plan at period end, or undo that | [BYOS](BYOS.md) |
| `POST` | `/api/billing/usage-sync` | Poll OpenRouter spend, charge wallet, enforce caps | [Billing](BILLING.md) |
| `GET/POST` | `/api/integrations/drive/*` | Connect / disconnect Google Drive | [Integrations](INTEGRATIONS.md) |
| `POST/GET` | `/api/integrations/cloudflare/*` | Connect / list zones / disconnect Cloudflare | [Integrations](INTEGRATIONS.md) |
| `GET/POST` | `/api/instances/[id]/backups` | List / create agent backups | [Integrations](INTEGRATIONS.md) |
| `POST` | `/api/instances/[id]/backups/[backupId]/restore` | Restore a backup (new / in-place) | [Integrations](INTEGRATIONS.md) |
| `POST/DELETE` | `/api/instances/[id]/cloudflare-domain` | Bind / unbind a user-zone subdomain | [Integrations](INTEGRATIONS.md) |
| `GET` | `/api/instances/[id]/credentials` | Agent admin login / gateway token | [Runtimes](RUNTIMES.md) |
| `PATCH` | `/api/instances/[id]/agent-type` | Switch runtime / agent config | [Runtimes](RUNTIMES.md) |

---

## Security

- **JWT sessions** — No server-side session storage, stateless auth
- **Password hashing** — bcryptjs with 10 salt rounds
- **AES-256-GCM** — Secrets encrypted at rest (`encryptSecret`, `INSTANCE_ENCRYPTION_KEY`): root/admin passwords, gateway tokens, per-instance OpenRouter keys, and user-supplied tokens (Google Drive refresh token, Cloudflare API token, BYOS own API key) — never stored in plaintext
- **SHA-256 tokens** — Password reset tokens stored as hashes, never plaintext
- **Rate limiting** — In-memory sliding window on registration (5/hr/IP) and password reset (3/hr/email)
- **User isolation** — All data queries scoped to `userId`; admin required for cross-user access
- **CSRF protection** — Handled by NextAuth v5
- **Route protection** — Proxy middleware guards `/dashboard/*` and `/admin/*`

---

## Design System

- **Color** — `#030303` background, `#CCFF00` accent, `#0F0F0F` secondary surfaces
- **Typography** — Rajdhani (display/headings), Outfit (body), Space Mono (code/labels)
- **Grid** — Full-page CSS grid overlay (fixed, 50px cells) for the industrial terminal aesthetic
- **Corners** — Sharp (radius: 0) throughout — no rounded corners
- **Animations** — Framer Motion for scroll-triggered fade-ups; CSS keyframes for terminal typing, marquee scroll, scanline
- **Components** — shadcn/ui (Button, Card, Dialog, DropdownMenu, Input, Badge, Table, Tabs, Separator, Skeleton, Sonner)

---

## Infrastructure

### Deployment Regions (4 active, 2 coming soon)

Defined in [`src/configs/regions.ts`](../src/configs/regions.ts); each maps to a per-provider region code ([Provider Router](PROVIDERS.md)).

| Slug | City | Country | Status |
|------|------|---------|--------|
| `us-east-1` | Newark | United States (East) | active |
| `us-west-1` | Fremont | United States (West) | active |
| `eu-central-1` | Frankfurt | Germany | active |
| `ap-south-1` | Singapore | Singapore | active |
| `eu-west-1` | London | United Kingdom | coming soon |
| `ap-northeast-1` | Tokyo | Japan | coming soon |

### Compute Tiers (9 configurations)

Normalized tiers in [`src/configs/server-types.ts`](../src/configs/server-types.ts), each mapped to a plan code per provider (DigitalOcean/Linode). Storage add-on: $0.05/GB-month (0–1000 GB).

| Slug | Category | Label | vCPU | RAM | Storage | Monthly |
|------|----------|-------|-----:|----:|--------:|--------:|
| `shared-1g` | Shared | Nanode 1GB | 1 | 1 GB | 25 GB | $5 |
| `shared-2g` | Shared | Linode 2GB | 1 | 2 GB | 50 GB | $12 |
| `shared-4g` | Shared | Linode 4GB | 2 | 4 GB | 80 GB | $24 |
| `shared-8g` | Shared | Linode 8GB | 4 | 8 GB | 160 GB | $48 |
| `shared-16g` | Shared | Linode 16GB | 6 | 16 GB | 320 GB | $96 |
| `dedicated-4g` | Dedicated | Dedicated 4GB | 2 | 4 GB | 80 GB | $36 |
| `dedicated-8g` | Dedicated | Dedicated 8GB | 4 | 8 GB | 160 GB | $72 |
| `dedicated-16g` | Dedicated | Dedicated 16GB | 8 | 16 GB | 320 GB | $144 |
| `dedicated-32g` | Dedicated | Dedicated 32GB | 16 | 32 GB | 640 GB | $288 |

---

## Shipped since the original v1.0 spec

The earliest version of this doc listed several things as limitations or roadmap that have since shipped:

- **PostgreSQL** — the app runs on PostgreSQL via Drizzle ORM (no SQLite). See [TECH-STACK.md](TECH-STACK.md).
- **Real provisioning** — agents run on real VMs across DigitalOcean / Linode with scoring and failover. See [VPS Provider Router](PROVIDERS.md). (Not "mock IPs", and not Hetzner.)
- **Credit billing with margin** — per-instance OpenRouter keys, spend caps, and a usage poller. See [Billing & credits](BILLING.md).
- **White-label / agency** — customers can run agents on subdomains of their own Cloudflare zones. See [Integrations](INTEGRATIONS.md).
- **Bring Your Own Server** — manage an agent on hardware the customer owns. See [BYOS](BYOS.md).
- **A second runtime** — Hermes alongside OpenClaw. See [Runtimes](RUNTIMES.md).
- **Agent backup/restore** — to the user's own Google Drive. See [Integrations](INTEGRATIONS.md).

---

## Still open

- [ ] Live agent monitoring dashboard with charts
- [ ] Email verification on registration
- [ ] Stripe Customer Portal (manage payment methods, view invoices)
- [ ] Agent version control and rollback
- [ ] Multi-agent orchestration dashboard
- [ ] Webhook support (notify external systems on agent events)
- [ ] Programmatic API key system for the control plane
