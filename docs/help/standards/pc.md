---
feature: standards
role: pc
title: Judge a quality check against the finish standards the painter was given
summary: The finish standards (Levels 2, 3 and 4) are data under PC Command → Standards, and every quality-check card and tick-list row on a job links each surface to its standard at that job's level — the same record the painter opens from their work order, so both of you judge against the same words. Also covers the small-job hours setting and how the standards are loaded.
sources: app/pc/standards, app/pc/wo/[id]/QaCheck.tsx, app/pc/wo/[id]/page.tsx, app/components/standards, lib/standards, scripts/seed-standards.ts, supabase/migrations/20270224000000_finish_standards.sql
---

## What this is for
Paint Group's finish standards say, surface by surface, what a painter must do at Level 2, 3 and 4. They are stored as data (one row per surface, per level, per check) so the painter's app, the job page and the quality-check screen all read one record. When you run a quality check, each surface on the job links to its standard at the job's level: what you are judging against is exactly what the painter was shown.

## Before you start
- Migration `20270224000000_finish_standards.sql` must be applied and Version 1 loaded with `npx tsx scripts/seed-standards.ts` (test) or `SEED_ALLOW_PRODUCTION=1 npx tsx scripts/seed-standards.ts --prod`. Until then every standards screen says **The finish standards could not be loaded** rather than showing an empty list.
- **Settings → Pricing & job numbers → small_job_hours** (default 16): a job under this many estimated hours shows **Tape check not required** on its job sheet. Jobs at or above it show **Tape check required**.

## Steps

### On a job
1. Open the job in PC Command. Above **Scope & ticks** one card, **What we expect on this job**, lists every scope line that has a finish standard with the checks at the job's level; tap a line to read them, **Open the full standard ›** for the page. A row with no finish standard (gutters, an allowance line) has none.
2. At the quality-check stage the same **What we expect on this job** card at the top of the page is your list: one line per scope surface with the checks at the job's level, for example **Lounge · Walls — what we expect ›**.
3. Tap a link. The surface opens locked to **Level N on this job** with every check for that level. **See other levels ›** compares; **← Job** returns to the job.

### Who has signed
1. **Contractors** (sidebar) carries a **Standards:** line on every card and a **Finish standards** row on each painter's page: confirmed with date and version, invited and inside the grace period, blocked (grace ended, no job offers), or not invited. **Send standards invite** / **Invite N to confirm the standards** start the grace period and send the invite; **Send reminder text** sends the reminder now.
2. In PC Command the queue shows **{painter} has not signed the finish standards** from day 7 after the invite, with **Send reminder text** and **Open painter**. The card clears itself when they confirm.
3. On the schedule board, dropping a job on a blocked painter shows **Standards not signed** and the Send offer button is off; **Hold these dates instead** still works. The RPC refuses too, whichever way an offer is attempted.

### Browsing the standards
1. Go to `/pc/standards` (also linked as **← Standards** from any surface). Choose **Interior** or **Exterior**, tap a surface, switch levels with **Level 2 / 3 / 4**.
2. **The rules** list opens the six rule pages the painter signs off on: the three levels, rules for every job, time and variations, the defect rule, the final checklist, words.

### Which lines have no standard
- A painter's request raised as **Bogging**, **Stain blocking** or **Additional coats** keeps that category when you price it in the revision builder; it no longer becomes "Extra scope".
- `node scripts/diag/standards-unmapped-lines.mjs` (read only) lists every surface line on open jobs that resolves to no standard, grouped by label, and the rate-card codes with no surface. The mapping lives in `lib/standards/codes.ts`; change it there, re-run the seed, and the links follow.

## What the colours and labels mean
- **Blue pill "Level N on this job"** — the surface is locked to the job's level (the area's level where staff overrode an area).
- **Look test 1.5 m** — the distance the level is judged from.

## If something goes wrong
- **"The finish standards could not be loaded (migration 20270224 not applied)"** — paste the migration, then run the seed script. The read-back at the end of the seed must say **read-back equals the file**.
- **A surface shows no link on a job** — its label matches no rate-card code or surface name, or the area has no PG level (a Level 1 estimate). Correct the level on the job page's **Level of finish** card, or ask for the code to be mapped.

## Related
- [Work orders in PC Command](../work-orders/pc.md)
