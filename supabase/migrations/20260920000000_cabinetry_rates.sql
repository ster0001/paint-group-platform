-- =============================================================================
-- R3 (rebuild addendum §2): the CABINETRY substrate family, priced per
-- door/drawer front. Three new rate items on the ACTIVE card:
--
--   Kitchen Cupboard Front   ~ $85 per front at 2 coats (indicative default)
--   Robe Door                ~ $140 per door
--   Vanity Door              ~ $95 per door
--
-- Rates are HOURS per item (like every per-item line); the hours are derived
-- from the card's own charge-out so the 2-coat price lands on the indicative
-- defaults above. Edit in Settings like everything else — these are starting
-- values for the proving window, not gospel.
--
-- The template row is the active card's flat door (same unit family). Spray-
-- finish note rides the customer copy, not the rate.
--
-- Idempotent: skips any code that already exists on the active card.
-- =============================================================================

insert into public.rate_items
  (rate_card_id, code, category, sub_category, unit,
   rate_1_coat, rate_2_coat, rate_3_coat, default_coats, charge_out_cents,
   default_product, metres_per_litre, litres_per_item_per_coat)
select r.rate_card_id, v.code, 'Interior', 'Cabinetry', r.unit,
       round((v.cents::numeric / nullif(r.charge_out_cents, 0)) * 0.6, 3),
       round((v.cents::numeric / nullif(r.charge_out_cents, 0)), 3),
       round((v.cents::numeric / nullif(r.charge_out_cents, 0)) * 1.4, 3),
       2, r.charge_out_cents,
       r.default_product, r.metres_per_litre, r.litres_per_item_per_coat
  from public.rate_items r
  join public.rate_cards c on c.id = r.rate_card_id
 cross join (values
   ('Kitchen Cupboard Front', 8500),
   ('Robe Door',             14000),
   ('Vanity Door',            9500)
 ) as v(code, cents)
 where c.is_active = true
   and r.code = 'Flat Door and Frame (1 Side)'
   and not exists (
     select 1 from public.rate_items b
      where b.rate_card_id = r.rate_card_id and b.code = v.code
   );

-- ---- Verification -----------------------------------------------------------
-- select code, unit, rate_2_coat, charge_out_cents,
--        round(rate_2_coat * charge_out_cents / 100.0) as approx_2coat_dollars
--   from rate_items ri join rate_cards rc on rc.id = ri.rate_card_id
--  where rc.is_active and ri.sub_category = 'Cabinetry' order by code;
--   -> three rows, approx 85 / 140 / 95 dollars.
