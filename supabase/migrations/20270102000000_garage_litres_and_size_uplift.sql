-- =============================================================================
-- Tom, 5 Sep 2026 — two pricing knobs
--
-- 1 · Garage doors read 22 L of paint. lib/pricing/estimate.ts prices an
--     Hours-Per-Item row as count × coats × litres_per_item_per_coat × (1 +
--     wastage): 1 × 2 × 10 × 1.10 = 22.0 L. The 10 is a data-entry outlier
--     (a front door is 0.5, a whole shed 4). Tom wants 6 L of Dulux
--     Weathershield: 6 / (2 × 1.10) = 2.727 per item per coat. The product
--     is already Dulux Weathershield on both rows. Settings → Pricing →
--     Substrates now shows this column so it can be tuned without SQL.
--
-- 2 · Size uplift — extra margin on bigger jobs. Four Settings levers,
--     applied in lib/pricing/estimate.ts as a % of the slice of the ex-GST
--     subtotal above each threshold (marginal, so a job never gets cheaper
--     by getting bigger). Seeded at 0% so nothing changes until Tom types
--     the percentages in Settings → Pricing → "Pricing & job numbers".
--
-- Idempotent; read-back at the end.
-- =============================================================================

update public.rate_items
   set litres_per_item_per_coat = 2.727
 where code in ('Garage Door (1 Car)', 'Garage Door (2 Car)')
   and coalesce(litres_per_item_per_coat, 0) > 5;

insert into public.settings (key, value) values
  ('Margin uplift — tier 1 threshold', '{"value":10000,"unit":"$ ex GST","notes":"Jobs above this carry the tier-1 uplift on the part above it"}'::jsonb),
  ('Margin uplift — tier 1 %',         '{"value":0,"unit":"%","notes":"Extra margin on the part of the subtotal above tier 1. 0 = off"}'::jsonb),
  ('Margin uplift — tier 2 threshold', '{"value":20000,"unit":"$ ex GST","notes":"Jobs above this carry the tier-2 uplift as well, on the part above it"}'::jsonb),
  ('Margin uplift — tier 2 %',         '{"value":0,"unit":"%","notes":"Extra margin on the part of the subtotal above tier 2, on top of tier 1. 0 = off"}'::jsonb)
on conflict (key) do nothing;

-- ---- read-back (paste the result in chat) ----------------------------------
select code, litres_per_item_per_coat, default_product from public.rate_items
 where code in ('Garage Door (1 Car)', 'Garage Door (2 Car)') order by code;
-- expect litres_per_item_per_coat = 2.727 on every row
select key, value->>'value' as value from public.settings where key like 'Margin uplift%' order by key;
-- expect 4 rows: 10000, 0, 20000, 0
