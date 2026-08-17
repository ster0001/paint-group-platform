import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end smoke tests.
 *
 * These run against a REAL browser and the REAL Supabase project — there is no
 * local database to point them at. That is why they are not part of `npm test`:
 * the unit suite must stay safe to run at any moment, while these are run
 * deliberately, with `npm run test:e2e`.
 *
 * Credentials come from the environment and nothing is defaulted, so this file
 * carries no secrets:
 *
 *   E2E_CONTRACTOR_EMAIL / E2E_CONTRACTOR_PASSWORD   a test contractor login
 *   E2E_STAFF_EMAIL      / E2E_STAFF_PASSWORD        a staff login
 *
 * A spec whose credentials are missing SKIPS with a message rather than failing,
 * so a partial setup gives a partial result instead of a wall of red.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // they share one database; keep them in order
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
