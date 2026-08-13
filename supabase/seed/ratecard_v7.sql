-- =====================================================================
-- Paint Group — Rate Card v7 seed
-- GENERATED from Paint_Group_Rate_Card_v7.xlsx — do not hand-edit.
-- Safe to re-run: reference data is upserted; the versioned rate card is
-- inserted only once (existing versions and their quotes are never touched).
-- =====================================================================

-- Settings (23)
insert into public.settings (key, value) values
  ('Charge-out rate — INTERIOR', '{"value":85,"unit":"$ / hour","notes":"Your figure"}'::jsonb),
  ('Charge-out rate — EXTERIOR', '{"value":100,"unit":"$ / hour","notes":"Your figure"}'::jsonb),
  ('Contractor rate', '{"value":60,"unit":"$ / hour","notes":"Your figure — flat, both interior and exterior"}'::jsonb),
  ('Contractor offer — % of estimated hours', '{"value":1,"unit":"%","notes":"Separate lever. Drop below 100% only if efficiency gains prove real and contractors still accept"}'::jsonb),
  ('Correction factor — INTERIOR', '{"value":1.069,"unit":"x","notes":"Measured from 381 jobs. Already baked into the rates; shown here so it stays visible and editable"}'::jsonb),
  ('Correction factor — EXTERIOR', '{"value":1.085,"unit":"x","notes":"Measured from 381 jobs. Already baked into the rates"}'::jsonb),
  ('Labour spread — interior', '{"value":25,"unit":"$ / hour","notes":"Calculated"}'::jsonb),
  ('Labour spread — exterior', '{"value":40,"unit":"$ / hour","notes":"Calculated"}'::jsonb),
  ('Materials markup', '{"value":0.1,"unit":"%","notes":"Your figure"}'::jsonb),
  ('Weekly fixed costs', '{"value":4000,"unit":"$ / week","notes":"Your figure"}'::jsonb),
  ('Weekly marketing', '{"value":1200,"unit":"$ / week","notes":"Your figure"}'::jsonb),
  ('Total weekly overhead', '{"value":5200,"unit":"$ / week","notes":"Calculated"}'::jsonb),
  ('Billable hours per week', '{"value":480,"unit":"hours","notes":"Your figure — approx 12 contractors"}'::jsonb),
  ('Overhead per billable hour', '{"value":10.8333333333333,"unit":"$ / hour","notes":"Calculated"}'::jsonb),
  ('Contribution per hour — INTERIOR', '{"value":14.1666666666667,"unit":"$ / hour","notes":"Calculated — before materials markup"}'::jsonb),
  ('Contribution per hour — EXTERIOR', '{"value":29.1666666666667,"unit":"$ / hour","notes":"Calculated — before materials markup"}'::jsonb),
  ('Break-even charge-out rate', '{"value":70.8333333333333,"unit":"$ / hour","notes":"Below this you lose money on labour, either side of the house"}'::jsonb),
  ('Residential minimum — self-serve floor', '{"value":2000,"unit":"$","notes":"Your figure"}'::jsonb),
  ('Residential minimum — site visit threshold', '{"value":4500,"unit":"$","notes":"PROPOSED — below this, self-serve estimate and online deposit only, no van"}'::jsonb),
  ('Quote validity period', '{"value":60,"unit":"days","notes":"Your figure"}'::jsonb),
  ('GST', '{"value":0.1,"unit":"%","notes":"Displayed prices are GST inclusive"}'::jsonb),
  ('Sundries per job — interior', '{"value":275,"unit":"$","notes":"Sum of the itemised Sundries tab"}'::jsonb),
  ('Sundries per job — exterior', '{"value":175,"unit":"$","notes":"PROPOSED — itemised total less drop sheets. Confirm against your supplier dockets"}'::jsonb)
on conflict (key) do update set value = excluded.value, updated_at = now();

-- Modifiers (18)
insert into public.modifiers (code, group_name, label, applies_to, multiplier, source, active) values
  ('COND-SOUND', 'Condition', 'Sound — recently painted', 'Labour', 0.9, 'Estimated — not yet validated', true),
  ('COND-FAIR', 'Condition', 'Fair — normal wear', 'Labour', 1, 'Estimated — not yet validated', true),
  ('COND-POOR', 'Condition', 'Poor — flaking / peeling', 'Labour', 1.35, 'Estimated — not yet validated', true),
  ('COND-HERIT', 'Condition', 'Heritage — plaster repair required', 'Labour', 1.7, 'Estimated — not yet validated', true),
  ('ACC-GROUND', 'Access', 'Ground level / ladder', 'Labour', 1, 'Estimated — not yet validated', true),
  ('ACC-2STOREY', 'Access', 'Two storey', 'Labour', 1.15, 'Estimated — not yet validated', true),
  ('ACC-EWP', 'Access', 'EWP or scissor lift required', 'Labour', 1.1, 'Estimated — not yet validated', true),
  ('ACC-SCAFF', 'Access', 'Scaffold required', 'Labour', 1.2, 'Estimated — not yet validated', true),
  ('STG-OCCUPIED', 'Staging', 'Occupied home — daily set up and pack down', 'Labour', 1.1, 'Estimated — not yet validated', true),
  ('STG-AFTERHRS', 'Staging', 'After hours / weekend', 'Labour', 1.35, 'Estimated — not yet validated', true),
  ('STG-STAGED', 'Staging', 'Staged works — multiple mobilisations', 'Labour', 1.15, 'Estimated — not yet validated', true),
  ('FIN-1', 'Level of Finish', 'Level 1 — Basic. Minimal prep, no filling, single coat', 'Labour', 0.8, 'Judgement — no Level 1 jobs in history', true),
  ('FIN-2', 'Level of Finish', 'Level 2 — Standard. Light sand, spot prime, minor filling', 'Labour', 0.89, 'Measured — 381 jobs', true),
  ('FIN-3', 'Level of Finish', 'Level 3 — Good. Full prep, filled, sanded, sealed, caulked', 'Labour', 1, 'Measured — 381 jobs', true),
  ('FIN-4', 'Level of Finish', 'Level 4 — Premium. Double filling, multiple inspections, sharp lines', 'Labour', 1.06, 'Measured — 381 jobs', true),
  ('SIZE-S', 'Job Size', 'Under $10,000', 'Labour', 1, 'Measured — 381 jobs', true),
  ('SIZE-M', 'Job Size', '$10,000 - $20,000', 'Labour', 1.05, 'Measured — 381 jobs', true),
  ('SIZE-L', 'Job Size', 'Over $20,000', 'Labour', 1.17, 'Measured — 381 jobs', true)
on conflict (code) do update set group_name=excluded.group_name, label=excluded.label, applies_to=excluded.applies_to, multiplier=excluded.multiplier, source=excluded.source, active=true;

-- Colour rules (6)
insert into public.colour_rules (code, label, coats, undercoat, notes) values
  ('C-REFRESH', 'Refresh — same colour', 1, 'None', 'Cheapest change available. Sell it as an option.'),
  ('C-L2L', 'Light to light', 2, 'None', 'Your standard two coats.'),
  ('C-L2D', 'Light to dark', 3, 'None', 'Deep bases have poor opacity.'),
  ('C-D2L', 'Dark to light', 3, 'Tinted undercoat', 'The most expensive change. Most commonly under-quoted.'),
  ('C-ACCENT', 'Strong accent — red / yellow', 4, 'Grey undercoat', 'Price it or lose money on it.'),
  ('C-NEWWORK', 'New plaster / bare substrate', 2, 'Sealer / primer', 'Undercoat is a separate coat, not part of the two.')
on conflict (code) do update set label=excluded.label, coats=excluded.coats, undercoat=excluded.undercoat, notes=excluded.notes;

-- Products (23)
insert into public.products (name, type, coverage, price_per_litre, wastage_pct, effective_from) values
  ('Dulux Weathershield', 'Exterior', 16, 2300, 10, current_date),
  ('Berger Solarscreen', 'Exterior', 16, 1600, 10, current_date),
  ('Cabots Timbercolour', 'Exterior', 16, 1700, 10, current_date),
  ('Haymes Expressions Wall', 'Interior', 16, 1700, 10, current_date),
  ('Haymes Expressions Ceiling', 'Interior', 16, 1700, 10, current_date),
  ('Dulux Wash and Wear', 'Interior', 16, 2200, 10, current_date),
  ('Dulux Wash and Wear Super Hide', 'Interior', 16, 2500, 10, current_date),
  ('Dulux Professional Wall', 'Interior', 16, 2000, 10, current_date),
  ('Dulux Professional Ceiling', 'Interior', 16, 2000, 10, current_date),
  ('Dulux Professional Semi Gloss Enamel', 'Interior', 16, 2000, 10, current_date),
  ('Dulux Professional High Gloss Enamel', 'Interior', 16, 2000, 10, current_date),
  ('Haymes Trim Plus Semi Gloss', 'Interior', 16, 2000, 10, current_date),
  ('Haymes Trim Plus High Gloss', 'Interior', 16, 2000, 10, current_date),
  ('Dulux AcraTex', 'Exterior', 6, 2000, 10, current_date),
  ('Cutek Extreme CD 50', 'Exterior', 7.5, 7500, 10, current_date),
  ('Porters Egg Shell', 'Interior', 16, 2500, 10, current_date),
  ('Integrain UltraDeck', 'Exterior', 10, 3500, 10, current_date),
  ('Premier Roof Coatings', 'Exterior', 12, 1500, 10, current_date),
  ('Fuel / Consumables', 'Exterior', null, 600, 10, current_date),
  ('Dulux Total Prep', 'Interior', 16, 1700, 10, current_date),
  ('Tinted Undercoat', 'Interior', 16, 1700, 10, current_date),
  ('Grey Undercoat', 'Interior', 16, 1700, 10, current_date),
  ('Cutek Restore', 'Exterior', null, 1500, 10, current_date)
on conflict (name) do update set type=excluded.type, coverage=excluded.coverage, price_per_litre=excluded.price_per_litre, wastage_pct=excluded.wastage_pct, effective_from=excluded.effective_from;

-- Sundries (7)
insert into public.sundries (code, item, basis, cost_cents) values
  ('SUN-DROP', 'Drop sheets and plastic', 'Per job — INTERIOR ONLY', 10000),
  ('SUN-TAPE', 'Masking tape', 'Per job', 2000),
  ('SUN-FILL', 'Gap filler and caulk', 'Per job', 5000),
  ('SUN-TIMBFILL', 'Timber filler', 'Per job', 3000),
  ('SUN-ABRASIVE', 'Sandpaper and abrasives', 'Per job', 3500),
  ('SUN-ROLLER', 'Roller sleeves, trays, liners', 'Per job', 2000),
  ('SUN-BRUSH', 'Brushes', 'Per job', 2000)
on conflict (code) do update set item=excluded.item, basis=excluded.basis, cost_cents=excluded.cost_cents;

-- Commercial rates (7)
insert into public.commercial_rates (sector, low_cents_per_m2, high_cents_per_m2, notes) values
  ('Commercial interior repaint - Level 2', 990, 1120, 'Rental-grade / budget commercial. Walls and ceilings, 2 coats'),
  ('Commercial interior repaint - Level 3', 1080, 1220, 'Standard commercial. The default band'),
  ('Retail / chemist warehouse', 1120, 1320, 'Level 3, after-hours staging usually applies'),
  ('Warehouse - accessible', 1120, 1220, 'Level 2-3, ground level or low access'),
  ('Warehouse - high bay', 1320, 1550, 'Includes EWP. Confirm against a completed high-bay contract'),
  ('Body corporate / strata common area', 1120, 1320, 'Level 3, occupied-site staging, multiple mobilisations'),
  ('Office fitout', 1080, 1220, 'Level 3, usually after-hours')
on conflict (sector) do update set low_cents_per_m2=excluded.low_cents_per_m2, high_cents_per_m2=excluded.high_cents_per_m2, notes=excluded.notes;

-- Area names (26)
insert into public.area_names (area, type) values
  ('Front', 'exterior'),
  ('Back', 'exterior'),
  ('Left Side', 'exterior'),
  ('Right Side', 'exterior'),
  ('Deck', 'exterior'),
  ('Shed', 'exterior'),
  ('Garage', 'exterior'),
  ('Fence', 'exterior'),
  ('Living', 'interior'),
  ('Lounge', 'interior'),
  ('Dining', 'interior'),
  ('Kitchen', 'interior'),
  ('Bedroom 1', 'interior'),
  ('Bedroom 2', 'interior'),
  ('Bedroom 3', 'interior'),
  ('Bedroom 4', 'interior'),
  ('En Suite', 'interior'),
  ('Bathroom', 'interior'),
  ('Toilet', 'interior'),
  ('Walk in Robe', 'interior'),
  ('Hallway', 'interior'),
  ('Stairwell', 'interior'),
  ('Study', 'interior'),
  ('Laundry', 'interior'),
  ('Rumpus', 'interior'),
  ('Garage (Interior)', 'interior')
on conflict (area) do update set type=excluded.type;

-- Line items / templates (12)
insert into public.line_items (name, type, pricing_method) values
  ('Interior Preparation', 'Interior', 'Hourly'),
  ('Interior Paintwork', 'Interior', 'Hourly'),
  ('Interior Paintwork - Walls and Ceilings', 'Interior', 'Hourly'),
  ('Exterior Preparation', 'Exterior', 'Hourly'),
  ('Exterior Paint Application', 'Exterior', 'Hourly'),
  ('Cutek', 'Exterior', 'Hourly'),
  ('Plaster Repair', 'Interior', 'Hourly'),
  ('Roof Respray', 'Exterior', 'Hourly'),
  ('Scissor Lift Hire', 'Exterior', 'Custom'),
  ('Boom Lift Hire', 'Exterior', 'Custom'),
  ('Scaffolding', 'Exterior', 'Custom'),
  ('Cleaning', 'Interior', 'Custom')
on conflict (name) do update set type=excluded.type, pricing_method=excluded.pricing_method;

-- Rate card v7 + 47 rate items (versioned; inserted once)
do $$
declare v_card uuid;
begin
  if exists (select 1 from public.rate_cards where version = 7) then
    raise notice 'Rate card v7 already present — skipping rate_items.';
  else
    update public.rate_cards set is_active = false where is_active;
    insert into public.rate_cards (version, effective_from, is_active) values (7, current_date, true) returning id into v_card;
    insert into public.rate_items (rate_card_id, code, category, sub_category, unit, rate_1_coat, rate_2_coat, rate_3_coat, default_coats, charge_out_cents, default_product, metres_per_litre, litres_per_item_per_coat) values
      (v_card, 'Walls', 'Interior', 'Walls', 'M2', 18.01, 10.29, 7.2, 2, 8500, 'Haymes Expressions Wall', null, null),
      (v_card, 'Ceilings', 'Interior', 'Ceilings', 'M2', 18.01, 10.29, 7.2, 2, 8500, 'Haymes Expressions Ceiling', null, null),
      (v_card, 'Standard Cornices', 'Interior', 'Ceilings', 'Lineal Metres', 24.56, 14.03, 9.82, 2, 8500, 'Haymes Expressions Ceiling', 123, null),
      (v_card, 'Patterned Cornices', 'Interior', 'Ceilings', 'Lineal Metres', 16.37, 9.35, 6.55, 2, 8500, 'Haymes Expressions Ceiling', 80, null),
      (v_card, 'Skirting Boards', 'Interior', 'Interior Trim', 'Lineal Metres', 20.47, 11.69, 8.19, 2, 8500, 'Haymes Trim Plus Semi Gloss', 103, null),
      (v_card, 'Skirting Boards MDF', 'Interior', 'Interior Trim', 'Lineal Metres', 20.47, 11.69, 8.19, 3, 8500, 'Haymes Trim Plus Semi Gloss', 103, null),
      (v_card, 'Picture Rails', 'Interior', 'Interior Trim', 'Lineal Metres', 20.47, 11.69, 8.19, 2, 8500, 'Haymes Trim Plus Semi Gloss', 200, null),
      (v_card, 'Balustrades', 'Interior', 'Interior Trim', 'Lineal Metres', 6.55, 3.74, 2.62, 2, 8500, 'Haymes Trim Plus Semi Gloss', 32, null),
      (v_card, 'Flat Door and Frame (1 Side)', 'Interior', 'Interior Doors', 'Hours Per Item', 0.61, 1.07, 1.53, 2, 8500, 'Haymes Trim Plus Semi Gloss', null, 0.16),
      (v_card, 'Flat Door (1 Side)', 'Interior', 'Interior Doors', 'Hours Per Item', 0.31, 0.53, 0.76, 2, 8500, 'Haymes Trim Plus Semi Gloss', null, 0.1),
      (v_card, '4-6 Panel Door and Frame (1 Side)', 'Interior', 'Interior Doors', 'Hours Per Item', 0.92, 1.6, 2.29, 2, 8500, 'Haymes Trim Plus Semi Gloss', null, 0.19),
      (v_card, '4-6 Panel Door (1 Side)', 'Interior', 'Interior Doors', 'Hours Per Item', 0.46, 0.8, 1.14, 2, 8500, 'Haymes Trim Plus Semi Gloss', null, 0.13),
      (v_card, 'Architrave (1 Side)', 'Interior', 'Interior Doors', 'Hours Per Item', 0.31, 0.53, 0.76, 2, 8500, 'Haymes Trim Plus Semi Gloss', null, 0.06),
      (v_card, 'Fixed / Picture / Window Reveal', 'Interior', 'Interior Windows', 'Hours Per Item', 0.76, 1.34, 1.91, 2, 8500, 'Haymes Trim Plus Semi Gloss', null, 0.2),
      (v_card, 'Awning / Casement Window', 'Interior', 'Interior Windows', 'Hours Per Item', 0.92, 1.6, 2.67, 2, 8500, 'Haymes Trim Plus Semi Gloss', null, 0.2),
      (v_card, 'Double Hung Sash', 'Interior', 'Interior Windows', 'Hours Per Item', 1.22, 2.14, 3.06, 2, 8500, 'Haymes Trim Plus Semi Gloss', null, 0.25),
      (v_card, 'Colonial / Bay Window', 'Interior', 'Interior Windows', 'Hours Per Item', 1.83, 3.21, 4.59, 2, 8500, 'Haymes Trim Plus Semi Gloss', null, 0.25),
      (v_card, 'Stucco', 'Exterior', 'Cladding', 'M2 Per Hour', 12.09, 6.91, 4.84, 2, 10000, 'Dulux AcraTex', null, null),
      (v_card, 'Weatherboards', 'Exterior', 'Cladding', 'M2 Per Hour', 8.06, 4.61, 3.23, 2, 10000, 'Dulux Weathershield', null, null),
      (v_card, 'Render', 'Exterior', 'Cladding', 'M2 Per Hour', 10.49, 5.99, 4.19, 2, 10000, 'Dulux AcraTex', null, null),
      (v_card, 'Colorbond Cladding', 'Exterior', 'Cladding', 'M2 Per Hour', 12.09, 6.91, 4.84, 2, 10000, 'Dulux Weathershield', null, null),
      (v_card, 'Cutek', 'Exterior', 'Staining', 'M2 Per Hour', 10.08, 5.76, null, 2, 10000, 'Cutek Extreme CD 50', null, null),
      (v_card, 'Eaves', 'Exterior', 'Exterior Trim', 'Lineal Metres', 8.06, 4.61, 3.23, 2, 10000, 'Dulux Weathershield', 36, null),
      (v_card, 'Soffits / Exterior Ceilings', 'Exterior', 'Exterior Trim', 'M2', 17.74, 10.14, 7.1, 2, 10000, 'Dulux Weathershield', null, null),
      (v_card, 'Fascias', 'Exterior', 'Exterior Trim', 'Lineal Metres', 12.09, 6.91, 4.84, 2, 10000, 'Dulux Weathershield', 76, null),
      (v_card, 'Columns', 'Exterior', 'Exterior Trim', 'Hours Per Item', 0.62, 1.08, 1.55, 2, 10000, 'Dulux Weathershield', null, 0.23),
      (v_card, 'Posts', 'Exterior', 'Exterior Trim', 'Hours Per Item', 0.37, 0.65, 0.93, 2, 10000, 'Dulux Weathershield', null, 0.06),
      (v_card, 'Downpipes', 'Exterior', 'Exterior Trim', 'Hours Per Item', 0.62, 1.08, 1.55, 2, 10000, 'Dulux Weathershield', null, 0.07),
      (v_card, 'Wood Shutters', 'Exterior', 'Exterior Trim', 'Hours Per Item', 1.86, 3.25, 4.65, 2, 10000, 'Dulux Weathershield', null, 0.3),
      (v_card, 'Strapping', 'Exterior', 'Exterior Trim', 'Hours Per Item', 2.17, 3.8, 5.42, 2, 10000, 'Dulux Weathershield', null, 0.15),
      (v_card, 'Gutters', 'Exterior', 'Exterior Trim', 'Lineal Metres', 12.09, 6.91, 4.84, 2, 10000, 'Dulux Weathershield', 123, null),
      (v_card, 'Pergola', 'Exterior', 'Exterior Trim', 'Hours Per Item', 4.96, 8.68, 12.4, 2, 10000, 'Dulux Weathershield', null, 2),
      (v_card, 'Hand Rails', 'Exterior', 'Exterior Trim', 'Lineal Metres', 16.13, 9.22, 6.45, 2, 10000, 'Dulux Weathershield', 64, null),
      (v_card, 'Fixed / Picture Window', 'Exterior', 'Exterior Windows', 'Hours Per Item', 0.89, 1.56, 2.24, 2, 10000, 'Dulux Weathershield', null, 0.2),
      (v_card, 'Awning / Casement Window', 'Exterior', 'Exterior Windows', 'Hours Per Item', 1.07, 1.88, 3.12, 2, 10000, 'Dulux Weathershield', null, 0.2),
      (v_card, 'Double Hung Sash', 'Exterior', 'Exterior Windows', 'Hours Per Item', 1.42, 2.5, 3.57, 2, 10000, 'Dulux Weathershield', null, 0.25),
      (v_card, 'Colonial / Bay Window', 'Exterior', 'Exterior Windows', 'Hours Per Item', 2.14, 3.74, 5.35, 2, 10000, 'Dulux Weathershield', null, 0.25),
      (v_card, 'Standard Door (1 Side)', 'Exterior', 'Exterior Doors', 'Hours Per Item', 0.62, 1.08, 1.55, 2, 10000, 'Dulux Weathershield', null, 0.2),
      (v_card, 'Front Door', 'Exterior', 'Exterior Doors', 'Hours Per Item', 1.24, 2.17, 3.1, 2, 10000, 'Dulux Weathershield', null, 0.5),
      (v_card, 'Garage Door (1 Car)', 'Exterior', 'Exterior Doors', 'Hours Per Item', 2.48, 4.34, 6.2, 2, 10000, 'Dulux Weathershield', null, 10),
      (v_card, 'Garage Door (2 Car)', 'Exterior', 'Exterior Doors', 'Hours Per Item', 3.72, 6.51, 9.3, 2, 10000, 'Dulux Weathershield', null, 10),
      (v_card, 'Pressure Washing', 'Exterior', 'Pressure Washing', 'M2 Per Hour', 23.04, null, null, 1, 10000, 'Fuel / Consumables', null, null),
      (v_card, 'Deck Painting', 'Exterior', 'Floor Coatings', 'M2 Per Hour', 16.13, 9.22, 6.45, 2, 10000, 'Integrain UltraDeck', null, null),
      (v_card, 'Picket Fence (Hand Paint)', 'Exterior', 'Fences', 'Lineal Metres', 2.41, 1.38, 0.97, 2, 10000, 'Dulux Weathershield', 4.5, null),
      (v_card, 'Picket Fence (Spray)', 'Exterior', 'Fences', 'Lineal Metres', 12.09, 6.91, 4.84, 2, 10000, 'Dulux Weathershield', 4.5, null),
      (v_card, 'Paling Fence', 'Exterior', 'Fences', 'Lineal Metres', 24.19, 13.82, 9.68, 2, 10000, 'Dulux Weathershield', 7, null),
      (v_card, 'Roof', 'Exterior', 'Roof', 'M2 Per Hour', 13.82, 6.91, 3, 3, 10000, 'Premier Roof Coatings', null, null);
  end if;
end $$;
