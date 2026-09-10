# Commercial estimator — the experience, segment by segment

**Prepared:** 10 September 2026 · v2.1 of the estimator journey
**Status:** updated to v2.2 with Tom's rulings of 10 September (glass not asked; hospitality joins retail; healthcare counts and the hospital route; every school exterior a visit; inside/outside/both on every segment; "or we visit" on every ranged tile). The prototype (`estimator-journey-v2.html`, v2.2) has every screen below; the build changes are in the addendum. Where an older sentence below mentions a glass question, the v2.2 ruling wins: **glass is not asked**.
**Money:** AUD inc. GST, illustrative.

---

## 1. Your five points, and what they became

| You said | What it became |
|---|---|
| Body corporate and shop fronts are the hardest to price — push quickly to an appointment | Every segment tile says up front whether it's **ranged online** or **we come to you**. Strata, shop fronts, "something else" and every commercial exterior go to a four-question brief with photos, then straight to a booking with real slots. No number, and the screen says why in one sentence. |
| Inside *and* outside — prompt them to price separately or book | A new screen after step 1 when they pick Both: *price them yourself, one after the other* (inside first; the reveal then offers "now price the outside") or *book an estimator for both*. |
| Always a large "just book someone in" / "call us" on the first page — time-poor people want a human | A card on screen 1, under the job question. And a **Save & book** pill in the header of every screen after it — one tap saves everything typed so far and hands it to a person, with slots. |
| Outside → Commercial → Next loops back to step 1 | That's a v1 defect (job type and property kind share screen 1 there; the commercial hand-off returns to page 1 on the exterior branch). Logged as a hot-fix in the addendum. In v2 the outside route now asks the property kind and routes commercial to the brief. |
| Offices, warehouses, healthcare, schools should be ranged with the right questions; the ladder/lift gate questions are irrelevant for interiors; bedrooms and storeys make no sense for a warehouse | Four ranged patterns built: **the office pattern** (offices, healthcare, schools, retail interiors — counts, then the open spaces with glass share, ceiling type and a photo), and **the warehouse pattern** (floor-area brackets to 5,000 m²+, height to the underside of the roof, industrial surfaces with counted doors, wall material, racking, operating, equipment on site). No gates as walls: height and equipment appear where they're relevant, hours is a loading, induction and committees are captured on the brief. |

**The one rule that makes this safe:** a person confirms every commercial price before it can be accepted. That's what lets the six gates from the August strategy become questions instead of stops — the range is for planning and comparing, and nothing is fixed until an estimator says so, from photos or on site.

---

## 2. Which segments get a range, and why

| Segment | Inside | Outside | Why |
|---|---|---|---|
| Office | **Range** — or a visit | Brief + book | Repeatable rooms, bounded variables; your own jobs price cleanly ($8.89–12.91/m²). Open spaces are the risk, so they get their own questions and a photo. |
| Industrial / warehouse | **Range** (wider) | Brief + book · **both: one visit** | Walls size from area × height; the price movers are height (lift), racking and operating — all askable. Outside is boom lifts and traffic management: never online. Ruled: inside / outside / both asked; both → one visit. |
| Retail, hospitality and restaurants — inside | **Range** — or a visit | Brief + book | An office with a glass frontage, an exposed ceiling and a kitchen. After-trading hours is a loading, not a stop. |
| Healthcare / aged care | **Range** for aged care and clinics · **hospitals: visit** | Brief + book | Counts of rooms, wards and treatment rooms work; staging around residents is a loading. Ruled: hospital → brief. |
| School / education | **Range** (wider) | **Visit — always** | Classrooms count cleanly; halls are the risk (height), so the hall asks height. Holiday window is the scheduling question. Ruled: every school exterior is a visit. |
| Strata / common property | Brief + book | Brief + book | Nobody on the body corporate knows the square metres; access dominates outside; the decision is a committee on an AGM cycle. The brief captures what the estimator needs and the meeting date the quote must survive to. |
| Shop front — the facade | Brief + book | Brief + book | Awnings, signage, heights over the verandah, footpath permits, centre rules. See §4 for why not to show a number in v1. |
| Something else | Brief + book | Brief + book | Church, club, gym, hotel — too varied to guess. The brief asks size and height and the estimator decides. |

Range widths: commercial guide = the residential band plus `commercial_range_widen_pct` (default 5); warehouse plus a further `warehouse_range_widen_pct` (default 5); any ranged segment with an open space and **no photo** plus `open_space_no_photo_widen_pct` (default 3). The tighten stage narrows exactly as residential does. Fix-online is never offered on commercial.

---

## 3. The segments, one at a time

Each section: who's asking · what actually drives the price · what we ask · where the risk sits · the tighten areas · routing · engine notes.

### 3.1 Office

**Who's asking.** A tenant refreshing a suite; a landlord or agent doing a make-good between tenants; a facilities manager with a floor. The make-good case is the most common and the most repeatable — it's a saved spec on the trade portal ("vacate make-good · walls and plaster ceilings · two coats · Level 3").

**What drives the price.** Wall area minus glass; whether the ceilings are painted at all (tiles no, set plaster and bulkheads yes); doors (solid-core, both sides) and their frames (metal, enamel); skirtings (often vinyl — none); columns and bulkheads; condition (fixing holes and picture hooks from the last fit-out); hours (after-hours loading, building induction, security); access (lift, loading dock, parking, protecting carpet and workstations); occupied (shifting and covering desks).

**What we ask — quick look (two screens).**
1. *Counts:* private offices · open-plan areas · meeting rooms and boardrooms. Then **the open-plan card**: size bracket (up to 50 / 50–150 / 150–400 / 400+ m²), the ceiling (tiles — not painted / plaster — painted / exposed — not included), and a photo prompt. **Glass is not asked** — the cutting-in around partitions takes what the glass saves, so walls price at the full perimeter and the estimator adjusts from the photo. *Also being painted:* reception, corridors, kitchen or break room, amenities, server or comms room, fire stairs.
2. *The job:* surfaces (walls, ceilings — plaster only, doors, door frames, window frames — timber only, skirtings, columns and bulkheads, feature walls) · what's changing colour (walls / ceilings / doors and frames, plus lighter-or-brand) · condition (good / some wear — "scuffs, picture hooks, holes from the last fit-out" / needs work) · when can we work (business hours / after hours / weekends) · occupied or vacant.

**Where the risk sits.** The open space — not because glass reduces the area (it doesn't, once cutting-in is counted), but because ceilings, bulkheads and columns vary and nobody describes them well over a form. That's why the open-plan card exists, why it asks for a photo, and why the range stays wider without one. Everything else is counts and typicals.

**Tighten.** One area card per office, meeting room and also-ticked area, exactly like a residential room. Open-plan cards carry the size and ceiling block at the top. The "What we'll do" panel shows the office set (metal frames get enamel; plaster ceilings flat; no skirting line if none). Site & access asks lift, dock, parking and induction instead of carpet and floors.

**Routing.** Guide range → tighten → *send for confirmation*. The estimator confirms from photos where the open spaces are photographed; books a visit where they aren't or the floor is large.

**Engine notes.** Open-plan wall area = perimeter from the size bracket × wall height, full perimeter; ceiling line only when `plaster`; typicals for offices 3.5 × 4 m, meeting 4 × 5 m, boardroom 6 × 8 m (⚑ yours to set in `business-inputs`). Hours loading and occupied factor are Settings multipliers on hours, not on materials.

### 3.2 Healthcare and aged care

**Who's asking.** An aged-care facilities manager (most likely); a medical centre or clinic practice manager; occasionally a hospital's maintenance department.

**What drives the price.** Staging — a wing or a handful of rooms at a time, with rooms vacated in turn; working around residents (small areas, daily pack-down, no fumes — low-odour products); bump rails and handrails (lots, enamel); corridor lengths; compliance before a brush is lifted (induction, police check or NDIS worker screening, flu vaccination, infection-control containment in hospitals).

**What we ask.** First: *aged care / medical centre or clinic / hospital* — hospital goes to the brief. Then counts: resident rooms, wards or treatment rooms · lounges and dining rooms (the open-space card: size, ceiling, photo) · corridors or wings. Also: nurses' stations, reception, amenities, kitchen, fire stairs. The job: surfaces (adds handrails and bump rails), colours, condition ("scuffs, trolley marks, bed-head knocks"), hours (daytime / after hours / staged a wing at a time), **working around residents or patients?** (yes — small areas at a time / no — the area will be closed).

**Where the risk sits.** Staging. A 40-room facility painted four rooms at a time is a different job from the same facility vacated wing by wing. The hours/staging question applies a loading and marks the estimate for confirmation with a *compliance* flag so the estimator's site checklist (induction, screening, products) is filled before the visit.

**Hospitals — ruled.** Aged care and clinics are residential-like rooms and the range is for planning; an acute hospital is infection control, clearances and approvals with painting as the small part. The kind question routes **hospital** to its own brief (wards, corridors, treatment rooms, theatres, common areas; working hours; who's asking).

**Engine notes.** Staged loading (Settings, default 1.25 on hours) and occupied factor; handrails per metre from the corridor count; low-odour product substitution as a materials rule, not a customer question.

### 3.3 School and education

**Who's asking.** A business manager or facilities officer; sometimes a principal; for independents, a property manager. Government schools may come via a maintenance contractor.

**What drives the price.** The holiday window (two weeks — crew size and duration are the constraint, not the painting); halls and gyms (height — platform or lift; lots of wall); classrooms (repeatable, lots of pinboards and door/frame sets); corridors; toilets; covered outdoor areas (exterior — brief); compliance (Working with Children Check for every painter, induction).

**What we ask.** Counts: classrooms · halls or gyms (the open-space card in *height mode*: size, how high are the walls up to 4 / 4–6 / over 6 m, ceiling, photo) · corridors. Also: admin offices, staff room, toilets, library, covered outdoor areas (flagged *outside — priced on site*), canteen. **Every school exterior is a visit** — outside on the which-part row goes to the brief. The job: surfaces (adds pinboard surrounds), colours, condition ("scuffs, blu-tack, pinboard marks"), when (school holidays / after hours in term / weekends), which holidays (the next break / a later one / not sure yet).

**Where the risk sits.** Halls (height) and the window (duration). A hall over 6 m adds an EWP line and flags for a person; the holiday window is passed to scheduling as a hard constraint on the estimate.

**Engine notes.** Classroom typical 8 × 7 × 3 m (⚑); halls sized from bracket × height; EWP pass-through line above 4 m; WWCC as a site-checklist item, not a price line.

### 3.4 Retail, hospitality and restaurants — inside

**Who's asking.** A shop owner or franchisee at refit or lease renewal; a café, restaurant or bar owner between the lunch and dinner services; a centre tenancy coordinator; a fit-out builder wanting the painting priced.

**What drives the price.** The sales floor (glass frontage; exposed or black ceilings — sprayed; shelving walls); back of house; fitting rooms (small, many doors); hours (after trading or before opening; in a centre, night work with induction and no-noise rules); stock and fixtures staying; brand colours (strong colours — undercoat).

**What we ask.** Counts: sales floor or dining areas (the front-of-house card: size, ceiling, photo) · back of house, kitchens and store rooms (commercial kitchens get a washable, wipe-down system) · fitting rooms or private dining. Also: bar, amenities, staff room, corridor, covered outdoor dining (flagged *outside — priced on site*). The job: surfaces (adds *exposed ceiling — sprayed*, *kitchen walls — washable*), colours (brand colours under "going much lighter, or brand colours"), condition ("scuffs, fixing holes, sign shadows, grease near the kitchen"), when (after trading / before opening / any time — closed for refit), stock, fixtures and furniture (cleared / stays).

**Where the risk sits.** The exposed ceiling (a spray job, priced by a person) and centre rules. Both are flags on the confirmation, not stops on the range.

### 3.5 Industrial and warehouse

**Who's asking.** An owner-occupier; a facilities or operations manager; a landlord's agent at lease end (make-good); occasionally a builder on a new tilt-slab shell that needs sealing.

**What drives the price.** Wall area from floor area × height; wall material (precast/tilt slab bare → sealer; blockwork → block filler; metal sheeting → wash and specific primer; plasterboard offices); height (above ~4 m a scissor lift — hire, or theirs on site); **racking** against the walls (paint above it, or they clear it — the single biggest swing); operating during works (forklift traffic, exclusion zones, after hours); dust (blow-down or wash first); roller doors (inside face, both if the outside is ticked); personnel doors and frames; structural steel and columns (rust treatment, Metalshield); bollards and safety yellow; line marking (per metre — flagged for a person); offices and mezzanine inside; amenities.

**What we ask.** First the which-part row — *inside / outside / both*: outside goes to the exterior brief (boom lifts, traffic management), **both goes straight to one visit**. Then floor area (up to 500 / 500–1,000 / 1,000–2,500 / 2,500–5,000 / over 5,000 m², or type length × width) · height to the underside of the roof (up to 4 / 4–6 / 6–9 / over 9 m, with the scissor-lift note) · what's being painted (walls, underside of the roof — flagged, structural steel — flagged, roller doors counted, personnel doors counted, bollards, line marking — flagged, offices inside counted, mezzanine, amenities) · wall material (multi) · racking against the walls (no / some / most) · operating during the works · a scissor lift or forklift on site we can use. Then the same job screen: colours, condition ("dust, scuffs, forklift marks" / "forklift damage, rust, cracked blockwork"), hours.

**Where the risk sits.** Racking and height. "Most walls" racked drops the paintable area to the strip above the racking and changes the method; over 6 m is boom territory and the range widens. Underside of roof, steel and line marking are on the screen so the customer can say they want them, but they're priced by a person — the assume list says so.

**Tighten.** Areas: *Warehouse floor* (one card, carrying the material shares and door counts), offices 1..n, mezzanine, amenities. No bedrooms, no storeys, anywhere.

**Engine notes.** Wall area = 2 × (L + W) × H from the bracket midpoints (or the typed L × W); racking factor on wall area (some 0.88, most 0.70 ⚑); scissor lift as a pass-through line above 4 m unless `lift_on_site`; block filler / sealer / primer as substrate rules in the derivation table; roller doors priced per door per face; operating loading (Settings, default 1.15).

### 3.6 Strata and common property

**Who's asking.** An owners-corporation manager (intermediary, often with three quotes to collect); a committee member; a building manager; occasionally a consultant with a scope of works already written.

**What drives the price — and why it can't be ranged.** Inside: lobbies and corridors per level, stairwells, lift lobbies, car parks, fire doors (counted and tagged, not painted over), balustrades. Outside: facade material and condition, balconies, access (EWP, swing stage, scaffold, abseil — each a different job), render repairs and concrete spalling (not painting, but on the same walls), membranes. Nobody on the OC side knows the metres; the decision waits for a committee or AGM; the quote must carry a certificate of currency and survive to the meeting date.

**What we ask — the brief.** What needs painting (lobbies and corridors, stairwells, lift lobbies, car park, fire doors, exterior facade, balconies, fences and gates) · levels (1–3 / 4–8 / 9+) · approx. units (under 10 / 10–30 / 30–80 / 80+) · you are (OC manager / committee member / building manager / owner) · is there a scope of works already? (yes — I can send it / no) · timing (before the next meeting — date / no rush) · photos (lobby, corridor, stairwell, outside from the street) · anything else.

**Routing.** Straight to *Book your commercial estimator*: three steps (we visit and measure · scope of works and fixed quote with insurances and SWMS attached · nothing fixed until you say so, held 60 days or to your meeting date), real slots, work email. The account and property are created on booking; the brief and photos are on the estimator's tablet.

**What the estimator brings back.** A scope of works document the manager can put in front of the committee, the certificate of currency, and a quote valid to the AGM. That's the artefact that wins strata work, and the platform should generate it from the confirmed tree — a later phase, noted in the addendum.

### 3.7 Shop front — the facade

**Who's asking.** The shop owner, the landlord, a centre's tenancy coordinator, or a builder at refit.

**Why it's priced on site.** The awning (underside and fascia — often the biggest surface, always the hardest access); signage (removal and reinstatement by others, or painting around it); heights over the verandah (platform on a footpath needs a council permit and traffic management); centre rules (night work, induction); shopfront frames (powder-coated aluminium — usually not painted; timber shopfronts — yes, and often the worst condition on the street); roller shutters and grilles (enamel, both faces, working around the mechanism).

**What we ask — the brief.** What needs painting (render or masonry, timber, metal frames or shutters, awning or verandah, signage to work around, roller shutter or grille) · levels on the frontage (ground only / two / more) · where is it (strip shop / shopping centre / stand-alone) · trading hours we work around (yes / no — closed for refit) · footpath in front (yes / no) · photos (from across the street, and one close up) · anything else. Then booking.

### 3.8 Something else, and every commercial exterior

"Something else" (church, club, gym, hotel, medical suites in a house) gets a three-question brief: inside/outside/both, rough size (one space / a few / a whole building), height (up to 4 m / over), who you are — then booking. Every commercial exterior, regardless of segment, gets the exterior brief: what needs painting, levels, made of, access (ground and ladder / needs a lift or scaffold / not sure), near a road or car park, photos of each side — then booking. That's the August strategy's "never online" list, honoured.

---

## 4. Shop fronts and retail — my recommendation

You asked whether to attempt a range for these two.

**Retail interiors — yes, range them.** Inside the shop is an office with a glass frontage and an exposed ceiling, and the pattern already asks about both. After-trading hours is a loading. The two things that break it — exposed ceilings (spray) and centre rules — are flags the estimator resolves at confirmation, which happens on every commercial job anyway. Nothing is lost by showing a range, and the shop owner comparing three quotes on a Sunday night gets a number from you first.

**Shop fronts — not in v1.** The facade variables aren't bounded: an awning can be half the job, a footpath platform needs a permit, a centre may require night work, and a wrong number on a public-facing shop is a reputation issue on the street you're trying to win. The brief-and-book path is short (five taps and a photo), lands with an account and a slot, and the August strategy's own note applies — most shop fronts route to appointment under any honest gate anyway. Revisit after twenty shop-front jobs give a $ per metre of frontage band with and without awnings; at that point a "simple frontage" range (ground only, strip shop, no awning) becomes defensible.

---

## 5. What the commercial segments need from the platform

- **Segment and area configuration as data, not code.** Each segment's counts, open-space mode (glass or height), also-areas, surface set, hours options, occupied question and copy lines live in a `commercial_segments` table read by the wizard. Adding "childcare" later is a row, not a build.
- **Open-space sizing in the engine.** Perimeter from the size bracket × wall height at the full perimeter (no glass deduction), ceiling type. The room card's "shape of this space" block is the same input.
- **Warehouse sizing in the engine.** Area × height → wall area; material → substrate prep rules; racking factor; equipment pass-through; door counts per face.
- **Loadings as Settings multipliers on hours.** After-hours, weekend, staged, early-start, operating-during-works, occupied-commercial. The strategy seeded 1.35 for after-hours; market signal 1.5–1.9× (⚑).
- **Compliance as a site checklist, not price lines.** Induction, SWMS, WWCC, police check, security, loading dock, certificate of currency, meeting date, hazmat check — captured on the brief or the confirmation and shown to the estimator before the visit (commercial-estimator-analysis phase 2, item 7).
- **The brief as a first-class object.** Segment, what, size answers, role, scope-exists, timing, photos, notes — saved on booking, attached to the confirmation request and the estimator's calendar event.
- **Save & book as a single RPC.** Saves the session snapshot, creates the account/property, creates a `confirmation_requests(kind=visit)` with the snapshot, books the slot through the existing scheduling system, emails the magic link. Where they left off is a screen id in the snapshot; the estimator opens the session at that screen.
- **The sector band cross-check** (`commercial_rates`) runs at confirmation, internally, before the fixed price goes out — as the August analysis proposed.

---

## 6. ⚑ Decisions (continuing the brief's numbering)

| # | Decision | Suggested default |
|---|---|---|
| 19 | Hospitals | **Ruled:** aged care / clinic / hospital question; hospital → brief |
| 20 | Commercial band widening: guide +5, warehouse +5 more, no-photo open space +3 | Ship as Settings, review at fifty jobs |
| 21 | Loadings: after-hours, weekend, staged, early-start, operating | 1.35 / 1.40 / 1.25 / 1.15 / 1.15 on hours — Settings |
| 22 | Racking factor on warehouse wall area | some 0.88, most 0.70 |
| 23 | Commercial typicals — office 3.5×4, meeting 4×5, boardroom 6×8, classroom 8×7×3, resident room 3.5×4 | Add to `business-inputs.md` |
| 24 | Shop fronts: no range in v1 (per §4) | Agree, revisit at twenty jobs |
| 25 | "Both": one combined range or two side by side? | Two on the reveal, combined total once both exist |
| 26 | Save & book: does booking a slot require an email, or is a mobile enough? | Email required (magic link), mobile optional |
| 27 | Commercial booking turnaround copy ("usually within a week") | Confirm what you can hold to |
| 28 | Strata scope-of-works document generated from the confirmed tree | Later phase; note it in the buildout order |
| 29 | Retail in a shopping centre: ask "which centre?" for induction rules | Free text on the brief, not a gate |
| 30 | Lead and asbestos | Ruled: no customer question, no hard stop; hazmat check on the estimator's site checklist |

---

## 7. What happens next

1. Walk the commercial screens on your phone — from the map, the Commercial section lists each one. The ? drawer has the reasoning.
2. Rule on #24 (shop fronts), and on the two pricing rates in the plan (#32 commercial charge-out, #33 contractor after-hours).
3. The addendum is ready for Claude Code as soon as those two are settled; everything else ships as a Settings default.
