-- =============================================================================
-- Tom's REAL price list (20 Aug 2026) — supersedes 20260921's placeholders.
-- Each priced item honours BOTH columns of the list: rate hours = his "hours
-- to complete", per-item charge-out = price / hours, so price lands exactly
-- and scheduling sees true hours. Litres-per-unit and default product as given.
--
--   Window Shutters  $280 · 3h    · 0.2L · Dulux Weathershield
--   Side Gate        $300 · 3h    · 0.4L · Dulux Weathershield
--   Security Door    $345 · 3.5h  · 0.5L · Dulux Weathershield
--   Meter Box         $65 · 0.5h  · 0.1L · Dulux Weathershield
--   Shed             $640 · 5h    · 4L   · Dulux Weathershield
--   Air Vent (NEW, Interior) $45 · 0.25h · 0.1L · Dulux epoxy enamel
--   Minor Fascia Rot $180 flat (unchanged) · Access $260 flat (unchanged)
--
-- Weathered becomes a ×1.8 CONDITION MODIFIER (not a flat item) — the rate
-- item is deleted and a modifiers row created; the editor selects it when
-- the customer answers "Weathered". Carport was absent from the list → its
-- placeholder item is removed (sweep chip falls back to the amber visit
-- flag). Rear fence: marked remove → chip disappears from the sweep.
-- =============================================================================

update public.rate_items ri set
  rate_1_coat = v.hours, rate_2_coat = v.hours, rate_3_coat = v.hours,
  charge_out_cents = round(v.cents / v.hours),
  litres_per_item_per_coat = v.litres,
  default_product = 'Dulux Weathershield'
from (values
  ('Window Shutters', 28000::numeric, 3.0::numeric,  0.2::numeric),
  ('Side Gate',       30000,          3.0,           0.4),
  ('Security Door',   34500,          3.5,           0.5),
  ('Meter Box',        6500,          0.5,           0.1),
  ('Shed',            64000,          5.0,           4.0)
) as v(code, cents, hours, litres)
join public.rate_cards c on c.is_active
where ri.rate_card_id = c.id and ri.code = v.code;

delete from public.rate_items ri
 using public.rate_cards c
 where ri.rate_card_id = c.id and c.is_active
   and ri.code in ('Carport', 'Weathered Prep Allowance');

insert into public.rate_items
  (rate_card_id, code, category, sub_category, unit,
   rate_1_coat, rate_2_coat, rate_3_coat, default_coats, charge_out_cents,
   default_product, metres_per_litre, litres_per_item_per_coat)
select c.id, 'Air Vent', 'Interior', 'Extras', 'Hours Per Item',
       0.25, 0.25, 0.25, 2, 18000, 'Dulux epoxy enamel', null, 0.1
  from public.rate_cards c
 where c.is_active
   and not exists (
     select 1 from public.rate_items b where b.rate_card_id = c.id and b.code = 'Air Vent'
   );

insert into public.modifiers (code, group_name, label, multiplier, active)
select 'EXT-WEATHERED', 'condition', 'Weathered exterior', 1.8, true
 where not exists (select 1 from public.modifiers where code = 'EXT-WEATHERED');
