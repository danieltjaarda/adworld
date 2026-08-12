# AdLeverage

Multi-tenant SaaS that connects to Google Ads and runs a safety-constrained AI agent over
the account: it syncs the data, calculates the statistics itself, proposes changes with
reasoning and evidence, and — depending on the mode the customer chose — waits for
approval or applies them and logs everything.

Built on Next.js 16 (App Router), TypeScript, Prisma/PostgreSQL, Tailwind, shadcn/ui and
Stripe, deployable to Vercel.

## Running it locally

```bash
npm install
cp .env.example .env      # DATABASE_URL and AUTH_SECRET are the only required values
npm run db:migrate        # or: npm run db:push
npm run db:seed           # optional: a demo workspace with 90 days of data
npm run dev
```

Without Google, OpenAI or Stripe credentials the app still runs end to end. Each
integration falls back to a mock provider, and the seed (or the "Explore with demo data"
button during onboarding) creates a clearly labelled **Demo Account** that is never mixed
with live data. The seeded login is `demo@adleverage.app` / `demo-password-1`.

| Command | |
| --- | --- |
| `npm run dev` | development server |
| `npm run build` | production build (runs `prisma generate` first) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Vitest |
| `npm run db:migrate` / `db:deploy` | apply migrations in development / production |
| `npm run db:seed` | demo workspace, synced and analyzed |
| `npm run db:studio` | Prisma Studio |

## How it is put together

```
src/
  app/
    (auth)/          login, signup, password reset, email verification
    (dashboard)/     overview, campaigns, keywords, search terms, ads, optimizer,
                     recommendations, alerts, reports, accounts, settings, billing, ai
    onboarding/      connect -> select account -> mode -> goals
    api/
      auth/google/   Google sign-in OAuth
      google-ads/    Google Ads OAuth + account discovery
      stripe/        webhook
      cron/          sync, analyze, execute, digest
  components/        dashboard, charts, tables, navigation, ai, forms, ui (shadcn)
  lib/
    auth/            sessions, tenant context, RBAC
    security/        scrypt hashing, AES-GCM token encryption, rate limiting
    db/              Prisma client
    google-ads/      REST client, entity fetchers, mutations, demo provider
    sync/            Google Ads -> local warehouse
    analytics/       date ranges, metric derivation, tenant-scoped queries
    optimization/    rules, safety, executor, anomaly detection
    ai/              provider, schemas, tools, chat, summaries, ad copy
    billing/         plan catalogue and entitlement enforcement
    stripe/          checkout, subscription sync, webhook handling
    jobs/            cron pipeline and idempotent job runner
prisma/              schema, migration, seed
tests/               Vitest suite
```

UI components never talk to Google, Stripe or the model directly. Pages read through
`lib/analytics/queries`, and every mutation goes through a server action that
re-authorizes on the server.

### Tenancy

Every tenant-owned row carries `organizationId`. The active organization is resolved from
the session's memberships in `lib/auth/context.ts`; nothing reads an organization id from
the client, so a crafted id in a cookie or form field can only produce a 404. Roles are
Owner, Admin, Member and Viewer, resolved through the permission matrix in
`lib/auth/rbac.ts` rather than by comparing roles inline.

`tests/tenant-isolation.test.ts` runs every analytics query and every agent tool against a
recording Prisma stub and fails if any read reaches the database without an organization
filter.

### The optimization pipeline

```
sync -> deterministic statistics -> rule engine -> safety clamps -> (optional) LLM
     -> recommendation -> approval or automatic execution -> Google Ads -> audit log
```

The model never computes a metric and never calls an API. Numbers come from
`lib/analytics/metrics.ts`; the model classifies search-term intent, prioritizes, writes
the explanation, and drafts ad copy. Its output is parsed with Zod (`lib/ai/schemas.ts`)
and anything that fails validation is dropped.

Every proposed change then passes `lib/optimization/safety.ts`, which clamps budget and
bid changes to the account's configured limits and a set of hard limits that no
configuration can exceed, and refuses forbidden operations (deleting campaigns, touching
conversion tracking or account settings) outright. Automatic execution additionally
requires the change type to be switched on, the risk to be below High, and the confidence
to clear the account's threshold.

Modes: **Suggestions** (never writes), **Approval** (prepares changes, waits), and
**Automatic** (applies the enabled change types). Executed actions store their previous
state so they can be rolled back from the audit log.

### Background jobs

`vercel.json` schedules four cron routes: `sync` (hourly), `analyze` (daily), `execute`
(hourly) and `digest` (Mondays). They authenticate with `CRON_SECRET` and run through
`lib/jobs/runner.ts`, where each job first claims a unique run key of job, scope and time
bucket. A retry, an overlapping deploy or a double-fired schedule loses that race and
returns without repeating the work.

## Deploying to Vercel

1. Add Postgres from the Vercel Marketplace — Neon is the straightforward choice. It
   injects `DATABASE_URL` (pooled, what the app uses) and `DATABASE_URL_UNPOOLED`
   (direct, what migrations use), and gives every preview deployment its own database
   branch. Any other Postgres works too; then set `DIRECT_URL` yourself.
2. Set the remaining environment variables: `AUTH_SECRET` (generate a fresh one —
   `openssl rand -base64 48`), `NEXT_PUBLIC_APP_URL` on the real domain, and
   `CRON_SECRET`.
3. Deploy. `vercel.json` overrides the build command to run `prisma migrate deploy`
   before `next build`, so the schema is applied on every deploy. The local
   `npm run build` deliberately leaves that out and needs no database.
4. Google Cloud: add `https://your-domain/api/auth/google/callback` and
   `https://your-domain/api/google-ads/callback` as authorized redirect URIs, and set
   `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_ADS_DEVELOPER_TOKEN`.
5. Stripe: create the products, put their price ids in `STRIPE_PRICE_*`, and point a
   webhook at `https://your-domain/api/stripe/webhook` for the `checkout.session.*`,
   `customer.subscription.*` and `invoice.*` events.

Cron schedules are picked up from `vercel.json` on deploy. Vercel sends `CRON_SECRET` as a
bearer token automatically; in production the cron routes refuse to run without it. The
hourly schedules require a Pro plan — Hobby rejects any cron that fires more than once a
day at deploy time, so on Hobby you have to widen them to daily.

Do not run the seed against production. Sign up normally; the demo account is available
from onboarding if you want to look around before connecting a real Ads account.

## Security

Passwords are hashed with scrypt. Session tokens, verification tokens and invitations are
stored as SHA-256 hashes, so a database dump cannot be replayed. Google refresh tokens are
encrypted with AES-256-GCM before storage and never leave the server. Session cookies are
`httpOnly`, `sameSite=lax` and `secure` in production. Auth endpoints and expensive
operations are rate limited (Upstash Redis when configured, in-memory otherwise). All
input is validated with Zod, and sensitive actions are written to the audit log.

Errors are normalized through `lib/errors.ts`: users see an explanation of what went wrong
and what to do, while the underlying message, provider error code and context go to the
structured logs. Logging redacts tokens and secrets.

## Tests

```bash
npm test
```

Nine suites covering tenant isolation, budget and bid safety limits, AI output validation,
metric calculations, Google Ads normalization and error mapping, authentication and
session handling, RBAC, billing entitlements, and Stripe webhook idempotency.

Two behaviors are asserted explicitly because they are the product's core promises: one
tenant can never read another's data, and the agent cannot move a budget beyond the
configured limit.
