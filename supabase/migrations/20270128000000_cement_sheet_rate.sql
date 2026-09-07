-- =============================================================================
-- Add a 'Cement Sheet' exterior wall substrate, priced as a clone of Render
-- (Tom, 7 Sep 2026: the exterior question set asks "what is the house made
-- of — render, weatherboards, brick, stucco, cement sheet, colorbond, other").
--
-- Cement sheet is prepared and coated like render, so every rate on the row
-- is copied from Render on the ACTIVE card — the same pattern as tilt slab /
-- concrete (migration 20261204). It gets its OWN code so a customer who ticks
-- "cement sheet" never finds "Render" in the builder.
--
-- Until this runs, the substrate registry simply does not offer it (a tick
-- that cannot price is never offered): the wizard hides the tile and the
-- sides editor never lists it. Stucco and Colorbond already have their own
-- rows ("Stucco", "Colorbond Cladding") and need nothing here.
--
-- Idempotent: does nothing if the row already exists on the active card.
-- =============================================================================

insert into public.rate_items
  (rate_card_id, code, category, sub_category, unit,
   rate_1_coat, rate_2_coat, rate_3_coat, default_coats, charge_out_cents,
   default_product, metres_per_litre, litres_per_item_per_coat)
select r.rate_card_id, 'Cement Sheet', r.category, r.sub_category, r.unit,
       r.rate_1_coat, r.rate_2_coat, r.rate_3_coat, coalesce(r.default_coats, 2), r.charge_out_cents,
       r.default_product, r.metres_per_litre, r.litres_per_item_per_coat
  from public.rate_items r
  join public.rate_cards c on c.id = r.rate_card_id
 where c.is_active = true
   and r.code = 'Render'
   and not exists (
     select 1 from public.rate_items t
      where t.rate_card_id = r.rate_card_id and t.code = 'Cement Sheet'
   );

-- ---- Verification (read this back, don't assume) ----------------------------
select code, category, sub_category, unit, default_coats,
       rate_1_coat, rate_2_coat, rate_3_coat, charge_out_cents
  from public.rate_items ri join public.rate_cards rc on rc.id = ri.rate_card_id
 where rc.is_active and ri.code in ('Render', 'Cement Sheet')
 order by code;
--   -> two rows, identical in every rate column.
