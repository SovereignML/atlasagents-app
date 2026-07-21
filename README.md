# SovereignML

Production SaaS platform for deploying and operating AI agents (Next.js App Router, Drizzle ORM, PostgreSQL, Stripe, NextAuth).

## Documentation

- **[Guides](docs/guides/README.md)** — full [environment-variable reference](docs/guides/ENVIRONMENT.md), the [clean-install deploy walkthrough](docs/guides/DEPLOY-CLEAN.md), and the [customer-facing user guide](docs/guides/user/README.md).
- **[Tech stack and data layer](docs/TECH-STACK.md)** — Drizzle vs Prisma, legacy `prisma/` cleanup, config source of truth.
- **[Documentation index](docs/README.md)** — links to all guides.
- **[Feature list and platform overview](docs/FEATURES.md)** — routes, APIs, auth, billing, and ops behavior.
- **Environment** — copy [`.env.example`](.env.example) to `.env` and fill values; runtime loads `.env` only.

## Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

| Command | Purpose |
|--------|---------|
| `npm run dev` | Next.js dev server |
| `npm run build` / `npm start` | Production build and server |
| `npm run lint` | ESLint |
| `npm run db:push` | Apply Drizzle schema (`DATABASE_URL` required ) |
| `npm run db:seed` | Seed database |
| `npm run db:studio` | Drizzle Studio |
| `npm run bootstrap:pg` | Postgres bootstrap shell helper |
| `npm run bootstrap:host` | Shared host bootstrap (tsx) |

See [`package.json`](package.json) for the full list.

## Learn more

- [Next.js Documentation](https://nextjs.org/docs)
- [Drizzle ORM](https://orm.drizzle.team/docs/overview)
