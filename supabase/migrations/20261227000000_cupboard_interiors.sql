-- =============================================================================
-- D19 (assistant Addendum A, ruled by Tom 2 Sep 2026): CUPBOARD INTERIORS as
-- a priced scope item. The card priced cupboard FRONTS only (migration
-- 20260920000000), so "inside the cupboards too?" had nothing to land on.
--
-- Four rows on the ACTIVE card, priced per CARCASS (what a customer can
-- count), brushed/rolled not sprayed, shelves included:
--
--   Kitchen Cupboard Interior        ~ $50  per carcass at 2 coats
--   Robe Interior                    ~ $143 per robe
--   Vanity Interior                  ~ $57  per vanity
--   Linen / Broom Cupboard Interior  ~ $95  per cupboard
--
-- Hours per item are derived from the template row's charge-out so the 2-coat
-- price lands on the indicative dollars above (1 coat ×0.6, 3 coats ×1.4 —
-- the cabinetry convention). Template = the matching FRONT row, so unit,
-- product and litres-per-item ride along. Starting values for the proving
-- window — edit in Settings like every other rate.
--
-- The customer question renders only when the code exists on the active card
-- (lib/wizard/rooms-loop.ts CUPBOARD_INTERIOR_BY_ROOM_TYPE is data-driven),
-- so an un-migrated card simply asks nothing.
--
-- Idempotent: skips any code already on the active card. Read-back at the end.
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
  join (values
   ('Kitchen Cupboard Interior',        5000,  'Kitchen Cupboard Front'),
   ('Robe Interior',                   14300,  'Robe Door'),
   ('Vanity Interior',                  5700,  'Vanity Door'),
   ('Linen / Broom Cupboard Interior',  9500,  'Kitchen Cupboard Front')
 ) as v(code, cents, template_code) on v.template_code = r.code
 where c.is_active = true
   and not exists (
     select 1 from public.rate_items b
      where b.rate_card_id = r.rate_card_id and b.code = v.code
   );

-- ---- read-back --------------------------------------------------------------
-- Four rows expected. If a template front is missing the row is silently
-- skipped, so COUNT what landed rather than assume.
do $$
declare v_n int;
begin
  select count(*) into v_n
    from public.rate_items ri join public.rate_cards rc on rc.id = ri.rate_card_id
   where rc.is_active
     and ri.code in ('Kitchen Cupboard Interior', 'Robe Interior', 'Vanity Interior', 'Linen / Broom Cupboard Interior');
  if v_n <> 4 then
    raise exception 'read-back: expected 4 cupboard-interior rows on the active card, found %', v_n;
  end if;
end $$;

select code, unit, rate_2_coat, charge_out_cents,
       round(rate_2_coat * charge_out_cents / 100.0) as approx_2coat_dollars
  from public.rate_items ri join public.rate_cards rc on rc.id = ri.rate_card_id
 where rc.is_active and ri.code in ('Kitchen Cupboard Interior', 'Robe Interior', 'Vanity Interior', 'Linen / Broom Cupboard Interior')
 order by code;
--   -> four rows, approx 50 / 95 / 143 / 57 dollars.
