---
feature: induction
role: pc
title: Induction languages — switch a language on, see what each painter reads in
summary: Painters read and tick the induction and the six finish standards sections in the language they choose. Settings → Communications → Induction languages is where a language is switched on once its wording has been tested; off means it is not offered. The contractor's record shows which language they chose. The wording lives in translation files loaded by the seed script, never typed into Settings.
sources: app/(app)/settings/InductionLanguagesSettings.tsx, app/(app)/settings/inductionActions.ts, app/(app)/contractors/[id]/page.tsx, scripts/seed-induction.ts, docs/induction/translations/, supabase/migrations/20270267000000_induction_content.sql
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

## What the colours and labels mean
- **Live** (green) — offered on the language picker and the join page.
- **Off** (grey) — not offered; painters who chose it read English for now.
- **N painters reading in it** — active contractors with that language on record (workers are not counted here).

## If something goes wrong
- **The list says it could not be read** — migration 20270267 is not applied on this project; the folder shows the message instead of the switches.
- **A painter reports a wrong word** — the fix is in `docs/induction/translations/<code>.json`, then the seed script; the switch here never edits wording.
- **A painter says it is all still English** — check the language is Live here, then ask them to reload. Lines with no translation show English on purpose, with a note on the module page, and are reported to the error log with the keys.

## Related
- [Worker logins — pc](../worker-logins/pc.md)
- [Demo property — pc](../demo-property/pc.md)
