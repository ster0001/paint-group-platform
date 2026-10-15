---
feature: induction
role: pc
title: Induction — languages, who has ticked what, the practical check, the gates
summary: Painters read and tick the induction and the six finish standards sections in the language they choose. Settings → Communications → Induction languages switches a language on once its wording has been tested. A contractor's record shows their induction — full or refresher, modules ticked, completion, the practical check you record task by task, and whether offers are allowed. New painters get no job offer until the induction is complete, the five-task check is passed and insurance is verified; existing painters are invited to the refresher with a grace period; a worker login cannot be put on a real job until their worker induction and three-task check are in. The wording lives in translation files loaded by the seed script, never typed into Settings.
sources: app/(app)/settings/InductionLanguagesSettings.tsx, app/(app)/settings/inductionActions.ts, app/(app)/contractors/[id]/page.tsx, app/(app)/contractors/[id]/ContractorInduction.tsx, app/(app)/contractors/actions.ts, app/pc/demo/page.tsx, lib/induction/status.ts, scripts/seed-induction.ts, docs/induction/translations/, supabase/migrations/20270267000000_induction_content.sql, supabase/migrations/20270270000000_induction_signoff.sql
---

## What this is for
Ruling I8: the portal, the slides and the demo job stay English; only what a painter reads and ticks to confirm understanding is in their chosen language. Seven languages exist (English, Dari, Farsi, Arabic, Spanish, Portuguese, Italian). Each one starts as a machine first pass and is **off** until Tom's team has tested it and someone switches it on here.

## Before you start
- The content is loaded: `scripts/seed-induction.ts` has been run against the project (the office does not do this; it is part of a release).
- You are signed in as staff.

## Steps
1. Open **Settings → Communications & automations → Induction languages**. One row per language: the native name, the English name, how many painters are reading in it, and a **Live / Off** switch.
2. Tick **Live** on a language once its wording has been tested. It is offered to painters from the next page load; no deploy.
3. Untick to take a language off again. A painter who had chosen it keeps their choice on record and reads English until it is back on.
4. English cannot be switched off.
5. On a contractor's record, **Induction language** shows what they chose, or *not chosen yet (reads English)*.
6. **Induction** on the record shows the kind and where they are: *Induction 4 of 13*, *Refresher 7 of 7 · complete*, with the completion date and whether the practical check is passed. Painters who were on the books before induction day are on the **refresher**; painters who join after it are on the **full** induction. **Switch** changes that by hand.
7. **Practical check** (new painters and workers, never the refresher): one line per task — accept a job, add a before photo, move a surface to prepped, raise a variation, submit an invoice (three for a worker: open the job, before photo, prepped). Press **Pass** or **Not yet** as you watch each one. Not yet: they repeat the module and try again the same day; press Pass when they manage it. When every task is a pass the line says *check passed* and job offers open (with insurance on file).
8. **Invite to the refresher** on an existing painter: the text and email go and their grace period starts (the standards grace days). Offers continue through the grace; when it ends with the refresher unticked, offers stop until they tick it.
9. **Workers** under *Their crew* show their own induction line and the three-task check. Pass all three once the worker modules are ticked: *Inducted · can be put on a job* appears and the contractor's share switch works for that worker.
10. **PC Command → Induction** (the practice-job grid) now has a **Ticks** column: modules ticked of the total, with ✓ when the check is passed, beside the demo steps.
11. **A material wording change**: after the seed loads the new version, a staff RPC `induction_publish_version(no, changed_modules, note)` publishes it. Every painter keeps every tick except the changed modules, which show the note and ask for a fresh tick.

## What the colours and labels mean
- **Live** (green) — offered on the language picker and the join page.
- **Off** (grey) — not offered; painters who chose it read English for now.
- **N painters reading in it** — active contractors with that language on record (workers are not counted here).
- **Induction line** green — complete (and checked, where there is a check); amber — in progress; red — offers are blocked (*Induction not complete* or *Practical check not passed*).
- **Not inducted** on a worker — ticks or check still to come; the share switch refuses a real job (the demo is always allowed).

## If something goes wrong
- **The list says it could not be read** — migration 20270267 is not applied on this project; the folder shows the message instead of the switches.
- **A painter reports a wrong word** — the fix is in `docs/induction/translations/<code>.json`, then the seed script; the switch here never edits wording.
- **A painter says it is all still English** — check the language is Live here, then ask them to reload. Lines with no translation show English on purpose, with a note on the module page, and are reported to the error log with the keys.
- **Send offer answers induction_incomplete or check_not_passed** — exactly what it says; the record shows which modules or tasks are missing. The table refuses the same way whatever path writes the offer.
- **An existing painter is blocked and never did the refresher** — they were invited and the grace ran out. Invite again is not needed; once they tick the refresher offers resume. To waive, switch them to the full kind and back, or ask Tom about the gate switch in Settings (`induction_rules.offerGate`).
- **The record says Induction not available** — migration 20270270 is not applied on this project.

## Related
- [Worker logins — pc](../worker-logins/pc.md)
- [Demo property — pc](../demo-property/pc.md)
