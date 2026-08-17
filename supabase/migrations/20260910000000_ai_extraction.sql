-- =============================================================================
-- AI plan reader - P0 schema (build brief v2, section 6)
--
-- TWO DEPARTURES FROM THE BRIEF AS WRITTEN, both forced by the actual schema:
--
-- 1. There are no `areas` or `surfaces` TABLES to alter. The builder's
--    area/surface tree lives in `estimates.builder_state` (jsonb) with integer
--    node ids; `estimate_areas` / `estimate_lines` exist from the initial
--    schema but nothing in the application reads or writes them.
--
--    So per-node provenance goes INSIDE the jsonb node, as additive fields on
--    the objects the builder already creates:
--
--      { id, kind: "area", name, ..., origin, confidence, assumedFields[] }
--
--    This suits the brief's own first rule better than a side table would: the
--    AI adds fields to the existing tree rather than changing its shape,
--    provenance travels with the node when an area is duplicated, and no
--    migration is needed per node type. Absent `origin` reads as
--    'human_confirmed', so every estimate that exists today is already correct
--    without a backfill.
--
-- 2. `defect_observations` therefore cannot carry FKs to areas/surfaces. It
--    keys by estimate plus the builder's own node ids (`area_ref`,
--    `surface_ref`), which is what identifies a node in a jsonb tree.
--
-- Everything else follows the brief. Nothing here prices anything: pricing
-- stays in lib/pricing/, which is the only thing that computes money.
-- =============================================================================

-- ---- estimates: where a draft came from, and whether it may be sent ---------
alter table public.estimates
  add column if not exists source text not null default 'manual'
    check (source in ('manual', 'ai_floorplan', 'customer_intake')),
  add column if not exists requires_site_check boolean not null default false,
  add column if not exists site_check_cleared_by uuid references auth.users (id),
  add column if not exists site_check_cleared_at timestamptz;

comment on column public.estimates.requires_site_check is
  'Set on every AI-drafted EXTERIOR estimate. Clearing it is a deliberate, logged act - a photo-and-plan estimate is a defensible rough order, not a fixed price sight-unseen.';

-- ---- uploaded source documents ---------------------------------------------
create table if not exists public.estimate_sources (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid references public.estimates (id) on delete cascade,
  kind text not null check (kind in
    ('floorplan', 'site_plan', 'elevation', 'exterior_photo', 'defect_photo', 'listing', 'aerial')),
  storage_path text not null,
  page_no int,
  mime_type text,
  byte_size int,
  -- Set by the deterministic classifier in lib/extract/normalise.ts, so a page
  -- can be routed (interior pipeline vs exterior) before any model call.
  page_class text check (page_class in
    ('floorplan_interior', 'site_plan', 'elevation', 'photo', 'other')),
  page_class_confidence numeric,
  -- Text layer lifted straight out of a vector PDF. When this is present the
  -- dimension strings are EXACT rather than read off an image, which is the
  -- single biggest source of extraction error.
  text_layer text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

-- estimate_id is nullable on purpose: a plan is uploaded and read BEFORE there
-- is an estimate to attach it to. Nothing is orphaned - the run row is the
-- handle until apply creates the estimate.
create index if not exists estimate_sources_estimate_idx on public.estimate_sources (estimate_id);
create index if not exists estimate_sources_created_idx on public.estimate_sources (created_at desc);

-- ---- one row per model invocation ------------------------------------------
create table if not exists public.extraction_runs (
  id uuid primary key default gen_random_uuid(),
  estimate_source_id uuid references public.estimate_sources (id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'needs_review', 'applied', 'failed')),
  model text,
  prompt_version text,
  raw_output jsonb,
  validation_report jsonb,
  confidence_summary jsonb,
  input_tokens int,
  output_tokens int,
  cost_cents int,
  error text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists extraction_runs_source_idx on public.extraction_runs (estimate_source_id, status);
create index if not exists extraction_runs_created_idx on public.extraction_runs (created_at desc);

-- ---- the reconciled exterior envelope, one row per estimate -----------------
create table if not exists public.exterior_envelopes (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid references public.estimates (id) on delete cascade unique,
  footprint_source text not null default 'floorplan'
    check (footprint_source in ('floorplan', 'aerial', 'manual')),
  perimeter_m numeric,
  perimeter_origin text,
  perimeter_confidence numeric,
  max_width_m numeric,
  max_depth_m numeric,
  storeys int,
  wall_height_m numeric,
  wall_height_origin text,
  wall_height_method text,
  wall_height_confidence numeric,
  wall_height_methods jsonb,          -- every method's reading, for the cross-check UI
  substrate text,
  substrate_secondary text,
  roof_form text,
  roof_form_origin text,
  gable_count int,
  pitch_bracket text,
  pitch_deg_used numeric,
  eave_type text,
  eave_width_mm int,
  soffit_convention text check (soffit_convention in ('soffit_m2', 'eave_lineal')),
  access text[] not null default '{}',
  features text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists t_exterior_envelopes_updated on public.exterior_envelopes;
create trigger t_exterior_envelopes_updated before update on public.exterior_envelopes
  for each row execute function public.set_updated_at();

-- ---- defects ----------------------------------------------------------------
create table if not exists public.defect_observations (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid references public.estimates (id) on delete cascade,
  -- The builder's own node ids within estimates.builder_state. Text, because
  -- the builder numbers nodes per estimate; not an FK, because there is no
  -- areas/surfaces table to point at.
  area_ref text,
  surface_ref text,
  estimate_source_id uuid references public.estimate_sources (id),
  defect_type text not null check (defect_type in (
    'peeling', 'flaking', 'water_damage', 'mould', 'plaster_cracks', 'holes_dents',
    'timber_rot', 'rust', 'nicotine_staining', 'previous_poor_finish',
    'render_cracks', 'efflorescence')),
  surface_hint text,
  extent_value numeric check (extent_value is null or extent_value >= 0),
  extent_unit text check (extent_unit is null or extent_unit in ('m2', 'lin_m', 'each')),
  severity int check (severity between 1 and 3),
  reference_object_present boolean not null default false,
  prep_hours numeric not null default 0 check (prep_hours >= 0),
  remediation text[] not null default '{}',
  origin text not null default 'ai_assumed'
    check (origin in ('ai_extracted', 'ai_derived', 'ai_assumed', 'human_confirmed')),
  confirmed_by uuid references auth.users (id),
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists defect_observations_estimate_idx
  on public.defect_observations (estimate_id, area_ref);

-- ---- settings you own, versioned like rate_cards ----------------------------
create table if not exists public.room_type_scope_rules (
  id uuid primary key default gen_random_uuid(),
  version int not null,
  room_type text not null,
  surface_type text not null,
  is_option boolean not null default false,
  requires_confirm boolean not null default false,
  notes text
);
create table if not exists public.room_name_aliases (
  id uuid primary key default gen_random_uuid(),
  version int not null,
  alias text not null,
  room_type text not null
);
create table if not exists public.defect_prep_rates (
  id uuid primary key default gen_random_uuid(),
  version int not null,
  defect_type text not null,
  unit text not null,
  hours_sev1 numeric not null,
  hours_sev2 numeric not null,
  hours_sev3 numeric not null
);
create table if not exists public.measurement_units (
  id uuid primary key default gen_random_uuid(),
  version int not null,
  unit_key text not null,
  label text not null,
  size_mm numeric not null,
  tolerance_pct numeric not null default 5,
  applies_to_substrate text[]
);
create unique index if not exists room_type_scope_rules_unique
  on public.room_type_scope_rules (version, room_type, surface_type);
create unique index if not exists room_name_aliases_unique
  on public.room_name_aliases (version, alias);
create unique index if not exists defect_prep_rates_unique
  on public.defect_prep_rates (version, defect_type);
create unique index if not exists measurement_units_unique
  on public.measurement_units (version, unit_key);

-- ---- RLS --------------------------------------------------------------------
-- Every one of these tables carries either commercial data (cost, confidence)
-- or the customer's own property. None is left open.
alter table public.estimate_sources     enable row level security;
alter table public.extraction_runs      enable row level security;
alter table public.exterior_envelopes   enable row level security;
alter table public.defect_observations  enable row level security;
alter table public.room_type_scope_rules enable row level security;
alter table public.room_name_aliases    enable row level security;
alter table public.defect_prep_rates    enable row level security;
alter table public.measurement_units    enable row level security;

-- Staff only, all four working tables. Deliberately NOT extended to customers
-- or contractors in P0: extraction_runs carry model cost and confidence, and
-- the source documents carry the customer's floorplan. When the customer intake
-- surface arrives (P7) it gets its own narrow policy, written then.
drop policy if exists estimate_sources_staff on public.estimate_sources;
create policy estimate_sources_staff on public.estimate_sources for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists extraction_runs_staff on public.extraction_runs;
create policy extraction_runs_staff on public.extraction_runs for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists exterior_envelopes_staff on public.exterior_envelopes;
create policy exterior_envelopes_staff on public.exterior_envelopes for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists defect_observations_staff on public.defect_observations;
create policy defect_observations_staff on public.defect_observations for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- Reference data: staff maintain it, everyone signed in may read it (the
-- builder needs the alias map and scope rules to render).
drop policy if exists room_type_scope_rules_read on public.room_type_scope_rules;
create policy room_type_scope_rules_read on public.room_type_scope_rules for select to authenticated using (true);
drop policy if exists room_type_scope_rules_staff on public.room_type_scope_rules;
create policy room_type_scope_rules_staff on public.room_type_scope_rules for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists room_name_aliases_read on public.room_name_aliases;
create policy room_name_aliases_read on public.room_name_aliases for select to authenticated using (true);
drop policy if exists room_name_aliases_staff on public.room_name_aliases;
create policy room_name_aliases_staff on public.room_name_aliases for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists defect_prep_rates_read on public.defect_prep_rates;
create policy defect_prep_rates_read on public.defect_prep_rates for select to authenticated using (true);
drop policy if exists defect_prep_rates_staff on public.defect_prep_rates;
create policy defect_prep_rates_staff on public.defect_prep_rates for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists measurement_units_read on public.measurement_units;
create policy measurement_units_read on public.measurement_units for select to authenticated using (true);
drop policy if exists measurement_units_staff on public.measurement_units;
create policy measurement_units_staff on public.measurement_units for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- ---- storage: the uploaded plans and photos ---------------------------------
-- PRIVATE. A floorplan is the customer's home with the room names on it; it is
-- read through short-lived signed URLs, never a public URL. Limits are set on
-- the bucket itself, the same pattern as migration 20260905000000 - Storage
-- refuses an oversized or wrong-typed file whether or not a browser is involved.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('estimate-sources', 'estimate-sources', false, 26214400, array[
  'application/pdf',
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'
])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists estimate_sources_objects_read   on storage.objects;
drop policy if exists estimate_sources_objects_write  on storage.objects;
drop policy if exists estimate_sources_objects_update on storage.objects;
drop policy if exists estimate_sources_objects_delete on storage.objects;

create policy estimate_sources_objects_read on storage.objects for select to authenticated
  using (bucket_id = 'estimate-sources' and public.is_staff());
create policy estimate_sources_objects_write on storage.objects for insert to authenticated
  with check (bucket_id = 'estimate-sources' and public.is_staff());
create policy estimate_sources_objects_update on storage.objects for update to authenticated
  using (bucket_id = 'estimate-sources' and public.is_staff());
create policy estimate_sources_objects_delete on storage.objects for delete to authenticated
  using (bucket_id = 'estimate-sources' and public.is_staff());

-- ---- Verification -----------------------------------------------------------
--   select id, public, file_size_limit from storage.buckets where id = 'estimate-sources';
--   select tablename, rowsecurity from pg_tables
--    where schemaname = 'public'
--      and tablename in ('estimate_sources','extraction_runs','exterior_envelopes',
--                        'defect_observations','room_type_scope_rules','room_name_aliases',
--                        'defect_prep_rates','measurement_units');
-- Every row must show rowsecurity = true. As a CONTRACTOR, this must return no
-- rows (they must never see model cost or confidence data):
--   select * from extraction_runs;
