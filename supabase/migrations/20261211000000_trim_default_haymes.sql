-- Tom (30 Aug 2026): "all internal trims sync to Haymes Trim Plus".
--
-- The active card's interior trim/door/window/cabinetry rows carried
-- default_product = 'Haymes Trim Plus Semi Gloss' — a product name that does
-- NOT exist in the products table ('Haymes Trim Plus' does). Two symptoms:
--   1. pricing found no product, so those surfaces carried $0 materials cost;
--   2. the builder's Materials <select> had no matching option, so the browser
--      displayed the FIRST product instead — which is why every trim row
--      appeared to "auto sync to Dulux Wash and Wear".
-- (The select now also renders an unknown default as itself, so a future
-- mismatch can never silently display as the wrong product.)
--
-- Data-only, idempotent. Also normalises Mantle (was 'Dulux Super Enamel') —
-- Tom's instruction covers ALL internal trims.
update public.rate_items
set default_product = 'Haymes Trim Plus'
where rate_card_id in (select id from public.rate_cards where is_active)
  and category = 'Interior'
  and sub_category in ('Interior Trim', 'Interior Doors', 'Interior Windows', 'Cabinetry')
  and default_product is distinct from 'Haymes Trim Plus';

-- Read-back: every internal trim row now names a product that exists.
select code, sub_category, default_product
from public.rate_items
where rate_card_id in (select id from public.rate_cards where is_active)
  and category = 'Interior'
  and sub_category in ('Interior Trim', 'Interior Doors', 'Interior Windows', 'Cabinetry')
order by sub_category, code;
