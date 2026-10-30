# DriveEasy — shared team task list

Agents: **db** (Database Engine), **app** (App), **qa** (QA). Lead: **main**.
Every agent edits only its own rows (status / notes) and adds new rows for bugs.
Status values: `todo` · `doing` · `blocked` · `review` · `done`.
Bugs: add a row `BUG-n` under the owning agent's section, then SendMessage the owner.

## Ground rules (all agents)

- Read `AGENTS.md` and the matching guide in `node_modules/next/dist/docs/` before writing Next.js code.
- Everything runs locally. No cloud accounts, no `vercel` login, no network services.
  Cloud adapters (Neon, Vercel Blob, Stripe test mode, Vercel Cron) are written behind the
  existing interfaces and selected by env settings; mark them **unverified** until cloud links exist.
- Local DB: PostgreSQL 18 on port 5434. `DATABASE_URL` (dev) and `TEST_DATABASE_URL` (tests) in `.env.local`.
- Money: integer minor units (fils, AED). Never floats. Tax: UAE VAT 5% (configurable per branch).
- Time: store UTC (`timestamptz`); display in the branch's IANA time zone (`branches.time_zone`, e.g. `Asia/Dubai`).
- Rental period: `tstzrange` half-open `[start, end)`, so back-to-back rentals are allowed.
- Secrets only in server code (`import "server-only"`). Never `NEXT_PUBLIC_` for secrets.
- Commit only your own paths: `git add <your paths> && git commit -m "..."` (retry if `index.lock` exists).
  End commit messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `pnpm typecheck`, `pnpm lint`, `pnpm test` must pass before you mark a task `done`.

## File ownership

| Area | Owner |
| --- | --- |
| `src/lib/db/**`, `drizzle/**`, `scripts/seed*`, `src/server/**` (domain services: availability, pricing, reservations, payments/deposits orchestration, webhooks, holds, audit) | db |
| `src/lib/payments/**`, `src/lib/storage/**`, `src/lib/jobs/**` (adapters + interfaces) | db |
| `src/app/**`, `src/components/**`, `src/lib/auth*`, `src/proxy.ts`, styles | app |
| `tests/**`, `playwright.config.ts`, `vitest.config.mts`, test helpers | qa |
| `README.md`, `vercel.json`, `.env.example`, `docs/**` | main (others propose via SendMessage) |

## Contracts between agents

- **db → app**: server functions in `src/server/*` with typed inputs (Zod) and outputs; app calls them
  from Server Components, Server Actions and Route Handlers only. db announces each module via SendMessage.
- **Auth tables**: db owns the schema for `users` + Better Auth tables (`sessions`, `accounts`,
  `verifications`), UUID ids, `users.role` in (`CUSTOMER`, `ADMIN`). app owns `src/lib/auth.ts` config.
- **Errors**: services throw typed errors (`code` + message); app maps them to UI states.

## Tasks

### db
| ID | Task | Status | Notes |
| --- | --- | --- | --- |
| DB-1 | Drizzle schema + migrations for all 17 tables + auth tables, constraints, indexes, exclusion constraints | todo | |
| DB-2 | Seed script (`pnpm db:seed`): branches, categories, vehicles, features, extras, pricing rules, admin + customer users, future reservations | todo | |
| DB-3 | Availability + search service (filters, per-vehicle calendar) | todo | |
| DB-4 | Pricing service (daily rate, days, extras, one-way fee, VAT, deposit, late-return charge) | todo | |
| DB-5 | Reservation transaction (lock, overlap check, hold, server pricing, pending reservation, idempotency) | todo | |
| DB-6 | Payment + deposit orchestration and verified webhook handling (dedupe by event id), confirm only after payment + deposit auth | todo | |
| DB-7 | Modify dates / cancel per cancellation policy, refunds, deposit release | todo | |
| DB-8 | Expire holds: idempotent service + CRON_SECRET route + local command | todo | |
| DB-9 | Admin services: branches, fleet, pricing, reservations, check-out/check-in (mileage, fuel), damage reports, maintenance blocks, audit logs | todo | |
| DB-10 | Cloud adapters (unverified): Vercel Blob storage (private), Stripe test-mode provider, migrations-on-deploy script | todo | |

### app
| ID | Task | Status | Notes |
| --- | --- | --- | --- |
| APP-1 | Design system, layout, navigation, responsive shell, loading/empty/error states | todo | |
| APP-2 | Auth: register, login, logout, session, role guards (Better Auth) | todo | needs DB-1 |
| APP-3 | Home + search + filters + results | todo | needs DB-3 |
| APP-4 | Vehicle details + availability calendar + branch/date selection | todo | needs DB-3 |
| APP-5 | Extras + price breakdown + checkout (driver details, licence upload, payment) | todo | needs DB-4..6 |
| APP-6 | Pick-up voucher with reference + QR code | todo | needs DB-5 |
| APP-7 | My rentals (view, modify dates, cancel), profile | todo | needs DB-7 |
| APP-8 | Admin: branches, fleet, pricing, reservations, check-out, check-in, damage reports | todo | needs DB-9 |
| APP-9 | Private licence/damage file serving (owner + admin only) | todo | |

### qa
| ID | Task | Status | Notes |
| --- | --- | --- | --- |
| QA-1 | Test harness: clean test DB per run, migrations on clean DB, factories | todo | |
| QA-2 | Auth + authorization tests (incl. cross-user access to reservations, vouchers, licences) | todo | |
| QA-3 | Search, filters, date ranges, availability calendar tests | todo | |
| QA-4 | Concurrency: two sessions reserve overlapping dates at once → exactly one succeeds; back-to-back allowed | todo | |
| QA-5 | Pricing tests: daily rates, extras, one-way, VAT, late return, deposit | todo | |
| QA-6 | Payments: success, failure, cancel, retry, refund, deposit release, duplicate webhooks | todo | |
| QA-7 | Expired holds release (idempotent, repeated runs) | todo | |
| QA-8 | Admin permission tests (fleet, pricing, check-in, damage reports) | todo | |
| QA-9 | Playwright E2E: full rental search → payment → voucher → check-out → return; desktop + mobile | todo | |
| QA-10 | Production build (`pnpm build`) + start smoke test | todo | |

### Deployment (blocked until the user provides cloud links)
| ID | Task | Status | Notes |
| --- | --- | --- | --- |
| DEP-1 | Vercel project, preview + production envs | blocked | needs user's cloud links |
| DEP-2 | Neon via Vercel Marketplace, pooled `DATABASE_URL`, unpooled for migrations | blocked | |
| DEP-3 | Vercel Blob, Stripe test keys + webhook secret, Vercel Cron with CRON_SECRET | blocked | |
| DEP-4 | Deployed end-to-end verification | blocked | |
