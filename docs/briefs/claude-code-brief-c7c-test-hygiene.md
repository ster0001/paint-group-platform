# Chunk C7c — Test-project hygiene

**Slots into:** `docs/briefs/estimator-v2-runsheet.md` §5, after C7b, before C8.
**Size:** M. **Migration:** none on production. The sweep may add a scheduled function on the test project only.
**Why it exists:** on 11 September the test project `qarfyjrzgdeoqbnbbxfp` exhausted its disk IO budget and became unusable. The cause was months of test data nothing ever removed, on a `t4g.nano`, hit by seven concurrent e2e runs. Production was never touched and that was proved (33 estimates, zero auth errors, no `pg.e2e.*` rows). The project was recreated. **Nothing in that recreate stops it happening again** — this chunk does.

> **If Claude Code has already drafted a C7c, read both and report the differences before building.** This brief is the specification; an existing draft may be further along.

---

## What already landed on 11 September (do not rebuild)

- All eight CI secret fallbacks removed; the three `E2E_*` secrets now exist in their own right and the plain-named ones were deleted.
- The three guards (`e2e/global-setup.ts`, `scripts/seed-target.mjs`, `scripts/c1/env.mjs`) read `PRODUCTION_SUPABASE_REF` and refuse when it is unset, blank or malformed. `seed-target.mjs` also refuses a target it cannot name.
- e2e concurrency: `group: e2e-test-project`, `cancel-in-progress: false`.
- The push trigger gated to main, with `workflow_dispatch` for branches.
- Test project recreated from `docs/testing/c1-test-project.md`.

Confirm each of these is on `main` in step 1. Anything not merged is this chunk's first job.

---

## Step 1 — Report before building (no code)

    Report with file:line, and wait:
    1. Which of the five items above are merged to main, and which are not.
    2. Every place an e2e run creates a row that outlives the run: anonymous
       users, pg.e2e.* logins, auth.sessions, auth.refresh_tokens, and any
       public-schema rows (estimates, drafts, invoices, profiles). Name the
       spec or fixture that creates each.
    3. Whether e2e has any teardown at all today — global, per-spec, or none.
    4. Whether the seeded e2e logins (staff, contractor, customer) are
       distinguishable in data from run-created users, and how. A sweep that
       cannot tell them apart is not safe to write.
    5. Whether a scheduled function can run on the test project under its
       plan, or whether the sweep must be a workflow on a cron.
    Then propose the smallest implementation and wait.

---

## Step 2 — Teardown: a run cleans up after itself

Global teardown in Playwright, running whether the suite passed or failed.

- Deletes the anonymous users and `pg.e2e.*` logins **created by this run**, identified by a run marker — a timestamp or run id recorded at setup, not a pattern match over all time. A teardown that deletes by prefix alone will eventually delete a fixture.
- **Never touches the seeded logins** (staff, contractor, customer) — exclude them by id, held in one list, and assert the list is non-empty before deleting anything.
- Refuses to run at all unless the target is the test project, through the same guard as `global-setup.ts`. **The teardown deletes; it must be at least as paranoid as the setup.**
- Deletes in an order the 43-table FK fan-out allows, in batches, with a time budget — if it cannot finish, it logs what remains rather than hanging the job.

  **The order is not a preference — six columns make it mandatory.** These
  reference `auth.users` with **no ON DELETE action**, so Postgres REFUSES the
  user delete while any of them still points at it:

      public.estimates.created_by
      public.estimates.site_check_cleared_by
      public.wizard_leads.user_id
      public.estimate_sources.created_by
      public.extraction_runs.created_by
      public.defect_observations.confirmed_by

  An anonymous wizard customer writes `estimates.created_by` on their first
  save, so this is the common case, not an edge one: **the estimate chain goes
  first, then the user.** A teardown that deletes users first does not corrupt
  anything — it simply fails, every time, and looks like a permissions problem.

  One more reason the order matters: `public.profiles.id` is the single
  **ON DELETE CASCADE** in the whole fan-out. Deleting an auth user silently
  deletes their profile row. That is correct for a run-created user and
  catastrophic for a seeded login, which is why the exclusion list above is a
  hard precondition rather than a nicety.

  **Batching is forced by cost, not tidiness.** `20270104000000_auth_user_fk_indexes.sql`
  measured a single auth-user delete on this project at **13.5 s** — 43
  columns are checked and only 6 of the hot ones are indexed. A teardown
  looping over even 50 users is eleven minutes; a sweep over thousands would
  re-create the outage it exists to prevent. So: a bounded batch per run
  (start at 200 for the sweep, the run's own count for the teardown), oldest
  first, and report what is left rather than pressing on.
- Logs a one-line summary: created N, deleted N, left N.

---

## Step 3 — The sweep

A scheduled job on the test project only, catching what teardown misses when a run is cancelled or crashes.

- Deletes anonymous users and `pg.e2e.*` logins older than `sweep_age_days` (default 3), plus the public-schema rows those runs created.
- Same exclusion list, same guard, same batching.
- Reports what it removed, so a sudden jump is visible.
- If a scheduled function isn't available on the plan, a cron workflow calling the same script is fine — one implementation, two triggers.

---

## Step 4 — The tripwire

The failure everyone missed was that nothing was watching. Row counts grew for months and were found by tripping over them.

- A cheap check at the **start** of every e2e run: count anonymous users and `pg.e2e.*` logins on the test project.
- **The counts are logged on EVERY run, whatever they are** — one line, always, before any threshold is consulted. This is the point of the check, not a side effect of it: the visible number is what catches drift, and the threshold is only the backstop. A tripwire that says nothing until it fails is one nobody trusts, and nobody reads. It also means the trend is in the job log of every run, so "when did this start?" is answerable afterwards without new tooling.
- Above `warn_rows` (default 5,000) it additionally warns. Above `fail_rows` (default 20,000) it **fails the job** with a message naming the sweep.
- Cost must be one indexed count, not a table scan — report the query plan.
- The point is to catch this at a thousand rows, not forty thousand.

---

## Step 5 — Write the rules down

In `CLAUDE.md`, as standing rules:

1. A missing environment variable stops the run. No guard may hardcode or infer a project ref, and an unidentifiable target is never treated as safe.
2. No CI secret may fall back to another environment's secret. A missing secret fails the job.
3. e2e runs one at a time, and only on pull_request, main, or `workflow_dispatch`.
4. Anything an e2e run creates, an e2e run removes. A suite that accumulates data is a defect.

And an incident note in `docs/reference/` — date, cause, evidence that production was untouched, what changed. Two paragraphs; the value is that the next person finds it.

---

## Acceptance

- A full e2e run leaves the same anonymous-user and `pg.e2e.*` count it started with, ±0. Proved by counting before and after in CI.
- Teardown runs after a **failing** suite, proved by a deliberately failing spec.
- Teardown and sweep both refuse when pointed at anything but the test project — proved by a test, not by inspection.
- The seeded logins survive a teardown, a sweep and a full suite — proved by logging in as staff afterwards.
- The tripwire fails the job above the threshold, proved by seeding past it in a test.
- `grep` finds no CI secret with a `||` fallback to another environment.
- Unit count reported before and after.

**Tom's check:** run the suite twice on the preview; the second run starts as fast as the first, and the test project's row counts are unchanged. Then log in as the e2e staff user — it still works.

---

## ⚑ Decisions

| # | Decision | Default unless you say otherwise |
|---|---|---|
| 43 | Sweep age | 3 days |
| 44 | Tripwire thresholds | warn 5,000 · fail 20,000 — **and the counts are logged every run regardless**, so drift is visible long before either number is reached (Tom, 11 Sep) |
| 45 | Teardown on a failed run | Yes — always runs, logs what it couldn't finish |
| 46 | Test project tier | Report what the next tier up costs. A `t4g.nano` was always going to fall over once the data grew; if the suite needs more, better to know now than rebuild twice |
| 47 | Production FK fan-out (43 tables, 37 unindexed) | **Not this chunk.** Report it for a later batch — production has the same shape, and a real customer deletion there is the same 13.5 s |

---

## Reference files

    docs/testing/c1-test-project.md                  (the recreate procedure — the source of truth)
    docs/briefs/estimator-v2-runsheet.md             (the loop this chunk runs inside)
    e2e/global-setup.ts                              (the guard the teardown must match)
    scripts/c1/seed.mjs                              (what the seeded logins are)
    .github/workflows/ci.yml                         (concurrency, triggers, secrets)
    CLAUDE.md                                        (where the four rules land)

Ledger row on completion, including the tier answer from ⚑46 and the FK report from ⚑47.
