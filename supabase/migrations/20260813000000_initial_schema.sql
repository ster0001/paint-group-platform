-- =============================================================================
-- Paint Group Platform — Initial schema + Row Level Security
-- Phase 0.2 of the build plan.
--
-- Conventions:
--   * All money is stored as INTEGER CENTS (e.g. $145.50 => 14550). Never floats.
--   * "Productivity" rates (hours per unit), multipliers and wastage are NUMERIC,
--     because they are ratios, not money.
--   * Every table has Row Level Security (RLS) enabled with explicit policies.
--   * Three roles live in profiles.role: 'staff', 'customer', 'contractor'.
--       - staff        -> see and do everything
--       - customer     -> only their own records
--       - contractor   -> only jobs assigned to them (+ their own logs/offers)
-- =============================================================================

-- ------------------------------------------------------------------
-- 0. Enumerated types (fixed vocabularies)
-- ------------------------------------------------------------------
create type public.user_role        as enum ('staff', 'customer', 'contractor');
create type public.estimate_status  as enum ('draft', 'sent', 'accepted', 'declined', 'expired');
create type public.area_type        as enum ('interior', 'exterior');

-- The single most important design decision in the schema (per the build plan):
create type public.line_type        as enum ('production', 'prep', 'cleaning', 'passthrough');

create type public.assignment_status as enum ('offered', 'accepted', 'declined', 'countered');
create type public.cost_type         as enum ('labour', 'materials', 'passthrough', 'own_staff');
create type public.cost_source       as enum ('estimated', 'actual');
create type public.invoice_status    as enum ('draft', 'sent', 'paid', 'void');

-- ------------------------------------------------------------------
-- 1. Shared helpers
-- ------------------------------------------------------------------

-- Auto-maintain updated_at on tables that have it.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- NOTE: the role-checking helpers (is_staff(), current_customer_id(), etc.) are
-- defined further down, AFTER the profiles/customers/contractors tables exist.
-- Postgres validates a SQL function's body at creation time, so a helper that
-- reads profiles cannot be created before profiles exists.

-- ------------------------------------------------------------------
-- 2. Identity: profiles, customers, contractors
-- ------------------------------------------------------------------

create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  role       public.user_role not null default 'customer',
  name       text,
  contact    text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.profiles is 'One row per authenticated user. role drives all access.';

create table public.customers (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.contractors (
  id               uuid primary key default gen_random_uuid(),
  profile_id       uuid not null unique references public.profiles (id) on delete cascade,
  tier             text,
  insurance_expiry date,
  tickets          text,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table public.properties (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references public.customers (id) on delete cascade,
  address      text,
  type         text,
  storeys      integer,
  access_notes text,
  created_at   timestamptz not null default now()
);
create index on public.properties (customer_id);

-- These helpers are SECURITY DEFINER: they run with the function owner's
-- privileges and therefore BYPASS RLS when they read profiles/customers/
-- contractors. This is the standard Supabase pattern and it prevents "infinite
-- recursion" (a policy on profiles that needs to read profiles to decide who you
-- are). They are defined here, after their tables exist.

create or replace function public.current_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'staff')
$$;

create or replace function public.current_customer_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.customers where profile_id = auth.uid()
$$;

create or replace function public.current_contractor_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.contractors where profile_id = auth.uid()
$$;

-- When someone signs up, give them a profile (defaulting to 'customer').
-- staff/contractor are promoted manually afterwards.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, role, name, contact)
  values (new.id, 'customer', coalesce(new.raw_user_meta_data ->> 'name', ''), new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------------
-- 3. Reference / config data (staff-managed, versioned)
-- ------------------------------------------------------------------

create table public.rate_cards (
  id             uuid primary key default gen_random_uuid(),
  version        integer not null,
  effective_from date,
  is_active      boolean not null default false,
  created_at     timestamptz not null default now()
);

create table public.rate_items (
  id           uuid primary key default gen_random_uuid(),
  rate_card_id uuid not null references public.rate_cards (id) on delete cascade,
  category     text,
  product      text,
  unit         text,
  rate_1_coat  numeric,   -- hours per unit (productivity), not money
  rate_2_coat  numeric,
  rate_3_coat  numeric,
  wastage_pct  numeric,
  created_at   timestamptz not null default now()
);
create index on public.rate_items (rate_card_id);

create table public.modifiers (
  id          uuid primary key default gen_random_uuid(),
  group_name  text,        -- 'condition' | 'access' | 'finish' | 'size' ...
  label       text,
  multiplier  numeric not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table public.colour_rules (
  id         uuid primary key default gen_random_uuid(),
  label      text,
  coats      integer not null,
  undercoat  boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.products (
  id              uuid primary key default gen_random_uuid(),
  name            text,
  coverage        numeric,   -- m2 per litre
  price_per_litre integer,   -- cents
  wastage_pct     numeric,
  effective_from  date,
  created_at      timestamptz not null default now()
);

-- Flexible key/value store so "nothing is hardcoded". Money values inside the
-- JSON are still cents.
create table public.settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------------
-- 4. Estimates and their lines
-- ------------------------------------------------------------------

create table public.estimates (
  id                uuid primary key default gen_random_uuid(),
  customer_id       uuid references public.customers (id) on delete set null,
  property_id       uuid references public.properties (id) on delete set null,
  status            public.estimate_status not null default 'draft',
  rate_card_id      uuid references public.rate_cards (id),
  rate_card_version integer,          -- snapshot so editing a rate never alters a sent quote
  level_of_finish   smallint,         -- 2, 3 or 4 (see check below)
  size_band         text,             -- 'under_10k' | '10_to_20k' | 'over_20k'
  subtotal_cents    integer not null default 0,
  total_cents       integer not null default 0,
  valid_until       date,
  share_token       text unique,
  sent_at           timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint estimates_level_of_finish_values
    check (level_of_finish is null or level_of_finish in (2, 3, 4)),

  -- Non-negotiable #4: level of finish is REQUIRED before a quote leaves draft.
  -- (Deliberately enforced at 'sent'/'accepted' rather than as a blanket NOT NULL,
  --  so a work-in-progress draft can exist before the level has been chosen.)
  constraint estimates_finish_required_when_sent
    check (status = 'draft' or level_of_finish is not null)
);
create index on public.estimates (customer_id);

create table public.estimate_areas (
  id          uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates (id) on delete cascade,
  name        text,
  type        public.area_type not null,
  length_m    numeric,
  width_m     numeric,
  height_m    numeric,
  created_at  timestamptz not null default now()
);
create index on public.estimate_areas (estimate_id);

create table public.estimate_lines (
  id          uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates (id) on delete cascade,
  area_id     uuid references public.estimate_areas (id) on delete set null,
  line_type   public.line_type not null,
  description text,
  quantity    numeric,
  hours       numeric,
  price_cents integer not null default 0,
  cost_cents  integer,          -- internal cost; ONLY meaningful for passthrough
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),

  -- Non-negotiable #5: every passthrough line carries a cost; other lines don't.
  constraint estimate_lines_cost_only_passthrough check (
    (line_type = 'passthrough' and cost_cents is not null)
    or (line_type <> 'passthrough' and cost_cents is null)
  )
);
create index on public.estimate_lines (estimate_id);

create table public.estimate_options (
  id          uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates (id) on delete cascade,
  description text,
  price_cents integer not null default 0,
  is_accepted boolean not null default false,   -- not in total until accepted
  created_at  timestamptz not null default now()
);
create index on public.estimate_options (estimate_id);

-- ------------------------------------------------------------------
-- 5. Jobs, assignments, time, costs
-- ------------------------------------------------------------------

create table public.jobs (
  id          uuid primary key default gen_random_uuid(),
  estimate_id uuid references public.estimates (id) on delete set null,
  customer_id uuid references public.customers (id) on delete set null,
  property_id uuid references public.properties (id) on delete set null,
  status      text not null default 'scheduled',
  starts_on   date,
  total_cents integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on public.jobs (customer_id);

create table public.job_assignments (
  id             uuid primary key default gen_random_uuid(),
  job_id         uuid not null references public.jobs (id) on delete cascade,
  contractor_id  uuid not null references public.contractors (id) on delete cascade,
  offer_cents    integer not null,
  status         public.assignment_status not null default 'offered',
  counter_cents  integer,      -- contractor's counter on price
  counter_date   date,         -- contractor's counter on date
  responded_at   timestamptz,
  created_at     timestamptz not null default now()
);
create index on public.job_assignments (job_id);
create index on public.job_assignments (contractor_id);

create table public.time_logs (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references public.jobs (id) on delete cascade,
  contractor_id uuid not null references public.contractors (id) on delete cascade,
  work_date     date not null,
  hours         numeric not null,   -- actual hours, even though pay is fixed (recalibration feed)
  note          text,
  created_at    timestamptz not null default now()
);
create index on public.time_logs (job_id);
create index on public.time_logs (contractor_id);

create table public.cost_lines (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references public.jobs (id) on delete cascade,
  type        public.cost_type not null,
  source      public.cost_source not null,
  amount_cents integer not null,
  description text,
  created_at  timestamptz not null default now()
);
create index on public.cost_lines (job_id);

-- ------------------------------------------------------------------
-- 6. Invoices and payments
-- ------------------------------------------------------------------

create table public.invoices (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid references public.jobs (id) on delete set null,
  customer_id uuid references public.customers (id) on delete set null,
  status      public.invoice_status not null default 'draft',
  amount_cents integer not null default 0,
  issued_on   date,
  due_on      date,
  created_at  timestamptz not null default now()
);
create index on public.invoices (customer_id);

create table public.payments (
  id         uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  amount_cents integer not null,
  paid_on    date,
  method     text,
  created_at timestamptz not null default now()
);
create index on public.payments (invoice_id);

-- ------------------------------------------------------------------
-- 7. Follow-ups (CRM)
-- ------------------------------------------------------------------

create table public.follow_up_rules (
  id             uuid primary key default gen_random_uuid(),
  label          text,
  trigger_status text,
  delay_days     integer not null default 0,
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);

create table public.follow_ups (
  id          uuid primary key default gen_random_uuid(),
  estimate_id uuid references public.estimates (id) on delete cascade,
  rule_id     uuid references public.follow_up_rules (id) on delete set null,
  due_on      date,
  done        boolean not null default false,
  created_at  timestamptz not null default now()
);
create index on public.follow_ups (estimate_id);

-- ------------------------------------------------------------------
-- 8. updated_at triggers
-- ------------------------------------------------------------------
create trigger t_profiles_updated   before update on public.profiles   for each row execute function public.set_updated_at();
create trigger t_contractors_updated before update on public.contractors for each row execute function public.set_updated_at();
create trigger t_estimates_updated   before update on public.estimates   for each row execute function public.set_updated_at();
create trigger t_jobs_updated        before update on public.jobs        for each row execute function public.set_updated_at();

-- =============================================================================
-- 9. ROW LEVEL SECURITY
-- Enable on EVERY table, then add explicit policies. With RLS on and no matching
-- policy, access is denied by default. The Supabase service_role key bypasses RLS
-- entirely (used by the seed script and the server-side pricing engine).
-- =============================================================================

alter table public.profiles         enable row level security;
alter table public.customers        enable row level security;
alter table public.contractors      enable row level security;
alter table public.properties       enable row level security;
alter table public.rate_cards       enable row level security;
alter table public.rate_items       enable row level security;
alter table public.modifiers        enable row level security;
alter table public.colour_rules     enable row level security;
alter table public.products         enable row level security;
alter table public.settings         enable row level security;
alter table public.estimates        enable row level security;
alter table public.estimate_areas   enable row level security;
alter table public.estimate_lines   enable row level security;
alter table public.estimate_options enable row level security;
alter table public.jobs             enable row level security;
alter table public.job_assignments  enable row level security;
alter table public.time_logs        enable row level security;
alter table public.cost_lines       enable row level security;
alter table public.invoices         enable row level security;
alter table public.payments         enable row level security;
alter table public.follow_up_rules  enable row level security;
alter table public.follow_ups       enable row level security;

-- ---- profiles -------------------------------------------------------------
-- Staff can manage all profiles; everyone else can read & edit only their own.
create policy profiles_staff_all on public.profiles
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy profiles_self_select on public.profiles
  for select to authenticated using (id = auth.uid());
create policy profiles_self_update on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- ---- customers ------------------------------------------------------------
-- Staff manage all; a customer can see only their own customer row.
create policy customers_staff_all on public.customers
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy customers_self_select on public.customers
  for select to authenticated using (profile_id = auth.uid());

-- ---- contractors ----------------------------------------------------------
-- Staff manage all; a contractor can see only their own contractor row.
create policy contractors_staff_all on public.contractors
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy contractors_self_select on public.contractors
  for select to authenticated using (profile_id = auth.uid());

-- ---- properties -----------------------------------------------------------
-- Staff manage all; a customer sees only properties they own.
create policy properties_staff_all on public.properties
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy properties_customer_select on public.properties
  for select to authenticated using (customer_id = public.current_customer_id());

-- ---- reference / config: staff only --------------------------------------
-- The pricing engine reads these server-side with the service_role key, so
-- customers and contractors need no direct access.
create policy rate_cards_staff_all   on public.rate_cards   for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy rate_items_staff_all   on public.rate_items   for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy modifiers_staff_all    on public.modifiers    for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy colour_rules_staff_all on public.colour_rules for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy products_staff_all     on public.products     for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy settings_staff_all     on public.settings     for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- ---- estimates ------------------------------------------------------------
-- Staff manage all; a customer can READ only their own estimates.
-- (This is the Phase 0 gate: a customer must not see another customer's estimate.)
create policy estimates_staff_all on public.estimates
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy estimates_customer_select on public.estimates
  for select to authenticated using (customer_id = public.current_customer_id());

-- ---- estimate_areas -------------------------------------------------------
-- Staff manage all; a customer reads areas that belong to their own estimates.
create policy estimate_areas_staff_all on public.estimate_areas
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy estimate_areas_customer_select on public.estimate_areas
  for select to authenticated using (
    exists (
      select 1 from public.estimates e
      where e.id = estimate_areas.estimate_id
        and e.customer_id = public.current_customer_id()
    )
  );

-- ---- estimate_lines -------------------------------------------------------
-- STAFF ONLY at the table level. estimate_lines holds internal cost_cents
-- (passthrough cost), which customers must never see. Customers read their
-- quote through the customer_quote_lines VIEW below, which omits cost.
create policy estimate_lines_staff_all on public.estimate_lines
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- ---- estimate_options -----------------------------------------------------
-- Options have a price but no internal cost, so customers may read their own.
create policy estimate_options_staff_all on public.estimate_options
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy estimate_options_customer_select on public.estimate_options
  for select to authenticated using (
    exists (
      select 1 from public.estimates e
      where e.id = estimate_options.estimate_id
        and e.customer_id = public.current_customer_id()
    )
  );

-- ---- jobs -----------------------------------------------------------------
-- Staff manage all; a customer sees their own jobs; a contractor sees only
-- jobs they are assigned to.
create policy jobs_staff_all on public.jobs
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy jobs_customer_select on public.jobs
  for select to authenticated using (customer_id = public.current_customer_id());
create policy jobs_contractor_select on public.jobs
  for select to authenticated using (
    exists (
      select 1 from public.job_assignments ja
      where ja.job_id = jobs.id
        and ja.contractor_id = public.current_contractor_id()
    )
  );

-- ---- job_assignments ------------------------------------------------------
-- Staff manage all (create offers). A contractor sees only their own offers and
-- may UPDATE them (to accept / decline / counter). Customers get no access —
-- offer amounts are internal.
create policy job_assignments_staff_all on public.job_assignments
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy job_assignments_contractor_select on public.job_assignments
  for select to authenticated using (contractor_id = public.current_contractor_id());
create policy job_assignments_contractor_update on public.job_assignments
  for update to authenticated
  using (contractor_id = public.current_contractor_id())
  with check (contractor_id = public.current_contractor_id());

-- ---- time_logs ------------------------------------------------------------
-- Staff manage all; a contractor sees and creates only their own time logs.
create policy time_logs_staff_all on public.time_logs
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy time_logs_contractor_select on public.time_logs
  for select to authenticated using (contractor_id = public.current_contractor_id());
create policy time_logs_contractor_insert on public.time_logs
  for insert to authenticated with check (contractor_id = public.current_contractor_id());

-- ---- cost_lines -----------------------------------------------------------
-- STAFF ONLY. This is the margin-truth table; neither customers nor contractors
-- may read it.
create policy cost_lines_staff_all on public.cost_lines
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- ---- invoices -------------------------------------------------------------
-- Staff manage all; a customer reads only their own invoices.
create policy invoices_staff_all on public.invoices
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy invoices_customer_select on public.invoices
  for select to authenticated using (customer_id = public.current_customer_id());

-- ---- payments -------------------------------------------------------------
-- Staff manage all; a customer reads payments against their own invoices.
create policy payments_staff_all on public.payments
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy payments_customer_select on public.payments
  for select to authenticated using (
    exists (
      select 1 from public.invoices i
      where i.id = payments.invoice_id
        and i.customer_id = public.current_customer_id()
    )
  );

-- ---- follow-ups: staff only ----------------------------------------------
create policy follow_up_rules_staff_all on public.follow_up_rules
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy follow_ups_staff_all on public.follow_ups
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- =============================================================================
-- 10. Customer-facing quote view (hides internal cost)
-- security_invoker = false => the view runs with its owner's rights and so can
-- read estimate_lines even though customers cannot read that table directly.
-- The WHERE clause restricts each customer to their own estimates, and the
-- column list deliberately OMITS cost_cents.
-- =============================================================================
create view public.customer_quote_lines
  with (security_invoker = false) as
  select
    l.id,
    l.estimate_id,
    l.area_id,
    l.line_type,
    l.description,
    l.quantity,
    l.hours,
    l.price_cents,
    l.sort_order
  from public.estimate_lines l
  where exists (
    select 1 from public.estimates e
    where e.id = l.estimate_id
      and e.customer_id = public.current_customer_id()
  );

grant select on public.customer_quote_lines to authenticated;
