# The customer flow v3 — range first, tighten at will

*Tom's direction, 8 Sep 2026. The spine that the reward tiers (`reward-tiers-plan.md`) hang off. Plan and mockups only; nothing built yet.*

Reference mockups: `design/reference/customer-flow-v3-form.html` (four screens + the reveal) and `design/reference/customer-flow-v3-builder.html` (the builder home). Every PR names the interactions it implements from them.

## 1 · What changes, in one paragraph

Today the customer answers 25–30 questions across five pages before seeing a number, then works a 20–30-tap confirm walk whose reward — an online acceptance — almost nobody reaches. The new flow asks **only what a number needs** (about eleven taps, four screens), **shows the range**, and turns everything else into optional tightening that the customer does at their own pace, in the order that moves the number most, with three doors always open: *Send someone · Tighten my price · Ask us*. Nothing in the machinery changes — the tree, the engine, the confirm loop, the accuracy score, the live range and the swing calculator all stay. The form shrinks, the builder becomes the main event, and the questions we took off the form come back after the price, priced.

## 2 · The order, and why

The rule: ask first what has to be known **before a number can exist**; then the answers with the **biggest dollar swing the customer can answer reliably**; and never ask what they *can't* answer reliably — derive it.

| # | Step | Why it sits here | What it feeds |
|---|---|---|---|
| 1 | Where, what, and can we price it | Hard stops (asbestos, lead) and hand-offs (heritage, body corporate, commercial) must come before any number, or we show a price we'd withdraw | guardrails, job type, property type |
| 2 | How big is it | The largest lever: a 20% size error is 20% on everything | the tree (rooms / sides, sizes) |
| 3 | What are we painting | Second largest: ceilings are ~a quarter of an interior; a side is a quarter of an exterior | surfaces / sides on the tree |
| 4 | Same colours or new | The largest *multiplier* a customer knows for certain — coats are ours to derive from it | condition.tier → rate_N_coat |
| 5 | **The range** | Everything above is enough for an honest Bronze range | — |
| 6 | Tighten, by swing | Condition as facts + photos first (the ×1.35 lever and the worst-guessed answer, so pictures not adjectives); sizes room by room; door/window styles; ceiling height; cupboards; living there; paint brand last | each narrows the band |

Two consequences. **Condition moves from step 3 of the form to the first question after the reveal** — a wrong answer moves a number the customer can see, instead of silently before it. And **coats are never asked**: "same or new" plus "any dark colours going light" decides one, two or three coats in the engine.

## 3 · The screens

### Screen 1 · Where and what
- Address (Places, as now).
- Inside · Outside · Both.
- House · Townhouse · Unit/apartment · Commercial (commercial hands off exactly as today).
- The three safety questions as one row of three toggles with *Not sure*: heritage-listed · body corporate · asbestos. No silent default (the 6 Sep ruling stands).
- Under Continue, small and always there: **"Or just book a visit — no questions."** Address + mobile, straight to the visit times (`bookWizardSlot`, as the builder's *Send someone* does). The draft files into the `ready_visit` lane marked hot — the person who chooses this is the one who says yes on the day, and is treated as such on Today.

### Screen 2 · The place — three ways in
- **Upload your floorplan** — a phone photo of the brochure is fine. The Gold road.
- **Describe it** — type or **dictate** ("3-bed weatherboard, painting the front, left and back, walls and ceilings inside, a bit of peeling on the north side"). The existing describe build; it replaces screen 3 for anyone who'd rather talk. Voice = the browser's speech recognition into the same box; nothing new server-side.
- **Three quick taps** — interior: bedrooms · storeys · rough size. Exterior: storeys · cladding · which sides.
  **The starter list must be complete.** Today `starterRoomList` lays out bedrooms, living, kitchen, bathroom and hallway and leaves out WC, ensuite, laundry, garage and (double storey) landing — so a three-tap house is under-scoped before a single answer. The list becomes: 1 bed → +bath, WC-in-bath, laundry; 2–3 bed → +ensuite? (asked as a chip), separate WC, laundry; 4+ → +ensuite, WC, laundry, study; double → +landing/stairs; garage as a chip. Every added room is `assumedFields: presence` (a keep-it / remove-it chip in the builder, which exists). This is the one accuracy fix that is independent of any benchmark, and it lands in flow PR (a).
- Small, under the cards: *"Just bought? Paste the listing and we'll try to pull the plan."* Never blocks — nothing found, the taps carry on with a one-line note. Primary for trade / real-estate accounts. Measured (every pull is an extraction run).

### Screen 3 · The job
- What we're painting — the usual set **pre-ticked** (interior: walls, ceilings, doors, frames, skirting, windows; exterior: house body, roofline, windows & doors), one tap to change; fence / deck / garage door as extras.
- **Same colours, or new?** — and if new, *any dark colours going light?*
- One optional button: *Anything you can see? Add a photo* (peeling, cracks, water marks). Optional here; asked again, per area, in the builder.

### Screen 4 · Your range
- **"Most likely $X · up to $Y"** — the top is the honest ceiling, never a "from". Bronze chip. Confidence ring.
- One line: *"Answer a few more and this narrows — or we'll come and look."*
- **The three doors**: Send someone · Tighten my price · Ask us (call / call back / chat).
- **Contact** sits here: *Text me this range* (mobile only; email comes later at save or booking). Whether the range shows before or after the mobile is a Settings switch (`wizard_contact_gate: reveal_first | contact_first`), measured for a month, then decided.

### The builder home
- The **range card** pinned at the top: range · tier chip · ring · *"Silver — two questions from Gold: confirm the ceiling height (narrows ~$380) · upload your floorplan."* The line comes from `assumptionSwings` + `nextUnlock`.
- **The ring never names a target the current road can't reach.** A no-plan job's stated goal is Silver; Gold appears only as *"unlock with a floorplan"*. A plan-backed job is shown Gold. `ladderFor().nextUnlock` decides which, from the same reachability facts PR 1 pins with a test — a score that can't be hit reads as "you failed", so it is never shown as the goal.
- The three doors, under the card and again in the sticky footer (the reach strip, which already exists).
- **Tap or chat** — one switch. Every chip can be answered by tapping or by typing in the chat pane; both drive the same question list. (Today's "Chat it instead" side link becomes this switch.)
- The **tightening list**, ordered by swing: *Condition — anything you can see?* (facts + per-area photos, pictures beside each option) · room sizes (the confirm loop as today) · door & window styles · ceiling height · cupboards · living there · paint brand.
- The room / side cards as they are now, below.

## 3b · Against the six problems this started from
| Problem | Where it is solved |
|---|---|
| Under-scoped / mis-sized first number | Complete starter list (screen 2, flow PR a); measured sides + size band (exist); interval pricing (later); accuracy proven against actuals (step 0) |
| Range in two minutes | Screens 1–4 |
| "Send someone" first-class from page 1 | Screen 1 visit door + the three doors from the reveal on |
| The walk as a gate | Finalise never disabled (shipped 8 Sep); the walk earns tiers; the reachable-target rule; the band widening by default = interval pricing (later, said plainly) |
| Condition as facts + pictures, priced in the open | First tightening chip in the builder |
| Measure for real | §11, both halves |

## 4 · Derived, never asked
- **Coats** — from same/new + dark-to-light.
- **Prep hours** — from condition facts and photos, as an allowance until an estimator signs off.
- **Storey height / typical sizes** — from storeys + size band until confirmed.

## 5 · What moves where

| Today (form) | New home |
|---|---|
| Coats tier (freshen / change / dark to light) | Derived from same-or-new + dark-to-light |
| Damage 0–3 + photos | Builder: *Condition — anything you can see?* facts + photos, first tightening chip |
| Door type · door scope · window type · ceiling height | Builder chips, by swing |
| Living there | Builder chip |
| Paint brand · water-based · colour help | Builder chips, last |
| Access (exterior) · access equipment | Builder chips |
| Listing URL (front page field) | Screen 2, small option; primary for trade accounts |
| Contact page (name, email, phone, paint) | Screen 4: mobile to keep the range; email at save/booking; name at booking |

## 6 · What is deleted (clean build)
- `PageDetails` and `PagePaint` as form pages — their questions become builder chips driven off the existing `answer` actions (`set_door_style`, `set_window_style`, `confirm_height`, `cupboard`, occupied, paint). The page components go; the actions stay.
- `PageCondition`'s coats cards and damage tiers — replaced by same/new on screen 3 and the condition chip in the builder. `condition.tier` stays in the state, written by the engine's derivation, so nothing downstream changes.
- The five-step counters and "Nearly there" wording.
- `ContactCard.tsx` — the three doors are one component (`ReachStrip`).
- The "Chat it instead" side link — becomes the Tap/Chat switch.
- `CustomerResult` guardrail screens stay (hard stops still need a screen).

Nothing is written on top of a page that is no longer needed: each PR removes the page it replaces and rewrites the specs that drove it.

## 7 · Reachability (ties to the tiers)
With no plan, three taps + the full room walk lands in the low 70s → Silver. A plan or listing + the walk → 90 → Gold-eligible. PR 1 of the tiers brief pins those numbers with a test. The builder says which road the customer is on.

## 8 · The roadmap — one sequence, both briefs
0. **Prove against actuals** — `/proving` reads work-order actuals (§11). The yardstick for everything after.
1. **One ladder** (tiers PR 1) — the clean-up both halves sit on.
2. **The flow** — this brief. Three PRs: (a) screens 1–3 + the describe/voice way in + listing demoted; (b) screen 4, the reveal, the contact switch; (c) the builder home: range card, Tap/Chat switch, the tightening list, condition as facts + photos.
3. **Tightening as the game** — next-unlock line with swings, tier chip animation, "reward lost" explanation (tiers PR 4, moved up).
4. **Silver** (tiers PR 2). 5. **Gold** (tiers PR 3, "book straight in" switch OFF). 6. Later: interval pricing, photo grading, exterior Gold, per-account auto-confirm.

## 9 · The PRs, e2e-first
- **Flow (a)** — new screens 1–3; describe (typed) on screen 2; the complete starter list; the screen-1 visit door; listing demoted and non-blocking. *Gate:* the exterior-path / simpler-form / tom-batch specs rewritten to the new screens; a spec that the listing failing never blocks; a unit test that a 3-bed three-tap house carries a WC, a laundry and an ensuite chip; a spec that the screen-1 visit door books a visit and lands hot on Today.
- **Flow (b)** — screen 4 reveal, three doors, contact switch both ways. *Gate:* funnel-dropout and save-and-return rewritten; a spec per switch position.
- **Flow (c)** — builder home. *Gate:* interior-loop / sides-editor / r5-editor rewritten; a spec that a chip answered in chat goes blue in the list and vice versa.
- Every PR: `tsc` clean, eslint 0 errors, unit green, the named C1 specs green, ARCHITECTURE.md, a manual walk.

## 10 · Tom's rulings (8 Sep 2026, late)
1. **Range first** at launch (`wizard_contact_gate = reveal_first`); measured for a month.
2. The "up to" ceiling: today's band until interval pricing lands, then its high case.
3. **Voice on screen 2 after launch** — the describe box ships typed-only in flow PR (a); the microphone is its own small PR.
4. **Listing link stays, small, for everyone**; primary for trade accounts.

## 11 · Measurement — two halves
**The funnel.** Three numbers a week from the buckets that already exist: % of starts that reach a range · % that book / call / accept · the screen people leave on. Targets set before looking: 60% reach a range, 30% convert.

**Accuracy — against actuals, never PaintScout.** The proving window compared the wizard's first number to PaintScout quotes that themselves lost money, so its "$2,489 under" is not a fact to build on (Tom, 8 Sep). `/proving` is re-pointed at the job's **actuals** — work-order hours × the charge-out plus materials off the WO doc (`lib/workorder/snapshot`) — for every completed wizard-born job, and reports the same three bands. That is the number the tier thresholds, the interval spreads and the Gold switch are all calibrated from. Small PR, sequenced first (step 0 below), because everything else is measured by it.
