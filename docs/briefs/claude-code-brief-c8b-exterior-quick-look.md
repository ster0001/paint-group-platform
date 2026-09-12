# Chunk C8b — The exterior quick look, rebuilt

**Slots into:** `docs/briefs/estimator-v2-runsheet.md` §5, immediately after C8. Run it with C8 or straight after.
**Size:** M. **Migration:** none.
**Approved design:** `design/reference/estimator-journey-v2.html` **v2.6**, screen `s-ext-job`, plus its `?` drawer. Replace any older copy of that file at the same path.

---

## Why this chunk exists

Tom walked the exterior path on 11 September. Six defects, and **two of them are in the v2 design, not just v1** — the v2 brief inherited them, so building C8 as written would ship them again.

| Defect | Where it lives today |
|---|---|
| Asks the number of bedrooms on an exterior job | v1 |
| Asks storeys twice | v1 |
| Its pages should compress to one screen | v1 |
| Weatherboard pre-ticked | v1 **and** the v2.5 prototype |
| Asks what the house is *made of* before establishing whether the walls are being painted at all | v1 **and** the v2.5 prototype |
| No way to say what's actually being painted — windows, doors, fascias, gutters, eaves are not askable | v1 and v2.5 |
| No window type, no window count, no door count | v1 and v2.5 |
| No colour question on the exterior path | v1 and v2.5 |

The last four matter most for accuracy. Eight colonial windows and eight aluminium sliders are not the same job, and plenty of exteriors are trims and roofline only with the brick left bare on purpose.

---

## Step 1 — Report before building (no code)

    Report with file:line, and wait:
    1. The current exterior path through QuickLook.tsx / lib/wizard/quick-look.ts
       — every step, every question, in order, and which of the eight defects
       above are present.
    2. Where `beds` and `storeys` are written on an exterior session, and what
       reads them. Anything reading `beds` on an exterior job is a bug to
       report, not to work around.
    3. What the exterior engine (lib/pricing) can already price per element —
       walls by material, windows by type, doors, fascias, gutters, eaves,
       freestanding items — and what has no rate item yet.
    4. Whether `exterior_allowances` (the settings row that exists) is per
       elevation or per job, since that decides how much the seeded sides can
       be trusted.
    Then propose the smallest implementation and wait.

---

## Step 2 — One screen, elements first

Build `s-ext-job` from the prototype. The order is the specification:

1. **What are we painting? — On the house.** Body of the house · Windows · Doors · Fascias · Gutters & downpipes · Eaves. Multi-select, **nothing pre-ticked**.
2. **Standing on its own.** Fence · Deck or floor · Garage or shed · Wall. Multi-select, nothing pre-ticked.
3. **Only if the body is ticked — what are the walls made of?** Weatherboard · Brick · Render · Stucco · Cement sheet · Cladding or panelling · Not sure. Multi-select, **nothing pre-ticked**, with the line: *nothing is ticked for you — brick and render are often left bare on purpose, so we'd rather you told us.*
4. **Only if windows are ticked — what type, mostly?** Casement · Sash · Colonial · Winder · Aluminium (usually not painted) · Not sure, as picture tiles. Then **how many windows, all up?** as a stepper.
5. **Only if doors are ticked — how many doors?** Stepper.
6. **Colours.** Same colours again · New colours · Going much lighter. Same three-way shape as the interior, feeding the same derivation.
7. **Condition.** Good · Weathered · Peeling.
8. **Single or double storey?** Asked **once**, here and nowhere else.
9. **Access.** Steep block · tight side access · double-height entry · needs a lift or scaffold · nothing tricky. "Needs a lift or scaffold" sets `requires_site_check` and the range still shows with equipment excluded, said plainly.
10. The book-someone-in card.

**Bedrooms are never asked and `beds` is never written on an exterior session — assert this in a test.**

---

## Step 3 — Downstream

- **Sides seeding.** The seeded sides carry only the elements ticked. A job with the body unticked seeds sides with trims and roofline and no wall line.
- **Counts.** Window and door counts are whole-job at this stage and are reconciled side by side in the tighten stage — the side cards already count per side. Report how the reconciliation should work if the totals disagree; do not invent it.
- **What we'll do.** The exterior derivation produces its own lines: walls by material, windows by type with the colonial note, doors, fascias, gutters, eaves, then a *Not included* line naming equipment hire, rotten timber replacement and anything not visible from the ground. Never the interior lines — a bug that shipped in the prototype and is now fixed there.
- **Assume list.** Exterior variant per the prototype.
- **Aluminium windows** price at zero and carry a note that the estimator will check, rather than being silently dropped.

---

## Step 4 — Engine

Window type is a real cost multiplier and must come from the rate card, not the component. Colonial is materially slower than casement — the bars are cut in by hand.

⚑ **Multipliers are Tom's to set.** The prototype uses illustrative values (casement 1.0 · sash 1.25 · winder 1.35 · colonial 1.6 · aluminium 0 · not sure 1.1). Ship them as Settings rows keyed to the rate card version and flag them for him.

Anything in §2 with no rate item gets a flagged, unpriced line — never a guess.

---

## Acceptance

- No exterior path asks bedrooms, and no exterior session writes `beds` (test).
- Storeys asked exactly once (test).
- Nothing is pre-ticked on the elements or the materials.
- Materials, window type, window count and door count appear only when their element is ticked, and disappear when it's unticked (test each).
- A body-unticked job produces no wall line anywhere in the tree, the estimate or "What we'll do".
- The exterior "What we'll do" never renders interior lines.
- Window-type multipliers come from Settings, not from a component (grep).
- E2E as the anonymous customer: tick body + windows + doors + fascias, choose colonial, 8 windows, 2 doors, new colours, weathered → a range; then untick the body and watch the wall line and the materials question both go.

**Tom's check:** walk it on the phone. Nothing pre-ticked; the questions that appear are only the ones you asked for; eight colonial windows price higher than eight casements; unticking the body removes the walls everywhere.

---

## ⚑ Decisions

| # | Decision | Default unless you say otherwise |
|---|---|---|
| 48 | Window type multipliers | Settings rows, seeded with the illustrative values above — yours to correct |
| 49 | Aluminium windows | Priced at zero with an estimator note, not removed silently |
| 50 | Whole-job counts vs per-side counts | Quick look takes whole-job; the sides builder reconciles. Report the rule before building it |
| 51 | Does the exterior colour question feed the same derivation as the interior? | Yes — one table, exterior rows |
| 52 | Exterior per-elevation allowances (allowances spec §8) | Still absent. This chunk doesn't create them; flag that the exterior range stays wider until they exist |

---

## Reference files

    design/reference/estimator-journey-v2.html          v2.6 — screen s-ext-job and its ? drawer
    docs/briefs/claude-code-brief-estimator-journey-v2.md   (C8's block; this chunk supersedes its exterior paragraph)
    docs/briefs/estimator-journey-v2-plan.md            §4, §9.2
    docs/briefs/wizard-project-allowances-spec.md       §8 — the gap in ⚑52

Ledger row on completion, noting ⚑48's values as shipped.
