# Manual test — WO loop step 1: the seven-stage machine

Run the three migrations **in order**, in the Supabase SQL editor, then work
through this. Nothing here needs the app rebuilt except the last section.

    supabase/migrations/20260926000000_wo_loop_stage_machine.sql
    supabase/migrations/20260927000000_wo_loop_tables.sql
    supabase/migrations/20260928000000_wo_loop_settings.sql

## 1. Every existing work order got a stage (no row left behind)

```sql
select stage, status, count(*) from work_orders group by 1, 2 order by 1;
```

Expect: no null stage. `closed`↔`complete`, `pre_start`↔`issued`, the working
stages↔`in_progress`. A WO that was never issued shows `offered`↔`draft`.

## 2. An illegal move is refused, and changes nothing

```sql
select public.wo_advance_stage('<a work order id in offered>', 'closed');
```

Expect `error:illegal_transition:offered>closed`. Then re-run the query in §1 —
the counts must be identical. Nothing moved, nothing was logged.

## 3. A legal move works and writes its event

```sql
select public.wo_advance_stage('<a work order id in pre_start>', 'in_progress');
select type, from_stage, to_stage, actor_kind, meta->>'label'
  from wo_events order by created_at desc limit 1;
```

Expect `ok:in_progress`, then one row: `stage_changed | pre_start | in_progress |
staff | pre-start checklist complete`. Check `work_orders.status` for that row is
now `in_progress` — **you did not type it**, the machine derived it.

## 4. Tapping the same move twice is not an error

Run the §3 call again. Expect `ok:in_progress` and **no second event row** — a
phone on a slow network must not produce a failure or a duplicate.

## 5. The stage follows the booking

Offer that job to a contractor and accept it in the portal, then cancel the
booking from the schedule board.

Expect: on acceptance the stage moves `offered → pre_start`; on cancellation it
returns to `offered`, and `wo_events` has two `system` rows with
`meta->>'via'` = `booking_accepted` and `booking_cancelled`. The job lands back
in the tray exactly as it did before.

## 6. RLS holds for a contractor who isn't on the job

Signed in as `pg.mira.contractor@gmail.com` (not assigned):

```sql
select public.wo_advance_stage('<Josef''s work order id>', 'qa');
select count(*) from wo_events where work_order_id = '<Josef''s work order id>';
```

Expect `error:not_yours` and `0`. Repeat as `pg.melissa.customer@gmail.com` for a
job that isn't hers — same two answers.

## 7. The state columns are not client-writable

As any signed-in non-staff user:

```sql
update work_orders set stage = 'closed' where id = '<any id>';
```

Expect a permission error from the database, not a silent success.

## 8. The settings landed, with deemed sign-off OFF

```sql
select value->'signoff' from settings where key = 'wo_loop';
```

Expect `clockEnabled: true`, **`deemedEnabled: false`**, `residentialHours: 72`,
`nudgeHours: [0,24,48]`. The false one is deliberate and stays false until the
deemed-sign-off clause passes legal review.

## 9. The badge renders

Open an accepted estimate → **Work order** tab. Beside the existing status chip
there is now a stage badge — `03 IN PROGRESS` in cyan, `02 PRE-START` in amber,
`07 CLOSED` in emerald. It reads the live row, not the frozen snapshot.
