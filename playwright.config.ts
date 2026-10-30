import { defineConfig, devices } from "@playwright/test";
import { e2eDatabaseUrl } from "./tests/helpers/env";

// E2E runs against its OWN server on the E2E test database driveeasy_e2e_test (never dev):
//   default            -> `next build` + `next start` on port 3100 (production mode; dev can't run twice per project)
//   E2E_BASE_URL=...   -> reuse an already running server (you are responsible for its DB)
//   E2E_SERVER=dev     -> `next dev` on 3100 (only when no other `next dev` is running here)
const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;
// Browser/API tests use their own database so they never collide with a Vitest run.
const testDb = e2eDatabaseUrl();
process.env.QA_DATABASE_URL = testDb; // tests/api helpers read the same DB
// The DB is reset + seeded first (prepare-db), then the app is built/started against it.
const prepareDb = "pnpm exec tsx tests/e2e/prepare-db.ts";
const serverCommand =
  process.env.E2E_SERVER === "dev"
    ? `${prepareDb} && pnpm exec next dev -p ${PORT}`
    : `${prepareDb} && pnpm build && pnpm exec next start -p ${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  timeout: 60_000,
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    // HTTP-level tests (auth, authorization, webhooks): run once, no browser.
    { name: "api", testDir: "./tests/api", use: { extraHTTPHeaders: { origin: baseURL } } },
    { name: "desktop-chrome", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-pixel7", use: { ...devices["Pixel 7"] } },
    { name: "mobile-iphone", use: { ...devices["iPhone 15"] } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: serverCommand,
        url: baseURL,
        reuseExistingServer: false,
        timeout: 600_000,
        stdout: "pipe",
        env: {
          DATABASE_URL: testDb,
          APP_URL: baseURL,
          BETTER_AUTH_URL: baseURL,
          FAKE_PAYMENT_WEBHOOK_URL: `${baseURL}/api/webhooks/payments`,
          LOCAL_UPLOADS_DIR: "./storage/test-uploads",
        },
      },
});
