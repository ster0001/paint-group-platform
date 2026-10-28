# Build brief — Estimator wizard, mobile (v5) + guide-range gate

**Project:** paint-group-platform (Next.js 16 / Supabase)
**Scope:** the customer estimator at `< 768px` on Paint Home first (same code serves Paint Group — ship to both unless marked). **Desktop is unchanged** apart from one optional item (§6).
**Approved:** Tom, 27 Oct 2026 — "perfect, happy with this".
**Reference prototype:** `painthome-wizard-v5.html` — the single source of truth for layout, copy, order, interactions and the roller animation. Open it at 390px. Where this brief and the prototype disagree, the prototype wins.
**Supersedes:** `claude-code-brief-wizard-mobile-and-gate.md` (v1) and `-v2.md` on everything mobile and everything gate. v1 §1 (what was found on 27 Oct) and the desktop dock bug (v1 B1) still stand as facts.
**Date:** 27 Oct 2026

---

## 0. Read first
- `estimator-v2-progress.md`, `estimator-v2-runsheet.md` — ledger; update at the end of every session.
- `claude-code-brief-exterior-wizard-v2.md` — exterior question order is governed there, not here (§2.4).
- `claude-code-brief-visit-booking.md` + visit-booking rulings (zone map, pre-set days per zone, no free self-booking) — the Contact sheet's booking must call that module, not a new calendar.
- Route files to locate with `grep` and record in the ledger (stop-and-report if missing): the `/estimate` step components; the guide-range gate component; `.wz-rv-dock`; the floating helper pill; the sticky picture panel and its SVG room/house drawings; the "bigger job" condition; brand/theme tokens; the zone-slot API used by visit booking; `crm_events` emitter.

## 1. Rulings (binding)
- R1. **Mobile only.** Nothing in this brief changes the desktop (`≥ 768px`) wizard or gate, except §6.
- R2. **No tolerance promise** anywhere a customer can see it (no ±%, no "within 17%").
- R3. **Small print on the range**, one sentence, grey: "Based on what you've told us — anything different on the day changes the price. Sarah confirms it with you before anything is fixed. Includes GST."
- R4. **The Guide → Narrowed → Fixed ladder is gone.** Three small tiles: Your range ✓ · Your exact price (online, today) · Sarah confirms (in person).
- R5. **No picture on the gate.**
- R6. **Contact, not Help.** A visit can be booked from any screen on name + mobile alone.
- R7. **One question per screen; single-choice screens advance themselves** ~250ms after the tap. Continue only on multi-select (surfaces, rooms) and details. ⚑ D10 confirms auto-advance.
- R8. **Minimal copy.** One heading, at most one grey line under it. No "why we ask", no promise lists, no estimator cards on the steps. The three promises ("No calls unless…", "Nothing you've entered…", "Your details stay…") are not to reappear.
- R9. The live thumbnail (§3) **is** the hand-holding; the ribbon line of answers is the only other one.
- R10. Paint Home never shows Paint Group branding; "Reviews powered by Paint Group" in 11px under the trust line only.

## 2. Screens (mobile)
Order and skip rules exactly as the prototype. Each: back chevron top-left, logo centre, **Contact** pill top-right; 3px progress bar; the live strip (§3); heading; options; bottom bar only where noted.

| # | id | Heading | Sub-line | Options | Advance |
|---|---|---|---|---|---|
| 1 | what | What are we painting? | Your range in under a minute. (address chip above with Change) | Inside / Outside (icon cards) | auto |
| 2 | property | What kind of place is it? | Near enough is fine. | House / Townhouse / Unit or apartment | auto |
| 3 | beds | How many bedrooms? | This builds your room list for you. | 1 2 3 4 5+ | auto |
| 4 | storeys | One storey or two? | Two adds the stairwell and upper hall. (Outside: Two means more wall and some height work.) | One / Two | auto · **skip for Unit** |
| 5 | job | What's the job? | Coats and preparation come from this. | Whole interior / Some rooms / Doors, windows and trims | auto · **skip for Outside** |
| 6 | surfaces | What's being painted? | Tap a surface and watch it paint in. | chips (§3.2), pre-ticked | Continue |
| 7 | rooms | We're painting these rooms / Which rooms? (Some rooms) | We've guessed from the bedrooms. Untick any, add any. | chips from beds + storeys, "+ Another room" | Continue · **skip for Outside** |
| 8 | colours | Colours? | Still deciding is fine. | New colours / Same colours / Still deciding (swatches) | auto |
| 9 | condition | How are the walls looking? (Outside: How is the outside looking?) | Honest is best — it sets the prep. | Good, just tired / Some wear / Needs work | auto |
| 10 | living | Anyone living there while we paint? | We work room by room and pack down each day. | No, it'll be empty / Yes, we'll be there | auto |
| 11 | details | Where shall we send your range? | It shows on the next screen. We text you the link so you can come back to it. | Name · Mobile · Email · optional offers tick | **Show my range** (enabled on name + 10-digit mobile) · hint "Appears instantly" |
| 12 | gate | §4 | | | |

- 2.1 Progress bar: `index / (screens−1) × 55%`; the gate sits at 55%; the quote stage continues to 100%.
- 2.2 Ribbon (in the strip): answers joined with " · " — Inside · House · 3 bed · Two storeys · Whole interior · 8 rooms · New colours · Some wear; second line "N surfaces ticked · tap to see" once surfaces exist, else "Updates as you answer · tap to see".
- 2.3 Rooms are generated: Bed 1…N, Living room, Kitchen / Meals, Bathroom, Laundry, Hall & Entry; Two storeys adds Stairwell, Upstairs hall; "Some rooms" pre-ticks the first two only. Extra chips offered unticked: Study, Ensuite, Garage.
- 2.4 **Exterior:** the prototype's Outside path demonstrates the thumbnail mechanic only. The real Outside question order (property type first, materials, elements, walk-round) is the exterior v2 brief. Build the strip/roller mechanic so it works with whatever that brief's surfaces are.
- 2.5 Details step: if the customer already booked a visit via Contact (§5), name and mobile arrive pre-filled.
- 2.6 Data model is unchanged. Surfaces map to the existing surface flags; "Doors, windows and trims" pre-ticks skirtings, doors, windows only.

## 3. The live strip and roller
Mobile replaces the sticky picture panel and the floating pill with one strip under the progress bar: thumbnail 76×52 left · ribbon text · chevron. Tapping it opens a bottom sheet: the same picture full width (5:3), caption "Tap a surface to paint it in or out.", and the same surface chips. Hidden on the gate.

- 3.1 **Thumbnail = the real drawing, scaled.** Use the existing room/house SVGs (desktop's), rendered twice (strip + sheet) from one state. Variants driven by answers: Inside → room; Outside → house; Unit → block with balconies and three window rows; Townhouse → split house with two doors; Two storeys → second window row; colours tint the walls (New: soft green `#cfe3d6`, Same: cream `#f1efe9`, Still deciding: pale teal `#dcecef`); condition adds marks (Some wear: dots; Needs work: cracks).
- 3.2 **Surfaces.** Inside: walls, ceilings, skirtings, doors, window frames. Outside (demo set): walls, eaves & fascia, gutters & downpipes, window frames, doors, verandah (house only). Each surface is a base layer (grey `#e4e8ec`) plus a painted layer clipped by a rect.
- 3.3 **Roller sweep.** On tick, animate the clip rect width 0→full over ~520ms (ease-out cubic) with a small teal roller glyph riding the leading edge at the surface's mid-height; untick wipes back. **Animate every rendered copy independently** (thumbnail and sheet each own their frame handle — this was the v4 bug). Respect `prefers-reduced-motion`: snap instead of sweep.
- 3.4 Chips in the step and in the sheet are the same control; ticking either updates both pictures and the ribbon count.
- 3.5 Before the surfaces step the picture renders unpainted; after it, the ticked state persists through colours/condition (which re-render with the same ticks).
- 3.6 Performance: inline SVG, no images; re-render on answer change only; animation via `requestAnimationFrame`, not CSS on clipPath children (Safari).

## 4. The gate (mobile)
Order, single column, no picture:
1. "Tom, your range today" (teal label) → range in Martian Mono 40px → one grey basis line ("3-bedroom · house · single storey · whole interior · new colours · some wear. If that's about right, this is about right.") → **small print** (R3).
2. **"Want the exact number?"** · "Ten minutes, room by room, nothing to measure. Then Sarah visits to run through the finer details and confirm it." · teal button **Get my exact price** / sub "Room by room · about 10 min" · "Or book a time with Sarah first" (opens the Contact sheet at the slots step, §5).
3. Three tiles (R4).
4. Sarah line (avatar · Sarah Reid, your estimator · Looks after Northcote. Ask her anything.).
5. Trust line: "5.0 · 93 Google reviews · 2-year warranty · $20M insured" + powered-by small print.
6. "What's in the range" collapsed; lists the **ticked** surfaces with coats.
- 4.1 Sticky bottom bar: Get my exact price only, safe-area padding.
- 4.2 "Bigger job" variant: only above the D3 ceiling; replaces block 2 with "We'll come and look" + Book a visit; never both; off on Paint Home until D3 is set.
- 4.3 After the tap: Paint Home chrome on `/estimate/scope` (brand guard, v1 B7) is a prerequisite. Scope page header shows the three tiles with "Your exact price" active.
- 4.4 Button label ⚑ D11 ("Get my exact price" vs "Get my quote today").

## 5. Contact sheet and early booking
Top-right pill **Contact** on every screen. Sheet: Sarah line → teal **Book a visit** ("Sarah comes to you. About 40 minutes, no charge.") → Call 03 8840 9414 (tel:) → Send a message → Save and come back later.
- 5.1 **Book a visit:** if the session has no name + mobile, show the two fields ("Just a name and a mobile. Sarah texts you to confirm.") → Choose a time. If it has them, go straight to times.
- 5.2 **Times** come from the visit-booking module for the address's zone (pre-set days only, per the 20 Sep ruling). Heading "When suits?" · "Sarah is in Northcote on these days." Four slots max on screen; "More days" if needed.
- 5.3 **Booked:** "Sarah, Thu 30 Oct, 9:00 am, at 15 Westgarth St. We've texted the details to 04…. Your answers so far are saved." Button **Keep going with my range** returns to the current screen. Creates the booking + a lead with whatever answers exist; sends the SMS via the messaging adapter.
- 5.4 Details step and gate pre-fill from the booking's name/mobile.
- 5.5 ⚑ D12 earliest offered slot (next zone day vs ≥ 2 days out). ⚑ D13 after booking, does the customer still see the range + exact-price step, or a shorter "see you Thursday" gate? Prototype keeps the full path.
- 5.6 Desktop keeps its existing bottom-right bar; relabel its header control to Contact if it still says Help, but no other desktop change.

## 6. Desktop — the one optional item
Add the roller sweep (§3.3) to the existing desktop right-rail picture when a surface chip is ticked. Same SVG layers, same animation, same reduced-motion rule. No layout change. ⚑ D14 — build it or leave it.

## 7. Home hero (mobile) — carried from v1 A6
Address input and "See my price" stacked full-width at `< 768px`; suggestions overlay rather than push the Inside/Outside chips.

## 8. Analytics (one event log, `crm_events`)
`wizard_step_viewed {step, breakpoint}` · `surface_toggled {surface, on}` · `gate_viewed {range_low, range_high, bigger_job, breakpoint}` · `gate_cta_clicked {cta:'exact'|'visit'|'call'|'message'|'save', breakpoint}` · `contact_opened {step}` · `visit_booked {step, from:'contact'|'gate'}` · `scope_viewed {from:'gate'}`. Home dashboard "Where estimates go" reads gate→exact and contact→booked rates.

## 9. Acceptance (390×780, iOS Safari + Android Chrome)
- [ ] Twelve screens in the order above; skip rules for Unit and Outside hold; Back retraces them.
- [ ] Single-choice taps advance after ~250ms (or Continue, per D10); multi-select and details show the bottom bar; safe-area padding present.
- [ ] Heading is the first thing in view on every screen; no control overlaps any option; floating pill and sticky picture panel are gone.
- [ ] Strip: 76×52 thumbnail + ribbon + chevron; ribbon text matches §2.2 for a full Inside and a full Outside run.
- [ ] Ticking any surface chip sweeps that surface in **in the thumbnail without opening the sheet**, and in the sheet; unticking wipes back; reduced-motion snaps.
- [ ] Picture variants: Unit, Townhouse, Two storeys, three colour tints, two condition marks — screenshot each.
- [ ] Gate renders blocks 1–6 in order, no picture, no ± string, small print present (grep + visual); "What's in the range" lists ticked surfaces only.
- [ ] Contact pill on every screen; Book a visit with no details shows the two-field form; with details skips to times; times are the zone's pre-set days; booking creates lead + visit + SMS; Keep going returns to the same step; details step pre-filled.
- [ ] Gate "book a time with Sarah" opens the sheet at times.
- [ ] Paint Home chrome on `/estimate/scope` after "Get my exact price".
- [ ] No "Paint Group" string on Paint Home customer pages except the powered-by line.
- [ ] Desktop wizard and desktop gate screenshots at 1470px are byte-identical to pre-build except the Contact relabel (and §6 if D14 = build).
- [ ] Golden pricing tests unchanged; exterior question order untouched; events in §8 fire with correct payloads (API-level test).

## 10. Decisions for Tom (⚑)
| ⚑ | Question | Default if unanswered |
|---|---|---|
| D10 | Single-choice screens auto-advance (~250ms) or show Continue? | Auto-advance |
| D11 | Gate button: "Get my exact price" or "Get my quote today"? | Get my exact price |
| D12 | Earliest slot offered in Contact booking | Next pre-set day in the zone |
| D13 | After a visit is booked, keep the full range + exact-price path, or a short "see you Thursday" gate? | Full path |
| D14 | Build the roller sweep on the desktop picture? | Build (small, same code) |
| D3 | Bigger-job ceiling on Paint Home | Off; exact price always offered |
| D4 | Sarah or Tom named on Paint Home | Estimator assigned to the session |
| D1 | Not needed — no seconds-per-step line in v5 | — |

## 11. Out of scope
Room-by-room `/estimate/scope` redesign (own brief); exterior question design (own brief); visit-booking calendar changes beyond calling its slot API; any desktop layout change.
