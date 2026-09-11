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
 * so a partial setup gives a partial result instead of a wall of red — LOCALLY.
 * Under CI that behaviour is a lie (a green run that asserted nothing), so
 * e2e/global-setup.ts turns a missing credential into a failed run instead.
 * It also refuses to start if the target is the production project.
 */
/** The app the browser will drive. Unset is refused in e2e/global-setup.ts. */
const E2E_BASE = process.env.E2E_BASE_URL ?? "";
const E2E_PORT = E2E_BASE ? (() => { try { return new URL(E2E_BASE).port; } catch { return ""; } })() : "";

export default defineConfig({
  testDir: "./e2e",
  // Production tripwire + the CI credential assertion (audit A1-06 / A1-07).
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false, // they share one database; keep them in order
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    /**
     * NO DEFAULT (11 Sep 2026). This read `?? "http://localhost:3000"`, and a
     * dev server left running from the main checkout serves PRODUCTION. With
     * `reuseExistingServer: true` below, every bare `npx playwright test` drove
     * a production-backed app while global-setup reported "safe" — it only
     * checked the database the fixtures talk to. 552 @example.com rows in
     * production wizard_drafts came through that door.
     *
     * global-setup refuses the run when E2E_BASE_URL is unset, with the command
     * to use. An empty string here would otherwise resolve relative paths
     * against nothing, which fails late and confusingly instead of early.
     */
    baseURL: E2E_BASE || undefined,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  /**
   * NO app named, no app started.
   *
   * `webServer` runs BEFORE globalSetup, so leaving it configured when
   * E2E_BASE_URL is unset means Playwright boots something — on whatever port
   * `npm run dev` picks — and the tripwire never gets to speak. Undefined here
   * lets globalSetup refuse with an explanation instead.
   *
   * When a base URL IS named, the dev server is started on ITS port. The old
   * config said 3000 and ran a bare `npm run dev`, which is how a server
   * already on 3000 — pointed at production — got adopted by
   * `reuseExistingServer` and driven by every spec.
   */
  webServer: E2E_BASE ? {
    command: E2E_PORT ? `npm run dev -- -p ${E2E_PORT}` : "npm run dev",
    url: E2E_BASE,
    reuseExistingServer: true,
    timeout: 120_000,
  } : undefined,
});
