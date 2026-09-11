# C7c — the test project stops filling up

> **SUPERSEDED, 11 Sep 2026.** The canonical C7c brief is
> `docs/briefs/claude-code-brief-c7c-test-hygiene.md`, which arrived in
> hand-over rev 2 and is more complete — it adds the seeded-login exclusion
> list, teardown after a *failing* suite, a query-plan requirement, and the
> incident note. The two things this draft had that it did not are now folded
> into it: the mandatory FK delete order (six columns reference `auth.users`
> with no ON DELETE action) and the 13.5 s per-user cost that forces batching.
> Kept for the reasoning, not as a specification. Build to the canonical one.

**Status:** drafted 11 Sep 2026, not built. Sits between C7 and C8.

## Why

On 11 Sep the C1 test project (`qarfyjrzgdeoqbnbbxfp`, a `t4g.nano`) went
Unhealthy: compute 98%, gateway cycling, `/auth/v1/signup` timing out, and
eventually the pooler itself answering "connection to database not available".
Seven concurrent CI e2e runs were the trigger, and the workflow has been
fixed for that (constant concurrency group; e2e no longer runs on every push).

But the load only mattered because the project had been filling up for months,
and **nothing in the suite has ever removed what it creates**:

| what accumulates | how | evidence |
|---|---|---|
| anonymous `auth.users` | every customer-journey spec opens with `signInAnonymously` | `auth.users` passed 2,000 (6 Sep), then 10,820 profiles (11 Sep) — the `listUsers` paging cap was raised twice before being removed |
| `pg.e2e.*` logins | `portal-shell`, `trade-money-team`, `account-rls`, `trade-org-rls` create per-run users | 109 orphaned logins found 5 Sep |
| `E2E-LP-*` invoices | ledger-parity creates 8 per run; its teardown was fire-and-forget | **40,313 rows** from a product nobody has invoiced with |

Deleting an auth user costs **13.5 s** here (`20270104000000_auth_user_fk_indexes.sql`
measured it) because 43 columns reference `auth.users` and only 6 of the hot
ones are indexed. So cleanup gets more expensive exactly as it gets more
necessary — which is why it has to be continuous, not a rescue operation.

**The rule this chunk encodes: a test run leaves the project as it found it,
and says so loudly when it cannot.**

---

## C7c.1 — the run cleans up after itself

A Playwright `globalTeardown` (there is none today — `playwright.config.ts`
names only `globalSetup`).

It must be **bounded by the run**, never "delete all anonymous users": a
developer's run and a CI run can overlap, and a blanket delete would pull the
ground out from under the other one. So the teardown deletes only what this
process created, identified by a **run id** stamped at setup:

- `globalSetup` generates `E2E_RUN_ID` (short, sortable, e.g. `r<base36 ms>`)
  and puts it in `process.env` so fixtures can read it.
- Anonymous users are not nameable at creation (the browser calls
  `signInAnonymously`), so the teardown takes them by **time window and flag**:
  `is_anonymous = true AND created_at >= <the run's start>`. The window is the
  run's own, which is what keeps it from touching a concurrent run's rows —
  with a small safety margin excluded at the tail.
- `pg.e2e.*` logins already carry a per-run suffix; the teardown deletes by
  the `pg.e2e.%<run>%` pattern.

**Deletion order matters.** Six columns reference `auth.users` with **no ON
DELETE action**, so the delete is REFUSED while any of them still points at
the user: `estimates.created_by`, `estimates.site_check_cleared_by`,
`wizard_leads.user_id`, `estimate_sources.created_by`,
`extraction_runs.created_by`, `defect_observations.confirmed_by`. The
teardown therefore removes the estimate chain first (which is what the
existing `destroyLoopFixture` purge helper already does, checked delete by
checked delete), then the users.

**It reports rather than hopes.** `destroyLoopFixture` was made to check every
delete on 11 Sep after fire-and-forget deletes left 40,313 rows behind; the
same rule applies here. A teardown that cannot clean up **fails the run** —
silent cleanup is not cleanup, it is a leak with good manners.

Acceptance: a spec run leaves `auth.users` at the count it started at (±0);
killing the teardown mid-way and re-running reconciles; two concurrent runs do
not delete each other's rows.

## C7c.2 — a scheduled sweep for what escapes

Teardown will miss things: a killed run, a crashed browser, a spec that
throws before its fixture registers. So a sweep, and it runs **on the test
project only**.

- A GitHub Actions workflow on a `schedule` (daily, off-peak Melbourne),
  plus `workflow_dispatch`. It must carry `PRODUCTION_SUPABASE_REF` and refuse
  exactly as every other tool does.
- Deletes anonymous `auth.users` older than **N days** (default 3 — long
  enough that a run in flight is never touched, short enough that the count
  never reaches four figures), and `pg.e2e.*` logins older than the same.
- Batched and rate-limited: at 13.5 s per user a naive loop would run for
  hours and re-create today's outage. It deletes a bounded number per run
  (start at 200), oldest first, and reports what is left. Slow and repeated
  beats one long transaction.
- Never runs against production: the guard plus an explicit assertion that
  the target ref is NOT the production ref.

Acceptance: run it twice against a project with 5,000 stale anonymous users
and the count goes down by exactly 200 each time, with no impact on a
concurrent e2e run.

## C7c.3 — the cheap check that fails loudly at a thousand, not forty thousand

The real failure on 11 Sep was not the row count. It was that **nobody was
looking**. Both `10,820 profiles` and `40,313 invoices` were discovered while
debugging something else.

So: a fast row-count assertion in the e2e `gate`, or as its own quick job —
one query, no browser.

```
select relname, n_live_tup from pg_stat_user_tables where n_live_tup > <threshold>
```

with per-table thresholds committed to the repo (a small JSON/TS table), and
an explicit `auth.users` count. Crossing a threshold **fails the job** with
the table name and count, and the message says what to run.

Thresholds are deliberately low — a test project should be small. Starting
points: `auth.users` 1,000 · `estimates` 2,000 · `invoices` 1,000 ·
`wizard_drafts` 2,000 · `profiles` 1,000 · anything else 5,000. They are
committed values, so raising one is a visible decision in a diff rather than
a number quietly drifting.

Acceptance: seed 1,001 rows into a watched table and the job fails naming it;
the check adds < 2 s to the run.

---

## What this does NOT do

It does not make the test project bigger, and it does not delete anything on
production. The production question — 43 columns referencing `auth.users`
with 37 of them unindexed, so a real customer deletion pays the same 13.5 s
fan-out — is a separate report, deliberately out of scope here.
