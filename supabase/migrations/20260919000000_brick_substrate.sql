-- =============================================================================
-- Add a 'Brick' exterior cladding substrate, duplicating 'Render' (Tom, 20 Aug
-- 2026). Painted brick had no rate item, so the envelope deferred it to a human
-- price; now it prices like render. Added to the ACTIVE rate card only.
--
-- Idempotent: does nothing if a Brick row already exists on the active card.
-- =============================================================================

insert into public.rate_items
  (rate_card_id, code, category, sub_category, unit,
   rate_1_coat, rate_2_coat, rate_3_coat, default_coats, charge_out_cents,
   default_product, metres_per_litre, litres_per_item_per_coat)
select r.rate_card_id, 'Brick', r.category, r.sub_category, r.unit,
       r.rate_1_coat, r.rate_2_coat, r.rate_3_coat, r.default_coats, r.charge_out_cents,
       r.default_product, r.metres_per_litre, r.litres_per_item_per_coat
  from public.rate_items r
  join public.rate_cards c on c.id = r.rate_card_id
 where c.is_active = true
   and r.code = 'Render'
   and not exists (
     select 1 from public.rate_items b
      where b.rate_card_id = r.rate_card_id and b.code = 'Brick'
   );

-- ---- Verification -----------------------------------------------------------
-- select code, category, sub_category, rate_1_coat, rate_2_coat, charge_out_cents
--   from rate_items ri join rate_cards rc on rc.id = ri.rate_card_id
--  where rc.is_active and ri.code in ('Render','Brick') order by code;
--   -> two rows with identical rates.
