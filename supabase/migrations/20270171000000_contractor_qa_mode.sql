-- =============================================================================
-- A third quality-check setting: none (Tom, 18 Sep 2026).
-- "You have the options of QA first jobs or QA every job — please also create
--  an option for no QA."
--
-- `contractors.requires_qa` is a boolean, so it could only say two things:
-- false = checked on their first jobs then left alone, true = checked every
-- job. There was no way to say "never". `qa_mode` replaces it with three
-- values and `requires_qa` is kept in step so anything still reading the old
-- column behaves exactly as before.
--
-- What "none" does NOT override: a quality check ticked on ONE job when it was
-- booked (`work_orders.qa_required`). That is the office saying "check this
-- one", which is a deliberate act on a particular job and still wins.
-- =============================================================================

alter table public.contractors
  add column if not exists qa_mode text not null default 'first_jobs';
alter table public.contractors drop constraint if exists contractors_qa_mode_check;
alter table public.contractors
  add constraint contractors_qa_mode_check check (qa_mode in ('first_jobs', 'every_job', 'none'));

-- Carry the existing setting over. Anyone flagged "every job" keeps it;
-- everyone else was on "first jobs", which stays the default.
update public.contractors set qa_mode = 'every_job' where requires_qa and qa_mode <> 'every_job';

-- ---- the office sets it ------------------------------------------------------------
create or replace function public.set_contractor_qa_mode(p_contractor_id uuid, p_mode text)
returns text language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_mode not in ('first_jobs', 'every_job', 'none') then return 'error:bad_mode'; end if;
  update public.contractors
     set qa_mode = p_mode,
         -- Kept in step, so the old boolean never disagrees with the setting.
         requires_qa = (p_mode = 'every_job')
   where id = p_contractor_id;
  get diagnostics v_n = row_count;
  if v_n <> 1 then return 'error:not_found'; end if;
  return 'ok:' || p_mode;
end $$;
grant execute on function public.set_contractor_qa_mode(uuid, text) to authenticated;

-- The old two-state call still works (a client that has not been redeployed
-- yet), and now writes the matching mode rather than only the boolean.
create or replace function public.set_contractor_requires_qa(p_contractor_id uuid, p_requires boolean)
returns text language plpgsql security definer set search_path = public as $$
begin
  return public.set_contractor_qa_mode(p_contractor_id, case when p_requires then 'every_job' else 'first_jobs' end);
end $$;
grant execute on function public.set_contractor_requires_qa(uuid, boolean) to authenticated;

-- ---- scheduling honours it ----------------------------------------------------------
-- The live 20261105 body verbatim, with the contractor's mode replacing the
-- boolean. A job ticked for a check when it was booked still gets one.
create or replace function public.wo_schedule_qa(p_work_order_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_wo public.work_orders%rowtype; v_kind text; v_made integer := 0; v_mode text;
begin
  select * into v_wo from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;

  if not (public.is_staff() or public.wo_is_system()
          or (public.current_contractor_id() is not null
              and public.current_contractor_id() = v_wo.contractor_id)) then
    return 'error:not_staff';
  end if;

  if v_wo.contractor_id is null then return 'ok:0'; end if;

  select coalesce(qa_mode, 'first_jobs') into v_mode from public.contractors where id = v_wo.contractor_id;

  -- "No quality checks for this painter" — unless this job was ticked for one.
  if v_mode = 'none' and not coalesce(v_wo.qa_required, false) then
    return 'ok:0';
  end if;

  if not (public.wo_contractor_is_new(v_wo.contractor_id) or v_mode = 'every_job'
          or coalesce(v_wo.qa_required, false)) then
    return 'ok:0';
  end if;

  for v_kind in
    select jsonb_array_elements_text(public.wo_loop_setting(array['qaCadence','checks']))
  loop
    if not exists (select 1 from public.wo_qa_checks
                    where work_order_id = p_work_order_id and kind = v_kind) then
      insert into public.wo_qa_checks (work_order_id, kind, scheduled_for)
        values (p_work_order_id, v_kind,
                case when v_kind = 'day_one' then v_wo.start_date else null end);
      v_made := v_made + 1;
    end if;
  end loop;

  return 'ok:' || v_made::text;
end $$;
grant execute on function public.wo_schedule_qa(uuid) to authenticated, service_role;

-- ---- read-back ------------------------------------------------------------------------
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'contractors' and column_name = 'qa_mode') = 1 as column_ok,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('set_contractor_qa_mode', 'set_contractor_requires_qa')) = 2 as functions_ok,
  (select p.prosrc like '%v_mode = ''none''%' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'wo_schedule_qa') as scheduling_honours_none,
  -- Nobody was moved off "every job" by this migration, and nothing is unset.
  (select count(*) from public.contractors where requires_qa <> (qa_mode = 'every_job')) = 0 as in_step,
  (select count(*) from public.contractors where qa_mode is null) = 0 as none_unset;

insert into public._prod_migrations(name) values ('20270171000000_contractor_qa_mode.sql') on conflict (name) do nothing;
