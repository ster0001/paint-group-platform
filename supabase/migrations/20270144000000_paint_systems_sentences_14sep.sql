-- Tom, 14 Sep 2026 (tighten batch, items 9–11): the What-we'll-do wording.
--   walls  · new colour: "…then two coats of water based acrylic"
--   trims  · new colour: "Sand and clean, fill any dents, then {coats} of {enamel}."
--   doors  · new colour: "Both sides and edges, we will mask off or remove hardware, followed by {coats} of {enamel}."
-- `{coats}` / `{enamel}` are filled by the engine from the customer's answers
-- (two coats / an undercoat and two coats; water-based / oil-based enamel).
--
-- A SAVED Settings → Paint systems row overrides the code default cell by
-- cell, so a row saved earlier still carries the old sentences. Data only;
-- touches ONLY cells still holding the previous default sentence. Safe to
-- run twice. Verify the project first: select count(*) from auth.users
-- (test ≈ 8,750, prod ≈ 801 — prod had NO row on 14 Sep).
update settings
set value = jsonb_set(value, '{walls,new,sentence}', to_jsonb('New colour. Fill nail holes and hairline cracks, light sand, spot-prime the fills, then two coats of water based acrylic.'::text))
where key = 'paint_systems'
  and value->'walls'->'new'->>'sentence' = 'New colour. Fill nail holes and hairline cracks, light sand, spot-prime the fills, then two coats of low-sheen.';

update settings
set value = jsonb_set(value, '{trims,new,sentence}', to_jsonb('Sand and clean, fill any dents, then {coats} of {enamel}.'::text))
where key = 'paint_systems'
  and value->'trims'->'new'->>'sentence' = 'New colour. Sand and clean, fill any dents, then two coats of enamel.';

update settings
set value = jsonb_set(value, '{doors,new,sentence}', to_jsonb('Both sides and edges, we will mask off or remove hardware, followed by {coats} of {enamel}.'::text))
where key = 'paint_systems'
  and value->'doors'->'new'->>'sentence' = 'As the trims. Both sides, edges and frame — two coats of enamel.';

select value->'walls'->'new'->>'sentence' as walls_new, value->'trims'->'new'->>'sentence' as trims_new, value->'doors'->'new'->>'sentence' as doors_new
from settings where key = 'paint_systems';

-- Registers itself in the production ledger (added 16 Sep 2026: this file
-- shipped without it, so `select … from public._prod_migrations` could not say
-- whether it was live — see docs/ARCHITECTURE.md, the invoicing read-failure note).
insert into public._prod_migrations(name) values ('20270144000000_paint_systems_sentences_14sep.sql') on conflict (name) do nothing;
