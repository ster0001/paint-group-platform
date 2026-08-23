-- =============================================================================
-- Follow-up to 20261101: the offer-acceptance path still seeded the colours
-- row as DERIVED (6 rows, no SWMS, auto_key 'colours' — the 20261013 body),
-- while a direct staff call produced the current body. Two definitions were
-- answering one name — a stale overload or a trigger plan bound to an old
-- OID. Drop EVERY overload, recreate the one true seeder, and recreate the
-- trigger function so nothing holds the ghost. Diagnostic first, so we see
-- what was there.
-- =============================================================================

-- What is live right now? (expect >1 row if a stale overload exists)
select p.oid, pg_get_function_identity_arguments(p.oid) as args,
       p.prosrc like '%Tick once every colour%' as is_current
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'wo_seed_checklists';

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'wo_seed_checklists'
  loop
    execute 'drop function ' || r.sig::text;
  end loop;
end $$;

create or replace function public.wo_seed_checklists(p_work_order_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_made integer := 0; v_i record; v_swms boolean;
begin
  if not exists (select 1 from public.work_orders where id = p_work_order_id) then
    return 'error:not_found';
  end if;

  v_swms := public.wo_job_kind(p_work_order_id) in ('commercial', 'body_corporate');

  for v_i in
    select * from (values
      ('pre_offer'::public.wo_checklist_phase, 'Scope matches the accepted estimate', '', true, 1, null::text),
      ('pre_offer', 'Finish level & standards labels shown per surface', '', true, 2, null),
      ('pre_start', 'Colour schedule finalised', 'Tick once every colour is on the job sheet', true, 1, null),
      ('pre_start', 'Materials ordered', 'Needs the colours above first', true, 2, null),
      ('pre_start', 'Equipment movements booked', 'Delivery to site and the return trigger', true, 3, null),
      ('pre_start', 'Access details recorded', 'Gate codes, parking, pets, keys', true, 4, null),
      ('pre_start', 'QA schedule created', 'Auto while a contractor is in their first jobs', false, 5, 'qa'),
      ('pre_start', 'Customer ''what to expect'' queued', 'Goes out the evening before', true, 6, null),
      ('pre_start', 'SWMS / induction attached', 'Required on commercial and body corporate', v_swms, 7, null)
    ) as t(phase, label, detail, required, sort, auto_key)
  loop
    if not exists (select 1 from public.wo_checklist_items
                    where work_order_id = p_work_order_id and phase = v_i.phase and label = v_i.label) then
      insert into public.wo_checklist_items
          (work_order_id, phase, label, detail, required, sort, auto_key)
        values (p_work_order_id, v_i.phase, v_i.label, v_i.detail, v_i.required, v_i.sort, v_i.auto_key);
      v_made := v_made + 1;
    end if;
  end loop;

  update public.wo_checklist_items
     set required = v_swms
   where work_order_id = p_work_order_id
     and phase = 'pre_start' and label = 'SWMS / induction attached'
     and required is distinct from v_swms;

  return 'ok:' || v_made::text;
end $$;
grant execute on function public.wo_seed_checklists(uuid) to authenticated, service_role;

-- Recreate the trigger function too: a plpgsql plan bound to a dropped OID
-- would fail, and a fresh body guarantees it binds to the seeder above.
create or replace function public.wo_seed_checklists_on_stage()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.type = 'stage_changed' and new.to_stage in ('offered', 'pre_start') then
    perform public.wo_seed_checklists(new.work_order_id);
  end if;
  return new;
end $$;

-- Any row the ghost seeded derived since 20261101 ran: straighten it.
update public.wo_checklist_items
   set auto_key = null, detail = 'Tick once every colour is on the job sheet'
 where auto_key = 'colours';

-- Verification: exactly ONE wo_seed_checklists, is_current = true, 0 derived.
select p.oid, pg_get_function_identity_arguments(p.oid) as args,
       p.prosrc like '%Tick once every colour%' as is_current
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'wo_seed_checklists';
select count(*) as still_derived from public.wo_checklist_items where auto_key = 'colours';
