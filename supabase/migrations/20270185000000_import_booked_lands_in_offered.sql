-- =============================================================================
-- 20270185 · imported booked jobs land in the tray at 'offered'
-- =============================================================================
-- Tom's ruling, 20 Sep 2026: a job the PaintScout/Airtable import brought in
-- (crm_import_keys · table_name = 'work_orders' · import in
-- ('paintscout-booked', 'airtable-handover')) has NOT been booked — it has no
-- contractor, no start date and no booking offer. It belongs at stage
-- 'offered' (the "Offer" / needs-booking lane), where the tray, the console's
-- `unbooked:` card ("Accepted, still not booked in") and the dashboard tile
-- `pc.jobs_to_schedule` all look. import_booked_job wrote them at 'pre_start',
-- which every one of those surfaces ignores.
--
-- Two things:
--   1. import_booked_job — the same function (copied from 20270152 verbatim)
--      except the work order inserts at 'offered'. New arrivals through the
--      Zap door land in the right lane from now on.
--   2. import_release_to_tray(p_work_order_id) — the ONE way the rows already
--      in are moved: pre_start → offered through wo_set_stage (a legal
--      transition, actors {system, staff}, event written, status re-derived).
--      Refuses anything not imported; skips anything already at another
--      stage, or that has a contractor, a date or a live offer — those WERE
--      booked, by hand, after the import, and are not touched.
--      scripts/import/release-to-tray.ts check|run drives it per row.
--
-- Converges on a re-run: or-replace only, no data statements. The data move is
-- the script's, one RPC call per row, and answers 'skip:offered' the second time.
-- =============================================================================
set lock_timeout = '15s';

create or replace function public.import_booked_job(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_import text := p->>'import';
  v_key text := p->>'key';
  v_est uuid;
  v_wo uuid;
  v_share text;
  v_wo_token text;
  v_account uuid := (p->>'account_id')::uuid;
  v_property uuid := nullif(p->>'property_id', '')::uuid;
  v_accepted timestamptz := (p->>'accepted_at')::timestamptz;
  v_note text := nullif(trim(coalesce(p->>'tray_note', '')), '');
  v_existing_note text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'import_booked_job: service role only' using errcode = '42501';
  end if;
  if v_import is null or v_key is null or v_account is null or v_accepted is null then
    raise exception 'import_booked_job: import, key, account_id and accepted_at are required';
  end if;
  if (p->>'total_cents')::integer <= 0 or (p->>'subtotal_cents')::integer <= 0 then
    raise exception 'import_booked_job: a signed job has a positive total';
  end if;

  select row_id into v_est from public.crm_import_keys where import = v_import and key = v_key and table_name = 'estimates';
  if v_est is not null then
    select id into v_wo from public.work_orders where estimate_id = v_est;
    if coalesce((p->>'update_note')::boolean, false) and v_note is not null and v_wo is not null then
      select note into v_existing_note from public.wo_booking_notes
       where work_order_id = v_wo and author is null order by created_at desc limit 1;
      if v_existing_note is distinct from v_note then
        insert into public.wo_booking_notes (work_order_id, note) values (v_wo, v_note);
        return jsonb_build_object('status', 'note_updated', 'estimate_id', v_est, 'work_order_id', v_wo);
      end if;
    end if;
    return jsonb_build_object('status', 'exists', 'estimate_id', v_est, 'work_order_id', v_wo);
  end if;

  perform set_config('crm.import', 'on', true);

  -- The caller's token when it sent one (the customer document's estRef is
  -- derived from it), else a fresh 64-char one.
  v_share := coalesce(nullif(p->>'share_token', ''), replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''));
  if length(v_share) < 24 then raise exception 'import_booked_job: share_token too short'; end if;
  v_wo_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

  -- Draft first: the office-notified marker and the welcome claim must exist
  -- before the row is ever 'accepted', so nothing that reads "accepted and
  -- not yet told" can fire in between.
  insert into public.estimates
    (account_id, property_id, title, status, source, external_ref, level_of_finish, size_band, job_kind,
     rate_card_id, rate_card_version, subtotal_cents, total_cents, builder_state, sent_snapshot, share_token,
     created_at, sent_at, updated_at)
  values
    (v_account, v_property, p->>'title', 'draft', 'paintscout', p->'external_ref',
     (p->>'level_of_finish')::smallint, nullif(p->>'size_band', ''), coalesce(nullif(p->>'job_kind', ''), 'residential')::public.job_kind,
     nullif(p->>'rate_card_id', '')::uuid, nullif(p->>'rate_card_version', '')::integer,
     (p->>'subtotal_cents')::integer, (p->>'total_cents')::integer, p->'builder_state', p->'sent_snapshot', v_share,
     v_accepted, v_accepted, v_accepted)
  returning id into v_est;

  insert into public.estimate_events (estimate_id, type, payload)
    values (v_est, 'office_accept_notified', jsonb_build_object('outcome', 'imported_silent', 'import', v_import));
  insert into public.automation_claims (automation_key, entity_id, rung)
    values ('customer_accepted_welcome', v_est, '')
    on conflict do nothing;

  update public.estimates
     set status = 'accepted', accepted_at = v_accepted, accepted_name = p->>'accepted_name',
         accepted_total_cents = (p->>'total_cents')::integer, selected_options = '[]'::jsonb, updated_at = v_accepted
   where id = v_est;

  insert into public.estimate_events (estimate_id, type, payload, created_at)
    values (v_est, 'accepted', jsonb_build_object('name', p->>'accepted_name', 'options', '[]'::jsonb,
                                                  'total_cents', (p->>'total_cents')::integer, 'imported', true), v_accepted);

  -- The historical event, dated when the customer actually signed.
  perform public.crm_emit('estimate_accepted', v_account,
    jsonb_build_object('totalCents', (p->>'total_cents')::integer, 'quoteNo', p->'external_ref'->>'quote_no', 'origin', 'paintscout'),
    'airtable_import', v_accepted, v_est, null, null, 'estimate_accepted:' || v_est);

  -- 20 Sep 2026 (Tom): an imported job has NOT been booked — no contractor,
  -- no date, no offer — so it lands at 'offered' (the needs-booking lane the
  -- tray, the console's unbooked card and pc.jobs_to_schedule all read), not
  -- 'pre_start'. Status stays 'issued' (wo_derive_status('offered', issued_at)).
  insert into public.work_orders
    (estimate_id, wo_ref, status, stage, stage_entered_at, issued_at, contractor_id, start_date, end_date,
     contractor_payment_cents, share_token, wo_snapshot, access_notes)
  values
    (v_est, p->>'wo_ref', 'issued', 'offered', v_accepted, v_accepted, null, null, null,
     nullif(p->>'contractor_payment_cents', '')::integer, v_wo_token, p->'wo_snapshot',
     coalesce(p->>'access_notes', ''))
  returning id into v_wo;

  if v_note is not null then
    insert into public.wo_booking_notes (work_order_id, note, created_at) values (v_wo, v_note, v_accepted);
  end if;

  insert into public.crm_import_keys (import, key, table_name, row_id) values
    (v_import, v_key, 'estimates', v_est),
    (v_import, v_key || ':wo', 'work_orders', v_wo)
  on conflict (import, key) do nothing;

  return jsonb_build_object('status', 'created', 'estimate_id', v_est, 'work_order_id', v_wo, 'share_token', v_share);
end $$;
revoke all on function public.import_booked_job(jsonb) from public, anon, authenticated;

-- ---- import_release_to_tray -------------------------------------------------
-- Service role or staff. Returns:
--   'error:not_imported'  the id is not an imported work order
--   'skip:<stage>'        already moved on (or already 'offered')
--   'skip:booked'         a contractor, a start date or a live offer exists
--   'ok'                  moved pre_start → offered
--   'error:…'             whatever wo_set_stage refused (gate, actor)
create or replace function public.import_release_to_tray(p_work_order_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_wo public.work_orders%rowtype;
  v_res text;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_staff() then
    raise exception 'import_release_to_tray: service role or staff only' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.crm_import_keys k
     where k.table_name = 'work_orders'
       and k.row_id = p_work_order_id
       and k.import in ('paintscout-booked', 'airtable-handover')
  ) then
    return 'error:not_imported';
  end if;

  select * into v_wo from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;
  if v_wo.stage <> 'pre_start' then return 'skip:' || v_wo.stage::text; end if;

  if v_wo.contractor_id is not null
     or v_wo.start_date is not null
     or exists (
       select 1 from public.booking_offers o
        where o.work_order_id = p_work_order_id
          and o.state in ('offered', 'proposed', 'accepted')
     ) then
    return 'skip:booked';
  end if;

  v_res := public.wo_set_stage(p_work_order_id, 'offered', 'system',
                               jsonb_build_object('reason', 'import_release_to_tray'));
  if v_res like 'ok:%' then return 'ok'; end if;
  return v_res;
end $$;
revoke all on function public.import_release_to_tray(uuid) from public, anon, authenticated;
grant execute on function public.import_release_to_tray(uuid) to service_role;

-- ---- Read-back: read this, don't assume it ----------------------------------------------
select
  (select count(*) from pg_proc where proname = 'import_booked_job') = 1 as import_fn_ok,
  (select prosrc like '%''issued'', ''offered'', v_accepted%' from pg_proc where proname = 'import_booked_job') as import_fn_lands_offered,
  (select count(*) from pg_proc where proname = 'import_release_to_tray') = 1 as release_fn_ok,
  (select prosecdef from pg_proc where proname = 'import_release_to_tray') as release_fn_definer,
  (select has_function_privilege('service_role', 'public.import_release_to_tray(uuid)', 'execute')) as release_service_role_can,
  (select has_function_privilege('authenticated', 'public.import_release_to_tray(uuid)', 'execute')) as release_authenticated_can,
  (select has_function_privilege('anon', 'public.import_release_to_tray(uuid)', 'execute')) as release_anon_can,
  (select count(*) from public.wo_stage_transitions where from_stage = 'pre_start' and to_stage = 'offered' and 'system' = any(actors)) = 1 as transition_ok,
  'true,true,true,true,true,false,false,true' as _expect_;

insert into public._prod_migrations(name) values ('20270185000000_import_booked_lands_in_offered.sql') on conflict (name) do nothing;
