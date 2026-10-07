# Finish standards, Step 1 — manual test script for Tom

Branch `feat/standards-status-callbacks`. Phone, both themes. About ten minutes.

## Before you start
1. Paste `supabase/migrations/20270224000000_finish_standards.sql` in the SQL editor. Compare the read-back row to its `_expect_` columns: 5 tables, 5 policies, 5 RLS on, no insert for authenticated, no anon read, `small_job_hours` grant true, `small_job_hours` = 16, dead table 0.
2. Load Version 1: `SEED_ALLOW_PRODUCTION=1 npx tsx scripts/seed-standards.ts --prod`. The last line must read **read-back equals the file ✓** with 17 surfaces, 53 checks, 159 level rows.
3. Deploy the branch.

## As a painter (your test contractor login), on your phone
1. **Home** → the **Finish standards** card is under Your work. Tap it. You land on **Help › Finish standards** with Version 1, approved 6 Oct 2026, the Interior / Exterior switch and a grid of seven interior surfaces.
2. Tap **Exterior** → ten surfaces, including Fretwork. Tap **Walls** (Interior) → Level 3 is selected; **Every level** reads "Full, even cover…"; the Lines row says "Sharp and straight from 1.5 m." Tap **Level 4** → "0.5 m". Tap **Level 2** → "3 m".
3. Back → **The rules** → **The defect rule**: the dashed note says the tape step is not required under 16 hours.
4. Flip the theme (sun / moon in the header). Every standards screen follows: white cards, dark text. Flip back.
5. Open a current job. Under each surface row in **Scope & ticks** there is **What we expect ›** (also under each line in the job sheet). A gutters, downpipes or allowance line has none. Tap one: the surface opens with the blue pill **Level N on this job**, no level switch, and **See other levels ›**. **← Job** returns.
6. On the job sheet, beside **Level of finish**: the chip now reads "PG-3 · Level 3 · Our standard finish — what this means"; tap it for the five summary rows and **Open the finish standards ›**. Under it, **Tape check required — this job is 16 hours or more** or **Tape check not required — this job is under 16 hours**, from the estimated hours.
7. **+ Found something** on the job: the chips include **Bogging**, **Stain blocking** and **Additional coats**.

## As PC (office login)
1. Open the same job in PC Command. Each **Scope & ticks** row has **What we expect ›** going to `/pc/standards/...?level=N&job=...`.
2. On a job at **05 Quality check**, the Quality check card lists **What we expect on this job's surfaces** with one link per surface; tap one → the same record, locked to the job's level.
3. `/pc/standards` browses the whole guide in the PC shell.
4. Price a painter's request raised as **Bogging** in the revision builder: the adopted variation keeps **Bogging** as its category.

## As a customer
1. Sign in to a customer account and open any job. Nothing about standards appears. (The e2e proves the tables return no rows to a customer token.)

## Settings
- **Settings → Pricing & job numbers → small_job_hours** = 16. Change it to 50 and a 20-hour job's sheet reads **Tape check not required**. Put it back.

## What to tell me
- Any surface line on a real job that should have a link and does not: run `node scripts/diag/standards-unmapped-lines.mjs` and send me the list.
- Any wording on a standards screen that is not the approved guide's.
