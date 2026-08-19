# Wizard + scope editor — diagnostic audit

**Date:** 19 Aug 2026 · **Scope:** `/wizard`, `/estimate`, `/estimate/scope`, upload pipeline, exterior.
**Method:** read the two mockups interaction by interaction; traced the code; drove the real
customer flow in a browser (`e2e/assess-customer-flow.spec.ts`, screenshots in
`test-results/assess/`). No fixes were made in this session.

---

## 0. Reference availability — the first finding

| Reference | Status |
|---|---|
| `design/reference/floorplan-wizard-mockup.html` | **EXISTS** (457 lines) |
| `design/reference/customer-scope-editor-mockup.html` | **EXISTS** (323 lines) |
| `docs/briefs/customer-scope-editor-workflow.md` | **MISSING — never supplied** |
| `docs/briefs/floorplan-wizard-business-inputs.md` | **MISSING under that name**; the content exists as `docs/briefs/wizard-business-inputs.md` |

Two consequences, both material:

1. **The workflow doc never existed in the repo or on disk.** Part B was built from the mockup
   plus the prose brief pasted into chat. Everything the workflow doc would have defined and the
   mockup does not show — the exterior question set, the "straightforward exterior" definition,
   the verify-mode contract, the not-sure vocabulary — was inferred. That is the single largest
   source of divergence, and it was flagged three times during the build but built around rather
   than blocked on.

2. **`wizard-business-inputs.md` was not reconciled against the Part B brief, and they conflict.**
   The committed owner-supplied doc (§2, "Acceptance / walkthrough policy") says:

   | | Business-inputs doc (committed) | What was built (B2) |
   |---|---|---|
   | Self-serve accuracy bar | **≥ 80%** | ≥ 90% |
   | Tighter bar for small jobs | **≥ 90% under $7,000** | — (not implemented) |
   | Always-walkthrough threshold | **≥ $15,000** | interior $6,000 / exterior $12,000 |

   The doc's header says these values "override any placeholder in the mockup". They were not
   applied; the chat brief's numbers were used instead. Whichever is correct, the build currently
   contradicts a committed owner document. **This needs your ruling, not a code change.**

---

## 1. Feature truth table

### 1a. Floorplan wizard mockup (`floorplan-wizard-mockup.html`)

| # | Interaction in the mockup | Status | Where / why |
|---|---|---|---|
| 1 | Listing URL field | WORKS | `WizardApp.tsx` PageProperty |
| 2 | Upload floorplan button | **PARTIAL** | `WizardApp.tsx:~437` — `multiple` is set; runtime confirms the picker accepts many files. Mockup implies one plan. **(your #2)** |
| 3 | "I don't have a floorplan" → basics (beds / storeys / size) | WORKS | PageProperty no-plan branch |
| 4 | Job type Interior / Exterior / Both | WORKS | PageProperty |
| 5 | Step 2 surface tiles, pre-ticked, toggle | WORKS | PageSurfaces, data-driven since A2 |
| 6 | Step 3 condition cards + dark-to-light chips | WORKS | PageCondition |
| 7 | Step 4 door-type picker | **PARTIAL** | Mockup **defaults to Panel**; build defaults to **"Not sure"** (`lib/wizard/state.ts` `doorStyle: "unsure"`). See §1c — this is the cause of your #4. |
| 8 | Step 4 ceiling height | **PARTIAL** | Works, but is asked on **exterior-only** jobs too **(your #7)** |
| 9 | Step 4 window-type picker | **PARTIAL** | Same defaulting problem as doors |
| 10 | Step 4 damage cards + photo stub at tier ≥ 2 | WORKS | `WizardApp.tsx:~940` |
| 11 | Step 5 paint brands + water-based follow-up | WORKS | PagePaint |
| 12 | Email gate | WORKS | page 6, customer mode |
| 13 | Processing lines | WORKS | + an "ANALYSING THE DAMAGE PHOTOS…" line added in A7 |
| 14 | Editor scorebar: ring, accuracy, hint | WORKS | `Editor.tsx` / `CustomerResult.tsx` |
| 15 | Editor scorebar: **range** | **PARTIAL / MISSING** | Staff `/wizard` editor renders a **point price + margin**, never a range (`Editor.tsx:150,155`). Customer screens render a range but it breaks on first edit — see §2b. **(your #1)** |
| 16 | Confirm row (ceiling height; low-confidence room) | WORKS | `confirm_height`, `confirm_room` |
| 17 | **Plan box: SVG floorplan, tap a room, highlight sync, legend** | **MISSING** | Never built. `PlanViewer` shows the raw uploaded image. Documented as a known gap at the time (extraction returns no room bounding boxes), but it is a headline element of the mockup. |
| 18 | Room cards: provenance chip, surface chips, "2 coats" | WORKS | `RoomCard.tsx` |
| 19 | Room card × remove | WORKS server-side | UI does not refresh for a staff actor — §2b |
| 20 | "TYPICAL SIZE — TAP TO CONFIRM" | WORKS | |
| 21 | Add-rooms chips | WORKS | |
| 22 | Sticky: range + "Book a walkthrough" + "Save my estimate" | **PARTIAL** | Buttons exist (`CustomerResult.tsx:277-281`) but **"Book a walkthrough" is a toast stub** — no booking. Real booking exists only in the B2 scope editor. |
| 23 | Toast on every action | WORKS | |

### 1b. Customer scope editor mockup (`customer-scope-editor-mockup.html`)

| # | Interaction | Status | Where / why |
|---|---|---|---|
| 1 | Scorebar ring + range + flash | **PARTIAL** | Range undefined after any staff-driven edit — §2b |
| 2 | **Left visual column** (`.visual`, sticky, 380 px) | **MISSING** | `ScopeEditor.tsx` has no `sc-visual` / `sc-grid` / `sc-plan` / `sc-facade`. The mockup's two-column layout was not built; the editor is a single column of cards. |
| 3 | Interior: floorplan SVG in the visual column | **MISSING** | as above |
| 4 | Exterior: facade illustration | **MISSING** | as above |
| 5 | Exterior: geo chips + "Not right? Tell us" | WORKS | `sc-geo`, `flag_geometry` |
| 6 | Room card: name, m², × remove | **PARTIAL** | Server action correct; UI does not update for staff — §2b **(your #6)** |
| 7 | Tile grid with ✓ | WORKS | `sc-tl` |
| 8 | **Steppers − q + on countable tiles** | **PARTIAL → effectively MISSING** | Implemented (`ScopeEditor.tsx` `sc-st`) but render only when a doors/windows tile is **on**, and with the default "Not sure" styles **no room ever has doors or windows**. Runtime: **0 steppers on the page**. **(your #4)** |
| 9 | "More surfaces…" | WORKS | |
| 10 | Skirting pairing advice (Keep / Leave) | WORKS | |
| 11 | "Something else?" → amber note chip | WORKS | |
| 12 | "Includes filling minor cracks…" lock line | WORKS | |
| 13 | Add-rooms chips | WORKS | |
| 14 | Exterior groups BODY / TRIMS / ROOFLINE / **EXTRAS** | **PARTIAL** | Built in B2 and rendered on first load; needs a runtime check on your actual estimate — two candidate causes in §3 note. **(your #8)** |
| 15 | Extent seg (Whole / Front / Front + sides) | PARTIAL | built; same caveat |
| 16 | Fence metres / "not sure" | PARTIAL | built; same caveat |
| 17 | Sticky tier line + CTA | PARTIAL | thresholds contradict the business-inputs doc (§0) |
| 18 | Visit slots row | PARTIAL | slots are generated weekdays, not your calendar |
| 19 | Delta toasts ("about +$X") | **PARTIAL** | Delta is computed from the range midpoint; with the range undefined after a staff edit it degrades |

### 1c. The defect that explains #4 (and part of #5)

`lib/wizard/state.ts` defaults `doorStyle: "unsure"` and `windowStyle: "unsure"`.
`lib/wizard/merge.ts` then does, deliberately:

```ts
const doorCode = state.details.doorStyle === "unsure" ? null : doorRateCode(...);
if (kind === "doors" && doorCode) { kept.push(...) }   // no code → stays deferred
```

So unless the customer actively picks a door and window style, **every door and window in the
house is left out of the estimate** and lands in the deferred list instead. Observed live: rooms
came back as "4 surfaces · ceiling, skirting boards, walls, cornices" — no doors, no windows,
anywhere. Consequences:

- No countable tiles are ever "on" → **no steppers render** (your #4).
- Each deferred item costs 2 accuracy points (max −12), pushing the ring down.
- The estimate is silently missing real money.

The mockup pre-selects Panel and Sash. The build's "no guessing" rule (correct in principle for a
*rate*) was applied to the *default*, which is not the same decision.

---

## 2. Foundation checks

### 2a. Does the wizard write where the builder reads? — **YES, one source of truth**

```
POST /api/wizard/submit
  └─ INSERT estimates { title, status:'draft', source, builder_state }
                                   │
              builder_state = { blocks[], aiDeferred[], jobAddress?, wizard{} }
                                   │
        ┌──────────────────────────┼────────────────────────────┐
   GET /quote?id=…          POST …/wizard-edit          POST …/rooms (capture)
   QuoteBuilder reads         mutate → UPDATE              mutate → UPDATE
   loaded.blocks verbatim     builder_state               builder_state
```

- Insert: `app/api/wizard/submit/route.ts:420-424`; builder_state shape `:359-377`.
- Builder read: `app/quote/QuoteBuilder.tsx:263-275` — same `blocks` array, verbatim.
- `estimate_areas` / `estimate_lines` exist in the initial migration but are **dead** — zero
  application references. The tree is only ever a jsonb blob. (Stated in
  `supabase/migrations/20260910000000_ai_extraction.sql:6-10`.)

**One real defect found here:** `QuoteBuilder.tsx:655` rebuilds `builder_state` from a *fixed key
list* rather than spreading what it loaded. A staff save through the builder therefore **drops
`builder_state.wizard`** (the answers + the proving snapshot) and **`prepPack`**. After any builder
save: `add_room` stops re-applying the wizard answers, and the proving dashboard loses its
baseline. Silent data loss, not currently covered by a test.

Shape divergence: builder-created nodes carry no `origin`, and `lib/wizard/view.ts:145,172` reads a
missing origin as **human-confirmed (credit 1.0)** — so hand-added rooms inflate the accuracy score.

### 2b. Is every displayed price a server-computed range? — **NO, and this is your #1 and #6**

`lib/pricing` is the only estimate math (`priceEstimateTotals`, `priceArea`, `priceSurface`), and
`customerPayload` (`lib/wizard/view.ts:99-142`) correctly strips totals/margin and returns
`rangeLoCents` / `rangeHiCents` from `rangeFromTotal`. The type physically cannot carry a point
price. That part is sound.

**The break is the response contract on edits.** `app/api/estimates/[id]/wizard-edit/route.ts`:

```
:399   if (actor.kind === "customer") { … return { ...customerPayload, scopeRooms, exterior, ladder } }
:459   return NextResponse.json(payload);        // ← staff: editorPayload, NO range, NO scopeRooms
```

The branch is on **actor**, not on which screen called. You test as **staff**. So on
`/estimate` and `/estimate/scope`:

- initial page render → server builds `customerPayload` → **range shows correctly**;
- first tap → response is `editorPayload` → no `rangeLoCents` → `fmt(undefined)` → **the range
  breaks** (your #1);
- same response has no `scopeRooms` → `setRooms` never fires → **tiles never change, removals
  appear to do nothing** (your #6) even though the server applied them correctly.

Confirmed independently in code by audit and consistent with the live run. A real anonymous
customer would not hit this; every staff preview does.

Additionally, the internal `/wizard` editor is point-price **by design** (`Editor.tsx:150,155`) —
if that is the screen you were judging, it will never show a range without a decision to change it.

**Separate finding:** `/e/[token]` (the *sent* estimate) shows the customer a fixed point price and
computes GST, discount and deposit **in the component** (`app/e/[token]/CustomerEstimate.tsx:87-95`)
rather than in `lib/pricing`. That is the one customer-facing money screen whose arithmetic lives
outside the pricing module — a direct violation of the `CLAUDE.md` rule.

### 2c. Confidence score — **two independent numbers, and the room cards over-report (your #5)**

**Overall ring** — `lib/wizard/accuracy.ts:43-62`: dollar-weighted mean of a per-room credit, minus
2 points per deferred item (cap −12).

| origin | credit |
|---|---|
| human_confirmed | 1.00 |
| ai_extracted | 0.92 (0.70 if node confidence < 0.7) |
| ai_derived | 0.85 |
| customer_stated | 0.75 |
| ai_assumed | 0.45 |
| **absent** | **1.00** ← builder-made rooms score as human work |

Assumed `H` −0.15; assumed `L`/`W` caps at 0.50; floor 0.20.

**Per-room card %** — a *completely separate* fixed lookup, `lib/wizard/view.ts:95-97`:
`confirmed 100 · extracted 90 · stated 85 · check 65 · typical 50`.

The two never reconcile. A room read from a plan with an assumed ceiling height **displays 90%**
while contributing **0.77**. It displays 90% even when every door and window is missing from it
(§1c), because the card lookup ignores the H penalty, the deferred items and the surface set
entirely. That is the "too high" you saw. Live run: room cards showed **90% / 50%** while the
header ring showed **41%**.

Also: the ceiling for a perfectly-read plan is **92** (0.92 credit), so the ≥90 "tight range" band
is effectively unreachable — one deferred item drops it to 90, two to 88.

### 2d. Upload pipeline — three paths, one shared route

| Control | Where | accept / multiple | Client rule | Goes to | Tagged |
|---|---|---|---|---|---|
| **Floorplan** | page 1 | `image/*,application/pdf`, **multiple** (`WizardApp.tsx:587-591`) | `document` (15 MB) | signed URL → `/api/extract/floorplan?kind=floorplan` | `kind = floorplan` |
| **Facade photos** | page 1 (exterior) | `image/*`, multiple (`:707-710`) | **`document`** — mismatched to its own `accept` | **the same route**, `?kind=elevation` | `kind = elevation` |
| **Damage photos** | page 4 (tier ≥ 2) | `image/*`, multiple (`:941-944`) | `image` (10 MB) | buffered client-side, uploaded **at submit** → `/api/extract/{runId}/photos?purpose=damage` | `kind = defect_photo` |

**On #3 — are photos "added in as a floorplan"?** In the database, **no**: the three paths are
cleanly separated, `kind` is written verbatim from the caller (`floorplan/route.ts:270`), damage
photos hard-code `defect_photo` (`photos/route.ts:148`), no `extraction_run` is created for a
damage photo, and the plan reader can never pick one up. **In the interface, effectively yes:**
facade photos POST to the route literally named `floorplan`, and the processing screen announces
"READING THE FLOORPLAN…" regardless of what was uploaded. Every customer-visible cue calls
everything a floorplan.

**On #2 — the floorplan control accepts many files** (`multiple`, 5 per batch, repeat presses
append). Worse, `primaryRunRef` is set **once, to the first run of the first batch, and never
revised** (`WizardApp.tsx:170`). Everything single-plan hangs off it: damage photos, the listing
cross-check, the footprint derivation. On a multi-page or multi-file upload, defects can only ever
attach to rooms found in **that first page**.

**Is the photo → AI → prep-line path real?** Yes, end to end, and the live run showed it executing.
But it has **six** load-bearing preconditions, and failing any of them degrades quietly:

1. A plan upload must already have succeeded — the damage control does not even render otherwise
   (`WizardApp.tsx:431, 939`), and `analyseDamagePhotos` returns early with no plan run (`:223`).
2. That first run must have finished reading with a `raw_output` that parses as an interior
   extraction — a first page classified `elevation` or `site_plan` makes the photos route **422**
   (`photos/route.ts:59-64`).
3. `ANTHROPIC_API_KEY` present.
4. Per-defect model confidence **≥ 0.7** and `qty > 0`, else silently dropped
   (`lib/extract/photos.ts:275`).
5. `defect_prep_rates` seeded at version 3 — no row ⇒ 0 hours ⇒ amber deferral, not priced prep
   (`lib/capture/commit.ts:88-90`, `lib/extract/draft.ts:262-272`).
6. The model's free-text `room_guess` must resolve to a drafted room, else another deferral
   (`draft.ts:257-261`).

**New defect found during this audit:** when photo analysis fails, the customer is told nothing.
`analyseDamagePhotos` collects the failures into `photoIssues`, but the customer branch **returns
before they are attached** (`WizardApp.tsx:322-326` vs `:327-331`, staff-only). The customer's only
trace is a server-side "damage to price" deferral they never see. Minor related bug:
`DEFECT_LABELS` (`lib/capture/commit.ts:69-82`) is missing `render_cracks`, `efflorescence`,
`rust` and `timber_rot`, so those prep lines render with the raw enum string as their label.

---

## 3. Root cause — why it diverged

Four causes, in order of impact. None of them are "the code was hard".

1. **A missing reference was worked around instead of blocked on.** The workflow doc never
   arrived. I flagged it, then built anyway from a mockup that covers the interior happy path and
   a prose brief. Everything it would have pinned down — the exterior question set, the
   straightforward-exterior definition, the not-sure vocabulary — became my invention. Your #7 and
   #8 are exactly the areas the missing doc governed.

2. **Acceptance criteria were prose, never executable.** The brief's "Accept:" lines were read as
   guidance and then satisfied by *unit tests on pure functions*: 31 unit test files, and until
   today **zero tests that drive the customer flow**. `lib/wizard/scope-editor.test.ts` proves
   `applyToggle` removes a surface — and passes happily while the UI never re-renders, because
   nothing tested the round trip. Every one of your eight complaints is invisible to the test
   suite and visible within ninety seconds of using the thing.

3. **I never ran the customer flow.** Not once, in either Part B session. The performance work in
   A4 was measured in a real browser; Part B was not opened at all. The staff/customer payload
   split (§2b) is a five-minute bug that survived two sessions and a merge because no one clicked.

4. **Single-pass breadth over depth.** Seven A-items and two B-branches were delivered in one
   sitting against a brief that read as a checklist. Each item was closed when its code compiled
   and its unit tests passed, rather than when the screen behaved like the mockup. The mockup was
   used as a *style* reference (the `.sc-` classes are ported almost verbatim) but not as a
   *behaviour* specification — which is why the layout resembles it and the interactions do not:
   the entire left visual column simply is not there.

**Note on #8 (extras column):** the code renders an EXTRAS group whenever the estimate has
Exterior blocks, so this needs a two-minute runtime check on your actual estimate to separate two
causes: (a) your exterior estimate produced no Exterior blocks, or (b) the wizard's page-2 exterior
list is a flat list with no Body/Trims/Roofline/Extras grouping (confirmed: `WizardApp.tsx:742-747`
groups only "Inside"/"Outside"). I did not want to guess which you were looking at.

---

## 4. Rebuild vs patch, per area

| Area | Verdict | Size | Reasoning |
|---|---|---|---|
| **Response contract** (staff/customer payload split) | **Patch** | **S** | One branch at `wizard-edit:399`. Should key on the *requesting surface*, not the actor. Fixes your #1 and #6 outright, and un-breaks the delta toasts and ladder. Highest value per hour in the whole list. |
| **Door/window defaults** (§1c) | **Patch** | **S** | Change two defaults + decide the policy: pre-select like the mockup, or force an answer before continuing. Fixes your #4, lifts the accuracy score honestly, stops silently under-scoping. Needs *your* ruling on which. |
| **Uploads** (single plan; photos as photos) | **Patch** | **S–M** | Drop `multiple` on the plan input; give condition photos their own labelled intake that does not require a floorplan; relabel the processing copy per upload kind; revise `primaryRunRef` when a better plan page arrives. Your #2 and #3. |
| **Photo failures invisible to customers** | **Patch** | **S** | `WizardApp.tsx:322-326` returns before the failure messages are attached — customer-path only. Also add the four missing `DEFECT_LABELS`. |
| **Confidence score** | **Patch** | **S** | Delete the second lookup table; derive the card % from the same `credit()` the ring uses, including the H penalty and missing-surface effects. Your #5. |
| **Scope editor — visual column** | **Rebuild (net-new)** | **M–L** | Genuinely absent, not broken. The interior floorplan SVG needs room bounding boxes the extraction schema does not emit today — that is the real blocker and it is an AI-schema change, not UI work. The exterior facade panel is achievable now (CSS illustration in the mockup). Recommend: build the exterior panel and the two-column layout (M); treat the tappable interior plan as its own piece of work once the schema emits geometry (L). |
| **Exterior wizard questions** | **Rebuild** | **M**, blocked | Pages 3–5 do not branch on job type at all; an exterior job is asked ceiling height and interior door styles. There is no reference defining what it *should* ask. Needs a short spec session with you (or the missing workflow doc) before any code. Your #7. |
| **Exterior extras / grouping** | **Patch** | **S** | Group page-2 exterior substrates into Body / Trims / Roofline / Extras to match the editor's own vocabulary. Your #8 — after the runtime check above. |
| **Sign-off ladder thresholds** | **Patch** | **S** | Reconcile against `wizard-business-inputs.md` (80% / $7k / $15k) or supersede that doc explicitly. Decision first, code second. |
| **`builder_state.wizard` dropped on builder save** | **Patch** | **S** | Spread the loaded state instead of rebuilding from a key list (`QuoteBuilder.tsx:655`). Silent data loss; not currently reported by anything. |
| **`/e/[token]` pricing outside `lib/pricing`** | **Patch** | **M** | Architectural rule violation; the sent estimate recomputes GST/discount/deposit client-side. Worth fixing before invoices depend on it. |
| **Test strategy** | **Rebuild** | **M** | The suite proves functions, not journeys. One Playwright spec per journey (customer wizard → reveal → editor → accept) would have caught seven of your eight complaints. This is the change that stops the next round of this happening. |

**Suggested order:** response contract → door/window defaults → uploads → confidence → extras
grouping → journey tests → exterior spec session → visual column.

The first four are S-sized and together address #1, #2, #3, #4, #5 and #6.
