# Estimator journey v2 — the plan of record (v2.2)

**Prepared:** 10 September 2026 · supersedes the 9 September plan
**Status:** for Tom's review. The prototype (`estimator-journey-v2.html` v2.2) has every screen in this plan; the ? drawer on each screen carries the reasoning. The Claude Code brief and its commercial addendum are the binding build contract; this document is the why and the map.
**Money:** AUD inc. GST on every customer surface. Figures here are illustrative.

**v2.5 (10 September).** Removed: the per-room condition question, the asbestos and pets questions, the asbestos/lead hard-stop screen and outcome, and the hospital brief's beds and infection-control rows. Hazardous-material checks move to the estimator's site checklist as `hazmat_check`, raised at every confirmation — a trained person makes that call rather than a form asking a customer something they can't reliably answer.

**v2.4 (10 September).** The person becomes part of the experience rather than a tile row at the bottom. The assigned estimator is named and present — a strip on the reveal, the tighten screen and the finish line; every footer carries one human line that changes with what's happening; and offers to book appear inline at the moments a person actually helps (flagging damage, an unknown size, a run of "not sures"). The old footer's nag, its count and its "Book in your estimator" tiles are gone; the primary action is now **Send to Sarah**, named for what it does.

**v2.3 (later on 10 September).** "How we'll paint each surface" is gone — it asked the customer to referee painter decisions and re-asked colours they'd already given. Colours are now one plain question, *what's changing colour?* (walls / ceilings / doors and trims, plus *going much lighter or bold?* and *still choosing?*); the second tighten rung is *a few details about what's there* (door style, window type, shiny or flat, ceiling height — with pictures and a photo shortcut); and the derived paint systems are a read-only *What we'll do* panel on the reveal, the tighten screen and the estimate, with one "something not right? tell us" link.

**What changed since 9 September.** Commercial is designed properly (§7): eight segments, four ranged patterns, briefs and bookings for the rest, and your five rulings from today. The trade portal is designed as a *reuse* of the same components rather than a separate product (§8). The pricing correlation with the existing engine is written out input by input (§9). Screen 1 has a book-someone-in card; **Save & book** sits on every screen; inside-and-outside gets a choice screen; the exterior route asks the property kind.

---

## 1. What we're solving

| Goal | The design target |
|---|---|
| A guide range as quickly as possible | Under a minute and about nine taps for a home; two screens for a ranged commercial segment. Today it's 25–30 answers. |
| Time-poor people get a range and a person; others add detail for a tighter price | One flow, two speeds. The range first; everything after it optional; a **person reachable from every screen** — the screen-1 card, the Save & book pill, the doors on the reveal, the finish line. |
| Preparation, coats per surface, access and defects properly factored | The customer never picks coats or prep. Colour intent + condition → derived paint systems per surface group, shown back in plain English. Access asked inside and out. Defects are photos pinned to a room, priced as repair lines. |
| Quote some jobs without looking; self-qualify the rest | **Remote confirmation**: a confirmed tree plus photos goes to the estimator console, where a person fixes the price without a visit and books one only when needed. |
| Commercial customers get a real experience, not "someone will call" | Every segment declares up front *online or we visit* / *we visit*. Ranged segments get the same reveal → tighten → confirmation loop with wider bands. Brief segments leave with an account, a saved brief, photos and a booked slot. |
| Trade customers get quick quotes | The same components, composed for a desk: saved specs, address book and building profiles, the spec sheet, tenant photo links, rebook — and **measured-once trees** that turn brief-only buildings into rangeable ones on the second visit (§8.3). |

No gamification. The only progression the customer sees is the range narrowing and three honest words: *guide → detailed → confirmed*.

---

## 2. Where today's wizard falls short

From the 9 September walk-through, plus what commercial exposed:

1. Screen 1 asks the customer to choose *our* route (describe / questions / floorplan) before showing any value.
2. Coats are one global choice by the customer. Coats differ by surface and the customer can't judge it — the biggest accuracy gap.
3. Condition is one global answer and "needs repair" is an unpriced text box.
4. Interior access is never asked.
5. Extras aren't asked.
6. Contact is a gate before the price (decision ⚑1).
7. The builder opens as nine amber cards of equal weight.
8. **Commercial is a blanket hand-off.** A $1,200 office touch-up and a hospital get the same "a person will call you". A warehouse is asked about bedrooms and storeys. Outside + Commercial + Next loops back to screen 1 (v1 defect ⚑31).
9. There is no "just book someone" for the person who never wanted a form.

The exterior sides builder — the plan from above with tappable edges — is the best idea in the current build and stays.

---

## 3. The journey in one page

```
SCREEN 1            QUICK LOOK                          THE FORK
address ──────┬─ home:  place → job → condition ───► GUIDE RANGE ─┬─► Tighten (rooms · systems · access · extras) → DETAILED
in/out/both   │                                                  ├─► Book your estimator
"book someone │─ both:  price separately (inside then outside) ─┘   └─► Keep it (email → magic link → portal)
 in" card     │         or book one visit
              │
              └─ commercial: segment (online-or-visit / visit) + which part
                    ├─ office · aged care & clinics · schools · retail & hospitality:  counts → open spaces → surfaces/colour/condition/hours → GUIDE RANGE (wider) → tighten → SEND FOR CONFIRMATION
                    ├─ warehouse:  area → height → surfaces → materials → racking/operating/lift → same
                    ├─ strata · shop front · hospital · something else · any outside · both:  BRIEF + photos → BOOK A VISIT
                    └─ Save & book on every screen — snapshot, account, slot, magic link

FINISH LINE:  fix online (qualifying homes only) · send for remote confirmation · book a visit · call back
```

---

## 4. The five accuracy questions

**What is being painted.** Home: scope preset × room tree seeded from bedrooms and storeys; per room, surfaces as tiles with counts. Commercial: counts × typicals, plus the open-space card (size bracket, ceiling type or wall height, photo); warehouse from area × height. Exterior: elements × sides. Room and area counts are always read from the tree, never from a label.

**Coats per surface — derived, never asked, never refereed.** The customer ticks *what's changing colour* (walls / ceilings / doors and trims), says whether any go *much lighter or bold*, and can say they're *still choosing* (we allow for new colours). With condition, that drives a derivation table per surface group (§9.2), Settings-editable, versioned with the rate card. The result shows as a read-only *What we'll do* panel in plain lines — "Walls: new colour, two coats, after filling the small marks and a light sand" — with one "tell us" link, no controls. Single coat is only reachable for a group whose colour isn't changing. The facts that change the systems (door style, window type, shiny old paint, ceiling height) are asked once with pictures on *a few details about what's there*, or read from one photo of a door and skirting. Commercial substrates (metal frames, precast, blockwork, sheeting, washable kitchen walls) are rows in the same table.

**Condition — a band, then spots.** One band up front for the whole job; per room or side, flagged spots with a photo and a tag (no per-room condition question). Minor tags auto-price from `defect_prep_rates`; the rest are estimator-review lines. Commercial condition copy is segment-specific (picture hooks and fit-out holes; trolley marks and bed-head knocks; forklift damage and rust).

**Access.** Home: cleared rooms, floors, void, parking, lift booking — the allowances-spec modifiers (ceiling height sits on the details screen). Commercial: lift, dock, parking, induction, security, centre rules; height where it matters (halls, warehouses → EWP line); racking; operating during works. Exterior: steep block, tight sides, double height, needs a lift or scaffold.

**Extras.** Per room: feature walls (counted, own colour), wallpaper, robe doors, "something else" flagged. Whole job: a sheet of the common extras. Commercial: flagged items (underside of roof, structural steel, line marking, exposed ceilings) shown so the customer can ask, priced by a person.

---

## 5. Accuracy tiers and routing

| Tier | Reached by | Band | Home | Commercial / trade |
|---|---|---|---|---|
| Guide | Quick look | ±15 (commercial wider, §9.5) | Tighten · book · keep | Tighten · book · keep |
| Detailed | Rooms confirmed, systems checked, access answered | ±8 → ±4 | Fix online if under the cap at ≥ 90%; else send for confirmation | Send for confirmation — **never fix online** |
| Confirmed | A person fixes it (remotely or on site) or a qualifying home fixes online | Fixed, held 60 days | Accept | Accept |

Routing uses the existing policy ladder unchanged in order: hard stops → outside area → hand-off → below minimum → reveal. New outcomes: `remote_confirmation_offered`, `commercial_gate_tripped` (now only for briefs and "both"), `fix_online` never for commercial or trade. The sector-band cross-check runs inside the fix-price RPC for commercial.

---

## 6. The customers this serves

| Customer | Path | What they leave with |
|---|---|---|
| Time-poor homeowner | Screen 1 → *book someone in* (or range → book) | A slot, a person, nothing to fill in |
| Someone who starts and stalls | The footer's human line and the inline offers meet them where they stop | A booked visit that keeps everything they entered |
| Careful homeowner or small job | Range → tighten with photos → fix online or send | A price they helped build, itemised, without a visit |
| Inside-and-outside homeowner | The choice screen: price each in turn, or one visit | Two ranges, or one booking |
| Office tenant, landlord, FM | Two screens → range → tighten → send | A planning number on Sunday night, a confirmed price by Tuesday |
| Warehouse owner or operator | Area, height, surfaces, racking → range → send | A ballpark with equipment shown as its own line |
| Shop, café, restaurant, bar | Two screens → range → send | A range with after-trading loading applied, kitchen system named |
| Aged care or clinic manager | Two screens → range → send with compliance flags | A planning range; the estimator arrives with the site checklist filled |
| School business manager | Two screens → range → send; outside always a visit | A range for the holiday window; halls priced by height |
| Strata manager or committee | Brief → book | A saved brief, a slot, and later a scope of works the committee can read |
| Shop-front owner, hospital, "something else", any commercial exterior | Brief → book | Same |
| Trade — agent, PM, body corp, builder, franchise, insurer | Saved spec or building profile → spec sheet → send | A quote from their desk in two minutes; a person confirms |

---

## 7. Commercial, segment by segment

Full reasoning per segment is in `commercial-estimator-experience.md`. The design as it now stands, with today's rulings folded in:

| Segment | Route | Quick look | Where the risk sits | Ruled today |
|---|---|---|---|---|
| Office | Online or visit | Private offices · open-plan areas · meeting rooms → open-space card (size, ceiling, photo) → also-areas → surfaces, colours, condition, hours, occupied | The open space | — |
| Retail, hospitality and restaurants | Online or visit | Sales floor or dining areas · back of house, kitchens and store rooms · fitting rooms or private dining → front-of-house card → bar, amenities, staff room, covered outdoor dining (flagged: outside, priced on site) | Exposed ceilings, kitchens (washable system), centre rules | Hospitality and restaurants join retail |
| Healthcare and aged care | Online or visit — **hospitals: visit** | *Aged care / clinic / hospital* first → resident rooms, wards or treatment rooms · lounges and dining · corridors or wings → lounge card → nurses' stations, reception, amenities, kitchen, fire stairs → hours incl. staged; working around residents | Staging; compliance | Count label changed; hospital routes to the brief |
| School and education | Online or visit — **outside: visit** | Classrooms · halls or gyms (height mode) · corridors → admin, staff room, toilets, library, covered outdoor areas (flagged: outside, priced on site), canteen → holidays window | Halls (height), the window | Every school exterior is a visit |
| Industrial and warehouse | Online or visit — **outside or both: visit** | *Inside / outside / both* → area brackets to 5,000 m²+ or L×W → height to the underside of the roof → industrial surfaces with counted doors → wall material → racking, operating, lift on site → colours, condition, hours | Racking and height | Inside/outside/both asked; both goes straight to one visit |
| Strata or common property | Visit | Brief: what, levels, units, role, scope exists, timing/meeting date, photos, notes | Access, unknown metres, committee cycle | — |
| Shop front — the facade | Visit | Brief: what, levels, strip/centre/stand-alone, trading hours, footpath, photos | Awnings, signage, permits | No range in v1 (recommendation stands) |
| Something else | Visit | Brief: inside/outside, size, height, role, photos | Too varied | — |

**Cross-cutting rulings from today**

- **"Online or we visit" on every ranged tile.** Nobody reads *range online* as online-or-nothing. The sub copy says a visit is always on offer.
- **Glass is not asked.** Partitions look like less wall, but the cutting-in around them takes what the glass saves. Walls price at the full perimeter; the open-space card asks size and ceiling (or height) and a photo; the estimator adjusts from the photo at confirmation. This is also cleaner in the engine (§9.3).
- **Which part — inside / outside / both — sits under the segment tiles**, pre-filled from screen 1. Outside goes to the exterior brief for every segment; both goes to a single visit ("one visit covers both").
- **School and hospitality outside areas** are flagged "priced on site" when ticked, rather than blocking the interior range.

---

## 8. The trade portal — reusing the same UX and UI

### 8.1 The principle: one component library, three compositions

The public wizard, the customer portal's embedded builder and the trade portal are **the same components over the same tree and the same engine**, composed differently. Nothing is forked. The components already exist in the prototype and become the library:

| Component | Public | Portal (logged-in customer) | Trade |
|---|---|---|---|
| Quick-look screens (place/job/condition; counts/open-space/job; warehouse) | As designed | Prefilled from the property; email step skipped | Prefilled from the saved spec and building profile; density compact |
| Reveal (range, assume list, doors) | Three doors | Two doors (keep is implicit) | Range immediately; doors become *spec sheet* / *send* |
| Tighten (room list, room card, systems, access, extras) | Guided | Guided | The **spec sheet** — the same tree as a grid, cell taps call the same RPCs |
| Save & book sheet | On every screen | On every screen | "Send to estimator" — no email capture, slots optional |
| Brief + book | Strata, shop front, hospital, exteriors | Same | Prefilled from the building profile; slots from the account's estimator |
| Finish line | Fix online / send / visit | Same | Send for confirmation only |

A `mode: public | portal | trade` prop on each component switches density, defaults, gates and copy. Copy in trade mode says the property's name, not "your home". Desktop in trade mode is two panes — the tree or sheet on the left, the range, assume list and actions on the right — built from the same responsive components, not a second layout.

### 8.2 The business types and what "quick quote" means to each

| Business | The repeat job | Their quick quote | Starts from |
|---|---|---|---|
| Real estate agents (residential rent-rolls) | End-of-lease make-good; vacate touch-up | Address → saved spec → range in under a minute → send | Home quick look, prefilled |
| Commercial property and facilities managers | Office make-good between tenancies; corridor and lobby refresh | Building profile → office pattern prefilled → range → send | Office pattern |
| Body corporate / OC managers | Annual corridor programme; stairwell repaint; facade cycle | First time: brief → visit. **Every time after: range from the measured tree** (§8.3) | Building profile with measured tree |
| Builders and fit-out contractors | Painting package on a fit-out | Floorplan upload as the primary input → rooms read → spec sheet → send | Floorplan reader → office or home pattern |
| Franchise and hospitality groups | The same fit-out, again, in the next suburb | Saved spec per brand (colours from the register, kitchen system, after-trading hours) → address → range | Retail and hospitality pattern |
| Insurers and loss adjusters | Scope matched to a claim | Rooms affected → flagged spots as evidence → itemised systems → send | Home pattern with photo-first condition |
| Aged care and school operators | Wing-by-wing or holiday-by-holiday programmes | Building profile → the pattern with counts remembered → range → send | Healthcare or school pattern with measured tree |

### 8.3 Measured once, ranged forever

The hard segments — strata, hospitals, shop fronts — can't be ranged for a stranger because nobody can give us the metres or the access. But the estimator's **first visit produces a measured tree**, stored against the property in the trade account. The second quote on that building — next year's corridors, the other stairwell, the next wing — starts from the measured tree and *can* be ranged online, by the same reveal → tighten → confirmation loop.

That turns "we visit" into a one-time cost per building, and it's the moat in its clearest form: the competitor quoting the same corridors next year still has to send someone; you have the building on file. It's also why the brief captures levels, units and the meeting date — they're the skeleton the measured tree fills in.

Build implication: `properties.measured_tree` (versioned; written by the estimator at confirmation; reused by rebook and by every later quick look on that property), and a **building profile** for trade accounts — address, segment, levels, access notes, compliance requirements, estimator assigned, colour register, measured tree.

### 8.4 What trade sees that the public doesn't

Range immediately (no reveal ceremony); the tree as a sheet; history and the register per property; compliance documents (certificate of currency, SWMS) one tap away; terms and statements; every job in one pipeline; a named estimator. What trade never sees: fix online (⚑11).

### 8.5 The design process for reuse

1. **Freeze the component library from the prototype** — tile, count row, open-space card, room card, range bar, meter, assume list, door, save-and-book sheet, brief, book, spec-sheet grid — and name them once.
2. **Prototype the trade composition before it's built**, exactly as we did for the public flow: `trade-portal-v2.html`, desktop and phone, three business types walked end to end (agent make-good, OC manager year-two corridors from a measured tree, franchise fit-out from a saved spec). This is the next design deliverable and the gate before the trade sessions (S7) start.
3. **Never let the compositions drift**: the public wizard and the trade quick quote render from the same segment configuration rows and the same tree; parity tests assert that the sheet and the guided flow produce identical trees for identical input.

---

## 9. How the pricing correlates with the existing model

### 9.1 The chain that exists today

```
1. rate_hours per surface line    from the rate card (m², per item, lineal m) — per-item charge-out on catalogue lines
2. × coat_factor                  lookup on total coats: 1 → 1.25 (same-colour only) · 2 → 1.75 · 3 → 2.50
3. × ie_calibration               interior 1.09 · exterior 1.15
4. × finish_factor                Level 2 0.90 · Level 4 1.00 (+ manual review)
   ──────────────────────────────────────────────── = painting hours
5. + allowances (unmultiplied)    setup · cleanup · occupied (per crew-day) · colour coordination (not contractor-payable)
6. + prep lines                   defect_prep_rates from condition photos · sundries · pass-throughs (billed vs cost)
7. × charge-out                   $85/hr ex GST interior (commercial realised $120–135/hr, quoted inconsistently ⚑)
   + materials                    products table by substrate and system
8. accuracy score → band          ±15 / ±8 / ±4 → the range
9. sanity layer                   $/m² against history before anything reaches a customer; commercial_rates sector bands (unread today)
   contractor basis               estimated hours × $60
```

v2 does not add a second engine and does not reorder this chain. Every new input lands in one of these steps.

### 9.2 Input by input

| v2 input | Lands in | Mechanism | Status |
|---|---|---|---|
| Bedrooms + storeys | Room tree | Typicals from `business-inputs.md` — exactly what "3-bed house" seeds today | Existing |
| Scope preset | Surfaces per room | Presets over the existing surface tiles | Existing |
| What's changing colour (walls / ceilings / trims) + lighter-or-bold + still choosing | Step 2 via the derivation table | Per-group colour intent (changing → new, bold → dark, unchanged → same, undecided → all new) → `paint_system_rules` → coats per group → the same `coat_factor` lookup. Anchors untouched: 2 → 1.75, 3 → 2.50; 1 → 1.25 only for an unchanged group | **Extended** (the table is new; the factor is not) |
| Details: door style, window type, shiny trims, ceiling height | Steps 1 and 2 | Door and window rate items by style; aluminium windows removed; gloss → bonding primer row; height into `storey_heights` | Existing items, one screen |
| Condition band | Step 6 | Prep band sets the default prep lines per surface group; `work` widens the band | Extended |
| Flagged spots | Step 6 | `defect_prep_rates` lines for auto-priced tags; estimator-review lines otherwise | Existing mechanism, new entry point |
| Site & access (home) | Step 5 | The four allowance modifiers from the allowances spec, verbatim; ceiling height into `storey_heights` | Existing spec |
| Commercial counts + typicals | Room tree | Same as bedrooms → rooms; typicals ⚑23 | Existing mechanism |
| Open-space size bracket | Step 1 wall m² | Perimeter from the bracket midpoint (square unless L×W typed) × wall height; **full perimeter, no glass deduction** — cutting-in offsets the glass (your ruling) | New sizing, existing rate |
| Ceiling type | Step 1 | `plaster` → ceiling line at the ceiling rate; `tiles` → no line; `exposed` → flagged unpriced line | New |
| Hall / warehouse height | Steps 1 and 6 | Wall m² from area × height; above 4 m an EWP **pass-through** line (billed and cost separately) unless `lift_on_site` | Existing Passthrough |
| Wall material (warehouse) | Steps 1 and 2 | Commercial substrate rows (precast, blockwork, sheeting, plasterboard) with their prep and primer rules — the Phase 1 data from `commercial-estimator-analysis.md` | Existing plan, now wired |
| Racking | Step 1 | Wall m² × racking factor (some 0.88, most 0.70 ⚑22) | New |
| Hours / staged / operating / occupied-commercial | **New step 4b** | Labour loadings as multipliers on *all labour hours* — painting and allowances — after finish_factor, before charge-out. Never on materials | New |
| Commercial charge-out | Step 7 | `charge_out_commercial` as its own Settings rate (the strategy's decision 1). Default = residential until you set it ⚑32 | New Settings value |
| Trade saved spec | Tree template | Scope, systems overrides, condition band, colour policy — a stored tree fragment, not a price | New |
| Measured tree (§8.3) | Room tree | The estimator's confirmed tree, reused as the seed | New |
| Sector band | Step 9 | `commercial_rates` read inside fix-price for commercial; outside the band → refuse with the band shown, override logged | Existing table, new read |

**Contractor basis.** Loadings raise on-site hours, so the contractor offer rises with them — correct for after-hours work. ⚑33 Whether the contractor *rate* also rises after hours (penalty) is a separate decision; suggested: a Settings rate `contractor_rate_after_hours`, default equal to the standard $60 until you rule.

### 9.3 Why "no glass" is also the right engine answer

With a glass share, the engine would deduct wall m² and then need a cutting-in line per lineal metre of frame to put the labour back — two new inputs, one of which the customer can't estimate, netting to roughly zero. Pricing the full perimeter at the wall rate (whose `rate_hours` already carries typical cutting-in) and letting the estimator adjust from the photo keeps the model honest and the question count down. If the proving window shows glazed offices consistently over-priced, the fix is a Settings factor on office wall rates, not a customer question.

### 9.4 Worked shape of a commercial range (illustrative)

Four offices, one open-plan area (50–150 m² bracket, tiled ceiling), one meeting room, new colours, some wear, after hours, occupied:

```
tree        4 × office 3.5×4×2.7 · 1 × open plan (perimeter from ~100 m² → ~40 lm × 2.7) · 1 × meeting 4×5×2.7 · doors, frames, skirtings from the surface set
step 1      wall/ceiling/trim m² and item counts × rate_hours (ceilings: offices plaster; open plan tiles → none)
step 2      × 1.75 (two coats, new colours)             step 3  × 1.09          step 4  × 1.00 (Level 3)
step 4b     × 1.35 after hours · × 1.06 occupied-commercial (on painting + allowances)
step 5      setup/cleanup from the room count (7 rooms) + occupied per crew-day + colour coordination (1 colour)
step 6      prep lines for "some wear" (fixing holes, light sand) · sundries
step 7      × charge_out_commercial + materials
step 8      accuracy band ±15 → +5 commercial → +3 if no open-space photo → ±23 (guide) · narrows to ±8 → ±4 through tighten
step 9      $/m² vs the office band at fix-price
```

No number is quoted here on purpose — the engine produces it, and it will be sanity-checked against your 13 commercial quotes before any customer sees a commercial range.

### 9.5 Calibration and the proving window

Commercial evidence is thin (13 quotes, no hospital, no strata exterior). So: bands start wider (Settings ⚑20); every commercial job logs guide range → confirmed price → actual hours per segment; the sector bands are the sanity layer until fifty jobs per segment give a better one; loadings are Settings values reviewed at the same point. The residential golden tests (2-coat and 3-coat totals unchanged) run on every commercial change, because it's the same engine.

---

## 10. How the moving parts fit

The artefact is still the **scope tree**. What v2.2 adds is that the tree can be seeded five ways — bedrooms and storeys, commercial counts, area × height, a floorplan, or a measured tree from a previous visit — and priced one way.

| Platform piece | What v2.2 does with it |
|---|---|
| Pricing engine | Derivation table; open-space and warehouse sizing; loadings step 4b; commercial charge-out; sector-band read at fix-price. Order unchanged |
| Allowances spec | Home modifiers verbatim; commercial setup adder and occupied-commercial per crew-day; exterior per-elevation still a separate spec |
| Policy ladder | Order unchanged; new outcomes; commercial and trade never `fix_online` |
| Wizard state (server-first) | Prerequisite; `last_screen` for Save & book resume; two trees under one session for "both" |
| Assisted sessions | Staff open the session at `last_screen` with the banner and attribution chips |
| Estimator console | Remote confirmation; the confirmation queue; compliance flags above the tree; the measured tree written at confirmation |
| `commercial_segments` | Segment configuration as data — counts, open-space mode, also-areas, surfaces, hours, occupied, copy, route |
| `commercial_briefs`, `site_checklist_items` | The brief and the compliance list as objects attached to the confirmation and the calendar event |
| CRM events | `guide_range_viewed`, `tighten_*`, `estimate_kept`, `confirmation_requested`, `visit_booked_from_wizard`, `price_fixed` — one log, one evaluator |
| Scheduling | Save & book and the commercial booking use the existing calendar; nothing new |
| WO loop | Flagged spots, systems and compliance items flow into the work order and the contractor's checklist |
| Customer portal | Keep-it creates the account; resume from the portal; the register feeds rebook |
| Trade portal | Same components in trade mode; building profiles; measured trees; saved specs; spec sheet; tenant photo link |
| AI assistant | Describe-it behind the bubble; plan-reader on side, room and open-space photos; the question thread |
| Inbound calls | Call transcript → prefilled quick look → assisted tighten |
| Help content | `docs/help/estimator/{customer,commercial,staff,trade}.md` under the Phase A rule |
| Calibration gate | Unchanged as the hard prerequisite before fixed prices reach customers; commercial adds per-segment logging |

Standing rules apply: one source of truth per list and badge; migrations between gate runs; briefs committed same day; worktrees for concurrent sessions; stop-and-report on missing references; no client-side money.

---

## 11. Build sequence

1. **Prerequisites** — server-first wizard state; A1b; allowances spec merged; the v1 hot-fix for Outside + Commercial (⚑31) as its own batch.
2. **S1 Quick look and guide range** — home; screen-1 card; Save & book RPC and sheet; "both"; exterior asks kind.
3. **S2 Paint-system derivation** in the engine, golden tests, the systems screen.
4. **S3 Tighten** — rooms, room card with the shape-of-this-space block, flagged spots.
5. **S4 Site & access, extras, finish line, hand-off** — commercial variants included.
6. **S5 Remote confirmation** in the console; measured tree written at confirmation.
7. **S6a Segment screen, office pattern, commercial reveal · S6b Warehouse · S6c Briefs, booking, all commercial exteriors, "both"** — can run in parallel worktrees after S5.
8. **Design gate: trade-portal prototype** (`trade-portal-v2.html`) — three business types, desktop and phone, approved before S7.
9. **S7 Trade** — building profiles, saved specs, address book, spec sheet, tenant photo link, register as default colours, rebook from the measured tree.
10. **S8 Assistant hooks.**
11. **S9 Hardening** — the customer stories (home ×3, commercial ×4, trade ×3), failure stories, load, help files, the v1 → v2 switch plan.

Each step ends with a phone walkthrough on the preview deploy before merge.

---

## 12. ⚑ Decisions

Ruled today (recorded, not re-asked): glass share not asked; hospitality and restaurants join retail; healthcare counts "resident rooms, wards or treatment rooms" and asks aged care / clinic / hospital; every school exterior is a visit; every segment asks inside / outside / both, outside → brief, both → one visit; every ranged tile says "or we visit".

| # | Decision | Suggested default |
|---|---|---|
| 1 | Email before the price or after, as "keep this estimate"? | After, with a soft "email me a copy" bar |
| 2 | The coat and prep derivation table | Ship as Settings rows; validate in the proving window |
| 3 | Ceilings on new-colour: one coat or two | One; "marked" → two |
| 4 | Trims on same-colour: one or two | Two; one only at `good` |
| 5 | Ask "are the doors and skirtings shiny?" | Yes — with pictures, on the details screen; a photo of a door and skirting answers it |
| 6 | Flagged spots: auto-price minor, review the rest | Yes |
| 7 | Remote confirmation cap and scope | Interior, ≤ $12k, off until flipped; fifty jobs then widen |
| 8 | Fix-online point | Engine central estimate, single number |
| 9 | Raise the $6k self-serve cap | Not yet |
| 10 | Bathrooms | Infer |
| 11 | Trade self-acceptance | Never in v1 |
| 12 | Trade default view | Spec sheet; guided for a new address |
| 13 | Hand-off turnaround copy | Confirm |
| 14 | "Describe it" placement | Behind the bubble |
| 15 | Exterior guide range before per-elevation allowances | Show, widened, exclusion stated |
| 16 | Hazardous materials | Ruled: no customer question, no hard stop; hazmat check on the estimator's site checklist |
| 17 | "Both" in one session | Two quick looks, two ranges (⚑25) |
| 18 | Phone number and estimator names | Settings and staff records |
| 19 | Hospitals | Aged care / clinic / hospital question; hospital → brief |
| 20 | Commercial band widening | +5 · warehouse +5 · no-photo open space +3 |
| 21 | Loadings | 1.35 / 1.40 / 1.25 / 1.15 / 1.15 / 1.06 |
| 22 | Racking factor | 0.88 / 0.70 |
| 23 | Commercial typicals | Into `business-inputs.md` |
| 24 | Shop fronts: no range in v1 | Agree; revisit at twenty |
| 25 | "Both": two ranges side by side, combined total once both exist | Yes |
| 26 | Save & book requires email | Yes; mobile optional |
| 27 | Commercial visit turnaround copy | Confirm |
| 28 | Strata scope-of-works document | Later phase |
| 29 | Which centre? | Free text on the brief |
| 30 | Lead and asbestos | Ruled: covered by the hazmat check at confirmation |
| 31 | v1 hot-fix: Outside + Commercial loop | Now, own batch |
| 32 | Commercial charge-out rate | Own Settings rate; default residential until set |
| 33 | Contractor rate after hours | Own Settings rate; default $60 until set |
| 34 | Measured tree stored on the property at confirmation, reused for every later quote | Yes — it's the moat |
| 35 | Building profiles for trade accounts | Yes; in S7 |
| 36 | Trade desktop layout: two panes, same components | Yes; prove it in the trade prototype |
| 37 | Trade prototype before S7 | Yes — next design deliverable |

---

## 13. What happens next

1. Walk v2.2 on your phone — the map's Commercial section has every screen, and the ? drawers carry today's rulings.
2. Rule on 24, 32 and 33 — the three that touch what the customer sees or what the engine charges. 19 is defaulted to hospital → brief.
3. I write the trade-portal prototype next (§8.5), three business types, desktop and phone, and the S7 brief follows it.
