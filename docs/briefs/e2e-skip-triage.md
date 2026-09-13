# e2e conditional skips — the C17 triage (14 Sep 2026)

329 `test.skip(...)` calls across 171 specs (the C17 block counted 309 on
12 Sep; C13–C16 added their own). The question for each: does it hide a
green run that asserted nothing?

| Guard | Calls | What it means | Verdict |
|---|---|---|---|
| `!db` (and `!db \|\| …`) | ~100 | `SUPABASE_SERVICE_ROLE_KEY` absent | **Kept, harmless in CI.** `e2e/global-setup.ts` with `CI=1` turns a missing credential into a failed run before any spec starts, so in CI these never skip. Locally they let a developer run the UI-only specs without the key. |
| `!staff` / `!staff.email` | ~75 | `E2E_STAFF_*` absent | same as above — a CI failure, a local convenience |
| `!contractor` | ~30 | `E2E_CONTRACTOR_*` absent | same |
| `!customer` | 5 | `E2E_CUSTOMER_*` absent | same |
| `!migrationReady` | 35 | a probe SELECT on a table the spec needs failed | **Kept, by design.** Each probe names the migration; on a project where it has not run the spec must not assert against a missing table. The ten C15 rows are on test and prod now, so none of these skip there. |
| `!seeded` / `!url` / `!SECRET` / `missing` | ~23 | reference data, a fixture URL or a cron secret absent | **Kept.** They name what is missing; CI provides all of it (`CRON_SECRET` is set in the workflow). |
| `test.skip(true, "wizard_public … off")` | 7 | the wizard's holding page was showing | **DELETED (C17).** Replaced by `expectWizardOn(page)` in `e2e/fixtures/portal.ts`: the test project must have the wizard ON, and a run against a mis-set project now FAILS naming the setting, instead of passing with nothing asserted. Files: portal-shell, portal-commercial, portal-full-loop, portal-volume (two), portal-builder (two). |

So the honest count is: **7 skips hid a broken environment and are gone; the
rest are credential and migration guards that CI already converts into
failures.** No skip in the customer-journey folder or the trade walk is
unconditional.

## Where CI stands after C17

- The job runs `e2e/customer-journey` (48 specs after C17's three new
  stories), the four RLS/ledger specs and `e2e/trade-walk-a.spec.ts`.
- It fails at the secrets step until `E2E_DATABASE_URL` (the TEST project's
  session-pooler connection string, `C1_DATABASE_URL` in `.env.test.local`) is
  added as a REPOSITORY secret. Every other secret is present.
- PR #79's key↔project guard and bounced-submit retry are merged into C17.
