-- =============================================================================
-- Add an 'Brick (Unpainted)' exterior cladding substrate at THREE COATS
-- (Tom, 21 Aug 2026: "add unpainted brick as an option in the builder
-- (3 x coats)").
--
-- Painted brick already exists (20260919) and prices like render at two
-- coats. Bare, never-painted brick is a different job: it drinks the first
-- coat, so it is sealed and then given two topcoats. Same production rates
-- per coat — the difference is the COAT COUNT, which the engine already
-- prices (rate_3_coat, and coatMultiplier above three).
--
-- default_coats carries that: it is the column the builder now seeds a new
-- surface's coats from, so picking this substrate lands on 3 without anyone
-- remembering to change it.
--
-- Idempotent: does nothing if the row already exists on the active card.
-- =============================================================================

insert into public.rate_items
  (rate_card_id, code, category, sub_category, unit,
   rate_1_coat, rate_2_coat, rate_3_coat, default_coats, charge_out_cents,
   default_product, metres_per_litre, litres_per_item_per_coat)
select r.rate_card_id, 'Brick (Unpainted)', r.category, r.sub_category, r.unit,
       r.rate_1_coat, r.rate_2_coat, r.rate_3_coat, 3, r.charge_out_cents,
       r.default_product, r.metres_per_litre, r.litres_per_item_per_coat
  from public.rate_items r
  join public.rate_cards c on c.id = r.rate_card_id
 where c.is_active = true
   and r.code = 'Brick'
   and not exists (
     select 1 from public.rate_items b
      where b.rate_card_id = r.rate_card_id and b.code = 'Brick (Unpainted)'
   );

-- Painted brick keeps the ordinary two coats. Stated rather than assumed, so
-- the two rows read as a deliberate pair on the Settings rate-card screen.
update public.rate_items ri set default_coats = 2
  from public.rate_cards c
 where c.id = ri.rate_card_id and c.is_active = true
   and ri.code = 'Brick' and ri.default_coats is distinct from 2;

-- ---- Verification -----------------------------------------------------------
-- select code, category, sub_category, unit, default_coats, rate_2_coat, rate_3_coat
--   from rate_items ri join rate_cards rc on rc.id = ri.rate_card_id
--  where rc.is_active and ri.code like 'Brick%' order by code;
--   -> 'Brick' default_coats 2, 'Brick (Unpainted)' default_coats 3, same rates.
