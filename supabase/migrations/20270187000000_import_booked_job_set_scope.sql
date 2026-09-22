-- =============================================================================
-- 20270187 · a handover job takes its scope from the PaintScout work order
-- =============================================================================
-- Tom, 22 Sep 2026: "update the following accepted estimates with their work
-- order information so I can send the jobs out" — three jobs the Airtable
-- Zap had delivered with the quote's area prices and no lines (external_ref
-- .hours_pending = true, Tom's C-1 ruling of 16 Sep). The work-order page
-- has the lines, the hours and the products; scripts/import/fill-work-order.ts
-- reads it, joins it to the signed prices, proves the total to the cent with
-- the same build the pack import used, and writes the result through THIS
-- function — the one place an imported job's scope is replaced.
--
-- What it does, in one transaction, service role only:
--   · the estimate's builder_state, sent_snapshot and external_ref
--     (hours_pending → false, the work-order link) — the signed subtotal and
--     total must be UNCHANGED or it refuses;
--   · the work order's wo_snapshot — the new sheet, keeping what the office
--     may already have set on the old one (start date, access and crew
--     notes, contractor, materials with a colour);
--   · the tick list (wo_surfaces): re-seeded from the new sheet, allowed only
--     while nothing has been ticked;
--   · a wo_events row saying so.
--
-- Refuses (returns, never raises past the guards) anything that is not an
-- imported job, a job at a stage past pre_start, a job whose tick list has
-- been worked, or a scope whose money differs from the signed figure.
-- Converges on a re-run: or-replace only.
-- =============================================================================
set lock_timeout = '15s';

create or replace function public.import_booked_job_set_scope(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_est uuid := nullif(p->>'estimate_id', '')::uuid;
  v_quote text := p->>'quote_no';
  v_e public.estimates%rowtype;
  v_wo public.work_orders%rowtype;
  v_old jsonb;
  v_new jsonb;
  v_keep jsonb := '{}'::jsonb;
  v_rows integer := 0;
  v_worked integer := 0;
  r jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'import_booked_job_set_scope: service role only' using errcode = '42501';
  end if;
  if v_est is null or v_quote is null
     or p->'builder_state' is null or p->'sent_snapshot' is null or p->'wo_snapshot' is null
     or jsonb_typeof(p->'surface_rows') <> 'array' then
    raise exception 'import_booked_job_set_scope: estimate_id, quote_no, builder_state, sent_snapshot, wo_snapshot and surface_rows are required';
  end if;

  select * into v_e from public.estimates where id = v_est;
  if not found then return jsonb_build_object('status', 'error:not_found'); end if;
  if v_e.source <> 'paintscout' or v_e.status <> 'accepted' then
    return jsonb_build_object('status', 'error:not_imported', 'estimate_id', v_est);
  end if;
  if not exists (
    select 1 from public.crm_import_keys k
     where k.table_name = 'estimates' and k.row_id = v_est
       and k.key = 'bk_' || v_quote
       and k.import in ('paintscout-booked', 'airtable-handover')
  ) then
    return jsonb_build_object('status', 'error:not_imported', 'estimate_id', v_est);
  end if;
  if v_e.subtotal_cents is distinct from (p->>'subtotal_cents')::integer
     or v_e.total_cents is distinct from (p->>'total_cents')::integer then
    return jsonb_build_object('status', 'error:total_changed', 'estimate_id', v_est,
                              'signed', jsonb_build_object('subtotal_cents', v_e.subtotal_cents, 'total_cents', v_e.total_cents));
  end if;

  select * into v_wo from public.work_orders where estimate_id = v_est;
  if not found then return jsonb_build_object('status', 'error:no_work_order', 'estimate_id', v_est); end if;
  if v_wo.stage not in ('offered', 'pre_start') then
    return jsonb_build_object('status', 'skip:' || v_wo.stage::text, 'estimate_id', v_est, 'work_order_id', v_wo.id);
  end if;
  select count(*) into v_worked from public.wo_surfaces s
   where s.work_order_id = v_wo.id and (s.state <> 'todo' or s.rectification = true);
  if v_worked > 0 then
    return jsonb_build_object('status', 'skip:worked', 'estimate_id', v_est, 'work_order_id', v_wo.id, 'worked', v_worked);
  end if;

  perform set_config('crm.import', 'on', true);

  update public.estimates
     set builder_state = p->'builder_state',
         sent_snapshot = p->'sent_snapshot',
         external_ref = coalesce(external_ref, '{}'::jsonb) || coalesce(p->'external_ref', '{}'::jsonb),
         updated_at = now()
   where id = v_est;

  -- The new sheet, keeping what the office set on the old one after the import.
  v_old := coalesce(v_wo.wo_snapshot, '{}'::jsonb);
  v_new := p->'wo_snapshot';
  if nullif(v_old->>'accessNotes', '') is not null then v_keep := v_keep || jsonb_build_object('accessNotes', v_old->'accessNotes'); end if;
  if nullif(v_old->>'crewNotes', '') is not null then v_keep := v_keep || jsonb_build_object('crewNotes', v_old->'crewNotes'); end if;
  if nullif(v_old->>'startDate', '') is not null then v_keep := v_keep || jsonb_build_object('startDate', v_old->'startDate'); end if;
  if nullif(v_old->>'contractorName', '') is not null then v_keep := v_keep || jsonb_build_object('contractorName', v_old->'contractorName'); end if;
  if v_old->'contractorPaymentCents' is not null then v_keep := v_keep || jsonb_build_object('contractorPaymentCents', v_old->'contractorPaymentCents'); end if;
  if jsonb_typeof(v_old->'materials') = 'array' and jsonb_array_length(v_old->'materials') > 0 then
    v_keep := v_keep || jsonb_build_object('materials', v_old->'materials');
  end if;
  if jsonb_typeof(v_old->'appliedOptions') = 'array' then v_keep := v_keep || jsonb_build_object('appliedOptions', v_old->'appliedOptions'); end if;
  v_new := v_new || v_keep || jsonb_build_object('woRef', v_wo.wo_ref, 'status', v_wo.status::text);

  update public.work_orders set wo_snapshot = v_new where id = v_wo.id;

  -- The tick list: nothing has been worked (checked above), so the old rows
  -- are the old scope and go; the new rows are the new sheet.
  delete from public.wo_surfaces where work_order_id = v_wo.id;
  for r in select * from jsonb_array_elements(p->'surface_rows') loop
    if nullif(r->>'heading', '') is null or nullif(r->>'label', '') is null then continue; end if;
    insert into public.wo_surfaces (work_order_id, heading, heading_meta, label, surface_key, sort)
    values (v_wo.id, r->>'heading', coalesce(r->>'headingMeta', ''), r->>'label', nullif(r->>'surfaceKey', ''), coalesce((r->>'sort')::integer, 0));
    v_rows := v_rows + 1;
  end loop;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
  values (v_wo.id, 'scope_imported', null, 'system',
          jsonb_build_object('quote_no', v_quote, 'source', 'paintscout_work_order',
                             'areas', jsonb_array_length(coalesce(v_new->'areas', '[]'::jsonb)),
                             'surfaces', v_rows, 'hours', (p->>'hours')::numeric));

  return jsonb_build_object('status', 'ok', 'estimate_id', v_est, 'work_order_id', v_wo.id, 'surfaces', v_rows);
end $$;
revoke all on function public.import_booked_job_set_scope(jsonb) from public, anon, authenticated;
grant execute on function public.import_booked_job_set_scope(jsonb) to service_role;

-- ---- Read-back: read this, don't assume it ----------------------------------------------
select
  (select count(*) from pg_proc where proname = 'import_booked_job_set_scope') = 1 as fn_ok,
  (select prosecdef from pg_proc where proname = 'import_booked_job_set_scope') as fn_definer,
  (select has_function_privilege('service_role', 'public.import_booked_job_set_scope(jsonb)', 'execute')) as service_role_can,
  (select has_function_privilege('authenticated', 'public.import_booked_job_set_scope(jsonb)', 'execute')) as authenticated_can,
  (select has_function_privilege('anon', 'public.import_booked_job_set_scope(jsonb)', 'execute')) as anon_can,
  'true,true,true,false,false' as _expect_;

insert into public._prod_migrations(name) values ('20270187000000_import_booked_job_set_scope.sql') on conflict (name) do nothing;
