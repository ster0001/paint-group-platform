# Build brief + plan — The quote stage (v10): "Get my detailed price", mobile and desktop

**Project:** paint-group-platform (Next.js 16 / Supabase). Paint Home first; same code serves Paint Group.
**What this replaces:** the room-by-room `/estimate/scope` page (the "Tighten my price" / "Shape your estimate" screen) on **both** mobile and desktop. The 8 Oct "scope redesign" ruling is discharged by this brief.
**Reference prototype (wins over this text):** `wizard-quote-stage-v10-prototype.html` — purple bar switches job type (Whole interior · Doors & trims · Outside) and whether a floorplan was uploaded. Prices in it are placeholder maths; the engine is untouched.
**Approved:** Tom, 29–30 Oct 2026.
**Depends on:** mobile v5 build (sessions 1–7) merged; brand guard live.
**Date:** 30 Oct 2026

---

## 1. Rulings (binding)
- R0. **Rebuilt on top of what exists, and left clean.** This is a replacement of the scope page, not a second one beside it. Reuse the existing session/line model, picture components, storage and messaging adapters, event log and engine settings; extend them rather than forking. No parallel data shapes, no copied components, no second drawing. The old scope page stays only behind the flag for one release for resume, then is deleted with its specs, styles and dead helpers in session 7. Each session's PR lists what it reused, what it extended, and what it removed.
- R1. **The price never collapses to one number.** Every line keeps a floor of uncertainty (repairs are confirmed on the day), so the stage ends on a narrow range. Nothing on screen says "exact". The stage is called **"your detailed price"**; the gate button is **"Get my detailed price"** (supersedes "Get my exact price" in the v5 brief).
- R2. **Measurements are typed, not guessed.** Width, length and ceiling (rooms) / across and high (sides) as numbers. Typical figures sit greyed in the fields; typing over them marks the line measured. "Not sure — use the typical size for now" keeps the line open (wider range) and greys its bar.
- R3. **Every question on the current scope page is kept** (inventory in §3). Nothing is dropped; the order changes.
- R4. **The quote writes itself.** A formal live quote (header, number, date, validity, prepared-for details, one line per room/side/item with measurements and what's included, repairs line, subtotal, GST, total range) is the progress device. No points, badges, streaks or rewards (gamification ruling stands). The one "game" is the range visibly closing after every answer.
- R5. **The room / side drawing redraws with every answer.** Doors, windows (and size), robes, cornices, skirtings, architraves, wall share, prep marks, condition. Reuse the existing picture components; one drawing, not two.
- R6. **Floorplan, when uploaded, is one tap away** on mobile and sits in the right rail on desktop; rooms colour in as they're settled **only if the plan read returns room positions** (§6 D-Q1).
- R7. **Collapsible quote on both breakpoints** — one-line header with an arrow; mobile panel opens inline under the tiles (max ⅓ screen, question stays visible), desktop collapsed by default in the right rail.
- R8. Desktop is a different format, not the mobile page stretched: **room drawing left · one question centre · floorplan + price + quote right**, with keyboard flow. (Supersedes "desktop unchanged" in the v5 brief for this stage only.)
- R9. Copy rules from v5 hold: one heading, at most one grey line, English tone, no tolerance figures anywhere.

## 2. Layout
### Mobile (< 768px)
Header (back · logo · Contact) → 3px progress bar (continues from the gate's 55% to 100%) → **tiles row:** Quote (icon + "Quote · 6 to go · ~3 min" + ▾) · Room/Side thumbnail (name under) · Plan thumbnail (only if uploaded) → collapsible quote panel → **price band:** range in mono left, "closing in · 58% settled" right, 6px track whose filled segment shrinks inward and shifts teal → green as it settles → the card → bottom bar.
### Desktop (≥ 900px)
Three columns, 260 / 1fr / 420 (200 / 1fr / 360 between 900–1120): left rail sticky — current room/side drawing with name and "Updates as you answer"; centre — the card, bottom button, key hints; right rail sticky — floorplan (if uploaded), price band, collapsed quote header + document. Keyboard: 1–4 pick an option, Tab between fields, Enter = next, ← = back; first measurement field auto-focused.

## 3. Cards and the question inventory (taken from the live `/estimate/scope` on 29 Oct)
Single-choice cards advance ~300ms after the tap; others have a bottom button.

**A. A few things first** (whole house, one tap each; skipped for Outside; subset for Doors & trims)
1. Do you have cornices? Yes / No
2. How high are the ceilings? 2.4 m / 2.7 m / 3 m or more / Varies — sets every room's ceiling field; editable per room
3. The doors — mostly panelled, or flat? **with drawings**
4. The windows — which type, mostly? Casement / Sash / Colonial / Winder **with drawings and a one-line hint each**
5. Water-based or oil-based paint on the trims? Water / Oil / Not sure (undercoat note)
6. Will anyone be living there while we paint? No / Yes
7. Will the rooms be cleared before we start? Yes / Mostly / Furniture stays
8. A stairwell or void with high walls? No / Yes
(Doors & trims adds: Same white, or a new colour?)

**B. Per room (four cards)**
1. **How big is {room}?** — Width · Length · Ceiling fields (typical greyed) · "No tape? Walk it out — one large step is about a metre." · optional **Add a photo of the room** · button **That's the size** · link *Not sure — use the typical size for now*.
2. **What we're painting in here** — Walls (All/75/50/25) · Ceiling · Cornices · Skirting boards · Architraves · Doors (count, door / + frame) · Windows (count, S/M/L with the size key) · + Add a surface. Button Next.
3. **Any built-in robes or cupboards being painted?** No / Yes → Paint the robe doors? · Paint the walls inside? (shelves-out note).
4. **Anything needing attention?** Crack · Hole or dent · Flaking · Water mark · Mould · Wallpaper · Feature wall · Something else → How much (a couple of spots / patches / most of it) → **Take a photo of the spot** (with a photo we price it; without, a person does). Button "Nothing to fix — next" / "Add it".

**C. Per side (Outside)** — How big is the {side}? (across · high, photo) → On this side (windows, doors counts; paint condition good / weathered / peeling) → Anything needing attention (prep set minus feature wall / wallpaper, photo).

**D. Doors & trims** — one card per line with a counter (doors, window frames, rooms of skirting).

**E. Last checks** — Have we got every room? (list + Add a room; hallway nudge) → Anything we haven't listed? (air vent, mantle, ceiling rose, help me choose colours, free text — "a person prices it").

**F. Done** — "{Name}, your detailed price" · range · small print (which rooms are typical, repairs allowed for and confirmed on the day, Sarah confirms, includes GST) · the quote in full · tiles (Your range ✓ · Your detailed price ✓ · Sarah confirms) · Sarah line · **Book Sarah to confirm it**. Typical/unmeasured lines are tappable → jump back to that room's measure card, then return.

## 4. The drawing (R5) — behaviour spec
- Rooms: back wall + two side walls in perspective, floor. Layers: ceiling, walls (wall share < 100% greys the remainder), cornices, skirtings, architraves, doors, windows (+ glass), robe (right wall) with doors and inside, prep marks (crack / hole / flaking / water mark / mould / wallpaper), feature wall tint. **Unticked trims are not drawn; walls/ceiling grey when not painting.**
- **Layout rule for openings:** windows first, then doors, spread evenly along the back wall; when full, extra doors go to the right wall, extra windows to the left wall (perspective skew), never overlapping. Window size S/M/L resizes.
- Every change re-renders; the added/changed surface sweeps in (roller clip, ~520ms, reduced-motion snaps). Animate every rendered copy independently (thumbnail, sheet, desktop rail).
- Sides (Outside): the exterior v2 `Elevation` for that side, with windows/doors counts and condition marks.
- Build on the existing room/house SVG components from the wizard refresh and exterior v2; the prototype's drawings are the behaviour reference, not new components.

## 5. The quote document (R4)
Fields: brand mark · "Draft quote" → "Quote" when every line is settled · quote number · date · "Valid 30 days · Includes GST" · prepared for (name, address, mobile, email from the session) · lines: name, `w × d × h m` (+ "(typical)"), included surfaces and counts, robe, repairs; amount or "—" · extras lines · "Repairs allowed for — confirmed on the day" · Subtotal range · GST range · **Your range / Your price** range. Current line highlighted. Mobile thumbnail = mini document with one bar per line (grey → teal sweep on settle; typical lines mid-grey).
Range maths (engine-side, not UI): per-line uncertainty todo 22% · typical 12% · measured 4% (+4% if repairs without photo); unanswered general questions add their effect spread; floor never reaches 0. Numbers tween over ~1.4s; track colour interpolates teal → green by settled share. ⚑ D-Q3 for the actual bands.

## 6. Decisions (⚑)
| ⚑ | Question | Default |
|---|---|---|
| **D-Q1** | Does the floorplan read (`lib/extract`) return per-room coordinates on the image? If yes: tinted overlays colour in as rooms settle, current room outlined, tap-to-jump. If no: plan image + ticked room list beside it. **Claude Code answers this in session 0.** | Overlay if coordinates exist |
| D-Q2 | Gate button copy: "Get my detailed price" | Yes |
| D-Q3 | Uncertainty bands per line state (the 22/12/4% placeholders) and the never-closes floor | Engine team sets from `BandSettings`; UI reads them |
| D-Q4 | Robes card on every room, or bedrooms + hall only | Every room (one tap to say No) |
| D-Q5 | Room photo and prep photo storage/limits (count, size) | 3 per room, 5 MB each, via the existing storage adapter |
| D-Q6 | Desktop quote collapsed by default | Collapsed |

## 7. Analytics (`crm_events`, one log)
`quote_stage_viewed {job_kind, lines, breakpoint}` · `quote_card_answered {card, line, measured:boolean}` · `quote_line_settled {line, state:'measured'|'typical'}` · `quote_photo_added {line, kind:'room'|'prep'}` · `quote_stage_done {settled_share, typical_count, range_lo, range_hi}` · `quote_book_clicked`. Dashboard "Where estimates go" adds gate → stage started → stage done → booked.

## 8. Acceptance
- [ ] Mobile 390px and desktop 1366px: every card in §3 renders in order for all three job types; no question from the 29 Oct inventory is missing (checklist in the PR).
- [ ] Measure card: typical values greyed, typing marks measured, Enter/That's the size advances, "Not sure" leaves the line typical and greys its bar; Done screen lists typical rooms and tapping one returns to its measure card.
- [ ] Drawing: adding a door/window appears immediately with a sweep; 3 windows + 3 doors never overlap (spill to side walls); S/M/L resizes; unticking cornices/skirtings/architraves removes them; robe + doors + inside render; each prep type shows its mark; feature wall tints. Same behaviour in thumbnail, sheet and desktop rail.
- [ ] Price band: range tweens ~1.4s after every answer; track shrinks inward and shifts colour; never shows a single number; "settled" % correct.
- [ ] Quote: header fields from the session; lines fill with amount + description on settle; subtotal/GST/total ranges; "Draft quote" → "Quote" when settled; mobile panel ≤ ⅓ screen and the card remains visible; desktop header collapsed by default, arrow toggles.
- [ ] Floorplan: tile shows only when uploaded; overlay colours per D-Q1 or list fallback; tap-to-jump works.
- [ ] Keyboard flow on desktop per §2; first field focused.
- [ ] Paint Home chrome throughout; no "±" or "exact" strings; Contact works from every card.
- [ ] `lib/pricing/**` unchanged; golden tests pass; exterior v2 specs pass; events fire (API-level test).
- [ ] Clean build (R0): no new component duplicates an existing room/house drawing or quote view; the old scope page's components, styles, tests and dead helpers are removed once the flag is retired; PRs list reused / extended / removed.

## 9. Sessions — three, because almost everything exists already
What exists and is reused as-is: every question (the current scope page), the pricing engine and its range bands, the room/house picture components, photo + floorplan upload and the plan read, Contact, brand chrome, the event log and the session/line model. What is new: the card router, the quote document + price band, three behaviours on the drawing, the desktop three-column layout. Each session's PR lists reused / extended / removed (R0).

| # | Ships | Check |
|---|---|---|
| 0 | Half a day: map the scope-page sections to the §3 cards, the picture components, the plan-read output (**D-Q1 answered**), storage adapter. Stop and report. | — |
| 1 | **Cards.** Route `/estimate/quote` behind `quoteStageV10`; card router on the v5 wizard shell; the existing scope-page sections re-mounted as cards in the §3 order (general → per room ×4 → sides → last checks → done); typed measurements with typical fallback; door/window drawings on the two general cards; Contact; events. No new data shapes. | Interior on his phone end to end; a skipped room settled from the end |
| 2 | **Quote, price, floorplan.** Quote document component (mobile inline panel, desktop collapsed rail) and the mini-document thumbnail; price band reading the engine's bands (D-Q3) with the tween and colour shift; floorplan tile/rail from the existing upload + read — overlay or list per D-Q1. | Watch the quote write itself, the range close, the plan colour in |
| 3 | **Drawing, desktop, clean-up.** The three behaviours added to the existing picture component (opening layout rule, sweep on change, unticked trims removed) + prep marks; side drawing from `Elevation`; desktop three columns + keyboard; old scope page removed with its specs/styles/helpers (grep evidence); help files; screenshots both breakpoints × three job types; independent check against §8; ledger; flag on is Tom's switch. | Add 3 doors + 3 windows, untick cornices, add a robe and a crack on the phone; laptop run without the mouse |

## 10. Out of scope
Pricing engine changes; the wizard before the gate (v5 brief); exterior question design (exterior v2 brief); visit-booking changes beyond the existing Contact sheet.
