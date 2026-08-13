-- =============================================================================
-- Save & load support for the quote builder.
-- The builder holds richer inputs than the normalized columns (job modifiers,
-- per-surface overrides, line-item modes). We store the full builder state as
-- JSON so a saved quote reloads exactly, while the summary columns
-- (level_of_finish, totals) stay populated for lists and reporting.
-- =============================================================================

alter table public.estimates
  add column if not exists title         text,
  add column if not exists builder_state jsonb;

-- The rate card offers a Level 1 finish, so allow 1–4 (was 2–4).
alter table public.estimates drop constraint if exists estimates_level_of_finish_values;
alter table public.estimates
  add constraint estimates_level_of_finish_values
  check (level_of_finish is null or level_of_finish in (1, 2, 3, 4));
