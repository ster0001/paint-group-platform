-- =============================================================================
-- Parity audit STOP-item 1 (Tom's ruling, 20 Aug 2026): the mockups price
-- exterior catalogue items, sweep chips and condition/access allowances that
-- had no rate on the card — so the build flagged them amber for the visit.
-- These nine items let the engine price them exactly like the mockups:
--
--   Window Shutters $240 · Side Gate $120 · Security Door $90 · Meter Box $35
--   Shed $640 · Carport $520                                    (Extras)
--   Weathered Prep $420 · Minor Fascia Rot $180 · Access $260   (Allowances)
--
-- Rear fence needs no new item (Paling Fence rates exist). "Quite a bit" of
-- rot and peeling still route to the visit — those need eyes, not a rate.
-- Hours derive from the active card's charge-out so the 2-coat price lands on
-- the targets; Settings-editable like every rate. Idempotent.
-- =============================================================================

insert into public.rate_items
  (rate_card_id, code, category, sub_category, unit,
   rate_1_coat, rate_2_coat, rate_3_coat, default_coats, charge_out_cents,
   default_product, metres_per_litre, litres_per_item_per_coat)
select r.rate_card_id, v.code, 'Exterior', v.sub_category, r.unit,
       round((v.cents::numeric / nullif(r.charge_out_cents, 0)) * 0.6, 3),
       round((v.cents::numeric / nullif(r.charge_out_cents, 0)), 3),
       round((v.cents::numeric / nullif(r.charge_out_cents, 0)) * 1.4, 3),
       2, r.charge_out_cents,
       r.default_product, r.metres_per_litre, r.litres_per_item_per_coat
  from public.rate_items r
  join public.rate_cards c on c.id = r.rate_card_id
 cross join (values
   ('Window Shutters',            24000, 'Extras'),
   ('Side Gate',                  12000, 'Extras'),
   ('Security Door',               9000, 'Extras'),
   ('Meter Box',                   3500, 'Extras'),
   ('Shed',                       64000, 'Extras'),
   ('Carport',                    52000, 'Extras'),
   ('Weathered Prep Allowance',   42000, 'Allowances'),
   ('Minor Fascia Rot Allowance', 18000, 'Allowances'),
   ('Access Allowance',           26000, 'Allowances')
 ) as v(code, cents, sub_category)
 where c.is_active = true
   and r.code = 'Fascias'
   and not exists (
     select 1 from public.rate_items b
      where b.rate_card_id = r.rate_card_id and b.code = v.code
   );

-- ---- Verification -----------------------------------------------------------
-- select ri.code, round(ri.rate_2_coat * ri.charge_out_cents / 100.0) as dollars
--   from rate_items ri join rate_cards rc on rc.id = ri.rate_card_id
--  where rc.is_active and ri.sub_category in ('Extras','Allowances') order by 1;
--   -> nine rows at ~240/120/90/35/640/520/420/180/260.
