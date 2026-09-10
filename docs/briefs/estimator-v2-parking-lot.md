# Estimator v2 — parking lot

Things noticed outside the chunk being built. One line each, with a `file:line`. Nothing here is
acted on in the session that found it (run sheet §1: no "while I was in there"). Tom decides what
graduates into a chunk or its own PR.

| Found in | Line |
|---|---|
| C0 | **RESOLVED** — `fix/seed-target-guard`. Five (not six) seed scripts resolved their target from `.env.local` and ignored the environment: `scripts/portal/seed-demo-customer.mjs:1`, `scripts/seed-demo-loop.ts:1`, `scripts/create-test-customer.ts:1`, `scripts/create-test-contractors.ts:1`, `scripts/seed-extraction-settings.ts:1`. `scripts/c1/seed.mjs` was already guarded by `scripts/c1/env.mjs` `refuseProduction` — the C0 report over-counted it. |
| C0 | Three files cited by `docs/briefs/claude-code-brief-estimator-journey-v2.md:§1` do not exist in any ref: `docs/briefs/wizard-project-allowances-spec.md`, `docs/briefs/rebuild-plan-v2.md`, `docs/briefs/business-inputs.md`. None are in the run sheet's Step 0 list. C10 (site & access) is the first chunk that wants the allowances spec — `lib/wizard/site-access.ts:135` was already built without it. |
| C0 | Migration number collision on disk: the main checkout holds untracked `supabase/migrations/20270111000000_contractor_invoice_submit_remainder.sql` while main carries `20270111000000_room_allowances.sql` at the same number. |
| C0 | Seven duplicate migration numbers on main (`20260917`, `20261211`–`20261214`, `20261229`, `20270110`) and a five-number gap (`20270115`–`20270119`) that exists on no branch. Filename, not number, is the identity — `supabase/migrations/`. |
| C0 | `20270112` (`fix/qa-recheck`) and `20270113` (`fix/console-tick-index`) are described in session notes as "queued for prod" but are on unmerged branches, not on main. Either merge them or stop counting them. |

| C0 | Two production-refusal mechanisms now exist: `scripts/seed-target.mjs:34` hardcodes `PRODUCTION_REF`, while `scripts/c1/env.mjs` `productionRef()` derives it from `.env.local`. Neither is wrong and they guard different scripts, but they should be one helper. Not unified here — outside the ported change. |