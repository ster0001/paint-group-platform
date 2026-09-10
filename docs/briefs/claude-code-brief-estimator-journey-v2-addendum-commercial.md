# Build Brief Addendum — Estimator Journey v2.1: commercial segments, "both", and Save & book

**Applies to:** `docs/briefs/claude-code-brief-estimator-journey-v2.md` (the main brief). This addendum **replaces S6** of that brief and **amends S1, S3, S4 and §2/§3**. Everything else in the main brief stands.
**Approved design:** `design/reference/estimator-journey-v2.html` **v2.1** (10 Sep) — the Commercial section of the map, the "both" screen, the screen-1 card, the Save & book pill and sheet. The ? drawers are spec. `docs/briefs/commercial-estimator-experience.md` is the why.
**Status:** ready to build once ⚑24, ⚑32 and ⚑33 are ruled; every other new decision ships as a Settings default.

> **v2.2 corrections (10 Sep, Tom's rulings — build to these, not to the 9 Sep prototype):**
> 1. **No glass-share question anywhere.** Open-space walls price at the full perimeter; cutting-in around partitions offsets the glass. The open-space card asks size bracket, ceiling type (or wall height in height mode) and a photo. Remove `glass` from `wizard_state.commercial.open` and from §4.12.
> 2. **Every ranged tile reads "ONLINE · OR WE VISIT"**; brief tiles read "WE VISIT". The sub copy says a visit is always on offer.
> 3. **Retail becomes "Retail, hospitality and restaurants"** — counts: sales floor or dining areas · back of house, kitchens and store rooms · fitting rooms or private dining; also-areas add bar and covered outdoor dining (flagged "outside — priced on site"); surfaces add "kitchen walls — washable".
> 4. **Healthcare asks aged care / medical centre or clinic / hospital first**; hospital → the brief (`BRIEF.hospital` config). First count row is "Resident rooms, wards or treatment rooms"; "treatment rooms" leaves the also-areas.
> 5. **Which part — inside / outside / both — is a pill row under the segment tiles**, pre-filled from screen 1. Outside → the exterior brief for every segment. Both → `com-book` with the "one visit covers both" copy. No commercial exterior is ever ranged; schools in particular.
> 6. Schools and hospitality: outside areas in the also-list carry the flag "outside — priced on site" and do not block the interior range.
> 7. **v2.5:** the hospital brief has no beds row and no infection-control row; `hazmat_check` on `site_checklist_items` replaces the lead/asbestos hard stop, raised at confirmation.
> 8. **v2.3:** the commercial job screen's colour block is the same "what's changing colour?" tiles as residential (walls / ceilings / doors and frames + lighter-or-brand). No paint-system screen on the commercial path either; the "What we'll do" panel renders on the commercial reveal from the same derivation.

---

## 0. What changed, in one paragraph

Commercial is no longer a blanket hand-off or a six-question wall. Eight segment tiles each declare *range online* or *we come to you*. Offices, warehouses, retail interiors, healthcare and schools run a two-screen commercial quick look (counts → open spaces with glass/height, ceiling and a photo → surfaces, colours, condition, hours) into the same reveal → tighten → send-for-confirmation loop as residential, with wider bands and fix-online never offered. Strata, shop fronts, "something else" and every commercial exterior run a short brief with photos straight into a booking with real slots. "Both inside and outside" gets a choice screen. Screen 1 gets a large book-someone-in card, and a **Save & book** pill sits in the header of every screen — one RPC that snapshots the session, creates the account, books the slot and hands the estimator the exact screen the customer left from.

---

## 1. Additional reference files — commit with the rest

    docs/briefs/claude-code-brief-estimator-journey-v2-addendum-commercial.md   (this file)
    docs/briefs/commercial-estimator-experience.md                              (segment-by-segment design)
    design/reference/estimator-journey-v2.html                                  (v2.1 — replaces the 9 Sep file)

Kickoff ritual unchanged: commit, confirm the list back, STOP on anything missing.

---

## 2. ⚑ New business decisions — Settings values with defaults

| # | Decision | Default until Tom rules |
|---|---|---|
| 19 | Hospitals | **Ruled:** `health` asks *aged care / medical centre or clinic / hospital*; `hospital` → brief |
| 20 | Commercial band widening | `commercial_range_widen_pct` 5 · `warehouse_range_widen_pct` 5 · `open_space_no_photo_widen_pct` 3 |
| 21 | Hours and staging loadings (multipliers on labour hours) | `loading_after_hours` 1.35 · `loading_weekend` 1.40 · `loading_staged` 1.25 · `loading_early_start` 1.15 · `loading_operating` 1.15 · `loading_occupied_commercial` 1.06 |
| 22 | Racking factor on warehouse wall area | `racking_some` 0.88 · `racking_most` 0.70 |
| 23 | Commercial typicals | Rows in `business-inputs.md`: office 3.5×4, meeting 4×5, boardroom 6×8, resident room 3.5×4, classroom 8×7×3, sales floor from bracket, corridor width 1.8 |
| 24 | Shop fronts: no range in v1 | `shopfront_route: brief`. Revisit at twenty jobs |
| 25 | "Both": range display | Two ranges side by side on the reveal; combined total shown once both exist |
| 26 | Save & book: email required? | Yes (magic link); mobile optional |
| 27 | Commercial booking turnaround copy | Settings string `commercial_visit_turnaround_copy` — "usually within a week" |
| 28 | Strata scope-of-works document from the confirmed tree | Not this build — add to the buildout order |
| 29 | Retail in a centre: which centre? | Free text on the brief; feeds the site checklist |
| 30 | Lead and asbestos | **Ruled 10 Sep:** no customer question, no hard stop; `hazmat_check` on the estimator's site checklist at every confirmation |
| 31 | v1 hot-fix: Outside → Commercial → Next loops to step 1 | Fix in v1 now (§6); v2 avoids it structurally |
| 32 | Commercial charge-out rate | `charge_out_commercial` — own Settings rate; default = residential until Tom sets it |
| 33 | Contractor rate after hours | `contractor_rate_after_hours` — default 6000 cents until Tom sets it |
| 34 | Measured tree on the property at confirmation | `properties.measured_tree` (versioned) written by `fix_price`; reused by rebook and later quick looks |

---

## 3. Data model additions (SQL for Tom, between gate runs)

    commercial_segments     key (office|warehouse|retail|health|school|strata|shopfront|other),
                            name, route: range|brief, kick, title, sub,
                            counts jsonb        [{key,label,hint,default,room_label,typical:[l,w,h]}],
                            open_key, open_mode: glass|height, open_label, open_copy,
                            also jsonb          [{label, typical:[l,w]}],
                            surfaces jsonb      [{label, group, flagged:bool}],
                            hours jsonb         [{key,label,loading_key}],
                            occ jsonb           {question, options:[{key,label,factor_key}]} | null,
                            wear_copy, work_copy, widen_pct, sort
                            (seed the eight rows from the prototype's SEG/BRIEF configs)
    commercial_briefs       session_id, segment, job: interior|exterior,
                            what jsonb, rows jsonb (question → answer), notes,
                            photo_ids[], role, scope_exists bool, timing, meeting_date?,
                            created_at → attached to confirmation_requests and the booking
    wizard_state (jsonb)    + commercial: { segment, sub_segment (aged|clinic|hospital)?, part: interior|exterior|both, counts{}, open:{size, height?, ceiling, photo_ids[]},
                              also[], hours, occ, warehouse:{area, height, lw?, materials[], racking, operating, lift_on_site,
                              roller_doors, personnel_doors, offices, mezz, extras[]} }
                            + both: { interior_done, exterior_done }
                            + last_screen (string, for Save & book resume)
    site_checklist_items    estimate_id, key (induction|swms|wwcc|police_check|security|loading_dock|
                            centre_rules|coc_required|meeting_date|hazmat_check|low_odour), value, source: wizard|brief|staff
    confirmation_requests   + brief_id (nullable), + resume_screen, + compliance_flags[]
    settings                + every §2 key above

Derived, never stored: the segment's *range online / we come to you* tag (from `route`), the band widening in effect, the compliance flags list.

---

## 4. Server rules — additions

11. **Segment configuration is data.** The wizard renders counts, open-space blocks, also-areas, surfaces, hours and occupied from `commercial_segments`. No segment-specific JSX beyond the two patterns (areas+job, warehouse) and the brief.
12. **Open-space sizing in the engine.** `lib/pricing/commercial.ts`: perimeter from the size bracket midpoint (square assumption unless L×W typed) × wall height — **full perimeter, no glass deduction** (cutting-in offsets it; Tom's ruling); ceiling line only when `plaster`; `exposed` and `tiles` write a flagged, unpriced line so the estimator sees it. Height mode (halls, warehouse) sizes walls from area × height and adds an EWP pass-through line above `ewp_height_threshold_m` (default 4) unless `lift_on_site`.
13. **Warehouse walls** = 2(L+W)×H from bracket midpoints or typed L×W, × racking factor, split by material share; material → substrate prep from the derivation table (sealer on bare precast, block filler on blockwork, wash + metal primer on sheeting). Roller doors priced per door per face; personnel doors per door both sides.
14. **Loadings are hour multipliers** applied after the multiplier chain and before allowances, from Settings §2/21. They never touch materials or allowances.
15. **Commercial never reaches fix-online.** The policy ladder's `fix_online` outcome requires `kind ≠ commercial` and `account_type ≠ trade`. Every commercial finish line is `send_for_confirmation` (remote when the segment's range route and the ⚑7 cap allow, else visit).
16. **Brief segments never compute a price.** For `route = brief` the reprice RPC is not called; `guide_range_viewed` is not emitted; the flow goes brief → book. No number appears anywhere in the DOM — test it.
17. **Save & book is one RPC** (`save_and_book`): snapshot `wizard_state` + `last_screen`, `ensureAccountAndProperty`, create `confirmation_requests(kind=visit, resume_screen, brief_id?)`, book the slot on the existing scheduling system if chosen, send the magic link, emit `confirmation_requested` and `visit_booked_from_wizard`. Idempotent on session id. Staff open the session at `resume_screen` with the assisted-session banner.
18. **"Both"** stores two trees under one session (rooms and sides), prices each on its own, and the reveal shows both ranges per ⚑25. `interior_done` / `exterior_done` are derived from the trees, not stored flags (the `both` jsonb keys are a cache the evaluator may ignore).
19. **Compliance flags** from the brief and the job screen (hours after-hours, staged, working around residents, centre, induction, WWCC for schools, hazmat check) write `site_checklist_items`, never price lines, and appear in the estimator's confirmation screen (S5) above the tree.
20. **Sector band cross-check** (`commercial_rates`) runs inside `fix_price` for commercial estimates: outside the segment's band → the RPC refuses with the band shown; staff may override with a reason that is logged.

---

## 5. Build order — amended and replacement steps

### S1 — amendments (quick look)

    Add to S1: the "Rather not fill anything in?" card on screen 1 (Book someone
    in → Save & book sheet; Call us → tel: from Settings). The Save & book pill
    in the header of every screen except the map; the sheet per the prototype
    (email, mobile optional, four slots from scheduling, Save and book / Call me
    back). The save_and_book RPC per §4.17 — build it here, S1 owns it.
    "Both" → the choice screen (price them yourself, one after the other →
    place with job=both; book for both → Save & book sheet). After the interior
    reveal, the "Now price the outside" door appears; the reveal shows two
    ranges per ⚑25 once both exist.
    The exterior quick look asks property kind; commercial → the segment screen.
    E2E additions: screen 1 → Book someone in → slot → magic link → staff opens
    the session at the reveal screen; both → inside range → outside range →
    both shown.

**Accept (added):** Save & book from any screen resumes at that screen for staff · no path from Outside + Commercial can return to screen 1 · two ranges render for "both" without either tree repricing the other.

### S3 — amendment (room card)

    The room card shows the "shape of this space" block for area types open |
    hall | wh (glass or height mode from the segment config, ceiling, photo).
    Its inputs are the same fields as the quick-look open-space card — one
    state, two surfaces.

### S4 — amendment (site & access, finish)

    Commercial site & access swaps carpet for lift, loading dock, parking,
    induction, security, centre rules; keeps ceiling height, void/high walls,
    Finish line on commercial: no fix-online branch, the commercial note, send
    for confirmation as primary, book a visit as secondary.

### S6 — REPLACED: commercial segments (three sessions)

#### S6a — Segment screen, the office pattern, the reveal

    Build commercial_segments (migration + seed of the eight rows from the
    prototype configs). Segment screen: eight tiles with the RANGE ONLINE /
    WE COME TO YOU tag derived from route, the "not sure or in a hurry" card,
    the trade sign-in note. health asks aged care / clinic / hospital (⚑19).
    Build the two office-pattern screens rendered from config: the optional
    kind question (health: aged care / clinic / hospital → hospital routes to
    the brief); counts with steppers; the job screen's "what's changing
    colour?" tiles (v2.3) in place of a same/new/dark picker; the open-space card with size bracket,
    ceiling, wall height in height mode (halls), photo (remediated upload) and
    the no-photo widening — NO glass question; also-areas with "outside —
    priced on site" flags where configured; the which-part pills on the
    segment screen (inside / outside / both) with outside → exterior brief and
    both → com-book;
    then surfaces / colours / condition / hours / occupied with segment copy.
    Seed the tree from counts and typicals (⚑23) and also-areas. Engine:
    lib/pricing/commercial.ts open-space sizing per §4.12; loadings per §4.14.
    Reveal: segment kicker, commercial basis sentence, segment assume list,
    the commercial note, band widened per ⚑20, fix-online never.
    Tighten: area cards from the seeded tree (open areas carry the shape block).
    Golden tests: (1) a 150–400 m² open plan with tiles carries no ceiling line
    and its wall m² equals the full perimeter × height; (2) hours=after applies exactly
    loading_after_hours to labour hours and nothing to materials or allowances;
    (3) a school hall at "over 6 m" adds exactly one EWP pass-through line;
    (4) the residential golden tests are unchanged.
    E2E as an anonymous customer: office, 4 offices + 1 open plan (photo) + 1
    meeting → range → tighten two areas → send for confirmation → staff sees
    the compliance flags and the photo. Then health (aged care) and school.

**Accept:** every segment string on screen comes from `commercial_segments` · no commercial estimate can reach `fix_online` (test) · open-space photo presence changes the band by exactly the Settings value · `glass` appears nowhere in the diff · both → com-book with no reprice call · four golden tests green.

#### S6b — The warehouse pattern

    Build the warehouse quick-look screen per the prototype: area brackets to
    over 5,000 m² or typed L×W; height to the underside of the roof with the
    scissor-lift note; industrial surfaces with counted roller and personnel
    doors and counted offices, flagged items (underside of roof, steel, line
    marking) rendered as flagged unpriced lines; wall material multi-select;
    racking / operating / lift on site. Then the shared job screen with
    warehouse copy. Engine per §4.13. Tree: Warehouse floor + offices + mezz +
    amenities; no bedrooms or storeys fields exist on this path (assert).
    Golden tests: (1) racking=most prices walls at exactly racking_most of
    racking=no; (2) height 4–6 m with lift_on_site=false adds one EWP line,
    lift_on_site=true adds none; (3) roller doors = count × per-door-per-face
    rate, both faces only when the exterior element is ticked.
    E2E: 1,000–2,500 m², 4–6 m, precast, some racking, operating → range →
    tighten the warehouse floor → send.

**Accept:** no `beds` or `storeys` key is written for a warehouse session · flagged items appear on the estimate document as "priced on confirmation" · golden tests green.

#### S6c — The brief, the booking, and all commercial exteriors

    Build commercial_briefs and the brief screen rendered from a per-segment
    config (strata, shopfront, other, exterior — from the prototype's BRIEF
    object, stored as rows in commercial_segments.brief jsonb). Photos via the
    remediated path. The booking screen: three steps with ⚑27 copy, four real
    slots from scheduling, work email + name + mobile, Book it → save_and_book
    with brief_id, confirmation email with the brief attached, magic link,
    site_checklist_items from the brief. Route: kind=commercial on the exterior
    quick look → segment screen → brief (exterior config) regardless of
    segment; interior strata / shopfront / other / hospital → brief.
    No reprice call anywhere on the brief path (assert in a test that spies the
    E2E: strata interior → brief → book → staff sees the brief, photos, meeting
    date and the calendar event; shop front → same; exterior warehouse → same.

**Accept:** no number in the DOM on any brief-path screen (test) · booking creates account, property, confirmation request, calendar event and checklist items atomically · brief renders from config rows only.

### S9 — amendment

    Add to the full-loop stories: office → remote fix with the sector band
    cross-check passing; warehouse → estimator books a visit from the console;
    strata → brief → visit → (later phase) scope document stub. Add the four
    v1 regression stories from §6 to CI before the hot-fix merges.

---

## 6. v1 hot-fix — do this first, separate batch (⚑31)

    In app/wizard/WizardApp.tsx (v1, live for staff and signed-in customers):
    selecting Exterior on screen 1 and then Commercial, then Next, returns to
    screen 1 instead of the commercial hand-off. Read the code; the likely
    cause is the exterior branch not handling propertyKind=commercial and the
    hand-off path re-rendering page 1. Find the actual cause and report it with
    file:line before fixing. Fix so that Exterior + Commercial reaches the
    hand-off screen with the address, job type and property kind saved. Add a
    regression test as the anonymous customer for all four combinations
    (interior/exterior × residential/commercial). No other v1 changes. Unit
    count before and after.

**Accept:** all four combinations reach the correct next screen · no path returns the customer to page 1 without an error message · v1 e2e green.

---

## 7. Definition of done — additions

9. Every commercial segment reaches either a range or a booking in at most two quick-look screens, and the segment tile says which before the customer taps it.
10. No commercial estimate can be fixed online; every one carries a `confirmation_requests` row before it is accepted.
11. Save & book works from every screen, and staff opening the session land on the screen the customer left.
12. The brief path never calls the pricing engine and never renders a number.
13. Segment configuration lives in `commercial_segments`; adding a ninth segment requires a row and a seed, not a component.
14. No commercial exterior, and no inside-and-outside commercial job, ever shows a number — they reach a booking with the brief attached.

— End of addendum. Where this contradicts the main brief, this addendum wins for commercial, "both" and Save & book; the main brief wins elsewhere. Report contradictions either way.
