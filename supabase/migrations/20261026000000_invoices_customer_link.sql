-- =====================================================================
-- A2 · Invoicing batch 1 — the invoice becomes a document that stands up.
--
-- Two things, and no invoicing UI:
--
-- 1. Every insert into `invoices` names `customer_id` and reads it from the
--    parent estimate. There are exactly two live insert sites: the four
--    `accept_estimate` bodies in the migration history are successive
--    `create or replace` of ONE function so only the last is live, and
--    deemed sign-off is not a third site because `wo_signoff_sweep` calls
--    `wo_sign` rather than inserting for itself.
--
--    This writes NULL today. Nothing in the codebase writes
--    `estimates.customer_id` (70 of 71 rows null) and nothing inserts into
--    `customers` (3 rows, all seed). That is a separate, larger problem —
--    docs/briefs/customer-identity-link.md. The change belongs here anyway
--    because it is forward-compatible: invoices inherit real customers the
--    day the identity link lands, with no edit to this file.
--
--    `invoices.customer_id NOT NULL` is deliberately NOT here. Applied today
--    it would throw on every future acceptance, because the estimate it
--    reads from has no customer either.
--
-- 2. `invoices.estimate_id` becomes ON DELETE RESTRICT. `delete_estimate`
--    already refuses with `has_invoice`; the schema said `set null`, so any
--    delete NOT going through that RPC silently orphaned a financial record.
--    The database now agrees with the app.
--
--    ORDERING CONSEQUENCE: anything deleting an estimate must delete its
--    invoices first. Six sites; e2e/fixtures/woLoop.ts is the certain one.
--
-- Run supabase/fixes/a2-invoice-orphans.sql BEFORE this file.
-- Nothing here deletes data.
-- =====================================================================

-- ---- 1a. accept_estimate: the deposit invoice carries the customer ----

create or replace function public.accept_estimate(
  p_token text, p_name text, p_options jsonb, p_total_cents integer, p_deposit_cents integer
) returns text language plpgsql security definer set search_path = public as $$
declare
  v_id uuid; v_status public.estimate_status; v_share text;
  v_doc jsonb; v_snapshot jsonb;
  v_total integer; v_deposit integer; v_deposit_pct numeric;
begin
  select id, status, share_token, builder_state->'woDoc', sent_snapshot
    into v_id, v_status, v_share, v_doc, v_snapshot
    from public.estimates where share_token = p_token;

  if v_id is null then return 'not_found'; end if;
  if v_status = 'accepted' then return 'already'; end if;
  -- Only a quote the customer has actually been sent can be accepted.
  if v_status is distinct from 'sent' then return 'not_sent'; end if;

  -- THE MONEY COMES FROM THE SNAPSHOT, NOT THE CALLER.
  -- The snapshot is the document the customer is looking at, written by the
  -- server. p_total_cents / p_deposit_cents are ignored on purpose.
  v_total := coalesce(
    nullif((v_snapshot->'totals'->>'totalCents')::integer, 0),
    (v_snapshot->>'totalCents')::integer,
    (select total_cents from public.estimates where id = v_id)
  );
  v_deposit_pct := coalesce((v_snapshot->>'depositPct')::numeric, 50);
  v_deposit := round(v_total * v_deposit_pct / 100.0);

  update public.estimates
     set status = 'accepted', accepted_at = now(), accepted_name = p_name,
         selected_options = p_options, total_cents = coalesce(v_total, total_cents)
   where id = v_id;

  insert into public.estimate_events (estimate_id, type, payload)
    values (v_id, 'accepted',
            jsonb_build_object('name', p_name, 'options', p_options,
                               'total_cents', v_total,
                               'client_claimed_total', p_total_cents,
                               'derived_server_side', true));

  -- A2: the invoice carries its own customer. Null today, because nothing
  -- yet writes estimates.customer_id (docs/briefs/customer-identity-link.md);
  -- real the moment that lands, with no further edit here.
  insert into public.invoices (estimate_id, customer_id, status, amount_cents, issued_on)
    values (v_id,
            (select customer_id from public.estimates where id = v_id),
            'draft', greatest(coalesce(v_deposit, 0), 0), current_date);

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

  return 'accepted';
end; $$;

grant execute on function public.accept_estimate(text, text, jsonb, integer, integer) to anon, authenticated;

-- ---- 1b. wo_sign: the sign-off invoice stub carries it too ------------

create or replace function public.wo_sign(
  p_token text, p_name text, p_kind public.wo_signoff_kind default 'remote', p_device text default ''
) returns text language plpgsql security definer set search_path = public as $$
declare v_s public.wo_signoff%rowtype; v_wo public.work_orders%rowtype;
        v_unapproved text[]; v_years integer := 2; v_start date; v_report jsonb;
begin
  select * into v_s from public.wo_signoff where customer_token = p_token for update;
  if not found then return 'error:not_found'; end if;
  if v_s.signed_at is not null then return 'ok:already'; end if;
  if coalesce(trim(p_name), '') = '' then return 'error:no_name'; end if;

  select * into v_wo from public.work_orders where id = v_s.work_order_id;

  -- Every area the job actually has must be approved. A deemed sign-off is the
  -- one exception, because there the silence IS the answer.
  if p_kind <> 'deemed' then
    select array_agg(h) into v_unapproved from (
      select distinct heading as h from public.wo_surfaces
       where work_order_id = v_s.work_order_id
    ) x
    where (v_s.areas -> x.h -> 'approved_at') is null;

    if v_unapproved is not null and array_length(v_unapproved, 1) > 0 then
      return 'error:areas_outstanding:' || array_to_string(v_unapproved, ',');
    end if;
  end if;

  v_start := (now() at time zone 'Australia/Melbourne')::date;   -- ⚑4: sign-off date

  update public.wo_signoff
     set signed_at = now(), signed_name = trim(p_name),
         signed_kind = p_kind, signed_device = coalesce(p_device, '')
   where work_order_id = v_s.work_order_id;

  -- 1. warranty
  insert into public.warranties (work_order_id, estimate_id, starts_on, ends_on, years, signed_kind)
    values (v_s.work_order_id, v_wo.estimate_id, v_start,
            (v_start + make_interval(years => v_years))::date, v_years, p_kind)
  on conflict (work_order_id) do nothing;

  -- 2. the review request, as a task for the follow-up phase to pick up
  insert into public.follow_ups (estimate_id, due_on, done)
    values (v_wo.estimate_id, v_start + 2, false);

  -- 3. the completion report — built from the events, not written by anyone
  select jsonb_build_object(
    'wo_ref', v_wo.wo_ref,
    'signed_at', now(), 'signed_name', trim(p_name), 'signed_kind', p_kind::text,
    'warranty_starts', v_start,
    'surfaces', (select coalesce(jsonb_agg(jsonb_build_object(
                     'heading', heading, 'label', label, 'state', state::text,
                     'rectification', rectification) order by sort), '[]'::jsonb)
                   from public.wo_surfaces where work_order_id = v_s.work_order_id),
    'photos', (select coalesce(jsonb_agg(jsonb_build_object(
                     'kind', kind::text, 'area', area, 'path', storage_path)), '[]'::jsonb)
                 from public.wo_photos where work_order_id = v_s.work_order_id),
    -- Declined variations are IN the report. That is the point of keeping them.
    'variations', (select coalesce(jsonb_agg(jsonb_build_object(
                     'category', category, 'comment', comment, 'status', status::text,
                     'price_cents', price_cents)), '[]'::jsonb)
                     from public.wo_variations where work_order_id = v_s.work_order_id),
    'qa', (select coalesce(jsonb_agg(jsonb_build_object(
                     'kind', kind, 'result', result, 'thin_record', thin_record)), '[]'::jsonb)
             from public.wo_qa_checks where work_order_id = v_s.work_order_id),
    'areas', v_s.areas
  ) into v_report;

  update public.wo_signoff set report = v_report where work_order_id = v_s.work_order_id;

  -- 4. the invoice stub for the invoicing phase to consume
  insert into public.invoices (estimate_id, customer_id, status, amount_cents, issued_on)
    values (v_wo.estimate_id,
            (select customer_id from public.estimates where id = v_wo.estimate_id),
            'draft', 0, v_start);

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_s.work_order_id, 'signed_off', auth.uid(), 
            case when p_kind = 'deemed' then 'system' else 'customer' end,
            jsonb_build_object('kind', p_kind::text, 'name', trim(p_name),
                               'warranty_starts', v_start, 'deemed', p_kind = 'deemed'));

  perform public.wo_set_stage(v_s.work_order_id, 'closed',
                              case when p_kind = 'deemed' then 'system' else 'customer' end,
                              jsonb_build_object('signed_kind', p_kind::text));

  return 'ok:signed';
end $$;

grant execute on function public.wo_sign(text, text, public.wo_signoff_kind, text) to anon, authenticated, service_role;

-- ---- 2. the FK the delete guard always implied ------------------------

alter table public.invoices
  drop constraint if exists invoices_estimate_id_fkey;

alter table public.invoices
  add constraint invoices_estimate_id_fkey
  foreign key (estimate_id) references public.estimates (id) on delete restrict;

-- ---- readback: never assume the tail of a migration applied -----------
-- Expect exactly one row, delete_rule = RESTRICT.
select tc.constraint_name, rc.delete_rule
  from information_schema.table_constraints tc
  join information_schema.referential_constraints rc
    on rc.constraint_name = tc.constraint_name
 where tc.table_schema = 'public'
   and tc.table_name = 'invoices'
   and tc.constraint_name = 'invoices_estimate_id_fkey';

-- Expect two rows, both names_customer_id = true.
select p.proname,
       pg_get_functiondef(p.oid) like '%insert into public.invoices (estimate_id, customer_id%'
         as names_customer_id
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('accept_estimate', 'wo_sign')
 order by p.proname;
