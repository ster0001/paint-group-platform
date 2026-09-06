# 6 Sep 2026 — A failed quality check gets its own re-check

**SQL first:** paste `supabase/migrations/20270112000000_wo_qa_recheck.sql` into the
SQL editor (PRODUCTION project — check the ref) and read back ONE row, every column
`true`: `retry_col · open_fn · record_spawns_recheck · gate_uses_it · finish_uses_it ·
confirm_uses_it · route_uses_it · book_uses_it · no_parked_fails`. The last one means
every job parked on a failed check now has its re-check waiting — open those jobs on
the PC page and the new card is there.

Until it runs, a failed check still parks the job (the 6 Sep symptom); the screens
degrade to the old words ("Logged: FAIL", no re-check line) and nothing breaks.

## The story, in both portals

1. **PC:** on a job at In progress, tick **Quality check required** under Job facts
   (or use a new contractor's job). **Painter (phone):** tick every surface, answer
   the finishing-up list, **All done — next step** → the job reads Quality check.
2. **PC → the job:** the **Quality check** card with the four standards. Tap
   **Log FAIL**, Where = the area, What = "Re-sand and recoat the lower boards",
   **Log FAIL — raise rectification**. Expect:
   - the card now reads **Logged: FAIL · re-check scheduled — it appears here once
     the painter finishes again** (before: "Logged: FAIL", full stop);
   - the message under it: "Failed — rectification is on the painter's list. A
     re-check is scheduled …";
   - Job facts → Quality checks lists TWO rows: `final` **fail · re-checked** and
     `final · re-check` **due**;
   - the job is back at **03 In progress**.
3. **Painter:** the red **QUALITY CHECK — AREAS TO PUT RIGHT** card names the area;
   the **RECTIFY** row is on the tick list. Tick it done → the finishing-up card →
   **All done — next step** → "Paint Group will quality check the job now".
4. **PC → the job** (the job is at Quality check again). Expect TWO cards:
   - **Quality check final** — Logged: FAIL, no buttons (the record);
   - **Quality check re-check · 4 to check** — "Re-inspection after a fail …", four
     fresh standards, Notes, **Log FAIL** and the pass button.
   Before this fix there was only the first card and the job could not move.
5. Tick the four standards, add a note, **Log check — PASS**. Expect "Passed — all
   checks clear. The customer has their walkthrough; sign-off is running." and the
   rail at **05 Walkthrough**. The Walkthrough card can now book the final
   (before: `qa_first` for ever).
6. **Timeline:** `qa_fail` (with `recheck_id`), `qa_pass` (with `retry_of`), stage
   moves `qa → in_progress`, `completion_prep → qa` twice, `qa → walkthrough`.

## A re-check can fail too
Repeat step 2 on the re-check card: a THIRD check appears after the painter's next
finish, linked to the second. The chain is as long as it needs to be; the job only
moves when the newest one passes.

## Gates
- e2e `wo-qa-recheck.spec.ts` 4/4 on C1 — drives the painter's finish button and the
  QaCheck card in both directions; no service-role edits of `wo_qa_checks`.
- e2e `wo-full-loop.spec.ts` step 7 no longer flips the failed row to pass through the
  service client; step 8 reads the token the pass delivered.
- Unit `lib/workorder/qa.test.ts` (the open-check rule, TS twin of `wo_qa_open_count`).
