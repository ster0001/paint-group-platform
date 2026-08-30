-- Tom (30 Aug 2026): "In kitchen, in capture view, there is no option to add
-- skirting boards."
--
-- The v3 scope rules deliberately generated no kitchen skirting (0 of 4 real
-- kitchens had it — see scripts/seed-extraction-settings.ts). Tom overrules:
-- the tile must at least be OFFERED. So it lands as an OPTION (is_option =
-- true): a tappable tile in capture and the wizard, never pre-selected and
-- never generated silently by the plan reader.
--
-- Data-only, idempotent.
insert into public.room_type_scope_rules
  (version, room_type, surface_type, is_option, requires_confirm, countable, tile_group, sort_order, notes)
select 3, 'kitchen', 'Skirting Boards', true, false, false, 'core', 40,
       'OPTION - Tom 30 Aug: offer it in capture; evidence said 0/4 kitchens, so never pre-selected'
where not exists (
  select 1 from public.room_type_scope_rules
  where version = 3 and room_type = 'kitchen' and surface_type = 'Skirting Boards'
);

-- Read-back: the kitchen tile set now includes Skirting Boards as an option.
select room_type, surface_type, is_option, countable, tile_group, sort_order
from public.room_type_scope_rules
where version = 3 and room_type = 'kitchen'
order by sort_order;
