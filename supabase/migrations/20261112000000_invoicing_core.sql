-- =====================================================================
-- Invoicing & Payments · Step 1 — ledger, schema, state machine.
-- Brief: docs/briefs/claude-code-brief-invoicing-payments.md (§3, §4, §8 Step 1)
--
-- REQUIRES 20261111000000_invoice_status_enum.sql to have run FIRST
-- (new invoice_status values cannot be used in the transaction that adds them).
--
-- What this file does, in order:
--   1.  new enums, sequences, settings seeds, small helpers
--   2.  estimates.accepted_total_cents (the immutable ledger anchor)
--       + wo_variations.credit (approved credit/descope variations)
--   3.  invoices — §3.1 columns, backfill of the 3 live rows, constraints
--   4.  invoice_lines (+ the variation single-billing unique index)
--   5.  the §3.2 transition matrix table + DB-level guard triggers
--       (issued invoices are immutable AT THE DATABASE, not by convention)
--   6.  payments extensions, credit_notes, stripe_events, invoice_events,
--       contractor_invoices, vendors, job_costs, material_costs, contractors+
--   7.  RLS for every new table (staff-only; contractor sees own CI rows;
--       customers reach invoices only through token RPCs — Step 3)
--   8.  the ledger function (ONE computation of adjusted_contract) + GST rules
--   9.  state-machine RPCs (issue / send / viewed / record payment / void /
--       write off / extend due / delete draft / request payment / final draft)
--   10. accept_estimate now drafts the DEPOSIT invoice in-transaction;
--       wo_sign + wo_close_without_walkthrough draft the FINAL invoice
--       (replacing the $0 stub); wo_reopen_signoff drops the final draft.
--
-- Function bodies in §10 are copied VERBATIM from their newest migrations
-- (20261026 accept_estimate · 20261028 wo_sign · 20261110 close-without ·
-- 20261108 reopen) with ONLY the invoice-stub sites changed — the
-- "always copy from the newest migration" rule.
--
-- All money integer cents. Ex-GST and GST stored separately on invoices.
-- Nothing here deletes or rewrites existing invoice rows (§0.1) — the three
-- live rows are backfilled in place (kind/token/totals) and keep their ids.
-- =====================================================================

-- ======================================================================
-- 1. Enums, sequences, settings, helpers
-- ======================================================================

do $$ begin
  create type public.invoice_kind as enum
    ('deposit', 'progress', 'final', 'variation', 'standalone');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.payment_status as enum
    ('pending', 'succeeded', 'failed', 'refunded');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.ci_status as enum
    ('draft', 'submitted', 'approved', 'paid');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.job_cost_category as enum
    ('scaffold', 'render', 'carpentry', 'rubbish', 'equipment_hire',
     'permit', 'traffic_mgmt', 'other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.job_cost_status as enum
    ('recorded', 'approved', 'paid');
exception when duplicate_object then null; end $$;

-- ⚑13 numbering: 4-digit sequences, allocated AT ISSUE (drafts unnumbered).
-- To align with the live PaintScout sequence, Tom runs e.g.
--   select setval('public.invoice_no_seq', 152);   -- next issue → INV-0153
create sequence if not exists public.invoice_no_seq;
create sequence if not exists public.receipt_no_seq;
create sequence if not exists public.credit_note_no_seq;
create sequence if not exists public.remittance_no_seq;

-- Every §2 decision is a Settings value with the brief's default.
-- on conflict do nothing: Tom's later edits always survive a re-run.
insert into public.settings (key, value) values
  ('invoicing', jsonb_build_object(
    'depositPct', 10,                          -- ⚑1 (snapshot depositPct wins per job)
    'depositCapWarn', true,                    -- ⚑2 amber warn, never silently re-price
    'paymentTermsDays', 7,                     -- ⚑3
    'finalTermsDays', 7,                       -- ⚑3 final = sign-off day + 7
    'surchargePctBps', 170,                    -- ⚑4 1.70% in basis points
    'surchargeFixedCents', 30,                 -- ⚑4
    'surchargeGstInclusive', true,             -- ⚑5 confirm with accountant
    'variationInvoicing', 'fold_into_final',   -- ⚑6 (standalone allowed any time)
    'allowStartUnpaidDeposit', true,           -- ⚑7
    'depositUnpaidWarnDays', 3,                -- ⚑7 N
    'contractorTermsDays', 7,                  -- ⚑8 from wo_signoff.signed_at
    'gstRatePct', 10,
    'numbering', jsonb_build_object(
      'invoice', 'INV-', 'receipt', 'RCT-', 'credit', 'CN-', 'remittance', 'REM-')
  )),
  -- ⚑11 seeded from today's PaintScout header. legalLine stays empty until the
  -- accountant rules on ENLVN Pty Ltd. The Elsternwick-3205 P&L error must
  -- never end up here.
  ('invoicing_entity', jsonb_build_object(
    'tradingName', 'Paint Group',
    'brandSub', 'Painting · Plastering · Restoration',
    'address', '25/25-35 Bunney Road, Oakleigh South VIC 3167',
    'abn', '41 639 780 108',
    'legalLine', ''
  )),
  -- ⚑12 account in ENLVN Pty Ltd's name at Commonwealth Bank. BSB/ACC are
  -- deliberately BLANK — Tom copies them from the live PaintScout invoice
  -- header in Settings; this file will not invent bank details.
  ('invoicing_bank', jsonb_build_object(
    'accountName', 'ENLVN Pty Ltd',
    'bank', 'Commonwealth Bank',
    'bsb', '', 'acc', '',
    'referenceRule', 'invoice number'
  )),
  -- ⚑18 chart-of-accounts codes come from the bookkeeper before Step 7.
  ('invoicing_myob', jsonb_build_object('accounts', jsonb_build_object()))
on conflict (key) do nothing;

create or replace function public.invoice_setting_text(p_path text[])
returns text language sql stable as
$$ select value #>> p_path from public.settings where key = 'invoicing' $$;

create or replace function public.invoice_setting_num(p_path text[], p_default numeric)
returns numeric language sql stable as
$$ select coalesce((select nullif(value #>> p_path, '') from public.settings
                     where key = 'invoicing')::numeric, p_default) $$;

-- ⚑14 GST — ONE rounding rule, mirrored exactly by lib/invoicing/gst.ts.
-- Two derivations, chosen by what the invoice promises:
--   · ex-line built (variation/standalone): GST once on the summed ex subtotal
--   · inc-anchored (deposit/progress/final — the promise is an inc-GST figure):
--     GST is the anchored total's tax component; subtotal = total − GST.
-- round(numeric) in Postgres is half-away-from-zero == half-up for positives,
-- and gst.ts pins the same behaviour.
create or replace function public.gst_on_ex_cents(p_ex bigint, p_rate numeric default 10)
returns integer language sql immutable as
$$ select round(p_ex * p_rate / 100)::integer $$;

create or replace function public.gst_from_inc_cents(p_inc bigint, p_rate numeric default 10)
returns integer language sql immutable as
$$ select round(p_inc * p_rate / (100 + p_rate))::integer $$;

create or replace function public.invoice_new_token()
returns text language sql volatile as
$$ select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '') $$;

create or replace function public.invoice_allocate_number()
returns text language sql volatile as
$$ select coalesce(public.invoice_setting_text('{numbering,invoice}'), 'INV-')
          || lpad(nextval('public.invoice_no_seq')::text, 4, '0') $$;

create or replace function public.receipt_allocate_number()
returns text language sql volatile as
$$ select coalesce(public.invoice_setting_text('{numbering,receipt}'), 'RCT-')
          || lpad(nextval('public.receipt_no_seq')::text, 4, '0') $$;

create or replace function public.invoice_strip_html(p text)
returns text language sql immutable as
$$ select trim(regexp_replace(regexp_replace(coalesce(p, ''), '<[^>]*>', ' ', 'g'),
                              '\s+', ' ', 'g')) $$;

-- "10" not "10.0" (and never "1" — a bare trailing-zero trim eats whole tens).
create or replace function public.invoice_pct_text(p numeric)
returns text language sql immutable as
$$ select case when p = round(p) then round(p)::integer::text
               else trim(trailing '.' from trim(trailing '0' from p::text)) end $$;

-- ======================================================================
-- 2. The ledger anchors
-- ======================================================================

-- The estimate is locked after acceptance, but the ledger deserves its own
-- immutable anchor: what the customer accepted, written once by
-- accept_estimate and never touched again.
alter table public.estimates
  add column if not exists accepted_total_cents integer;

-- Approved credit/descope variations subtract from the adjusted contract
-- (§3). price_cents stays ≥ 0; `credit` flips its sign in the ledger.
alter table public.wo_variations
  add column if not exists credit boolean not null default false;

-- ======================================================================
-- 3. invoices — §3.1 columns + backfill + constraints
-- ======================================================================

alter table public.invoices
  add column if not exists work_order_id     uuid references public.work_orders (id) on delete set null,
  add column if not exists kind              public.invoice_kind,
  add column if not exists number            text,
  add column if not exists subtotal_ex_cents integer not null default 0,
  add column if not exists gst_cents         integer not null default 0,
  add column if not exists total_inc_cents   integer not null default 0,
  add column if not exists pdf_path          text,
  add column if not exists token             text,
  add column if not exists voided_reason     text not null default '',
  add column if not exists written_off_reason text not null default '',
  add column if not exists created_by        uuid references auth.users (id) on delete set null;

-- Backfill the live rows in place (§0.1: no retroactive rewrites — the S1
-- list's own rule "amount 0 = the sign-off stub" classifies them):
update public.invoices
   set kind = case when amount_cents = 0 then 'final'::public.invoice_kind
                   else 'deposit'::public.invoice_kind end
 where kind is null;

update public.invoices
   set total_inc_cents = amount_cents,
       gst_cents = public.gst_from_inc_cents(amount_cents::bigint,
                     public.invoice_setting_num('{gstRatePct}', 10)),
       subtotal_ex_cents = amount_cents - public.gst_from_inc_cents(amount_cents::bigint,
                     public.invoice_setting_num('{gstRatePct}', 10))
 where total_inc_cents = 0 and amount_cents <> 0;

update public.invoices set token = public.invoice_new_token() where token is null;

-- work_order_id backfill: every estimate has at most one WO.
update public.invoices i
   set work_order_id = w.id
  from public.work_orders w
 where w.estimate_id = i.estimate_id and i.work_order_id is null;

alter table public.invoices alter column kind set not null;
alter table public.invoices alter column token set not null;

do $$ begin
  alter table public.invoices add constraint invoices_number_key unique (number);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.invoices add constraint invoices_token_key unique (token);
exception when duplicate_object then null; end $$;

-- Drafts are unnumbered; everything else carries its number forever
-- (void burns the number — never reused).
do $$ begin
  alter table public.invoices add constraint invoices_draft_unnumbered
    check ((status = 'draft') = (number is null));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.invoices add constraint invoices_totals_agree
    check (total_inc_cents = subtotal_ex_cents + gst_cents);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.invoices add constraint invoices_amounts_positive
    check (total_inc_cents >= 0 and amount_cents >= 0);
exception when duplicate_object then null; end $$;

create index if not exists invoices_estimate_idx on public.invoices (estimate_id);
create index if not exists invoices_status_idx   on public.invoices (status);
create index if not exists invoices_wo_idx       on public.invoices (work_order_id);
-- The chase/overdue sweep and dashboard read open invoices by due date.
create index if not exists invoices_open_due_idx on public.invoices (due_on)
  where status in ('issued', 'sent', 'viewed', 'partially_paid');

-- ======================================================================
-- 4. invoice_lines
-- ======================================================================

create table if not exists public.invoice_lines (
  id              uuid primary key default gen_random_uuid(),
  invoice_id      uuid not null references public.invoices (id) on delete cascade,
  sort            integer not null default 0,
  source          text not null check (source in
                    ('estimate_snapshot', 'variation', 'manual', 'adjustment')),
  source_ref      text,          -- snapshot area id, wo_variations.id, …
  description     text not null default '',
  qty             numeric(10,2),
  unit            text not null default '',
  amount_ex_cents integer not null default 0,
  gst_cents       integer not null default 0,   -- per-invoice rule governs; kept per §3.1
  -- Mirror of the parent's void state, maintained by trigger, so the
  -- single-billing index below can be a plain partial unique index.
  parent_void     boolean not null default false,
  created_at      timestamptz not null default now()
);
create index if not exists invoice_lines_invoice_idx on public.invoice_lines (invoice_id, sort);

-- §3.1: a variation may appear on at most ONE non-void invoice.
-- Double-billing is a database error, not a code-review hope.
create unique index if not exists invoice_lines_variation_once
  on public.invoice_lines (source_ref)
  where source = 'variation' and not parent_void;

-- ======================================================================
-- 5. §3.2 transition matrix + guards — the DB is the last line of defence
-- ======================================================================

create table if not exists public.invoice_transitions (
  from_status public.invoice_status not null,
  to_status   public.invoice_status not null,
  primary key (from_status, to_status)
);

-- Canonical seed — full delete + reseed (the 20261030 pattern).
-- lib/invoicing/stateMachine.ts mirrors this list and a Vitest contract test
-- diffs the two, the same way stages.test.ts pins the WO matrix.
delete from public.invoice_transitions;
insert into public.invoice_transitions (from_status, to_status) values
  ('draft'::public.invoice_status,          'issued'::public.invoice_status),
  ('issued'::public.invoice_status,         'sent'::public.invoice_status),
  ('sent'::public.invoice_status,           'viewed'::public.invoice_status),
  ('issued'::public.invoice_status,         'partially_paid'::public.invoice_status),
  ('sent'::public.invoice_status,           'partially_paid'::public.invoice_status),
  ('viewed'::public.invoice_status,         'partially_paid'::public.invoice_status),
  ('issued'::public.invoice_status,         'paid'::public.invoice_status),
  ('sent'::public.invoice_status,           'paid'::public.invoice_status),
  ('viewed'::public.invoice_status,         'paid'::public.invoice_status),
  ('partially_paid'::public.invoice_status, 'paid'::public.invoice_status),
  ('issued'::public.invoice_status,         'void'::public.invoice_status),
  ('sent'::public.invoice_status,           'void'::public.invoice_status),
  ('viewed'::public.invoice_status,         'void'::public.invoice_status),
  ('partially_paid'::public.invoice_status, 'void'::public.invoice_status),
  ('issued'::public.invoice_status,         'written_off'::public.invoice_status),
  ('sent'::public.invoice_status,           'written_off'::public.invoice_status),
  ('viewed'::public.invoice_status,         'written_off'::public.invoice_status),
  ('partially_paid'::public.invoice_status, 'written_off'::public.invoice_status);
-- Deliberately absent: paid → void (correction path for a paid invoice is a
-- credit note, §6.8); anything → draft; draft → anything but issued.
-- Draft deletion is DELETE, not a status.

create or replace function public.invoice_guard_update()
returns trigger language plpgsql as $$
begin
  -- Status moves obey the matrix — for EVERY writer, RPCs included.
  if old.status is distinct from new.status then
    if not exists (select 1 from public.invoice_transitions t
                    where t.from_status = old.status and t.to_status = new.status) then
      raise exception 'invoice_illegal_transition: % -> %', old.status, new.status;
    end if;
  end if;

  -- §3.2: issued invoices are immutable. Amounts wrong after issue =
  -- void + reissue, or credit note. due_on may move (payment-terms
  -- extension, an event-logged staff action); pdf_path may be set once.
  if old.status <> 'draft' then
    if new.subtotal_ex_cents is distinct from old.subtotal_ex_cents
       or new.gst_cents        is distinct from old.gst_cents
       or new.total_inc_cents  is distinct from old.total_inc_cents
       or new.amount_cents     is distinct from old.amount_cents
       or new.number           is distinct from old.number
       or new.kind             is distinct from old.kind
       or new.estimate_id      is distinct from old.estimate_id
       or new.work_order_id    is distinct from old.work_order_id
       or new.issued_on        is distinct from old.issued_on
       or new.token            is distinct from old.token then
      raise exception 'invoice_immutable_after_issue';
    end if;
    if old.pdf_path is not null and new.pdf_path is distinct from old.pdf_path then
      raise exception 'invoice_pdf_immutable';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists t_invoice_guard_update on public.invoices;
create trigger t_invoice_guard_update
  before update on public.invoices
  for each row execute function public.invoice_guard_update();

create or replace function public.invoice_guard_delete()
returns trigger language plpgsql as $$
begin
  -- service_role is the one exception: e2e fixtures and admin repairs clean
  -- up whole test estimates with the service key (the A2 RESTRICT ordering).
  -- Every app path — staff, customer, contractor, and every SECURITY DEFINER
  -- RPC (which runs as the function owner, not service_role) — stays blocked.
  if old.status <> 'draft' and current_user <> 'service_role' then
    raise exception 'invoice_undeletable: only drafts may be deleted';
  end if;
  return old;
end $$;

drop trigger if exists t_invoice_guard_delete on public.invoices;
create trigger t_invoice_guard_delete
  before delete on public.invoices
  for each row execute function public.invoice_guard_delete();

-- Lines are editable exactly while their invoice is a draft. The one
-- post-issue write allowed is the parent_void mirror flip.
create or replace function public.invoice_lines_guard()
returns trigger language plpgsql as $$
declare v_status public.invoice_status; v_id uuid;
begin
  -- OLD/NEW are only assigned for the ops that have them — never touch OLD
  -- in an INSERT branch or NEW in a DELETE branch.
  if tg_op = 'UPDATE' then
    if new.parent_void is distinct from old.parent_void
       and new.id = old.id
       and new.invoice_id = old.invoice_id
       and new.sort = old.sort
       and new.source = old.source
       and new.source_ref is not distinct from old.source_ref
       and new.description = old.description
       and new.qty is not distinct from old.qty
       and new.unit = old.unit
       and new.amount_ex_cents = old.amount_ex_cents
       and new.gst_cents = old.gst_cents then
      return new;   -- the void-mirror flip
    end if;
    v_id := new.invoice_id;
  elsif tg_op = 'INSERT' then
    v_id := new.invoice_id;
  else
    v_id := old.invoice_id;
  end if;

  select status into v_status from public.invoices where id = v_id;
  -- A cascade delete reaches the lines AFTER the parent row is gone; the
  -- parent's own delete guard has already ruled on that delete, so a missing
  -- parent means "allowed cascade in flight", not "locked".
  if v_status is not null
     and v_status <> 'draft'
     and current_user <> 'service_role' then
    raise exception 'invoice_lines_locked: invoice is %', v_status;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists t_invoice_lines_guard on public.invoice_lines;
create trigger t_invoice_lines_guard
  before insert or update or delete on public.invoice_lines
  for each row execute function public.invoice_lines_guard();

-- Void frees the variations the invoice was billing.
create or replace function public.invoice_void_mirror()
returns trigger language plpgsql as $$
begin
  if new.status = 'void' and old.status is distinct from 'void' then
    update public.invoice_lines set parent_void = true
     where invoice_id = new.id and not parent_void;
  end if;
  return new;
end $$;

drop trigger if exists t_invoice_void_mirror on public.invoices;
create trigger t_invoice_void_mirror
  after update on public.invoices
  for each row execute function public.invoice_void_mirror();

-- ======================================================================
-- 6. payments + the rest of the §3.1 model
-- ======================================================================

alter table public.payments
  add column if not exists surcharge_cents          integer not null default 0,
  add column if not exists stripe_fee_cents         integer,
  add column if not exists stripe_payment_intent_id text,
  add column if not exists status                   public.payment_status not null default 'succeeded',
  add column if not exists received_at              timestamptz,
  add column if not exists recorded_by              uuid references auth.users (id) on delete set null,
  add column if not exists reference                text not null default '',
  add column if not exists receipt_number           text,
  add column if not exists receipt_pdf_path         text;

do $$ begin
  alter table public.payments add constraint payments_intent_key unique (stripe_payment_intent_id);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.payments add constraint payments_method_check
    check (method in ('stripe_card', 'bank_transfer', 'cash', 'other')) not valid;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.payments add constraint payments_amount_positive
    check (amount_cents > 0) not valid;
exception when duplicate_object then null; end $$;

create table if not exists public.credit_notes (
  id                uuid primary key default gen_random_uuid(),
  invoice_id        uuid not null references public.invoices (id) on delete restrict,
  number            text unique,
  reason            text not null,
  lines             jsonb not null default '[]',
  subtotal_ex_cents integer not null default 0,
  gst_cents         integer not null default 0,
  total_inc_cents   integer not null default 0,
  pdf_path          text,
  created_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  constraint credit_notes_totals_agree check (total_inc_cents = subtotal_ex_cents + gst_cents)
);
create index if not exists credit_notes_invoice_idx on public.credit_notes (invoice_id);

-- The Stripe idempotency ledger: insert-or-skip BEFORE processing (§5.2).
create table if not exists public.stripe_events (
  id           uuid primary key default gen_random_uuid(),
  event_id     text not null unique,
  type         text not null,
  payload      jsonb not null default '{}',
  processed_at timestamptz,
  created_at   timestamptz not null default now()
);

-- Chase ladder, activity feed and console cards all read from events —
-- same pattern as wo_events.
create table if not exists public.invoice_events (
  id         uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  type       text not null,   -- drafted|issued|sent|viewed|payment_received|
                              -- nudge_sent|extension|voided|written_off|
                              -- exported|amended|payment_refunded
  actor      uuid references auth.users (id) on delete set null,
  actor_kind text not null default 'system',   -- staff | customer | system
  meta       jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists invoice_events_invoice_idx on public.invoice_events (invoice_id, created_at desc);
create index if not exists invoice_events_recent_idx  on public.invoice_events (created_at desc);

-- §6.3 — platform-drafted contractor invoice; the portal flow lands Step 5.
create table if not exists public.contractor_invoices (
  id                    uuid primary key default gen_random_uuid(),
  work_order_id         uuid not null references public.work_orders (id) on delete restrict,
  contractor_id         uuid not null references public.contractors (id) on delete restrict,
  auto_draft_source     text not null default 'signoff',
  offer_cents           integer not null default 0,
  variation_delta_cents integer not null default 0,
  deduction_lines       jsonb not null default '[]',   -- ⚑10 never automatic
  subtotal_ex_cents     integer not null default 0,
  gst_cents             integer not null default 0,    -- 0 unless gst_registered
  total_inc_cents       integer not null default 0,
  status                public.ci_status not null default 'draft',
  submitted_at          timestamptz,
  approved_at           timestamptz,
  approved_by           uuid references auth.users (id) on delete set null,
  paid_at               timestamptz,
  bank_reference        text not null default '',
  remittance_number     text,
  remittance_pdf_path   text,
  rcti                  boolean not null default false,   -- ⚑9
  created_at            timestamptz not null default now()
);
create index if not exists contractor_invoices_wo_idx on public.contractor_invoices (work_order_id);
create index if not exists contractor_invoices_contractor_idx on public.contractor_invoices (contractor_id, status);

alter table public.contractors
  add column if not exists gst_registered boolean not null default false,
  add column if not exists rcti_agreement_signed_at timestamptz;

-- §6.4 off-platform trades
create table if not exists public.vendors (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  abn              text not null default '',
  gst_registered   boolean not null default true,
  default_category public.job_cost_category not null default 'other',
  created_at       timestamptz not null default now()
);

create table if not exists public.job_costs (
  id                uuid primary key default gen_random_uuid(),
  work_order_id     uuid not null references public.work_orders (id) on delete restrict,
  vendor_id         uuid references public.vendors (id) on delete set null,
  category          public.job_cost_category not null default 'other',
  description       text not null default '',
  amount_ex_cents   integer not null default 0,
  gst_cents         integer not null default 0,
  doc_path          text,                     -- photo/PDF of their invoice
  estimate_line_ref text,                     -- pass-through line it was estimated against
  status            public.job_cost_status not null default 'recorded',
  paid_at           timestamptz,
  recorded_by       uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now()
);
create index if not exists job_costs_wo_idx on public.job_costs (work_order_id, status);

-- §6.5 materials actuals — Airtable sync in v1; null work_order_id = the
-- unmatched queue.
create table if not exists public.material_costs (
  id                 uuid primary key default gen_random_uuid(),
  work_order_id      uuid references public.work_orders (id) on delete set null,
  supplier           text not null default '',
  brand              text not null default '',
  order_ref          text not null default '',
  address_text       text not null default '',
  amount_cents       integer not null default 0,
  invoice_date       date,
  source             text not null default 'manual'
                     check (source in ('airtable', 'email', 'manual')),
  airtable_record_id text unique,             -- idempotent sync
  matched_by         text check (matched_by in ('auto', 'manual')),
  matched_at         timestamptz,
  created_at         timestamptz not null default now()
);
create index if not exists material_costs_wo_idx on public.material_costs (work_order_id);
create index if not exists material_costs_unmatched_idx on public.material_costs (created_at desc)
  where work_order_id is null;

-- ======================================================================
-- 7. RLS — every table, in the same file (house law)
-- ======================================================================

do $$
declare t text;
begin
  foreach t in array array['invoice_lines', 'invoice_events', 'credit_notes',
                           'stripe_events', 'vendors', 'job_costs',
                           'material_costs', 'invoice_transitions',
                           'contractor_invoices']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_staff', t);
    execute format($f$create policy %I on public.%I
        for all to authenticated using (public.is_staff()) with check (public.is_staff())$f$,
      t || '_staff', t);
    -- Every money write is an RPC (§4.1) — nothing is client-writable.
    execute format('revoke insert, update, delete on public.%I from authenticated, anon', t);
  end loop;
end $$;

-- A contractor sees exactly their own platform-drafted invoices — and never
-- anything on the customer side (no policy on invoices/payments for them).
drop policy if exists contractor_invoices_own on public.contractor_invoices;
create policy contractor_invoices_own on public.contractor_invoices
  for select to authenticated
  using (contractor_id = public.current_contractor_id());

-- invoices/payments already carry staff-all + customer-own policies from the
-- initial schema. What changes under §4.1: direct client writes end here —
-- the RPCs below (SECURITY DEFINER) are the only writers.
revoke insert, update, delete on public.invoices from authenticated, anon;
revoke insert, update, delete on public.payments from authenticated, anon;

-- ======================================================================
-- 8. The ledger — ONE computation of adjusted_contract (§3)
-- ======================================================================

-- INTERNAL. lib/invoicing/ledger.ts is the same rule in TypeScript with the
-- golden tests; a contract test diffs the two so they cannot drift. Nothing
-- else in the codebase may compute adjusted_contract.
--
--   adjusted_contract = accepted snapshot total (immutable, inc GST)
--                     + Σ approved variations (customer_approved or
--                       contractor_accepted — the price the customer saw)
--                     − Σ approved credit/descope variations
--   invoiced = Σ issued+ invoices (excl. draft + void), net of credit notes
--   paid     = Σ succeeded payments (surcharge excluded — not job revenue)
--   balance  = adjusted_contract − paid
create or replace function public.invoice_ledger(p_estimate_id uuid)
returns table (accepted_total_cents bigint, variations_cents bigint,
               adjusted_contract_cents bigint, invoiced_cents bigint,
               paid_cents bigint, balance_cents bigint)
language sql stable security definer set search_path = public as $$
  with est as (
    select coalesce(e.accepted_total_cents, e.total_cents, 0)::bigint as accepted
      from public.estimates e where e.id = p_estimate_id
  ),
  vars as (
    select coalesce(sum(case when v.credit then -v.price_cents else v.price_cents end), 0)::bigint as vars
      from public.wo_variations v
      join public.work_orders w on w.id = v.work_order_id
     where w.estimate_id = p_estimate_id
       and v.status in ('customer_approved', 'contractor_accepted')
       and v.price_cents is not null
  ),
  inv as (
    select coalesce(sum(i.total_inc_cents), 0)::bigint as invoiced
      from public.invoices i
     where i.estimate_id = p_estimate_id
       and i.status not in ('draft', 'void')
  ),
  cn as (
    select coalesce(sum(c.total_inc_cents), 0)::bigint as credits
      from public.credit_notes c
      join public.invoices i on i.id = c.invoice_id
     where i.estimate_id = p_estimate_id
  ),
  pay as (
    select coalesce(sum(p.amount_cents), 0)::bigint as paid
      from public.payments p
      join public.invoices i on i.id = p.invoice_id
     where i.estimate_id = p_estimate_id and p.status = 'succeeded'
  )
  select est.accepted, vars.vars, est.accepted + vars.vars,
         inv.invoiced - cn.credits, pay.paid,
         est.accepted + vars.vars - pay.paid
    from est, vars, inv, cn, pay
$$;

revoke execute on function public.invoice_ledger(uuid) from public, anon, authenticated;

-- The staff-facing read (screens, dashboard aggregations).
create or replace function public.invoice_ledger_staff(p_estimate_id uuid)
returns table (accepted_total_cents bigint, variations_cents bigint,
               adjusted_contract_cents bigint, invoiced_cents bigint,
               paid_cents bigint, balance_cents bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then return; end if;
  return query select * from public.invoice_ledger(p_estimate_id);
end $$;

grant execute on function public.invoice_ledger_staff(uuid) to authenticated;

-- Event writer, internal.
create or replace function public.invoice_event(
  p_invoice_id uuid, p_type text, p_actor_kind text, p_meta jsonb default '{}'
) returns void language sql volatile security definer set search_path = public as $$
  insert into public.invoice_events (invoice_id, type, actor, actor_kind, meta)
  values (p_invoice_id, p_type, auth.uid(), p_actor_kind, coalesce(p_meta, '{}'))
$$;

revoke execute on function public.invoice_event(uuid, text, text, jsonb) from public, anon, authenticated;

-- ======================================================================
-- 9. State-machine RPCs — the ONLY writers (§4.1)
-- ======================================================================

-- issue: number allocated, dates set, totals fixed, document locked.
create or replace function public.invoice_issue(p_invoice_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v public.invoices%rowtype; v_rate numeric; v_ex bigint; v_gst integer;
        v_total bigint; v_terms integer; v_today date;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into v from public.invoices where id = p_invoice_id for update;
  if not found then return 'error:not_found'; end if;
  if v.status <> 'draft' then return 'error:not_draft'; end if;

  v_rate := public.invoice_setting_num('{gstRatePct}', 10);

  if v.kind in ('deposit', 'progress', 'final') then
    -- Inc-anchored: the promise is an inc-GST figure computed off the ledger.
    v_total := v.total_inc_cents;
    if v_total <= 0 then return 'error:nothing_to_invoice'; end if;
    v_gst := public.gst_from_inc_cents(v_total, v_rate);
    v_ex := v_total - v_gst;
  else
    -- Line-built: sum ex lines, GST once, round half-up (⚑14).
    select coalesce(sum(l.amount_ex_cents), 0) into v_ex
      from public.invoice_lines l where l.invoice_id = p_invoice_id;
    if v_ex <= 0 then return 'error:nothing_to_invoice'; end if;
    v_gst := public.gst_on_ex_cents(v_ex, v_rate);
    v_total := v_ex + v_gst;
  end if;

  v_today := (now() at time zone 'Australia/Melbourne')::date;
  v_terms := case when v.kind = 'final'
                  then public.invoice_setting_num('{finalTermsDays}', 7)::integer
                  else public.invoice_setting_num('{paymentTermsDays}', 7)::integer end;

  update public.invoices
     set status = 'issued',
         number = public.invoice_allocate_number(),
         issued_on = v_today,
         due_on = v_today + v_terms,
         subtotal_ex_cents = v_ex::integer,
         gst_cents = v_gst,
         total_inc_cents = v_total::integer,
         amount_cents = v_total::integer
   where id = p_invoice_id;

  perform public.invoice_event(p_invoice_id, 'issued', 'staff',
    jsonb_build_object('number', (select number from public.invoices where id = p_invoice_id),
                       'total_inc_cents', v_total, 'due_on', v_today + v_terms));
  return 'ok:issued';
end $$;

grant execute on function public.invoice_issue(uuid) to authenticated;

-- send: the transition happens once; every send after that is an event.
-- (The actual pipeline is Step 3 — this records the state + the feed row.)
create or replace function public.invoice_send(p_invoice_id uuid, p_channel text default 'email')
returns text language plpgsql security definer set search_path = public as $$
declare v public.invoices%rowtype;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into v from public.invoices where id = p_invoice_id for update;
  if not found then return 'error:not_found'; end if;
  if v.status = 'issued' then
    update public.invoices set status = 'sent' where id = p_invoice_id;
    perform public.invoice_event(p_invoice_id, 'sent', 'staff',
      jsonb_build_object('channel', p_channel));
    return 'ok:sent';
  elsif v.status in ('sent', 'viewed', 'partially_paid') then
    perform public.invoice_event(p_invoice_id, 'sent', 'staff',
      jsonb_build_object('channel', p_channel, 'resend', true));
    return 'ok:resent';
  end if;
  return 'error:not_sendable';
end $$;

grant execute on function public.invoice_send(uuid, text) to authenticated;

-- viewed: written from the customer's token view (Step 3 wires the page).
create or replace function public.invoice_mark_viewed(p_token text)
returns text language plpgsql security definer set search_path = public as $$
declare v public.invoices%rowtype;
begin
  select * into v from public.invoices where token = p_token for update;
  if not found then return 'error:not_found'; end if;
  if v.status = 'sent' then
    update public.invoices set status = 'viewed' where id = v.id;
  end if;
  perform public.invoice_event(v.id, 'viewed', 'customer', '{}');
  return 'ok:viewed';
end $$;

grant execute on function public.invoice_mark_viewed(text) to anon, authenticated;

-- record a manual payment (bank transfer / cash / other). §4.2: the ONE
-- operator-entered amount, bounded — never more than balance × 1.05.
-- Card payments arrive exclusively through the Stripe webhook (Step 4).
create or replace function public.invoice_record_payment(
  p_invoice_id uuid, p_method text, p_amount_cents integer,
  p_reference text default '', p_received_on date default null
) returns text language plpgsql security definer set search_path = public as $$
declare v public.invoices%rowtype; v_paid bigint; v_balance bigint; v_receipt text;
        v_new_status public.invoice_status;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_method not in ('bank_transfer', 'cash', 'other') then
    return 'error:stripe_via_webhook';
  end if;
  select * into v from public.invoices where id = p_invoice_id for update;
  if not found then return 'error:not_found'; end if;
  if v.status not in ('issued', 'sent', 'viewed', 'partially_paid') then
    return 'error:not_payable';
  end if;

  select coalesce(sum(amount_cents), 0) into v_paid
    from public.payments where invoice_id = p_invoice_id and status = 'succeeded';
  v_balance := v.total_inc_cents - v_paid;
  if p_amount_cents is null or p_amount_cents <= 0 then return 'error:bad_amount'; end if;
  if p_amount_cents > round(v_balance * 1.05) then return 'error:exceeds_balance'; end if;

  v_receipt := public.receipt_allocate_number();
  insert into public.payments (invoice_id, amount_cents, paid_on, method, status,
                               received_at, recorded_by, reference, receipt_number)
    values (p_invoice_id, p_amount_cents,
            coalesce(p_received_on, (now() at time zone 'Australia/Melbourne')::date),
            p_method, 'succeeded', now(), auth.uid(),
            coalesce(p_reference, ''), v_receipt);

  v_new_status := case when v_paid + p_amount_cents >= v.total_inc_cents
                       then 'paid'::public.invoice_status
                       else 'partially_paid'::public.invoice_status end;
  if v.status is distinct from v_new_status then
    update public.invoices set status = v_new_status where id = p_invoice_id;
  end if;

  perform public.invoice_event(p_invoice_id, 'payment_received', 'staff',
    jsonb_build_object('method', p_method, 'amount_cents', p_amount_cents,
                       'receipt', v_receipt, 'reference', coalesce(p_reference, ''),
                       'overpaid', v_paid + p_amount_cents > v.total_inc_cents));
  return 'ok:' || v_new_status::text;
end $$;

grant execute on function public.invoice_record_payment(uuid, text, integer, text, date) to authenticated;

-- void: the number is burnt, the variations it billed are freed (mirror
-- trigger). A PAID invoice cannot be voided — that correction is a credit note.
create or replace function public.invoice_void(p_invoice_id uuid, p_reason text)
returns text language plpgsql security definer set search_path = public as $$
declare v public.invoices%rowtype;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if coalesce(trim(p_reason), '') = '' then return 'error:reason_required'; end if;
  select * into v from public.invoices where id = p_invoice_id for update;
  if not found then return 'error:not_found'; end if;
  if v.status = 'paid' then return 'error:paid_use_credit_note'; end if;
  if v.status not in ('issued', 'sent', 'viewed', 'partially_paid') then
    return 'error:not_voidable';
  end if;
  update public.invoices set status = 'void', voided_reason = trim(p_reason)
   where id = p_invoice_id;
  perform public.invoice_event(p_invoice_id, 'voided', 'staff',
    jsonb_build_object('reason', trim(p_reason), 'number', v.number));
  return 'ok:void';
end $$;

grant execute on function public.invoice_void(uuid, text) to authenticated;

-- ⚑17 write-off — Tom only, reason required, event written. Staff-gated at
-- the DB until roles distinguish Tom; the PR body flags this open ⚑.
create or replace function public.invoice_write_off(p_invoice_id uuid, p_reason text)
returns text language plpgsql security definer set search_path = public as $$
declare v public.invoices%rowtype;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if coalesce(trim(p_reason), '') = '' then return 'error:reason_required'; end if;
  select * into v from public.invoices where id = p_invoice_id for update;
  if not found then return 'error:not_found'; end if;
  if v.status not in ('issued', 'sent', 'viewed', 'partially_paid') then
    return 'error:not_writeoffable';
  end if;
  update public.invoices set status = 'written_off', written_off_reason = trim(p_reason)
   where id = p_invoice_id;
  perform public.invoice_event(p_invoice_id, 'written_off', 'staff',
    jsonb_build_object('reason', trim(p_reason), 'number', v.number));
  return 'ok:written_off';
end $$;

grant execute on function public.invoice_write_off(uuid, text) to authenticated;

-- due-date extension — the one legal post-issue edit besides status.
create or replace function public.invoice_extend_due(p_invoice_id uuid, p_due date, p_reason text default '')
returns text language plpgsql security definer set search_path = public as $$
declare v public.invoices%rowtype;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_due is null then return 'error:bad_date'; end if;
  select * into v from public.invoices where id = p_invoice_id for update;
  if not found then return 'error:not_found'; end if;
  if v.status not in ('issued', 'sent', 'viewed', 'partially_paid') then
    return 'error:not_open';
  end if;
  update public.invoices set due_on = p_due where id = p_invoice_id;
  perform public.invoice_event(p_invoice_id, 'extension', 'staff',
    jsonb_build_object('from', v.due_on, 'to', p_due, 'reason', coalesce(p_reason, '')));
  return 'ok:extended';
end $$;

grant execute on function public.invoice_extend_due(uuid, date, text) to authenticated;

-- drafts are the only deletable money objects (§3.2).
create or replace function public.invoice_delete_draft(p_invoice_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v public.invoices%rowtype;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into v from public.invoices where id = p_invoice_id for update;
  if not found then return 'error:not_found'; end if;
  if v.status <> 'draft' then return 'error:not_draft'; end if;
  delete from public.invoices where id = p_invoice_id;
  return 'ok:deleted';
end $$;

grant execute on function public.invoice_delete_draft(uuid) to authenticated;

-- §4.2 request a payment: the browser sends INTENT ({percent} or {fixed});
-- the server computes cents off the ledger. Drafts a progress invoice.
create or replace function public.invoice_request_payment(
  p_estimate_id uuid, p_mode text, p_value numeric
) returns text language plpgsql security definer set search_path = public as $$
declare v_led record; v_total bigint; v_gst integer; v_ex bigint; v_rate numeric;
        v_inv uuid; v_wo uuid; v_desc text;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_mode not in ('percent', 'fixed') then return 'error:bad_mode'; end if;

  select * into v_led from public.invoice_ledger(p_estimate_id);
  if v_led.accepted_total_cents is null or v_led.accepted_total_cents = 0 then
    return 'error:not_accepted';
  end if;

  if p_mode = 'percent' then
    if p_value is null or p_value <= 0 or p_value > 100 then return 'error:bad_percent'; end if;
    v_total := round(v_led.adjusted_contract_cents * p_value / 100);
    v_desc := 'Progress claim — ' || public.invoice_pct_text(p_value)
              || '% of the adjusted contract';
  else
    if p_value is null or p_value <= 0 or p_value <> round(p_value) then return 'error:bad_amount'; end if;
    if p_value > v_led.balance_cents then return 'error:exceeds_balance'; end if;
    v_total := p_value::bigint;
    v_desc := 'Progress claim';
  end if;
  if v_total <= 0 then return 'error:nothing_to_invoice'; end if;

  v_rate := public.invoice_setting_num('{gstRatePct}', 10);
  v_gst := public.gst_from_inc_cents(v_total, v_rate);
  v_ex := v_total - v_gst;

  select id into v_wo from public.work_orders where estimate_id = p_estimate_id;

  insert into public.invoices (estimate_id, customer_id, work_order_id, kind, status,
                               amount_cents, subtotal_ex_cents, gst_cents, total_inc_cents,
                               token, created_by)
    values (p_estimate_id,
            (select customer_id from public.estimates where id = p_estimate_id),
            v_wo, 'progress', 'draft',
            v_total::integer, v_ex::integer, v_gst, v_total::integer,
            public.invoice_new_token(), auth.uid())
    returning id into v_inv;

  insert into public.invoice_lines (invoice_id, sort, source, description, amount_ex_cents, gst_cents)
    values (v_inv, 0, 'manual', v_desc, v_ex::integer, v_gst);

  perform public.invoice_event(v_inv, 'drafted', 'staff',
    jsonb_build_object('mode', p_mode, 'value', p_value, 'total_inc_cents', v_total));
  return 'ok:' || v_inv::text;
end $$;

grant execute on function public.invoice_request_payment(uuid, text, numeric) to authenticated;

-- ======================================================================
-- 9b. The final-invoice draft (adjusted contract − previously invoiced)
-- ======================================================================

-- INTERNAL — called inside wo_sign / wo_close_without_walkthrough (any role's
-- session; the definer chain authorises it) and by the staff wrapper below.
-- Idempotent: an existing DRAFT final is replaced; issued finals are left
-- alone and a re-run simply drafts the remaining balance.
--
-- Lines are seeded the way the estimate reads (§7.3): snapshot areas with
-- substrate descriptions, line items, sundries, selected options, discount —
-- then each approved variation as its own line (source_ref = wo_variations.id,
-- which is also what the single-billing unique index bites on), then a
-- balancing "less previously invoiced" adjustment so Σ lines equals the
-- anchored subtotal to the cent.
create or replace function public.invoice_draft_final(p_estimate_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_est public.estimates%rowtype; v_wo uuid; v_snap jsonb; v_led record;
        v_rate numeric; v_total bigint; v_gst integer; v_ex bigint;
        v_inv uuid; r jsonb; v_sort integer := 0; v_sum_ex bigint := 0;
        v_areas_ex bigint := 0; v_lines_ex bigint := 0; v_opts_ex bigint := 0;
        v_base bigint; v_sundries bigint; v_discount bigint := 0; v_line_ex bigint;
        v_prev text; v_bal bigint; v_vdesc text;
  v public.wo_variations%rowtype;
begin
  select * into v_est from public.estimates where id = p_estimate_id;
  if not found then return 'error:not_found'; end if;
  select id into v_wo from public.work_orders where estimate_id = p_estimate_id;
  v_snap := coalesce(v_est.sent_snapshot, '{}'::jsonb);
  v_rate := public.invoice_setting_num('{gstRatePct}', 10);

  -- A fresh draft replaces any standing draft final (re-sign after reopen,
  -- variation approved between prep and sign-off, …).
  delete from public.invoices
   where estimate_id = p_estimate_id and kind = 'final' and status = 'draft';

  select * into v_led from public.invoice_ledger(p_estimate_id);
  v_total := greatest(v_led.adjusted_contract_cents - v_led.invoiced_cents, 0);
  v_gst := public.gst_from_inc_cents(v_total, v_rate);
  v_ex := v_total - v_gst;

  insert into public.invoices (estimate_id, customer_id, work_order_id, kind, status,
                               amount_cents, subtotal_ex_cents, gst_cents, total_inc_cents,
                               token, created_by)
    values (p_estimate_id, v_est.customer_id, v_wo, 'final', 'draft',
            v_total::integer, v_ex::integer, v_gst, v_total::integer,
            public.invoice_new_token(), auth.uid())
    returning id into v_inv;

  -- Contract works, exactly as the accepted document reads them.
  for r in select value from jsonb_array_elements(coalesce(v_snap->'areas', '[]'::jsonb))
  loop
    v_line_ex := coalesce((r->>'priceCents')::bigint, 0);
    v_areas_ex := v_areas_ex + v_line_ex;
    insert into public.invoice_lines (invoice_id, sort, source, source_ref, description, amount_ex_cents)
      values (v_inv, v_sort, 'estimate_snapshot', r->>'id',
              coalesce(r->>'title', '') ||
              case when public.invoice_strip_html(r->>'descriptionHtml') <> ''
                   then ' — ' || public.invoice_strip_html(r->>'descriptionHtml') else '' end,
              v_line_ex::integer);
    v_sort := v_sort + 1;
  end loop;

  for r in select value from jsonb_array_elements(coalesce(v_snap->'lineItems', '[]'::jsonb))
  loop
    v_line_ex := coalesce((r->>'priceCents')::bigint, 0);
    v_lines_ex := v_lines_ex + v_line_ex;
    insert into public.invoice_lines (invoice_id, sort, source, source_ref, description, amount_ex_cents)
      values (v_inv, v_sort, 'estimate_snapshot', r->>'id',
              coalesce(r->>'title', '') ||
              case when public.invoice_strip_html(r->>'descriptionHtml') <> ''
                   then ' — ' || public.invoice_strip_html(r->>'descriptionHtml') else '' end,
              v_line_ex::integer);
    v_sort := v_sort + 1;
  end loop;

  -- Sundries: baseSubtotalCents = included items + sundries (ex GST), so the
  -- residual over the itemised lines is the sundries figure.
  v_base := coalesce((v_snap->>'baseSubtotalCents')::bigint, v_areas_ex + v_lines_ex);
  v_sundries := v_base - v_areas_ex - v_lines_ex;
  if v_sundries > 0 then
    insert into public.invoice_lines (invoice_id, sort, source, description, amount_ex_cents)
      values (v_inv, v_sort, 'estimate_snapshot', 'Sundries & consumables', v_sundries::integer);
    v_sort := v_sort + 1;
  end if;

  -- The options the customer selected at acceptance.
  for r in select value from jsonb_array_elements(coalesce(v_snap->'options', '[]'::jsonb))
            where (value->>'id') in (select jsonb_array_elements_text(coalesce(v_est.selected_options, '[]'::jsonb)))
  loop
    v_line_ex := coalesce((r->>'priceCents')::bigint, 0);
    v_opts_ex := v_opts_ex + v_line_ex;
    insert into public.invoice_lines (invoice_id, sort, source, source_ref, description, amount_ex_cents)
      values (v_inv, v_sort, 'estimate_snapshot', r->>'id',
              coalesce(r->>'title', '') || ' (selected option)', v_line_ex::integer);
    v_sort := v_sort + 1;
  end loop;

  -- Discount — the engine's own rule (lib/pricing/estimate.ts:401): off the
  -- ex-GST subtotal, pct rounded or a flat amount capped at the subtotal.
  if coalesce(v_snap->>'discountMode', '') = 'fixed' then
    v_discount := least(coalesce((v_snap->>'discountFixedCents')::bigint, 0), v_base + v_opts_ex);
  else
    v_discount := round((v_base + v_opts_ex) * coalesce((v_snap->>'discountPct')::numeric, 0) / 100);
  end if;
  if v_discount > 0 then
    insert into public.invoice_lines (invoice_id, sort, source, description, amount_ex_cents)
      values (v_inv, v_sort, 'estimate_snapshot', 'Discount', (-v_discount)::integer);
    v_sort := v_sort + 1;
  end if;

  -- Approved variations — their own lines, source_ref carries the variation
  -- id (approval date and approver render from it in the document view).
  for v in select * from public.wo_variations vv
            where vv.work_order_id = v_wo
              and vv.status in ('customer_approved', 'contractor_accepted')
              and vv.price_cents is not null
            order by vv.created_at
  loop
    v_vdesc := coalesce(nullif(trim(v.comment), ''), initcap(replace(v.category, '_', ' ')));
    v_line_ex := (case when v.credit then -1 else 1 end)
                 * (v.price_cents - public.gst_from_inc_cents(v.price_cents::bigint, v_rate));
    insert into public.invoice_lines (invoice_id, sort, source, source_ref, description, amount_ex_cents)
      values (v_inv, v_sort, 'variation', v.id::text, v_vdesc, v_line_ex::integer);
    v_sort := v_sort + 1;
  end loop;

  -- Balance the document to the anchored subtotal: "less previously invoiced"
  -- when something has been, a (rare, ≤ a few cents) rounding line otherwise.
  select coalesce(sum(l.amount_ex_cents), 0) into v_sum_ex
    from public.invoice_lines l where l.invoice_id = v_inv;
  v_bal := v_ex - v_sum_ex;
  if v_bal <> 0 then
    select string_agg(i.number || ' ' || i.kind::text, ', ' order by i.issued_on) into v_prev
      from public.invoices i
     where i.estimate_id = p_estimate_id and i.status not in ('draft', 'void')
       and i.id <> v_inv and i.number is not null;
    insert into public.invoice_lines (invoice_id, sort, source, description, amount_ex_cents)
      values (v_inv, v_sort, 'adjustment',
              case when coalesce(v_prev, '') <> ''
                   then 'Less previously invoiced — ' || v_prev
                   else 'Rounding adjustment' end,
              v_bal::integer);
  end if;

  perform public.invoice_event(v_inv, 'drafted', 'system',
    jsonb_build_object('auto', 'final', 'total_inc_cents', v_total,
                       'previously_invoiced_cents', v_led.invoiced_cents));
  return 'ok:' || v_inv::text;
end $$;

revoke execute on function public.invoice_draft_final(uuid) from public, anon, authenticated;

-- Staff "Invoice in full" — same draft, invoked from the money view.
create or replace function public.invoice_create_final(p_estimate_id uuid)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  return public.invoice_draft_final(p_estimate_id);
end $$;

grant execute on function public.invoice_create_final(uuid) to authenticated;

-- ======================================================================
-- 10. Rewire the three producers (bodies verbatim from newest migrations;
--     ONLY the invoice-stub sites change)
-- ======================================================================

-- ---- 10a. accept_estimate — BODY BASIS 20261026. Changes:
--   · writes estimates.accepted_total_cents (the immutable ledger anchor)
--   · the WO row is created BEFORE the invoice so the deposit can carry
--     work_order_id
--   · the deposit draft is a real §3.1 invoice: kind 'deposit', token,
--     ex/GST/inc totals, a seeded line, a 'drafted' event — still inside
--     the same transaction (§4.5)
--   · deposit % = the snapshot's own depositPct when the accepted document
--     stated one, else the ⚑1 Settings default (10) — an accepted document
--     is never silently re-priced

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

  -- The deposit invoice auto-drafts INSIDE this transaction (§4.5) —
  -- amendable before issue, per Tom's 22 Aug ruling. A2 preserved: the
  -- invoice carries its own customer (null until the identity link lands).
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

-- ---- 10b. wo_sign — BODY BASIS 20261028 (v3, two modes). ONE change:
--   the $0 invoice stub becomes the drafted FINAL invoice
--   (adjusted contract − previously invoiced, lines by source refs).

create or replace function public.wo_sign(
  p_token text, p_name text, p_kind public.wo_signoff_kind default 'remote', p_device text default ''
) returns text language plpgsql security definer set search_path = public as $$
declare v_t record; v_s public.wo_signoff%rowtype; v_via text; v_wo public.work_orders%rowtype;
        v_kind public.wo_signoff_kind; v_captured text;
        v_unapproved text[]; v_years integer := 2; v_start date; v_report jsonb;
begin
  -- Record-then-unpack: a %rowtype var cannot sit in a multi-item INTO (42601).
  select * into v_t from public.wo_signoff_by_token(p_token);
  if not found then return 'error:not_found'; end if;
  v_s := v_t.s; v_via := v_t.via;
  perform 1 from public.wo_signoff where work_order_id = v_s.work_order_id for update;
  if v_s.signed_at is not null then return 'ok:already'; end if;
  if coalesce(trim(p_name), '') = '' then return 'error:no_name'; end if;

  -- Which signature this really is. The caller's claim only survives for
  -- 'deemed', and only once the clock has genuinely run out.
  if p_kind = 'deemed' then
    if v_via <> 'customer' then return 'error:deemed_needs_customer_token'; end if;
    if v_s.deadline_at is null or now() < v_s.deadline_at then
      return 'error:deemed_too_early';
    end if;
    v_kind := 'deemed'; v_captured := null;
  elsif v_via = 'session' then
    v_kind := 'on_device'; v_captured := 'contractor_device';
  else
    -- Mode B: remote, from the customer's own link — FALLBACK ONLY.
    if v_s.client_unavailable_at is null and not exists (
      select 1 from public.wo_walkthroughs
       where work_order_id = v_s.work_order_id and kind = 'final' and status = 'missed'
    ) then
      return 'error:walkthrough_first';
    end if;
    v_kind := 'remote'; v_captured := 'customer_device';
  end if;

  select * into v_wo from public.work_orders where id = v_s.work_order_id;

  -- Every area the job actually has must be approved. A deemed sign-off is the
  -- one exception, because there the silence IS the answer.
  if v_kind <> 'deemed' then
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
         signed_kind = v_kind, signed_device = coalesce(p_device, ''),
         captured_on = v_captured,
         walkthrough_session_token = null, walkthrough_session_expires_at = null
   where work_order_id = v_s.work_order_id;

  -- The booked walkthrough this signature completes.
  update public.wo_walkthroughs set status = 'done'
   where work_order_id = v_s.work_order_id and kind = 'final' and status = 'booked'
     and v_kind = 'on_device';

  -- 1. warranty
  insert into public.warranties (work_order_id, estimate_id, starts_on, ends_on, years, signed_kind)
    values (v_s.work_order_id, v_wo.estimate_id, v_start,
            (v_start + make_interval(years => v_years))::date, v_years, v_kind)
  on conflict (work_order_id) do nothing;

  -- 2. the review request, as a task for the follow-up phase to pick up
  insert into public.follow_ups (estimate_id, due_on, done)
    values (v_wo.estimate_id, v_start + 2, false);

  -- 3. the completion report — built from the events, not written by anyone
  select jsonb_build_object(
    'wo_ref', v_wo.wo_ref,
    'signed_at', now(), 'signed_name', trim(p_name), 'signed_kind', v_kind::text,
    'captured_on', v_captured,
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

  -- 4. the sign-off stub becomes the DRAFT FINAL INVOICE (Invoicing Step 1):
  -- adjusted contract − previously invoiced, lines pulled by source refs.
  perform public.invoice_draft_final(v_wo.estimate_id);

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_s.work_order_id, 'signed_off', auth.uid(),
            case when v_kind = 'deemed' then 'system' else 'customer' end,
            jsonb_build_object('kind', v_kind::text, 'name', trim(p_name),
                               'captured_on', v_captured,
                               'warranty_starts', v_start, 'deemed', v_kind = 'deemed'));

  perform public.wo_set_stage(v_s.work_order_id, 'closed',
                              case when v_kind = 'deemed' then 'system' else 'customer' end,
                              jsonb_build_object('signed_kind', v_kind::text));

  return 'ok:signed';
end $$;

grant execute on function public.wo_sign(text, text, public.wo_signoff_kind, text) to anon, authenticated, service_role;

-- ---- 10c. wo_close_without_walkthrough — BODY BASIS 20261110. ONE change:
--   the $0 stub becomes the drafted final invoice.

create or replace function public.wo_close_without_walkthrough(p_work_order_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_wo public.work_orders%rowtype; v_cid uuid; v_kind text; v_r text; v_start date; v_report jsonb;
begin
  select * into v_wo from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;
  v_cid := public.current_contractor_id();
  if public.is_staff() then v_kind := 'staff';
  elsif public.wo_is_system() then v_kind := 'system';
  elsif v_cid is not null and v_cid = v_wo.contractor_id then v_kind := 'contractor';
  else return 'error:not_yours';
  end if;
  if coalesce(v_wo.walkthrough_required, true) then return 'error:walkthrough_required'; end if;
  if v_wo.stage not in ('completion_prep', 'qa') then return 'error:not_ready'; end if;

  v_r := public.wo_set_stage(p_work_order_id, 'closed', v_kind,
           jsonb_build_object('via', 'no_walkthrough'));
  if v_r not like 'ok:%' then return v_r; end if;

  v_start := (now() at time zone 'Australia/Melbourne')::date;

  select jsonb_build_object(
    'wo_ref', v_wo.wo_ref,
    'signed_at', now(), 'signed_name', 'No walkthrough required', 'signed_kind', 'no_walkthrough',
    'captured_on', null,
    'warranty_starts', v_start,
    'surfaces', (select coalesce(jsonb_agg(jsonb_build_object(
                     'heading', heading, 'label', label, 'state', state::text,
                     'rectification', rectification) order by sort), '[]'::jsonb)
                   from public.wo_surfaces where work_order_id = p_work_order_id),
    'photos', (select coalesce(jsonb_agg(jsonb_build_object(
                     'kind', kind::text, 'area', area, 'path', storage_path)), '[]'::jsonb)
                 from public.wo_photos where work_order_id = p_work_order_id),
    'variations', (select coalesce(jsonb_agg(jsonb_build_object(
                     'category', category, 'comment', comment, 'status', status::text,
                     'price_cents', price_cents)), '[]'::jsonb)
                     from public.wo_variations where work_order_id = p_work_order_id),
    'qa', (select coalesce(jsonb_agg(jsonb_build_object(
                     'kind', kind, 'result', result, 'thin_record', thin_record)), '[]'::jsonb)
             from public.wo_qa_checks where work_order_id = p_work_order_id),
    'areas', '{}'::jsonb
  ) into v_report;

  insert into public.wo_signoff (work_order_id, signed_at, signed_name, signed_kind, report)
    values (p_work_order_id, now(), 'No walkthrough required', 'no_walkthrough', v_report)
  on conflict (work_order_id) do update
    set signed_at = coalesce(public.wo_signoff.signed_at, now()),
        signed_name = coalesce(public.wo_signoff.signed_name, 'No walkthrough required'),
        signed_kind = coalesce(public.wo_signoff.signed_kind, 'no_walkthrough'),
        report = coalesce(public.wo_signoff.report, excluded.report);

  insert into public.warranties (work_order_id, estimate_id, starts_on, ends_on, years, signed_kind)
    values (p_work_order_id, v_wo.estimate_id, v_start,
            (v_start + make_interval(years => 2))::date, 2, 'no_walkthrough')
  on conflict (work_order_id) do nothing;

  insert into public.follow_ups (estimate_id, due_on, done)
    values (v_wo.estimate_id, v_start + 2, false);

  -- Invoicing Step 1: the stub becomes the drafted final invoice.
  perform public.invoice_draft_final(v_wo.estimate_id);

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (p_work_order_id, 'closed_without_walkthrough', auth.uid(), v_kind,
            jsonb_build_object('warranty_starts', v_start));
  return 'ok:closed';
end $$;
grant execute on function public.wo_close_without_walkthrough(uuid) to authenticated, service_role;

-- ---- 10d. wo_reopen_signoff — BODY BASIS 20261108. ONE change: the first
--   signing's draft FINAL invoice is dropped (was: the $0 stub) — a re-sign
--   drafts a fresh one. Issued finals are protected by the delete guard and
--   stay; the re-sign then drafts only the remaining balance.

create or replace function public.wo_reopen_signoff(p_work_order_id uuid, p_reason text default '')
returns text language plpgsql security definer set search_path = public as $$
declare v_wo public.work_orders%rowtype; v_s public.wo_signoff%rowtype; v_r text;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into v_wo from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;
  if v_wo.stage is distinct from 'closed' then return 'error:not_closed'; end if;

  select * into v_s from public.wo_signoff where work_order_id = p_work_order_id for update;
  if not found then return 'error:no_signoff_row'; end if;

  -- Back to the sign-off stage first: the gate (variations waiting) still applies.
  v_r := public.wo_set_stage(p_work_order_id, 'walkthrough', 'staff',
           jsonb_build_object('via', 'reopen_signoff', 'reason', coalesce(p_reason, '')));
  if v_r not like 'ok:%' then return v_r; end if;

  -- Unsign: the customer's link can sign again; the old report stays until the
  -- re-sign overwrites it. Every area is re-asked — approvals are cleared so the
  -- customer looks again at what was found.
  update public.wo_signoff
     set signed_at = null, signed_name = null, signed_kind = null, signed_device = '',
         captured_on = null, walkthrough_session_token = null, walkthrough_session_expires_at = null,
         areas = '{}'::jsonb
   where work_order_id = p_work_order_id;

  -- The first signing's draft final invoice — a re-sign drafts a fresh one.
  delete from public.invoices
   where estimate_id = v_wo.estimate_id and status = 'draft'
     and kind = 'final'::public.invoice_kind;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (p_work_order_id, 'signoff_reopened', auth.uid(), 'staff',
            jsonb_build_object('reason', coalesce(p_reason, ''),
                               'was_signed_at', v_s.signed_at, 'was_signed_by', v_s.signed_name));
  return 'ok:walkthrough';
end $$;
grant execute on function public.wo_reopen_signoff(uuid, text) to authenticated;

-- ======================================================================
-- readback — never assume the tail of a migration applied
-- ======================================================================

-- Expect 8 enum values on invoice_status.
select count(*) as invoice_status_values
  from pg_enum e join pg_type t on t.oid = e.enumtypid
 where t.typname = 'invoice_status';

-- Expect 18 transitions.
select count(*) as transitions from public.invoice_transitions;

-- Expect the single-billing index.
select indexname from pg_indexes
 where tablename = 'invoice_lines' and indexname = 'invoice_lines_variation_once';

-- Expect 3 triggers on invoices, 1 on invoice_lines.
select tgname from pg_trigger
 where tgrelid in ('public.invoices'::regclass, 'public.invoice_lines'::regclass)
   and not tgisinternal
 order by tgname;

-- Expect every live invoice to carry kind, token and agreeing totals.
select count(*) as invoices_missing_backfill
  from public.invoices
 where kind is null or token is null or total_inc_cents <> subtotal_ex_cents + gst_cents;

-- Expect the three producers to be rewired (no $0 stub inserts left).
select p.proname,
       pg_get_functiondef(p.oid) like '%invoice_draft_final%' as drafts_final
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('wo_sign', 'wo_close_without_walkthrough')
 order by p.proname;

select pg_get_functiondef(p.oid) like '%kind = ''deposit''%'
         or pg_get_functiondef(p.oid) like '%''deposit'', ''draft''%' as accept_drafts_deposit
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'accept_estimate';

-- Expect RLS on for every new table (9 rows, all true).
select relname, relrowsecurity from pg_class
 where relname in ('invoice_lines', 'invoice_events', 'credit_notes',
                   'stripe_events', 'vendors', 'job_costs', 'material_costs',
                   'invoice_transitions', 'contractor_invoices')
 order by relname;
