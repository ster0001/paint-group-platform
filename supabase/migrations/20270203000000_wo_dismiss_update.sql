-- =============================================================================
-- Delete a drafted customer update (Tom, 29 Sep 2026: "in the Updates tab,
-- create a button to delete updates — some already have projects completed,
-- and it's too late to send them to the customer").
--
-- A drafted or approved update is removed outright — it never reached anyone,
-- and a `dismissed` status would block the day's next draft (unique per job
-- and date). A SENT update is a record and is refused. The removal itself is
-- recorded on the job's event log with who and why, so "where did that draft
-- go?" has an answer. A second function clears every draft on jobs already
-- closed in one press — the case Tom describes.
--
-- Converges on a re-run. Paste with: set lock_timeout = '15s';
-- =============================================================================
set lock_timeout = '15s';

create or replace function public.wo_dismiss_update(p_update_id uuid, p_reason text default '')
returns text language plpgsql security definer set search_path = public as $$
declare v_u public.wo_updates%rowtype; v_stage public.wo_stage;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;

  select * into v_u from public.wo_updates where id = p_update_id for update;
  if not found then return 'error:not_found'; end if;
  if v_u.status = 'sent' then return 'error:already_sent'; end if;

  select stage into v_stage from public.work_orders where id = v_u.work_order_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_u.work_order_id, 'update_dismissed', auth.uid(), 'staff',
            jsonb_build_object('update_id', p_update_id, 'for_date', v_u.for_date,
                               'status', v_u.status::text, 'job_stage', v_stage::text,
                               'reason', coalesce(nullif(trim(p_reason), ''), 'not sent'),
                               'text', left(coalesce(v_u.final_text, v_u.draft_text), 600)));

  delete from public.wo_updates where id = p_update_id;
  return 'ok:dismissed';
end $$;
grant execute on function public.wo_dismiss_update(uuid, text) to authenticated;

-- Every unsent draft on a CLOSED job, in one press.
create or replace function public.wo_dismiss_updates_for_closed_jobs()
returns text language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_n integer := 0;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  for v_id in
    select u.id from public.wo_updates u
      join public.work_orders w on w.id = u.work_order_id
     where u.status in ('drafted', 'approved') and w.stage = 'closed'
  loop
    if public.wo_dismiss_update(v_id, 'job already completed') = 'ok:dismissed' then v_n := v_n + 1; end if;
  end loop;
  return 'ok:' || v_n::text;
end $$;
grant execute on function public.wo_dismiss_updates_for_closed_jobs() to authenticated;

-- ---- read-back: ONE row, every column equals its _expect_ -----------------------------
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('wo_dismiss_update', 'wo_dismiss_updates_for_closed_jobs')) as fns, 2 as _expect_fns,
  (select has_function_privilege('authenticated', 'public.wo_dismiss_update(uuid, text)', 'execute')) as granted, true as _expect_granted,
  (select prosrc like '%already_sent%' from pg_proc where proname = 'wo_dismiss_update' limit 1) as refuses_sent, true as _expect_refuses_sent;

insert into public._prod_migrations(name) values ('20270203000000_wo_dismiss_update.sql') on conflict (name) do nothing;
