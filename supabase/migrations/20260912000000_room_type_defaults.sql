-- =============================================================================
-- Typical room sizes - master build plan Step 3, business inputs section 1
--
-- Tom's owner-supplied typical dimensions per room type, powering the no-plan
-- starter lists and wizard defaults. Wall areas derive from these plus the
-- storey ceiling height.
--
-- ONE FLAGGED DEVIATION from the business-inputs wording: these live in their
-- own table rather than as columns on room_type_scope_rules. That table is one
-- row per room-type x surface, so a per-room-type dimension would be duplicated
-- across every surface row and could drift between them. Same versioning
-- scheme, same Settings ownership, same seed script - just normalised.
-- =============================================================================

create table if not exists public.room_type_defaults (
  id uuid primary key default gen_random_uuid(),
  version int not null,
  room_type text not null,
  typical_length_m numeric not null check (typical_length_m > 0 and typical_length_m <= 30),
  typical_width_m numeric not null check (typical_width_m > 0 and typical_width_m <= 30),
  notes text
);

create unique index if not exists room_type_defaults_unique
  on public.room_type_defaults (version, room_type);

alter table public.room_type_defaults enable row level security;

-- Same policy shape as the other extraction Settings tables: everyone signed
-- in may read (the wizard and builder need them), staff maintain them.
drop policy if exists room_type_defaults_read on public.room_type_defaults;
create policy room_type_defaults_read on public.room_type_defaults
  for select to authenticated using (true);
drop policy if exists room_type_defaults_staff on public.room_type_defaults;
create policy room_type_defaults_staff on public.room_type_defaults
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- ---- Verification -----------------------------------------------------------
-- After running scripts/seed-extraction-settings.ts:
--   select room_type, typical_length_m, typical_width_m
--     from room_type_defaults where version = 3 order by room_type;
-- Expect 7 rows (bedroom 3.5x3.25, living 4x4, open_plan_kitchen_living 6x6,
-- bathroom 2x1.5, laundry 2x1.5, wc 1.25x1, garage 6x4).
