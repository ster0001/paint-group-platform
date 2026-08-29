-- =============================================================================
-- Add a 'Concrete / Tilt Slab' exterior wall substrate, priced as a clone of
-- Render (Tom, 29 Aug 2026: "add another substrate for tilt slab/concrete in
-- the wizard, and duplicate render").
--
-- Tilt slab / precast concrete panel is prepared and coated like render, so
-- every rate on the row is copied from Render on the ACTIVE card. It gets its
-- OWN code rather than riding Render's, because a customer who ticks "tilt
-- slab" must not find "Render" in the builder — the same lesson as the winder
-- window that came back as "Awning / Casement Window".
--
-- Until this runs, the substrate registry simply does not offer it (a tick
-- that cannot price is never offered): the wizard's exterior page hides the
-- tile and the sides editor never lists it. Nothing else changes.
--
-- Idempotent: does nothing if the row already exists on the active card.
-- =============================================================================

insert into public.rate_items
  (rate_card_id, code, category, sub_category, unit,
   rate_1_coat, rate_2_coat, rate_3_coat, default_coats, charge_out_cents,
   default_product, metres_per_litre, litres_per_item_per_coat)
select r.rate_card_id, 'Concrete / Tilt Slab', r.category, r.sub_category, r.unit,
       r.rate_1_coat, r.rate_2_coat, r.rate_3_coat, coalesce(r.default_coats, 2), r.charge_out_cents,
       r.default_product, r.metres_per_litre, r.litres_per_item_per_coat
  from public.rate_items r
  join public.rate_cards c on c.id = r.rate_card_id
 where c.is_active = true
   and r.code = 'Render'
   and not exists (
     select 1 from public.rate_items t
      where t.rate_card_id = r.rate_card_id and t.code = 'Concrete / Tilt Slab'
   );

-- ---- Verification -----------------------------------------------------------
-- select code, category, sub_category, unit, default_coats,
--        rate_1_coat, rate_2_coat, rate_3_coat, charge_out_cents
--   from rate_items ri join rate_cards rc on rc.id = ri.rate_card_id
--  where rc.is_active and ri.code in ('Render', 'Concrete / Tilt Slab')
--  order by code;
--   -> two rows, identical in every rate column.
