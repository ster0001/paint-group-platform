-- =====================================================================
-- C12 · commercial segments as DATA (estimator journey v2 addendum S6a).
--
-- Eight tiles, two doors. Everything the commercial screens render — the
-- counts, the open-space block, the also-areas, the surfaces, the hours and
-- occupied copy, the typicals — comes from these rows. No segment-specific
-- JSX beyond the two patterns (areas + job, warehouse) and the brief (§4.11).
-- `route` is the door: 'range' continues in the quick look to a widened
-- guide range with a person confirming; 'brief' goes to a short brief and a
-- booking (C14). The brief configurations ride the same rows (S6c).
--
-- Seeded from the prototype's SEG and BRIEF objects
-- (design/reference/estimator-journey-v2.html), with the v2.2 ruling
-- applied: partitions and frontage are never asked about, so the office hint
-- no longer says we ask. Typicals are the prototype's own sizes, each with the scope
-- room type it is priced as ([label, [L, W], roomType]; also-areas are
-- [L, W, roomType], and "outside" means flagged, not priced) — Tom's to
-- adjust here (business-inputs.md, ⚑23, does not exist in the repo).
-- =====================================================================

create table if not exists public.commercial_segments (
  key         text primary key,
  position    int  not null default 100,
  name        text not null,
  tile_hint   text not null default '',
  route       text not null check (route in ('range', 'brief')),
  -- Shown as a tile on the segment screen. 'exterior' and 'hospital' are
  -- routes reached from a tile, not tiles themselves.
  tile        boolean not null default true,
  config      jsonb not null default '{}'::jsonb,
  brief       jsonb,
  typicals    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.commercial_segments is
  'C12: the commercial segment screens as data. route = range (priced online, person confirms) | brief (brief + booking). config/typicals render the areas + job pattern; brief renders the S6c brief.';

alter table public.commercial_segments enable row level security;
drop policy if exists commercial_segments_read on public.commercial_segments;
create policy commercial_segments_read on public.commercial_segments for select to anon, authenticated using (true);
drop policy if exists commercial_segments_staff on public.commercial_segments;
create policy commercial_segments_staff on public.commercial_segments for all to authenticated using (public.is_staff()) with check (public.is_staff());

insert into public.commercial_segments (key, position, name, tile_hint, route, tile, config, brief, typicals) values
('office', 10, 'Office', 'Suites, floors, fit-out make-good', 'range', true, $j${
  "kick":"OFFICE","title":"Tell us about the office","sub":"Counts are fine. We size each one from typicals and you can adjust any of them after.",
  "counts":[["offices","Private offices","Enclosed, one or two desks",4],["open","Open-plan areas","Workstations, breakout — we ask about the ceiling next",1],["meeting","Meeting rooms and boardrooms","",1]],
  "openKey":"open","openLabel":"Open-plan area","also":["Reception","Corridors","Kitchen or break room","Amenities","Server or comms room","Fire stairs"],
  "surf":["Walls","Ceilings — plaster only","Doors","Door frames","Window frames — timber only","Skirtings","Columns and bulkheads","Feature walls"],"surfKeys":{"Walls":"walls","Ceilings — plaster only":"ceilings","Doors":"doors","Door frames":"architraves","Window frames — timber only":"windows","Skirtings":"skirting","Columns and bulkheads":"walls","Feature walls":"walls"},
  "hours":[["business","Business hours"],["after","After hours"],["weekend","Weekends"]],
  "occ":["Is it occupied?",[["vacant","Vacant — between tenants"],["occ","Occupied — furniture stays"]]],
  "wear":"Scuffs, picture hooks, holes from the last fit-out","work":"Damaged plaster, water marks, patched walls"}$j$, null,
  $j${"rooms":{"offices":["Office",[3.5,4],"study"],"open":["Open plan",[10,8],"living"],"meeting":["Meeting room",[4,5],"dining"]},"alsoSize":{"Reception":[5,4,"living"],"Corridors":[12,1.8,"hallway"],"Kitchen or break room":[4,3.5,"kitchen"],"Amenities":[3,2.5,"bathroom"],"Server or comms room":[2.5,2,"storage"],"Fire stairs":[3,2.5,"hallway"]}}$j$),
('warehouse', 20, 'Industrial or warehouse', 'Factory, storage, workshop', 'range', true, $j${
  "kick":"INDUSTRIAL OR WAREHOUSE","pattern":"warehouse","surf":null,
  "hours":[["business","Business hours"],["after","After hours"],["weekend","Weekends"]],"occ":null,
  "wear":"Dust, scuffs, forklift marks","work":"Forklift damage, rust, cracked blockwork"}$j$, null, '{}'::jsonb),
('retail', 30, 'Retail, hospitality, restaurants', 'Shops, cafés, restaurants, bars', 'range', true, $j${
  "kick":"RETAIL, HOSPITALITY AND RESTAURANTS","title":"Tell us about the shop or venue","sub":"Shops, cafés, restaurants and bars follow the same shape: the front of house is the part that's easy to misprice, and kitchens get a washable system.",
  "openCopy":"Front of house — sales floors and dining rooms — is where prices go wrong: exposed or black ceilings, a full-width frontage, a lot of cutting-in. Tell us the size and the ceiling, and a photo lets your estimator check.",
  "counts":[["floor","Sales floor or dining areas","Usually one or two — we ask about the ceiling next",1],["boh","Back of house, kitchens and store rooms","Commercial kitchens get a washable, wipe-down system",1],["fit","Fitting rooms or private dining","",0]],
  "openKey":"floor","openLabel":"Front of house area","also":["Bar","Amenities","Staff room","Corridor","Covered outdoor dining"],"alsoFlag":{"Covered outdoor dining":"outside — priced on site"},
  "surf":["Walls","Ceilings — plaster only","Exposed ceiling — sprayed","Kitchen walls — washable","Doors","Door frames","Skirtings","Feature walls"],"surfKeys":{"Walls":"walls","Ceilings — plaster only":"ceilings","Exposed ceiling — sprayed":null,"Kitchen walls — washable":"walls","Doors":"doors","Door frames":"architraves","Skirtings":"skirting","Feature walls":"walls"},
  "hours":[["after","After trading"],["before","Before opening"],["closed","Any time — closed for refit"]],
  "occ":["Stock, fixtures and furniture?",[["vacant","Cleared — empty"],["occ","Stays — we work around it"]]],
  "wear":"Scuffs, fixing holes, sign shadows, grease near the kitchen","work":"Damaged plaster, water marks, heat damage behind the kitchen line"}$j$, null,
  $j${"rooms":{"floor":["Front of house",[10,8],"living"],"boh":["Back of house",[5,4],"kitchen"],"fit":["Fitting room",[1.5,1.5],"storage"]},"alsoSize":{"Bar":[6,3,"living"],"Amenities":[3,2.5,"bathroom"],"Staff room":[4,3.5,"living"],"Corridor":[8,1.5,"hallway"],"Covered outdoor dining":[8,5,"outside"]}}$j$),
('health', 40, 'Healthcare or aged care', 'Aged care and clinics online · hospitals we visit', 'range', true, $j${
  "kick":"HEALTHCARE OR AGED CARE","title":"Tell us about the facility","sub":"Counts are fine. We work in small areas at a time around residents and patients, and price it that way.",
  "openCopy":"Lounges and dining rooms are open, with tiled or set ceilings and a lot of cutting-in. Tell us the size and the ceiling; a photo or two lets your estimator check.",
  "kindQ":["Which kind?",[["aged","Aged care"],["clinic","Medical centre or clinic"],["hospital","Hospital — we visit"]]],"kindBrief":{"hospital":"hospital"},
  "counts":[["rooms","Resident rooms, wards or treatment rooms","",12],["lounges","Lounges and dining rooms","Open spaces — we ask about them next",2],["corr","Corridors or wings","",2]],
  "openKey":"lounges","openLabel":"Lounge or dining room","also":["Nurses' stations","Reception","Amenities","Kitchen","Fire stairs"],
  "surf":["Walls","Ceilings — plaster only","Doors","Door frames","Handrails and bump rails","Skirtings","Window frames — timber only","Feature walls"],"surfKeys":{"Walls":"walls","Ceilings — plaster only":"ceilings","Doors":"doors","Door frames":"architraves","Handrails and bump rails":null,"Skirtings":"skirting","Window frames — timber only":"windows","Feature walls":"walls"},
  "hours":[["business","Daytime"],["after","After hours"],["staged","Staged, a wing at a time"]],
  "occ":["Working around residents or patients?",[["occ","Yes — small areas at a time"],["vacant","No — the area will be closed"]]],
  "wear":"Scuffs, trolley marks, bed-head knocks","work":"Damaged plaster, bump-rail damage, water marks"}$j$,
  $j${"kick":"HOSPITAL","title":"Tell us about the hospital","sub":"Hospitals are priced on site — infection control, clearances and approvals come before the painting. A few questions get us ready, then you pick a time.","what":["Wards","Corridors","Treatment rooms","Theatres or clinical areas","Common areas and reception","Exterior"],"rows":[["Working hours",["Staged around patients","Closed areas only","After hours"]],["You are",["Facilities manager","Maintenance","Project manager"]]],"photo":"— a ward, a corridor, a treatment room"}$j$,
  $j${"rooms":{"rooms":["Room",[3.5,4],"bedroom"],"lounges":["Lounge",[8,7],"living"],"corr":["Corridor",[20,2],"hallway"]},"alsoSize":{"Nurses' stations":[5,4,"study"],"Reception":[5,4,"living"],"Amenities":[3,2.5,"bathroom"],"Kitchen":[5,4,"kitchen"],"Fire stairs":[3,2.5,"hallway"]}}$j$),
('school', 50, 'School or education', 'Classrooms, halls, corridors', 'range', true, $j${
  "kick":"SCHOOL OR EDUCATION","title":"Tell us about the school","sub":"Counts are fine. Most school work happens in the holidays — tell us the window and we plan around it.","openMode":"height",
  "openCopy":"Halls and gyms have high walls. Above about four metres we allow for a platform or lift, shown as its own line — the height matters more than the floor area.",
  "counts":[["classrooms","Classrooms","",8],["halls","Halls or gyms","High ceilings — we ask about them next",1],["corr","Corridors","",2]],
  "openKey":"halls","openLabel":"Hall or gym","also":["Admin offices","Staff room","Toilets","Library","Covered outdoor areas","Canteen"],"alsoFlag":{"Covered outdoor areas":"outside — priced on site"},
  "surf":["Walls","Ceilings — plaster only","Doors","Door frames","Skirtings","Window frames — timber only","Pinboard surrounds","Feature walls"],"surfKeys":{"Walls":"walls","Ceilings — plaster only":"ceilings","Doors":"doors","Door frames":"architraves","Skirtings":"skirting","Window frames — timber only":"windows","Pinboard surrounds":null,"Feature walls":"walls"},
  "hours":[["holidays","School holidays"],["after","After hours in term"],["weekend","Weekends"]],
  "occ":["Which holidays?",[["next","The next break"],["later","A later one"],["ns","Not sure yet"]]],
  "wear":"Scuffs, blu-tack, pinboard marks","work":"Damaged plaster, water marks, graffiti"}$j$, null,
  $j${"rooms":{"classrooms":["Classroom",[8,7],"living"],"halls":["Hall",[20,15],"living"],"corr":["Corridor",[25,2.2],"hallway"]},"alsoSize":{"Admin offices":[4,3.5,"study"],"Staff room":[6,5,"living"],"Toilets":[4,3,"bathroom"],"Library":[10,8,"living"],"Covered outdoor areas":[12,6,"outside"],"Canteen":[6,5,"kitchen"]}}$j$),
('strata', 60, 'Strata or common property', 'Lobbies, stairwells, facade', 'brief', true, '{}'::jsonb,
  $j${"kick":"STRATA OR COMMON PROPERTY","title":"Tell us what the building needs","sub":"Buildings like this are priced on site — access, heights and shared areas can't be guessed from a form. Four quick questions get us ready, then you pick a time.","what":["Lobbies and corridors","Stairwells","Lift lobbies","Car park","Fire doors","Exterior facade","Balconies","Fences and gates"],"rows":[["Levels",["1–3","4–8","9+"]],["Approx. units",["Under 10","10–30","30–80","80+"]],["You are",["Owners corp manager","Committee member","Building manager","Owner"]],["Is there a scope of works already?",["Yes — I can send it","No"]],["Timing",["Before the next meeting","No rush"]]],"photo":"— the lobby, a corridor, a stairwell, the outside from the street"}$j$, '{}'::jsonb),
('shopfront', 70, 'Shop front — the facade', 'Street frontage, awnings, signage', 'brief', true, '{}'::jsonb,
  $j${"kick":"SHOP FRONT — THE FACADE","title":"Tell us about the frontage","sub":"Shop fronts are priced on site — awnings, signage, heights and the footpath change everything. A few questions get us ready, then you pick a time.","what":["Render or masonry","Timber","Metal frames or shutters","Awning or verandah","Signage to work around","Roller shutter or grille"],"rows":[["Levels on the frontage",["Ground only","Two","More"]],["Where is it?",["Strip shop","Shopping centre","Stand-alone"]],["Trading hours we work around?",["Yes","No — closed for refit"]],["Footpath in front?",["Yes","No"]]],"photo":"— from across the street, and one close up of the frontage"}$j$, '{}'::jsonb),
('other', 80, 'Something else', 'Church, club, gym, hotel…', 'brief', true, '{}'::jsonb,
  $j${"kick":"SOMETHING ELSE","title":"Tell us a bit about the place","sub":"A few questions get us ready, then you pick a time.","what":["Inside","Outside","Both"],"rows":[["Roughly how big?",["One room or space","A few spaces","A whole building"]],["Approx. height",["Up to 4 m","Over 4 m"]],["You are",["Owner","Manager","Committee"]]],"photo":"— a few of the spaces"}$j$, '{}'::jsonb),
('exterior', 90, 'Commercial — outside', 'Every commercial exterior is priced on site', 'brief', false, '{}'::jsonb,
  $j${"kick":"COMMERCIAL — OUTSIDE","title":"Tell us about the outside","sub":"The outside of a commercial building is always priced on site — heights, access equipment and traffic management decide the job. A few questions get us ready, then you pick a time.","what":["Render or masonry","Precast or tilt slab","Metal cladding","Timber","Windows and frames","Roller doors","Fences and gates","Signage to work around"],"rows":[["Levels",["Ground only","Two","More"]],["Street frontage or footpath?",["Yes","No"]],["Trading or operating while we work?",["Yes","No"]]],"photo":"— from across the street, and each side you can reach"}$j$, '{}'::jsonb)
on conflict (key) do update set position = excluded.position, name = excluded.name, tile_hint = excluded.tile_hint, route = excluded.route, tile = excluded.tile, config = excluded.config, brief = excluded.brief, typicals = excluded.typicals, updated_at = now();

-- ⚑20 / ⚑21 / ⚑22 / ⚑32 — the commercial numbers, as one Settings row.
-- Loadings are HOUR multipliers on production labour, after the multiplier
-- chain and before allowances; they never touch materials or allowances
-- (§4.14). Widening is added to the band percentage on the reveal. The
-- charge-out is null until Tom sets one — the residential rate applies.
insert into public.settings (key, value) values ('commercial_pricing', jsonb_build_object(
  'loadings', jsonb_build_object('after', 1.35, 'weekend', 1.40, 'staged', 1.25, 'early_start', 1.15, 'operating', 1.15, 'occupied', 1.06, 'holidays', 1.0, 'business', 1.0, 'before', 1.15, 'closed', 1.0, 'next', 1.0, 'later', 1.0, 'ns', 1.0),
  'widenPct', jsonb_build_object('commercial', 5, 'warehouse', 5, 'noPhotoOpen', 3),
  'racking', jsonb_build_object('some', 0.88, 'most', 0.70),
  'ewpHeightThresholdM', 4,
  'chargeOutCents', null
)) on conflict (key) do nothing;

insert into public._prod_migrations(name) values ('20270140000000_commercial_segments.sql') on conflict (name) do nothing;
