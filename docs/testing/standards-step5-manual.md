# Painter status — the evaluator, Step 5 — manual test script for Tom

Branch `feat/standards-status-callbacks`.

## Before you start
1. Paste `supabase/migrations/20270228000000_painter_status.sql`. Read-back: tables 3, policies 5, no insert, writer grant true, trigger_col 1, cadence_by_status true, one add-check function, launch 2026-10-08.
2. Deploy. The next daily sweep (or `GET /api/cron/campaign-sweep?only=status` with the cron secret) seeds every active painter as **New**.

## Office
1. PC Command → **Painters** (new tab in the rail). Every active contractor is a row, **New**, streak 0, "Why" says what Green needs. Employed painters who have never led a job are not there.
2. Nothing signed off before 8 Oct 2026 appears in any job count — the columns read 0 clean · 0 not clean for everyone today.
3. Open a job under way (any painter). Quality check card → **Spot check this job**. Message "Spot check added — it is on the painter's job"; the card lists a **spot** check; the painter's job page shows it.
4. Over the next weeks: a job signed off is **pending** for seven days, then **clean** or **not clean**. The row's colour, streak and measures move; Why names the measure that is holding the painter.
5. A call back logged, a quality check logged, or a painter's update text answered recomputes within the half hour; the daily sweep covers everything else.

## Nothing to see for painters yet
Painters can read their own row (RLS), but the traffic light on their home screen is Step 6 — nothing shows for them in this step.

## What to tell me
- Whether 4 clean jobs for Green and 7 days to count are right (`settings.painter_status_rules`).
- Whether a New painter should get a check on 3 or 4 first jobs (today: `newJobs` 4 in the rules; the older `qaCadence.newContractorJobs` is what `wo_contractor_is_new` still reads — see the report).
