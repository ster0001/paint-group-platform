-- =============================================================================
-- job_kind — what sort of job this is, and therefore whether SWMS is required
--
-- Tom's ruling (22 Aug): residential | commercial | body_corporate, default
-- residential. Staff set it in the builder header; the wizard's "My business"
-- path writes commercial. SWMS / induction becomes a REQUIRED pre-start item
-- for commercial and body corporate, and stays optional for residential.
--
-- Note: nothing writes source='trade_wizard' yet — that wizard path is not
-- built. The default below is wired to it so it works the day it lands, rather
-- than needing to be remembered then.
-- =============================================================================

do $$ begin
  create type public.job_kind as enum ('residential', 'commercial', 'body_corporate');
exception when duplicate_object then null; end $$;

alter table public.estimates
  add column if not exists job_kind public.job_kind not null default 'residential';

-- R2 granted estimates UPDATE column-by-column, so a column added later needs
-- its own grant or the builder silently cannot save it.
grant update (job_kind) on public.estimates to authenticated;

-- Existing trade-sourced estimates are commercial by definition.
update public.estimates set job_kind = 'commercial'
 where source = 'trade_wizard' and job_kind = 'residential';

-- ---- SWMS follows the job kind ---------------------------------------------
create or replace function public.wo_job_kind(p_work_order_id uuid)
returns public.job_kind language sql stable set search_path = public as $$
  select coalesce(e.job_kind, 'residential')
    from public.work_orders w
    left join public.estimates e on e.id = w.estimate_id
   where w.id = p_work_order_id;
$$;
grant execute on function public.wo_job_kind(uuid) to authenticated;

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
      ('pre_start', 'Colour schedule finalised', 'Confirmed at the colour consult', true, 1, 'colours'),
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

  -- A job whose kind changed after seeding: keep the flag honest.
  update public.wo_checklist_items
     set required = v_swms
   where work_order_id = p_work_order_id
     and phase = 'pre_start' and label = 'SWMS / induction attached'
     and required is distinct from v_swms;

  return 'ok:' || v_made::text;
end $$;
grant execute on function public.wo_seed_checklists(uuid) to authenticated, service_role;

-- The old wording, seeded before this migration, is superseded.
delete from public.wo_checklist_items
 where phase = 'pre_start' and label = 'SWMS / induction attached (commercial)';

do $$
declare v_id uuid;
begin
  for v_id in select id from public.work_orders where stage <> 'closed' loop
    perform public.wo_seed_checklists(v_id);
  end loop;
end $$;

select e.job_kind, count(*) as estimates from public.estimates e group by e.job_kind;
