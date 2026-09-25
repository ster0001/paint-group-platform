# Supabase Security Advisor — 25 Sep 2026

Tom: "check and look at the errors on my supabase account and secure it". The
Security Advisor on production (`llmrvgdequpmzzuaxdhq`) showed **2 errors,
742 warnings, 4 info**. The advisor is Supabase's `splinter` linter; the same
queries were run directly against the test project (identical schema, one
extra table) to get the full list, fix it, and measure the result.
Migration: `20270201000000_security_advisor_hardening.sql` — for Tom to paste
on TEST and PROD (read-back row must equal its `_expect_` values).

## What the advisor reported, and what changed

| Lint | Level | Before | After | What was done |
|---|---|---|---|---|
| `security_definer_view` | **ERROR** | 2 | 0 | `wo_visible_jobs` and `customer_quote_lines` moved to a new `private` schema. Definer semantics are intended (see below); the fix is to keep them out of the API-exposed schema. RLS policies reference the view by oid, so the nine `wo_*` read policies are unaffected. |
| `rls_disabled_in_public` | ERROR (test only) | 1 | 0 | `_c1_migrations`, the test runner's ledger. RLS enabled in `apply-migrations.mjs`. Production never had it. |
| `function_search_path_mutable` | WARN | 37 | 0 | Every public function with no pinned `search_path` gets `public, extensions`. All 37 are SECURITY INVOKER trigger/helper functions. |
| `anon_security_definer_function_executable` | WARN | 268 | 42 | `anon` (a request with no session at all) revoked from every definer function, granted back to the 42 that a token page (`/e`, `/w`, `/s`, `/v`, `/i`, `/crew`, `/join`) or an RLS policy needs. |
| `authenticated_security_definer_function_executable` | WARN | 293 | 255 | Revoked from the 42 trigger functions and 27 internal helpers no file in `app/`, `lib/`, `scripts/` or `e2e/` names. The 255 left are RPCs the app calls with a user session; each guards itself (`is_staff()`, ownership checks) — the 18 Sep audit covered that. |
| `public_bucket_allows_listing` | WARN | 7 | 0 | Dropped the `for select to public` policy on each public bucket. Public URLs and image transforms never consult policies; the policy only allowed *listing* the bucket. Nothing in the app lists or API-downloads these buckets. |
| `rls_enabled_no_policy` | INFO | 4 | 4 | The four `*_gcal_*` tables hold OAuth tokens and are service-role only by design. Correct as is. |
| Anonymous sign-ins allowed | WARN (dashboard) | 1 | 1 | Intentional — the wizard signs customers in anonymously. Left on. |
| Leaked password protection disabled | WARN (dashboard) | 1 | **1 — Tom** | Dashboard toggle: Authentication → Attack Protection → "Prevent use of leaked passwords". Not reachable from SQL. |

Also new: `alter default privileges … revoke execute on functions from public,
anon, authenticated` — a function created from now on is callable only by
`service_role` until its migration grants what it needs. This is deliberate:
a forgotten grant fails loudly (`42501`) on the test project; a forgotten revoke
used to fail silently, as findings 2 and 8 of the 18 Sep audit showed.

Performance-advisor items (`auth_rls_initplan` 13, `multiple_permissive_policies`
55, `unindexed_foreign_keys` 118, `unused_index` 37, `table_bloat` 2) were not
in scope — none is a security issue.

## Why the two views are SECURITY DEFINER on purpose

- `wo_visible_jobs` answers "which work orders can the caller see" for staff,
  the assigned contractor, crew members and the customer. A contractor cannot
  read `estimates` or `customers`, so a SECURITY INVOKER version would return
  nothing for them and every `wo_*` policy that uses it would go dark.
- `customer_quote_lines` was built on 13 Aug so a customer could read line
  descriptions without the `cost_cents` column on `estimate_lines`. Customers
  now read snapshots, and no code selects the view; it is kept, not dropped.

Both are still readable through the API for anyone who can name
`private.wo_visible_jobs` — the view filters by caller identity, so the
answer is the same rows they could see before.

## How the grant lists were built

1. `pg_proc` on the test project: 300 SECURITY DEFINER functions, 42 of them
   trigger functions, 10 referenced from RLS policies or views.
2. Every function name searched as a quoted string across `app/`, `lib/`,
   `scripts/`, `e2e/` (test files excluded). This catches the `run("assign_job")`
   and `call("timesheet_start")` wrappers that a literal `.rpc("…")` grep misses.
   A name found nowhere is internal-only → loses `authenticated`.
3. `anon` kept where the name appears in a token-route directory, or a past
   migration granted it to anon by name (`post_estimate_message_by_token`), or
   it is a policy helper.
4. Six boolean helpers (`wo_is_*`, `wo_has_painter`, `wo_painter_on_job`,
   `wo_painters`, `current_role`) keep `authenticated` even though nothing
   names them — they are harmless and cheap insurance against a policy on
   production referencing one.

## Verification

- Migration applied to the test project in one transaction; read-back row
  equal to every `_expect_` value.
- `splinter` re-run on the test project: 0 errors; security warnings
  605 → 297 (the 42 + 255 that are by design).
- Vitest 3029/3029, lint 0 errors, typecheck clean.
- e2e: see the PR.

## Manual test script for Tom (after pasting on prod)

1. Advisors → Security Advisor → **Refresh**: Errors 0; Warnings ≈ 300, all
   of type "Signed-In Users Can Execute SECURITY DEFINER Function" or
   "Public Can Execute …" (42) plus the two auth ones.
2. Open a live estimate link (`/e/<token>`) in a private window — loads, Accept
   still works.
3. Open a work-order link (`/w/<token>`) and a sign-off link (`/s/<token>`) the
   same way.
4. Sign in as staff: Home, CRM board, Invoicing, a job sheet, tick a surface.
5. Portal as a painter: open a job, tick an item, upload a photo.
6. Product photos and estimate media still show on an estimate page.
7. Authentication → Attack Protection → turn on "Prevent use of leaked passwords".
