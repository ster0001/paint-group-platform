-- =============================================================================
-- The checklist seeder refused its own backfill, and refuses the contractor
--
-- 20261012 ended with a loop calling wo_seed_checklists() for every open job.
-- It produced ZERO rows, silently: the function opens with
--
--     if not (public.is_staff() or public.wo_is_system()) then return 'error:not_staff'
--
-- and in the SQL editor there is no JWT — auth.uid() is null and auth.role() is
-- not 'service_role' — so every call was refused and `perform` threw the answer
-- away. A statement that runs and does nothing, which is the failure this
-- codebase has now met three times.
--
-- The same guard breaks the trigger path for the case that matters most: when a
-- CONTRACTOR accepts an offer, the stage moves offered -> pre_start under the
-- contractor's session, so the seeder would refuse and the pre-start checklist
-- would never appear on the job it was just earned by.
--
-- Seeding a checklist is machinery, not a privilege: it writes fixed rows for a
-- work order that already exists and reveals nothing. So it splits in two —
-- an internal function with no guard, called by the trigger and the backfill,
-- and the guarded RPC kept for anyone calling it by hand.
-- =============================================================================

create or replace function public.wo_seed_checklists_internal(p_work_order_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare v_made integer := 0; v_i record;
begin
  if not exists (select 1 from public.work_orders where id = p_work_order_id) then return 0; end if;

  for v_i in
    select * from (values
      ('pre_offer'::public.wo_checklist_phase, 'Scope matches the accepted estimate', '', true, 1, null::text),
      ('pre_offer', 'Finish level & standards labels shown per surface', '', true, 2, null),
      ('pre_start', 'Colour schedule finalised',
        'Confirmed at the colour consult — the chips on the job sheet', true, 1, 'colours'),
      ('pre_start', 'Materials ordered',
        'Needs the colours above first', true, 2, null),
      ('pre_start', 'Equipment movements booked',
        'Delivery to site and the return trigger', true, 3, null),
      ('pre_start', 'Access details recorded',
        'Gate codes, parking, pets, keys', true, 4, null),
      ('pre_start', 'QA schedule created',
        'Auto-scheduled while a contractor is inside their first jobs', false, 5, 'qa'),
      ('pre_start', 'Customer ''what to expect'' queued',
        'Goes out the evening before the start', true, 6, null)
    ) as t(phase, label, detail, required, sort, auto_key)
  loop
    if not exists (select 1 from public.wo_checklist_items
                    where work_order_id = p_work_order_id
                      and phase = v_i.phase and label = v_i.label) then
      insert into public.wo_checklist_items
          (work_order_id, phase, label, detail, required, sort, auto_key)
        values (p_work_order_id, v_i.phase, v_i.label, v_i.detail, v_i.required, v_i.sort, v_i.auto_key);
      v_made := v_made + 1;
    end if;
  end loop;

  return v_made;
end $$;
-- Deliberately NOT granted to any client role: the trigger and the guarded RPC
-- are the only callers.
revoke all on function public.wo_seed_checklists_internal(uuid) from public;

create or replace function public.wo_seed_checklists(p_work_order_id uuid)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_staff() or public.wo_is_system()) then return 'error:not_staff'; end if;
  return 'ok:' || public.wo_seed_checklists_internal(p_work_order_id)::text;
end $$;
grant execute on function public.wo_seed_checklists(uuid) to authenticated, service_role;

create or replace function public.wo_seed_checklists_on_stage()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.type = 'stage_changed' and new.to_stage in ('offered', 'pre_start') then
    -- Unguarded on purpose: a contractor accepting their own offer is exactly
    -- when this list has to appear.
    perform public.wo_seed_checklists_internal(new.work_order_id);
  end if;
  return new;
end $$;

drop trigger if exists wo_events_seed_checklists on public.wo_events;
create trigger wo_events_seed_checklists
  after insert on public.wo_events
  for each row execute function public.wo_seed_checklists_on_stage();

-- ---- the backfill, this time actually doing something -----------------------
do $$
declare v_id uuid; v_total integer := 0;
begin
  for v_id in select id from public.work_orders where stage <> 'closed' loop
    v_total := v_total + public.wo_seed_checklists_internal(v_id);
  end loop;
  raise notice 'seeded % checklist items', v_total;
end $$;

-- ---- Verification: read this, do not assume it -----------------------------
select w.wo_ref, i.phase, count(*) as items
  from public.wo_checklist_items i
  join public.work_orders w on w.id = i.work_order_id
 group by w.wo_ref, i.phase
 order by w.wo_ref, i.phase;
