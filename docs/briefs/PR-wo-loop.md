# Work order completion loop + PC Command console

Builds steps 1–7 of `docs/briefs/claude-code-brief-wo-loop-pc-command.md`: the
seven-stage state machine, per-surface ticks with photo gating, two-sided
variations, drafted daily updates, QA/prep/walkthrough/sign-off, and the PC
Command console.

**Ten migrations are already applied to the live database.** Production is
currently running old code against a newer schema; merging closes that window.

## ⚑ Decisions for Tom

All ship as Settings values with the brief's defaults — these want confirming,
not coding:

| # | Decision | Shipped default |
|---|---|---|
| 1 | QA cadence for new contractors | first 3 jobs, day-one + final |
| 2 | Variation adjusted offer | **PC releases** (a human between money events) |
| 3 | Rubbish / equipment courier | PC organises, costed to the job |
| 4 | Warranty start | sign-off date (deemed included) |
| 5 | Photo minimums | ≥1 before per elevation; ≥3 per QA check; a thin record **flags**, never blocks |
| 8 | Attention-queue ranking | critical → warning → info, oldest first inside each |
| 9 | Deposit tile source | estimate acceptance, until invoicing exists |

**⚑6 — deemed sign-off ships OFF.** Per Tom's ruling the clock is split in two:
`clockEnabled: true` runs the 0/24/48h nudge ladder, `deemedEnabled: false`
until the clause passes ACL/UCT review. While it is off the nudge copy must not
mention deemed signing, automatic sign-off, invoices or payment — that wording
lives in one function (`wo_nudge_copy`) and `signoff.test.ts` asserts it.

**⚑7 — not built, and not pretending to be.** The Reoffer action on an
SLA-breached card deep-links to the work order; it does not perform the reoffer
or notify the lapsed contractor. Needs Tom's ruling first.

## What this found while being built

- **A migration running is not the same as its statements applying.** Three
  things from one file's tail — the RLS policies, the booking→stage trigger and
  a revoke — were absent while the same file's tables and seed rows were
  present. Offer acceptance was silently leaving jobs on stage 01. Every
  migration now ends with a listing that gets read back.
- **RLS enabled with no policy denies every row silently.** An empty array is
  not proof of no data; a missing GRANT is louder (42501). The console rendered
  "nothing needs you" over a database that had plenty to say.
- **A policy's subquery is itself subject to RLS** — the customer could not see
  their own job, because the policy asked `exists (select … from work_orders)`
  and customers cannot read that table (it carries contractor pay). Ownership
  now lives in SECURITY DEFINER helpers.
- **Never verify RLS through the service key.** It bypasses RLS, which is how an
  absent policy set survived six build steps. `e2e/wo-rls.spec.ts` asserts every
  read through each role's own session.
- **Two date bugs**: `toISOString().slice(0,10)` is the UTC date (before 10am
  Melbourne it is yesterday), and a hardcoded `+10:00` is an hour wrong from
  October to April.
- **A flagged area had no way back** — once flagged, the customer could never
  approve it and the job could never close.

## Verification

- 532 unit tests, typecheck clean, lint 0 errors, production build clean.
- e2e in the real role for every surface: ticks (6), variations (9), updates (9),
  sign-off (10), console (10), RLS (8), full loop (13), plus the pre-existing
  contractor and offer suites.
- `lib/workorder/boundary.test.ts` is the brief's §7.6 grep audit as a test: no
  client write to a money or status column on a loop table, no hard-coded
  contractor rate, no hours×rate arithmetic outside `lib/pricing`, no service
  key in a client component.

## Known, unchanged, pre-existing

`estimates.subtotal_cents` / `total_cents` are still written from the builder
client. That predates this phase and is on the audit list; the loop's own tables
are all RPC-only.

## After merge

- `CRON_SECRET` must be set in Vercel **Production** or the 6pm sweep does
  nothing. Vercel only runs crons on production deployments.
- A cleanup phase is owed: 20 of 62 tables are unreferenced by app code,
  including `work_order_surfaces` (the v1 placeholder this phase superseded with
  `wo_surfaces`) and a set of empty legacy tables from the initial schema.
