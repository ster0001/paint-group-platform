-- =============================================================================
-- Fix: the seven priced extras/allowance rows are PER-ITEM rates, but
-- 20260921 copied unit = 'Lineal Metres' from the Fascias template row. The
-- engine reads a lineal rate as METRES PER HOUR (hours = qty ÷ rate), so
-- "Shed · 5 hours" priced as 1/5 h — $64 instead of $640. 'Hours Per Item'
-- is the semantics these rows were written with (hours = rate × count), and
-- it also makes litres_per_item_per_coat the active materials path, matching
-- Tom's litres column. Idempotent; caught by lib/wizard/sides.test.ts before
-- any customer saw a price.
-- =============================================================================

update public.rate_items ri set unit = 'Hours Per Item'
  from public.rate_cards c
 where ri.rate_card_id = c.id and c.is_active
   and ri.category = 'Exterior'
   and ri.code in (
     'Window Shutters', 'Side Gate', 'Security Door', 'Meter Box', 'Shed',
     'Minor Fascia Rot Allowance', 'Access Allowance'
   );

-- The weathered modifier joined as group 'condition' (20260922), but the
-- engine's jobModifier and the builder's modifier dropdowns both key the
-- group as 'Condition' — without this, the customer's Weathered answer
-- prices correctly but is invisible in the staff builder's modifier UI.
update public.modifiers set group_name = 'Condition' where code = 'EXT-WEATHERED';
