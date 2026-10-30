# DriveEasy

Car rental app. Next.js (App Router) + TypeScript + Tailwind + Drizzle/PostgreSQL. Runs fully locally.

## First-time setup

1. `pnpm install`
2. `pnpm db:setup` — creates the `driveeasy` user and the `driveeasy_dev` / `driveeasy_test`
   databases (with `btree_gist`) on local PostgreSQL 18 (DriveEasy server, port 5434). Uses the admin password saved in `%APPDATA%\postgresql\pgpass.conf`
   (Windows service `postgresql-driveeasy`, data in `C:\ProgramData\DriveEasy\pg18`).
3. `pnpm db:check` — confirms both databases are reachable.
4. `pnpm dev` — http://localhost:3000

Settings live in `.env.local` (not committed). `.env.example` lists every variable.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm test` / `pnpm test:e2e` | Vitest unit tests / Playwright browser tests |
| `pnpm typecheck`, `pnpm lint` | TypeScript and ESLint |
| `pnpm db:generate`, `db:migrate`, `db:push`, `db:studio` | Drizzle Kit |
| `pnpm jobs:release-holds` | Release expired booking holds once (`jobs:watch` = every 5 min) |
| `pnpm payments:fake <pay\|refund\|hold\|release> [success\|fail\|cancel\|pending] [--duplicate]` | Send fake payment webhooks to the running dev server |

## Local stand-ins for cloud services

Each one sits behind an interface and is chosen by a setting, so a cloud service can replace it later.

| Service | Interface | Local (now) | Setting |
| --- | --- | --- | --- |
| Payments | `src/lib/payments/types.ts` | `FakePaymentProvider`: succeed, fail, cancel, refund, deposit hold/release/capture, signed webhooks (optionally duplicated) | `PAYMENT_PROVIDER=fake` |
| File uploads | `src/lib/storage/types.ts` | `LocalFileStorage` in `./storage/uploads` (private, outside `public/`) | `STORAGE_DRIVER=local` |
| Scheduled cleanup | `src/lib/jobs` | `pnpm jobs:release-holds`; cloud cron calls `GET /api/cron/release-holds` with `Authorization: Bearer $CRON_SECRET` | `SCHEDULER_DRIVER=local` |

Fake payment methods: `pm_fake_success`, `pm_fake_fail`, `pm_fake_cancel`, `pm_fake_pending`.
