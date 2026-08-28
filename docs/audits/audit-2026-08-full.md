# Full codebase audit — August 2026

Against `docs/briefs/claude-code-brief-full-audit.md` (not in the repo — see A0)
and `CLAUDE.md`. **Read-only. No fixes applied, nothing deleted.**

| | |
|---|---|
| Started | 28 August 2026 |
| Repo state | `main` @ `850013f`, working tree clean |
| Static analysis against | the repo at that commit |
| Live queries against | the **test** project `qarfyjrzgdeoqbnbbxfp` (never production) |
| Sessions complete | A0–A7, all passes P0–P10 |
| Sessions outstanding | none — fix batches F1… next |

---

## A0 — kickoff

### Reference files

| Brief §0 file | Status |
|---|---|
| `docs/briefs/claude-code-brief-full-audit.md` | **absent** — proceeding without it on Tom's instruction, 28 Aug |
| `docs/briefs/engineering-standards-and-audit-brief.md` | **absent** — proceeding without it on Tom's instruction, 28 Aug |
| `CLAUDE.md` | present (repo root) |
| `audit-response-and-actions.md` | present at `docs/`, **not** `docs/briefs/` as the brief states |
| `claude-code-brief-remediation-server-boundary.md` | present |
| `claude-code-brief-customer-portal.md` | present |
| `post-wizard-buildout-order.md` | present |

**Standing assumption, recorded because it colours everything below:** the two
absent documents are the brief itself and the existing audit/health-check
process this one extends. Findings here are therefore written against
`CLAUDE.md` and the brief text as supplied in the session, not against the
committed process doc. If the standards brief is later found, this register
must be re-read against it.

### §2.7 — the test project

**Satisfied, and better provisioned than the brief assumes.** It is not a
finding, and §8.4 does not need approving — it needs finishing.

- Test project `qarfyjrzgdeoqbnbbxfp`, distinct from production
  `llmrvgdequpmzzuaxdhq`.
- `.env.test.local` carries its own service key, `C1_DATABASE_URL`, and three
  role logins (`E2E_STAFF_*`, `E2E_CONTRACTOR_*`, `E2E_CUSTOMER_*`).
- `scripts/c1/` provides `apply-migrations.mjs`, `seed.mjs`, `reset.mjs`,
  `reapply-one.mjs` and `run-e2e.sh`, all reading `.env.test.local` only.
- `run-e2e.sh` builds with the test env, serves on `:3101`, and runs a
  `refuseProduction()` tripwire over both the Supabase URL and the database URL
  before anything starts.
- It is seeded to volume already: 25,000 accounts, 60,000 estimates, 500,000
  `wo_photos`. The P7 load-test corpus exists.

Residual gaps are recorded as **A1-08** and **A1-03**.

### §8 decisions — status

**§8.1 is still unruled.** A1 did not need it: the inventory records
tenant-column presence unconditionally (see below), which is useful under any
of the three answers. **A2 onward does need it** — layering and single-source
verdicts differ between a single-tenant and a tenant-aware target shape.

Recorded for the ruling, since it is the whole of the question:

> **There is no tenancy concept in the schema.** Zero occurrences of
> `tenant_id`, `org_id`, `organisation_id`, `organization_id`, `company_id`,
> `licensee_id` or `workspace_id` across all 119 migration files.
> `accounts` is the *customer* account, not a tenant.
>
> ```bash
> grep -rhoiE '\b(tenant_id|org_id|organisation_id|organization_id|company_id|licensee_id|workspace_id)\b' supabase/migrations/*.sql | sort | uniq -c
> ```
>
> Files carrying hard-coded Paint Group specifics, as a scale indicator for the
> P9 costing: `Paint Group` 77, `Australia/Melbourne` 31, `Dulux` 13,
> `Haymes` 11, `Oakleigh` 7, `paintgroup.com.au` 5.

**RULED 28 August 2026 — (b): yes, later.** A tenant column and tenant-aware
RLS go in now; one tenant in practice. §8.2 no longer gates anything — (b) is
correct whether the Sydney partner-painter turns out to be a second tenant or a
region, so that question now affects only the timing of the tenancy phase, not
its existence.

**Consequences for the rest of this audit.** Passes from A2 on are scored
against a *tenant-aware* target shape, which means:

- Hard-coded business-configurable values are findings, not acceptable
  constants. The counts above are the scale of that.
- Every new table from here needs a tenant column in its creating migration,
  and every new RLS policy a tenant predicate. That is a standing rule from
  today, not a later cleanup — it is what keeps the retrofit from growing.
- P9 (A6) delivers the costed retrofit plan for the 83 existing tables and the
  point of no return.

---

## P0 — inventory and baseline

The before-picture. Re-measure against this after the fix batches.

### Size

| Directory | Files | LOC |
|---|---:|---:|
| `app/` | 260 | 44,907 |
| `lib/` | 224 | 29,747 |
| `supabase/` | 123 | 18,100 |
| `e2e/` | 78 | 11,303 |
| `scripts/` | 24 | 3,589 |
| **Total** | **694** | **~107,600** |

`app/` by subtree — `quote/` 6,629 · `(app)/` 5,141 · `portal/` 4,972 ·
`pc/` 4,739 · `api/` 4,313 · `invoicing/` 3,557 · `account/` 2,606 ·
`estimate/` 2,384 · `wizard/` 2,285 · `components/` 1,241 · `e/` 1,138 ·
rest < 600 each.

`lib/` by subtree — `wizard/` 5,658 · `workorder/` 4,584 · `extract/` 3,322 ·
`invoicing/` 3,062 · `portal/` 2,404 · `costs/` 1,811 · `pricing/` 1,459 ·
`capture/` 1,433 · rest < 1,000 each.

### Files over 400 lines — 34 (17 over 600, 4 over 1,000)

Each needs a written split-or-cohesive verdict in **A2**.

| Lines | File |
|---:|---|
| 3,272 | `app/quote/QuoteBuilder.tsx` |
| 1,539 | `supabase/migrations/20261112000000_invoicing_core.sql` |
| 1,434 | `app/wizard/WizardApp.tsx` |
| 1,310 | `app/pc/schedule/ScheduleBoard.tsx` |
| 968 | `app/estimate/scope/ScopeEditor.tsx` |
| 931 | `app/api/estimates/[id]/wizard-edit/route.ts` |
| 919 | `app/e/[token]/CustomerEstimate.tsx` |
| 822 | `app/estimate/scope/SidesEditor.tsx` |
| 815 | `app/quote/capture/CaptureApp.tsx` |
| 757 | `supabase/migrations/20261122000000_cost_intake.sql` |
| 693 | `app/api/wizard/submit/route.ts` |
| 658 | `supabase/migrations/20261119000000_contractor_invoicing.sql` |
| 627 | `supabase/migrations/20261116000000_variation_signature_working_scope.sql` |
| 621 | `lib/wizard/sides.ts` |
| 612 | `supabase/migrations/20260813000000_initial_schema.sql` |
| 605 | `lib/workorder/console.ts` |
| 602 | `app/invoicing/actions.ts` |
| 600 | `supabase/migrations/20261127000000_contractor_expenses.sql` |
| 590 | `app/pc/actions.ts` |
| 589 | `app/pc/wo/[id]/page.tsx` |
| 571 | `lib/wizard/scope-editor.ts` |
| 563 | `app/(app)/contractors/ContractorsManager.tsx` |
| 543 | `supabase/migrations/20261028000000_wo_walkthroughs_signoff_v3.sql` |
| 538 | `app/portal/profile/ProfileForm.tsx` |
| 497 | `supabase/migrations/20261110000000_wo_no_walkthrough_colour_match.sql` |
| 491 | `lib/portal/data.ts` |
| 455 | `lib/scheduling/board.ts` |
| 454 | `lib/workorder/console.test.ts` |
| 443 | `lib/pricing/estimate.ts` |
| 443 | `app/invoicing/job/[estimateId]/MoneyView.tsx` |
| 433 | `app/invoicing/PayablesCosts.tsx` |
| 431 | `supabase/migrations/20261113000000_invoice_draft_editing.sql` |
| 421 | `app/portal/jobs/[id]/page.tsx` |
| 403 | `app/(app)/plans/PlanReader.tsx` |

Migration files are excluded from the split rule — they are append-only history
and correctly long. That leaves **24 source files** needing a verdict.

### Surface

| | Count |
|---|---:|
| Pages (`page.tsx`) | 57 |
| Layouts | 12 |
| Route handlers (`route.ts`) | 32 |
| Server-action files | 25 |
| Exported server actions | 108 |
| Cron endpoints | 1 (`/api/cron/wo-sweep`, daily 08:00, `vercel.json`) |
| Migrations | 119 |
| Tables (live, test project) | 84 (83 app + 1 harness) |

Two action files hold a quarter of all actions between them:
`app/pc/actions.ts` (28) and `app/invoicing/actions.ts` (24). Cohesion verdict
in A2.

### Tests

| | Count |
|---|---:|
| Unit files (`lib/**/*.test.ts`) | 93 |
| Unit cases | 1,031 (grep undercounted at 1,012 — parameterised cases; corrected in A4 by running the suite) |
| Unit `describe` blocks | 216 |
| E2E spec files | 74 |
| E2E cases | 293 |

Two assertion styles coexist: 84 files use `expect(`, 9 use `node:assert`.
Not a defect, but any future assert-counting tooling must know both — the first
pass of this audit produced a false "83 assert-free tests" list by checking for
`expect(` alone.

### Dependencies

15 runtime + dev packages. **Every one is imported.** The four with no static
importer — `@sparticuz/chromium`, `puppeteer-core`, `mupdf`, `heic-convert` —
are all loaded through deliberate `await import()` in `lib/invoicing/pdf.ts`,
`lib/extract/pdf.ts` and `lib/extract/heic.ts`, and the two Chromium packages
are declared in `next.config.ts` under `serverExternalPackages`. `sharp` is
Next's image-optimisation peer; `tailwindcss` is consumed through
`@tailwindcss/postcss`.

**Unused dependencies: 0.**

### Module graph

**Import cycles in `lib/`: 0**, measured by DFS over every `@/lib/...` import
in 224 files.

---

## P1 — dead code and unused surface

### A1-01 · `QuoteBuilder.tsx` is 3,272 lines — Medium

`app/quote/QuoteBuilder.tsx`. Two and a half times the next-largest component
and 7.3% of all `app/` code in one file. This is the file named in S7 as the
root cause of the Criticals list.

*Impact:* a file this size has no single obvious responsibility, so a defect in
it has no obvious home to be fixed in.

*Not yet established:* whether it still computes money client-side. That is a
P2 grep and belongs to **A2** — recording it as Medium structural debt here
rather than inflating it to Critical on the strength of its history.

*Fix:* split, per §5 step 7 (structural moves last, on green tests).
*Cost:* 2–3 sessions, after A2 says what comes out.

---

### A1-02 · Eight tables no code reads or writes — Medium

Created, never dropped, and referenced only by the migration that created them
(plus, in three cases, a later migration adding policies or indexes). No
TypeScript, TSX or MJS file mentions any of them.

| Table | Created by | Live rows (test) |
|---|---|---:|
| `estimate_areas` | `20260813000000_initial_schema.sql` | 0 |
| `estimate_lines` | `20260813000000_initial_schema.sql` | 0 |
| `estimate_options` | `20260813000000_initial_schema.sql` | 0 |
| `colour_rules` | `20260813000000_initial_schema.sql` | 0 |
| `follow_up_rules` | `20260813000000_initial_schema.sql` | 0 |
| `commercial_rates` | `20260813010000_ratecard_v7_schema.sql` | 0 |
| `work_order_surfaces` | `20260818000000_work_orders.sql` | 0 |
| `wo_reports` | `20261028000000_wo_walkthroughs_signoff_v3.sql` | 0 |

```bash
# per table: 0 code references, but present in the schema
grep -rlw estimate_areas --include='*.ts' --include='*.tsx' --include='*.mjs' app lib e2e scripts | wc -l
```

*Reading:* five are the original relational estimate model from day one,
superseded by the JSON working-scope model the wizard rebuild landed. This is
the "old path" P1 asks about, and it is **schema**, not code — the code-side
old path was already removed. `work_order_surfaces` sits beside the live
`wo_surfaces` (160,000 rows) and looks like a rename that left the original
behind; `wo_reports` beside the live walkthrough tables.

*Disposition:* **ask Tom**, one question — are the pre-rebuild estimate tables
holding any production rows worth keeping? All eight are empty on the test
project, but the test project was seeded, not migrated from production, so that
proves nothing about production. **Production row counts must be read before
any drop.** If empty there too, delete in one migration, own commit, full gate
after.
*Cost:* 0.5 session including the production check.

---

### A1-03 · The test project is behind head — Medium

Two tables exist in the migration history but not in the test database:

```
contractor_gcal_connections
contractor_gcal_events
```

Created by the Google Calendar sync work (commits `53681f8`, `e430610`,
`850013f`, 27–28 Aug), which memory records as **live in production**. So the
test project is missing a feature that production is running.

*Impact:* gcal sync cannot be exercised by any e2e run on the sanctioned test
stack. More generally, "the test project" is only a valid measurement baseline
while it is at head, and nothing currently enforces that.

*Fix:* run `scripts/c1/apply-migrations.mjs`; then make being-at-head a CI step
so the gap cannot reopen silently.
*Cost:* 0.25 session, plus it folds into A1-07.

The reverse direction is clean: the only table in the test DB not created by a
migration is `_c1_migrations`, the C1 harness's own ledger. Expected.

---

### A1-04 · 218 exported symbols with no reference outside their own file — Low

Measured over `lib/` and `app/components/`, searching `app lib e2e scripts`
plus the four root-level TS configs, excluding each symbol's defining file.

| Kind | Count |
|---|---:|
| `type` | 150 |
| `const` | 55 |
| `function` | 10 |
| `interface` | 3 |

Full list: `docs/audits/data/unused-exports-2026-08-28.txt` (written by A1).

*Reading:* this is over-exported API surface, not dead logic. Most are internal
constants and result types that were exported by habit — `GCAL_TIMEZONE`,
`DEFAULT_GST_RATE_PCT`, `SESSION_TIMEOUT_MS`, `LedgerInput`, `EstimateTotals`.
The right fix for the large majority is to drop the `export` keyword, not to
delete the symbol.

Two clusters are worth a second look in A2 rather than a blanket
de-export:

- **`lib/wizard/sides.ts`** — 8 unreferenced exports (`SIDE_KEYS`, `SIDE_LABEL`,
  `WALL_CODES`, `CATALOG_CODES`, `dwTotals`, `isWallLine`, `isCatalogLine`,
  `sidesDoneCount`) in a 621-line file. Concentration that high usually means a
  superseded path, not tidy-up debt.
- **`lib/presentations/schema.ts`** — 10 of its exports unreferenced; only
  `parseBlockContent` is consumed. The zod content builders below it appear to
  be reachable only through that one entry point.

*Disposition:* **keep, de-export** for the bulk; **ask Tom** on the two
clusters after A2 reads them.
*Cost:* 0.5 session, mechanical, best batched with the deletion commit.

*Method note, so this number is trusted:* the first two runs of this sweep were
wrong. Run one omitted root-level files and falsely flagged
`lib/supabase/middleware.ts :: updateSession`, which `proxy.ts` imports — that
file is Next 16's renamed middleware entry point and is live. Run two returned
928 because an unquoted path-list variable does not word-split in zsh, so every
lookup searched one nonexistent path and scored zero. The 218 above is run
three, cross-checked against run one.

---

### A1-05 · No CI — High

There is no `.github/workflows/`. Nothing runs typecheck, lint, unit tests or
e2e on push, and nothing blocks a merge.

*Impact:* every acceptance criterion in §7 that depends on enforcement
currently has nothing behind it, and §5's ordering ("CI gates second, so
nothing regresses while you fix things") is a build-from-zero, not a tightening.
This is the highest-leverage single fix in the register.

*Mitigating:* `playwright.config.ts` already sets `forbidOnly: Boolean(process.env.CI)`,
so the config is CI-ready; there is simply no CI to read it.

*Fix:* one workflow — `tsc --noEmit`, `eslint`, `npm test`, then the
customer-journey e2e suite against the test project. Add the A1-03 at-head check.
*Cost:* 1 session.

---

### A1-06 · The e2e suite can report green while executing very little — High

160 `test.skip(...)` calls across the 74 spec files, against 293 total cases.

```bash
grep -rhE 'test\.skip\(' e2e --include='*.spec.ts' | wc -l   # 160
```

None are unconditional and none are `.only` — §7's literal criteria (no
`.skip`, no `.only`) already pass. The problem is what the conditions are:

- ~143 gate on a **missing credential or env var** — `test.skip(!STAFF_EMAIL)`,
  `test.skip(process.env.E2E_EXTRACT_READY !== "1")`, `test.skip(process.env.E2E_C1 !== "1")`.
- The rest gate on **runtime state** — `test.skip(rowCount === 0, "no estimates to exercise the header tickbox on")`,
  `test.skip((await trayJob.count()) === 0, "no unscheduled job in the tray to offer")`.
- Several gate on a **migration being absent** — `test.skip(migrationMissing, "needs migration 20261127 on this stack")`.

*Impact:* a run with a partial env, or against a database whose fixtures have
drifted, exits zero having asserted almost nothing. The migration-gated skips
are the sharpest edge: a spec written to prove a migration works turns itself
off when the migration is missing, which is precisely the case it exists to
catch. The design intent is stated in `playwright.config.ts` ("a partial setup
gives a partial result instead of a wall of red") and is reasonable for local
work — it is not safe as a merge gate.

*Fix:* under CI, make the environment complete and turn credential-gated skips
into hard failures (an env assertion in global setup). Replace state-gated
skips with seeded fixtures. Keep the graceful-skip behaviour for local runs
only, keyed off `process.env.CI`.
*Cost:* 1–1.5 sessions. Must land with or before A1-05, or CI will go green on
an empty run.

---

### A1-07 · `npm run test:e2e` has no production tripwire — Medium

`scripts/c1/run-e2e.sh` refuses to point at production, checking both the
Supabase URL and the database URL before it builds. `npm run test:e2e` is a
bare `playwright test` with no such check, and `playwright.config.ts` selects no
project — it inherits whatever is in the shell, which for a normal working
session is `.env.local`, i.e. **production**. Its own header comment says so:
"these run against a REAL browser and the REAL Supabase project".

*Impact:* the safe path exists and is used; the unsafe path is the shorter,
more obvious command, and the specs mutate data.

*Fix:* move `refuseProduction()` into Playwright's `globalSetup` so it guards
every entry point, and repoint `npm run test:e2e` at `scripts/c1/run-e2e.sh`.
*Cost:* 0.25 session.

---

### A1-08 · 48 merged branches unpruned — Low

Every local branch other than `main` is fully merged into it.

```bash
git branch --merged main | grep -v '^\*' | wc -l   # 48
git branch --no-merged main | wc -l                # 0
```

22 of them also still exist on `origin`. No worktrees are outstanding
(`git worktree list` shows only the primary checkout).

*Disposition:* **delete** — zero risk by definition, and it is the one item on
this list where the conservative and aggressive answers to §8.5 agree.
*Cost:* minutes.

---

### A1-09 · Components live at `app/components/`, not `components/` — Info

The brief's §2 layering rule names a top-level `components/`. There isn't one;
shared components sit at `app/components/` (13 files, 1,241 LOC), with most
components colocated beside their routes.

Recorded so A2's layering greps target the right path, and so the rule as
written is not scored against a directory that does not exist. Colocation is a
legitimate App Router convention — no change proposed, but A2 should say
explicitly which convention the codebase is being held to.

---

### A1-10 · `design/reference/` has no archive, and I cannot tell what is superseded — Low

19 files, all in `design/reference/`, no `design/archive/`.

P1 names three specific things to archive: "the v4/v5 hero", "the flat-table PC
console", and "the standalone cost-capture addendum". Only the third has an
obvious candidate — `design/reference/cost-capture-mockup.html`. There is no
file with `v4` or `v5` in its name, and `pc-command-mockup.html` is the only PC
console mockup present, so I cannot tell whether it is the current one or the
superseded flat-table version.

Current contents: `contractor-portal-mockup.html`, `cost-capture-mockup.html`,
`customer-portal-mockup.html`, `customer-review-confirm-exterior-v2-sides.html`,
`customer-review-confirm-mockup.html`, `customer-scope-editor-mockup.html`,
`estimate-commercial-presentation.html`, `estimate-customer-view-v3.html`,
`floorplan-wizard-mockup.html`, `invoice-document-mockup.html`,
`invoice-view-mockup.html`, `invoicing-dashboard-mockup.html`,
`pc-command-mockup.html`, `products.json`, `paint-group-products.csv`,
`paint-group-products.xlsx`, `scheduling-contractor-portal-workflow-v2.md`,
`staff-scheduling-timeline.html`, `work-order-lifecycle-mockup.html`.

*Disposition:* **ask Tom** — which of these three names maps to which file.
This is exactly the risk P1 describes: a build session reading a superseded
mockup as current. Not something to guess at.
*Cost:* 0.25 session once answered.

---

### A1-11 · Clean, and worth recording as clean — Info

Measured, not assumed. These are the before-numbers that must stay at zero.

| Check | Result |
|---|---|
| `// TODO` / `FIXME` / `HACK` / `XXX` in `app lib e2e scripts` | **0** |
| Same in `supabase/` | **0** |
| `any` in non-test source | **0** — all 7 grep hits are the English word in prose comments |
| Unused npm dependencies | **0** |
| Import cycles in `lib/` | **0** |
| Unconditional `.skip` / `.only` / `.todo` in tests | **0** |
| Assert-free test cases | **0** (checked for `expect(`, `assert.`, `.toBe`, `throws(`) |
| Tables with RLS off (app tables) | **0** |
| Tables with RLS on but zero policies | **0** |
| Branches unmerged into `main` | **0** |
| Outstanding git worktrees | **0** |
| Env files tracked by git | **0** (only `.env.example`; `.gitignore` is `.env*` with an `!.env.example` opt-in) |

On RLS — every one of the 83 application tables has RLS enabled and at least
one policy. The only exception is `_c1_migrations`, the C1 harness ledger,
which exists in the test project only and holds no application data. Its
absence from production should be confirmed in **A3**, but it is not created by
any migration, so it should not be there.

This directly satisfies two of §7's after-state criteria ahead of any fix work:
*tables without RLS: 0*, and *no `.skip`, no `.only`, no assert-nothing tests*.
The policies' **correctness** is untested here — that is A3's RLS matrix, and
CLAUDE.md's own warning applies: a policy set can be present and still wrong,
and the service key cannot tell you.

---

## Register summary — A1

| ID | Severity | Finding | Disposition | Est. |
|---|---|---|---|---|
| A1-05 | High | No CI at all | fix | 1 |
| A1-06 | High | 160 conditional e2e skips — **FIXED in F1 (CI fails loudly)** | fix | 1–1.5 |
| A1-01 | Medium | `QuoteBuilder.tsx` 3,272 lines | split (after A2) | 2–3 |
| A1-02 | Medium | 8 tables no code touches | **ask Tom** + prod row check | 0.5 |
| A1-03 | Medium | Test project behind head (2 gcal tables) | fix | 0.25 |
| A1-07 | Medium | `npm run test:e2e` has no prod tripwire | fix | 0.25 |
| A1-04 | Low | 218 exports with no external reference | keep, de-export | 0.5 |
| A1-08 | Low | 48 merged branches — **DELETED in F0** | done |
| A1-10 | Low | `design/reference/` unarchived, mapping unknown | **ask Tom** | 0.25 |
| A1-09 | Info | Components at `app/components/` | record only | — |
| A1-11 | Info | Eleven hygiene checks at zero | record only | — |

**Criticals from A1: none.** The two Highs are both about the safety net rather
than the product: nothing enforces the gates, and the gates that exist can pass
without running. Those are the right things to fix first, and §5 already orders
them that way.

## Open questions for Tom

1. **§8.1 / §8.2** — tenancy. Blocks A2 onward. §8.2 first: is the Sydney
   partner-painter a second tenant or a region?
2. **A1-02** — do the five pre-rebuild estimate tables hold production rows?
3. **A1-10** — which files are the "v4/v5 hero", the "flat-table PC console",
   and the "standalone cost-capture addendum"?

## Next

**A2 — P2 structure + P3 duplication.** Needs the §8.1 ruling. Deliverables:
layering-violation list, split-or-cohesive verdict on the 24 oversized source
files, and the single-source proof table with grep evidence per rule.

---

## P2 — structure and layering

Scored against the tenant-aware target shape, per the §8.1 ruling.

One correction to the brief's model before the findings: there is no top-level
`components/`. Shared components sit at `app/components/` (13 files) and the
rest are colocated with their routes. Everything below is measured against that
actual layout (A1-09).

### A2-01 · 58 direct table mutations from the browser — High

§7's after-state criterion is *browser→DB mutations: 0*. The count today is
**58 direct table writes across 22 files**, plus 26 RPC calls.

```bash
grep -rln 'from "@/lib/supabase/client"' --include='*.ts' --include='*.tsx' app lib   # 34 files
# of those, the ones calling .insert/.update/.delete/.upsert
```

| Table written from the browser | Sites |
|---|---:|
| `settings` | 14 |
| `products` | 6 |
| `presentation_blocks` | 5 |
| `contractor_unavailability` | 5 |
| `presentations` | 4 |
| `line_items` | 3 |
| `colours` | 3 |
| *(generic — `EditableTable`)* | 3 |
| `estimates` | 2 |
| `contacts`, `accounts`, `company_documents`, `contractor_documents` | 2 each |
| `work_orders` | 1 |

Heaviest files: `app/(app)/settings/PresentationsManager.tsx` (9),
`app/quote/QuoteBuilder.tsx` (5), `app/(app)/settings/ProductsManager.tsx` (5),
`app/(app)/settings/DocumentsManager.tsx` (5).

**This is not a data-exposure hole.** The tables involved carry staff-only RLS
with both a `using` and a `with check` predicate — e.g.

```sql
create policy settings_staff_all on public.settings
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
```

so a non-staff browser cannot write them. Graded High, not Critical, on that
basis.

**What is actually wrong** is that these writes route around the server
boundary entirely, and therefore around the rule that guards it. CLAUDE.md
says *"every API route and server action validates its input with zod before
touching the database"* — a browser write is neither an API route nor a server
action, so it satisfies the rule by not being covered by it. There is no zod
schema, no server-side recompute, and no audit trail on any of the 58.

The `settings` writes are the ones that matter most: `settings` holds the
pricing configuration. `app/(app)/settings/PricingSettings.tsx:83` computes the
derived pricing rows in the browser and upserts the result:

```ts
const { error } = await supabase.from("settings").upsert(payload, { onConflict: "key" });
```

*Fix:* a server action per settings surface, zod-validated, recomputing derived
values server-side. `EditableTable` needs the treatment in A2-02 regardless.
*Cost:* 2 sessions.

---

### A2-02 · The rate card is saved by a sequential client loop, not a transaction — High

`app/(app)/settings/EditableTable.tsx` is a generic browser-side table writer:
it takes a `table: string` prop and writes straight to it.

```tsx
if (r.__new) { const { data, error } = await supabase.from(table).insert(payload(r)).select().single(); }
else         { const { error } = await supabase.from(table).update(payload(r)).eq("id", r.id!); }
```

`app/(app)/settings/page.tsx` mounts it six times, over: **`rate_items`**,
**`modifiers`**, `room_type_scope_rules`, `room_type_defaults`, `area_names`,
`area_name_presets`. The first two are the rate card.

The save loops row by row (`for (const r of toSave)`), each iteration its own
round trip, collecting per-row failures. A partial failure therefore **leaves
the rate card half-saved** — some rows at the new prices, some at the old, no
rollback. CLAUDE.md, verbatim:

> Multi-step money operations (repricing cascades, invoice generation,
> variation approval) run in a single Postgres transaction via an RPC — never
> as sequential client calls.

Editing the rate card is a repricing operation. This is a direct violation of a
named rule, on the money path.

Secondary, same file: money columns are converted in the browser
(`Math.round(Number(v) * 100)` on save, `/ 100` on load), so the dollars↔cents
boundary sits client-side too.

*Fix:* one `save_rate_rows` RPC taking the whole dirty set, zod-validated at a
server action, applied in one transaction. Retires 3 of A2-01's 58 sites and
all six mount points.
*Cost:* 1 session.

---

### A2-03 · Twenty separate `money()` formatters — High

§P3 lists *"money formatting and GST — one utility"*. There are **20
independent definitions**, and a shared utility already exists that 19 of them
ignore.

`app/invoicing/format.ts` is the real one — `fmt0`, `fmt2`, `fmtSigned2`,
`shortDay` — with a correct note about bare `yyyy-mm-dd` being a Melbourne
calendar day. Only the invoicing screens use it.

Everywhere else re-declares `const money = …`, and **they do not agree**:

| Rendering | Files |
|---|---|
| whole dollars, `Math.round(c / 100)` | `app/pc/page.tsx:13`, `app/pc/flow/page.tsx:9`, `app/(app)/proving/page.tsx:21` |
| no decimals, `maximumFractionDigits: 0` | `app/pc/schedule/ScheduleBoard.tsx:14`, `app/pc/wo/[id]/page.tsx:24` |
| two decimals | `app/pc/wo/[id]/PriceVariation.tsx:10`, `app/quote/QuoteBuilder.tsx:2596`, `app/quote/revisionActions.ts:286`, and 9 more |

*Impact:* the same contract value renders as `$12,346` on the PC board and
`$12,345.67` on the work order. Rounded-to-dollar display of a cents figure is
the specific case the brief describes — one number quoted, another invoiced —
even though the stored value never changes.

*Fix:* promote `app/invoicing/format.ts` to `lib/format/money.ts`, delete the
19 local copies, add a CI grep forbidding `const money =` outside it.
*Cost:* 0.5 session, mechanical.

---

### A2-04 · The ledger's tests test a twin that nothing calls — High

`lib/invoicing/ledger.ts` is the module the brief names as the single source
for the invoice ledger and variation recompute. It has 15 unit tests.

**Nothing in the application calls it.**

```bash
grep -rn '\bledger(' --include='*.ts' --include='*.tsx' app lib | grep -v '\.test\.'
# lib/invoicing/ledger.ts:105:export function ledger(input: LedgerInput): Ledger {   ← the definition, and nothing else
```

Only `isOverdue` is imported from the module, once, by `lib/invoicing/derive.ts`.

This is deliberate and documented — the file's own header says so:

> The runtime authority inside transactions is the SQL twin
> `public.invoice_ledger` (…§8) — the schema contract test pins the two to the
> same rule.

The twin-plus-diff pattern is exactly what the brief endorses for the work-order
stage machine. **The problem is that the diff does not exist.**
`lib/invoicing/schema.contract.test.ts` pins the *migration text*, not the
behaviour — it reads the `.sql` file off disk and asserts it contains certain
strings:

```ts
const CORE = read("20261112000000_invoicing_core.sql");
expect(CORE).toContain("raise exception 'invoice_immutable_after_issue'");
```

No database is involved; the file's own header says "these run in `npm test`
with no database". So:

- the TS ledger's 15 tests prove the TS ledger correct — and it never runs;
- the contract tests prove the migration *file* contains certain guard text;
- **nothing compares the TS arithmetic to the SQL arithmetic**, and nothing
  executes either.

Change a constant in `lib/invoicing/ledger.ts` and 15 tests fail while
behaviour is unaffected. Change `public.invoice_ledger` in the live database
and behaviour changes while nothing fails. That is the inverse of what the
suite appears to offer, and it is the money path.

CLAUDE.md's own hard-won lesson sharpens it: *"A migration 'running' is not the
same as its statements applying."* Since Tom pastes SQL manually, the migration
file can match while the database differs — and the contract test reads the
file.

*No divergence is claimed.* The SQL side carries real DB-level guards and the
rule is written down in both places. The finding is the false-confidence
structure, not a known wrong number.

*Fix:* a test that runs both implementations over the same fixtures against the
test project and asserts equality, in CI. That is the "mirrored + diffed by
test" the brief asks for, and it is the only thing that makes the twin safe.
*Cost:* 1 session. Depends on A1-05.

---

### A2-05 · GST computed in three places outside `lib/invoicing/gst.ts` — Medium

The single source exists (`gstOnExCents`, `gstFromIncCents`, default
`ratePct = 10`) and is correctly used by `lib/portal/money.ts`,
`lib/invoicing/variation.ts`, `app/portal/money/[id]/page.tsx` and
`app/invoicing/job/[estimateId]/MoneyView.tsx`. Three sites bypass it:

| Site | Code |
|---|---|
| `app/e/[token]/CustomerEstimate.tsx:113` | `const gst = Math.round(subtotal * gstRate);` |
| `app/invoicing/PayablesCosts.tsx:145` | `(Math.round(c.totalCents / 11) / 100).toFixed(2)` |
| `app/invoicing/job/[estimateId]/AddCostSheet.tsx:136` | `Math.round((t * 100) / 11)` |

The first is on the customer-facing estimate — a `"use client"` component that
recomputes the whole money stack in the browser: options subtotal, discount,
subtotal, GST, total, deposit.

**It is display-only, and I confirmed that before grading it.** The browser
does pass its figures to acceptance —

```ts
await supabase.rpc("accept_estimate", { …, p_total_cents: total, p_deposit_cents: deposit });
```

— but the live RPC ignores them, and says so:

```sql
-- THE MONEY COMES FROM THE SNAPSHOT, NOT THE CALLER.
-- p_total_cents / p_deposit_cents are ignored on purpose.
v_total := coalesce(nullif((v_snapshot->'totals'->>'totalCents')::integer, 0), …);
```

It even records the client's claim as `client_claimed_total` in the
`estimate_events` payload alongside `derived_server_side: true`. That is the
C1–C5 remediation working exactly as intended, and it is the reason this is
Medium rather than Critical.

What remains is real: if the browser's arithmetic ever diverges from the
snapshot's, the customer reads one total on screen and is bound to another.
The fix is to render `snap.totals` rather than recompute it.

The two `/ 11` sites are a hard-coded 10% GST. Under ruling (b) those are also
tenancy blockers — a licensee outside Australia has a different rate, and
`gstFromIncCents` already takes `ratePct`.

*Cost:* 0.5 session.

---

### A2-06 · No single date/timezone utility — Medium

§P3 asks for one, `Australia/Melbourne`, DST-aware. **19 files reference the
zone string directly**, across `app/` and `lib/`, with no shared module.

`lib/scheduling/dates.ts` exists but is calendar arithmetic (`addDays`,
`dayDiff`, `todayIso`, `dateRange`) rather than formatting;
`app/invoicing/format.ts` holds the only correct formatter (`shortDay`), and it
lives in `app/`.

The per-site correctness is actually good — CLAUDE.md's two date lessons
(never `toISOString().slice(0,10)`, never hardcode `+10:00`) appear to be
respected, and `TZ=Australia/Melbourne` is pinned in the `npm test` script. This
is a single-source finding, not a correctness one: 19 places to get it wrong
next time.

Under ruling (b), the zone is also a per-tenant setting, so consolidating it
now is the cheap moment.

*Fix:* `lib/format/date.ts`, one zone read from settings with `Australia/Melbourne`
as the default. Fold into A2-03's move.
*Cost:* 0.5 session, batched with A2-03.

---

### A2-07 · `accept_estimate` carries two parameters it ignores — Low

`p_total_cents` and `p_deposit_cents` are in the signature, passed by the
browser, and deliberately discarded. Keeping them is defensible — they are
recorded as `client_claimed_total` for audit, which is genuinely useful.

The risk is that they *read* as load-bearing. A future change that "wires up
the unused parameter" would reintroduce the exact vulnerability the comment was
written to prevent. Rename to `p_client_claimed_total_cents` /
`p_client_claimed_deposit_cents` so the name carries the ruling.

*Cost:* minutes, next time that migration is touched.

---

### A2-08 · Oversized-file verdicts

The 24 non-migration files over 400 lines, profiled by component count,
function count, `useState` count and DB call sites.

| File | LOC | Comps | Fns | State | DB | Verdict |
|---|---:|---:|---:|---:|---:|---|
| `app/quote/QuoteBuilder.tsx` | 3272 | 12 | 66 | 71 | 17 | **split — urgent** |
| `app/wizard/WizardApp.tsx` | 1434 | 11 | 26 | 17 | 3 | **split** |
| `app/pc/schedule/ScheduleBoard.tsx` | 1310 | 2 | 23 | 33 | 5 | **split** |
| `app/estimate/scope/ScopeEditor.tsx` | 968 | 1 | 32 | 23 | 0 | **split** |
| `app/api/estimates/[id]/wizard-edit/route.ts` | 931 | 0 | 18 | 0 | 12 | **split** |
| `app/e/[token]/CustomerEstimate.tsx` | 919 | 4 | 15 | 16 | 8 | **split** (with A2-05) |
| `app/estimate/scope/SidesEditor.tsx` | 822 | 2 | 23 | 17 | 0 | split |
| `app/quote/capture/CaptureApp.tsx` | 815 | 5 | 18 | 15 | 0 | split |
| `app/api/wizard/submit/route.ts` | 693 | 0 | 9 | 0 | 21 | split — 21 DB calls in 9 fns |
| `lib/wizard/sides.ts` | 621 | 0 | 41 | 0 | 0 | split — 41 fns, 8 unused exports (A1-04) |
| `lib/workorder/console.ts` | 605 | 0 | 12 | 0 | 0 | **cohesive** — one console's read model |
| `app/invoicing/actions.ts` | 602 | 0 | 28 | 0 | 4 | split by concern (invoice / payment / credit) |
| `app/pc/actions.ts` | 590 | 0 | 31 | 0 | 15 | split by concern |
| `app/pc/wo/[id]/page.tsx` | 589 | 0 | 9 | 0 | 16 | split — 16 queries in one page |
| `lib/wizard/scope-editor.ts` | 571 | 0 | 22 | 0 | 0 | **cohesive** |
| `app/(app)/contractors/ContractorsManager.tsx` | 563 | 1 | 12 | 8 | 9 | split |
| `app/portal/profile/ProfileForm.tsx` | 538 | 1 | 7 | 17 | 8 | split |
| `lib/portal/data.ts` | 491 | 0 | 21 | 0 | 29 | **cohesive** as a data layer; 29 queries → P7 |
| `lib/scheduling/board.ts` | 455 | 0 | 6 | 0 | 8 | **cohesive** |
| `lib/pricing/estimate.ts` | 443 | 0 | 19 | 0 | 0 | **cohesive** — pure, no DB, no clock |
| `app/invoicing/job/[estimateId]/MoneyView.tsx` | 443 | 1 | 1 | 12 | 0 | **cohesive** — one view, no logic |
| `app/invoicing/PayablesCosts.tsx` | 433 | 1 | 3 | 9 | 0 | **cohesive** (fix A2-05's `/11`) |
| `app/portal/jobs/[id]/page.tsx` | 421 | 0 | 10 | 0 | 19 | split — 19 queries |
| `app/(app)/plans/PlanReader.tsx` | 403 | 1 | 7 | 13 | 2 | **cohesive** |

**8 cohesive, 16 split.** `lib/` comes out well — 4 of its 6 oversized files
are cohesive, and `lib/pricing/estimate.ts` is exactly the shape the brief
prescribes: pure, no DB client, no clock read.

`QuoteBuilder.tsx` is in a category of its own: **12 components, 66 functions,
71 `useState` hooks and 17 database call sites in one file.** No further
argument is needed.

---

## P3 — single-source proof table

| Rule | Required | Found | Verdict |
|---|---|---|---|
| Pricing | one impl in `lib/pricing` | 12 importers; **zero** occurrences of `productionHours` / `coatMultiplier` / `materialLitres` outside `lib/pricing` | ✅ **clean** |
| Work-order stage machine | one definition, mirrored + diffed | `WO_STAGES` defined once, `lib/workorder/stages.ts:14`; 26 tests | ✅ clean |
| Invoice ledger + variation recompute | one impl | TS twin + SQL twin, **no behavioural diff test** | ❌ **A2-04** |
| Money formatting | one utility | **20 implementations** | ❌ **A2-03** |
| GST | one utility | one utility, **3 bypasses** | ❌ **A2-05** |
| Date / timezone | one utility, DST-aware | **19 direct zone references**, no shared module | ❌ **A2-06** |
| Attention queue | `lib/invoicing/attention.ts` | **file does not exist** | ⚪ not built |
| CRM stage / segments / attribution | one each | not built | ⚪ not built |

Two of the eight are clean, three are violated, one is structurally unsafe, two
are not yet built. Pricing — the rule that matters most and the one S7 was
about — holds.

---

## Register summary — A2

| ID | Severity | Finding | Est. |
|---|---|---|---|
| A2-01 | High | 58 direct browser→DB table mutations across 22 files | 2 |
| A2-02 | High | Rate card saved by a sequential client loop, not a transaction | 1 |
| A2-03 | High | 20 `money()` formatters that disagree; the shared one exists | 0.5 |
| A2-04 | High | Ledger tests test a twin nothing calls — **FIXED in F3** | done |
| A2-05 | Med | GST computed in 3 places outside the utility; two hard-code `/11` | 0.5 |
| A2-06 | Med | No single date/timezone utility; 19 direct zone references | 0.5 |
| A2-08 | Med | 16 of 24 oversized files need splitting | 6–8 |
| A2-07 | Low | `accept_estimate` carries two ignored parameters | — |

**Criticals from A2: none.** Twice the evidence pointed at one and the code
turned out to be defended — acceptance derives money server-side and ignores
the client's claim, and the rate-card tables carry staff-only RLS on both
`using` and `with check`. Both are recorded above with the proof, because an
audit that only lists what is broken is not usable as due diligence.

## Next

**A3 — P4 security + P5 data integrity.** Deliverables: zod coverage across all
108 server actions, `search_path` on every SECURITY DEFINER RPC, the full RLS
matrix per table per role read through each role's own session (never the
service key — CLAUDE.md), FK on-delete rules against app behaviour, orphan
queries, and the seeded-vs-real identification query for production.

---

## P4 — security and the server boundary

**Method, and its limit.** Everything below was read from the live catalogue of
the **test** project (`pg_proc`, `pg_policy`, `pg_constraint`,
`information_schema`, `storage.buckets`) rather than from migration text, so it
reflects what is actually installed rather than what a file says. Migration
text lies about the live database by construction here — Tom pastes SQL
manually — and the first cut of the `search_path` check, run over the files,
reported 33 gaps that turned out to be prose comments.

**What this method cannot tell you:** whether the policies are *correct*.
CLAUDE.md is explicit — *"Never verify RLS through the service-role key. It
bypasses RLS entirely."* A direct `postgres` connection has the same problem.
The findings below establish that policies **exist**, cover the right commands,
and carry ownership predicates. Proving that contractor A cannot read
contractor B's pay requires reading through each role's own session, which
means running the role specs (`e2e/wo-rls.spec.ts`, `e2e/account-rls.spec.ts`)
on the C1 stack. **This was run — see A3-08, 15/15 passed with zero skips.**

### The criteria that pass

| §7 criterion | Result |
|---|---|
| SECURITY DEFINER RPCs without explicit `search_path` | **0** of 177 |
| Tables with RLS off | **0** (A1-11) |
| Policies granted to `anon` or `PUBLIC` | **0** of 141 |
| `FOR ALL` policies with a null with-check | **0** of 78 |
| Server actions with a validation call site | 100 parse sites / 108 actions |

The `anon` result is the architecturally important one. Every policy is scoped
to `authenticated`; anonymous wizard visitors hold a real `auth.uid()` and
**zero** RLS-granted table access, reaching data only through SECURITY DEFINER
RPCs with explicit ownership checks. That is exactly what
`lib/supabase/service.ts` documents as the design, and the catalogue confirms
it is what is installed.

84 of the 141 policies carry an `is_staff()` predicate; the remaining 57 carry
ownership predicates (`auth.uid()`, contractor, account, customer helpers).

### A3-01 · Public money links never expire — High

Two token families, one pattern applied to only one of them.

| Token | Expiry column |
|---|---|
| `contractor_invites.token` | ✅ `expires_at`, enforced (`if v.expires_at < now() then return 'error:expired'`) |
| `wo_signoff.walkthrough_session_token` | ✅ `walkthrough_session_expires_at` |
| `wo_signoff.customer_token` | ✅ same |
| **`estimates.share_token`** | ❌ **none** |
| **`invoices.token`** | ❌ **none** |
| **`work_orders.share_token`** | ❌ **none** |
| **`work_orders.crew_token`** | ❌ **none** |
| **`wo_variations.customer_token`** | ❌ **none** |

The brief asks for "expiry, single-purpose scope, and a test that an expired or
wrong token gets nothing" on exactly these — the estimate view, the invoice pay
link, the walkthrough RPC. The walkthrough one has it. **The estimate link and
the invoice pay link do not.**

*Impact:* a forwarded estimate URL or invoice pay link works forever, for
anyone holding it, long after the job closes. The tokens themselves are strong
(CLAUDE.md's ≥24-char `crypto.randomBytes` rule, 404-not-403 on unknown), so
this is not guessable access — it is unbounded access for anyone who was ever
sent one, or anyone who later reads that inbox.

*Mitigating:* `estimate_views` records every view with session and dwell, so
access is at least observable after the fact.

*Fix:* `expires_at` on each, defaulted generously (an estimate link outliving
the quote's validity is the actual business rule), checked in the RPC that
reads it, plus the expired-token test the brief asks for.
*Cost:* 1 session.

### A3-02 · No magic-byte validation on uploads — Medium

The brief asks for it by name. Neither layer reads file contents:

- `lib/uploads/validate.ts` checks the **extension** against `EXT_MIME`, and
  the browser-declared MIME against an allowlist.
- The bucket checks `allowed_mime_types` against the **declared**
  `Content-Type`.

Both trust the caller's word about what the bytes are. A file named `.png`,
sent with `Content-Type: image/png`, passes both regardless of content.

*What is already right, and it is most of it:* every bucket has a
`file_size_limit` and a MIME allowlist; SVG is deliberately excluded everywhere
with the reason written down ("it is a script container"); the module's header
is honest that it is a UX layer, not the enforcement; and `acceptAttr` is
commented "a UI hint only — never a control".

*Impact:* bounded. The dangerous case is a stored HTML/SVG payload served from
a public bucket origin — see A3-03. Private buckets serve through signed URLs.

*Fix:* sniff the first bytes server-side in the upload routes (`lib/extract/normalise.ts`
already does page classification, so the read is not new) and reject on
mismatch.
*Cost:* 0.5 session.

### A3-03 · Estimate media sits in a world-readable bucket — Medium

Five of eleven buckets are public:

| Bucket | Public | Holds |
|---|---|---|
| `estimate-media` | **true** | staff-uploaded estimate photos, company logo, product photos |
| `presentation-media` | true | marketing video/imagery (200 MB cap) |
| `presentation-docs` | true | capability PDFs |
| `product-photos` | true | paint product shots |
| `contractor-logos` | true | contractor branding |
| `estimate-sources` | false | **customer-uploaded plans and photos** |
| `wo-photos` | false | job photos (500k rows) |
| `cost-docs`, `invoice-docs`, `company-docs`, `contractor-docs` | false | — |

**The separation is correct where it matters most:** customer *uploads* go to
`estimate-sources`, which is private and read through `createSignedUrl`. The
brief's literal criterion — no public bucket holding customer photos — is met
on that path.

The gap is `estimate-media`. `app/quote/QuoteBuilder.tsx:3206` uploads estimate
photos to it and immediately calls `getPublicUrl`:

```ts
const path = `${crypto.randomUUID()}.${ext}`;
const { error } = await supabase.storage.from("estimate-media").upload(path, f);
const { data } = supabase.storage.from("estimate-media").getPublicUrl(path);
```

and the policy is unconditional:

```sql
for select using (bucket_id = 'estimate-media')
```

Those are photographs of a customer's property, on permanent world-readable
URLs. Unguessable, but public forever, and mixed into the same bucket as the
company logo — so the bucket can never be made private without breaking
branding.

*Fix:* split — `estimate-media` stays public for logo/product shots, a new
private `estimate-photos` bucket takes property imagery and serves signed URLs.
*Cost:* 0.5 session plus a path migration.

### A3-04 · Seven reference tables readable by every authenticated user — CLOSED ✅

**Ruled 28 August 2026: prep hours are contractor-visible.** Not a finding —
keep, with the reason recorded here so it is not re-raised by the next audit.

Seven policies have `qual = true`, an unconditional SELECT to `authenticated`:

```
area_name_presets · defect_prep_rates · measurement_units · room_name_aliases
room_type_defaults · room_type_scope_rules · wo_stage_transitions
```

Six are lookup data (room names, unit sizes, stage labels) and were never in
question. The one raised was `defect_prep_rates`
(`defect_type, unit, hours_sev1, hours_sev2, hours_sev3`) — the labour-hour
basis behind prep pricing, readable by any contractor session.

Tom's ruling: that is intended. A contractor seeing the hours allowed for a
defect is the job being described to them, not the margin being exposed —
and CLAUDE.md's contractor boundary is drawn at "customer pricing, margin, or
customer contact details", none of which these columns carry.

*Disposition:* **keep**. No change. Under the §8.1 (b) ruling these tables still
take a `tenant_id` like every other — shared reference data is shared *within a
tenant*, not across them (A6-02).

### A3-05 · Three server actions take untrusted input without validation — Low

100 of 108 actions have a parse call site. Of the 8 without, **five take no
arguments at all** and derive identity from the session — `signout()`,
`homeForRole(role)` (a pure path lookup, no DB), `disconnectGoogleCalendar()`,
`syncGoogleCalendarNow()`. Nothing to validate.

Three genuinely take untrusted input:

| Action | Input | Today |
|---|---|---|
| `app/auth/actions.ts:9` `signup` | `FormData` email/password/name | `String(formData.get(…) ?? "")`, straight to `supabase.auth.signUp` |
| `app/auth/actions.ts:39` `login` | `FormData` email/password | same |
| `app/account/(portal)/messages/actions.ts:10` `sendPortalMessageAction` | `estimateId`, `body` | id checked by regex + ownership re-proven from session; **`body` unbounded** |

Supabase enforces its own email format and password policy, so the practical
exposure is small — but CLAUDE.md's rule is unconditional, and
`lib/validation/contact.ts` already exists and is tested.

*Cost:* 0.25 session.

### A3-08 · The RLS behavioural check — RUN, and it passes ✅

Closed 28 August 2026. Executed on the C1 test stack via
`./scripts/c1/run-e2e.sh e2e/wo-rls.spec.ts e2e/account-rls.spec.ts`:

```
15 passed (16.1s)
```

**15 of 15 executed — zero skipped.** That matters as much as the pass: A1-06
means a green e2e result is only meaningful alongside its skip count, and here
there were none.

Both specs read through each role's own session with no service key on the read
side, which is the only method CLAUDE.md accepts. What is now proven, rather
than inferred from the catalogue:

| Assertion | Result |
|---|---|
| A member reads exactly their own account — and no one else's | ✅ |
| A login with no membership sees zero accounts | ✅ |
| Properties follow membership — own visible, others' invisible | ✅ |
| A customer can neither create nor edit accounts | ✅ |
| Estimates and invoices stay unreadable to the customer | ✅ |
| The anonymous key alone reads nothing from the chain | ✅ |
| An invoice inserted with only `estimate_id` inherits the account (S2 fix) | ✅ |
| Staff read the loop tables — the bug that hid for six steps | ✅ |
| The contractor sees their own job through their own session | ✅ |
| …and **nothing of a job that is not theirs** | ✅ |
| The customer sees their own job through their own session | ✅ |
| …but **cannot read the work order itself — the contractor's pay is on it** | ✅ |
| …and nothing of anyone else's | ✅ |
| No non-staff role can write to any of it | ✅ |
| A customer cannot move a job's stage by writing to the column | ✅ |

Cross-role isolation therefore holds behaviourally, not just structurally. This
is also the closest thing in the codebase to the tenant-isolation test §P9 will
require under ruling (b) — the pattern to generalise, not to invent.

*Caveat, stated because the brief asks for measured claims:* this covers the
work-order loop and the account chain. It is not a per-table isolation proof
across all 83 tables. That generated test is P9 work.

---

## P5 — data integrity

### The criteria that pass

| Check | Result |
|---|---|
| Orphan rows | **0** — invoices→estimates, work_orders→estimates, payments→invoices, wo_surfaces→work_orders all clean |
| Naive timestamps (`timestamp without time zone`) | **0** — `timestamptz` everywhere |
| Money columns not integer | **0** of 52 (two `jsonb` payload columns excluded: `wo_variations.priced_inputs`, `priced_lines`) |
| `SET NULL` on a `NOT NULL` column | **0** — no impossible deletes |
| Enum drift, DB vs TS | **0** on the three checked |

Enum drift, spot-checked on the three that carry state:

| Enum | DB | TS | Match |
|---|---|---|---|
| `estimate_status` | 5 values | `lib/validation/estimate.ts:7` `z.enum([…])` | ✅ exact |
| `invoice_status` | 8 values | `lib/invoicing/stateMachine.ts` `INVOICE_STATUSES` | ✅ exact |
| `wo_stage` | 7 values | `lib/workorder/stages.ts:14` `WO_STAGES` | ✅ exact |

28 enums exist in total; the remaining 25 were not individually diffed. The
brief asks for this to be automated — **it is not**, and the three that matter
most are hand-verified here. A generated test that reads `pg_enum` and asserts
against the TS unions is the right artefact (A3-07).

**The FK contradiction the brief names is closed.** `invoices → estimates` is
now `ON DELETE RESTRICT`, matching `delete_estimate`'s refusal — the database
and the app agree. Full distribution across 138 FKs: 65 `SET NULL`, 51
`CASCADE`, 13 `RESTRICT`, 9 `NO ACTION`. Money-table rules read correctly:
`contractor_invoices → work_orders` RESTRICT, `credit_notes → invoices`
RESTRICT, `invoice_lines → invoices` CASCADE, `payments → invoices` CASCADE
(safe only because a trigger makes non-draft invoices undeletable — worth a
comment on the constraint).

### A3-06 · 68 foreign-key columns have no leading index — Medium

```sql
select con.conrelid::regclass, a.attname from pg_constraint con
 join unnest(con.conkey) k on true
 join pg_attribute a on a.attrelid=con.conrelid and a.attnum=k
 where con.contype='f' and con.connamespace='public'::regnamespace
   and not exists (select 1 from pg_index i
                   where i.indrelid=con.conrelid and a.attnum=i.indkey[0]);
```

CLAUDE.md: *"Every FK and every token/status column used in a WHERE has an
index, created in the same migration."*

Most are `created_by`/`actor`/`approved_by` audit columns that are never
filtered on, and indexing all 68 would be wrong. The ones that matter are the
FKs the app actually joins or cascades through — `estimate_questions.estimate_id`,
`estimate_lines.area_id`, `contractor_expenses.invoice_id`,
`cost_intake.confirmed_wo_id` and similar. Also note an unindexed FK makes the
**parent's** delete slow, because Postgres must scan the child.

*Fix:* index the joined subset; leave audit columns bare with a written reason.
Full list belongs to **A5 (P7)**, measured against real query plans rather than
guessed.
*Cost:* 0.5 session, sequenced with A5.

### A3-07 · Enum drift is not automated — Low

Three of 28 enums are verified, by hand, in this document. Nothing prevents the
other 25 drifting, and nothing prevents these three drifting tomorrow.

*Fix:* one test that reads `pg_enum` from the test project and asserts each
enum equals its TS union. Depends on A1-05 (CI) to be meaningful.
*Cost:* 0.5 session.

### A3-09 · Test data — identification, not yet cleanup

The brief records *"638 of 648 users and 47 of 70 estimates are driver output"*
in **production**. This audit did not query production, by §2.7. What can be
stated:

- The **test** project holds 25,000 accounts / 60,000 estimates / 500,000
  `wo_photos` — the deliberate volume seed from `scripts/portal/seed-volume.mjs`,
  not contamination. It is the P7 corpus and should stay.
- `estimates.customer_id` is null on **60,000 of 60,000** test rows and
  `invoices.customer_id` on **40,000 of 40,000** — but that is the seed not
  setting it, and says nothing about production. The production figure is
  recorded in `20261026000000_invoices_customer_link.sql`: *"70 of 71 rows
  null"*, with `customers` holding 3 seed rows. That is
  `docs/briefs/customer-identity-link.md`, still open, and it is the reason
  `invoices.customer_id NOT NULL` was deliberately not applied.

**Identification query, to run against production** (read-only, no deletes):

```sql
-- Seeded vs real, by the seed's own signatures. Verify each clause against
-- what the driver actually wrote before trusting the counts.
select
  count(*) filter (where e.created_at < '2026-08-13') as pre_platform,
  count(*) filter (where e.share_token is null)       as never_sent,
  count(*) filter (where c.email ilike '%@example.com'
                      or c.email ilike '%+test%'
                      or c.email ilike '%e2e%')       as test_addressed,
  count(*)                                            as total
from public.estimates e
left join public.contacts c on c.id = e.contact_id;

-- Users, the same question:
select count(*) filter (where email ilike '%@example.com'
                           or email ilike '%+test%'
                           or email ilike '%e2e%') as looks_seeded,
       count(*) as total
from auth.users;
```

*Cleanup plan, in order:* (1) run the above on production and eyeball a sample
of each bucket by hand — no deletion on a pattern match alone; (2) tag rather
than delete first, so the classification is reviewable; (3) delete inside the
FK ordering the invoicing migration documents (invoices before estimates);
(4) re-run the orphan hunt above and require 0.

*Disposition:* **ask Tom** before anything runs against production.
*Cost:* 1 session.

---

## Register summary — A3

| ID | Severity | Finding | Est. |
|---|---|---|---|
| A3-01 | High | Estimate, invoice, work-order and crew tokens never expire | 1 |
| A3-02 | Med | No magic-byte validation; both layers trust the declared MIME | 0.5 |
| A3-03 | Med | Estimate property photos in a world-readable bucket | 0.5 |
| A3-04 | ✅ | 7 reference tables world-readable — **ruled intended, closed** | done |
| A3-06 | Med | 68 FK columns with no leading index | 0.5 (with A5) |
| A3-09 | Med | Production test data identified but not cleaned | 1 |
| A3-05 | Low | 3 actions take untrusted input without zod | 0.25 |
| A3-07 | Low | Enum drift not automated (3 of 28 hand-checked) | 0.5 |
| A3-08 | ✅ | **RLS behavioural check RUN — 15/15 passed, 0 skipped** | done |

**Criticals from A3: none.** The server boundary is in materially better shape
than the brief anticipates: zero RPCs without `search_path`, zero policies
reaching `anon`, zero orphans, zero naive timestamps, money integer throughout,
and the named FK contradiction already closed. The open items are the edges —
token lifetime, upload content, one public bucket, and index coverage.

## Next

**A4 — P6 tests + P8 errors.** Deliverables: branch coverage on the money
paths, the mutation check on pricing and ledger (change a constant, confirm a
test fails), the swallowed-error list, and the four-states audit on every async
user action.

---

## P6 — correctness and tests

**Baseline, measured by running it:** 93 files, **1,031 tests, all passing, in
1.71s**. (A1's grep-derived 1,012 undercounted parameterised cases; corrected
above.) A suite that runs in under two seconds is a suite people actually run.

### The mutation check

The brief asks for this by name: *change a constant, confirm a test fails. If
nothing fails, the suite isn't testing what it claims.* Eight mutations across
pricing, GST and the ledger — each applied, the relevant suite run, then
reverted.

| # | Mutation | Result | Suite outcome |
|---|---|---|---|
| 1 | `coatMultiplier`: marginal coat `0.75` → `0.70` | ✅ caught | 2 failed / 10 passed |
| 2 | `depositCents`: `Math.round` → `Math.floor` | ✅ caught | 1 failed / 21 passed |
| 3 | **`contractorOfferCents`: drop `* rates.offerPct`** | ❌ **SURVIVED** | **22 passed** |
| 4 | `gstFromIncCents`: default rate `10` → `11` | ✅ caught | 1 failed / 14 passed |
| 5 | `roundHalfUp`: lose the negative-number branch | ✅ caught | 1 failed / 14 passed |
| 6 | `invoicedCents`: count drafts as invoiced | ✅ caught | 2 failed / 13 passed |
| 7 | `paidCents`: count refunded payments as paid | ✅ caught | 1 failed / 14 passed |
| 8 | `variationsCents`: credits add instead of subtract | ✅ caught | 1 failed / 14 passed |

**Seven of eight caught.** The pricing engine, GST rounding and the whole
ledger are genuinely tested — mutation 8 in particular (credits flipping sign)
is the kind of error that silently overbills, and the suite catches it.

### A4-01 · The contractor payment basis is not tested — High

Mutation 3 deleted the offer percentage from the contractor payment
calculation and **all 22 tests still passed**.

```ts
// lib/pricing/estimate.ts:411
const contractorOfferCents = Math.round(contractorHours * effContractorHourlyCents * rates.offerPct);
```

The test that appears to cover it hard-codes the multiplier:

```ts
// lib/pricing/estimate.test.ts — "the contractor offer follows ALL hours, prep included"
assert.equal(t.contractorOfferCents, Math.round(t.contractorHours * 6000 * 1));
//                                                                        ^ the literal 1
```

`1` is the *fallback* when the setting is absent
(`estimate.ts:165` — `sNum("Contractor offer — % of estimated hours") ?? 1`).
So the test asserts the default path against itself and can never see the
factor disappear.

```bash
grep -rn 'offerPct' lib e2e | grep -v 'estimate.ts:165\|estimate.ts:411'
# (no output — offerPct appears in no test and no fixture anywhere)
```

*Impact:* this is the number every contractor is paid. If the factor were
dropped, misread from settings, or applied twice, nothing in 1,031 tests would
notice. The brief names "contractor payment basis" explicitly among the paths
wanting near-total branch coverage, and it is the one money path with none.

*Fix:* a test with `offerPct` ≠ 1 (say 0.55) asserting the offer scales, plus
one asserting the `?? 1` fallback — so the default and the configured path are
distinguishable.
*Cost:* 0.25 session. **The highest value-per-minute fix in this register.**

### A4-02 · Golden fixtures pin the rate card but not the settings — Medium

`lib/pricing/golden.test.ts` runs 5 locked historical cases — exactly the
protection the brief asks for, so *"a rate-card change can never silently
reprice"*. It works, and it should stay.

But the goldens vary rate-card rows only. `offerPct`, `depositPct`,
`gstRatePct` and the other business settings are constant across all five, so a
settings change reprices silently in a way the goldens cannot see. That is the
same blind spot A4-01 found, one level up — and it matters more under ruling
(b), where those settings become per-tenant and therefore genuinely variable.

*Fix:* one golden case per business-setting profile.
*Cost:* 0.5 session, with A4-01.

### The other P6 criteria

| Criterion | Result |
|---|---|
| Tests asserting nothing | **0** (A1-11, checked for `expect(`, `assert.`, `.toBe`, `throws(`) |
| `.only` / unconditional `.skip` | **0** |
| Golden tests on pricing | ✅ present, 5 cases, integer-cents assertion included |
| E2E one per role | ✅ 43 staff / 33 contractor / 50 customer / 16 anonymous specs |
| Customer-journey suite (CLAUDE.md law) | ✅ `e2e/customer-journey/`, 17 specs |
| Flaky tests | **not assessable** — no CI, so no run history exists to detect intermittency |

That last row is the honest answer, not a pass. Flakiness is a property of
repeated runs; with no CI (A1-05) there are no repeated runs to look at. It
cannot be cleared until A1-05 lands.

The conditional-skip problem (A1-06) applies to every e2e row above: 43 specs
*mention* staff, but how many *executed* on any given run depends on the
environment.

---

## P8 — errors and observability

### A4-03 · Nothing alerts a human — High

`lib/monitoring/report.ts` is a well-built seam: one `reportError(error, { where, bestEffort, extra })`
entry point, adopted by **37 files**, never throws, and documents that
`extra` must not carry PII or money. It exists because an earlier audit found
nine silent catches.

It reports to `console`. The monitor is a commented-out line:

```ts
// ---- wire the error monitor in here -----------------------------------
// Sentry.captureException(error, { tags: { where: context.where }, extra: context.extra });
```

`@sentry/nextjs` is not installed; there is no DSN and no alerting anywhere.

*Impact:* every best-effort failure the seam was built to make visible — view
tracking, expiry sweeps, calendar sync, PDF renders — lands in a serverless
log nobody reads. §7 requires monitoring that alerts a human; today nothing
alerts anyone. This is also the mechanism that would have surfaced the
`@sparticuz/chromium` production PDF failure (`next.config.ts`'s comment: *every
pdf_path was null*) in hours rather than whenever it was noticed.

*Fix:* install `@sentry/nextjs`, add the DSN, uncomment the line, set up source
maps and release tagging, and point one alert rule at a human. The seam means
this is genuinely a one-file change plus config.
*Cost:* 0.5 session. Blocked on **§8.6**, which is unanswered — provider and
budget.

### The swallowed-error criterion passes

| Check | Result |
|---|---|
| `catch {}` / `catch (e) {}` — empty | **0** |
| `catch` whose entire body is a `console` call | **0** |
| `catch { /* comment */ }` — swallow with a written reason | **1** |

The one is `app/api/extract/[runId]/apply/route.ts:47`:

```ts
try { body = await request.json(); } catch { /* an empty body is fine */ }
```

That is a correct swallow with the reason stated. §7's *"swallowed errors: 0"*
is met.

### A4-04 · A handful of async actions have no failure or loading surface — Low

Of **75 client components containing an async handler**:

- **5** have no failure surface by any pattern — `app/pc/DismissCard.tsx`,
  `app/portal/calendar/GoogleSyncCard.tsx`, `app/(app)/estimates/EstimatesTable.tsx`,
  `app/wizard/AddressField.tsx`, `app/components/ColourPicker.tsx`
- **4** have no loading surface — `app/(app)/settings/ColoursManager.tsx`,
  `app/wizard/AddressField.tsx`, `app/components/ColourPicker.tsx`, and
  `app/i/[token]/PayPanel.tsx` (**a false positive** — see below)

`AddressField.tsx` and `ColourPicker.tsx` are in both lists, and `AddressField`
is the wizard's address lookup, which has a documented history of failing
silently.

*Method note, because the first two numbers I measured were wrong.* An initial
scan for `setErr|setError|catch` reported 36 of 75, and a second pass reported
26. Both over-reported: the codebase uses `setMessage` and `setMsg` as often as
`setError`, and renders failures through `{message && <p role="status">…}`.
The figure of 5 is from the third pass, with the full pattern set. Spot-checking
two of the flagged money components — `app/v/[token]/VariationDecision.tsx` and
`app/portal/money/[id]/SubmitInvoice.tsx` — showed both handle failure properly;
they were pattern-matching artefacts, not defects.

**`app/i/[token]/PayPanel.tsx` is likewise a false positive and is excluded
from the count above.** It has no `disabled={pending}` because it has no async
handler to guard — paying is a plain `<form method="post">`, a full navigation
the browser renders progress for. Its post-return handling is exemplary: three
explicit states (`checking` / `confirmed` / `processing`), a 60-second timeout,
and a refusal to claim success the database cannot back — *"it does not guess"*.
The `catch {}` inside its polling loop carries the reason `keep polling — the
timeout below is the answer for a dead network`.

*Fix:* add a message line to the five. Mechanical.
*Cost:* 0.25 session.

### A4-05 · The health check is a page, not an endpoint — Low

`app/health/page.tsx` renders HTML and does a live `profiles` head-count. It
works, but an uptime monitor wants JSON and a status code, not a parsed page.
There is no uptime check configured.

*Fix:* `app/api/health/route.ts` returning `{ ok, checks }` with a non-200 on
failure; point a monitor at it alongside A4-03.
*Cost:* 0.25 session.

### Structured logging and the audit trail

- **Correlation id:** none. `reportError`'s `where` field is a searchable
  label, not a request id, so two concurrent failures cannot be told apart.
  Fold into A4-03.
- **PII in logs:** the contract is written down (`extra` must never carry PII or
  money) but nothing enforces it. Not spot-audited across all 37 call sites —
  outstanding.
- **Money/identity audit trail:** ✅ genuinely good. `estimate_events`,
  `invoice_events`, `invoice_transitions`, `wo_events`, `wo_stage_transitions`
  and `contractor_events` all exist and are written inside the same transaction
  as the change. `accept_estimate` records the client's claimed total alongside
  the server-derived one (A2-05) — an audit trail that captures a disagreement
  it is designed to ignore is better than most.

---

## Register summary — A4

| ID | Severity | Finding | Est. |
|---|---|---|---|
| A4-01 | High | Contractor payment basis untested — **FIXED in F0, mutation now caught** | done |
| A4-03 | High | No error monitor wired; nothing alerts a human | 0.5 |
| A4-02 | Med | Golden fixtures pin the rate card but not business settings | 0.5 |
| A4-04 | Low | 5 of 75 async components with no failure surface | 0.25 |
| A4-05 | Low | Health check is a page, not a JSON endpoint | 0.25 |
| — | — | Flaky-test assessment **not possible** until CI exists | — |

**Criticals from A4: none.** The suite is real — 7 of 8 money-path mutations
caught, zero assert-free tests, zero swallowed errors, a golden pricing corpus,
and an audit trail that records even the figures it refuses to trust. The two
Highs are a single untested multiplier and an unplugged monitor, and between
them they cost three-quarters of a session.

## Next

**A5 — P7 performance.** Deliverables: unbounded selects, N+1 loops, missing
indexes measured against real plans (with A3-06), payload sizes, and the load
test at 25k accounts / 100k events — for which the test project is already
seeded (25,000 accounts, 60,000 estimates, 500,000 `wo_photos`).

---

## P7 — performance and scale

Measured against the seeded test project: **25,000 accounts · 60,000 estimates
· 20,000 work orders · 100,000 `wo_events` · 160,000 `wo_surfaces` · 500,000
`wo_photos`** — the brief's 25k-accounts/100k-events target, already in place.

| Table | Size | Rows |
|---|---:|---:|
| `wo_photos` | 143 MB | 500,000 |
| `estimates` | 42 MB | 60,000 |
| `wo_surfaces` | 35 MB | 160,000 |
| `wo_events` | 28 MB | 100,000 |
| `properties` | 26 MB | 30,000 |
| `invoices` | 15 MB | 40,000 |
| `accounts` | 12 MB | 25,000 |
| `work_orders` | 7.8 MB | 20,000 |

### The load test — one surface of three passes, and it is measured

`e2e/portal-volume.spec.ts`, run on the C1 stack:

```
VOLUME GATE: {"samples":20,"homeP95Ms":250,"homeMedianMs":195,
              "timelineP95Ms":914,"timelineMedianMs":379,"moneyP95Ms":318}
1 passed, 1 skipped (27.2s)
```

| Surface | Brief's target | Measured |
|---|---|---|
| Portal home | < 1s | **p95 250ms**, median 195ms ✅ |
| Portal timeline | < 1s | **p95 914ms**, median 379ms ✅ (thin margin) |
| Portal money | — | p95 318ms |
| **PC / CRM board** | < 1.5s | **no gate exists** |
| **Invoicing dashboard** | < 1.5s | **no gate exists** |

The portal genuinely holds at volume. Two caveats: the timeline's 914ms p95 has
little headroom under a 1s target, and **the second test in that file skipped**
("a wizard save stays under a second at volume") — A1-06 again, and the reason
a green e2e line has to be read with its skip count.

### A5-01 · The PC console reads two unbounded tables on every page load — High

`lib/workorder/consoleData.ts` issues ~20 queries per load. Two have no bound
at all. Timed directly against the seeded database:

| Query | Rows | Time |
|---|---:|---:|
| `work_orders` incl. `wo_snapshot`, no filter, no limit | 20,000 | **543ms** |
| `wo_events` incl. `meta`, no filter, no limit | 100,000 | **882ms** |
| `wo_surfaces` by batched `.in(ids)` | 8,000 | 114ms |

That is **~1.4 seconds of database time before a single component renders**,
against the brief's < 1.5s budget for the whole screen.

**The measurement understates production.** `wo_snapshot` averages **45 bytes**
per row in the seed — the volume driver writes a stub. A real snapshot carries
the full work-order document. The 543ms is a floor, not an estimate.

*Mitigating, and worth crediting:* the brief's named example — *"the board
reading every work order including full `wo_snapshot`"* — is **half fixed**.
The photo feed is now explicitly capped, with the reasoning written down:
`.limit(24)` and *"this is a glance at the day, not an archive"*. The
`work_orders` read did not get the same treatment.

*Fix:* filter to open stages (`work_orders_stage_idx` already exists as a
partial index `WHERE stage <> 'closed'`, so the index is waiting for a query to
use it), drop `wo_snapshot` from the list query and fetch it per card, and
window `wo_events` to the period the tiles actually cover.
*Cost:* 1 session.

### A5-02 · The board's photo query sequential-scans 500,000 rows — High

Bounded to 24 rows and still the slowest query measured — 1,704ms cold, 134ms
warm. `EXPLAIN (ANALYZE, BUFFERS)` says why:

```
Limit  (actual time=129.513..134.656 rows=24)
  ->  Gather Merge
        ->  Sort  Sort Key: created_at DESC
              ->  Parallel Seq Scan on wo_photos  (actual rows=250000 loops=2)
                    Buffers: shared hit=8622
```

Every index on `wo_photos` leads with `work_order_id`:

```
wo_photos_wo_idx        (work_order_id, kind, created_at DESC)
wo_photos_area_idx      (work_order_id, area, kind)
wo_photos_surface_idx   (surface_id)
wo_photos_variation_idx (variation_id)
```

The board's query orders by `created_at` **across all jobs**, so none of them
can serve it. Postgres reads all 500,000 rows and top-N sorts them, to return
24.

*Impact:* the single most expensive operation on the busiest staff screen, and
it scales linearly with the photo table — the fastest-growing table in the
system, already 143 MB.

*Fix:* one line.

```sql
create index concurrently wo_photos_recent_idx on public.wo_photos (created_at desc);
```

*Cost:* minutes. **Best value-per-minute item in P7.**

### A5-03 · The nightly sweep scales linearly with open jobs — High

The brief asks directly: *"do they scale linearly with accounts? A nightly
sweep that loops every account will fall over well before 25k."*

`app/api/cron/wo-sweep/route.ts` — the only cron, daily at 08:00 — contains
three unbounded-select-then-loop patterns:

| Line | Driving select | Per iteration |
|---|---|---|
| `:67` | `wo_events` where type=`surface_tick` since… , grouped per job | **2 queries** (`work_orders`, then `estimates`) |
| `:135` | `select id from work_orders where stage in ('pre_start','in_progress')` — **2,000 rows today** | 1 RPC `wo_schedule_qa` |
| `:147` | `select id from work_orders where stage = 'qa'` | 1 RPC `wo_qa_route_passed` |

All sequential, all awaited. At today's seeded volume the `:135` loop alone is
**2,000 sequential round trips** in one cron invocation. The selects themselves
are fast (86ms and 29ms) — the cost is entirely the fan-out.

*Impact:* the sweep is the backstop for QA scheduling, stage routing and
pre-start checklists. When it exceeds the platform's function timeout it will
not fail loudly — it will stop partway, and the jobs after the cut-off silently
miss their backstop. That is exactly the failure mode CLAUDE.md's WO-loop
lesson describes: *silent*, with an empty console over a full database.

*Fix:* set-based RPCs (`wo_schedule_qa_all`, `wo_qa_route_passed_all`) doing the
work in one statement, or batch with a cursor and a bounded page size. Either
way the sweep must report how many rows it *did not* reach.
*Cost:* 1 session.

### A5-04 · Nothing is paginated — Medium

```bash
grep -rl '\.range(' --include='*.ts' --include='*.tsx' app lib | wc -l   # 0
grep -rl '\.limit(' --include='*.ts' --include='*.tsx' app lib | wc -l   # 18
```

**`.range()` — Supabase's pagination primitive — appears in zero files**, across
400 `.select(` call sites. 18 files use `.limit()`, which caps a query but
offers no second page: the rows beyond the cap are unreachable rather than
paged.

CLAUDE.md: *"Paginate anything unbounded (jobs, products, activity)."*

Today most lists are small enough that a cap is indistinguishable from
correctness. At 25k accounts they are not, and a `.limit()` with no cursor
silently truncates rather than paginating — the user is shown a partial list
with nothing saying so.

*Fix:* a cursor helper in `lib/` and adoption on the list screens, starting
with estimates, work orders and invoices.
*Cost:* 2 sessions.

### A5-05 · Twenty loops issue a database call per iteration — Medium

Detected brace-aware — a DB call inside the loop body, not merely nearby.

| Blast radius | Sites |
|---|---|
| **Scales with job count** (real risk) | `api/cron/wo-sweep` ×3 (A5-03), `lib/workorder/preStart.ts:50` (2/job) |
| Scales with contractors (bounded, small) | `lib/gcal/sync.ts:232` (2 each), `:280` |
| Scales with one user's edit set | `settings/EditableTable.tsx:82` (A2-02), `LineItemsManager.tsx:49`, `ProductsManager.tsx:138` |
| Scales with one upload | `api/extract/photos:54` (3 each), `api/extract/[runId]/photos:84`, `:106`, `api/extract/floorplan:137`, `api/extract/upload-url:63`, `QuoteBuilder.tsx:3203` |
| Scales with one job's variations | `quote/revisionActions.ts:148`, `:202` |
| Other | `account/documents/actions.ts:50`, `account/profile/actions.ts:38`, `api/inbound/airtable:77` |

Only the first row needs fixing on scale grounds; the rest are bounded by a
single user action and are fine.

*Method note.* A proximity-based first pass reported 22 and included
`lib/workorder/consoleData.ts:121`. That is a **false positive** — the loop
iterates rows already fetched by one batched `.in()` query, and the code says
so: *"Tick counts per job, in one more query rather than one per card."* It is
the fix for an N+1, not an instance of one. The 20 above are brace-scoped.

### A5-06 · Two of the three named surfaces have no volume gate — Medium

The brief names three: portal login, CRM/PC board, invoicing dashboard. Only
the portal has one, and half of it skipped on this run.

Given A5-01 measures ~1.4s of database time on the PC console before rendering,
the board is the surface most likely to be over budget — and the one with no
test to say so.

*Fix:* extend `portal-volume.spec.ts`'s harness to the board and the invoicing
dashboard with the same p95 method. The harness already exists.
*Cost:* 0.5 session.

### Payload and images

- `wo_snapshot` totals 879 kB across 20,000 rows in the seed (avg 45 bytes) —
  **not a usable production figure**, per A5-01.
- Images: `next.config.ts` sets no `images` config, so `next/image` defaults
  apply. Buckets enforce size caps (10–200 MB by kind) and HEIC is converted
  server-side (`lib/extract/heic.ts`). Not separately measured — **outstanding**.
- Bundle size per route: **not measured** — outstanding, needs a build analysis.

Both gaps are recorded rather than glossed; neither is a claim of a problem.

---

## Register summary — A5

| ID | Severity | Finding | Est. |
|---|---|---|---|
| A5-02 | High | `wo_photos` newest-24 seq-scans 500k rows — **LIVE IN PRODUCTION 28 Aug**, `indisvalid=true` | done |
| A5-01 | High | PC console reads `work_orders` + `wo_events` unbounded — ~1.4s DB time | 1 |
| A5-03 | High | Nightly sweep does one RPC per job — 2,000 sequential calls today | 1 |
| A5-04 | Med | No pagination anywhere; `.range()` in zero files | 2 |
| A5-05 | Med | 20 loops with a DB call per iteration (4 that matter) | 0.5 |
| A5-06 | Med | No volume gate on the PC board or invoicing dashboard | 0.5 |
| — | — | Bundle size and image handling **not measured** — outstanding | — |

**Criticals from A5: none.** The portal holds its p95 at full volume, which is
the surface customers touch. The three Highs are all staff-side, all measured,
and one of them is a single `create index`.

## Next

**A6 — P9 tenancy + P10 ops**, scoped by the §8.1 (b) ruling: the licensing
readiness report, the costed tenancy retrofit for 83 tables, the point of no
return, and the CI gap list. Then **A7** consolidates all findings into one
severity-ranked register.

---

## P9 — multi-tenancy and licensing readiness

Scoped by the §8.1 ruling: **(b) — yes, later.** A tenant column and
tenant-aware RLS go in now; one tenant in practice.

### Is there a tenant concept? No.

```bash
grep -rhoiE '\b(tenant_id|org_id|organisation_id|organization_id|company_id|licensee_id|workspace_id)\b' \
  supabase/migrations/*.sql | sort | uniq -c
# (no output — across all 119 migration files)
```

**83 application tables, zero tenant columns, 141 RLS policies with no tenant
predicate.** `accounts` is the customer's account, not a tenant. Every policy
answers "is this row yours?" — none answers "is this row *this business's*?"

### What is already configurable — and it is more than expected

This is the half that would normally sink a licensing conversation, and it is
largely done.

**In the `settings` table**, read at runtime, editable from the Settings screen:

| Key | Carries |
|---|---|
| `invoicing_entity` | trading name, **ABN**, address, brand subtitle |
| `invoicing_bank` | account name, bank, BSB, account, reference rule |
| `invoicing` | numbering prefixes (`INV-`, `CI-`, `RCT-`, `CN-`, `REM-`), GST rate, payment terms, deposit % |
| `wo_loop` | sign-off nudge hours, clock, rubbish handling, QA cadence |
| `cost_intake` | claimable categories, auto-confirm rules |
| `invoicing_myob` | accounting account mapping |

**As reference tables**, already per-row rather than per-constant: `rate_cards`,
`rate_items`, `modifiers`, `sundries`, `line_items`, `measurement_units`,
`defect_prep_rates`, `products`, `colours`, `room_type_defaults`,
`room_type_scope_rules`, `area_name_presets`.

The rate card — the single most business-specific asset — is data, not code, and
P3 confirmed pricing has exactly one implementation reading it. **A licensee's
rate card is already a row set, not a fork.**

### A6-01 · Real bank details are hard-coded in the repo — High

`app/quote/company.ts` holds a `DEFAULT_COMPANY` constant with live values:

```ts
export const DEFAULT_COMPANY: CompanyProfile = {
  name: "Paint Group",
  addressLine1: "25/25-35 Bunney Road",
  addressLine2: "Oakleigh South, VIC 3167",
  phone: "03 8840 9414",
  abn: "<real ABN>",
  estimatorName: "<director's name>",
  estimatorPhone: "<personal mobile>",
  email: "<company email>",
  bankName: "<account name>",
  bsb: "<real BSB>",          // ← redacted here; removed from source by F0
  acc: "<real account no.>",  // ← redacted here; removed from source by F0
  bank: "<bank>",
};
```

Two rules broken at once. CLAUDE.md:

> Bank/payment details: encrypted at rest, displayed masked, changes trigger a
> staff alert.

> No secrets, keys, or real customer data in the repo, in seed scripts, or in
> test fixtures.

**And the settings row that should hold them is empty** — `invoicing_bank` reads
`{"acc": "", "bsb": "", "bank": "Commonwealth Bank", "accountName": "ENLVN Pty Ltd"}`.
So the correct home exists and is unpopulated, while the constant carries the
real numbers. That is drift in the worst direction: the fallback is the live
one.

*Fairness:* a BSB and account number on a receiving account are semi-public —
they appear on every invoice this business sends. This is not a leaked
credential. It is a stated rule broken, in a repo heading toward external
technical due diligence, plus a personal mobile number.

*Fix:* populate `invoicing_bank`, reduce `DEFAULT_COMPANY` to empty strings, and
make the settings read the only source. 8 files import from `company.ts`, all of
which already take a `CompanyProfile` — the type stays, only the literal goes.
*Cost:* 0.5 session.

### A6-02 · The tenancy retrofit, costed

What ruling (b) requires, measured against what exists.

| Work | Scale | Sessions |
|---|---|---|
| `tenant_id` column + backfill + `NOT NULL` + FK, on every table | **83 tables** | 2 |
| Tenant predicate added to every RLS policy | **141 policies** | 2 |
| Tenant scoping reviewed in every SECURITY DEFINER function | **177 functions** | 3 |
| Generated per-table isolation test (tenant A cannot read tenant B) | 83 tables, generated | 1 |
| `DEFAULT_COMPANY` → settings (A6-01) | 8 importers | 0.5 |
| Per-tenant branding on customer surfaces (estimate, invoice, portal, email, SMS sender) | 5 surfaces | 2 |
| Geography: the Melbourne 50 km Places bias becomes a tenant setting | `app/api/places/autocomplete/route.ts:26` | 0.5 |
| Locale: `Australia/Melbourne` (19 files) and GST rate → tenant settings | folds into A2-05, A2-06 | 1 |
| Onboarding path for a new licensee | new | 2 |
| **Total** | | **~14 sessions** |

Two things make this cheaper than it looks:

1. **The isolation test already has its pattern.** A3-08's `wo-rls.spec.ts`
   reads through each role's own session and asserts "nothing of a job that is
   not theirs" — 15/15 passing. Generalising that to "nothing of a tenant that
   is not theirs" across 83 tables is generation, not invention.
2. **RLS is universal already.** Every table has it on with at least one
   policy, so there is no table to bring into the scheme from scratch — each
   policy gains a conjunct.

And one thing makes it dearer: **the 177 SECURITY DEFINER functions**. Each
bypasses RLS by design, so a tenant predicate must be added to the *body*, and
each must be read to decide where. That is the largest single line above and
the least automatable.

### A6-03 · Australian assumptions a licensee elsewhere would hit — Medium

| Assumption | Evidence | Under (b) |
|---|---|---|
| 10% GST | `DEFAULT_GST_RATE_PCT = 10`; settings override exists; **two hard-coded `/11`** (A2-05) | fix the two, keep the setting |
| `Australia/Melbourne` | 19 files reference the zone directly (A2-06) | one tenant setting |
| `en-AU` / AUD | 61 files / 11 files, all display-edge | consolidate with A2-03 |
| Melbourne 50 km search bias | `app/api/places/autocomplete/route.ts:26`, `radius: 50_000` around −37.8136, 144.9631 | tenant setting |
| Dulux / Haymes / Wattyl | 8 and 7 files — mostly cost-parsing heuristics and customer copy | data, not code |
| Spam Act consent, ACL warranty, DBCA deposit caps | `docs/legal/`, warranty brief | jurisdiction-scoped content |

Nothing here is structural. Every one is a constant that becomes a setting, and
most sit at the display edge already.

### Point of no return

Not a date — a rate. The retrofit grows by roughly **0.05 sessions per new
table** (column + policy + generated test) and **0.15 per new SECURITY DEFINER
function**.

Concretely: the CRM and customer-portal phase 4 are both about to add schema.
If they add 20 tables and 25 RPCs between them, the retrofit above grows from
~14 sessions to **~18** — and, more importantly, those 20 tables would need
revisiting rather than being born correct.

**The cheap move is not to retrofit now. It is to stop adding to the debt now.**
The standing rule from today — every new table carries `tenant_id` in its
creating migration, every new policy a tenant predicate — costs approximately
nothing per module and holds the number at 14 while the backlog is scheduled.
That, rather than the retrofit itself, is what ruling (b) actually buys.

---

## P10 — ops and release

| Criterion | Status |
|---|---|
| CI runs typecheck/lint/unit/e2e and blocks merge | ❌ **none** (A1-05) |
| Migrations forward-only | ✅ 0 `drop table`, 0 `truncate`, 1 `drop column` |
| Migrations reproducible from scratch | ✅ **proven** — see below |
| Environments genuinely separate | ✅ with a caveat (A1-07) |
| Backups + a performed restore drill | ⚪ **unknown — ask Tom** |
| Rollback plan per deploy | ❌ none found |
| Dependency vulnerabilities | ✅ **0** (`npm audit --omit=dev`) |
| `.gitignore` correctness | ✅ (A1-11) |

**Reproducibility is proven, not assumed.** The test project was built by
replaying the migration history: `_c1_migrations` holds 118 applied filenames
against 119 files in the repo, and the diff is exactly one:

```
in repo, NOT applied to test project: 20261201000000_gcal_sync.sql
```

That is A1-03 pinned to a single file — the gcal migration, live in production,
never applied to test. The mechanism works; it was simply not re-run after the
27–28 August gcal work.

### A6-04 · No evidence of a backup or a restore drill — High

Supabase takes managed backups on paid plans, so backups very likely exist. What
does not exist anywhere in the repo is evidence that **a restore has ever been
performed**. The brief is blunt about why that matters: *"An untested backup is
a hope."*

Nothing here can settle it — it is an account-console fact, not a code fact.

*Ask Tom:* what is the backup schedule and retention on the production project,
and has a restore ever been run end to end? If not, the drill is: restore
production to a scratch project, run the orphan queries from P5 against it, and
write down how long it took.
*Cost:* 0.5 session once answered.

### A6-05 · No rollback plan — Medium

Deploys go to Vercel, which keeps instant rollback for the application. The gap
is the database: migrations are forward-only by design (correct), so a bad
migration has no documented reverse. `supabase/fixes/` contains two ad-hoc
repair scripts (`a2-invoice-orphans.sql`,
`revert-forgery-test-acceptance.sql`), which is evidence the need is real and
handled case by case.

*Fix:* a short written procedure — app rollback via Vercel, database forward-fix
via a numbered repair migration, and the rule that a migration touching money
tables ships with its repair script written in advance.
*Cost:* 0.25 session.

### A6-06 · Dependencies current, one major behind on tooling — Low

**Zero vulnerabilities.** Patch drift is small and safe: `next` 16.3.0 → 16.3.3,
`@supabase/ssr` 0.12.4 → 0.12.5, `supabase-js` 2.112.3 → 2.112.4, `vitest`
4.1.10 → 4.1.11, `sharp`, `puppeteer-core`.

Majors deliberately not taken: `typescript` 5.9 → 7.0, `eslint` 9 → 10,
`@types/node` 20 → 26. Those are upgrade projects, not maintenance.

*Fix:* take the patches; schedule the majors separately. Do it **after** CI
exists, so the upgrade has a gate to prove itself against.
*Cost:* 0.25 session.

---

## Register summary — A6

| ID | Severity | Finding | Est. |
|---|---|---|---|
| A6-01 | High | Real BSB/account and a personal mobile hard-coded in `company.ts` — **FIXED in F0**; production `company_profile` verified complete (15/15 keys) 28 Aug | done |
| A6-04 | High | No evidence a restore has ever been performed — **ask Tom** | 0.5 |
| A6-02 | Med | Tenancy retrofit: 83 tables, 141 policies, 177 RPCs — **~14 sessions** | 14 |
| A6-03 | Med | Australian assumptions: GST, zone, locale, 50 km bias | folds in |
| A6-05 | Med | No rollback plan for a bad migration | 0.25 |
| A6-06 | Low | Patch-level dependency drift; 0 vulnerabilities | 0.25 |

**Criticals from A6: none.** The licensing answer is better than the brief
expects: the rate card, entity, banking, numbering and loop settings are
already data rather than code, and pricing reads them through one module. What
is missing is the tenant boundary itself — and the decisive fact is that
**stopping the debt costs nothing while the retrofit costs ~14 sessions**.

## Next

**A7 — consolidate.** One severity-ranked register across A1–A6, session-costed,
in the §5 fix order.

---
---

# A7 — Consolidated findings register

All passes P0–P10 complete. **42 findings, 2 closed on ruling, 1 closed by
running the test.** Ordered below by §5's fix sequence, not by severity, because
that is the order the work actually has to happen in.

## The headline

**Zero Criticals.** Nothing in this codebase loses money, exposes data across
users, or corrupts records — and that was tested, not assumed:

- acceptance derives money from the server snapshot and *ignores* the browser's
  claimed total, recording the disagreement (A2-05)
- cross-role isolation passes behaviourally, 15/15, read through each role's own
  session (A3-08)
- zero orphans, zero naive timestamps, money integer throughout, zero RPCs
  without `search_path`, zero policies reaching `anon` (A3)
- 7 of 8 money-path mutations caught by the existing suite (A4)
- the portal holds p95 250ms at 25,000 accounts (A5)

The register is long because the brief asked for everything measured. Length is
not danger — that distinction is why §4 defines severity up front.

| Severity | Count |
|---|---:|
| Critical | **0** |
| High | 14 |
| Medium | 16 |
| Low | 9 |
| Info | 2 |
| Closed during the audit | 3 |

**What the Highs have in common:** twelve of the fourteen are about the safety
net rather than the product — nothing enforces the gates, the gates that exist
can pass without running, one money path has no test, and nothing alerts a
human. The product itself keeps coming out defended.

## Start here — four fixes, under one session total

Disproportionate value, no dependencies, do them first.

| Fix | Finding | Time |
|---|---|---|
| `create index concurrently wo_photos_recent_idx on wo_photos (created_at desc)` | A5-02 | **minutes** |
| A test with `offerPct ≠ 1` | A4-01 | 0.25 |
| Empty `DEFAULT_COMPANY`, populate `invoicing_bank` | A6-01 | 0.5 |
| `git branch -d` × 48 (all merged, zero risk) | A1-08 | minutes |

A5-02 removes a 500,000-row sequential scan from the busiest staff screen.
A4-01 is the only untested money path in the system. Both are effectively free.

## Fix batches, in §5 order

### F0 · Rulings — ✅ COMPLETE
§8.1 **(b)**, §8.2 subsumed, §8.4 already built, A3-04 ruled keep. Outstanding:
**§8.6** (monitoring provider — blocks A4-03), **§8.3/8.5/8.7/8.8/8.9**.

### F1 · CI and the gates — 2.5 sessions ⭐ highest leverage
| ID | Sev | Finding |
|---|---|---|
| A1-05 | High | No CI at all — **FIXED in F1** |
| A1-06 | High | 160 conditional e2e skips — **FIXED in F1 (CI fails loudly)** |
| A1-07 | Med | No production tripwire — **FIXED in F1 (globalSetup)** |
| A1-03 | Med | Test project behind head — **FIXED in F1 (120/120)** |
| A4-01 | High | Contractor payment basis untested — **FIXED in F0** |

*Everything below is unsafe to attempt before this batch lands.* §5 says so and
A5's experience confirms it: a green e2e line meant little until the skip count
was read alongside it.

### F2 · Security edges — 2.5 sessions
| ID | Sev | Finding |
|---|---|---|
| A3-01 | High | Estimate, invoice, WO and crew tokens never expire |
| A6-01 | High | Real BSB/account + personal mobile in `company.ts` |
| A6-04 | High | No evidence a restore has ever been performed — **ask Tom** |
| A3-02 | Med | No magic-byte validation on uploads |
| A3-03 | Med | Estimate property photos in a world-readable bucket |
| A3-05 | Low | 3 server actions take untrusted input without zod |

### F3 · Single-source violations — 2.5 sessions
| ID | Sev | Finding |
|---|---|---|
| A2-04 | High | Ledger tests test a twin nothing calls — **FIXED in F3** |
| A2-03 | High | 20 `money()` formatters that disagree |
| A2-05 | Med | GST computed in 3 places outside the utility |
| A2-06 | Med | No single date/timezone utility; 19 zone references |
| A4-02 | Med | Golden fixtures pin the rate card but not settings |

A2-04 first — it is the one that makes the others' tests trustworthy.

### F4 · Test data and enum drift — 1.5 sessions
| ID | Sev | Finding |
|---|---|---|
| A3-09 | Med | Production test data identified but not cleaned — **ask Tom** |
| A3-07 | Low | Enum drift not automated (3 of 28 hand-checked) |

### F5 · Deletion — 1 session, own commit, full gate after
| ID | Sev | Finding |
|---|---|---|
| A1-02 | Med | 8 tables no code touches — **production row count first** |
| A1-04 | Low | 218 unreferenced exports (mostly de-export, not delete) |
| A1-08 | Low | 48 merged branches |
| A1-10 | Low | `design/reference/` unarchived — **ask Tom** for the mapping |
| A2-07 | Low | `accept_estimate`'s two ignored parameters |

### F6 · Structural moves — 9–11 sessions, last, on green tests
| ID | Sev | Finding |
|---|---|---|
| A2-01 | High | 58 direct browser→DB table mutations across 22 files |
| A2-02 | High | Rate card saved by a sequential client loop, not a transaction |
| A2-08 | Med | 16 of 24 oversized files need splitting |
| A1-01 | Med | `QuoteBuilder.tsx` — 3,272 lines, 12 components, 71 `useState` |

A2-02 first: it is one RPC, it retires three of A2-01's sites and all six
`EditableTable` mount points, and it closes a verbatim CLAUDE.md violation on
the money path.

### F7 · Performance — 4.5 sessions
| ID | Sev | Finding |
|---|---|---|
| A5-02 | High | `wo_photos` seq-scans 500k rows — **do this in F-zero** |
| A5-01 | High | PC console reads two unbounded tables — ~1.4s DB time |
| A5-03 | High | Nightly sweep: 2,000 sequential RPCs today |
| A5-04 | Med | No pagination anywhere; `.range()` in zero files |
| A5-05 | Med | 20 loops with a DB call per iteration (4 that matter) |
| A5-06 | Med | No volume gate on the PC board or invoicing dashboard |
| A3-06 | Med | 68 FK columns with no leading index |

### F8 · Observability — 1.25 sessions
| ID | Sev | Finding |
|---|---|---|
| A4-03 | High | No error monitor wired — nothing alerts a human |
| A4-05 | Low | Health check is a page, not a JSON endpoint |
| A4-04 | Low | 5 of 75 async components with no failure surface |
| A6-05 | Med | No rollback plan for a bad migration |
| A6-06 | Low | Patch-level dependency drift (0 vulnerabilities) |

### F9 · Tenancy — ~14 sessions, scheduled
| ID | Sev | Finding |
|---|---|---|
| A6-02 | Med | 83 tables, 141 policies, 177 RPCs |
| A6-03 | Med | Australian assumptions: GST, zone, locale, 50 km bias |

**The standing rule starts today, not at F9:** every new table carries
`tenant_id` in its creating migration, every new policy a tenant predicate.
That costs ~nothing per module and is what holds the retrofit at 14 sessions
instead of 18.

## Totals

| Batch | Sessions |
|---|---:|
| F1 CI and gates | 2.5 |
| F2 Security edges | 2.5 |
| F3 Single-source | 2.5 |
| F4 Test data | 1.5 |
| F5 Deletion | 1 |
| F6 Structural | 9–11 |
| F7 Performance | 4.5 |
| F8 Observability | 1.25 |
| **Subtotal, everything but tenancy** | **~25–27** |
| F9 Tenancy | ~14 |
| **Total** | **~39–41** |

**Highs only (F1–F3 + the F7 quick wins): ~8 sessions.** That is the defensible
bar — it clears every High, and it is what a licensing buyer's due diligence
would look for.

Against the **8 November** workable date (§8.9, still unanswered): F1–F3 plus
the F7 quick wins is achievable. F6 and F9 are not, and should not be attempted
in that window — F6 produces large diffs and F9 is a schema-wide change; both
want a clean base and a working CI, and rushing either is how the bugs this
audit did not find get introduced.

## Closed during the audit

| ID | Outcome |
|---|---|
| A3-08 | **RLS behavioural check run — 15/15 passed, 0 skipped** |
| A3-04 | **Ruled: prep hours are contractor-visible — keep** |
| §8.4 | Test project already exists and is volume-seeded — needed finishing, not approving |

## Still outstanding — not findings, gaps in the audit

Recorded rather than glossed, because a register that hides its own holes is
not due-diligence material.

| Gap | Why it is open |
|---|---|
| Bundle size per route | Not measured; needs a build analysis (A5) |
| Image handling at volume | Buckets cap size and HEIC converts server-side, but not separately measured (A5) |
| PII in logs across all 37 `reportError` call sites | Contract is written down, not spot-audited (A4) |
| Per-table tenant isolation across all 83 tables | The pattern exists (A3-08); the generated test is F9 work |
| 25 of 28 enums | Three hand-verified; the rest need the automated check (A3-07) |
| Flaky tests | Not assessable — flakiness needs run history, which needs CI (A4) |
| Production data | Never queried, per §2.7. The A3-09 identification query is written, unrun |

## Acceptance criteria — audit itself

- [x] Every pass P0–P10 has a written section with evidence
- [x] Every finding carries a file/line or a runnable query
- [x] Every deletion candidate has a disposition (delete / keep with reason / ask Tom)
- [x] Baseline metrics recorded for after-comparison (P0)
- [x] Outstanding gaps listed rather than hidden

## Three questions still with Tom

1. **§8.6** — error-monitoring provider and budget. Blocks A4-03.
2. **A6-04** — backup schedule, retention, and has a restore ever been run?
3. **A1-10** — which design files are the "v4/v5 hero" and the "flat-table PC console"?

Plus **§8.3** (pause feature work during fixes, or interleave?), **§8.5**
(deletion appetite), **§8.8** (external review before licensing), **§8.9**
(target date).


---

# F0 — fix batch 1 (28 August 2026)

Branch `fix/f0-quick-wins`. The four items from A7's "start here". Gate after:
**tsc clean · 1,034 unit tests green · lint unchanged from main.**

| Finding | Change | Verified by |
|---|---|---|
| A5-02 | `supabase/migrations/20261202000000_wo_photos_recent_idx.sql` | readback in the migration; **awaiting Tom's paste** |
| A4-01 | 3 tests in `lib/pricing/estimate.test.ts` varying `offerPct` | the surviving mutation now fails 2 tests |
| A6-01 | `DEFAULT_COMPANY` emptied; personal mobile out of 3 fixtures; handoff doc redacted | repo-wide grep clean |
| A1-08 | 48 local branches deleted | `git branch` → `main` + working branch |

## A4-01 — proof the fix works

Before: dropping `* rates.offerPct` from `estimate.ts:411` left **22 passed**.
After, the same mutation:

```
× the offer percentage scales the contractor's pay
× a missing offer setting falls back to 100%, and that is not the same as configuring it
  Tests  2 failed | 23 passed (25)
```

Three tests added: the percentage scales pay; the `?? 1` fallback is
distinguishable from a configured value; and the percentage moves margin but
never the customer's price.

## A6-01 — wider than the audit recorded

The audit named `app/quote/company.ts`. Three more sites turned up:

- `lib/messaging/config.ts`, `lib/messaging/config.test.ts`,
  `lib/validation/contact.test.ts` used a **real personal mobile as a test
  fixture** — precisely what CLAUDE.md forbids ("…or in test fixtures").
  Replaced with **0491 570 006**, in the range ACMA reserves for fiction.
- `docs/SESSION-HANDOFF.md` carried the BSB and account in prose. Redacted.
- This register quoted them as evidence. **Redacted** — it is now safe to share.

Narrower in one respect: `app/(app)/settings/InvoicingSettings.tsx` was suspected
but has `bsb: ""`, `acc: ""`. Its entity name and address are public business
identifiers, so they are tenancy items (A6-02), not a secrets violation.

`DEFAULT_COMPANY` is now empty strings. **`settings.company_profile` must be
fully populated in production before this ships** — see
`docs/manual-tests/f0-company-settings.md`. Encryption at rest and masked
display remain unbuilt; recorded for F2, not silently absorbed here.

## A1-08 — one correction to the audit

A1-08 said "all 48 merged, zero risk". 47 deleted cleanly; `feat/presentations`
was refused by `git branch -d` because it was not merged to its own
remote-tracking ref. Checked before forcing:

```
local not on remote: 3    remote not on local: 0    local not in main: 0
```

All three commits verified present in main individually
(`git merge-base --is-ancestor`). The remote ref is stale, not ahead. Deleted
with `-D` on that evidence.

**22 remote branches were left alone** — deleting those is outward-facing and
needs Tom's say-so.

## New finding from this batch

### F0-01 · `npm run lint` fails on `main` — High

```
✖ 26 problems (3 errors, 23 warnings)
```

Identical on `main` and on this branch, so none are F0's. The three errors:

| File | Error |
|---|---|
| `app/(app)/settings/page.tsx:134` | Cannot call impure function during render |
| `app/portal/jobs/[id]/page.tsx:68` | Cannot call impure function during render |
| `app/portal/money/RequestClaim.tsx:64` | Compilation Skipped: existing memoization could not be preserved |

CLAUDE.md: *"Lint and typecheck must pass before any commit."* Typecheck does
(`tsc --noEmit` exits 0); lint does not, and has not for some time.

**This blocks F1 directly** — adding CI that runs lint would fail on the first
push. The first two are React Compiler correctness warnings about impure calls
during render, which is a real bug class, not a style nit.

*Fix:* in **F1**, before the CI workflow lands.
*Cost:* 0.5 session.


---

# F1 — CI and the gates (28 August 2026)

Branch `fix/f1-ci-gates`. The batch everything else depends on.

| Finding | Outcome |
|---|---|
| F0-01 | Lint errors **3 → 0** |
| A1-05 | `.github/workflows/ci.yml` — typecheck, lint, unit, mutation canary, e2e |
| A1-06 | Missing credentials now **fail** CI instead of skipping |
| A1-07 | Production tripwire on **every** e2e entry point |
| A1-03 | Test project at head — **120 / 120** |
| A5-02 | Index applied and measured — **590× faster**; live in production 28 Aug |
| **new** | F1-01: the suite's first confirmed flaky test, found and fixed |

## F0-01 — the three lint errors

| File | Rule | Fix |
|---|---|---|
| `app/portal/jobs/[id]/page.tsx:68` | `react-hooks/purity` — `Date.now()` in render | `requestNowMs()` |
| `app/(app)/settings/page.tsx:134` | same | `requestNowMs()` |
| `app/portal/money/RequestClaim.tsx:64` | `react-hooks/preserve-manual-memoization` | manual `useMemo` removed |

New: `lib/time/requestClock.ts`. `React.cache()` makes the clock **stable for
one request**, so every caller in a render sees the same instant — an offer
cannot be live at the top of a page and expired at the bottom. That satisfies
the purity rule properly rather than hiding the call from the linter.

`RequestClaim.tsx`'s `useMemo` depended on `job`, derived during render, so the
compiler refused to optimise the whole component. The arithmetic moved to a
module-level pure function — no memo needed, and money maths leaves a component,
which is where A2-01 wants it anyway.

## F1-01 · The first confirmed flaky test — fixed

`lib/gcal/gcal.test.ts` failed once during this batch. It was not caused by any
F1 change — nothing here touches gcal.

```ts
expect(verifyState("secret", state.slice(0, -1) + "0")).toBe(false);
```

The MAC is hex. When it already ended in `"0"`, the "tampered" state was
byte-identical to the original, and `verifyState` was **right** to accept it.
A test bug, not a product bug — the signing code is sound.

Measured before fixing: **3 failures in 20 runs**. After: **0 in 30**.

This is the finding A4 recorded as *not assessable* — "flakiness is a property
of repeated runs, and with no CI there are no repeated runs to look at." It
surfaced the moment the suite was run in anger. Once CI runs the suite on every
push, this class stops hiding.

## The CI gate

`gate` (no secrets, blocks merge today): typecheck · `eslint --max-warnings 23`
· `npm test` · **mutation canary**.

The canary breaks the marginal-coat rule and requires the pricing suite to
notice. **If that step ever passes, the pricing suite has stopped testing
pricing.** It is the standing, cheap version of P6's mutation check, and it was
verified both ways locally.

The warning cap of 23 is a **ratchet, not a target** — lower it when warnings
are cleared, never raise it.

`e2e` (needs secrets): builds with the test stack's env and runs the
customer-journey suite plus both RLS specs, with `CI=1` so a missing credential
is a failure.

### ⚠ Tom: the `e2e` job fails until its secrets exist

Deliberate. A job that skipped itself and reported green is precisely A1-06.
Add these repository secrets from `.env.test.local` — **test project only**:

```
E2E_SUPABASE_URL  E2E_SUPABASE_ANON_KEY  E2E_SERVICE_ROLE_KEY
E2E_STAFF_EMAIL  E2E_STAFF_PASSWORD
E2E_CONTRACTOR_EMAIL  E2E_CONTRACTOR_PASSWORD
E2E_CUSTOMER_EMAIL  E2E_CUSTOMER_PASSWORD
```

Mark **`gate`** required in branch protection now; add **`e2e`** once the
secrets are in.

## A5-02 — measured, not assumed

| | Before | After |
|---|---|---|
| Plan | Parallel Seq Scan, 500,000 rows | Index Scan |
| Buffers | 8,622 | **4** |
| Execution | 134.7ms warm / 1,704ms cold | **0.229ms** |

Index size 3.4 MB, `indisvalid = true`.

**Applied to production 28 August 2026**, readback confirmed `is_valid = true`.
Note for the 68 index candidates in F7: the Supabase SQL editor sends a
selection as ONE multi-statement query, which Postgres wraps in an implicit
transaction — so `CONCURRENTLY` must be executed on its own, separately from
its readback. The same trap broke `apply-migrations.mjs` until it was taught to
send statements individually.

## Tooling: `-- @no-transaction` migrations

`CREATE INDEX CONCURRENTLY` cannot run in a transaction, and the applier wrapped
every file in one. Dropping `CONCURRENTLY` was the wrong answer — the plain form
takes an ACCESS EXCLUSIVE lock, which on `wo_photos` (500k rows, 143 MB) blocks
every photo write while it builds.

`scripts/c1/apply-migrations.mjs` now honours a `-- @no-transaction` marker on
the first lines of a file, sending each statement separately (a multi-statement
simple query is itself an implicit transaction — the first fix was not enough).
Files containing `$$` are refused rather than split wrongly.

**F7 has 68 more index candidates.** They will all want this.


---

# F3 (part) — A2-04 the ledger twins are now diffed (28 August 2026)

Branch `fix/f3-ledger-diff`. New spec: `e2e/ledger-parity.spec.ts`, wired into
the CI e2e job.

## What it does

One fixture exercising every branch where the two implementations could
disagree, then: read the rows back → compute the ledger in **TS** → call
`invoice_ledger_staff` through a **real staff session** → require all six
figures to match.

| Branch | Fixture covers |
|---|---|
| Variations that count | `customer_approved` +50,000 · `contractor_accepted` credit −20,000 |
| Variations that do not | `raised` · `priced` · `declined` · `cancelled` · an unpriced approved one |
| Invoices excluded | `draft` · `void` |
| Invoices included | `issued` `sent` `viewed` `partially_paid` `paid` **`written_off`** |
| Credit notes | −25,000 against the issued invoice |
| Payments that count | `succeeded` only — `failed`, `pending`, `refunded` present and ignored |

Every expected figure is distinct, so a wrong one names itself.

**Parity alone would be a weak test** — it passes if both sides are wrong in the
same way, which a hand-pasted migration makes entirely possible. So the spec
asserts three things: the twins agree, **both equal the expected figures**, and
every figure is integer cents on both sides.

The SQL side is reached through a staff login, never the service key —
`invoice_ledger` is revoked from `authenticated` and only the `_staff` wrapper
is granted, so this exercises the real path.

## Proof it catches drift — mutation-tested both ways

A passing test proves it runs, not that it would notice. Three mutations:

| Mutation | Result |
|---|---|
| **TS**: `invoicedCents` counts drafts | ✅ `invoiced_cents: ledger.ts says 835000, invoice_ledger says 735000` |
| **TS**: credits add instead of subtract | ✅ `variations_cents: ledger.ts says 70000, invoice_ledger says 30000` |
| **SQL**: `invoice_ledger` lets `void` count | ✅ `invoiced_cents: ledger.ts says 735000, invoice_ledger says 935000` |

The third is the one that matters. **SQL drift was previously invisible** —
`schema.contract.test.ts` greps the migration *file*, so changing the live
function changed behaviour and failed nothing. Now it fails a test, and the
failure message names both implementations and both numbers.

The live function was captured with `pg_get_functiondef` before mutating and
restored afterwards; restoration verified, spec green again.

## What this does not do

- It does not make `ledger()` a caller-visible module. **The TS twin still has
  zero callers in the app** — screens read the SQL RPC. That is fine, and now
  it is *safe*, because drift fails a test. Whether to delete the TS twin or
  adopt it is a separate decision, not one this batch should take.
- It runs in the **e2e** CI job, so it needs the repository secrets. Until those
  are added it does not guard anything.
