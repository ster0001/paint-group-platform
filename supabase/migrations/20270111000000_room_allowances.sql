-- Tom, 7 Sep 2026: two per-room allowances the engine adds on its own
-- (lib/wizard/allowances.ts):
--   Colour Match Allowance   — a one-coat colour match still needs spot
--                              priming, extra patching, set-up and pack-up
--   Ceilings Only Allowance  — a ceiling painted without its walls
-- Interior, Hours Per Item, half an hour each to start (Tom tunes them in
-- Settings → Pricing → Substrates & production rates). Charge-out copied
-- from the interior door row so they bill at the interior rate. Data only.
insert into public.rate_items
  (rate_card_id, code, category, sub_category, unit,
   rate_1_coat, rate_2_coat, rate_3_coat, default_coats, charge_out_cents,
   default_product, metres_per_litre, litres_per_item_per_coat)
select r.rate_card_id, v.code, 'Interior', 'Allowances', 'Hours Per Item',
       0.5, 0.5, 0.5, 1, r.charge_out_cents,
       r.default_product, null, null
  from public.rate_items r
  join public.rate_cards c on c.id = r.rate_card_id
 cross join (values ('Colour Match Allowance'), ('Ceilings Only Allowance')) as v(code)
 where c.is_active = true
   and r.category = 'Interior' and r.code = 'Flat Door (1 Side)'
   and not exists (
     select 1 from public.rate_items b
      where b.rate_card_id = r.rate_card_id and b.code = v.code
   );

select ri.code, ri.unit, ri.rate_1_coat, ri.charge_out_cents
  from public.rate_items ri
  join public.rate_cards rc on rc.id = ri.rate_card_id
 where rc.is_active and ri.code in ('Colour Match Allowance', 'Ceilings Only Allowance');
