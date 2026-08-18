-- =============================================================================
-- Master build plan Step 3 - shared scope foundations.
--
-- Three additions, all additive and safe to run on live:
--
--   1. Tile metadata on room_type_scope_rules, so the SAME table that drives
--      the AI plan reader also drives the capture-mode tile grid (one table,
--      two features - the plan's explicit shared foundation). Backfills v3.
--
--   2. estimates.storey_heights - the one ceiling-height model. Jsonb map of
--      storey name -> metres, e.g. {"ground": 2.4, "first": 2.6}. The plan
--      reader's single ceilingHeightM becomes the "ground" entry; per-storey
--      values arrive with the room-loop (Step 4) and the wizard (Step 7).
--      Null on old rows = legacy single-height estimate; code falls back.
--
--   3. area_name_presets - the AreaPicker vocabulary (room-loop brief section
--      2), versioned like the other extraction Settings tables so Tom edits
--      it in Settings without a deploy.
-- =============================================================================

-- ---- 1. tile metadata on the rules table ------------------------------------

alter table public.room_type_scope_rules
  add column if not exists countable boolean not null default false,
  add column if not exists tile_group text not null default 'core',
  add column if not exists sort_order int not null default 0;

-- Backfill the live v3 rules. Grouping and order per the room-loop brief
-- section 5: core -> openings -> joinery -> extras.
update public.room_type_scope_rules set tile_group = 'core',     sort_order = 10, countable = false where version = 3 and surface_type = 'Walls';
update public.room_type_scope_rules set tile_group = 'core',     sort_order = 20, countable = false where version = 3 and surface_type = 'Ceiling';
update public.room_type_scope_rules set tile_group = 'core',     sort_order = 30, countable = false where version = 3 and surface_type = 'Cornices';
update public.room_type_scope_rules set tile_group = 'core',     sort_order = 40, countable = false where version = 3 and surface_type = 'Skirting Boards';
update public.room_type_scope_rules set tile_group = 'openings', sort_order = 50, countable = true  where version = 3 and surface_type = 'Door & Frame';
update public.room_type_scope_rules set tile_group = 'openings', sort_order = 60, countable = true  where version = 3 and surface_type = 'Windows';
update public.room_type_scope_rules set tile_group = 'joinery',  sort_order = 70, countable = true  where version = 3 and surface_type = 'Cabinets';
update public.room_type_scope_rules set tile_group = 'joinery',  sort_order = 80, countable = true  where version = 3 and surface_type = 'Shelving';

-- ---- 2. the one ceiling-height model ----------------------------------------

alter table public.estimates
  add column if not exists storey_heights jsonb;

comment on column public.estimates.storey_heights is
  'Storey name -> ceiling height in metres, e.g. {"ground":2.4,"first":2.6}. Null = legacy estimate priced from a single height.';

-- ---- 3. AreaPicker vocabulary ------------------------------------------------

create table if not exists public.area_name_presets (
  id uuid primary key default gen_random_uuid(),
  version int not null,
  estimate_type text not null check (estimate_type in ('interior','exterior','commercial')),
  name text not null,
  room_type text not null,
  sort_order int not null default 0
);

create unique index if not exists area_name_presets_unique
  on public.area_name_presets (version, estimate_type, name);

alter table public.area_name_presets enable row level security;

drop policy if exists area_name_presets_read on public.area_name_presets;
create policy area_name_presets_read on public.area_name_presets
  for select to authenticated using (true);
drop policy if exists area_name_presets_staff on public.area_name_presets;
create policy area_name_presets_staff on public.area_name_presets
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- Seed v1 - the brief's interior and exterior vocabularies, in tap order.
insert into public.area_name_presets (version, estimate_type, name, room_type, sort_order) values
  (1, 'interior', 'Kitchen',    'kitchen',  10),
  (1, 'interior', 'Lounge',     'living',   20),
  (1, 'interior', 'Living',     'living',   30),
  (1, 'interior', 'Dining',     'dining',   40),
  (1, 'interior', 'Bedroom',    'bedroom',  50),
  (1, 'interior', 'Master Bedroom', 'bedroom', 60),
  (1, 'interior', 'Bathroom',   'bathroom', 70),
  (1, 'interior', 'Ensuite',    'bathroom', 80),
  (1, 'interior', 'Hallway',    'hallway',  90),
  (1, 'interior', 'Stairwell',  'hallway',  100),
  (1, 'interior', 'Laundry',    'laundry',  110),
  (1, 'interior', 'WC',         'wc',       120),
  (1, 'interior', 'Study',      'study',    130),
  (1, 'interior', 'Garage',     'garage',   140),
  (1, 'exterior', 'Front',      'exterior_elevation', 10),
  (1, 'exterior', 'Left Side',  'exterior_elevation', 20),
  (1, 'exterior', 'Right Side', 'exterior_elevation', 30),
  (1, 'exterior', 'Rear',       'exterior_elevation', 40),
  (1, 'exterior', 'Whole House','exterior_elevation', 50),
  (1, 'exterior', 'Fence',      'exterior_other', 60),
  (1, 'exterior', 'Deck',       'exterior_other', 70),
  (1, 'exterior', 'Garage',     'exterior_other', 80)
on conflict (version, estimate_type, name) do nothing;

-- ---- Verification ------------------------------------------------------------
-- select surface_type, tile_group, sort_order, countable
--   from room_type_scope_rules where version = 3 and room_type = 'bedroom' order by sort_order;
--   -> Walls/Ceiling/Cornices/Skirting core 10..40, Door & Frame + Windows openings countable
-- select count(*) from area_name_presets where version = 1;      -- expect 22
-- select storey_heights from estimates limit 1;                  -- column exists, null
