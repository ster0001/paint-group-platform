-- Manual customer updates from PC Command (Tom, 25 Oct 2026): the job-page
-- composer rode on the end-of-day row, which 20270301 keeps at one per job per
-- day, so once the day summary had gone the office could not send the finished
-- photos. A manual update is now its own kind: as many a day as the office likes.
-- The row is born APPROVED with the words the person typed, so there is never a
-- drafted manual row for the auto-send sweep to pick up; the send is the existing
-- wo_send_update, which records the photos and the sender.
set lock_timeout = '15s';

-- ---- 1. the kind ------------------------------------------------------------------------------
alter table public.wo_updates drop constraint if exists wo_updates_kind_check;
alter table public.wo_updates add constraint wo_updates_kind_check
  check (kind in ('end_of_day', 'surface_milestone', 'checkin_40', 'defect_day', 'manual'));

-- ---- 2. the RPC: a person, their words, approved on the spot ------------------------------------
create or replace function public.wo_draft_manual_update(p_work_order_id uuid, p_text text)
returns text language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if coalesce(trim(p_text), '') = '' then return 'error:empty'; end if;
  if not exists (select 1 from public.work_orders where id = p_work_order_id) then return 'error:not_found'; end if;

  insert into public.wo_updates
      (work_order_id, for_date, kind, draft_text, final_text, status, approved_by, approved_at)
    values (p_work_order_id, (now() at time zone 'Australia/Melbourne')::date, 'manual',
            trim(p_text), trim(p_text), 'approved', auth.uid(), now())
    returning id into v_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (p_work_order_id, 'update_approved', auth.uid(), 'staff',
            jsonb_build_object('update_id', v_id, 'kind', 'manual', 'edited', true));

  return 'ok:' || v_id::text;
end $$;
grant execute on function public.wo_draft_manual_update(uuid, text) to authenticated;

-- ---- 3. read-back: compare to the _expect_ values ---------------------------------------------------
select
  (select pg_get_constraintdef(oid) like '%manual%' from pg_constraint where conname = 'wo_updates_kind_check') as kind_has_manual,
  true as _expect_kind_has_manual,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'wo_draft_manual_update') as fn,
  1 as _expect_fn,
  (select has_function_privilege('authenticated', 'public.wo_draft_manual_update(uuid, text)', 'execute')) as authenticated_can_draft,
  true as _expect_authenticated_can_draft;

insert into public._prod_migrations(name) values ('20270304000000_wo_manual_updates.sql') on conflict (name) do nothing;
