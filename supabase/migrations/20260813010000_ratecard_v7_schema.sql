-- =============================================================================
-- Rate Card v7 — schema extensions
-- The first migration held a minimal reference schema. Rate card v7 carries more
-- detail per tab, so this migration widens the existing reference tables and adds
-- four new ones (Sundries, Commercial Rates, Area Names, Line Items). All new
-- tables follow the same rule as the others: staff-only access.
-- Money stays in integer cents.
-- =============================================================================

-- ---- rate_items: fit the real "Production Rates" tab -----------------------
-- category now means Interior/Exterior; sub_category is Walls/Ceilings/etc.
alter table public.rate_items drop column if exists product;
alter table public.rate_items drop column if exists wastage_pct;
alter table public.rate_items
  add column code                     text,
  add column sub_category             text,
  add column default_coats            integer,
  add column charge_out_cents         integer,   -- cents ($85 -> 8500)
  add column default_product          text,
  add column metres_per_litre         numeric,
  add column litres_per_item_per_coat numeric;

-- ---- modifiers: add code / applies_to / source ----------------------------
alter table public.modifiers
  add column code       text,
  add column applies_to text,
  add column source     text;
alter table public.modifiers add constraint modifiers_code_key unique (code);

-- ---- colour_rules: undercoat is descriptive text, not a yes/no -------------
alter table public.colour_rules drop column if exists undercoat;
alter table public.colour_rules
  add column undercoat text,
  add column code      text,
  add column notes     text;
alter table public.colour_rules add constraint colour_rules_code_key unique (code);

-- ---- products: add interior/exterior type ---------------------------------
alter table public.products add column type text;
alter table public.products add constraint products_name_key unique (name);

-- ---- new reference tables --------------------------------------------------
create table public.sundries (
  id         uuid primary key default gen_random_uuid(),
  code       text unique,
  item       text,
  basis      text,
  cost_cents integer,                 -- cents
  created_at timestamptz not null default now()
);

create table public.commercial_rates (
  id                uuid primary key default gen_random_uuid(),
  sector            text unique,
  low_cents_per_m2  integer,          -- cents per m2 ($9.90 -> 990)
  high_cents_per_m2 integer,
  notes             text,
  created_at        timestamptz not null default now()
);

create table public.area_names (
  id         uuid primary key default gen_random_uuid(),
  area       text unique,
  type       public.area_type,        -- interior | exterior
  created_at timestamptz not null default now()
);

create table public.line_items (
  id             uuid primary key default gen_random_uuid(),
  name           text unique,
  type           text,
  pricing_method text,
  created_at     timestamptz not null default now()
);

-- ---- RLS on the new tables: staff-only, matching the other reference data --
alter table public.sundries         enable row level security;
alter table public.commercial_rates enable row level security;
alter table public.area_names       enable row level security;
alter table public.line_items       enable row level security;

create policy sundries_staff_all on public.sundries
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy commercial_rates_staff_all on public.commercial_rates
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy area_names_staff_all on public.area_names
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy line_items_staff_all on public.line_items
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
