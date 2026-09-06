-- =============================================================================
-- CRM v2 · P1b — the event log feeds itself: lifecycle triggers, backfill,
-- estimate lapsing
--
-- docs/briefs/crm-v2-deep-dive.md §3 F2. crm_events was described as "the ONE
-- log every timeline, segment and campaign trigger reads" — and 29 of its 42
-- event kinds had no writer, because each was meant to be written by
-- application code at the right moment and most moments were missed. Estimate
-- sent, opened, accepted, declined; job started, completed; invoice sent,
-- paid: none reached the log. The customer timeline said "Nothing logged yet"
-- under a customer whose estimate had been opened twice.
--
-- The fix is structural. The tables where these facts change carry AFTER
-- triggers that write the event, so no route can forget. Every write carries
-- a dedupe key, so re-running, re-linking or backfilling can never double an
-- event. The triggers are SECURITY DEFINER because the customer's own actions
-- (opening an estimate, accepting it) fire them under the anon/authenticated
-- role, which rightly has no insert grant on crm_events.
--
-- Also here, because it closes the same loop:
--   · `estimate_lapsed` — a NEW event kind. Nothing ever expired an estimate
--     (`valid_until` was set at send and never enforced), so a March quote sat
--     in "Estimate sent" for ever. `crm_lapse_estimates()` moves sent
--     estimates past their valid_until to `expired` (the enum already had the
--     value; set_estimate_status already allowed it). Decision 8.11: lapsed
--     is NOT lost — the event becomes a Today item that asks a person.
--   · A one-off backfill of history from the rows that exist, idempotent.
--
-- Read-back at the end: counts per kind.
-- =============================================================================

-- ---- 1 · the internal emitter ----------------------------------------------
-- No auth check on purpose: it is not granted to any role and is only ever
-- called from the trigger functions below (themselves security definer).
create or replace function public.crm_emit(
  p_type text, p_account uuid, p_payload jsonb, p_source text, p_occurred timestamptz,
  p_estimate uuid, p_work_order uuid, p_invoice uuid, p_dedupe text
) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_account is null then return; end if;
  if p_dedupe is not null and exists (select 1 from public.crm_events where dedupe_key = p_dedupe) then return; end if;
  begin
    insert into public.crm_events
      (account_id, estimate_id, work_order_id, invoice_id, type, source, payload, occurred_at, dedupe_key)
    values
      (p_account, p_estimate, p_work_order, p_invoice, p_type, coalesce(p_source, 'system'),
       coalesce(p_payload, '{}'::jsonb), coalesce(p_occurred, now()), p_dedupe);
  exception when unique_violation then
    null; -- lost a race on the dedupe key: the first writer's row stands
  end;
end $$;
revoke all on function public.crm_emit(text, uuid, jsonb, text, timestamptz, uuid, uuid, uuid, text) from public, anon, authenticated;

-- ---- 1b · the append-only guard learns about links -------------------------
-- Every lifecycle event now carries the estimate / work order / invoice it is
-- about, and those foreign keys are ON DELETE SET NULL (20270105). A SET NULL
-- is an UPDATE, so deleting an estimate tripped the guard and the delete
-- failed (found on C1: delete_estimate stopped working). The guard allows
-- exactly two things: a link going to null when its row is deleted, and the
-- merge re-pointing account_id (20270120). Nothing else.
create or replace function public.crm_events_no_update()
returns trigger language plpgsql as $$
declare v_same boolean := new.type = old.type and new.payload = old.payload and new.occurred_at = old.occurred_at
                          and new.source = old.source and new.dedupe_key is not distinct from old.dedupe_key;
begin
  if v_same and new.account_id is not distinct from old.account_id
     and (new.estimate_id is null or new.estimate_id = old.estimate_id)
     and (new.work_order_id is null or new.work_order_id = old.work_order_id)
     and (new.invoice_id is null or new.invoice_id = old.invoice_id)
     and (new.property_id is null or new.property_id = old.property_id) then
    return new;  -- a linked row was deleted; the event keeps its history, loses the pointer
  end if;
  if current_setting('crm.merge', true) = 'on' and v_same and new.account_id is distinct from old.account_id then
    return new;  -- crm_merge_accounts re-pointing the dropped account's events
  end if;
  raise exception 'crm_events is append-only: % on % is not allowed', tg_op, tg_table_name
    using hint = 'Record a correcting event instead of editing the original.';
end $$;

-- ---- 2 · estimates ----------------------------------------------------------
-- `old.account_id is null` counts as "fresh": an estimate linked to its
-- account after the fact (the staff-path capture) emits its history then.
create or replace function public.estimates_crm_lifecycle()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_fresh boolean := (tg_op = 'INSERT') or (old.account_id is null);
        v_total integer := coalesce(new.accepted_total_cents, new.total_cents, 0);
begin
  if new.account_id is null then return new; end if;

  -- Sent = a sent_at stamp, or any status past draft (older rows and seeds
  -- carry the status without the stamp).
  if (new.sent_at is not null or new.status in ('sent', 'accepted', 'declined', 'expired'))
     and (v_fresh or (old.sent_at is null and old.status = 'draft')) then
    perform public.crm_emit('estimate_sent', new.account_id,
      jsonb_build_object('totalCents', greatest(coalesce(new.total_cents, 0), 0), 'channel', 'link',
                         'validDays', case when new.valid_until is not null and new.sent_at is not null then greatest((new.valid_until - new.sent_at::date), 1) end),
      'system', coalesce(new.sent_at, new.created_at), new.id, null, null, 'estimate_sent:' || new.id);
  end if;

  if new.status = 'accepted' and (v_fresh or old.status is distinct from 'accepted') then
    perform public.crm_emit('estimate_accepted', new.account_id,
      jsonb_build_object('totalCents', greatest(v_total, 0)),
      'customer', coalesce(new.accepted_at, now()), new.id, null, null, 'estimate_accepted:' || new.id);
  end if;

  if new.status = 'declined' and (v_fresh or old.status is distinct from 'declined') then
    perform public.crm_emit('estimate_declined', new.account_id,
      case when nullif(trim(coalesce(new.declined_reason, '')), '') is null then '{}'::jsonb
           else jsonb_build_object('reason', left(new.declined_reason, 2000)) end,
      'customer', coalesce(new.declined_at, now()), new.id, null, null, 'estimate_declined:' || new.id);
  end if;

  if new.status = 'expired' and (v_fresh or old.status is distinct from 'expired') then
    perform public.crm_emit('estimate_lapsed', new.account_id,
      jsonb_build_object('totalCents', greatest(coalesce(new.total_cents, 0), 0),
                         'sentAt', new.sent_at, 'validUntil', new.valid_until),
      'system', now(), new.id, null, null, 'estimate_lapsed:' || new.id);
  end if;

  -- The first open, when it was recorded on the estimate and no session row
  -- ever existed (older data). Live opens come from estimate_views below.
  if new.viewed_at is not null and (v_fresh or old.viewed_at is null)
     and not exists (select 1 from public.estimate_views v where v.estimate_id = new.id) then
    perform public.crm_emit('estimate_viewed', new.account_id,
      jsonb_build_object('viewNumber', 1),
      'customer', new.viewed_at, new.id, null, null, 'estimate_viewed:' || new.id || ':first');
  end if;

  return new;
end $$;

drop trigger if exists t_estimates_crm_lifecycle on public.estimates;
create trigger t_estimates_crm_lifecycle
  after insert or update of status, sent_at, viewed_at, account_id on public.estimates
  for each row execute function public.estimates_crm_lifecycle();

-- ---- 3 · estimate opens: one event per viewing session ----------------------
create or replace function public.estimate_views_crm_lifecycle()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_account uuid; v_n integer;
begin
  select account_id into v_account from public.estimates where id = new.estimate_id;
  if v_account is null then return new; end if;
  select count(*) into v_n from public.estimate_views where estimate_id = new.estimate_id and created_at <= new.created_at;
  perform public.crm_emit('estimate_viewed', v_account,
    jsonb_build_object('viewNumber', greatest(v_n, 1)),
    'customer', new.created_at, new.estimate_id, null, null,
    'estimate_viewed:' || new.estimate_id || ':' || new.session_id);
  return new;
end $$;

drop trigger if exists t_estimate_views_crm_lifecycle on public.estimate_views;
create trigger t_estimate_views_crm_lifecycle
  after insert on public.estimate_views
  for each row execute function public.estimate_views_crm_lifecycle();

-- ---- 4 · work orders --------------------------------------------------------
create or replace function public.work_orders_crm_lifecycle()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_account uuid;
begin
  if new.stage is not distinct from old.stage then return new; end if;
  select account_id into v_account from public.estimates where id = new.estimate_id;
  if v_account is null then return new; end if;

  if new.stage = 'in_progress' then
    perform public.crm_emit('job_started', v_account,
      jsonb_build_object('workOrderNo', coalesce(new.wo_ref, new.job_no::text)),
      'system', coalesce(new.stage_entered_at, now()), new.estimate_id, new.id, null, 'job_started:' || new.id);
  elsif new.stage = 'closed' then
    perform public.crm_emit('job_completed', v_account,
      jsonb_build_object('workOrderNo', coalesce(new.wo_ref, new.job_no::text)),
      'system', coalesce(new.end_date::timestamptz, new.stage_entered_at, now()), new.estimate_id, new.id, null, 'job_completed:' || new.id);
  end if;
  return new;
end $$;

drop trigger if exists t_work_orders_crm_lifecycle on public.work_orders;
create trigger t_work_orders_crm_lifecycle
  after update of stage on public.work_orders
  for each row execute function public.work_orders_crm_lifecycle();

-- ---- 5 · invoices -----------------------------------------------------------
create or replace function public.invoices_crm_lifecycle()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_account uuid; v_amount integer := greatest(coalesce(new.total_inc_cents, new.amount_cents, 0), 0);
        v_was_out boolean := tg_op = 'UPDATE' and old.status in ('issued', 'sent', 'viewed', 'partially_paid', 'paid');
begin
  v_account := new.account_id;
  if v_account is null and new.estimate_id is not null then
    select account_id into v_account from public.estimates where id = new.estimate_id;
  end if;
  if v_account is null then return new; end if;

  if new.status in ('issued', 'sent', 'viewed', 'partially_paid', 'paid') and not v_was_out then
    perform public.crm_emit('invoice_sent', v_account,
      jsonb_build_object('invoiceNo', new.number, 'amountCents', v_amount),
      'system', coalesce(new.issued_on::timestamptz, now()), new.estimate_id, new.work_order_id, new.id, 'invoice_sent:' || new.id);
  end if;
  if new.status = 'paid' and (tg_op = 'INSERT' or old.status is distinct from 'paid') then
    perform public.crm_emit('invoice_paid', v_account,
      jsonb_build_object('invoiceNo', new.number, 'amountCents', v_amount),
      'system', now(), new.estimate_id, new.work_order_id, new.id, 'invoice_paid:' || new.id);
  end if;
  return new;
end $$;

drop trigger if exists t_invoices_crm_lifecycle on public.invoices;
create trigger t_invoices_crm_lifecycle
  after insert or update of status, account_id on public.invoices
  for each row execute function public.invoices_crm_lifecycle();

-- ---- 6 · lapsing ------------------------------------------------------------
-- Sent estimates past their valid_until become `expired`. Runs from the daily
-- CRM sweep. The estimate's own event log gets the same status_changed row
-- set_estimate_status writes, with the reason spelled out.
create or replace function public.crm_lapse_estimates(p_today date default current_date)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if not (public.is_staff() or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'crm_lapse_estimates: not permitted' using errcode = '42501';
  end if;
  with lapsed as (
    update public.estimates
       set status = 'expired'
     where status = 'sent' and valid_until is not null and valid_until < p_today
    returning id
  )
  insert into public.estimate_events (estimate_id, type, payload)
  select id, 'status_changed',
         jsonb_build_object('to', 'expired', 'from', 'sent', 'by', null, 'reason', 'lapsed — valid_until passed')
    from lapsed;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.crm_lapse_estimates(date) from public, anon;
grant execute on function public.crm_lapse_estimates(date) to authenticated;

-- ---- 7 · backfill -----------------------------------------------------------
-- History from the rows that exist. Every insert carries the same dedupe key
-- the trigger would have used, so this can run any number of times.
insert into public.crm_events (account_id, estimate_id, type, source, payload, occurred_at, dedupe_key)
select e.account_id, e.id, 'estimate_sent', 'system',
       jsonb_build_object('totalCents', greatest(coalesce(e.total_cents, 0), 0), 'channel', 'link'),
       coalesce(e.sent_at, e.created_at), 'estimate_sent:' || e.id
  from public.estimates e
 where e.account_id is not null and (e.sent_at is not null or e.status in ('sent', 'accepted', 'declined', 'expired'))
on conflict (dedupe_key) where dedupe_key is not null do nothing;

insert into public.crm_events (account_id, estimate_id, type, source, payload, occurred_at, dedupe_key)
select e.account_id, e.id, 'estimate_accepted', 'customer',
       jsonb_build_object('totalCents', greatest(coalesce(e.accepted_total_cents, e.total_cents, 0), 0)),
       coalesce(e.accepted_at, e.updated_at, e.created_at), 'estimate_accepted:' || e.id
  from public.estimates e
 where e.account_id is not null and e.status = 'accepted'
on conflict (dedupe_key) where dedupe_key is not null do nothing;

insert into public.crm_events (account_id, estimate_id, type, source, payload, occurred_at, dedupe_key)
select e.account_id, e.id, 'estimate_declined', 'customer',
       case when nullif(trim(coalesce(e.declined_reason, '')), '') is null then '{}'::jsonb
            else jsonb_build_object('reason', left(e.declined_reason, 2000)) end,
       coalesce(e.declined_at, e.updated_at, e.created_at), 'estimate_declined:' || e.id
  from public.estimates e
 where e.account_id is not null and e.status = 'declined'
on conflict (dedupe_key) where dedupe_key is not null do nothing;

insert into public.crm_events (account_id, estimate_id, type, source, payload, occurred_at, dedupe_key)
select e.account_id, e.id, 'estimate_lapsed', 'system',
       jsonb_build_object('totalCents', greatest(coalesce(e.total_cents, 0), 0), 'sentAt', e.sent_at, 'validUntil', e.valid_until),
       coalesce(e.valid_until::timestamptz, e.updated_at), 'estimate_lapsed:' || e.id
  from public.estimates e
 where e.account_id is not null and e.status = 'expired'
on conflict (dedupe_key) where dedupe_key is not null do nothing;

insert into public.crm_events (account_id, estimate_id, type, source, payload, occurred_at, dedupe_key)
select e.account_id, v.estimate_id, 'estimate_viewed', 'customer',
       jsonb_build_object('viewNumber', row_number() over (partition by v.estimate_id order by v.created_at)),
       v.created_at, 'estimate_viewed:' || v.estimate_id || ':' || v.session_id
  from public.estimate_views v join public.estimates e on e.id = v.estimate_id
 where e.account_id is not null
on conflict (dedupe_key) where dedupe_key is not null do nothing;

insert into public.crm_events (account_id, estimate_id, type, source, payload, occurred_at, dedupe_key)
select e.account_id, e.id, 'estimate_viewed', 'customer', jsonb_build_object('viewNumber', 1),
       e.viewed_at, 'estimate_viewed:' || e.id || ':first'
  from public.estimates e
 where e.account_id is not null and e.viewed_at is not null
   and not exists (select 1 from public.estimate_views v where v.estimate_id = e.id)
on conflict (dedupe_key) where dedupe_key is not null do nothing;

insert into public.crm_events (account_id, estimate_id, work_order_id, type, source, payload, occurred_at, dedupe_key)
select e.account_id, w.estimate_id, w.id, 'job_started', 'system',
       jsonb_build_object('workOrderNo', coalesce(w.wo_ref, w.job_no::text)),
       coalesce(w.start_date::timestamptz, w.stage_entered_at, w.issued_at, w.created_at), 'job_started:' || w.id
  from public.work_orders w join public.estimates e on e.id = w.estimate_id
 where e.account_id is not null and w.stage in ('in_progress', 'qa', 'completion_prep', 'walkthrough', 'closed')
on conflict (dedupe_key) where dedupe_key is not null do nothing;

insert into public.crm_events (account_id, estimate_id, work_order_id, type, source, payload, occurred_at, dedupe_key)
select e.account_id, w.estimate_id, w.id, 'job_completed', 'system',
       jsonb_build_object('workOrderNo', coalesce(w.wo_ref, w.job_no::text)),
       coalesce(w.end_date::timestamptz, w.stage_entered_at, w.created_at), 'job_completed:' || w.id
  from public.work_orders w join public.estimates e on e.id = w.estimate_id
 where e.account_id is not null and w.stage = 'closed'
on conflict (dedupe_key) where dedupe_key is not null do nothing;

insert into public.crm_events (account_id, estimate_id, work_order_id, invoice_id, type, source, payload, occurred_at, dedupe_key)
select coalesce(i.account_id, e.account_id), i.estimate_id, i.work_order_id, i.id, 'invoice_sent', 'system',
       jsonb_build_object('invoiceNo', i.number, 'amountCents', greatest(coalesce(i.total_inc_cents, i.amount_cents, 0), 0)),
       coalesce(i.issued_on::timestamptz, i.created_at), 'invoice_sent:' || i.id
  from public.invoices i left join public.estimates e on e.id = i.estimate_id
 where coalesce(i.account_id, e.account_id) is not null
   and i.status in ('issued', 'sent', 'viewed', 'partially_paid', 'paid')
on conflict (dedupe_key) where dedupe_key is not null do nothing;

insert into public.crm_events (account_id, estimate_id, work_order_id, invoice_id, type, source, payload, occurred_at, dedupe_key)
select coalesce(i.account_id, e.account_id), i.estimate_id, i.work_order_id, i.id, 'invoice_paid', 'system',
       jsonb_build_object('invoiceNo', i.number, 'amountCents', greatest(coalesce(i.total_inc_cents, i.amount_cents, 0), 0)),
       coalesce((select max(p.paid_on)::timestamptz from public.payments p where p.invoice_id = i.id), i.created_at),
       'invoice_paid:' || i.id
  from public.invoices i left join public.estimates e on e.id = i.estimate_id
 where coalesce(i.account_id, e.account_id) is not null and i.status = 'paid'
on conflict (dedupe_key) where dedupe_key is not null do nothing;

-- ---- Read-back --------------------------------------------------------------
select type, count(*) as events
  from public.crm_events
 where type in ('estimate_sent', 'estimate_viewed', 'estimate_accepted', 'estimate_declined', 'estimate_lapsed',
                'job_started', 'job_completed', 'invoice_sent', 'invoice_paid')
 group by type order by type;

select
  (select count(*) from pg_trigger where tgname in ('t_estimates_crm_lifecycle', 't_estimate_views_crm_lifecycle', 't_work_orders_crm_lifecycle', 't_invoices_crm_lifecycle')) = 4 as triggers_ok,
  (select prosecdef from pg_proc where proname = 'crm_emit') as emitter_secdef,
  (select count(*) from pg_proc where proname = 'crm_lapse_estimates') = 1 as lapse_fn_ok,
  (select count(*) from public.estimates where status = 'sent' and valid_until < current_date) as would_lapse_on_first_sweep;
