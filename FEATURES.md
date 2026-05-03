# SovereignML — Feature List

> AI Operations Platform. Deploy, manage, and scale intelligent AI agents.  
> Current version: **v1.0** | Build: Next.js 16.2.1

---

## Platform Overview

SovereignML is a production-ready SaaS platform that lets businesses deploy AI agents that automate real work. Think Shopify for AI agents — you pick the type, configure it, and it runs.

---

## Marketing & Landing Pages

### Homepage (`/`)
- **Outcome-driven hero** — "Launch AI Agents That Actually Work" with terminal animation showing live agent deployment
- **Trust bar** — Horizontal marquee of engineering teams with smooth infinite scroll animation
- **Agent Categories Grid** — 8 interactive agent type cards with hover glow effects
- **Smart Planner** — 3-step interactive wizard: select use case → get agent recommendation → deploy or book demo
- **Features Section** — 9 outcome-focused feature cards (deploy, privacy, monitoring, scaling, optimization, etc.)
- **Use Cases** — 3 industry cards: E-Commerce, SaaS, Agency with concrete outcome stats
- **Pricing Section** — 3-tier plan cards (Starter / Pro / Enterprise) with plan comparison
- **Demo Booking CTA** — High-ticket enterprise funnel section
- **Upgrade Path** — Visual Start → Grow → Scale progression
- **FAQ** — 5 AI-agent-focused collapsible questions
- **Final CTA** — Dual-button close (Deploy Now / Book Demo)

### Pricing Page (`/pricing`)
- Three plan cards with monthly pricing
- **Agent access comparison table** — shows which agent types are available per plan
- Enterprise CTA with demo booking link

### Comparison Page (`/comparison`)
- **Comparison table** — SovereignML vs VPS Providers vs DIY Setup (9 features)
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
- Branded SovereignML email template (Resend)

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
A 6-step guided deployment wizard:

| Step | Description |
|------|-------------|
| **1. Project** | Agent name with auto-generated slug |
| **2. Region** | 5 available regions (US East/West, EU Frankfurt/Helsinki, Singapore) |
| **3. Billing** | Monthly vs yearly toggle with savings indicator |
| **4. Server** | Category tabs (Standard / Performance / ARM / Dedicated) → hardware selection |
| **5. Advanced** | Optional: root password, SSH key, extra storage (0–1000 GB, $0.05/GB/mo) |
| **6. Review** | Full config summary + price breakdown before deploying |

- Integrates with Stripe Checkout in production
- Dev mode: auto-activates without payment

### My Agents (`/dashboard/instances`)
- Full list of all deployed agents with status
- Per-agent: region, compute specs, IP address, recent log entries
- Action buttons: Restart, Stop (for running agents)
- Color-coded status badges

### Billing (`/dashboard/billing`)
- Estimated monthly cost across active subscriptions
- Active subscription count
- Per-subscription details: plan name, agent, interval, renewal date, price
- Status badges: active, past_due, canceled, incomplete

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

| Agent | Slug | Description | Suggested Plan |
|-------|------|-------------|----------------|
| Automation Agent | `automation` | Workflows, business ops, repetitive tasks | Starter |
| DevOps Agent | `devops` | Infra monitoring, CI/CD, incident response | Pro |
| Support Agent | `support` | Customer tickets, live chat, FAQ | Starter |
| Research Agent | `research` | Data analysis, web scraping, summaries | Pro |
| Content Agent | `content` | Blog posts, newsletters, SEO copy | Pro |
| Sales Agent | `sales` | Lead gen, outreach, CRM enrichment | Pro |
| Social Media Manager | `social` | Content scheduling, engagement, growth | Pro |
| Custom Agent | `custom` | Bespoke builds, multi-agent systems | Enterprise |

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
  "suggestedPlan": "starter"
}
```

---

## Pricing & Plans

| | Starter | Pro | Enterprise |
|-|---------|-----|-----------|
| **Price** | $5/mo | $29/mo | $199/mo |
| **AI Agents** | 1 | Up to 10 | Unlimited |
| **Agent Types** | Automation, Support | All 7 types | All + Custom |
| **Monitoring** | Basic | Advanced + alerts | Real-time |
| **Support** | Community | Priority email | 24/7 phone + Slack |
| **Health Checks** | Daily | Hourly | Real-time |
| **Custom Builds** | ✗ | ✗ | ✅ |
| **Dedicated Engineer** | ✗ | ✗ | ✅ |
| **SLA** | Standard | Standard | Custom |
| **SOC2 + Audit Logs** | ✗ | ✗ | ✅ |

Billing is monthly or yearly (yearly saves ~17% — 2 months free).

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

---

## Security

- **JWT sessions** — No server-side session storage, stateless auth
- **Password hashing** — bcryptjs with 10 salt rounds
- **AES-256-GCM** — Root passwords encrypted at rest with per-instance IV
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

### Deployment Regions (5 active, 1 coming soon)

| Slug | City | Country |
|------|------|---------|
| `us-east-1` | Ashburn | United States (East) |
| `us-west-1` | Hillsboro | United States (West) |
| `eu-central-1` | Frankfurt | Germany |
| `eu-west-1` | Helsinki | Finland |
| `ap-southeast-1` | Singapore | Singapore |
| `ap-northeast-1` | Tokyo | Japan (coming soon) |

### Compute Tiers (16 configurations)

| Category | Description | Range |
|----------|-------------|-------|
| **CX** Standard | Balanced shared vCPU | 2–16 vCPU, 4–32 GB RAM |
| **CPX** Performance | AMD EPYC shared vCPU | 3–16 vCPU, 4–32 GB RAM |
| **CAX** ARM | Ampere Altra ARM | 2–16 vCPU, 4–32 GB RAM |
| **CCX** Dedicated | Dedicated vCPU hosts | 2–16 vCPU, 8–64 GB RAM |

---

## Known Limitations (v1.0)

- **SQLite only** — Must migrate to PostgreSQL for production multi-instance deployments
- **Rate limiting is in-memory** — Resets on restart; not suitable for multi-instance deployments
- **No email verification** — Users can register with any email; no confirmation flow
- **Mock infrastructure** — Agent deployment creates DB records and generates mock IPs; real provisioner integration (Hetzner, etc.) is a TODO
- **No agent monitoring UI** — Health metrics are tracked in logs but no live dashboard widget yet

---

## Roadmap (Post v1.0)

- [ ] PostgreSQL migration path
- [ ] Real agent provisioner integration (Hetzner Cloud API)
- [ ] Live agent monitoring dashboard with charts
- [ ] Email verification on registration
- [ ] Redis-backed rate limiting
- [ ] Stripe Customer Portal (manage payment methods, view invoices)
- [ ] Agent version control and rollback
- [ ] Multi-agent orchestration dashboard
- [ ] Webhook support (notify external systems on agent events)
- [ ] API key system (programmatic access)
- [ ] White-label mode for agencies
