-- =============================================================================
-- Home dashboard v2 · session 0c · capture: work orders (Part B3)
--
-- What the Contractors and PC Command sections need that the loop did not
-- write down: WHEN the last surface was ticked, what the booking's end date
-- WAS and whether it grew, which attempt a quality check is, whether a review
-- was asked for and came back, and — per contractor, by opt-in (Tom's ruling
-- 19 Sep) — the days and hours actually worked.
--
-- Already there and NOT duplicated: wo_surfaces.state_changed_at (per row),
-- booking_offers.end_date (the CURRENT end, moved by the painter's finish
-- date and by reschedules), wo_events actor + actor_kind, wo_photos.taken_by,
-- contractor_expenses.contractor_id, messages.actor_profile_id — every
-- activity the "silent contractor" tile derives from already names who.
--
-- New:
--   · wo_events 'all_surfaces_done' — written ONCE by wo_tick_surface when the
--     tick that lands is the last non-removed surface on the job.
--   · booking_offers.booked_end_date — the end date the painter accepted,
--     frozen at acceptance; end_date keeps moving. A grown span on an accepted
--     booking writes wo_events 'booking_extended' (any path: finish date,
--     reschedule). "Finished on time" = all_surfaces_done ≤ end_date.
--   · wo_qa_checks.attempt_no — 1 for the first check on a job, +1 for every
--     failed check before it. Trigger + backfill.
--   · review_requests — one row per job: sent_at (the future review-request
--     automation, or a person), received_at + rating (a person, until the
--     Google Business Profile API — ⚑B2).
--   · contractors.capture_worked_hours (off by default) + wo_worked_hours —
--     the painter's own days and hours, asked at the final DONE tick only when
--     the flag is on. Everyone else resolves to the schedule in
--     lib/reporting/workedTime.ts, and the source is always shown.
--   · settings 'worked_day_hours' (default 8) — the schedule's day length,
--     readable by painters through worked_day_hours() for the pre-fill.
-- =============================================================================

-- ---- 1 · the last tick on the job ------------------------------------------
-- 20261220 body verbatim, plus the one insert at the end.
create or replace function public.wo_tick_surface(p_surface_id uuid, p_to public.wo_surface_state)
returns text language plpgsql security definer set search_path = public as $$
declare v_s public.wo_surfaces%rowtype; v_wo public.work_orders%rowtype; v_kind text; v_cid uuid;
        v_first_tick boolean; v_completes boolean; v_all_done boolean;
begin
  select * into v_s from public.wo_surfaces where id = p_surface_id for update;
  if not found then return 'error:not_found'; end if;

  -- Struck by a signed credit: display-only from here on.
  if v_s.removed_from_scope then return 'error:removed_from_scope'; end if;

  select * into v_wo from public.work_orders where id = v_s.work_order_id;

  if public.is_staff() then
    v_kind := 'staff';
  else
    v_cid := public.current_contractor_id();
    if v_cid is null or v_wo.contractor_id is distinct from v_cid then return 'error:not_yours'; end if;
    v_kind := 'contractor';
  end if;

  if v_wo.stage <> 'in_progress' then
    return 'error:not_in_progress:' || v_wo.stage::text;
  end if;

  if v_s.state = p_to then return 'ok:' || p_to::text; end if;

  select not exists (
    select 1 from public.wo_surfaces
     where work_order_id = v_s.work_order_id and heading = v_s.heading and state <> 'todo'
  ) into v_first_tick;

  if v_first_tick and p_to <> 'todo'
     and not public.wo_has_before_photo(v_s.work_order_id, v_s.heading) then
    return 'error:before_photo_required:' || v_s.heading;
  end if;

  if p_to = 'done' then
    select not exists (
      select 1 from public.wo_surfaces
       where work_order_id = v_s.work_order_id and heading = v_s.heading
         and id <> v_s.id and not coalesce(removed_from_scope, false)
         and state <> 'done'
    ) into v_completes;
    if v_completes and not public.wo_has_after_photo(v_s.work_order_id, v_s.heading) then
      return 'error:after_photo_required:' || v_s.heading;
    end if;
  end if;

  update public.wo_surfaces
     set state = p_to, state_changed_at = now()
   where id = p_surface_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_s.work_order_id, 'surface_tick', auth.uid(), v_kind,
            jsonb_build_object('surface_id', p_surface_id, 'heading', v_s.heading,
                               'label', v_s.label, 'from', v_s.state::text, 'to', p_to::text));

  -- Dashboard 0c: the tick that finishes the JOB is a fact worth one row.
  -- Written once — a later un-tick and re-tick does not move it.
  if p_to = 'done' then
    select not exists (
      select 1 from public.wo_surfaces
       where work_order_id = v_s.work_order_id
         and not coalesce(removed_from_scope, false) and state <> 'done'
    ) into v_all_done;
    if v_all_done and not exists (
      select 1 from public.wo_events
       where work_order_id = v_s.work_order_id and type = 'all_surfaces_done'
    ) then
      insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
        values (v_s.work_order_id, 'all_surfaces_done', auth.uid(), v_kind,
                jsonb_build_object('last_surface_id', p_surface_id));
    end if;
  end if;

  return 'ok:' || p_to::text;
end $$;
grant execute on function public.wo_tick_surface(uuid, public.wo_surface_state) to authenticated;

-- History: jobs whose surfaces are all done but never got the row — the
-- moment is the latest state_changed_at. Only where every surface is done.
insert into public.wo_events (work_order_id, type, actor_kind, meta, created_at)
select s.work_order_id, 'all_surfaces_done', 'system',
       jsonb_build_object('backfilled', true), max(s.state_changed_at)
  from public.wo_surfaces s
 where not coalesce(s.removed_from_scope, false)
 group by s.work_order_id
having bool_and(s.state = 'done') and max(s.state_changed_at) is not null
   and not exists (select 1 from public.wo_events e
                    where e.work_order_id = s.work_order_id and e.type = 'all_surfaces_done');

-- ---- 2 · the booking's end, as accepted, and whether it grew -----------------
alter table public.booking_offers add column if not exists booked_end_date date;

create or replace function public.booking_offers_capture_end()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_old_span integer; v_new_span integer;
begin
  -- Frozen the moment the painter accepts; never moved after.
  if new.state = 'accepted' and new.booked_end_date is null then
    new.booked_end_date := new.end_date;
  end if;
  return new;
end $$;
drop trigger if exists t_booking_offers_capture_end on public.booking_offers;
create trigger t_booking_offers_capture_end
  before insert or update of state, end_date on public.booking_offers
  for each row execute function public.booking_offers_capture_end();

create or replace function public.booking_offers_extended_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_old_span integer; v_new_span integer;
begin
  if new.state <> 'accepted' or old.state <> 'accepted' then return null; end if;
  if new.end_date is null or old.end_date is null or new.start_date is null or old.start_date is null then return null; end if;
  v_old_span := old.end_date - old.start_date;
  v_new_span := new.end_date - new.start_date;
  if v_new_span > v_old_span then
    insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
      values (new.work_order_id, 'booking_extended', auth.uid(),
              case when public.is_staff() then 'staff'
                   when public.current_contractor_id() is not null then 'contractor' else 'system' end,
              jsonb_build_object('offer_id', new.id, 'from_end', old.end_date, 'to_end', new.end_date,
                                 'days_added', v_new_span - v_old_span));
  end if;
  return null;
end $$;
drop trigger if exists t_booking_offers_extended_event on public.booking_offers;
create trigger t_booking_offers_extended_event
  after update of start_date, end_date on public.booking_offers
  for each row execute function public.booking_offers_extended_event();

update public.booking_offers set booked_end_date = end_date
 where state = 'accepted' and booked_end_date is null and end_date is not null;

-- ---- 3 · which attempt a quality check is -----------------------------------
alter table public.wo_qa_checks add column if not exists attempt_no integer not null default 1;
do $$ begin
  alter table public.wo_qa_checks add constraint wo_qa_checks_attempt_no_positive check (attempt_no >= 1);
exception when duplicate_object then null; end $$;

create or replace function public.wo_qa_checks_attempt_no()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select 1 + count(*) into new.attempt_no
    from public.wo_qa_checks c
   where c.work_order_id = new.work_order_id and c.result = 'fail'
     and c.id is distinct from new.id;
  return new;
end $$;
drop trigger if exists t_wo_qa_checks_attempt_no on public.wo_qa_checks;
create trigger t_wo_qa_checks_attempt_no
  before insert on public.wo_qa_checks
  for each row execute function public.wo_qa_checks_attempt_no();

update public.wo_qa_checks c
   set attempt_no = s.n
  from (
    select id, 1 + count(*) filter (where result = 'fail')
                 over (partition by work_order_id order by created_at, id
                       rows between unbounded preceding and 1 preceding) as n
      from public.wo_qa_checks
  ) s
 where s.id = c.id and c.attempt_no is distinct from s.n;

-- ---- 4 · reviews: asked for, and received --------------------------------------
create table if not exists public.review_requests (
  id            uuid primary key default gen_random_uuid(),
  work_order_id uuid not null unique references public.work_orders (id) on delete cascade,
  sent_at       timestamptz,
  sent_via      text,                       -- 'automation' | 'staff'
  received_at   timestamptz,
  rating        integer constraint review_requests_rating_range check (rating is null or rating between 1 and 5),
  note          text not null default '',
  marked_by     uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists review_requests_sent_idx     on public.review_requests (sent_at);
create index if not exists review_requests_received_idx on public.review_requests (received_at);
alter table public.review_requests enable row level security;
drop policy if exists review_requests_staff on public.review_requests;
create policy review_requests_staff on public.review_requests
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- A person says "we asked" (until the automation ships) …
create or replace function public.wo_review_requested(p_work_order_id uuid, p_via text default 'staff')
returns text language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() and coalesce(auth.role(), '') <> 'service_role' then return 'error:not_staff'; end if;
  if not exists (select 1 from public.work_orders where id = p_work_order_id) then return 'error:not_found'; end if;
  insert into public.review_requests (work_order_id, sent_at, sent_via, marked_by)
  values (p_work_order_id, now(), coalesce(p_via, 'staff'), auth.uid())
  on conflict (work_order_id) do update
    set sent_at = coalesce(review_requests.sent_at, excluded.sent_at),
        sent_via = coalesce(review_requests.sent_via, excluded.sent_via),
        updated_at = now();
  return 'ok:requested';
end $$;
grant execute on function public.wo_review_requested(uuid, text) to authenticated;

-- … and "it came back" (⚑B2: a manual tick until the Google API).
create or replace function public.wo_review_received(p_work_order_id uuid, p_rating integer default null, p_note text default '')
returns text language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_rating is not null and (p_rating < 1 or p_rating > 5) then return 'error:bad_rating'; end if;
  if not exists (select 1 from public.work_orders where id = p_work_order_id) then return 'error:not_found'; end if;
  insert into public.review_requests (work_order_id, received_at, rating, note, marked_by)
  values (p_work_order_id, now(), p_rating, coalesce(p_note, ''), auth.uid())
  on conflict (work_order_id) do update
    set received_at = coalesce(review_requests.received_at, excluded.received_at),
        rating = coalesce(excluded.rating, review_requests.rating),
        note = case when excluded.note <> '' then excluded.note else review_requests.note end,
        marked_by = auth.uid(), updated_at = now();
  return 'ok:received';
end $$;
grant execute on function public.wo_review_received(uuid, integer, text) to authenticated;

-- ---- 5 · worked hours, per contractor, by opt-in ------------------------------
alter table public.contractors add column if not exists capture_worked_hours boolean not null default false;

create or replace function public.set_contractor_capture_worked_hours(p_contractor_id uuid, p_on boolean)
returns text language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  update public.contractors set capture_worked_hours = coalesce(p_on, false), updated_at = now()
   where id = p_contractor_id;
  get diagnostics v_n = row_count;
  if v_n <> 1 then return 'error:not_found'; end if;
  return case when coalesce(p_on, false) then 'ok:on' else 'ok:off' end;
end $$;
grant execute on function public.set_contractor_capture_worked_hours(uuid, boolean) to authenticated;

create table if not exists public.wo_worked_hours (
  id            uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders (id) on delete cascade,
  contractor_id uuid not null references public.contractors (id) on delete cascade,
  days          numeric(5,2) not null constraint wo_worked_hours_days_positive check (days > 0 and days <= 365),
  hours         numeric(7,2) not null constraint wo_worked_hours_hours_sane check (hours >= 0 and hours <= 5000),
  source        text not null default 'entered' constraint wo_worked_hours_source_check check (source in ('entered')),
  entered_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (work_order_id, contractor_id)
);
create index if not exists wo_worked_hours_contractor_idx on public.wo_worked_hours (contractor_id);
alter table public.wo_worked_hours enable row level security;
drop policy if exists wo_worked_hours_staff on public.wo_worked_hours;
create policy wo_worked_hours_staff on public.wo_worked_hours
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists wo_worked_hours_own on public.wo_worked_hours;
create policy wo_worked_hours_own on public.wo_worked_hours
  for select to authenticated using (contractor_id = public.current_contractor_id());

-- The painter's final DONE tick asks — only when their flag is on. A job
-- with no row resolves to the schedule (lib/reporting/workedTime.ts).
create or replace function public.wo_enter_worked_hours(p_work_order_id uuid, p_days numeric, p_hours numeric)
returns text language plpgsql security definer set search_path = public as $$
declare v_wo public.work_orders%rowtype; v_cid uuid; v_on boolean;
begin
  select * into v_wo from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;
  if public.is_staff() then
    v_cid := v_wo.contractor_id;
  else
    v_cid := public.current_contractor_id();
    if v_cid is null or v_wo.contractor_id is distinct from v_cid then return 'error:not_yours'; end if;
  end if;
  if v_cid is null then return 'error:no_contractor'; end if;
  select capture_worked_hours into v_on from public.contractors where id = v_cid;
  if not coalesce(v_on, false) then return 'error:not_asked'; end if;
  if p_days is null or p_days <= 0 or p_hours is null or p_hours < 0 then return 'error:bad_entry'; end if;
  insert into public.wo_worked_hours (work_order_id, contractor_id, days, hours, source, entered_by)
  values (p_work_order_id, v_cid, p_days, p_hours, 'entered', auth.uid())
  on conflict (work_order_id, contractor_id) do update
    set days = excluded.days, hours = excluded.hours, entered_by = auth.uid(), updated_at = now();
  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (p_work_order_id, 'worked_hours_entered', auth.uid(),
            case when public.is_staff() then 'staff' else 'contractor' end,
            jsonb_build_object('days', p_days, 'hours', p_hours));
  return 'ok:entered';
end $$;
grant execute on function public.wo_enter_worked_hours(uuid, numeric, numeric) to authenticated;

-- ---- 6 · the schedule's day length ---------------------------------------------
insert into public.settings (key, value)
values ('worked_day_hours', jsonb_build_object('value', 8, 'unit', 'hours',
        'notes', 'Standard day length for a painter whose hours come from the schedule (dashboard, workedTime). Entered hours are never scaled by this.'))
on conflict (key) do nothing;

-- Settings are staff-only; the painter's pre-fill needs the number.
create or replace function public.worked_day_hours()
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(
    (select case jsonb_typeof(value) when 'number' then value::text::numeric
                 when 'object' then (value->>'value')::numeric end
       from public.settings where key = 'worked_day_hours'), 8);
$$;
grant execute on function public.worked_day_hours() to authenticated;

-- ---- read-back: what this file just made ------------------------------------
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and (table_name, column_name) in
      (('booking_offers','booked_end_date'), ('wo_qa_checks','attempt_no'),
       ('contractors','capture_worked_hours')))                                          as new_columns_expect_3,
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name in ('review_requests', 'wo_worked_hours')) as new_tables_expect_2,
  (select count(*) from pg_policies where tablename in ('review_requests', 'wo_worked_hours')) as policies_expect_3,
  (select count(*) from pg_trigger where tgname in
      ('t_booking_offers_capture_end', 't_booking_offers_extended_event', 't_wo_qa_checks_attempt_no')) as new_triggers_expect_3,
  (select prosrc like '%all_surfaces_done%' from pg_proc where proname = 'wo_tick_surface' limit 1) as tick_writes_all_done,
  (select count(*) from pg_proc where proname in
      ('wo_review_requested', 'wo_review_received', 'set_contractor_capture_worked_hours',
       'wo_enter_worked_hours', 'worked_day_hours'))                                      as new_functions_expect_5,
  (select public.worked_day_hours())                                                      as day_hours_expect_8,
  (select count(*) from public.wo_events where type = 'all_surfaces_done')                as jobs_with_all_done,
  (select count(*) from public.booking_offers where state = 'accepted' and booked_end_date is null and end_date is not null) as accepted_without_booked_end_expect_0,
  (select count(*) from public.wo_qa_checks where attempt_no > 1)                          as rechecks,
  (select count(*) from public.contractors where capture_worked_hours)                     as contractors_opted_in_expect_0;

insert into public._prod_migrations(name) values ('20270178000000_dashboard_capture_workorders.sql') on conflict (name) do nothing;
