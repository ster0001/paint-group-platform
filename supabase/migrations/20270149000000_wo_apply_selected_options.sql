-- =============================================================================
-- Ticked options reach the work order (Tom, 16 Sep 2026)
--
-- Until now an option the customer ticked at acceptance was invoiced (the
-- final invoice reads `selected_options`) but never painted: the work order's
-- document is frozen from `builder_state.woDoc`, which the builder computes
-- from the INCLUDED scope only. That was true of optional areas and line
-- items since the options existed, and became visible with optional
-- substrates.
--
-- The builder now saves, beside `woDoc`, a `woOptions` object: one contractor-
-- safe FRAGMENT per option id ({areas, materials, contractorPaymentCents,
-- conditionHours}), computed by the same code as the job sheet. This file:
--
--   1. `wo_apply_selected_options(estimate)` — merges every selected, not-yet-
--      applied fragment into the work order's snapshot AND into the estimate's
--      own woDoc (so a later Issue, which re-copies woDoc, keeps them), bumps
--      the contractor payment while no offer is live, and adds the new
--      surfaces to the painter's tick list. Idempotent: applied ids are kept
--      in the snapshot (`appliedOptions`). Never removes scope.
--   2. `accept_estimate` calls it right after creating the work order.
--   3. `estimate_add_option(estimate, option)` — staff, AFTER acceptance: the
--      customer changed their mind and wants the doors after all. Adds the id
--      to `selected_options`, lifts the accepted total by the option's price
--      (discount and GST applied the way the customer's page does), re-drafts
--      a standing draft final invoice so it carries the line, and applies the
--      scope to the work order. The accepted-estimate freeze is opened for
--      exactly these columns, for exactly this call (a transaction-local
--      setting, the `crm.merge` convention).
--
-- Nothing here prices anything: the fragment's figures were computed by
-- lib/pricing through the builder, and the option's price is the snapshot's.
-- =============================================================================

-- ---- 0. the freeze learns one key ------------------------------------------
create or replace function public.estimate_frozen_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.status = 'accepted' and current_user <> 'service_role'
     and current_setting('estimates.options', true) is distinct from 'on' then
    if new.builder_state is distinct from old.builder_state
       or new.sent_snapshot is distinct from old.sent_snapshot
       or new.subtotal_cents is distinct from old.subtotal_cents
       or new.total_cents is distinct from old.total_cents
       or new.accepted_total_cents is distinct from old.accepted_total_cents
       or new.selected_options is distinct from old.selected_options then
      raise exception 'accepted estimate is frozen — revisions belong on the working scope';
    end if;
  end if;
  return new;
end $$;

-- ---- 1a. merge one fragment into a work-order document ----------------------
-- Areas by id (surfaces appended by key, never duplicated), materials by
-- colourKey (litres summed — both sides are already rounded up to tins, so a
-- small over-order is the safe side), payment and condition hours added.
create or replace function public.wo_merge_option_fragment(p_doc jsonb, p_frag jsonb)
returns jsonb language plpgsql immutable set search_path = public as $$
declare
  v_doc jsonb := coalesce(p_doc, '{}'::jsonb);
  v_areas jsonb := coalesce(v_doc->'areas', '[]'::jsonb);
  v_mats jsonb := coalesce(v_doc->'materials', '[]'::jsonb);
  fa jsonb; fs jsonb; fm jsonb; da jsonb; dm jsonb;
  i integer; found_i integer; v_keys text[]; v_new jsonb;
  v_pay bigint; v_cond numeric; v_frag_cond numeric;
begin
  -- areas
  for fa in select value from jsonb_array_elements(coalesce(p_frag->'areas', '[]'::jsonb)) loop
    found_i := null;
    for i in 0 .. jsonb_array_length(v_areas) - 1 loop
      if (v_areas->i->>'id') = (fa->>'id') then found_i := i; exit; end if;
    end loop;
    if found_i is null then
      v_areas := v_areas || jsonb_build_array(fa);
    else
      da := v_areas->found_i;
      select coalesce(array_agg(s->>'key'), '{}') into v_keys
        from jsonb_array_elements(coalesce(da->'surfaces', '[]'::jsonb)) s;
      v_new := coalesce(da->'surfaces', '[]'::jsonb);
      for fs in select value from jsonb_array_elements(coalesce(fa->'surfaces', '[]'::jsonb)) loop
        if not ((fs->>'key') = any (v_keys)) then v_new := v_new || jsonb_build_array(fs); end if;
      end loop;
      da := jsonb_set(da, '{surfaces}', v_new);
      -- photos: union, in order
      v_new := coalesce(da->'photos', '[]'::jsonb);
      for fs in select value from jsonb_array_elements(coalesce(fa->'photos', '[]'::jsonb)) loop
        if not (v_new @> jsonb_build_array(fs)) then v_new := v_new || jsonb_build_array(fs); end if;
      end loop;
      da := jsonb_set(da, '{photos}', v_new);
      v_areas := jsonb_set(v_areas, array[found_i::text], da);
    end if;
  end loop;

  -- materials
  for fm in select value from jsonb_array_elements(coalesce(p_frag->'materials', '[]'::jsonb)) loop
    found_i := null;
    for i in 0 .. jsonb_array_length(v_mats) - 1 loop
      dm := v_mats->i;
      if coalesce(dm->>'colourKey', dm->>'product' || '||' || coalesce(dm->>'colourName', ''))
         = coalesce(fm->>'colourKey', fm->>'product' || '||' || coalesce(fm->>'colourName', '')) then
        found_i := i; exit;
      end if;
    end loop;
    if found_i is null then
      v_mats := v_mats || jsonb_build_array(fm);
    else
      dm := v_mats->found_i;
      if (dm->>'litres') is null or (fm->>'litres') is null then
        dm := dm || jsonb_build_object('litres', null, 'coverageMissing', true);
      else
        dm := dm || jsonb_build_object('litres', (dm->>'litres')::numeric + (fm->>'litres')::numeric);
      end if;
      v_mats := jsonb_set(v_mats, array[found_i::text], dm);
    end if;
  end loop;

  v_pay := coalesce((v_doc->>'contractorPaymentCents')::bigint, 0) + coalesce((p_frag->>'contractorPaymentCents')::bigint, 0);
  v_doc := v_doc || jsonb_build_object('areas', v_areas, 'materials', v_mats, 'contractorPaymentCents', v_pay);

  v_frag_cond := coalesce((p_frag->>'conditionHours')::numeric, 0);
  if v_frag_cond <> 0 and (v_doc->'condition') is not null and jsonb_typeof(v_doc->'condition') = 'object' then
    v_cond := coalesce((v_doc->'condition'->>'extraHours')::numeric, 0) + v_frag_cond;
    v_doc := jsonb_set(v_doc, '{condition,extraHours}', to_jsonb(round(v_cond, 2)));
  end if;
  return v_doc;
end $$;

-- ---- 1b. apply the selected options to the work order -----------------------
create or replace function public.wo_apply_selected_options(p_estimate_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_est public.estimates%rowtype; v_wo public.work_orders%rowtype;
  v_frags jsonb; v_snap jsonb; v_doc jsonb; v_applied jsonb; v_selected jsonb;
  v_id text; v_frag jsonb; v_n integer := 0; v_delta bigint := 0;
  v_live boolean; v_sort integer; v_bs jsonb;
begin
  select * into v_est from public.estimates where id = p_estimate_id;
  if not found then return 'error:not_found'; end if;
  select * into v_wo from public.work_orders where estimate_id = p_estimate_id for update;
  if not found then return 'ok:no_work_order'; end if;

  v_selected := case when jsonb_typeof(v_est.selected_options) = 'array' then v_est.selected_options else '[]'::jsonb end;
  v_frags := coalesce(v_est.builder_state->'woOptions', '{}'::jsonb);
  if jsonb_typeof(v_frags) <> 'object' then v_frags := '{}'::jsonb; end if;

  v_snap := coalesce(v_wo.wo_snapshot, v_est.builder_state->'woDoc');
  v_doc := v_est.builder_state->'woDoc';
  if v_snap is null then return 'ok:no_document'; end if;
  v_applied := coalesce(v_snap->'appliedOptions', '[]'::jsonb);
  if jsonb_typeof(v_applied) <> 'array' then v_applied := '[]'::jsonb; end if;

  for v_id in select value #>> '{}' from jsonb_array_elements(v_selected) loop
    if v_applied @> to_jsonb(array[v_id]) then continue; end if;
    v_frag := v_frags->v_id;
    if v_frag is null then continue; end if;   -- nothing the crew can act on (or an older save)
    v_snap := public.wo_merge_option_fragment(v_snap, v_frag);
    if v_doc is not null then v_doc := public.wo_merge_option_fragment(v_doc, v_frag); end if;
    v_applied := v_applied || to_jsonb(array[v_id]);
    v_delta := v_delta + coalesce((v_frag->>'contractorPaymentCents')::bigint, 0);
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then return 'ok:nothing'; end if;

  v_snap := v_snap || jsonb_build_object('appliedOptions', v_applied);
  if v_doc is not null then v_doc := v_doc || jsonb_build_object('appliedOptions', v_applied); end if;

  -- The offer is a number a contractor has seen: once one is live the pay
  -- stays and the extra goes through a variation. Before that it moves.
  select exists (
    select 1 from public.booking_offers o
     where o.work_order_id = v_wo.id and o.state in ('offered', 'proposed', 'accepted')
  ) into v_live;

  -- Not live: the pay is the merged document's figure (base + every applied
  -- option), the same figure `issue_work_order` would set from the document.
  update public.work_orders
     set wo_snapshot = v_snap,
         contractor_payment_cents = case
           when v_live then contractor_payment_cents
           else coalesce(nullif(v_snap->>'contractorPaymentCents', '')::integer, coalesce(contractor_payment_cents, 0) + v_delta) end
   where id = v_wo.id;

  -- The estimate's own document, so a later Issue keeps the options.
  if v_doc is not null then
    perform set_config('estimates.options', 'on', true);
    v_bs := jsonb_set(v_est.builder_state, '{woDoc}', v_doc);
    update public.estimates set builder_state = v_bs where id = p_estimate_id;
  end if;

  -- The painter's tick list: one row per new surface, in document order,
  -- after what is there (mirrors lib/workorder/surfaces.ts seedRowsFromDoc:
  -- heading = area title, meta = "N surfaces · X coats · finish").
  select coalesce(max(sort), -1) + 1 into v_sort from public.wo_surfaces where work_order_id = v_wo.id;
  insert into public.wo_surfaces (work_order_id, heading, heading_meta, label, surface_key, sort)
  select v_wo.id,
         a->>'title',
         (select
            (jsonb_array_length(a->'surfaces'))::text || ' surface' || case when jsonb_array_length(a->'surfaces') = 1 then '' else 's' end
            || coalesce((select ' · ' || case when min(c) = max(c) then min(c)::text || ' coat' || case when min(c) = 1 then '' else 's' end
                                        else min(c)::text || '–' || max(c)::text || ' coats' end
                           from (select (s->>'coats')::integer c from jsonb_array_elements(a->'surfaces') s) x where c > 0), '')
            || coalesce(' · ' || nullif(a->>'finishCode', ''), '')),
         s->>'label',
         s->>'key',
         v_sort + (row_number() over ()) - 1
    from jsonb_array_elements(coalesce(v_snap->'areas', '[]'::jsonb)) a,
         jsonb_array_elements(coalesce(a->'surfaces', '[]'::jsonb)) s
   where nullif(trim(s->>'label'), '') is not null
     and nullif(s->>'key', '') is not null
     and not exists (select 1 from public.wo_surfaces w where w.work_order_id = v_wo.id and w.surface_key = s->>'key');

  return 'ok:applied:' || v_n::text;
end $$;

revoke all on function public.wo_merge_option_fragment(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.wo_apply_selected_options(uuid) from public, anon, authenticated;
-- Internal: the definer RPCs above call them; service_role for repairs and e2e.
grant execute on function public.wo_merge_option_fragment(jsonb, jsonb) to service_role;
grant execute on function public.wo_apply_selected_options(uuid) to service_role;

-- ---- 2. acceptance applies the ticked options -------------------------------
-- BODY BASIS 20261112 (invoicing core) — one added line after the work order.
create or replace function public.accept_estimate(
  p_token text, p_name text, p_options jsonb, p_total_cents integer, p_deposit_cents integer
) returns text language plpgsql security definer set search_path = public as $$
declare
  v_id uuid; v_status public.estimate_status; v_share text;
  v_doc jsonb; v_snapshot jsonb;
  v_total integer; v_deposit integer; v_deposit_pct numeric;
  v_wo_id uuid; v_rate numeric; v_dep_gst integer; v_inv uuid;
begin
  select id, status, share_token, builder_state->'woDoc', sent_snapshot
    into v_id, v_status, v_share, v_doc, v_snapshot
    from public.estimates where share_token = p_token;

  if v_id is null then return 'not_found'; end if;
  if v_status = 'accepted' then return 'already'; end if;
  if v_status is distinct from 'sent' then return 'not_sent'; end if;

  v_total := coalesce(
    nullif((v_snapshot->'totals'->>'totalCents')::integer, 0),
    (v_snapshot->>'totalCents')::integer,
    (select total_cents from public.estimates where id = v_id)
  );
  v_deposit_pct := coalesce((v_snapshot->>'depositPct')::numeric,
                            public.invoice_setting_num('{depositPct}', 10));
  v_deposit := round(v_total * v_deposit_pct / 100.0);

  update public.estimates
     set status = 'accepted', accepted_at = now(), accepted_name = p_name,
         selected_options = p_options, total_cents = coalesce(v_total, total_cents),
         accepted_total_cents = v_total
   where id = v_id;

  insert into public.estimate_events (estimate_id, type, payload)
    values (v_id, 'accepted',
            jsonb_build_object('name', p_name, 'options', p_options,
                               'total_cents', v_total,
                               'client_claimed_total', p_total_cents,
                               'derived_server_side', true));

  insert into public.work_orders (estimate_id, wo_ref, share_token, wo_snapshot, issued_at, status)
    values (
      v_id,
      'WO-' || upper(substr(coalesce(v_share, replace(gen_random_uuid()::text,'-','')), 1, 8)),
      replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
      v_doc,
      case when v_doc is not null then now() else null end,
      case when v_doc is not null then 'issued'::public.wo_status else 'draft'::public.wo_status end
    )
    on conflict (estimate_id) do nothing;
  select id into v_wo_id from public.work_orders where estimate_id = v_id;

  -- Tom, 16 Sep: what the customer ticked is on the job sheet from the start.
  perform public.wo_apply_selected_options(v_id);

  v_rate := public.invoice_setting_num('{gstRatePct}', 10);
  v_dep_gst := public.gst_from_inc_cents(greatest(coalesce(v_deposit, 0), 0)::bigint, v_rate);
  insert into public.invoices (estimate_id, customer_id, work_order_id, kind, status,
                               amount_cents, subtotal_ex_cents, gst_cents, total_inc_cents, token)
    values (v_id,
            (select customer_id from public.estimates where id = v_id),
            v_wo_id, 'deposit', 'draft',
            greatest(coalesce(v_deposit, 0), 0),
            greatest(coalesce(v_deposit, 0), 0) - v_dep_gst,
            v_dep_gst,
            greatest(coalesce(v_deposit, 0), 0),
            public.invoice_new_token())
    returning id into v_inv;

  insert into public.invoice_lines (invoice_id, sort, source, description, amount_ex_cents, gst_cents)
    values (v_inv, 0, 'manual',
            'Deposit — ' || public.invoice_pct_text(v_deposit_pct)
            || '% of the contract price, payable on acceptance',
            greatest(coalesce(v_deposit, 0), 0) - v_dep_gst, v_dep_gst);

  perform public.invoice_event(v_inv, 'drafted', 'system',
    jsonb_build_object('auto', 'acceptance', 'deposit_pct', v_deposit_pct,
                       'total_inc_cents', greatest(coalesce(v_deposit, 0), 0)));

  return 'accepted';
end; $$;

grant execute on function public.accept_estimate(text, text, jsonb, integer, integer) to anon, authenticated;

-- ---- 3. staff add an option AFTER acceptance --------------------------------
create or replace function public.estimate_add_option(p_estimate_id uuid, p_option_id text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_est public.estimates%rowtype; v_opt jsonb; v_selected jsonb;
  v_price bigint; v_rate numeric; v_pct numeric; v_ex bigint; v_inc bigint; v_applied text;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into v_est from public.estimates where id = p_estimate_id for update;
  if not found then return 'error:not_found'; end if;
  if v_est.status <> 'accepted' then return 'error:not_accepted'; end if;

  select value into v_opt
    from jsonb_array_elements(coalesce(v_est.sent_snapshot->'options', '[]'::jsonb))
   where value->>'id' = p_option_id;
  if v_opt is null then return 'error:unknown_option'; end if;

  v_selected := case when jsonb_typeof(v_est.selected_options) = 'array' then v_est.selected_options else '[]'::jsonb end;
  if v_selected @> to_jsonb(array[p_option_id]) then
    -- Already the customer's choice; make sure the crew has it.
    v_applied := public.wo_apply_selected_options(p_estimate_id);
    return 'ok:already_selected:' || v_applied;
  end if;

  -- The price the customer saw, less a percentage discount if the quote
  -- carried one (a fixed discount was capped at the accepted subtotal and
  -- does not move), plus GST — the customer page's own arithmetic.
  v_price := coalesce((v_opt->>'priceCents')::bigint, 0);
  v_pct := case when coalesce(v_est.sent_snapshot->>'discountMode', 'pct') = 'pct'
                then coalesce((v_est.sent_snapshot->>'discountPct')::numeric, 0) else 0 end;
  v_ex := v_price - round(v_price * v_pct / 100.0);
  v_rate := coalesce((v_est.sent_snapshot->>'gstRatePct')::numeric, public.invoice_setting_num('{gstRatePct}', 10));
  v_inc := v_ex + round(v_ex * v_rate / 100.0);

  perform set_config('estimates.options', 'on', true);
  update public.estimates
     set selected_options = v_selected || to_jsonb(array[p_option_id]),
         accepted_total_cents = coalesce(accepted_total_cents, total_cents, 0) + v_inc,
         total_cents = coalesce(total_cents, 0) + v_inc
   where id = p_estimate_id;

  insert into public.estimate_events (estimate_id, type, payload)
    values (p_estimate_id, 'option_added',
            jsonb_build_object('option', p_option_id, 'title', v_opt->>'title',
                               'price_cents', v_price, 'inc_cents', v_inc, 'by', auth.uid()));

  -- A standing draft final invoice is re-drafted from the ledger so it
  -- carries the line; an issued one is left alone (the balance shows it).
  if exists (select 1 from public.invoices where estimate_id = p_estimate_id and kind = 'final' and status = 'draft') then
    perform public.invoice_draft_final(p_estimate_id);
  end if;

  v_applied := public.wo_apply_selected_options(p_estimate_id);
  return 'ok:added:' || v_applied;
end $$;

grant execute on function public.estimate_add_option(uuid, text) to authenticated;

-- ---- Verification -----------------------------------------------------------
select p.proname, pg_get_function_identity_arguments(p.oid)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('wo_merge_option_fragment', 'wo_apply_selected_options', 'accept_estimate', 'estimate_add_option', 'estimate_frozen_guard')
 order by 1;
-- Expect five rows. Then, on a sent estimate saved by the new builder (it has
-- builder_state->'woOptions'), accept with an option ticked and:
--   select wo_snapshot->'appliedOptions', jsonb_array_length(wo_snapshot->'areas'->0->'surfaces')
--     from work_orders where estimate_id = '<id>';
-- Expect the option id listed and the extra surface counted.

-- Registers itself in the production ledger (added 16 Sep 2026: this file
-- shipped without it, so `select … from public._prod_migrations` could not say
-- whether it was live — see docs/ARCHITECTURE.md, the invoicing read-failure note).
insert into public._prod_migrations(name) values ('20270149000000_wo_apply_selected_options.sql') on conflict (name) do nothing;
