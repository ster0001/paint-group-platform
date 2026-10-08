# Build brief: estimator wizard UI refresh (customer-facing)

**Status:** Ready to build. Tom accepted the mockup in conversation (7–9 Oct 2026); his phone check of all six job types is the gate at the end of Session 0. No ⚑ blocks the build: every open decision has a safe default in `wizard-ui-refresh-decisions.md`, and anything that would state a business fact ships switched off until he rules.
**Date:** 7 Oct 2026, revised 8 Oct 2026 (v4: every job type, screen-by-screen coverage check, test hooks, stacked "both" editor) · **Target:** live before public launch (2–3 weeks)
**Mockup (single source of truth for look and layout):** `design/reference/estimator-wizard-redesign-mockup.html`
**Baseline:** the wizard as rebuilt from `design/reference/estimator-journey-v2.html` and since extended (rooms step, details gate, sides step). Checked against `main` at `748526a`, 8 Oct 2026.
**Type of change:** presentation layer only. No question, price, state, route or API changes.
**Covers:** every path through the wizard: home inside, home outside, home both, commercial ranged online (office, retail and hospitality, healthcare and aged care, school, warehouse) and commercial visit-only (strata, shop front, something else, hospital, every commercial outside).

---

## 1. What this is, in plain English

The wizard works, but on a desktop it looks like a phone screen stretched onto a big monitor, and it reads as a form rather than something a customer wants to finish. This brief restyles the whole customer journey (six quick steps → range → room by room → finalise) so that:

1. **Desktop gets a proper two-column layout.** Questions on the left, a live picture of the job on the right.
2. **The picture responds to every answer.** The house changes with property type and storeys; the room paints itself as surfaces are ticked; the floor plan fills in as rooms are checked.
3. **The range visibly narrows.** A band shows where the guide range started and where it is now, with the three things that close the gap.
4. **Everything has one place.** Progress, phone number and save in a slim header; Tom and the "talk it through" options in one card; one primary button per screen.
5. **It is easy at any age.** 17px text, 48px+ tap targets, plain labels, pictures for trade words, phone number always visible.

6. **Every job type gets the same treatment.** Tom, 8 Oct: the redesign applies to all the steps for each job type, commercial included. The mockup has a "Job type" row at the top that switches between six representative paths; §7.7 to §7.11 specify them.

Nothing here adds points, badges, streaks or rewards. Motion only answers something the customer just did (see §6).

## 2. What was wrong (observed on the live build, 7 Oct)

| # | Where | Problem |
|---|---|---|
| 1 | All quick-look steps | `.wz-wrap` is capped at 640px and centred, so a 1440px screen shows a phone column with a full-width Continue bar underneath. |
| 2 | Quick-look steps | Hints are set in capitals and run straight on from the question ("Have a floorplan or the listing? OPTIONAL — WE READ THE ROOMS OFF IT"). Tick marks sit on top of the label text. |
| 3 | Quick-look steps | "Would you rather talk it through?" is a large dashed box on every step and competes with Continue. "Step 1 of 6" floats mid-page. Progress is five small dots beside the logo. |
| 4 | Room editor (`/estimate/scope`) | The frozen header is about 295px of a 784px viewport (38%). |
| 5 | Room editor | With no floorplan, room cards fill the left half and the right half is empty. The "A few details to settle" card is 1,200px wide while room cards are 700px. |
| 6 | Room editor | Every card has an orange border, which reads as an error rather than "still to check". Surface tiles are large, mostly empty, and in alphabetical order (Architraves first) rather than the order a person thinks about a room. |
| 7 | Room editor | "Do you have cornices?" is asked while every room already shows Cornices ticked. |
| 8 | Room editor | "Imported → Custom surface (imported) · $105" appears under "Anything we haven't listed". Looks like import or test data reaching a customer screen. **Treat as a bug; investigate separately.** |
| 9 | Range screen | The three accuracy labels look like tabs you can click. Trust signals and "what we've assumed" are a long scroll below the price. |

## 3. Reference files (read in this order before writing code)

**This pack (commit together, Session 0):**
- `docs/briefs/wizard-ui-refresh-runsheet.md` — how each session runs, and the block for each session. **Start here.**
- `docs/briefs/wizard-ui-refresh-progress.md` — the ledger. Read first, update last.
- `docs/briefs/wizard-ui-refresh-decisions.md` — Tom's rulings on the ⚑ items, and the default for each.
- `docs/briefs/wizard-ui-refresh-components.md` — tokens, components, pictures, and where each old piece moved.
- `docs/briefs/wizard-ui-refresh-test-hooks.md` — every class and test id the existing e2e specs rely on.
- `design/reference/estimator-wizard-redesign-mockup.html` — the mockup.

**Rulings and plans (binding):**
- `docs/briefs/rebuild-addendum-confirm-loop.md` — amber → cyan confirm loop, required size question, tiles, sweep.
- `docs/briefs/wizard-rebuild-plan-v2.md` — view contract, thresholds, e2e-first.
- `docs/briefs/claude-code-brief-visit-booking-addendum-a.md` — the four range doors, talk-it-through on every step before the range, gate order.
- `docs/briefs/estimator-v2-progress.md` and `estimator-v2-runsheet.md` — update at the end of every session.
- `lib/wizard/ladder.ts` — Ruling G: Guide / Detailed / Confirmed are accuracy labels, never rewards.
- `CLAUDE.md` — one pricing module, `mode` prop not forks, Lighthouse ≥ 90 on public estimate pages.

**Code this brief touches:**
- `app/wizard/wizard.css` — the whole theme lives on `.wz` (light, per Tom 5 Oct). Layout rules: `.wz-wrap`, `.wz-nav`, `.wz-rather`, `.wz-dots`, `.sc-freeze`, `.sc-wrap`, `.wz-ed.noplan`.
- `app/wizard/QuickLook.tsx` + `lib/wizard/quick-look.ts` — the six steps and their choices.
- `app/wizard/Reveal.tsx`, `WhatWeDo.tsx`, `EstimatorStrip.tsx`, `TalkSheet.tsx`, `ChatWidget.tsx`, `SaveAndBookSheet.tsx`, `PlanViewer.tsx`, `AddressField.tsx`.
- `app/estimate/scope/ScopeEditor.tsx` (interior), `SidesEditor.tsx` (exterior), `PlanPanel.tsx`, `RoomExtras.tsx`, `JobExtras.tsx`, `ReachStrip.tsx`, `ContactCard.tsx`, `AllDoneBanner.tsx`, `scrollCard.ts`.
- `app/estimate/finish/Finish.tsx`, `app/estimate/visit/VisitBooking.tsx`.
- `app/wizard/CommercialScreens.tsx` — `SegmentScreen`, `AreasScreen`, `WarehouseScreen`, `JobScreen`, `BriefScreen`, `BookScreen` and the booked screen. All in scope.
- `app/wizard/ExteriorTiles.tsx`, `app/estimate/scope/StyleTiles.tsx` — the existing tile and window drawings; restyle, keep the window-type drawings.
- `lib/wizard/quick-look.ts` → `stepsFor()` — **the step order for every path. The mockup mirrors it; if they differ, the code wins.**
- `lib/wizard/exterior-quick-look.ts`, `lib/wizard/segments.ts`, `lib/wizard/warehouse.ts`, `lib/wizard/commercial.ts`, `lib/wizard/systems-view.ts` — the option lists, per-segment wording, routing and "What we'll do" lines the screens render. Read-only for this brief.

**Existing mockups this one supersedes for look and layout only (their behaviour rulings still stand):**
`design/reference/floorplan-wizard-mockup.html`, `customer-review-confirm-mockup.html`, `customer-review-confirm-exterior-v2-sides.html`.

**Stop-and-report:** if any file above is missing or materially different from this description, stop and report before writing code.

## 4. Rulings this brief keeps (do not re-open)

- Light theme on every customer surface (5 Oct). No dark panels except the single estimator strip on the range screen and the mobile range strip.
- No gamification; no reward tiers (Ruling G). Benefits are stated as facts.
- A price is never fixed by the wizard alone. A person confirms it, on a call or a visit.
- Residential customers see no number before the details gate. Gate order stays switchable by hand.
- Range doors: Tighten my price · Speak with us (only inside the phone-finalise range) · Book a site visit · Send us a message.
- "Talk it through" (request a visit, call, message) stays on every step before the range.
- Confirm loop: amber = still to check, cyan = checked; required L × W size question (never m²); counted doors and windows with S/M/L inside the window tile; "+ Add a surface"; doors-and-windows count check; nothing customer-stated is ever silently $0.
- Progress and the range stay readable at any scroll position (R5, 20 Aug). This brief keeps that, in less space.
- Phone number never hides. English (not Australian) tone. Money in AUD including GST.
- Named estimator present throughout. Use whatever `EstimatorStrip` resolves (currently Tom Roman).

## 5. Design system for this surface

Tokens stay on `.wz` in `wizard.css`. Changes and additions only:

| Token | Value | Use |
|---|---|---|
| `--paint` (new) | `#3BD8E9` | Primary button fill, progress stripe, range band. Same cyan as the homepage "See my price" button. |
| `--oncyan` on `--paint` | `#03272D` | Text on primary buttons. |
| `--cyan` (keep, darken) | `#0A7C8E` | Links, selected borders, ticks, icons on white. AA on white. |
| `--wash` (new) | `#DFF6FA` | Selected card and chip fill. |
| `--amber` | `#9A5F0A` on `#FCF3E0`, line `#E5C078` | "Still to check" only. Never as a full card border on every card. |
| `--ink` page | `#F2F5F6` | Page. Cards `#FFFFFF`, lines `#D5DDE2`. |

- **Type:** Switzer for everything; Martian Mono for money, sizes and counts only. Body 17px, hints 15–15.5px, never below 13.5px. H1 `clamp(30px, 3.5vw, 46px)`, weight 600, tracking −0.035em.
- **No capitals for hints or labels.** Hints are a sentence under the question. "Optional" is a small grey tag after the question.
- **Buttons:** one primary per screen (cyan pill, 58px). Secondary is white with a grey outline. Inputs are 16px or larger (stops iOS zooming).
- **Radius:** 16px cards and fields, 22–26px for the picture and price cards, pills for buttons and chips.

## 6. Motion (all of it answers a customer action)

| Trigger | Motion | Duration |
|---|---|---|
| Pick an option card | Wash fills the card left to right; tick pops in | 420ms |
| Tick or untick a surface (step 3) | That surface in the room picture changes colour; a roller sweeps once when walls go on | 700ms / 950ms |
| Change storeys | Roof lifts and the upper floor slides in | 600ms |
| Step change | Content rises 14px and fades in, staggered | 450ms |
| Range reveal | Numbers count up once; the three ladder bars grow to width | 1.1s |
| Confirm a room / answer a question | Range band narrows; plan room fills cyan; toast "Range narrowed by $X" | 700ms |
| Tick an outside element or warehouse surface | That element takes its fresh coat in the picture; a ticked "other area" (fence, deck, shed) pops in beside the house | 700ms / 450ms |
| Confirm a side | Its edge on the view from above turns from amber to cyan | 400ms |
| Incomplete confirm | Size box shakes and names the gap (existing behaviour) | 400ms |

`prefers-reduced-motion: reduce` turns all of it off. No looping animation anywhere. No confetti.

## 7. Screen-by-screen spec

Breakpoints: two columns at ≥ 901px; one column at ≤ 900px. Content max-width 1,240px.

### 7.1 Shell (all screens)
- **Header, 64px desktop / 56px phone, sticky:** logo · step rail · phone number · chat icon · Save & book. A 3px cyan stripe along the bottom edge shows progress.
- **Step rail:** numbered, labelled (Address, Place, Job, Rooms, Condition, Details | Your range). Done steps show a tick. Below 1,380px only the current label shows. After the gate the rail becomes Guide range → Room by room → Fixed by Tom.
- **Phone:** rail is replaced by "Step 2 of 6 · The place" and a progress bar under the header. Phone number becomes a round call button (still one tap).
- **Chat:** the floating bubble moves into the header as an icon button (⚑ 10). It must never cover content or the action bar.
- Remove `.wz-dots`, the floating "Step x of y" line and the dashed `.wz-rather` box.

### 7.2 Six quick steps (`QuickLook.tsx`)
- Left column (max 640px): kicker, H1, sub-line, questions, then Back + Continue **inside the column** on desktop. On phones Back + Continue are a fixed bottom bar.
- Right column (430px, sticky): **picture card**, **Your job so far** card, **Talk it through** card.
- Continue is never silently disabled: tapping it with something missing shakes it and shows the reason in one line above it.

| Step | Left | Picture on the right |
|---|---|---|
| 1 Address | Address field with pin; Inside / Outside / Both as three picture cards | House. Inside lights the windows, Outside paints the walls, Both does both. |
| 2 The place | Property type as a 2 × 2 grid of picture cards; bedrooms as a 1–5+ segmented control; storeys as two picture cards; floorplan upload and listing link side by side | House changes with type and storeys. |
| 3 The job | Scope as a 2 × 2 grid; surfaces as tick chips in the order Walls, Ceilings, Skirting boards, Architraves, Doors, Window frames; colour-change chips; two Yes/No controls | Room. Each ticked surface paints in; unticking returns it to "today". Last surface touched is outlined and named in one line ("Architraves: the timber frame around each door"). |
| 4 Rooms | Rooms as tick chips; "Missed one?" room picker | Floor plan. Rooms left out are dashed. |
| 5 Condition | Three picture cards; optional photos when "Needs work"; living-there question | Room "today": marks and cracks step up with the answer. |
| 6 Your details | Name, email, mobile, optional news tick; button reads "Show my guide range" | Finished room; note says the range appears once details are added. |

The table above is the home-inside path. The other paths use the same shell, components and rules; their screens are in §7.7 to §7.11.

- **Your job so far:** one row per answered step with a Change link back to that step. Shows "3 steps to your range".
- **Talk it through:** estimator avatar and name, then three equal buttons: Request a visit, Call us, Send a message (same handlers as today: `ql-book`, `ql-call`, `ql-message`).
- **Phone:** picture card sits above the question at 168px high; Job so far is hidden; Talk it through sits at the foot of each step.

### 7.3 Working screen
Three lines tick on in turn over a filling bar, then the range. Keep the existing real wait behaviour; this is the look only.

### 7.4 Range reveal (`Reveal.tsx`)
- **Row 1, two columns.** Left: range card with a cyan edge: "Alex, here's your guide range", the accuracy pill, the range in Martian Mono (count-up once), GST line, the "Based on…" sentence, then a three-row ladder (Guide / Detailed / Confirmed) drawn as bars of decreasing width. The ladder is an explanation, not a control. Right: the doors, with **Tighten my price** as the one cyan card and the others white.
- **Row 2:** dark estimator strip: who confirms the price, and the phone number as a button.
- **Row 3, three cards:** What we've assumed (open items in amber, "answering these narrows your range") · A job like yours (⚑ 2) · Why people choose us (⚑ 5).
- **Row 4:** What we'll do, two columns, content unchanged from `WhatWeDo.tsx`.
- **Phone:** everything stacks in that order; a fixed bottom bar carries "Tighten my price".

### 7.5 Room by room (`ScopeEditor.tsx`)
- **Desktop:** left column of cards (one width for every card); right sticky rail 410px.
- **Right rail, top to bottom:** price card (range, accuracy pill, range band with a dashed outline of the starting guide range, three-row checklist: Five quick questions 1/5 · Rooms checked 1/8 · Doors and windows count 0/1, then **Finalise my price** and **Book a time with Tom**) → Your home (floor plan: amber = still to check, cyan = checked, tap a room to open it) → estimator card (Book a time, Call Tom, Message).
- The frozen header shrinks to the 64px shell header. The estimator strip, score bar, legend line and range card leave the header and live in the rail. There is no full-width bottom bar on desktop.
- **Left column order:** title → About the whole home (one question at a time, with a picture, "Closes about $X of your range", Skip for now) → Room by room → Last checks → Anything we haven't listed.
- **Room card (accordion, one open at a time):** closed = number or tick, name, size, "Check this room". Only the open card carries the amber border; checked cards get a pale cyan border and a one-line summary ("walls, ceiling, skirting, 1 door, 1 window").
- **Open card, three numbered blocks:**
  1. *The size of this room.* Small to-scale rectangle, "Is about 3.5 m long × 3.25 m wide right?", Looks right / Adjust it. Adjust shows two steppers (Long, Wide, 0.25 m steps, existing 1–15 m clamps).
  2. *What we're painting in here.* Tiles in the order Walls, Ceilings, Cornices, Doors, Windows, Skirting boards, Architraves, Balustrades, + Add a surface. Each tile has a pictogram and a tick box. Counted tiles (Doors, Windows) and Walls widen to two columns when on and show their controls; plain tiles stay compact.
  3. *Built-in robe* (bedrooms) and any other room-type questions as Yes/No rows.
  Then **Confirm {room}** and "Then on to {next room}". Confirm collapses the card, opens the next unchecked room and scrolls it into view.
- **Phone:** a dark one-line strip sticks under the header (range, accuracy, "1 of 8 rooms", mini band): about 64px, down from about 120px. Floor plan sits at the top at 150px. Tiles are two columns; counted tiles go full width. Fixed bottom bar: Book a time · Finalise my price.
- **Fix:** the cornices whole-home question must set the per-room Cornices tiles (No → all off), not sit beside them contradicting it.

### 7.6 Finalise (`Finish.tsx`) and visit
- Two columns. Left: range card, then "What you've told us" room list. Right: "Make it a fixed price" (estimator, next available visit times for the customer's zone, primary button, "Request a call instead"), then "What happens next" as the same four steps the homepage uses.
- Visit times come from the existing visit-booking logic. This brief does not change slot rules.


### 7.7 Step order and step rail, every path

Take the order from `stepsFor()`; never hard-code it in the UI. Rail labels in brackets.

| Path | Steps |
|---|---|
| Home, inside | Address → Place → Job → Rooms → Condition → Details |
| Home, outside | Address → Place → Outside → Sides → Details |
| Home, both | Address → *(choice screen)* → Place → Job → Rooms → Condition → Outside → Sides → Details |
| Commercial, ranged online | Address → Place → Space → Areas *(or Building, for a warehouse)* → Job → Details |
| Commercial, visit only | Address → Place → Space → Questions → Book *(hospital: Areas comes before Questions)* |

- With more than six counted steps (the "both" path has eight) the rail shows numbered dots and only the current label.
- The choice screen on the "both" path is not a counted step and has no Continue: its two doors are the answer.
- On visit-only paths the rail ends in "Booked", not "Your range", and the phone progress line reads "2 steps to your visit".

### 7.8 Home, outside

- **Place:** property type only. No bedrooms, storeys or floorplan (storeys is asked once, on the Outside screen).
- **Outside (one screen, existing order):** "On the house" as six picture cards in two columns, nothing pre-ticked → other areas as tick chips → pergola size in a follow-up box under the chips when Pergola is ticked → wall materials (only if the body is ticked) → window type as four picture cards using the existing window drawings, with Aluminium and Not sure as chips, then a windows count row → doors count row → Colours (three cards) → Single or double storey (two picture cards) → access chips, with the scaffold note under them when "Needs a lift or scaffold" is ticked.
- **Count rows:** one bordered row: label and hint on the left, a 40px stepper on the right. Used for windows, doors and all commercial counts.
- **Follow-up box:** white, cyan left edge. Used wherever an answer opens a sub-question (pergola, open-plan area, visit-only note).
- **Picture:** the house, drawn element by element. Each ticked element takes its fresh coat (body, window frames, doors, fascias, gutters and downpipes, eaves); each ticked "other area" appears beside the house (fences, deck, pergola, shed, wall, garage door). The wall material changes the wall texture; the storeys answer adds the upper floor; the colour answer changes the wall tone. Last item touched is outlined and named in one line.
- **Sides:** "The full exterior" card, then four side cards with the existing mini outlines. **Picture:** the house from above, street at the bottom; thick cyan edge = painting, grey dashed = left off.
- **Range screen:** same layout. The ladder shows Guide and Detailed as bars, then one plain sentence: "Then a visit. Every outside price is confirmed on site by your estimator before it's fixed." **No "Confirmed" bar** (`ladder.ts`: an exterior job is never told about Confirmed). "Speak with us" is not offered. "What we'll do" renders the exterior lines from `exteriorWhatWeDo()`, including "Not included".
- **Side by side (`SidesEditor.tsx`):** same two-column editor as §7.5. Title "Walk around the house, one side at a time".
  - Left column: A few questions first (paintwork, timber rot, access; one at a time) → side cards → Last checks (door and window count, anything missed) → Freestanding extras.
  - Side card blocks: (1) Are we painting this side? Yes / No, leave it off. (2) Size: "Is about 12 m long × 2.6 m high right?" with Looks right, Adjust it and Not sure, and the pacing hint. (3) The walls on this side: one tile per material with 25 / 50 / 75 / 100% chips and a line that reads "Adds up to 100%" in green or names the shortfall in amber. (4) Also on this side: Windows (count and S/M/L), Doors (count), Fascias, Gutters and downpipes, Eaves, + Add a surface. Then "Confirm the front".
  - A side answered "No" collapses with a dashed border and "Not painting".
  - Right rail: price card (checklist rows: Questions about the outside, Sides checked, Last checks) → "Your home from above" (amber = still to check, cyan = checked, grey dashed = not painting; tap a side to open it) → estimator card.
- **Finalise:** visit times only. The secondary button is "None of these suit? Request a time", with one line explaining there is no phone sign-off for outside jobs.

### 7.9 Home, both

- **Choice screen:** two door cards (Price them yourself, one after the other · Book an estimator for both), then the "either way your answers are saved" line.
- **Range screen:** the combined range, with two tiles under it: Inside and Outside, each with its own range.
- **Checking: stacked, on one page** (Tom's Batch 4 ruling; `both-stacked.spec.ts`). Inside first (questions, room cards, last checks, extras), then a heading "Now the outside, one side at a time" and the outside (questions, side cards, last checks, freestanding extras). Both structures are always in the DOM. One card is open at a time across the whole page; finishing the last room opens the front. The two chips at the top ("Inside 0/8 rooms", "Outside 0/4 sides") are jump links, not tabs: they scroll, they never hide a section. One combined count, one pair of buttons. The price card shows the combined range, both part ranges and five checklist rows. The "Your home" card shows the floor plan with the view from above under it.
- **Finalise:** as outside (visit only), with both part ranges.

### 7.10 Commercial, ranged online

Every word on these screens comes from the segment row (`segments.ts` / the `segments` table). Do not hard-code segment wording in the UI.

- **Space (`SegmentScreen`):** eight cards in two columns, each with a small tag ("Online, or we visit" / "We visit"), the name and the hint. "Which part?" as a three-way control. When the choice can't be priced online, a follow-up box says so straight away. The trade sign-in line stays, as a quiet note.
- **Areas (`AreasScreen`):** kind question if the segment has one → count rows → open-space follow-up box (size, height where the segment asks it, ceiling, photo) → "Also being painted?" chips, with the "outside, priced on site" flag kept on the chips that carry it. **Picture:** a plan with one block per kind of area ("Private office × 5").
- **Building (`WarehouseScreen`):** floor-area control with the two typed fields under it → height control with the scissor-lift note → surfaces as cards in two columns (counted ones show a stepper when ticked) → wall materials → the three access rows. **Picture:** a warehouse interior; each ticked surface takes its fresh coat, and the height label follows the answer.
- **Job (`JobScreen`):** surfaces as chips → what's changing colour → the two Yes/No controls → condition as three picture cards using the segment's own wear and work wording → "When can we work?" → the segment's occupancy question. **Picture:** the room for area segments, the warehouse for the warehouse.
- **Range screen:** label reads "Office · your guide range". The amber commercial note sits under the range. Ladder as outside (two bars and the visit sentence). The trust card swaps the warranty line for "Certificates and SWMS with every quote".
- **Area by area:** the room editor with the segment's areas; no robe block; headings read "About the whole space" and "Area by area"; the rail label is "Area by area".
- **Finalise:** headed "Book your commercial estimator"; visit times only.

### 7.11 Commercial, visit only (strata, shop front, something else, hospital, any commercial outside)

- **Questions (`BriefScreen`):** "What needs painting?" chips → one control per question row → the date field appears only when the answer that needs it is chosen → photos (tagged "Optional, but they help a lot", with the segment's own photo hint) → free-text box.
- **Book (`BookScreen`):** the three "how it goes" points as a numbered list → time slots → contact fields → "Something urgent? Call". Button reads "Book it".
- **Booked:** large tick, "You're booked in" (or "Your brief is with us" when no time was picked), the address and time, a four-step "What happens next" card, and "Nothing is fixed until you say so, and nothing is owed."
- **Picture on all three:** the building. Job so far lists the brief answers.

### 7.12 Supporting screens and pieces (so nothing is left in the old look)

These are on the customer's path today but are not full screens of their own. Each is built from components already specified above; none needs new behaviour.

| Piece | Where it lives | What it becomes |
|---|---|---|
| Floorplan upload and reading | `QuickLook.tsx` (Place, Rooms), `PlanViewer.tsx` | Upload stays a drop box on Place. On Rooms, "Reading your floorplan…" shows in the picture card on the right (three ticking lines, as §7.3) while the room chips load on the left; "Don't wait" stays. Once read, the picture card shows the real plan with the zoom controls. |
| Plan and photos panel | `PlanPanel.tsx` (both editors) | Lives in the right rail as the "Your home" card. With a floorplan it shows the real plan (tap to open full screen); without one it shows the drawn plan. Photos sit under it as a thumbnail row. |
| Extras in a room | `RoomExtras.tsx` | A fourth block in the room card, closed by default behind one Yes/No ("Any feature walls, wallpaper removal or something we should know?"). Yes opens tick chips and the free-text line. |
| Extra prep in a room | `RoomSpots.tsx` | A quiet "+ Anything needing extra prep in here?" button under the tiles; opens a follow-up box with the photo drop, "What is it?" and "How much of it is there?". |
| Notes and photos on a side | `SideNote.tsx`, `PeelingPhotos.tsx` | Same pattern as extra prep: a quiet button under the tiles opening a follow-up box. |
| Site and access | `SiteAccess.tsx` (in `ScopeEditor`) | Its own card after the room list and before Last checks. Four rows, each a question on the left and a segmented answer on the right (same row style as the warehouse access rows). |
| Inline offers | `Offer.tsx` | A follow-up box with one sentence and two pill buttons. |
| All-done banner and finalise prompt | `AllDoneBanner.tsx`, `FinalisePrompt.tsx` | Banner: pale cyan strip at the top of the left column with the primary button. Prompt: a sheet (below). |
| Sheets | `TalkSheet.tsx`, `SaveAndBookSheet.tsx`, `ContactCard.tsx`, `ReachStrip.tsx` | One sheet pattern for all four: a 480px panel sliding in from the right on desktop, a bottom sheet on phones; title, one line, fields, one primary button, close in the corner. Never a full-page takeover. |
| Chat | `ChatWidget.tsx` (steps and range), `AssistantWidget` (on `/estimate/scope`) | Both open from the header icon as the same sheet pattern (right panel / bottom sheet). "Describe it" stays inside the wizard's chat. |
| "From what you told us" tags | `QuickLook.tsx` (`wz-assumed-tag`) | An amber tag under the field, sentence case. |
| Guardrail outcome | `CustomerResult.tsx`, `HardStop.tsx` | One centred card, 720px: what happened in a sentence, the estimator, "What we'll do", then "Ask us to call" and "Try the quick questions instead". |
| Sent to your estimator | `app/estimate/sent/Sent.tsx` | Same layout as the Booked screen in §7.11: tick, headline, one line, "What happens next" card, call line. |
| Book a time | `app/estimate/book/Book.tsx` | The right-hand card of the Finalise screen (§7.6) on its own, centred, with "Back to your estimate". |
| Holding page | `app/estimate/HoldingCallback.tsx` | The contact fields and one button in a centred card; no change in wording. |
| Saved-and-resumed line, errors, slow-connection line | `WizardApp.tsx` (`wz-err`, `wz-waiting`) | One line above the question, in the shell's type sizes. Errors say what happened and what to do; they never sit under the action bar. |

### 7.13 Coverage check against the rebuilt wizard

Every screen in `estimator-journey-v2.html`, and every step added since, mapped to where this brief covers it.

| Journey screen | Live component | Covered in |
|---|---|---|
| Start | `QuickLook` start | §7.2 |
| Place | `QuickLook` place | §7.2, §7.8 |
| Job | `QuickLook` job | §7.2 |
| Rooms *(added after the prototype)* | `QuickLook` rooms | §7.2, §7.12 |
| Condition | `QuickLook` condition | §7.2 |
| Your details *(added after the prototype)* | `QuickLook` gate | §7.2 |
| Guide range | `Reveal` | §7.4, §7.8–§7.10 |
| Tighten your range | `ScopeEditor` | §7.5 |
| Room | `ScopeEditor` room card | §7.5, §7.12 |
| A few details | `ScopeEditor` "A few details to settle" | §7.5 |
| Site and access | `SiteAccess` | §7.12 |
| Detailed range | `Finish` | §7.6 |
| Sent to your estimator | `estimate/sent` | §7.12 |
| Inside and outside | `QuickLook` both | §7.9 |
| What kind of space | `SegmentScreen` | §7.10 |
| Areas, warehouse, commercial job | `AreasScreen`, `WarehouseScreen`, `JobScreen` | §7.10 |
| Commercial brief and booking | `BriefScreen`, `BookScreen`, `BriefDone` | §7.11 |
| Outside | `QuickLook` outside | §7.8 |
| Which sides *(added after the prototype)* | `QuickLook` sides | §7.8 |
| Walk around the house, one side | `SidesEditor` | §7.8, §7.12 |
| Trade: new quote, spec sheet | `app/account/(portal)/quote/…` | **Not in this brief** (⚑ 20) |

Also on a customer's path, not in the prototype: site-visit booking (`estimate/visit`, §7.6), the assistant page (`estimate/assist`, ⚑ 22). Not on a customer's path: the older five-page list in `WizardApp.tsx` (staff mode, and a `?entry=upload` door the tests use; ⚑ 21) and `app/wizard/Editor.tsx` (no longer imported).

## 8. Out of scope
- Any change to questions, option values, pricing, accuracy maths, thresholds, visit rules, or `data-testid`s.
- Any change to segment rows, routing (which segments range online and which are visit-only) or the commercial pricing bands.
- The trade lane in the portal (⚑ 20), the staff-mode page list (⚑ 21) and the assistant page (⚑ 22), unless Tom rules them in.
- Staff/internal mode of the wizard: must look no worse; no redesign.

## 9. Sessions (walking skeleton first)

| # | Deliver | Done when |
|---|---|---|
| 0 | Commit this brief to `docs/briefs/` and the mockup to `design/reference/`. Confirm the file list back. Read §3. | File list confirmed; no code yet. |
| 1 | Shell and tokens for **every path**: header, step rail driven by `stepsFor()`, stripe, two-column `.wz-wrap`, buttons, option cards, chips, count rows, follow-up boxes, fields, in-column nav, phone bottom bar. Empty right column placeholder. | Every step of all five paths in §7.7 renders in the new shell at 390, 768, 1280, 1440. Existing wizard e2e pass unchanged. |
| 2 | Home inside, right column: `HousePicture`, `RoomPicture`, `PlanMap` (inline SVG, no libraries), Job so far, Talk it through. | Pictures respond to every answer in §7.2. Reduced-motion verified. |
| 3 | Range reveal for all paths: layout, ladder (with the outside and commercial variant), part ranges for "both", commercial note, doors, three cards. | Gate → reveal e2e passes on inside, outside, both and one commercial segment; doors keep their test ids and visibility rules. |
| 4 | Room editor: rail, price card with band, accordion cards, tile order and sizes, phone strip, cornices fix. Covers commercial areas (same component). | Confirm-loop e2e pass; header ≤ 64px desktop; no empty right half without a floorplan. |
| 5 | Home outside: element-by-element house picture, view from above, Outside and Sides steps, **side-by-side editor** (§7.8). | Exterior confirm-loop e2e pass; wall-mix and "No, leave it off" behave as today. |
| 6 | Home both: choice screen, part ranges, the stacked editor with its two jump links. | `both-stacked.spec.ts` passes unchanged; "both" passes end to end. |
| 7 | Commercial: Space, Areas, Building, Job, Questions, Book, Booked; warehouse picture; area plan. | One ranged segment, the warehouse and one visit-only segment pass e2e; every segment row renders with no hard-coded wording. |
| 8 | Supporting screens and pieces in §7.12: sheets, chat panel, floorplan states, room and side extras, site and access, guardrail outcome, sent, book, holding. | Every row of §7.12 and §7.13 ticked, with a screenshot each at 390 and 1440. |
| 9 | Finalise and visit for all paths; visual pass against the mockup on all six job types; Lighthouse; help files (`docs/help/estimator/customer.md`, `commercial.md`) rewritten from the real screens; ledger update. Delete the old layout rules (`.wz-dots`, `.wz-rather`, `.wz-steps`, the 640px `.wz-wrap` cap). | See §10. |

Each session ends with: gates green, `wizard-ui-refresh-progress.md` updated, screenshots at 390 and 1440 attached to the PR. The full block for each session is in `wizard-ui-refresh-runsheet.md` §4.

## 10. Acceptance criteria

**Layout**
- [ ] At 1280px and 1440px every quick-look step shows two columns; no content column narrower than 560px or wider than 640px; no full-bleed button.
- [ ] At 390px there is no horizontal scroll on any screen, in any state (open room card, Adjust it, long room names).
- [ ] Sticky chrome height: ≤ 64px desktop on every screen; ≤ 56px + progress row on phone steps; ≤ 125px total (header + range strip) in the phone room editor.
- [ ] In the room editor at ≥ 901px, the right rail is always filled whether or not a floorplan exists. All left-column cards share one width.
- [ ] Nothing overlaps: chat control, toasts and bottom bars never cover a button or field (check at 390 × 667 too).

**Behaviour preserved (adversarial)**
- [ ] Every hook in `wizard-ui-refresh-test-hooks.md` (78 class hooks, 550-odd test ids across 73 specs) still exists on an element that does the same job. A hook may move (the estimator strip into the rail, the chat bubble into the header); it may not disappear.
- [ ] The existing Playwright suites pass. A spec may change only where it asserts wording that Tom changed under ⚑ 7, and each such edit is listed in the PR body with the old and new string.
- [ ] Known contracts that the new layout must keep: `.sc-freeze` stays pinned at the top with `.sc-num` and `.il-prog` on screen at any scroll position (`r5-editor.spec.ts`); the frozen stack is under a third of a 780px phone screen; `data-testid="range-width"` holds text that parses to the number alone once `±` and `%` are stripped; `.il-prog` reads `N OF M`; `.sc-stick` contains exactly two buttons and exists once in the DOM (move it with CSS between the rail and the phone bar; do not render it twice); `wz-chat-bubble` and `estimator-strip` keep their test ids in their new homes.
- [ ] Payloads to `/api/wizard/*` and `/api/estimates/[id]/wizard-edit` are byte-identical before and after for the same answers (snapshot test on one interior journey).
- [ ] Parity: an interior estimate built through the new UI prices to the same cents as the same answers through the old UI.
- [ ] A residential customer cannot see a price figure in the DOM before the gate is passed.
- [ ] "Speak with us" stays hidden outside the phone-finalise range.
- [ ] Room cannot be confirmed without the size answer; the gap is named.

**Every job type**
- [ ] The step list on screen equals `stepsFor()` for: inside, outside, both, each ranged segment, the warehouse, each visit-only segment, hospital, and a commercial "outside" or "both" answer. Add a unit test that walks all of them.
- [ ] Outside: nothing is pre-ticked on "On the house" or on wall materials. Materials, window type and count, and door count appear only when their element is ticked.
- [ ] Outside and commercial range screens never show a "Confirmed" bar or offer "Speak with us".
- [ ] "Both": the range screen and the price card show the combined range and both part ranges, and the three always add up.
- [ ] Side card cannot be confirmed until the size is answered (or "Not sure") and the wall shares add to 100%; the gap is named.
- [ ] Commercial: every label, hint and option on the Space, Areas, Job and Questions screens is read from the segment row at runtime; none is hard-coded in a component. Flagged "also" areas keep their "outside, priced on site" note.
- [ ] Visit-only: no price figure appears anywhere on the path; the last button books, and the Booked screen states the time or says we will call.
- [ ] All six mockup job types match the build at 390 and 1440 (side-by-side screenshots in the final PR).

**Nothing left behind**
- [ ] A Playwright spec opens every row of §7.13 and §7.12 as a customer at 1440px and fails if the page still uses the old shell (header taller than 64px, a single 640px content column, or a full-width action bar).
- [ ] After Session 9, no component references `.wz-dots`, `.wz-rather` or `.wz-steps`, and `wizard.css` no longer defines them.
- [ ] The PR for Session 9 includes the §7.13 table with a link to a before and after screenshot for each row.

**Accessibility and ease of use**
- [ ] Every interactive control ≥ 48 × 48px; body text ≥ 17px; inputs ≥ 16px.
- [ ] All text meets WCAG AA contrast (cyan links use `#0A7C8E`, never `#3BD8E9`, on white).
- [ ] Full keyboard path through all six steps and one room; visible focus ring; option cards expose `aria-pressed`; pictures are `aria-hidden` and never the only carrier of an answer.
- [ ] Amber and cyan states always carry a word or icon as well as colour.
- [ ] `prefers-reduced-motion` removes all animation.

**Performance**
- [ ] Lighthouse mobile performance ≥ 90 on `/wizard` and `/estimate/scope`.
- [ ] Pictures are inline SVG; no new runtime dependency; no layout shift when a picture changes (fixed 4:3 box).

## 11. ⚑ Decisions for Tom (not invented here)

**NEEDS TOM'S RULING (each ships switched off, or on the safe default in `wizard-ui-refresh-decisions.md`, until he rules; none blocks the build)**
- ⚑ 1 **Colour try-on swatches** on the room picture (Session 2). Keep, or leave out? If kept: five generic colours labelled "preview only" as mocked, or real named colours from a supplier range (which raises accuracy and trademark questions)?
- ⚑ 2 **"A job like yours" card** on the range screen (Session 3). Show a real showcase job? If yes: which matching rule (same type and nearest size?), and is it acceptable when that job's price sits below the customer's range? The mock uses the East Melbourne apartment already on the homepage.
- ⚑ 5 **Trust card** (Session 3). Confirm the three claims and their wording: review score and count (live from the Google sync, or fixed text?), "2-year workmanship warranty" (the warranty wording was awaiting legal review), "$20M public liability".
- ⚑ 10 **Chat moves into the header** as an icon and the floating bubble goes (Session 1). Agree?

- ⚑ 13 **Who is named on commercial jobs** (Session 7). The mockup shows Tom Roman as the estimator on every path. Is that right for commercial, or should it be whoever `EstimatorStrip` resolves for the segment?
- ⚑ 14 **Commercial "job like yours" and trust card** (Session 3). The mock shows an unnamed placeholder for the commercial job, and "Certificates and SWMS with every quote" in place of the warranty line. Which real commercial job (if any) may be shown with its price, and is that trust wording right?

**DEFAULTS (change any time)**
- ⚑ 3 Estimator photo. Default: initials until a photo is supplied in Settings.
- ⚑ 4 Address confirmation line. Mock says "Got it. We paint in your area." Default: only show it for in-zone addresses; pre-arranged and out-of-area keep today's behaviour.
- ⚑ 6 Time claims ("About a minute to go", "About 4 minutes, room by room"). Default: ship without numbers until real medians from `wizard_sessions` are known, then fill them in.
- ⚑ 7 Copy changes in the mock that differ from live: "Are these the rooms we're painting?" (was "Please confirm the rooms we're painting"); "Check this room" / "Checked" (was "Confirm this room"); "Within 30%" (was "±30%"; note `range-width` is parsed by `r5-editor.spec.ts`, so keep the number alone in that element and put "within" outside it); "Show my guide range" on the gate button. Default: use the mock's wording.
- ⚑ 8 Extras shown with prices to customers ("Air vent $180"). That is live today; confirm it is intended.
- ⚑ 9 Gate promise. The mock says only "We save your estimate and email you a link". It deliberately makes no promise about whether anyone will call. Say if you want one.
- ⚑ 11 Ladder bar widths on the range screen are illustrative. Default: Guide bar uses the live band width; Detailed and Confirmed are fixed illustrative widths with no numbers.
- ⚑ 12 The "Imported · Custom surface · $105" chip on the live editor (see §2 row 8): confirm it should never reach a customer, and it will be raised as its own fix.

- ⚑ 15 Colour on the outside picture. The house takes a set tone for each colour answer (same colours, new colours, much lighter). Default: keep those three tones and no swatch picker outside.
- ⚑ 16 "Not sure" on a side's size shows as a third button beside Looks right and Adjust it. Default: keep it there (the option exists today).
- ⚑ 17 Rail label for commercial checking. Default: "Area by area".
- ⚑ 18 Time slots on the commercial Book screen. Default: whatever `BookScreen` receives today; no change to the rules.
- ⚑ 19 Booked screen: the four "What happens next" steps reuse the three Book-screen points plus "You told us what the building needs". Default: as mocked.

- ⚑ 20 **Trade lane** (portal "New quote" and the spec sheet, from the journey prototype). It lives in the portal, not in `/wizard`, and uses the portal's styles. Default: not in this brief; a short addendum after the wizard ships.
- ⚑ 21 **Staff mode.** Staff still see the older five-page list inside `WizardApp.tsx`. It will pick up the new colours, type and buttons automatically, but not the two-column layout or the pictures. Default: leave it that way. Session 1 must keep those pages single-column with a modifier class, so the new two-column shell cannot break staff mode.
- ⚑ 22 **Assistant page** (`/estimate/assist`). It has its own layout and stylesheet. Default: tokens only (colours, type, buttons) in Session 8; no layout change.
- ⚑ 23 **Estimator name.** The journey prototype says Sarah; the live wizard shows Tom. Default: whatever `EstimatorStrip` resolves, never hard-coded.

## 12. Kickoff

Tom pastes the whole of `docs/briefs/wizard-ui-refresh-runsheet.md` into a new Claude Code chat. It runs Step 0 and Session 0, then stops for his phone check of the mockup. Every later chat starts with the two lines in the run sheet's §7.

This brief is the specification the run sheet points at. If the two disagree, stop and report; do not pick one.
