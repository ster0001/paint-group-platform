-- Tom, 7 Sep 2026: the walls inside a built-in robe are half an hour a coat
-- per robe — a colour match (1 coat) is 30 minutes, a colour change (2 coats)
-- an hour. Migration 20261227 seeded "Robe Interior" from a dollar figure
-- ($143 at 2 coats); this sets the hours the rule describes. Data only.
-- (The same row is editable in Settings → Pricing → Substrates & production rates.)
update public.rate_items ri
   set rate_1_coat = 0.5,
       rate_2_coat = 1.0,
       rate_3_coat = 1.5,
       default_coats = 2
  from public.rate_cards rc
 where rc.id = ri.rate_card_id
   and rc.is_active = true
   and ri.code = 'Robe Interior';

select ri.code, ri.unit, ri.rate_1_coat, ri.rate_2_coat, ri.rate_3_coat, ri.charge_out_cents
  from public.rate_items ri
  join public.rate_cards rc on rc.id = ri.rate_card_id
 where rc.is_active and ri.code = 'Robe Interior';
