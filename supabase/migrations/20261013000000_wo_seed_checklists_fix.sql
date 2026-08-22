-- =============================================================================
-- The checklist seeder must not be staff-gated
--
-- Seeding is machinery, not a privilege: fixed rows for a work order that
-- already exists, revealing nothing. The guard broke two things — the SQL
-- editor's own backfill (no JWT, so refused silently) and, worse, a contractor
-- accepting an offer, which moves the stage under THEIR session and so never
-- got the pre-start list on the job they had just taken.
-- =============================================================================

create or replace function public.wo_seed_checklists(p_work_order_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_made integer := 0; v_i record;
begin
  if not exists (select 1 from public.work_orders where id = p_work_order_id) then
    return 'error:not_found';
  end if;

  for v_i in
    select * from (values
      ('pre_offer'::public.wo_checklist_phase, 'Scope matches the accepted estimate', '', true, 1, null::text),
      ('pre_offer', 'Finish level & standards labels shown per surface', '', true, 2, null),
      ('pre_start', 'Colour schedule finalised', 'Confirmed at the colour consult', true, 1, 'colours'),
      ('pre_start', 'Materials ordered', 'Needs the colours above first', true, 2, null),
      ('pre_start', 'Equipment movements booked', 'Delivery to site and the return trigger', true, 3, null),
      ('pre_start', 'Access details recorded', 'Gate codes, parking, pets, keys', true, 4, null),
      ('pre_start', 'QA schedule created', 'Auto while a contractor is in their first jobs', false, 5, 'qa'),
      ('pre_start', 'Customer ''what to expect'' queued', 'Goes out the evening before', true, 6, null)
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

  return 'ok:' || v_made::text;
end $$;

grant execute on function public.wo_seed_checklists(uuid) to authenticated, service_role;

do $$
declare v_id uuid;
begin
  for v_id in select id from public.work_orders where stage <> 'closed' loop
    perform public.wo_seed_checklists(v_id);
  end loop;
end $$;

select w.wo_ref, i.phase, count(*) as items
  from public.wo_checklist_items i
  join public.work_orders w on w.id = i.work_order_id
 group by w.wo_ref, i.phase order by w.wo_ref, i.phase;
