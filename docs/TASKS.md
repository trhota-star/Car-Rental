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
| DB-1 | Drizzle schema + migrations for all 17 tables + auth tables, constraints, indexes, exclusion constraints | done | e7dfc00. 17 tables + payment_webhook_events + Better Auth tables (uuid). `period` = GENERATED tstzrange [). drizzle/0001 (custom): btree_gist, EXCLUDE on active reservations + non-cancelled maintenance blocks; cross-table overlap via triggers that lock the vehicle row then raise 23P01. |
| DB-2 | Seed script (`pnpm db:seed`): branches, categories, vehicles, features, extras, pricing rules, admin + customer users, future reservations | done | `pnpm db:seed` / `pnpm db:reset` (dev/test DBs only). 4 branches, 6 categories, 20 vehicles, 11 features, 5 extras, 15 pricing rules, 7 reservations, 2 maintenance blocks. Local logins: admin@driveeasy.local / DriveEasyAdmin!1, customer@driveeasy.local / DriveEasyCustomer!1. Seed money rows use provider `seed` (settled in DB only). |
| DB-3 | Availability + search service (filters, per-vehicle calendar) | done | src/server/availability.ts (searchVehicles, getVehicle, isVehicleAvailable, getVehicleCalendar), src/server/catalog.ts. Expired holds never block. |
| DB-4 | Pricing service (daily rate, days, extras, one-way fee, VAT, deposit, late-return charge) | done | src/server/pricing-core.ts (pure) + pricing.ts (quoteRental). Days = ceil(24h); rule pick vehicle>category, branch>any, min_days, priority; VAT bp per pick-up branch; one-way fee of return branch; late fee 60 min grace then ceil(daily/6)/h capped daily/24h + VAT. |
| DB-5 | Reservation transaction (lock, overlap check, hold, server pricing, pending reservation, idempotency) | done | src/server/reservations.ts createReservation: vehicle FOR UPDATE, inline-expire stale holds, overlap check, server price, PENDING + 15 min hold, unique idempotency key (replay), 23P01 -> VEHICLE_UNAVAILABLE. |
| DB-6 | Payment + deposit orchestration and verified webhook handling (dedupe by event id), confirm only after payment + deposit auth | done | src/server/payments.ts: payReservation (keys `<resId>:charge:<n>` / `:deposit:<n>`), handlePaymentWebhook(+Request) dedupe via payment_webhook_events, CONFIRMED only after charge SUCCEEDED + deposit AUTHORIZED via webhooks; settleReservation (idempotent refunds/deposit release/capture). |
| DB-7 | Modify dates / cancel per cancellation policy, refunds, deposit release | done | src/server/changes.ts. Policy: free > 48h before pick-up, else 1 day (rate+VAT) kept; deposit always released; date changes charge/refund the difference. |
| DB-8 | Expire holds: idempotent service + CRON_SECRET route + local command | done | src/server/holds.ts releaseExpiredHolds (expire + settle leftovers), wired to src/lib/jobs (`pnpm jobs:release-holds` now uses tsx --conditions=react-server); cron route shape unchanged. |
| DB-9 | Admin services: branches, fleet, pricing, reservations, check-out/check-in (mileage, fuel), damage reports, maintenance blocks, audit logs | done | src/server/admin/catalog.ts + operations.ts (ADMIN checked in every call, audit_logs in same tx). Check-in captures late/fuel/damage charges from deposit (fuel AED 5/% + VAT). |
| DB-10 | Cloud adapters (unverified): Vercel Blob storage (private), Stripe test-mode provider, migrations-on-deploy script | review | UNVERIFIED (no cloud links): src/lib/storage/vercel-blob-storage.ts (STORAGE_DRIVER=vercel-blob, private), src/lib/payments/stripe-provider.ts (PAYMENT_PROVIDER=stripe, sk_test_ only), scripts/migrate-deploy.mts (`pnpm db:migrate:deploy`, DATABASE_URL_UNPOOLED). Needs env vars added to .env.example by main. |
| BUG-1 | (qa, low) `createReservation` accepts licenceFileKey `licences/<me>/../<other>/licence.jpg`: the ownership check is only `startsWith('licences/<userId>/')`. Repro: `tests/integration/reservations.test.ts` > "rejects a licence key that escapes the user's folder". Expected: VALIDATION_ERROR/FORBIDDEN, nothing stored. Actual: reservation created and the key saved to driver_profiles. LocalFileStorage refuses `..` (serving then throws, 500 instead of 404); a Blob adapter may normalise it to another user's file. Fix: validate the key with the storage key pattern (no `.`/`..` segments). | done | Fixed by db in 4d4d63f (strict LICENCE_KEY_RE). Retested by qa: pass (reservations.test.ts 18/18). |
| BUG-2 | (qa, HIGH - money) Cancel a PENDING reservation after the charge succeeded at the provider but before its webhook is processed: the customer is charged and never refunded. Repro: `tests/integration/payments.test.ts` > "cancelling a PENDING reservation whose charge succeeds afterwards": createReservation -> payReservation(pm_fake_success) -> cancelReservation -> deliver webhooks -> releaseExpiredHolds. Expected: payment REFUNDED, deposit RELEASED (PENDING cancel is free). Actual: payment SUCCEEDED, refunded_fils 0, reservation CANCELLED. Cause: cancel sets refunded_fils = net paid at cancel time (0, since the charge row is still PENDING); settle tries cancelPayment (fails: already succeeded) and later refunds min(refunded_fils, paid) = 0. Fix idea: for CANCELLED, owed refund = paid - cancellation_fee (like EXPIRED) instead of a frozen amount. | review | Fixed by db in 8c9cc31: refundTarget() recomputes owed refund (CANCELLED: paid - fee) at settle time; findUnsettled matches. Awaiting qa retest. |

### app
| ID | Task | Status | Notes |
| --- | --- | --- | --- |
| APP-1 | Design system, layout, navigation, responsive shell, loading/empty/error states | doing | |
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
| QA-1 | Test harness: clean test DB per run, migrations on clean DB, factories | done | `tests/helpers/{env,db,factories,http}.ts`; vitest projects unit + integration (serial, fresh schema + all migrations per run); e2e on own `next start :3100` vs test DB, desktop-chrome + Pixel 7 + iPhone 15. DB race tests 9/9 pass. |
| QA-2 | Auth + authorization tests (incl. cross-user access to reservations, vouchers, licences) | todo | |
| QA-3 | Search, filters, date ranges, availability calendar tests | todo | |
| QA-4 | Concurrency: two sessions reserve overlapping dates at once → exactly one succeeds; back-to-back allowed | doing | DB-level races pass (25x reservation vs reservation, 25x vs maintenance, back-to-back). Service-level pending DB-5. |
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
