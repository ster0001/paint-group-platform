# One-page build instruction: the customer estimate flow — interior & exterior

**Read first, in this order:** `CLAUDE.md` · `docs/wizard-diagnostic.md` (why we're rebuilding) · `wizard-rebuild-plan-v2.md` · `rebuild-addendum-confirm-loop.md` · then the four reference mockups in `design/reference/`: `floorplan-wizard-mockup.html` (interior wizard), `customer-review-confirm-mockup.html` (interior editor), `customer-review-confirm-exterior-v2-sides.html` (exterior editor — supersedes all earlier exterior layouts), `customer-scope-editor-workflow.md`. **If any file is missing: stop and report. Never build around a missing reference.**

## The flow in one sentence
Wizard (whole-house questions) → confirm-loop editor (area-by-area: everything starts AMBER, turns CYAN when its required questions are answered and confirmed) → estimate only reads CONFIRMED when every area + final checks are blue → then, and only then, Accept or Book-the-visit per the ladder.

## Interior
- **Wizard:** the existing five steps, unchanged (floorplan = exactly 1 file; condition photos are `condition_photo`, never floorplans; page-4 door/window styles populate every tile).
- **Editor loop (8 items):** each room card → required **size Q as L × W** ("Is 3.5 × 3.25 m about the size?" — Looks right / Adjust with two metre inputs, reprices via engine, "updated by you") → surface tiles (capture components, customer mode) with **steppers on doors/windows and S/M/L inside window tiles; windows are groups** ("+ More windows — a different size", repeatable) → required **cupboard Qs by room type** (kitchen fronts/robes/vanity, priced per front) → **"+ Add a surface"** = full rate-card catalogue + free-text custom (custom = amber ⚑ tile, NEVER auto-priced, prompt: *"Thanks — we've added it, and we'll confirm this area on the site visit"*, routes estimate to visit tier) → then the **doors & windows totals check card** (live counts, required) → then the **sweep** ("Hallways are the ones floorplans miss most…" — Hallway chip first).

## Exterior
- **Wizard, 5 pages:** (1) address + **2–3 facade photos — no floorplan field exists on this path**; (2) picture-pickers: storeys + *what's the house made of* (weatherboard/render/brick/mix — **this answer seeds the editor's wall tiles**); (3) what are we painting (roofline pre-ticked; there is NO "how far around" question — side selection replaces it); (4) condition (peeling + pre-1970s → lead hard stop) + access; (5) extras + paint prefs.
- **Editor loop (8 items), BUILT BY SIDES — Front / Left / Right / Back**, then Freestanding extras, Condition & access (incl. fascia-rot Q), windows/doors totals check, sweep. Visual = top-down house outline, edges amber→cyan (grey dashed = skipped).
- **Per side:** required *"Are we painting this side?"* — No = NOT PAINTING ✓, explicit exclusion on the quote → required **L × H** ("about 12 m long × 2.6 m high — sound right?"; "not sure" accepted → widens range, "we'll measure") → **wall tiles show ONLY the wizard's substrate answer** (e.g. one Weatherboard tile @100%); other wall types live in "+ Add a surface" as "+ Render — wall surface" etc.; an added wall tile carries **"% of wall" chips (25/50/75/100) INSIDE the tile** (same pattern as window sizes), arrives at 25% with **auto-balance** (largest surface gives up the share, toast explains) — **a painted side cannot confirm unless the mix totals 100%** → counted tiles (windows w/ sizes & groups, doors, fascias & gutters + eaves as per-metre run items, downpipes) → per-side additions land on that side. Wall value = L×H × Σ(share × substrate factor). **Work orders group by elevation:** "Front — 12 × 2.6 m, weatherboard 75% / render 25%, 3 windows (2 M, 1 L), entry door, fascias & gutters."

## Non-negotiables (each one traces to a diagnostic failure — do not relitigate)
1. One tree, one engine: wizard, editors, capture, builder all read/write the same estimate tree; every price from `lib/pricing` server-side.
2. Customers control the WHAT, never the HOW-MUCH: no hours/rates/prep figures render customer-facing; customer-role actions accept scope changes only (RLS-enforced).
3. Response payloads are chosen by explicit `view=customer|staff`, never by caller role.
4. ONE confidence function (provenance-weighted, capped honestly) feeds header, cards and the range bands (≥90 ±4 / 70–89 ±8 / <70 ±15).
5. Nothing the customer told us exists ever contributes $0 silently — unsure items price at defaults with an amber trace; customs flag the visit.
6. Ladder thresholds are Settings values: interior self-serve ≤$6,000 @ ≥90%; straightforward exterior ≤$12,000 @ ≥85%; else "Confirm my price — book the visit" (never a blocked state).
7. Process: one branch per item · every PR starts with a failing **e2e spec driven as an anonymous customer** · every PR lists its mockup interactions as a checkbox checklist — unchecked = unmergeable · root-cause note in every fix PR.

**Definition of done:** every interaction demonstrable in the four reference mockups is demonstrable in the build, the customer-journey e2e suite is green, and Tom's scripted 90-second phone walkthrough passes on both the interior and exterior paths.
