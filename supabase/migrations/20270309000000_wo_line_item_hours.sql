-- =============================================================================
-- 20270309 · The crew hours on a line item reach the work order
-- =============================================================================
-- Tom, 10 Nov 2026: at 5 Milton Street Carnegie the offered hours had changed
-- from 37 to 27. They never changed: the Deck around Pool line on the
-- estimate carries 10 h (hourly, 10 h × $85), the PAY of the contractor counts
-- them (priceEstimateTotals adds the hours of every line), but the builder built
-- the work order from the rooms and the Preparation line only — so the job
-- sheet, the tick list, the board and the hours on the offer (`send_offer` sums
-- areas → surfaces) all said 27.1 h. Twelve open jobs on production carried
-- line-item hours the same way (Cleaning, plaster repairs, scaffolding…).
--
-- The code fix (lib/workorder/lineArea.ts, QuoteBuilder) puts each line with
-- hours on the sheet as its own area with one surface — the Preparation
-- pattern — for every save from now on. THIS migration repairs the documents
-- already frozen, for every open job (any stage but closed, never demo):
--
--   1. work_orders.wo_snapshot   + one area per included line with hours
--                                  (and per ticked optional line), built
--                                  exactly as lineWorkOrderArea builds it
--   2. wo_working_scopes          the saved Revise scope sheet gets the same,
--      .working_state.woDoc        from the WORKING blocks, so a fold can
--                                  never drop the line again
--   3. wo_surfaces                one tick row per new area, on jobs whose
--                                  tick list already exists (a job with none
--                                  seeds itself from the sheet on view), then
--                                  wo_surface_groups_assign as the seed does
--   4. booking_offers             hours_allowance of the live/accepted offer
--      .hours_allowance            = the new total of the sheet (no trigger reads
--                                  that column; dates and pay are untouched —
--                                  the pay already included these hours)
--   5. wo_events                  line_hours_added per job: lines, from, to
--
-- Which lines: the ones the pay counts — kind line, hours > 0 (hourly →
-- `hours`, quantity/custom → `woHours`), hidden and 3rd-party included.
-- No new table, function or grant. Converges on a re-run: every step skips a
-- job whose sheet already holds the `line-<id>` area.
-- =============================================================================
set lock_timeout = '15s';

-- ---- helpers for this paste only (pg_temp: gone when the session ends) -----------
-- The crew hours of a line as priceLine counts them: hourly → hours, else woHours.
create or replace function pg_temp.wo_line_hours(l jsonb) returns numeric language sql immutable as $f$
  select round(case when l ->> 'mode' = 'hourly'
              then case when l ->> 'hours'   ~ '^\d+(\.\d+)?$' then (l ->> 'hours')::numeric   else 0 end
              else case when l ->> 'woHours' ~ '^\d+(\.\d+)?$' then (l ->> 'woHours')::numeric else 0 end
         end, 2)
$f$;
-- lineScopeText: tags out, one trimmed line per paragraph.
create or replace function pg_temp.wo_line_text(html text) returns text language sql immutable as $f$
  select array_to_string(array(
    select btrim(x.t) from unnest(string_to_array(
      regexp_replace(
        replace(replace(replace(replace(replace(replace(
          regexp_replace(regexp_replace(regexp_replace(coalesce(html, ''),
            '<br\s*/?>', E'\n', 'gi'),
            '</?(p|div|li)\M[^>]*>', E'\n', 'gi'),
            '<[^>]+>', ' ', 'g'),
          '&nbsp;', ' '), '&amp;', '&'), '&lt;', '<'), '&gt;', '>'), '&quot;', '"'), '&#39;', ''''),
        '[ \t]+', ' ', 'g'),
      E'\n')) with ordinality x(t, n)
     where btrim(x.t) <> '' order by x.n), E'\n')
$f$;
-- lineWorkOrderArea, in SQL.
create or replace function pg_temp.wo_line_area(l jsonb, override numeric) returns jsonb language sql immutable as $f$
  select jsonb_build_object(
    'id', 'line-' || (l ->> 'id'),
    'title', coalesce(nullif(btrim(l ->> 'name'), ''), 'Line item'),
    'side', case when l ->> 'type' = 'Exterior' then 'exterior' else 'interior' end,
    'surfaces', jsonb_build_array(jsonb_build_object(
      'key', 'line-' || (l ->> 'id') || ':work',
      'label', coalesce(nullif(btrim(l ->> 'name'), ''), 'Line item'),
      'coats', 0, 'product', '',
      'prep', pg_temp.wo_line_text(l ->> 'description'),
      'hours', coalesce(override, pg_temp.wo_line_hours(l)),
      'paintingHours', 0, 'prepHours', 0, 'conditionHours', 0,
      'status', 'not_started')),
    'photos', '[]'::jsonb,
    'finishCode', null,
    'finishOverridden', false)
$f$;

-- ---- the lines to add, per open job, from the blocks of the ESTIMATE ------------
drop table if exists pg_temp._wo_line_fix;
create temp table _wo_line_fix as
select w.id as work_order_id, b.ord, b.l ->> 'id' as line_id,
       pg_temp.wo_line_area(b.l,
         case when w.hours_overrides ->> ('line-' || (b.l ->> 'id') || ':work') ~ '^\d+(\.\d+)?$'
              then (w.hours_overrides ->> ('line-' || (b.l ->> 'id') || ':work'))::numeric end) as area
  from public.work_orders w
  join public.estimates e on e.id = w.estimate_id
  cross join lateral jsonb_array_elements(e.builder_state -> 'blocks') with ordinality b(l, ord)
 where not w.is_demo
   and w.stage <> 'closed'
   and jsonb_typeof(w.wo_snapshot -> 'areas') = 'array'
   and jsonb_typeof(e.builder_state -> 'blocks') = 'array'
   and b.l ->> 'kind' = 'line'
   and (coalesce((b.l ->> 'isOption')::boolean, false) = false
        or coalesce(w.wo_snapshot -> 'appliedOptions', '[]'::jsonb) ? (b.l ->> 'id'))
   and pg_temp.wo_line_hours(b.l) > 0
   and not exists (select 1 from jsonb_array_elements(w.wo_snapshot -> 'areas') a
                    where a ->> 'id' = 'line-' || (b.l ->> 'id'));

drop table if exists pg_temp._wo_line_fix_job;
create temp table _wo_line_fix_job as
select f.work_order_id,
       (select coalesce(sum((s ->> 'hours')::numeric), 0)
          from jsonb_array_elements(w.wo_snapshot -> 'areas') a,
               jsonb_array_elements(coalesce(a -> 'surfaces', '[]'::jsonb)) s) as from_hours,
       jsonb_agg(f.area order by f.ord) as areas,
       jsonb_agg(jsonb_build_object('name', f.area ->> 'title', 'hours', (f.area -> 'surfaces' -> 0 ->> 'hours')::numeric)
                 order by f.ord) as lines
  from _wo_line_fix f
  join public.work_orders w on w.id = f.work_order_id
 group by f.work_order_id, w.wo_snapshot;

-- ---- 1. the frozen sheet ------------------------------------------------------
update public.work_orders w
   set wo_snapshot = jsonb_set(w.wo_snapshot, '{areas}', (w.wo_snapshot -> 'areas') || j.areas)
  from _wo_line_fix_job j
 where w.id = j.work_order_id;

-- ---- 2. the saved Revise scope sheet, from its own WORKING blocks ---------------
-- (the revision may have edited or removed the line, so its blocks decide)
with extra as (
  select s.work_order_id, jsonb_agg(pg_temp.wo_line_area(b.l, null) order by b.ord) as areas
    from public.wo_working_scopes s
    join public.work_orders w on w.id = s.work_order_id
    cross join lateral jsonb_array_elements(s.working_state -> 'blocks') with ordinality b(l, ord)
   where not w.is_demo and w.stage <> 'closed'
     and jsonb_typeof(s.working_state -> 'blocks') = 'array'
     and jsonb_typeof(s.working_state -> 'woDoc' -> 'areas') = 'array'
     and b.l ->> 'kind' = 'line'
     and (coalesce((b.l ->> 'isOption')::boolean, false) = false
          or coalesce(w.wo_snapshot -> 'appliedOptions', '[]'::jsonb) ? (b.l ->> 'id'))
     and pg_temp.wo_line_hours(b.l) > 0
     and not exists (select 1 from jsonb_array_elements(s.working_state -> 'woDoc' -> 'areas') a
                      where a ->> 'id' = 'line-' || (b.l ->> 'id'))
   group by s.work_order_id
)
update public.wo_working_scopes s
   set working_state = jsonb_set(s.working_state, '{woDoc,areas}', (s.working_state -> 'woDoc' -> 'areas') || extra.areas)
  from extra
 where s.work_order_id = extra.work_order_id;

-- ---- 3. tick rows, where the tick list already exists ----------------------------
insert into public.wo_surfaces (work_order_id, heading, heading_meta, label, surface_key, sort)
select f.work_order_id, f.area ->> 'title', '1 surface', f.area ->> 'title', 'line-' || f.line_id || ':work',
       mx.sort + row_number() over (partition by f.work_order_id order by f.ord)
  from _wo_line_fix f
  cross join lateral (select coalesce(max(s.sort), 0) as sort from public.wo_surfaces s
                       where s.work_order_id = f.work_order_id) mx
 where exists (select 1 from public.wo_surfaces s
                where s.work_order_id = f.work_order_id and s.surface_key is not null)
on conflict (work_order_id, surface_key) where surface_key is not null do nothing;

select public.wo_surface_groups_assign(j.work_order_id) from _wo_line_fix_job j;

-- ---- 4. the hours on the offer follow the sheet ---------------------------------
update public.booking_offers o
   set hours_allowance = (select sum((s ->> 'hours')::numeric)
                            from public.work_orders w,
                                 jsonb_array_elements(w.wo_snapshot -> 'areas') a,
                                 jsonb_array_elements(coalesce(a -> 'surfaces', '[]'::jsonb)) s
                           where w.id = o.work_order_id)
  from _wo_line_fix_job j
 where o.work_order_id = j.work_order_id
   and o.state in ('offered', 'proposed', 'accepted');

-- ---- 5. say so on the job ----------------------------------------------------------
insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
select j.work_order_id, 'line_hours_added', null, 'system',
       jsonb_build_object('migration', '20270309', 'lines', j.lines, 'from_hours', j.from_hours,
                          'to_hours', j.from_hours + (select sum((x ->> 'hours')::numeric) from jsonb_array_elements(j.lines) x))
  from _wo_line_fix_job j
 where not exists (select 1 from public.wo_events e
                    where e.work_order_id = j.work_order_id and e.type = 'line_hours_added');

-- ---- read-back -------------------------------------------------------------------
-- _expect_ (production, written 11 Nov 2026 — more if a job with lines was
-- accepted since): jobs_repaired 12, milton_hours 37.10, milton_deck_area 1,
-- open_jobs_missing_line_hours 0. A re-run reads jobs_repaired 0 and the rest
-- the same.
select
  (select count(*) from _wo_line_fix_job) as jobs_repaired,
  (select sum((s ->> 'hours')::numeric)
     from public.work_orders w, jsonb_array_elements(w.wo_snapshot -> 'areas') a,
          jsonb_array_elements(coalesce(a -> 'surfaces', '[]'::jsonb)) s
    where w.job_no = 170 and not w.is_demo) as milton_hours,
  (select count(*) from public.work_orders w, jsonb_array_elements(w.wo_snapshot -> 'areas') a
    where w.job_no = 170 and not w.is_demo and a ->> 'title' ilike 'deck around pool%') as milton_deck_area,
  (select count(*) from public.work_orders w
     join public.estimates e on e.id = w.estimate_id
     cross join lateral jsonb_array_elements(coalesce(e.builder_state -> 'blocks', '[]'::jsonb)) b(l)
    where not w.is_demo and w.stage <> 'closed' and b.l ->> 'kind' = 'line'
      and coalesce((b.l ->> 'isOption')::boolean, false) = false
      and pg_temp.wo_line_hours(b.l) > 0
      and not exists (select 1 from jsonb_array_elements(w.wo_snapshot -> 'areas') a
                       where a ->> 'id' = 'line-' || (b.l ->> 'id'))) as open_jobs_missing_line_hours;

insert into public._prod_migrations(name) values ('20270309000000_wo_line_item_hours.sql') on conflict (name) do nothing;
