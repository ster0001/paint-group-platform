# Employed painters — progress ledger

**Read this first in every session. Update it last.** One row per session from `claude-code-brief-employed-painters.md` §6. The row is the truth about what has shipped; the brief and `employed-painters-session-0.md` are the truth about what to build. If they disagree, say so in the session before writing code.

## Preflight — paste at the start of every session

    Read docs/briefs/employed-painters-progress.md. Take the last row whose
    status is not TODO. Then, before touching code, report in one block:
    1. git log --oneline <that row's SHA>..origin/main — what has landed since.
    2. supabase/migrations/ files newer than the row's last migration, and
       whether each has a row in public._prod_migrations (output the SELECT
       for Tom if you cannot read production).
    3. Settings keys the next session expects (employees_enabled,
       expenseThresholdCents), and which already exist.
    4. Any open branch touching the files the next session names in
       employed-painters-session-0.md §6.
    5. The contractor regression list (session-0 §7): confirm it is green on
       this branch before the session starts, and again before it ends.
    6. The next session to run, and anything in its block the repo has
       already done — shrink the block and say what you removed.
    Wait for confirmation before starting the session.

## Postflight — the last act of every session

    Add the row: session, status DONE / PARTIAL / BLOCKED, date, merge SHA,
    migrations written (and whether Tom has confirmed them live on test and
    prod), settings seeded, unit count before → after, adversarial money
    test result, contractor suite result, ⚑s touched, and one line of
    "what the next session should know". Commit the ledger in the same PR.

## The ledger

| Session | What | Status | Date | Merge SHA | Migrations written · live? | Settings seeded | Unit tests before → after | Money test | Contractor suite | ⚑ touched | Next session should know |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | Read-only diagnostic | DONE — awaiting Tom's confirmation | 17 Sep 2026 | _(branch `feat/employed-painters`)_ | none (highest on main `20270152`) | none | 2585 baseline | not yet written | not run (no code changed) | A–J listed in session-0 §8 | Ten rulings in `employed-painters-session-0.md` §8; the defaults there apply if Tom says nothing. Session 1 does not start until Tom confirms the file map and the `wo_assignments` naming (⚑E). Two attention evaluators exist (⚑C) — employee items go to `lib/crm/work-queue.ts` only. |
