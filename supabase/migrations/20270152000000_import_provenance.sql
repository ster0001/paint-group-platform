-- =============================================================================
-- Airtable → CRM import · provenance, the key map, historical jobs, and the
-- silent path for already-signed jobs
--
-- docs/briefs/claude-code-brief-airtable-crm-import.md (rev 3, 16 Sep 2026),
-- Tom's rulings R1–R11 and B0.1–B0.5. Everything the two loaders
-- (scripts/import/airtable-crm.ts, scripts/import/paintscout-booked.ts) and
-- the handover door (app/api/inbound/airtable-jobs) need from the database:
--
--   1 · `source` CHECKs learn the imports. `estimates.source` gains
--       'airtable' (history) and 'paintscout' (a signed job with a working
--       scope); `crm_events.source` gains 'airtable_import' so every imported
--       event says where it came from (acceptance 6).
--   2 · provenance columns: `external_ref jsonb` on estimates, accounts and
--       properties (Airtable record id, PaintScout URLs, quote number,
--       date_confidence, level_of_finish_assumed); `source` on accounts and
--       properties. `accounts.company_name` (R1) — the trade-org layer has
--       no company field for a residential account, so it is new here.
--   3 · `crm_import_keys` — the stable key → row map that makes every re-run
--       an update, never a duplicate.
--   4 · `crm_jobs` — historical jobs live in the CRM only (R11): the quote
--       link, dates, invoice total, offer, hours, materials, painter count.
--       Never a work_orders row.
--   5 · the two estimate triggers that would corrupt history learn a
--       transaction-local switch, `crm.import = on` (the same pattern as
--       `crm.merge`): the lifecycle emitter would stamp estimate_accepted at
--       now(); the reopen-lost rule would flip all 300 lost accounts back to
--       active as their first estimate landed (R3 undone by the database).
--   6 · a 'Custom surface (imported)' rate row on each side of the active
--       card. The builder drops any surface whose code matches no rate row
--       from the customer document and the job sheet, so the 41 PaintScout
--       lines that map to nothing (strapping, shingles, picture rails…)
--       would vanish. B1.3's own fallback.
--   7 · tag keys the pack uses (underscore form — the platform's key shape).
--   8 · `import_booked_job(jsonb)` — the ONE write path for a signed
--       PaintScout job: estimate + working scope + silent acceptance + the
--       work order in the Unscheduled tray. Part B's loader and Part C's
--       endpoint both call it, so the sequence exists once.
--
-- Idempotent; read-backs at the end; self-registers in _prod_migrations.
-- =============================================================================

-- ---- 1 · source CHECKs -------------------------------------------------------
alter table public.estimates drop constraint if exists estimates_source_check;
alter table public.estimates add constraint estimates_source_check
  check (source in ('manual', 'ai_floorplan', 'customer_intake', 'wizard', 'trade_wizard', 'airtable', 'paintscout'));

alter table public.crm_events drop constraint if exists crm_events_source_check;
alter table public.crm_events add constraint crm_events_source_check
  check (source in ('system', 'staff', 'customer', 'ai', 'airtable_import'));

-- ---- 2 · provenance columns ---------------------------------------------------
alter table public.estimates add column if not exists external_ref jsonb;
comment on column public.estimates.external_ref is
  'Where an imported estimate came from: { airtable_id, quote_no, quote_url, work_order_url, date_confidence, level_of_finish_assumed, view, … }. Null on platform-built estimates.';
create index if not exists estimates_source_idx on public.estimates (source) where source in ('airtable', 'paintscout');

alter table public.accounts
  add column if not exists source text not null default 'platform'
    constraint accounts_source_check check (source in ('platform', 'airtable', 'paintscout')),
  add column if not exists external_ref jsonb,
  add column if not exists company_name text;
comment on column public.accounts.company_name is
  'R1 (Tom, 16 Sep 2026): the agency or business behind a residential account, e.g. "Kay & Burton", so every agent of one company can be listed together. Free text; null for a private customer.';
comment on column public.accounts.source is
  'platform = created here; airtable = created by the history import; paintscout = created by the signed-jobs import.';
create index if not exists accounts_company_idx on public.accounts (lower(company_name)) where company_name is not null;

alter table public.properties
  add column if not exists source text not null default 'platform'
    constraint properties_source_check check (source in ('platform', 'airtable', 'paintscout')),
  add column if not exists external_ref jsonb;

-- ---- 3 · the key map ----------------------------------------------------------
create table if not exists public.crm_import_keys (
  import      text not null,
  key         text not null,
  table_name  text not null,
  row_id      uuid not null,
  created_at  timestamptz not null default now(),
  primary key (import, key)
);
comment on table public.crm_import_keys is
  'Stable import key (acc_…, prop_…, est_…, job_…, bk_…) → the row it became. A re-run of a loader finds its rows here and updates them; a purge deletes by it.';
create index if not exists crm_import_keys_row_idx on public.crm_import_keys (table_name, row_id);
alter table public.crm_import_keys enable row level security;
drop policy if exists crm_import_keys_staff_select on public.crm_import_keys;
create policy crm_import_keys_staff_select on public.crm_import_keys
  for select to authenticated using ((select public.is_staff()));
revoke insert, update, delete on public.crm_import_keys from authenticated, anon;

-- ---- 4 · historical jobs -------------------------------------------------------
create table if not exists public.crm_jobs (
  id                          uuid primary key default gen_random_uuid(),
  tenant_id                   uuid not null references public.tenants (id) default public.current_tenant(),
  account_id                  uuid not null references public.accounts (id) on delete cascade,
  estimate_id                 uuid references public.estimates (id) on delete set null,
  property_id                 uuid references public.properties (id) on delete set null,
  quote_url                   text,
  work_order_url              text,
  quote_number                text,
  project_name                text,
  job_type                    text,
  level_of_finish             smallint,
  status                      text not null
    constraint crm_jobs_status_check
    check (status in ('completed', 'in_progress', 'scheduled', 'accepted_unscheduled', 'cancelled', 'on_hold')),
  accepted_at                 timestamptz,
  start_date                  date,
  end_date                    date,
  invoice_total_cents         integer check (invoice_total_cents is null or invoice_total_cents >= 0),
  gst_cents                   integer check (gst_cents is null or gst_cents >= 0),
  estimated_hours             numeric(8,2) check (estimated_hours is null or estimated_hours >= 0),
  actual_hours                numeric(8,2) check (actual_hours is null or actual_hours >= 0),
  estimated_materials_cents   integer check (estimated_materials_cents is null or estimated_materials_cents >= 0),
  actual_materials_cents      integer check (actual_materials_cents is null or actual_materials_cents >= 0),
  contractor_offer_cents      integer check (contractor_offer_cents is null or contractor_offer_cents >= 0),
  contractor_invoiced_cents   integer check (contractor_invoiced_cents is null or contractor_invoiced_cents >= 0),
  workers                     smallint check (workers is null or workers >= 0),
  notes                       text,
  source                      text not null default 'airtable'
    constraint crm_jobs_source_check check (source in ('airtable')),
  external_ref                jsonb,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);
comment on table public.crm_jobs is
  'R11: a job that happened before the platform — the Airtable Projects row with its PaintScout links. Shown on the customer record; never a work_orders row. Actual hours and materials live HERE because job_costs/material_costs key on work_orders.';
create index if not exists crm_jobs_account_idx on public.crm_jobs (account_id, start_date desc nulls last);
create index if not exists crm_jobs_estimate_idx on public.crm_jobs (estimate_id) where estimate_id is not null;
create index if not exists crm_jobs_property_idx on public.crm_jobs (property_id) where property_id is not null;
drop trigger if exists t_crm_jobs_updated on public.crm_jobs;
create trigger t_crm_jobs_updated before update on public.crm_jobs
  for each row execute function public.set_updated_at();
alter table public.crm_jobs enable row level security;
drop policy if exists crm_jobs_staff on public.crm_jobs;
create policy crm_jobs_staff on public.crm_jobs
  for all to authenticated
  using ((select public.is_staff()) and tenant_id = (select public.current_tenant()))
  with check ((select public.is_staff()) and tenant_id = (select public.current_tenant()));
-- The customer sees their own history in the portal through the service
-- client (lib/portal/data.ts pattern) — no member policy is needed here.

-- ---- 5 · the import switch on the two estimate triggers ----------------------------
-- Bodies are 20270121 §2 and 20270125 §4 verbatim, plus the first line.
create or replace function public.estimates_crm_lifecycle()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_fresh boolean := (tg_op = 'INSERT') or (old.account_id is null);
        v_total integer := coalesce(new.accepted_total_cents, new.total_cents, 0);
begin
  -- Import (20270152): the loader writes the historical events itself, with
  -- their real dates. Nothing here may stamp now() on a 2025 acceptance.
  if current_setting('crm.import', true) = 'on' then return new; end if;
  if new.account_id is null then return new; end if;

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

  if new.viewed_at is not null and (v_fresh or old.viewed_at is null)
     and not exists (select 1 from public.estimate_views v where v.estimate_id = new.id) then
    perform public.crm_emit('estimate_viewed', new.account_id,
      jsonb_build_object('viewNumber', 1),
      'customer', new.viewed_at, new.id, null, null, 'estimate_viewed:' || new.id || ':first');
  end if;

  return new;
end $$;

create or replace function public.estimates_reopen_lost()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Import (20270152): a lost customer's OLD estimates arriving is not the
  -- customer starting again. R3 stands.
  if current_setting('crm.import', true) = 'on' then return new; end if;
  if new.account_id is null then return new; end if;
  update public.accounts
     set relationship_state = 'active', lost_reason = null, state_reason = 'new estimate', state_set_at = now()
   where id = new.account_id and relationship_state = 'lost';
  if found then
    perform public.crm_emit('state_set', new.account_id,
      jsonb_build_object('state', 'active', 'previous', 'lost', 'reason', 'new estimate'),
      'system', now(), new.id, null, null, 'reopen:' || new.id);
  end if;
  return new;
end $$;

-- The identity mirror on the facts row learns the company name, so
-- "Kay & Burton" finds all thirty agents in the Customers search.
create or replace function public.accounts_touch_facts()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.crm_account_facts (account_id, stale, name, email, phone, account_type, temperature, owner_id, snoozed_until, next_followup_at, search,
                                        relationship_state, state_until, state_note, lost_reason, tags, permit_email, permit_sms, permit_phone)
  values (new.id, true, new.name, new.email, new.phone, new.account_type, new.temperature, new.owner_id, new.snoozed_until, new.followup_due_at,
          lower(concat_ws(' ', new.name, new.email, new.phone, regexp_replace(coalesce(new.phone, ''), '\s+', '', 'g'), new.phone_e164, new.company_name)),
          new.relationship_state, new.state_until, new.state_note, new.lost_reason, new.tags, new.permit_email, new.permit_sms, new.permit_phone)
  on conflict (account_id) do update set
    stale = true, name = excluded.name, email = excluded.email, phone = excluded.phone, account_type = excluded.account_type,
    temperature = excluded.temperature, owner_id = excluded.owner_id, snoozed_until = excluded.snoozed_until, next_followup_at = excluded.next_followup_at,
    relationship_state = excluded.relationship_state, state_until = excluded.state_until, state_note = excluded.state_note, lost_reason = excluded.lost_reason,
    tags = excluded.tags, permit_email = excluded.permit_email, permit_sms = excluded.permit_sms, permit_phone = excluded.permit_phone,
    search = case when crm_account_facts.refreshed_at is null then excluded.search else crm_account_facts.search end;
  return new;
end $$;
drop trigger if exists t_accounts_touch_facts on public.accounts;
create trigger t_accounts_touch_facts
  after insert or update of name, email, phone, account_type, temperature, snoozed_until, followup_due_at, owner_id,
    relationship_state, state_until, state_note, lost_reason, tags, permit_email, permit_sms, permit_phone, company_name on public.accounts
  for each row execute function public.accounts_touch_facts();

-- ---- 6 · the custom surface row ------------------------------------------------------
-- One hour per item at the side's charge-out. Every imported line that uses it
-- carries its own hours and price as overrides, so this row never prices a
-- cent on its own unless somebody clears the override on purpose.
insert into public.rate_items
  (rate_card_id, code, category, sub_category, unit, rate_1_coat, rate_2_coat, rate_3_coat, default_coats, charge_out_cents)
select c.id, 'Custom surface (imported)', side.category, 'Imported', 'Hours Per Item', 1, 1, 1, 1,
       (select r.charge_out_cents from public.rate_items r
         where r.rate_card_id = c.id and r.category = side.category
           and not (coalesce(r.sub_category, '') ilike '%extras%' or coalesce(r.sub_category, '') ilike '%allowances%')
         order by r.created_at limit 1)
  from public.rate_cards c
  cross join (values ('Interior'), ('Exterior')) as side (category)
 where c.is_active = true
   and not exists (
     select 1 from public.rate_items t
      where t.rate_card_id = c.id and t.category = side.category and t.code = 'Custom surface (imported)');

-- ---- 7 · tags -------------------------------------------------------------------------
insert into public.crm_tags (key, label, sort_order) values
  ('airtable_import', 'Imported from Airtable', 90),
  ('agency', 'Agency', 42),
  ('kay_and_burton', 'Kay & Burton', 44),
  ('commercial', 'Commercial', 46)
on conflict (key) do nothing;

-- ---- 8 · the one write path for a signed PaintScout job ----------------------------------
-- Service role only (the loader and the inbound door). Everything the brief's
-- B1.2–B1.6 and B1.8 say, in one transaction, under the import switch:
--   · the estimate row (source 'paintscout', builder_state = the working
--     scope, sent_snapshot = the customer document, accepted by hand),
--   · estimate_events office_accept_notified + the customer_accepted_welcome
--     claim, BEFORE the status is accepted, so no sweep ever sends a word,
--   · the one estimate_accepted crm_event with the historical date,
--   · the work order: issued, pre_start, no contractor, no date — the tray,
--   · the Airtable plan as a booking note — the staff-only chase log the
--     tray card shows. NOT access_notes: those print on the contractor's job
--     sheet, and "send the offer to Jacob" is the office's business.
-- Idempotent on (p->>'import', p->>'key'): a second call with the same key
-- writes nothing and answers {status:'exists'}, unless p.update_note is true
-- (the handover door), when only the tray note is refreshed.
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

  insert into public.work_orders
    (estimate_id, wo_ref, status, stage, stage_entered_at, issued_at, contractor_id, start_date, end_date,
     contractor_payment_cents, share_token, wo_snapshot, access_notes)
  values
    (v_est, p->>'wo_ref', 'issued', 'pre_start', v_accepted, v_accepted, null, null, null,
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

-- ---- Read-back: read this, don't assume it ----------------------------------------------
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'estimates' and column_name = 'external_ref') = 1 as estimates_external_ref,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'accounts' and column_name in ('source', 'external_ref', 'company_name')) = 3 as account_columns,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'properties' and column_name in ('source', 'external_ref')) = 2 as property_columns,
  (select pg_get_constraintdef(oid) from pg_constraint where conname = 'estimates_source_check') like '%paintscout%' as estimates_source_widened,
  (select pg_get_constraintdef(oid) from pg_constraint where conname = 'crm_events_source_check') like '%airtable_import%' as events_source_widened,
  (select relrowsecurity from pg_class where oid = 'public.crm_import_keys'::regclass) as import_keys_rls,
  (select relrowsecurity from pg_class where oid = 'public.crm_jobs'::regclass) as crm_jobs_rls,
  (select count(*) from pg_policies where tablename in ('crm_import_keys', 'crm_jobs')) as import_policies,
  (select prosrc like '%crm.import%' from pg_proc where proname = 'estimates_crm_lifecycle') as lifecycle_has_switch,
  (select prosrc like '%crm.import%' from pg_proc where proname = 'estimates_reopen_lost') as reopen_has_switch,
  (select count(*) from public.rate_items ri join public.rate_cards rc on rc.id = ri.rate_card_id where rc.is_active and ri.code = 'Custom surface (imported)') as custom_rate_rows,
  (select count(*) from public.crm_tags where key in ('airtable_import', 'agency', 'kay_and_burton', 'commercial', 'real_estate')) = 5 as tags_seeded,
  (select count(*) from pg_proc where proname = 'import_booked_job') = 1 as import_fn_ok;

insert into public._prod_migrations(name) values ('20270152000000_import_provenance.sql') on conflict (name) do nothing;
