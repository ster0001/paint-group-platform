-- 20270317 · Site allowances by job size (go-live brief s3.3, 18 Nov 2026) — EXPLICIT values on every saved pricing state.
--
-- From this release the engine reads a NULL preparationHours / preparationOverrideCents / cleaningHours
-- as THE JOB-SIZE SCALE (lib/pricing/allowances.ts). Until now null meant 0 hours and the two flat
-- Settings sundries rows. So before the engine ships, every pricing state that exists gets the figures
-- it prices at today written down, so nothing already priced moves by a cent:
--   preparationHours         = its current value, else 0
--   preparationOverrideCents = its current value, else the flat Settings sundries for its interior /
--                              exterior mix (the sum when both sides exist; 0 when no block prices)
--   cleaningHours            = 0
-- Three places hold a pricing state: estimates.builder_state, and for an accepted job with a work order
-- wo_working_scopes.accepted_state and .working_state (the revisions). All three are pinned.
-- Accepted estimates are frozen by estimate_frozen_guard; estimates.options = on is its own bypass for
-- a change that moves nothing, set for this session and reset at the end. The working scopes have their
-- own guard (wo_working_scope_guard, no bypass): its trigger is disabled for the one update and re-enabled.
-- Converges: a state that already carries cleaningHours is left alone. Templates (settings.estimate_templates)
-- are left alone on purpose — a new estimate from a template takes the scale.
-- Paste with the engine change deployed AFTER it, never before. The before/after report
-- (docs/testing/allowances-before-after-18nov.md) is the proof it moves nothing.

set lock_timeout = '15s';
set estimates.options = 'on';

create or replace function pg_temp.pin_site_allowances(state jsonb, interior_dollars numeric, exterior_dollars numeric)
returns jsonb
language sql
immutable
as $$
  select case
    when state is null or jsonb_typeof(state) <> 'object' or (state ? 'cleaningHours') then state
    else state || jsonb_build_object(
      'preparationHours',
        coalesce(case when jsonb_typeof(state->'preparationHours') = 'number' then (state->>'preparationHours')::numeric end, 0),
      'preparationOverrideCents',
        coalesce(case when jsonb_typeof(state->'preparationOverrideCents') = 'number' then (state->>'preparationOverrideCents')::numeric end,
          round((
            (case when jsonb_path_exists(state, '$.blocks[*] ? (@.type == "Interior" && (!exists(@.isOption) || @.isOption == false))') then interior_dollars else 0 end)
          + (case when jsonb_path_exists(state, '$.blocks[*] ? (@.type != "Interior" && (!exists(@.isOption) || @.isOption == false))') then exterior_dollars else 0 end)
          ) * 100)),
      'cleaningHours', 0)
  end
$$;

create or replace function pg_temp.flat_sundries_dollars(k text)
returns numeric
language sql
stable
as $$
  select coalesce((select (case when jsonb_typeof(value) = 'object' then value->>'value' else value #>> '{}' end)::numeric
                   from public.settings where key = k), 0)
$$;

update public.estimates
set builder_state = pg_temp.pin_site_allowances(builder_state,
      pg_temp.flat_sundries_dollars('Sundries per job — interior'), pg_temp.flat_sundries_dollars('Sundries per job — exterior'))
where builder_state is not null and jsonb_typeof(builder_state) = 'object' and not (builder_state ? 'cleaningHours');

-- wo_working_scope_guard freezes accepted_state for everyone but service_role and has no setting to bypass;
-- the SQL editor runs as postgres, so the trigger is switched off for this one update and back on after.
alter table public.wo_working_scopes disable trigger wo_working_scopes_baseline;

update public.wo_working_scopes
set accepted_state = pg_temp.pin_site_allowances(accepted_state,
      pg_temp.flat_sundries_dollars('Sundries per job — interior'), pg_temp.flat_sundries_dollars('Sundries per job — exterior')),
    working_state = pg_temp.pin_site_allowances(working_state,
      pg_temp.flat_sundries_dollars('Sundries per job — interior'), pg_temp.flat_sundries_dollars('Sundries per job — exterior'))
where (accepted_state is not null and jsonb_typeof(accepted_state) = 'object' and not (accepted_state ? 'cleaningHours'))
   or (working_state is not null and jsonb_typeof(working_state) = 'object' and not (working_state ? 'cleaningHours'));

alter table public.wo_working_scopes enable trigger wo_working_scopes_baseline;
reset estimates.options;

-- ---- read-back: ONE row, every column equals its _expect_ -----------------------------
select
  (select count(*) from public.estimates where builder_state is not null and jsonb_typeof(builder_state) = 'object') as estimates_with_state,
  (select count(*) from public.estimates where builder_state is not null and jsonb_typeof(builder_state) = 'object'
     and (builder_state ? 'cleaningHours') and jsonb_typeof(builder_state->'preparationHours') = 'number'
     and jsonb_typeof(builder_state->'preparationOverrideCents') = 'number') as estimates_pinned,
  (select count(*) from public.wo_working_scopes where working_state is not null and jsonb_typeof(working_state) = 'object') as scopes_with_state,
  (select count(*) from public.wo_working_scopes where working_state is not null and jsonb_typeof(working_state) = 'object'
     and (working_state ? 'cleaningHours') and (accepted_state is null or (accepted_state ? 'cleaningHours'))) as scopes_pinned,
  (select tgenabled from pg_trigger where tgrelid = 'public.wo_working_scopes'::regclass and tgname = 'wo_working_scopes_baseline') as scope_guard_enabled, 'O' as _expect_scope_guard_enabled,
  'estimates_pinned must equal estimates_with_state, and scopes_pinned must equal scopes_with_state' as _expect_equal_pairs;

insert into public._prod_migrations(name) values ('20270317000000_site_allowances_explicit.sql') on conflict (name) do nothing;
