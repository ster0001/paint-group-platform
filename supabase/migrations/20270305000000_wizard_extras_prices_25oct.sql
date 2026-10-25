-- Tom, 25 Oct 2026 (wizard batch, items 12 and 14): two per-item prices on the live card.
--
--   Air Vent  $50 per vent   (was $45): 0.25 h per item, so the per-item charge-out is 20000 c/h.
--   Mantle    $340 per mantle (was the category rate x 2.5 h = $237.50): 2.5 h at two coats,
--             so the per-item charge-out is 13600 c/h. The customer sheet now prices a timed
--             row at charge-out x hours (lib/wizard/extras.ts perItemPriceCents), so this is
--             what the customer reads beside the chip.
--
-- Data-only and convergent: an update by code on the active card, no insert. A card without a
-- Mantle row (the test project) is left as it is, and the read-back says so.
set lock_timeout = '15s';

update public.rate_items ri set charge_out_cents = 20000
  from public.rate_cards c
 where ri.rate_card_id = c.id and c.is_active
   and ri.category = 'Interior' and ri.code = 'Air Vent' and ri.unit = 'Hours Per Item';

update public.rate_items ri set charge_out_cents = 13600
  from public.rate_cards c
 where ri.rate_card_id = c.id and c.is_active
   and ri.category = 'Interior' and ri.code = 'Mantle' and ri.unit = 'Hours Per Item';

-- Read-back: compare each value to its _expect_ before calling this live.
select
  (select ri.charge_out_cents from public.rate_items ri join public.rate_cards c on c.id = ri.rate_card_id where c.is_active and ri.category = 'Interior' and ri.code = 'Air Vent') as air_vent_charge_out, 20000 as _expect_air_vent_charge_out,
  (select round(ri.charge_out_cents * ri.rate_2_coat) from public.rate_items ri join public.rate_cards c on c.id = ri.rate_card_id where c.is_active and ri.category = 'Interior' and ri.code = 'Air Vent') as air_vent_price_cents, 5000 as _expect_air_vent_price_cents,
  (select ri.charge_out_cents from public.rate_items ri join public.rate_cards c on c.id = ri.rate_card_id where c.is_active and ri.category = 'Interior' and ri.code = 'Mantle') as mantle_charge_out, 13600 as _expect_mantle_charge_out,
  (select round(ri.charge_out_cents * ri.rate_2_coat) from public.rate_items ri join public.rate_cards c on c.id = ri.rate_card_id where c.is_active and ri.category = 'Interior' and ri.code = 'Mantle') as mantle_price_cents, 34000 as _expect_mantle_price_cents;

insert into public._prod_migrations(name) values ('20270305000000_wizard_extras_prices_25oct.sql') on conflict (name) do nothing;
