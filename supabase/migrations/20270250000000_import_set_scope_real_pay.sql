-- =============================================================================
-- 20270250 · import_booked_job_set_scope: a $0 contractor pay is a blank, not an offer
-- =============================================================================
-- Tom, 9 Oct 2026: on the filled handover jobs (15 Pelmet Cres, 9/552 Lonsdale
-- St) "the contractor amounts … are marked as 0.00". The Zap delivered no
-- offered amount, the job was stamped $0, and every fill kept the old sheet's
-- contractorPaymentCents — so the $0 survived. Now a pay is kept only when it
-- is > 0, and work_orders.contractor_payment_cents (what the tray and the
-- offer read) follows the new sheet unless it already carries a real figure.
-- A revision working scope opened before the fill (wo_working_scopes) is
-- refreshed with the new scope when the job has no live variation, and the
-- fill is refused (skip:variations) when it has one.
-- Same body as 20270208 otherwise. Converges on a re-run: or-replace only.
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
  -- Tom, 1 Oct 2026 (74 Champion St, quote 3666): a job the office moved to
  -- in_progress before its hours arrived may still be filled, PROVIDED its
  -- tick list is untouched — the worked-rows check below is the real guard.
  -- Anything later (qa, walkthrough, closed) is still refused.
  if v_wo.stage not in ('offered', 'pre_start', 'in_progress') then
    return jsonb_build_object('status', 'skip:' || v_wo.stage::text, 'estimate_id', v_est, 'work_order_id', v_wo.id);
  end if;
  select count(*) into v_worked from public.wo_surfaces s
   where s.work_order_id = v_wo.id and (s.state <> 'todo' or s.rectification = true);
  if v_worked > 0 then
    return jsonb_build_object('status', 'skip:worked', 'estimate_id', v_est, 'work_order_id', v_wo.id, 'worked', v_worked);
  end if;

  -- 20270250: a revision opened before the fill holds a COPY of the old scope
  -- (wo_working_scopes, made on first open). With no live variation there is
  -- no revision work to lose, so the copy is refreshed below; with one, the
  -- scope is refused rather than pulled out from under a change in flight.
  if exists (select 1 from public.wo_variations v
              where v.work_order_id = v_wo.id and v.status not in ('declined', 'cancelled')) then
    return jsonb_build_object('status', 'skip:variations', 'estimate_id', v_est, 'work_order_id', v_wo.id);
  end if;

  perform set_config('crm.import', 'on', true);
  -- The freeze (estimate_frozen_guard, 20270149) lets service_role through by
  -- current_user, but a SECURITY DEFINER function runs as its owner, so the
  -- guard saw 'postgres' and refused the first production run (23 Sep 2026:
  -- "accepted estimate is frozen"). The guard's own switch is the way in —
  -- the same one wo_apply_selected_options and estimate_add_option set.
  perform set_config('estimates.options', 'on', true);

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
  -- 20270250: only a REAL pay is kept. A handover's blank arrived as 0, and
  -- keeping it left every filled job offering the painter $0.00.
  if coalesce((v_old->>'contractorPaymentCents')::numeric, 0) > 0 then v_keep := v_keep || jsonb_build_object('contractorPaymentCents', v_old->'contractorPaymentCents'); end if;
  if jsonb_typeof(v_old->'materials') = 'array' and jsonb_array_length(v_old->'materials') > 0 then
    v_keep := v_keep || jsonb_build_object('materials', v_old->'materials');
  end if;
  if jsonb_typeof(v_old->'appliedOptions') = 'array' then v_keep := v_keep || jsonb_build_object('appliedOptions', v_old->'appliedOptions'); end if;
  v_new := v_new || v_keep || jsonb_build_object('woRef', v_wo.wo_ref, 'status', v_wo.status::text);

  -- The column the schedule tray and the offer read follows the sheet — unless
  -- the job already carries a real pay (an offer made, an amount typed).
  update public.work_orders
     set wo_snapshot = v_new,
         contractor_payment_cents = case
           when coalesce(v_wo.contractor_payment_cents, 0) > 0 then v_wo.contractor_payment_cents
           else nullif((v_new->>'contractorPaymentCents')::numeric, 0)::integer
         end
   where id = v_wo.id;

  update public.wo_working_scopes
     set accepted_state = p->'builder_state', working_state = p->'builder_state', updated_at = now()
   where estimate_id = v_est;

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
  (select prosrc like '%contractorPaymentCents'')::numeric, 0) > 0%' from pg_proc where proname = 'import_booked_job_set_scope') as fn_keeps_only_real_pay,
  (select prosrc like '%contractor_payment_cents = case%' from pg_proc where proname = 'import_booked_job_set_scope') as fn_sets_pay_column,
  (select prosrc like '%update public.wo_working_scopes%' from pg_proc where proname = 'import_booked_job_set_scope') as fn_refreshes_working_scope,
  (select prosrc like '%''offered'', ''pre_start'', ''in_progress''%' from pg_proc where proname = 'import_booked_job_set_scope') as fn_admits_in_progress,
  (select has_function_privilege('service_role', 'public.import_booked_job_set_scope(jsonb)', 'execute')) as service_role_can,
  (select has_function_privilege('authenticated', 'public.import_booked_job_set_scope(jsonb)', 'execute')) as authenticated_can,
  'true,true,true,true,true,true,false' as _expect_;

insert into public._prod_migrations(name) values ('20270250000000_import_set_scope_real_pay.sql') on conflict (name) do nothing;
