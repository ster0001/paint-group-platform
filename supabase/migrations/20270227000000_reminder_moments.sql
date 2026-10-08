-- =============================================================================
-- 20270227 · Reminder moments, follow-up texts and "No work today" (brief:
-- standards / status / call backs, Step 4; §4.2, R7, R8, R10, ⚑3, ⚑4, ⚑5)
--
-- The painter's "update your work order" texts already run on one planner
-- (lib/workorder/jobRhythm.ts) but nothing recorded a MOMENT — only a claim
-- per rung and a row per text. This gives each moment a row: when it is due,
-- how many texts went, when it was answered (an app update on its day), and
-- whether it was skipped (a rained-off day, or a rebooking that moved it).
-- The sweep (lib/automations/sweeps/jobReminders.ts) plans and sends; the
-- answer is recorded by a trigger the moment a tick or a photo lands; the PC
-- skips a day with wo_set_no_work_day. Nothing here changes the schedule.
--
-- Converges on a re-run. Paste starts with a lock timeout.
-- =============================================================================
set lock_timeout = '15s';

-- ---- 1. the moment ---------------------------------------------------------------
create table if not exists public.wo_reminder_moments (
  id             uuid primary key default gen_random_uuid(),
  work_order_id  uuid not null references public.work_orders (id) on delete cascade,
  -- The planner's rung id: day1 | day1_pm | day2 | mid | mid30 | mid60 | last.
  kind           text not null check (kind in ('day1','day1_pm','day2','mid','mid30','mid60','last')),
  -- The Melbourne calendar day the moment is on, and its instant.
  day            date not null,
  due_at         timestamptz not null,
  sends_count    integer not null default 0 check (sends_count >= 0),
  last_sent_at   timestamptz,
  answered_at    timestamptz,
  answered_event uuid references public.wo_events (id) on delete set null,
  -- Skipped moments leave every count: no_work (R10), rescheduled (the plan
  -- moved on), not_sent (the day passed and no text ever went — never scored
  -- as a miss the painter could not have known about).
  skipped_reason text check (skipped_reason in ('no_work', 'rescheduled', 'not_sent')),
  skipped_at     timestamptz,
  created_at     timestamptz not null default now(),
  unique (work_order_id, kind)
);
create index if not exists wo_reminder_moments_due_idx on public.wo_reminder_moments (day, due_at) where answered_at is null and skipped_reason is null;
create index if not exists wo_reminder_moments_wo_idx on public.wo_reminder_moments (work_order_id, day);

-- R10: a day the PC marked "no work" — rain, a locked site.
create table if not exists public.wo_day_flags (
  id            uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders (id) on delete cascade,
  day           date not null,
  flag          text not null default 'no_work' check (flag in ('no_work')),
  reason        text not null default '',
  set_by        uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (work_order_id, day, flag)
);

-- ---- 2. RLS: staff read; the painters on the job read; writes service/RPC only ---
alter table public.wo_reminder_moments enable row level security;
alter table public.wo_day_flags enable row level security;
drop policy if exists wo_reminder_moments_staff on public.wo_reminder_moments;
create policy wo_reminder_moments_staff on public.wo_reminder_moments for select to authenticated using (public.is_staff());
drop policy if exists wo_reminder_moments_painter on public.wo_reminder_moments;
create policy wo_reminder_moments_painter on public.wo_reminder_moments for select to authenticated
  using (public.wo_painter_on_job(work_order_id, public.current_contractor_id()));
drop policy if exists wo_day_flags_staff on public.wo_day_flags;
create policy wo_day_flags_staff on public.wo_day_flags for select to authenticated using (public.is_staff());
drop policy if exists wo_day_flags_painter on public.wo_day_flags;
create policy wo_day_flags_painter on public.wo_day_flags for select to authenticated
  using (public.wo_painter_on_job(work_order_id, public.current_contractor_id()));
revoke all on public.wo_reminder_moments, public.wo_day_flags from anon;
revoke insert, update, delete on public.wo_reminder_moments, public.wo_day_flags from authenticated;
grant select on public.wo_reminder_moments, public.wo_day_flags to authenticated;

-- ---- 3. the numbers (⚑5, R8) -----------------------------------------------------
insert into public.settings (key, value) values ('job_update_rules', jsonb_build_object(
  'morningFollowUps', jsonb_build_array('10:30', '13:30'),
  'afternoonFollowUps', jsonb_build_array('17:30', '19:00'),
  'lastSend', '19:00',
  'maxTexts', 3
)) on conflict (key) do nothing;

-- ---- 4. an app update answers the earliest open moment of its day (⚑3, ⚑4) -------
-- One update answers ONE moment: on a day with two (a one-day job), the first
-- tick or photo answers the morning, the next the afternoon. Fires on the
-- events the painter's own actions write; the row it writes is a different
-- type, so it never re-fires on itself.
create or replace function public.wo_reminder_moment_answer()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_day date; v_id uuid;
begin
  if new.type not in ('surface_tick', 'photo', 'all_surfaces_done') then return new; end if;
  if new.actor_kind not in ('contractor', 'system') then return new; end if;
  v_day := (new.created_at at time zone 'Australia/Melbourne')::date;
  select id into v_id from public.wo_reminder_moments
   where work_order_id = new.work_order_id and day = v_day and answered_at is null and skipped_reason is null
   order by due_at limit 1;
  if v_id is null then return new; end if;
  update public.wo_reminder_moments set answered_at = new.created_at, answered_event = new.id where id = v_id;
  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
  values (new.work_order_id, 'reminder_moment_answered', new.actor, 'system',
          jsonb_build_object('moment_id', v_id, 'day', v_day, 'by_event', new.id, 'by_type', new.type));
  return new;
end $$;
drop trigger if exists t_wo_reminder_moment_answer on public.wo_events;
create trigger t_wo_reminder_moment_answer after insert on public.wo_events
  for each row execute function public.wo_reminder_moment_answer();

-- ---- 5. "No work today" (R10) -----------------------------------------------------
-- Today or a past day, with a reason. That day's moments are skipped and leave
-- the count even if texts already went; an update on that day earns no credit
-- (Step 5 reads skipped_reason).
create or replace function public.wo_set_no_work_day(p_work_order_id uuid, p_day date, p_reason text default '')
returns text language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_day is null then return 'error:no_day'; end if;
  if p_day > (now() at time zone 'Australia/Melbourne')::date then return 'error:future_day'; end if;
  if not exists (select 1 from public.work_orders where id = p_work_order_id) then return 'error:work_order_not_found'; end if;
  insert into public.wo_day_flags (work_order_id, day, flag, reason, set_by)
  values (p_work_order_id, p_day, 'no_work', coalesce(left(p_reason, 300), ''), auth.uid())
  on conflict (work_order_id, day, flag) do update set reason = excluded.reason, set_by = excluded.set_by;
  update public.wo_reminder_moments set skipped_reason = 'no_work', skipped_at = now()
   where work_order_id = p_work_order_id and day = p_day and skipped_reason is distinct from 'no_work';
  get diagnostics v_n = row_count;
  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
  values (p_work_order_id, 'no_work_day_set', auth.uid(), 'staff',
          jsonb_build_object('day', p_day, 'reason', coalesce(p_reason, ''), 'moments_skipped', v_n));
  return 'ok:' || v_n;
end $$;
revoke all on function public.wo_set_no_work_day(uuid, date, text) from public, anon;
grant execute on function public.wo_set_no_work_day(uuid, date, text) to authenticated;

create or replace function public.wo_clear_no_work_day(p_work_order_id uuid, p_day date)
returns text language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  delete from public.wo_day_flags where work_order_id = p_work_order_id and day = p_day and flag = 'no_work';
  get diagnostics v_n = row_count;
  if v_n = 0 then return 'error:not_found'; end if;
  update public.wo_reminder_moments set skipped_reason = null, skipped_at = null
   where work_order_id = p_work_order_id and day = p_day and skipped_reason = 'no_work';
  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
  values (p_work_order_id, 'no_work_day_cleared', auth.uid(), 'staff', jsonb_build_object('day', p_day));
  return 'ok:cleared';
end $$;
revoke all on function public.wo_clear_no_work_day(uuid, date) from public, anon;
grant execute on function public.wo_clear_no_work_day(uuid, date) to authenticated;

-- ---- read-back: compare to the _expect_ columns before calling this live ------
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('wo_reminder_moments', 'wo_day_flags')) as tables, 2 as _expect_tables,
  (select count(*) from pg_policies where schemaname = 'public' and tablename in ('wo_reminder_moments', 'wo_day_flags')) as policies, 4 as _expect_policies,
  has_table_privilege('authenticated', 'public.wo_reminder_moments', 'insert') as auth_can_insert, false as _expect_no_insert,
  (select count(*) from pg_trigger where tgname = 't_wo_reminder_moment_answer') as answer_trigger, 1 as _expect_trigger,
  has_function_privilege('authenticated', 'public.wo_set_no_work_day(uuid, date, text)', 'execute') as staff_can_skip, true as _expect_skip_grant,
  (select value->>'maxTexts' from public.settings where key = 'job_update_rules') as max_texts, '3' as _expect_max;

insert into public._prod_migrations(name) values ('20270227000000_reminder_moments.sql') on conflict (name) do nothing;
