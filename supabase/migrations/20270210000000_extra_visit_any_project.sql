-- =============================================================================
-- Tom, 4 Oct 2026, on the board's Extra visit tab: "allow to be able to add
-- multiple contacts for extra appointments — currently it only allows one …
-- a search bar where you can search from all projects regardless of their
-- status".
--
-- 20270209 let an extra visit go only on a job the painter was already booked
-- on. That is too narrow: a painter is sent back to a FINISHED job for a
-- touch-up, or a contractor's lane gets a visit on a job another painter
-- holds. So schedule_add_appointment now accepts ANY work order — any stage,
-- including closed — for any painter. Staff only, as before; still logged on
-- wo_events.
--
-- Converges on a re-run.
-- =============================================================================
set lock_timeout = '15s';

create or replace function public.schedule_add_appointment(
  p_work_order_id uuid,
  p_contractor_id uuid,
  p_start date,
  p_end date,
  p_note text default ''
) returns text language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_start is null or p_end is null then return 'error:no_start_date'; end if;
  if p_end < p_start then return 'error:bad_dates'; end if;
  if not exists (select 1 from public.work_orders where id = p_work_order_id) then return 'error:work_order_not_found'; end if;
  if not exists (select 1 from public.contractors where id = p_contractor_id) then return 'error:contractor_not_found'; end if;

  insert into public.wo_appointments (work_order_id, contractor_id, start_date, end_date, note, created_by)
  values (p_work_order_id, p_contractor_id, p_start, p_end, coalesce(left(p_note, 300), ''), auth.uid())
  returning id into v_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
  values (p_work_order_id, 'appointment_added', auth.uid(), 'staff',
          jsonb_build_object('appointment_id', v_id, 'contractor_id', p_contractor_id,
                             'start_date', p_start, 'end_date', p_end, 'note', coalesce(p_note, '')));
  return 'ok:added';
end $$;
revoke all on function public.schedule_add_appointment(uuid, uuid, date, date, text) from public, anon;
grant execute on function public.schedule_add_appointment(uuid, uuid, date, date, text) to authenticated;

-- read-back
select
  (select count(*) from information_schema.routine_privileges
     where specific_schema = 'public' and grantee = 'authenticated'
       and routine_name = 'schedule_add_appointment') as rpc_grants,
  1 as _expect_rpc_grants,
  (select prosrc not like '%not_booked_on_job%' from pg_proc where proname = 'schedule_add_appointment') as guard_removed,
  true as _expect_guard_removed;

insert into public._prod_migrations(name) values ('20270210000000_extra_visit_any_project.sql') on conflict (name) do nothing;
