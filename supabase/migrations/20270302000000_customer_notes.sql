-- Work order UX, Step 3 (docs/briefs/claude-code-brief-work-order-ux.md §4.3 Triggers B and C):
-- the 40% check-in and the defect-day note, both rows on the Customer updates queue.
--
-- Each is written ONCE per job: a partial unique index on (job, kind) for the two
-- note kinds, and wo_draft_note, which inserts or answers already. Both ride
-- wo_customer_updates_allowed (not on a paused, rectification or signed-off job).
-- Timing belongs to the sweep (lib/automations/sweeps/customerUpdates.ts) and the one
-- planner lib/workorder/jobRhythm.ts; nothing here decides a day.
set lock_timeout = '15s';

create unique index if not exists wo_updates_note_uidx
  on public.wo_updates (work_order_id, kind) where kind in ('checkin_40', 'defect_day');

create or replace function public.wo_draft_note(p_work_order_id uuid, p_kind text, p_text text)
returns text language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_ok text;
begin
  if not (public.is_staff() or public.wo_is_system()) then return 'error:not_staff'; end if;
  if p_kind not in ('checkin_40', 'defect_day') then return 'error:bad_kind'; end if;
  if coalesce(trim(p_text), '') = '' then return 'error:empty'; end if;

  select id into v_id from public.wo_updates where work_order_id = p_work_order_id and kind = p_kind;
  if v_id is not null then return 'ok:' || v_id::text || ':already'; end if;

  v_ok := public.wo_customer_updates_allowed(p_work_order_id);
  if v_ok <> 'ok' then return 'error:' || v_ok; end if;

  insert into public.wo_updates (work_order_id, for_date, kind, draft_text, status)
    values (p_work_order_id, (now() at time zone 'Australia/Melbourne')::date, p_kind, p_text, 'drafted')
  on conflict (work_order_id, kind) where kind in ('checkin_40', 'defect_day') do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.wo_updates where work_order_id = p_work_order_id and kind = p_kind;
    return 'ok:' || v_id::text || ':already';
  end if;
  return 'ok:' || v_id::text;
end $$;
grant execute on function public.wo_draft_note(uuid, text, text) to authenticated, service_role;

-- ---- read-back: compare to the _expect_ values ----------------------------------------------
select
  (select count(*) from pg_indexes where tablename = 'wo_updates' and indexname = 'wo_updates_note_uidx') as note_unique, 1 as _expect_note_unique,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'wo_draft_note') as fn, 1 as _expect_fn,
  (select count(*) from information_schema.role_routine_grants where routine_schema = 'public'
     and routine_name = 'wo_draft_note' and grantee in ('authenticated', 'service_role')) as grants, 2 as _expect_grants;

insert into public._prod_migrations(name) values ('20270302000000_customer_notes.sql') on conflict (name) do nothing;
