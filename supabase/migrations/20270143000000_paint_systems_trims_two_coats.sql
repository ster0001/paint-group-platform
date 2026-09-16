-- Tom, 14 Sep 2026: trims and doors on a colour change are TWO coats as
-- standard (the undercoat is earned by an oil enamel underneath, by raw or
-- stained timber, or by going much lighter). The code default changed in the
-- same commit; a SAVED Settings → Estimates → Paint systems row overrides the
-- default cell by cell, so a row saved before today still says three.
--
-- Data only. Touches ONLY the two cells that still hold the old default
-- sentence — a cell Tom edited by hand is left exactly as it is.
-- Safe to run twice. Verify the project first: select count(*) from auth.users
-- (test ≈ 8,750, prod ≈ 801).
update settings
set value = jsonb_set(value, '{trims,new}',
  '{"coats": 2, "undercoat": false, "sentence": "New colour. Sand and clean, fill any dents, then two coats of enamel."}'::jsonb)
where key = 'paint_systems'
  and value->'trims'->'new'->>'sentence' = 'New colour. Sand and clean, fill any dents, then an undercoat and two coats of water-based enamel.';

update settings
set value = jsonb_set(value, '{doors,new}',
  '{"coats": 2, "undercoat": false, "sentence": "As the trims. Both sides, edges and frame — two coats of enamel."}'::jsonb)
where key = 'paint_systems'
  and value->'doors'->'new'->>'sentence' = 'As the trims. Both sides, edges and frame — an undercoat and two coats of water-based enamel.';

-- What it did:
select value->'trims'->'new' as trims_new, value->'doors'->'new' as doors_new from settings where key = 'paint_systems';

-- Registers itself in the production ledger (added 16 Sep 2026: this file
-- shipped without it, so `select … from public._prod_migrations` could not say
-- whether it was live — see docs/ARCHITECTURE.md, the invoicing read-failure note).
insert into public._prod_migrations(name) values ('20270143000000_paint_systems_trims_two_coats.sql') on conflict (name) do nothing;
