# Workflow Audit — Response & Action Plan

**Audit:** 23 August 2026 · workflow end to end
**Response prepared:** 23 August 2026
**Constraint:** invoicing is not yet built (buildout item 2 of 7, after the WO completion loop)

---

## 1. The two findings being under-read

### 1.1 S7 is not hygiene — it blocks the proving window

98% of users and 67% of estimates on the live project are test debris. The proving window is the gate on the whole November 8 timeline, and its exit criteria are *median correction under $150* and *the accuracy gate holding*.

**Those numbers cannot be measured on a database that is 67% fake estimates.** Every median, every count, every list the office looks at is currently mostly driver output titled "Murrumbeena 3163".

There is a second consequence the audit states but does not rank: `e2e-first as an anonymous customer` is law in `CLAUDE.md`, and the suite can no longer be run whole. An unenforceable law is not a law. The process that was meant to stop another wizard-class failure is currently not running end to end.

S7 moves up the list accordingly.

### 1.2 S2 and S3 do NOT wait for invoicing

The instinct — "invoicing isn't built, so park the invoice findings" — is right for S1 and wrong for S2 and S3.

The system is already **writing** invoice rows. Acceptance writes a deposit invoice; sign-off writes a final stub. That is correct behaviour and should continue. What is wrong is that every row is written with a null `customer_id` against an FK that silently orphans on delete.

So the write side shipped without the read side, and it is accumulating a data model that will be wrong the day the read side arrives. Fixing it now is two Size-S changes. Fixing it later is a backfill migration plus a UI that ships showing nothing to customers — and, as the audit says, **it will present as an RLS bug**, which is the most expensive class of bug in this stack to chase.

Do S2 and S3 now, with no UI. Defer S1 to its scheduled phase.

---

## 2. Triage

| ID | What | Priority | Size | When |
|---|---|---|---|---|
| **S0** | Wizard lockout, button lies "Uploading…" | **P0** | S | Immediately, alone |
| **S2+S3** | Invoice `customer_id` + FK contradiction | **P0** | S+S | Before more rows accumulate |
| **S7** | e2e teardown + production data sweep | **P0** | M | Before the proving window |
| **S4** | Painters cannot see their own photos | **P1** | S | Next |
| **S6** | Scheduling board has no tests | **P1** | S | Before S5 touches the module |
| **S5a** | Board filters closed work orders | **P1** | S | With S6 |
| **N1, N2, N4** | Housekeeping | **P2** | S | Batch together |
| **S1** | Invoicing UI | **Deferred** | M/L | Its scheduled phase |
| **S5b** | Denormalise board's derived numbers | **Deferred** | M | Needs decision §3.3 |

**S0 first, and alone.** Customers self-serving estimates is the entire business case. A form that says "Uploading…" about a file they never chose, with no way forward, is revenue walking away — and it is Size S.

Note the link between S0 and S7: the rate limit that surfaced S0 came from the test suite. Fixing S7 removes today's trigger; fixing S0 removes the failure mode. **Both are needed** — a rate limit is a plausible production event on a busy day, or under abuse, with no test suite involved at all.

**S6 before S5a.** S5 changes `board.ts`. Write the tests for a 305-line untested module *before* refactoring it, not after. The audit sizes S6 as S because the functions are already pure — take that.

---

## 3. Decisions for Tom — ⚑ do not let these be invented

### 3.1 ⚑ S3 — cascade or restrict?

**Recommendation: `on delete restrict`.**

The app already refuses this delete with `has_invoice`. Restrict makes the database agree with the app. Cascade makes the database *silently do the thing the app explicitly refuses to do* — one action with two behaviours depending on the path taken, which is precisely the class of bug that has bitten this codebase before.

Invoices are financial records. Hard to destroy accidentally beats tidy.

**Consequence to accept:** e2e teardown must then delete invoices before estimates. That is more explicit, not worse.

### 3.2 ⚑ S2 — should `customer_id` be NOT NULL?

**Recommendation: yes, after backfill.**

Setting it at insert in three places fixes today. A NOT NULL constraint means a fourth insert site can never be added that forgets it. The bug cannot recur.

Do it in order: backfill the real rows → clear the orphans → add the constraint.

### 3.3 ⚑ S5b — where do the board's derived numbers live?

The audit proposes storing total hours and job title on `work_orders` at issue time so the board never reads `wo_snapshot`. That is the right performance answer and it creates a **second source of truth**.

Question that must be answered before it is built: **what happens on a variation?** A variation changes the hours. If the denormalised total does not update, the board shows a stale number; if it does, there are now two places hours can be wrong.

This codebase has already been bitten twice by duplicated logic — confidence computed two ways returning 41% and 90%. Do not add a third instance without a written rule.

**Recommendation:** S5a only for now (filter closed jobs — free, no new state). Defer S5b until the rule is written: *what recomputes the derived numbers, and what test proves they match the snapshot.*

### 3.4 ⚑ A dedicated Supabase project for tests

The audit calls this "the better answer if one can be afforded". It can — a second Supabase project is free or trivially cheap, and it solves S7 permanently rather than palliatively: teardown becomes optional, the suite runs whole, production stays clean, and test volume can never rate-limit real customers again.

**Recommendation: do both.** Teardown now, because it is fast and needed regardless. Separate project as the real fix, scheduled as its own small phase.

### 3.5 ⚑ S1 — when does invoicing get built?

It is item 2 in `post-wizard-buildout-order.md`, immediately after the WO completion loop. Only **3 of 37** invoice rows are real, so nothing operational is blocked today.

**Recommendation:** do not half-build it. A read-only staff list now is throwaway work that ships a screen the customer still cannot see. Fix the data model (§2), finish the WO loop, then build invoicing properly as its phase — landing on rows that are already correct.

---

## 4. Message to paste into Claude Code

Paste from here down. One batch per session.

> ### Read first, confirm back
>
> Read `CLAUDE.md`, `docs/audits/workflow-audit-2026-08-23.md`, and `docs/briefs/claude-code-brief-wo-loop-pc-command.md`. Confirm the file list back before writing code. Missing reference = STOP and report.
>
> ### Rules for every batch below
>
> - One batch per session. Do not start the next.
> - No migrations executed — output SQL for me to paste, and only between gate runs.
> - Show me the diff and wait for approval before committing.
> - Run the unit suite before and after each batch. It is 579 tests across 45 files and it is green today — it must still be green.
> - Nothing outside the named batch. No opportunistic cleanups.

---

### Batch 1 — S0 · Wizard lockout (P0, ship alone)

    Fix S0 in app/wizard/WizardApp.tsx.
    Three separate faults, all three must be fixed:
    (1) A failed signInAnonymously leaves sessionReady false for ever with no
        retry. Add a retry with a visible "Try again" control.
    (2) The fetch has no timeout, so a stalled request on a phone never
        resolves and not even the error renders. Add a timeout so a stall
        becomes a visible error state. The capture code calls a stalled phone
        request "the NORMAL case on site" — treat it as expected, not
        exceptional.
    (3) The Continue button renders "Uploading…" when the real reason it is
        disabled is the session. Page 1 receives uploading={uploading ||
        !sessionReady}. Separate the two states: a disabled Continue must
        never claim a file is uploading when no file was chosen.
    Customer-facing copy in ENGLISH (not Australian) tone.
    Test: unit tests for the retry and timeout paths, plus a spec that
    asserts the button label when the session fails vs when a file uploads.

**Accept:** a failed sign-in is recoverable without a page reload · a stalled sign-in produces an error, not a spinner · no code path renders "Uploading…" for a session failure · unit suite green.

---

### Batch 2 — S2 + S3 · Invoice data model (P0, no UI)

    Fix the invoice data model. NO invoices UI in this batch — the invoicing
    phase comes later and must land on correct rows.

    S2: every insert into invoices (accept_estimate, wo_customer_signoff, and
    any third site — find them all and list them to me) must set customer_id
    from the estimate. Then make customer_id NOT NULL so a future insert site
    cannot forget it.

    S3: change invoices.estimate_id to ON DELETE RESTRICT (decision made — the
    app already refuses this delete with has_invoice; the database must agree
    rather than silently orphan). Do not use cascade.

    Order of operations, as SQL for me to paste:
      1. Backfill customer_id on real rows from the parent estimate.
         Confirm the estimates column name first — do not assume.
      2. Report the count of orphans matching (estimate_id IS NULL AND
         amount_cents = 0) and STOP. I will confirm before any delete.
         Do not delete on "no estimate" alone — 3 of 37 rows are real.
      3. After I confirm: delete the confirmed orphans.
      4. Add the NOT NULL constraint and the FK change.
    Migrations between gate runs, never during one.

**Accept:** every insert site sets `customer_id` · a test proves an insert without it fails at the database · deleting an estimate that has an invoice is refused *by the database*, not only by the RPC · orphan count reported and confirmed before any deletion · no invoices UI in the diff.

---

### Batch 3 — S7 · e2e teardown and production sweep (P0)

    The test suite has put 638 anonymous users and 47 fake estimates into the
    live project. This blocks the proving window, whose exit criteria are
    measured on this data.

    1. Add teardown to the customer-journey specs. The woLoop fixtures already
       do this correctly — follow that pattern; the customer-journey specs are
       the gap. Delete the anonymous user each run creates.
    2. Mark test-created records so they can be excluded from staff lists and
       swept later. Pick one mechanism and apply it consistently.
    3. Write a sweep script for existing debris. Report counts by category and
       STOP before deleting anything. I will confirm each category.
       Note batch 2 made the invoice FK RESTRICT, so invoices must be deleted
       before their estimates.
    4. Report how long the full suite takes once teardown is in.

    Then tell me what a dedicated test Supabase project would take to set up —
    schema sync, seeding, CI config. Estimate only, do not build it.

**Accept:** a customer-journey run leaves no residual user or estimate · sweep reports counts and waits for confirmation · staff lists can exclude test records · full-suite runtime reported.

---

### Batch 4 — S4 · Painters can see their photos (P1)

    Painters cannot see the photos they took. SitePhotos uploads and counts
    ("3 sent") but never lists; the portal job page reads wo_photos only to
    answer whether an elevation has its before photo.
    This matters operationally, not cosmetically: before-photos gate the first
    tick, QA checks are photo-logged, and sign-off runs off an evidence pack.
    A painter who cannot see what landed will re-send duplicates or assume a
    failed upload succeeded.
    PhotoGrid and lib/workorder/photos.ts already do this and are shared-safe.
    Give the portal page (app/portal/jobs/[id]/SitePhotos.tsx) and the office
    mirror (app/pc/wo/[id]/as-contractor/page.tsx) the same signed read the
    console page uses.
    E2e AS THE CONTRACTOR: upload, see it listed, confirm the office mirror
    shows the same set.

**Accept:** contractor sees their own photos in the portal · office mirror and console agree on what exists · signed-URL read path reused, not reimplemented.

---

### Batch 5 — S6 then S5a · Board tests, then board filter (P1)

    Tests FIRST, then the change — in that order, in this one session.

    S6: unit tests for lib/scheduling/board.ts (305 lines, 0 tests). Cover the
    unscheduled tray, which offers become blocks, block layout without
    overlap, hours→days conversion, and the suburb truncation. The functions
    are pure over their inputs. This is the module where a quiet mistake means
    a contractor does not turn up.

    S5a: with those tests green, add a filter so the board stops reading every
    work order ever written including its full wo_snapshot. Filter out closed
    jobs. The tests must still pass unchanged.

    Do NOT denormalise total hours or job title onto work_orders in this batch
    — that is a separate decision about where derived numbers live, and it is
    not made yet.

**Accept:** board logic covered by tests written before the change · closed jobs excluded from the board read · no new denormalised columns in the diff.

---

### Batch 6 — N1, N2, N4 · Housekeeping (P2)

    N1: add zod to app/auth/actions.ts — the only server action without it.
    Errors should be ours, not Supabase's raw wording.
    N2: the daily sweep is scheduled 0 8 * * * and Vercel cron is UTC, so it
    drifts between 6pm and 7pm Melbourne twice a year while the code calls it
    "the 6pm sweep". This affects sign-off nudge timing. Either run it twice
    and no-op the wrong one, or rename it honestly. Tell me which you chose.
    N4: narrow the exports that nothing outside their module uses —
    daysFromHours, customerRoomView, elevationsKeptBy, isWallLine, dwTotals,
    sidesDoneCount, parseBlockContent.
    N3 and N5 need no action; leave them.

**Accept:** every server action zod-validated · cron naming matches behaviour · module API surfaces narrowed with no behaviour change · unit suite green.

---

## 5. Not being actioned, deliberately

| Finding | Why |
|---|---|
| S1 — invoicing UI | Its scheduled phase (buildout item 2). Only 3 real rows exist. A read-only staff list now is throwaway work. |
| S5b — denormalised board numbers | Needs the variation-recompute rule written first (§3.3). |
| N3 — lazy offer expiry | Correct as designed. `respond_to_offer` re-checks `expires_at`. Documented, not fixed. |
| N5 — two silent catches | Deliberate, documented, caller returns the real error. |

---

## 6. One thing to check that the audit did not

If 47 of 70 estimates are driver output, **any platform-side metric computed to date is suspect** — win rates, median corrections, estimate volumes, anything read off the `estimates` table.

The 471-job Airtable calibration set is separate and historical, so the pricing engine's calibration is unaffected. But before the proving window starts, confirm no platform-derived figure has been quoted as real.

---

## 7. Reference files

    docs/audits/workflow-audit-2026-08-23.md
    CLAUDE.md
    docs/briefs/claude-code-brief-wo-loop-pc-command.md
    docs/briefs/post-wizard-buildout-order.md
    lib/scheduling/board.ts
    lib/workorder/photos.ts · components PhotoGrid
    app/wizard/WizardApp.tsx
    playwright.config.ts · e2e/customer-journey/drive.ts

**Kickoff ritual:** commit these, confirm the file list back before writing code. Missing reference = STOP and report.
