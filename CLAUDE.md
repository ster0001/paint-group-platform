# Engineering standards — paint-group-platform
These rules are mandatory for all work in this repo. If a task conflicts with a rule, stop and flag it instead of breaking the rule.

## Architecture boundaries
- Estimate pricing math lives in ONE module (`lib/pricing/`). No component, route or script computes prices independently. All money is integer cents; format only at the display edge.
- Customers see SNAPSHOTS. Any surface reached by token (`/e/[token]`, `/w/[token]`) renders snapshot data, never live drafts.
- Shared estimate components take a `mode` prop (staff | customer). Never fork a component into two diverging copies.
- Contractor-facing HTML must never contain customer pricing, margin, or customer contact details beyond first name + phone. This is enforced in the server render, not by CSS hiding.
- State machines (estimate status, booking offers, job stages) are Postgres enums with transitions changed only through dedicated server functions that validate the current state. No route sets a status column directly.
- **One work queue** (CRM shell brief §1, standing rule for every future module): a module that needs to tell a person something emits a work item through `lib/crm/work-queue.ts` — one source function plus a registry entry. It does not build its own outstanding-work list, badge, inbox or queue; two implementations of "what needs attention" is a single-source violation. Work items are DERIVED from facts, never stored — a `work_items` table fails review.

## Security
- RLS enabled on EVERY table, no exceptions, including new ones. Every migration that creates a table includes its policies in the same file.
- The Supabase service-role key exists only in server-side env (`SUPABASE_SERVICE_ROLE_KEY`), never imported into anything under `app/**/client` or components marked "use client".
- Public tokens are ≥ 24 chars from `crypto.randomBytes` (base64url). Token routes: no sequential IDs anywhere in the URL, 404 (not 403) on unknown tokens, and rate-limited.
- Every API route and server action validates its input with zod before touching the database. Never trust client-computed totals — recompute server-side.
- File uploads: validate MIME type and size server-side; storage buckets have explicit policies (public read only where the spec says so; contractor docs and bank details are never public).
- Bank/payment details: encrypted at rest, displayed masked, changes trigger a staff alert.
- Cron and webhook endpoints require a shared-secret header check.
- No secrets, keys, or real customer data in the repo, in seed scripts, or in test fixtures.

## Reliability
- TypeScript `strict: true`; `any` is banned (use `unknown` + narrowing). Lint and typecheck must pass before any commit.
- Multi-step money operations (repricing cascades, invoice generation, variation approval) run in a single Postgres transaction via an RPC — never as sequential client calls.
- Database constraints mirror business rules: NOT NULL, CHECK (amounts ≥ 0), UNIQUE (one live offer per job, one invoice per milestone), FK with intentional ON DELETE behaviour. The DB is the last line of defence, not the app.
- Every feature ships with tests for its money math and state transitions (Vitest), and the critical paths keep passing Playwright smoke tests: build estimate → send → customer accepts; offer job → contractor accepts → customer confirmation fires.
- User-visible errors are friendly; real errors go to the error monitor (Sentry) with context. No silent catch blocks.

## Performance
- Server Components by default; "use client" only where interaction requires it.
- No N+1 queries: fetch lists with joins/RPCs, one round trip per screen where possible. Every FK and every token/status column used in a WHERE has an index, created in the same migration.
- Images through `next/image` with Supabase transforms; videos streamed, never proxied through the app server.
- Paginate anything unbounded (jobs, products, activity). Public estimate pages must score ≥ 90 Lighthouse performance on mobile.

## Migrations and RLS — learned the hard way (WO loop, Aug 2026)
- **A migration "running" is not the same as its statements applying.** Three separate things from the tail of one migration file — the RLS policies, the booking→stage trigger, and a revoke — were absent while the tables and seed rows from the same file were present. Symptoms were silent: an empty console over a full database, and offer acceptance that left the job on stage 01. **Every migration that creates policies, triggers or grants ends with a `select` that lists what it just made, and that output gets read back, not assumed.**
- **RLS enabled with no matching policy denies every row and says nothing.** An empty array is not proof of "no data" — it is equally the signature of a missing policy. A missing GRANT is different and louder: it raises `42501`. Use the difference to tell them apart before guessing.
- **A policy's subquery is itself subject to RLS.** `exists (select 1 from work_orders …)` inside a customer policy silently fails when the customer cannot read `work_orders`. Put ownership tests in `SECURITY DEFINER` helpers (`wo_is_my_job_as_customer`) so a policy can ask the question without the caller needing to read the evidence — especially where the evidence table carries contractor pay.
- **Never verify RLS through the service-role key.** It bypasses RLS entirely, so a suite that reads back through it cannot tell you what a user sees — that is exactly how an absent policy set survived six build steps. Role-facing specs assert reads through **each role's own session** (`e2e/wo-rls.spec.ts` is the pattern).
- **Creating a storage bucket is half the job**; `storage.objects` needs its own policies or every upload dies at the signed-URL step behind a 502.
- The service key is **not** a shortcut for staff: it carries no JWT claims, so `is_staff()` is false under it and staff-gated RPCs answer `not_staff`.

## Dates
- **`toISOString().slice(0,10)` is the UTC date, not the local one.** Before 10am Melbourne it silently reports yesterday, which shifted a sparkline by a day and made "days until start" come out one short. Bucket by calendar day with an `Intl` formatter pinned to `Australia/Melbourne`.
- **Never hardcode `+10:00`.** Melbourne is +11 from October to April. Measure the offset from the zone; don't write one down.

## Process
- **A referenced file that doesn't exist is a stop-and-report, never a build-around.** If a brief, mockup, or doc a task references is missing from the repo, stop and say so before any code is written.
- **Testing law:** every fix/feature PR STARTS by writing the failing e2e spec that reproduces the problem or encodes the mockup interaction, **as an anonymous customer**, then makes it pass. Staff-preview specs run alongside (staff-as-tester is how the response-contract bug hid). The customer-journey suite (`e2e/customer-journey/`) must be green before any merge. "Compiles + unit tests" is never the definition of done — "matches the reference mockup" is.
- Small feature branches; one migration file per change, numbered, committed to `supabase/migrations/` even though Tom pastes SQL manually — the repo must always reflect the true schema.
- Reference data via API/seed scripts, never hand-edited SQL inserts.
- After each feature: update `docs/ARCHITECTURE.md` (one paragraph: what changed, where it lives) and leave a manual test script for Tom.
- Never delete or rewrite a module wholesale to "clean it up" without an explicit instruction.