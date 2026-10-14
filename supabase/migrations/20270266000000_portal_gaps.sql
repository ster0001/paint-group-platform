-- 20270266 · The portal gaps the induction depends on — Step 3b of the induction brief
-- (docs/briefs/claude-code-brief-induction-demo-property.md §6, §8 Step 3b).
--
-- Three things a painter could not do from the job before today:
--
--   A. Request more materials (Module 4): item + quantity from the job ->
--      ONE PC Command card -> the office replies, and the reply shows on the
--      job. New table wo_material_requests; RPCs wo_request_material (painter
--      on the job) and wo_material_request_reply (staff).
--   B. Rained off / no work today (Module 10, R10): the painter asks from the
--      job -> ONE PC card -> the office confirms (the existing
--      wo_set_no_work_day does the skipping) or declines. The request is a
--      wo_day_flags row with flag no_work_requested; nothing else is stored.
--      RPCs wo_request_no_work_day (painter) and wo_decide_no_work_day (staff).
--   C. I will add this later (Module 1, ruling I5): the painter defers the
--      certificates; contractors.certificates_deferred_at starts a reminder
--      cadence (settings.certificate_rules, texts on days 2, 4, 6 like the
--      standards), and the office sees a card for every active contractor
--      with no insurance on file. RPC contractor_defer_certificates (own row).
--
-- Every write is a definer RPC with its gate; every action makes exactly one
-- wo_events / contractor_events row. Demo rows carry is_demo by trigger.
-- Converges on a re-run.

set lock_timeout = '15s';

-- ---- A. material requests ------------------------------------------------------------------
create table if not exists public.wo_material_requests (
  id             uuid primary key default gen_random_uuid(),
  work_order_id  uuid not null references public.work_orders (id) on delete cascade,
  contractor_id  uuid references public.contractors (id) on delete set null,
  requested_by   uuid references auth.users (id) on delete set null,
  item           text not null,
  quantity       text not null default '',
  note           text not null default '',
  status         text not null default 'requested' check (status in ('requested', 'ordered', 'declined')),
  reply          text not null default '',
  replied_by     uuid references auth.users (id) on delete set null,
  replied_at     timestamptz,
  is_demo        boolean not null default false,
  created_at     timestamptz not null default now()
);
create index if not exists wo_material_requests_wo_idx on public.wo_material_requests (work_order_id, created_at desc);
create index if not exists wo_material_requests_open_idx on public.wo_material_requests (created_at) where status = 'requested';
drop trigger if exists t_demo_flag on public.wo_material_requests;
create trigger t_demo_flag before insert on public.wo_material_requests for each row execute function public.demo_flag_copy('work_order_id');

alter table public.wo_material_requests enable row level security;
drop policy if exists wo_material_requests_staff on public.wo_material_requests;
create policy wo_material_requests_staff on public.wo_material_requests
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists wo_material_requests_painter on public.wo_material_requests;
create policy wo_material_requests_painter on public.wo_material_requests
  for select to authenticated using (public.wo_painter_on_job(work_order_id, (select public.current_contractor_id())));
revoke insert, update, delete on public.wo_material_requests from authenticated, anon;

create or replace function public.wo_request_material(p_work_order_id uuid, p_item text, p_quantity text default '', p_note text default '')
returns text language plpgsql security definer set search_path = public as $$
declare v_wo public.work_orders%rowtype; v_cid uuid; v_id uuid;
begin
  select * into v_wo from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;
  v_cid := public.current_contractor_id();
  if v_cid is null or not public.wo_painter_on_job(v_wo.id, v_cid) then return 'error:not_yours'; end if;
  if coalesce(trim(p_item), '') = '' then return 'error:no_item'; end if;
  if v_wo.stage in ('offered', 'closed') then return 'error:not_live'; end if;
  insert into public.wo_material_requests (work_order_id, contractor_id, requested_by, item, quantity, note)
    values (p_work_order_id, v_cid, auth.uid(), left(trim(p_item), 200), left(trim(coalesce(p_quantity, '')), 60), left(trim(coalesce(p_note, '')), 300))
    returning id into v_id;
  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (p_work_order_id, 'material_requested', auth.uid(), 'contractor',
            jsonb_build_object('request_id', v_id, 'item', left(trim(p_item), 200), 'quantity', left(trim(coalesce(p_quantity, '')), 60)));
  return 'ok:' || v_id;
end $$;
revoke all on function public.wo_request_material(uuid, text, text, text) from public, anon;
grant execute on function public.wo_request_material(uuid, text, text, text) to authenticated;

create or replace function public.wo_material_request_reply(p_id uuid, p_status text, p_reply text default '')
returns text language plpgsql security definer set search_path = public as $$
declare v_r public.wo_material_requests%rowtype;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_status not in ('ordered', 'declined') then return 'error:bad_status'; end if;
  select * into v_r from public.wo_material_requests where id = p_id for update;
  if not found then return 'error:not_found'; end if;
  if v_r.status <> 'requested' then return 'error:already_' || v_r.status; end if;
  update public.wo_material_requests
     set status = p_status, reply = left(trim(coalesce(p_reply, '')), 400), replied_by = auth.uid(), replied_at = now()
   where id = p_id;
  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_r.work_order_id, 'material_request_replied', auth.uid(), 'staff',
            jsonb_build_object('request_id', p_id, 'status', p_status, 'item', v_r.item));
  return 'ok:' || p_status;
end $$;
revoke all on function public.wo_material_request_reply(uuid, text, text) from public, anon;
grant execute on function public.wo_material_request_reply(uuid, text, text) to authenticated;

-- ---- B. rained off / no work today, raised by the painter ----------------------------------
alter table public.wo_day_flags drop constraint if exists wo_day_flags_flag_check;
alter table public.wo_day_flags add constraint wo_day_flags_flag_check check (flag in ('no_work', 'no_work_requested', 'no_work_declined'));
alter table public.wo_day_flags add column if not exists decided_at timestamptz;
alter table public.wo_day_flags add column if not exists decided_by uuid references auth.users (id) on delete set null;

create or replace function public.wo_request_no_work_day(p_work_order_id uuid, p_day date, p_reason text default '')
returns text language plpgsql security definer set search_path = public as $$
declare v_wo public.work_orders%rowtype; v_cid uuid; v_id uuid; v_today date;
begin
  if p_day is null then return 'error:no_day'; end if;
  select * into v_wo from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;
  v_cid := public.current_contractor_id();
  if v_cid is null or not public.wo_painter_on_job(v_wo.id, v_cid) then return 'error:not_yours'; end if;
  v_today := (now() at time zone 'Australia/Melbourne')::date;
  -- Tell Paint Group in the morning (Module 10): today, or yesterday if it slipped.
  if p_day > v_today then return 'error:future_day'; end if;
  if p_day < v_today - 1 then return 'error:too_old'; end if;
  if exists (select 1 from public.wo_day_flags where work_order_id = p_work_order_id and day = p_day and flag = 'no_work') then
    return 'ok:already';
  end if;
  insert into public.wo_day_flags (work_order_id, day, flag, reason, set_by)
    values (p_work_order_id, p_day, 'no_work_requested', left(trim(coalesce(p_reason, '')), 300), auth.uid())
    on conflict (work_order_id, day, flag) do update set reason = excluded.reason, set_by = excluded.set_by, created_at = now()
    returning id into v_id;
  -- A request after a decline is a new request: the declined row goes.
  delete from public.wo_day_flags where work_order_id = p_work_order_id and day = p_day and flag = 'no_work_declined';
  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (p_work_order_id, 'no_work_requested', auth.uid(), 'contractor',
            jsonb_build_object('flag_id', v_id, 'day', p_day, 'reason', left(trim(coalesce(p_reason, '')), 300)));
  return 'ok:' || v_id;
end $$;
revoke all on function public.wo_request_no_work_day(uuid, date, text) from public, anon;
grant execute on function public.wo_request_no_work_day(uuid, date, text) to authenticated;

-- The office decides. Confirm = the existing wo_set_no_work_day (skips that
-- moments of that day, writes no_work_day_set); the request row is replaced by the
-- flag. Decline keeps the day scored and says so.
create or replace function public.wo_decide_no_work_day(p_flag_id uuid, p_confirm boolean, p_note text default '')
returns text language plpgsql security definer set search_path = public as $$
declare v_f public.wo_day_flags%rowtype; v_out text;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into v_f from public.wo_day_flags where id = p_flag_id for update;
  if not found or v_f.flag <> 'no_work_requested' then return 'error:not_found'; end if;
  if p_confirm then
    delete from public.wo_day_flags where id = p_flag_id;
    v_out := public.wo_set_no_work_day(v_f.work_order_id, v_f.day, v_f.reason);
    if v_out not like 'ok:%' then return v_out; end if;
    update public.wo_day_flags set decided_at = now(), decided_by = auth.uid()
     where work_order_id = v_f.work_order_id and day = v_f.day and flag = 'no_work';
    return 'ok:confirmed';
  else
    update public.wo_day_flags set flag = 'no_work_declined', decided_at = now(), decided_by = auth.uid(),
           reason = case when coalesce(trim(p_note), '') = '' then reason else left(trim(p_note), 300) end
     where id = p_flag_id;
    insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
      values (v_f.work_order_id, 'no_work_request_declined', auth.uid(), 'staff',
              jsonb_build_object('flag_id', p_flag_id, 'day', v_f.day, 'note', left(trim(coalesce(p_note, '')), 300)));
    return 'ok:declined';
  end if;
end $$;
revoke all on function public.wo_decide_no_work_day(uuid, boolean, text) from public, anon;
grant execute on function public.wo_decide_no_work_day(uuid, boolean, text) to authenticated;

-- ---- C. I will add this later ---------------------------------------------------------------
alter table public.contractors add column if not exists certificates_deferred_at timestamptz;

insert into public.settings (key, value) values ('certificate_rules', jsonb_build_object(
  'reminderDays', jsonb_build_array(2, 4, 6),   -- texts after the painter deferred, like the standards (⚑17)
  'reminderHour', 9
)) on conflict (key) do nothing;

create or replace function public.contractor_defer_certificates()
returns text language plpgsql security definer set search_path = public as $$
declare v_cid uuid;
begin
  v_cid := public.current_contractor_id();
  if v_cid is null then return 'error:not_a_contractor'; end if;
  if exists (select 1 from public.contractors where id = v_cid and certificates_deferred_at is not null) then return 'ok:already'; end if;
  update public.contractors set certificates_deferred_at = now() where id = v_cid;
  insert into public.contractor_events (contractor_id, type, detail, actor)
    values (v_cid, 'certificates_deferred', jsonb_build_object('at', now()), auth.uid());
  return 'ok:deferred';
end $$;
revoke all on function public.contractor_defer_certificates() from public, anon;
grant execute on function public.contractor_defer_certificates() to authenticated;

-- ---- read-back: compare every column to its _expect_ before calling this live --------------
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'wo_material_requests') as table_made, 1 as _expect_table_made,
  (select relrowsecurity from pg_class where relname = 'wo_material_requests') as rls_on, true as _expect_rls_on,
  (select count(*) from pg_policies where tablename = 'wo_material_requests') as request_policies, 2 as _expect_request_policies,
  (select count(*) from pg_trigger where tgname = 't_demo_flag' and tgrelid = 'public.wo_material_requests'::regclass) as request_demo_trigger, 1 as _expect_request_demo_trigger,
  (select pg_get_constraintdef(oid) like '%no_work_requested%' from pg_constraint where conname = 'wo_day_flags_flag_check') as flags_take_requests, true as _expect_flags_take_requests,
  (select count(*) from information_schema.columns where table_name = 'wo_day_flags' and column_name in ('decided_at', 'decided_by')) as flag_decision_columns, 2 as _expect_flag_decision_columns,
  (select count(*) from information_schema.columns where table_name = 'contractors' and column_name = 'certificates_deferred_at') as deferred_column, 1 as _expect_deferred_column,
  (select count(*) from pg_proc where proname in ('wo_request_material', 'wo_material_request_reply', 'wo_request_no_work_day', 'wo_decide_no_work_day', 'contractor_defer_certificates')) as functions, 5 as _expect_functions,
  has_function_privilege('authenticated', 'public.wo_request_material(uuid, text, text, text)', 'execute') as auth_can_request, true as _expect_auth_can_request,
  has_function_privilege('anon', 'public.wo_request_material(uuid, text, text, text)', 'execute') as anon_can_request, false as _expect_anon_can_request,
  has_table_privilege('authenticated', 'public.wo_material_requests', 'insert') as auth_can_insert_requests, false as _expect_auth_can_insert_requests,
  (select (value->'reminderDays')::text from public.settings where key = 'certificate_rules') as reminder_days, '[2, 4, 6]' as _expect_reminder_days;

insert into public._prod_migrations(name) values ('20270266000000_portal_gaps.sql') on conflict (name) do nothing;
