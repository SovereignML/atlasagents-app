# Atlas Agents — technology stack and data layer

This document is the **source of truth** for which tools the application uses, how they connect, and how to interpret **Prisma**-related naming in dependencies or older docs (the app uses **Drizzle**, not Prisma CLI migrations).

For product behavior and routes, see [FEATURES.md](FEATURES.md). For day-to-day development, see [DEVELOPER-GUIDE.md](DEVELOPER-GUIDE.md).

---

## 1. Stack at a glance

| Layer | Technology | Where it lives |
|-------|------------|----------------|
| App & routing | **Next.js 16** (App Router), **React 19** | `src/app/`, `next.config.ts` |
| HTTP boundary (auth) | **Next.js 16 “proxy”** — `auth` export, not legacy `middleware.ts` | `src/proxy.ts` |
| Styling | **Tailwind CSS v4**, **tw-animate-css**, shadcn **base-nova** | `postcss.config.mjs`, `src/app/globals.css`, `components.json` |
| UI primitives | **Base UI** (`@base-ui/react`) via generated shadcn components | `src/components/ui/` |
| Forms / motion (marketing) | **Zod**, **Framer Motion**, **Lenis** | `src/lib/*`, `src/components/marketing/` |
| Database | **PostgreSQL** via **`pg`** pool | `DATABASE_URL` in `.env` |
| ORM & schema | **Drizzle ORM** + **Drizzle Kit** | `src/db/schema.ts`, `src/db/index.ts`, `drizzle.config.ts` |
| Auth | **NextAuth v5** (Auth.js) + **Drizzle adapter** | `src/auth.ts`, `@auth/drizzle-adapter` |
| Payments | **Stripe** | `src/lib/stripe.ts`, `src/lib/stripe-events.ts`, `src/app/api/webhooks/stripe/` |
| Email | **Resend** | `src/lib/email.ts` |
| Infra / DNS | **Linode API**, **node-ssh**, **Cloudflare API** | `src/lib/linode.ts`, `src/lib/ssh.ts`, `src/lib/cloudflare.ts` |

---

## 2. Database: Drizzle + PostgreSQL (why this repo uses it)

### What runs in production

1. **`src/db/index.ts`** loads `DATABASE_URL`, creates a singleton **`pg.Pool`**, and passes it to **`drizzle(pool, { schema })`**.
2. **`src/db/schema.ts`** defines tables with Drizzle’s `pgTable`, relations, and enums. This file is the **only** maintained schema definition for the app.
3. **`drizzle.config.ts`** points Drizzle Kit at that schema and PostgreSQL:

```text
schema: "./src/db/schema.ts"
dialect: "postgresql"
```

4. **Scripts** in `package.json`:

- `db:push` — `drizzle-kit push` (apply schema to DB; common in this repo).
- `db:studio` — Drizzle Studio.
- `db:seed` — application seed script.

So: **migrations in the operational sense are owned by Drizzle** (`drizzle-kit push` or, if you later adopt them, generated SQL migrations under a `drizzle/` folder). There is **no** Prisma CLI step in `package.json`.

### Why not Prisma here?

The codebase is already integrated end-to-end with Drizzle:

- **`@auth/drizzle-adapter`** maps NextAuth tables to Drizzle models (`src/auth.ts`).
- All routes import `db`, `eq`, tables from `@/db`.

Switching to Prisma would mean replacing those imports, regenerating a Prisma schema from the current Drizzle definitions, and changing the Auth adapter to `@auth/prisma-adapter`. That is a **different project** than “use the existing app.”

---

## 3. Prisma migration folders — what they are doing here

### 3.1 Application-owned `prisma/` at the repo root

The legacy **`prisma/migrations/`** tree (empty timestamped folders left from an older stack) **has been removed** from this repository.

**Ground truth:**

- **Live schema** is **`src/db/schema.ts`** only; there is **no** `prisma/schema.prisma`.
- **The app does not run Prisma migrate**; deploy docs in [`deploy/README.md`](../deploy/README.md) describe **Drizzle** (`drizzle-kit push`).

**Operational rule:** Treat **`src/db/schema.ts` + Drizzle Kit** as authoritative. If a `prisma/` folder reappears (e.g. from a bad merge), it is not used by the current `package.json` scripts—remove it or ignore it in favor of Drizzle.

### 3.2 `node_modules/drizzle-orm/prisma/*` (confusing name)

Inside **`drizzle-orm`** there are subpaths named `prisma` (for example **`drizzle-orm/prisma/pg`**). That is **not** “your app’s Prisma migrations.” It is an **optional integration**: Drizzle can use a **`PrismaClient`** as the underlying driver/session for people who run both. Atlas Agents’s code uses **`drizzle-orm/node-postgres`** (`src/db/index.ts`), **not** that integration.

So if a search hits `prisma` only under `node_modules/drizzle-orm/`, it is **vendor code**, not project Prisma.

### 3.3 `package-lock.json` and optional `@prisma/client`

`drizzle-orm` declares **`@prisma/client`** as an **optional peer** for the Prisma-session feature. npm may list related entries in the lockfile **even when your app never installs or imports Prisma**. That does **not** mean the control plane runs Prisma.

---

## 4. How schema changes should be done (Drizzle)

Typical workflow for developers:

1. Edit **`src/db/schema.ts`**.
2. Run **`npm run db:push`** (with `DATABASE_URL` in `.env`) to apply changes to your local or staging database.
3. Run **`npm run build`** and tests as needed.

For **production**, prefer a reviewed process:

- Either continue with **`drizzle-kit push`** in a controlled deploy step (as in deploy docs), **or**
- Introduce **versioned SQL migrations** with `drizzle-kit generate` and apply them in CI — a team choice not encoded in this file.

---

## 5. Auth and session storage

- **NextAuth** is configured in **`src/auth.ts`** with **`DrizzleAdapter(db, { usersTable, accountsTable, sessionsTable, verificationTokensTable })`**.
- Those tables are defined in **`src/db/schema.ts`** and must stay compatible with the adapter’s expected column names (see Auth.js Drizzle adapter docs).

**`src/proxy.ts`** exports the default **`auth`** handler with a **`matcher`** for dashboard, admin, and auth pages. Next.js 16 uses this **proxy** entry so the same session is used at the edge of the request as in API routes (see comment in that file).

---

## 6. Other configs (short map)

| File | Role |
|------|------|
| `tsconfig.json` | `@/*` → `src/*`; includes Next-generated types under `.next`. |
| `eslint.config.mjs` | `eslint-config-next` (Core Web Vitals + TypeScript); ignores `deploy/**`, `scripts/**`. |
| `next.config.ts` | `output: "standalone"`, security headers, redirects, `serverExternalPackages` for native deps like `ssh2`. |

---

## 7. Stale documentation elsewhere

Some markdown under **`docs/`** was written against a **Prisma + SQLite** era (for example [INTERNAL-AUDIT.md](INTERNAL-AUDIT.md) mentions `prisma.$transaction` and `prisma/schema.prisma`). The **current** credits implementation uses **`db.transaction`** from Drizzle (see `src/lib/credits.ts`).

When in doubt, trust **this file**, **`package.json`**, and **`src/db/`** over older narrative audits.

---

## 8. Quick answers (FAQ)

**Q: Are Prisma migration files driving my database?**  
**A:** No. Legacy **`prisma/migrations/`** has been **removed** from the repo. Live schema is **`src/db/schema.ts`** and Drizzle Kit (`npm run db:push`).

**Q: Why do I see “prisma” in the lockfile?**  
**A:** Mostly **optional peers** pulled in by **`drizzle-orm`**, not an app dependency on Prisma CLI.

**Q: What command replaces `prisma migrate deploy`?**  
**A:** For this repo, **`npm run db:push`** (Drizzle Kit push to `DATABASE_URL`). Exact production wiring may be in Docker/deploy scripts — see [deploy/README.md](../deploy/README.md).
