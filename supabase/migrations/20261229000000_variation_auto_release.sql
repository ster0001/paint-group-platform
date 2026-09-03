-- =============================================================================
-- Variations reach the painter the moment the customer signs (Tom, 3 Sep 2026)
--
-- "When pricing changes are made in the revision working scope section, as
-- soon as the client approves them, automatically send the variation to the
-- contractor in their home page in the app for their approval."
--
-- The machinery has existed since 20261002: wo_customer_sign_variation reads
-- wo_loop.variationRelease and, when it says "auto", stamps released_at and
-- writes the variation_released event itself. The setting was seeded 'pc'
-- (a human between the two money events) and NOTHING in the product could
-- flip it — so every signed addition sat as "Approved — coming to you" on the
-- painter's job page until someone found the Release button on /pc/wo.
--
-- This is a DATA change only: one key in one settings row. The switch is
-- also on Settings → Automations ("Send approved variations to the painter
-- automatically"), so the office can put a human back in the loop without SQL.
-- Data-only, idempotent, safe to re-run.
-- =============================================================================

update public.settings
   set value = jsonb_set(coalesce(value, '{}'::jsonb), '{variationRelease}', '"auto"'::jsonb, true)
 where key = 'wo_loop';

-- A project seeded before 20260928 has no wo_loop row at all — give it one
-- carrying just this key; wo_loop_setting() reads keys individually.
insert into public.settings (key, value)
select 'wo_loop', jsonb_build_object('variationRelease', 'auto')
 where not exists (select 1 from public.settings where key = 'wo_loop');

-- Read-back: expect exactly one row, variation_release = auto.
select key, value->>'variationRelease' as variation_release
  from public.settings
 where key = 'wo_loop';
