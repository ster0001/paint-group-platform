# Engineering standards — paint-group-platform
These rules are mandatory for all work in this repo. If a task conflicts with a rule, stop and flag it instead of breaking the rule.

## Architecture boundaries
- Estimate pricing math lives in ONE module (`lib/pricing/`). No component, route or script computes prices independently. All money is integer cents; format only at the display edge.
- Customers see SNAPSHOTS. Any surface reached by token (`/e/[token]`, `/w/[token]`) renders snapshot data, never live drafts.
- Shared estimate components take a `mode` prop (staff | customer). Never fork a component into two diverging copies.
- Contractor-facing HTML must never contain customer pricing, margin, or customer contact details beyond first name + phone. This is enforced in the server render, not by CSS hiding.
- State machines (estimate status, booking offers, job stages) are Postgres enums with transitions changed only through dedicated server functions that validate the current state. No route sets a status column directly.

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

## Process
- **A referenced file that doesn't exist is a stop-and-report, never a build-around.** If a brief, mockup, or doc a task references is missing from the repo, stop and say so before any code is written.
- **Testing law:** every fix/feature PR STARTS by writing the failing e2e spec that reproduces the problem or encodes the mockup interaction, **as an anonymous customer**, then makes it pass. Staff-preview specs run alongside (staff-as-tester is how the response-contract bug hid). The customer-journey suite (`e2e/customer-journey/`) must be green before any merge. "Compiles + unit tests" is never the definition of done — "matches the reference mockup" is.
- Small feature branches; one migration file per change, numbered, committed to `supabase/migrations/` even though Tom pastes SQL manually — the repo must always reflect the true schema.
- Reference data via API/seed scripts, never hand-edited SQL inserts.
- After each feature: update `docs/ARCHITECTURE.md` (one paragraph: what changed, where it lives) and leave a manual test script for Tom.
- Never delete or rewrite a module wholesale to "clean it up" without an explicit instruction.